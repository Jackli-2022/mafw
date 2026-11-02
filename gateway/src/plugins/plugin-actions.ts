/**
 * Plugin action registry — the only way a unified package's `actions{}` become
 * callable.
 *
 * Registration is commit-scoped: the PluginHost registers a package's actions
 * *after* its candidate is committed (and after the replaced revision's bag was
 * disposed), so a pending candidate is never callable and a deleted package
 * disappears with its bag. Each registration:
 *
 * - compiles the declared JSON Schemas once per revision (Ajv 2020-12),
 * - owns an AbortController set for in-flight invocations,
 * - records the revision token it belongs to.
 *
 * Invocation enforces the Host half of the action contract (spec §7): input
 * validation before the handler, output validation after it, a per-action
 * timeout, an AbortSignal, payload byte caps, and revision capture so a result
 * produced by a superseded revision is dropped instead of returned.
 */
import Ajv2020 from 'ajv/dist/2020';
import type { ValidateFunction } from 'ajv';
import { PLUGIN_UI_LIMITS } from '@mafw/plugin-contract';
import { validatePluginSchema } from './package-validator';
import type { RegistrationBag } from './registration-bag';
import type { ActivatedAction, PluginActionDeclaration } from './package-types';

/** Same rules the candidate validator applies; injectable for diagnostics tests. */
export type PluginSchemaValidator = (label: string, schema: unknown) => string[];

export type PluginActionErrorCode =
  | 'unknown-package'
  | 'unknown-action'
  | 'invalid-input'
  | 'invalid-output'
  | 'payload-too-large'
  | 'timeout'
  | 'aborted'
  | 'unloaded'
  | 'stale-revision'
  | 'handler-error';

/** HTTP status the REST layer may surface; neutral, never runtime-specific. */
const ERROR_STATUS: Record<PluginActionErrorCode, number> = {
  'unknown-package': 404,
  'unknown-action': 404,
  'invalid-input': 400,
  'invalid-output': 502,
  'payload-too-large': 400,
  timeout: 408,
  aborted: 409,
  unloaded: 409,
  'stale-revision': 409,
  'handler-error': 502,
};

/**
 * Neutral plugin action failure.
 *
 * `message` is safe to return to Desktop; handler internals stay in diagnostics.
 */
export class PluginActionError extends Error {
  readonly code: PluginActionErrorCode;
  readonly status: number;

  constructor(code: PluginActionErrorCode, message: string) {
    super(message);
    this.name = 'PluginActionError';
    this.code = code;
    this.status = ERROR_STATUS[code];
  }
}

export interface PluginActionInvokeOptions {
  /** Session that triggered the action (forwarded to the handler). */
  sessionID?: string;
  /** Caller cancellation (HTTP client disconnect). */
  signal?: AbortSignal;
  /**
   * Revision the caller built its request against. When it no longer matches
   * the committed registration the call is rejected as `stale-revision`.
   */
  revision?: string;
}

export interface PluginActionRegisterOptions {
  /** Committed revision token this registration belongs to. */
  revision?: string;
}

export type PluginActionDiagnosticCode = 'invalid-package' | 'invalid-schema' | 'handler-error';

export interface PluginActionDiagnostic {
  packageName: string;
  action?: string;
  code: PluginActionDiagnosticCode;
  message: string;
  at: string;
}

export interface PluginActionRegistryOptions {
  /** Receives registration/invocation diagnostics; defaults to `log.warn`. */
  onDiagnostic?: (diagnostic: PluginActionDiagnostic) => void;
  /** Ring size for `getDiagnostics()` (default 100). */
  maxDiagnostics?: number;
}

interface RegisteredAction {
  declaration: PluginActionDeclaration;
  validateInput?: ValidateFunction;
  validateOutput?: ValidateFunction;
  timeoutMs: number;
}

interface PackageActions {
  revision: string;
  actions: Map<string, RegisteredAction>;
  inFlight: Set<AbortController>;
}

const PACKAGE_NAME_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

function jsonByteSize(value: unknown): number | null {
  try {
    const text = JSON.stringify(value);
    if (text === undefined) return null;
    return Buffer.byteLength(text, 'utf8');
  } catch {
    return null;
  }
}

function describeError(err: unknown): string {
  if (err instanceof Error) return err.message || err.name;
  return String(err);
}

function timeoutOf(declaration: PluginActionDeclaration): number {
  const declared = declaration.timeoutMs;
  if (typeof declared !== 'number' || !Number.isFinite(declared) || declared <= 0) {
    return PLUGIN_UI_LIMITS.defaultActionTimeoutMs;
  }
  return Math.min(declared, PLUGIN_UI_LIMITS.maxActionTimeoutMs);
}

export class PluginActionRegistry {
  private readonly packages = new Map<string, PackageActions>();
  private readonly diagnostics: PluginActionDiagnostic[] = [];
  private readonly onDiagnostic?: (diagnostic: PluginActionDiagnostic) => void;
  private readonly maxDiagnostics: number;

  constructor(options: PluginActionRegistryOptions = {}) {
    this.onDiagnostic = options.onDiagnostic;
    this.maxDiagnostics = options.maxDiagnostics ?? 100;
  }

  /**
   * Replaces the action set of `packageName` for one committed revision.
   *
   * Declarations whose schema cannot be validated/compiled are skipped with a
   * diagnostic instead of poisoning the whole package (the candidate validator
   * rejects them earlier; this is the second line of defense). The returned
   * diagnostics are also appended to `getDiagnostics()`.
   */
  register(
    packageName: string,
    actions: readonly ActivatedAction[],
    bag: RegistrationBag,
    validator: PluginSchemaValidator = validatePluginSchema,
    options: PluginActionRegisterOptions = {},
  ): PluginActionDiagnostic[] {
    const diagnostics: PluginActionDiagnostic[] = [];
    const push = (diagnostic: Omit<PluginActionDiagnostic, 'at'>) => {
      const entry: PluginActionDiagnostic = { ...diagnostic, at: new Date().toISOString() };
      diagnostics.push(entry);
      this.recordDiagnostic(entry);
    };

    if (typeof packageName !== 'string' || !PACKAGE_NAME_PATTERN.test(packageName)) {
      push({
        packageName: String(packageName),
        code: 'invalid-package',
        message: `package name "${String(packageName)}" is not registrable`,
      });
      return diagnostics;
    }
    if (!Array.isArray(actions)) {
      push({
        packageName,
        code: 'invalid-schema',
        message: `actions of package "${packageName}" must be an array`,
      });
      return diagnostics;
    }

    // One Ajv instance per registration (= per revision). Schemas of different
    // packages must not share ids, and a revision swap must not leak compilers.
    const ajv = new Ajv2020({ strict: false, validateFormats: false, allErrors: false });
    const compiled = new Map<string, RegisteredAction>();

    for (const activated of actions) {
      const name = activated?.name;
      const declaration = activated?.declaration;
      if (typeof name !== 'string' || name.length === 0 || !declaration || typeof declaration.handler !== 'function') {
        push({
          packageName,
          action: typeof name === 'string' ? name : undefined,
          code: 'invalid-schema',
          message: `action declaration for package "${packageName}" is malformed`,
        });
        continue;
      }
      const label = `action "${packageName}:${name}"`;
      const errors: string[] = [];
      if (declaration.inputSchema !== undefined) {
        errors.push(...validator(`${label} inputSchema`, declaration.inputSchema));
      }
      if (declaration.outputSchema !== undefined) {
        errors.push(...validator(`${label} outputSchema`, declaration.outputSchema));
      }
      if (errors.length > 0) {
        push({
          packageName,
          action: name,
          code: 'invalid-schema',
          message: errors.join('; '),
        });
        continue;
      }

      let validateInput: ValidateFunction | undefined;
      let validateOutput: ValidateFunction | undefined;
      try {
        if (declaration.inputSchema !== undefined) validateInput = ajv.compile(declaration.inputSchema);
        if (declaration.outputSchema !== undefined) validateOutput = ajv.compile(declaration.outputSchema);
      } catch (err) {
        push({
          packageName,
          action: name,
          code: 'invalid-schema',
          message: `${label} is not a compilable JSON Schema: ${describeError(err)}`,
        });
        continue;
      }
      compiled.set(name, {
        declaration,
        validateInput,
        validateOutput,
        timeoutMs: timeoutOf(declaration),
      });
    }

    const previous = this.packages.get(packageName);
    if (previous) this.retire(packageName, previous, 'stale-revision');

    const record: PackageActions = {
      revision: options.revision ?? '',
      actions: compiled,
      inFlight: new Set(),
    };
    this.packages.set(packageName, record);
    // Late registration on a disposed bag is released immediately by the bag,
    // which keeps a removed package uncallable.
    bag.add(`plugin-actions:${packageName}`, () => this.retire(packageName, record, 'unloaded'));
    return diagnostics;
  }

  /** True while this package has a committed action set. */
  hasPackage(packageName: string): boolean {
    return this.packages.has(packageName);
  }

  /** True when `packageName` exposes a committed action called `action`. */
  has(packageName: string, action: string): boolean {
    return this.packages.get(packageName)?.actions.has(action) === true;
  }

  /** Committed revision token of the registration (diagnostics/tests). */
  revisionOf(packageName: string): string | undefined {
    return this.packages.get(packageName)?.revision;
  }

  getDiagnostics(): readonly PluginActionDiagnostic[] {
    return this.diagnostics;
  }

  /**
   * Invokes one committed action.
   *
   * Rejects with `PluginActionError`: 404 for unknown package/action, 400 for
   * invalid input or oversized payloads, 408 for timeouts, 409 for aborted /
   * unloaded / superseded calls, 502 for handler or output failures.
   */
  async invoke(
    packageName: string,
    action: string,
    input: unknown,
    options: PluginActionInvokeOptions = {},
  ): Promise<unknown> {
    const record = this.packages.get(packageName);
    if (!record) {
      throw new PluginActionError('unknown-package', `unknown plugin package "${packageName}"`);
    }
    const entry = record.actions.get(action);
    if (!entry) {
      throw new PluginActionError('unknown-action', `unknown plugin action "${packageName}:${action}"`);
    }
    if (options.revision !== undefined && options.revision !== record.revision) {
      throw new PluginActionError(
        'stale-revision',
        `plugin action "${packageName}:${action}" targets revision "${options.revision}" but "${record.revision}" is active`,
      );
    }

    const normalized = input === undefined ? {} : input;
    this.assertInputBudget(packageName, action, normalized);
    if (entry.validateInput && !entry.validateInput(normalized)) {
      throw new PluginActionError('invalid-input', `invalid input for plugin action "${packageName}:${action}"`);
    }

    const controller = new AbortController();
    record.inFlight.add(controller);
    const external = options.signal;
    const onExternalAbort = () => {
      controller.abort(new PluginActionError('aborted', `plugin action "${packageName}:${action}" was aborted`));
    };
    if (external) {
      if (external.aborted) {
        record.inFlight.delete(controller);
        throw new PluginActionError('aborted', `plugin action "${packageName}:${action}" was aborted`);
      }
      external.addEventListener('abort', onExternalAbort, { once: true });
    }

    let timer: NodeJS.Timeout | undefined;
    try {
      const abortPromise = new Promise<never>((_resolve, reject) => {
        const onAbort = () => reject(this.abortError(controller.signal));
        if (controller.signal.aborted) {
          onAbort();
          return;
        }
        controller.signal.addEventListener('abort', onAbort, { once: true });
      });
      const timeoutPromise = new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => {
          const error = new PluginActionError(
            'timeout',
            `plugin action "${packageName}:${action}" exceeded ${entry.timeoutMs}ms`,
          );
          controller.abort(error);
          reject(error);
        }, entry.timeoutMs);
        timer.unref?.();
      });
      const handlerPromise = Promise.resolve().then(() =>
        entry.declaration.handler(normalized, { sessionID: options.sessionID, signal: controller.signal }));

      let output: unknown;
      try {
        output = await Promise.race([handlerPromise, abortPromise, timeoutPromise]);
      } catch (err) {
        if (err instanceof PluginActionError) throw err;
        this.recordDiagnostic({
          packageName,
          action,
          code: 'handler-error',
          message: describeError(err),
          at: new Date().toISOString(),
        });
        throw new PluginActionError('handler-error', `plugin action "${packageName}:${action}" failed`);
      }

      // Revision capture: a handler that outlived its registration must not be
      // able to answer for the new revision's surface.
      if (this.packages.get(packageName) !== record) {
        throw new PluginActionError(
          'stale-revision',
          `plugin action "${packageName}:${action}" belongs to a superseded revision`,
        );
      }
      if (controller.signal.aborted) throw this.abortError(controller.signal);

      this.assertOutputBudget(packageName, action, output);
      if (entry.validateOutput && !entry.validateOutput(output === undefined ? null : output)) {
        throw new PluginActionError('invalid-output', `invalid output from plugin action "${packageName}:${action}"`);
      }
      return output;
    } finally {
      if (timer) clearTimeout(timer);
      record.inFlight.delete(controller);
      external?.removeEventListener('abort', onExternalAbort);
    }
  }

  private abortError(signal: AbortSignal): PluginActionError {
    const reason = signal.reason;
    if (reason instanceof PluginActionError) return reason;
    return new PluginActionError('aborted', 'plugin action aborted');
  }

  private assertInputBudget(packageName: string, action: string, input: unknown): void {
    const size = jsonByteSize(input);
    if (size === null) {
      throw new PluginActionError(
        'invalid-input',
        `input for plugin action "${packageName}:${action}" must be JSON-serializable`,
      );
    }
    if (size > PLUGIN_UI_LIMITS.maxActionPayloadBytes) {
      throw new PluginActionError(
        'payload-too-large',
        `input for plugin action "${packageName}:${action}" exceeds ${PLUGIN_UI_LIMITS.maxActionPayloadBytes} bytes`,
      );
    }
  }

  private assertOutputBudget(packageName: string, action: string, output: unknown): void {
    if (output === undefined) return;
    const size = jsonByteSize(output);
    if (size === null) {
      throw new PluginActionError(
        'invalid-output',
        `output of plugin action "${packageName}:${action}" must be JSON-serializable`,
      );
    }
    if (size > PLUGIN_UI_LIMITS.maxActionPayloadBytes) {
      throw new PluginActionError(
        'payload-too-large',
        `output of plugin action "${packageName}:${action}" exceeds ${PLUGIN_UI_LIMITS.maxActionPayloadBytes} bytes`,
      );
    }
  }

  /** Aborts in-flight calls, then drops the registration (bag cleanup). */
  private retire(packageName: string, record: PackageActions, code: 'unloaded' | 'stale-revision'): void {
    const error = new PluginActionError(
      code,
      code === 'unloaded'
        ? `plugin package "${packageName}" was unloaded`
        : `plugin package "${packageName}" was replaced by a new revision`,
    );
    for (const controller of [...record.inFlight]) {
      try {
        controller.abort(error);
      } catch {
        /* abort never fails; fail-open */
      }
    }
    record.inFlight.clear();
    if (this.packages.get(packageName) === record) this.packages.delete(packageName);
  }

  private recordDiagnostic(diagnostic: PluginActionDiagnostic): void {
    this.diagnostics.push(diagnostic);
    if (this.diagnostics.length > this.maxDiagnostics) this.diagnostics.shift();
    try {
      this.onDiagnostic?.(diagnostic);
    } catch {
      /* diagnostics must never break invocation */
    }
  }
}
