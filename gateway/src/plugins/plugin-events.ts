/**
 * Plugin event registry — the only path a unified package event can take to a
 * UI client.
 *
 * A package may only emit events it registered in its own
 * `plugin:<package>:*` namespace (spec §6). Registration is commit-scoped like
 * actions: the PluginHost registers the committed revision and the owning
 * `RegistrationBag` removes it again, so a deleted package and a superseded
 * activation can no longer emit. Every drop (canonical name, foreign
 * namespace, unregistered type, schema failure, missing session envelope) is
 * recorded as a diagnostic and never reaches the broadcaster.
 *
 * The published frame is the neutral MAFW envelope:
 * `{ type, properties, sessionID? }`.
 */
import Ajv2020 from 'ajv/dist/2020';
import type { ValidateFunction } from 'ajv';
import { PLUGIN_UI_LIMITS } from '@mafw/plugin-contract';
import { validatePluginSchema } from './package-validator';
import type { RegistrationBag } from './registration-bag';
import type { ActivatedEvent, PluginEmitEvent, PluginEventDeclaration } from './package-types';

export interface PluginEventFrame {
  type: string;
  properties?: Record<string, unknown>;
  sessionID?: string;
}

export type PluginEventDiagnosticCode =
  | 'declaration-invalid'
  | 'unregistered-event'
  | 'canonical-event'
  | 'foreign-namespace'
  | 'invalid-namespace'
  | 'schema-invalid'
  | 'invalid-properties'
  | 'missing-session'
  | 'unloaded'
  | 'stale-emitter'
  | 'broadcast-failed'
  | 'payload-too-large';

export interface PluginEventDiagnostic {
  packageName: string;
  type?: string;
  code: PluginEventDiagnosticCode;
  message: string;
  at: string;
  /** Deduplicated occurrences of the same `package:type:code` drop. */
  count: number;
}

export interface PluginEmitResult {
  ok: boolean;
  /** Diagnostic code of the drop; absent on success. */
  error?: PluginEventDiagnosticCode;
  message?: string;
}

export interface PluginEventRegisterOptions {
  /** Committed revision token this registration belongs to. */
  revision?: string;
  /**
   * Activation identity captured by `ctx.emit`. An emit carrying a token that
   * is no longer the package's current registration is dropped.
   */
  token?: object;
}

export interface PluginEventRegistryOptions {
  /** Canonical runtime vocabulary; never registrable or emittable by a package. */
  canonicalTypes?: ReadonlySet<string>;
  /** Gateway broadcast sink (SSE + WS + mobile push). */
  broadcast?: (event: PluginEventFrame) => void;
  /** Receives every drop diagnostic; defaults to `log.warn`. */
  onDiagnostic?: (diagnostic: PluginEventDiagnostic) => void;
  /** Distinct diagnostic keys retained (default 100). */
  maxDiagnostics?: number;
}

interface RegisteredEvent {
  declaration: PluginEventDeclaration;
  validate?: ValidateFunction;
}

interface PackageEvents {
  revision: string;
  token: object;
  events: Map<string, RegisteredEvent>;
}

const PACKAGE_NAME_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;
const EVENT_SEGMENT_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;
const EMPTY_CANONICAL: ReadonlySet<string> = new Set();

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function describeError(err: unknown): string {
  if (err instanceof Error) return err.message || err.name;
  return String(err);
}

function nonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

function jsonByteSize(value: unknown): number | null {
  try {
    const text = JSON.stringify(value);
    if (text === undefined) return null;
    return Buffer.byteLength(text, 'utf8');
  } catch {
    return null;
  }
}

export class PluginEventRegistry {
  private readonly packages = new Map<string, PackageEvents>();
  private readonly diagnostics = new Map<string, PluginEventDiagnostic>();
  private readonly canonicalTypes: ReadonlySet<string>;
  private readonly broadcast?: (event: PluginEventFrame) => void;
  private readonly onDiagnostic?: (diagnostic: PluginEventDiagnostic) => void;
  private readonly maxDiagnostics: number;

  constructor(options: PluginEventRegistryOptions = {}) {
    this.canonicalTypes = options.canonicalTypes ?? EMPTY_CANONICAL;
    this.broadcast = options.broadcast;
    this.onDiagnostic = options.onDiagnostic;
    this.maxDiagnostics = options.maxDiagnostics ?? 100;
  }

  /** Replaces the event set of `packageName` for one committed revision. */
  register(
    packageName: string,
    declarations: readonly ActivatedEvent[],
    bag: RegistrationBag,
    options: PluginEventRegisterOptions = {},
  ): PluginEventDiagnostic[] {
    const diagnostics: PluginEventDiagnostic[] = [];
    if (typeof packageName !== 'string' || !PACKAGE_NAME_PATTERN.test(packageName)) {
      diagnostics.push(this.record({
        packageName: String(packageName),
        code: 'declaration-invalid',
        message: `package name "${String(packageName)}" is not registrable`,
      }));
      return diagnostics;
    }

    const prefix = `plugin:${packageName}:`;
    if (!Array.isArray(declarations)) {
      diagnostics.push(this.record({
        packageName,
        code: 'declaration-invalid',
        message: `events of package "${packageName}" must be an array`,
      }));
      return diagnostics;
    }
    const ajv = new Ajv2020({ strict: false, validateFormats: false, allErrors: false });
    const events = new Map<string, RegisteredEvent>();

    for (const activated of declarations) {
      const declaration = activated?.declaration;
      const type = declaration?.type;
      if (!declaration || typeof type !== 'string' || type.length === 0) {
        diagnostics.push(this.record({
          packageName,
          code: 'declaration-invalid',
          message: `event declaration for package "${packageName}" has no usable type`,
        }));
        continue;
      }
      const rejected = this.namespaceProblem(prefix, type);
      if (rejected) {
        diagnostics.push(this.record({
          packageName,
          type,
          code: 'declaration-invalid',
          message: rejected.message,
        }));
        continue;
      }
      if (declaration.scope !== undefined && declaration.scope !== 'global' && declaration.scope !== 'session') {
        diagnostics.push(this.record({
          packageName,
          type,
          code: 'declaration-invalid',
          message: `event "${type}" scope must be "global" or "session"`,
        }));
        continue;
      }
      let validate: ValidateFunction | undefined;
      if (declaration.schema !== undefined) {
        const errors = validatePluginSchema(`event "${type}" schema`, declaration.schema);
        if (errors.length > 0) {
          diagnostics.push(this.record({
            packageName,
            type,
            code: 'declaration-invalid',
            message: errors.join('; '),
          }));
          continue;
        }
        try {
          validate = ajv.compile(declaration.schema);
        } catch (err) {
          diagnostics.push(this.record({
            packageName,
            type,
            code: 'declaration-invalid',
            message: `event "${type}" schema is not compilable: ${describeError(err)}`,
          }));
          continue;
        }
      }
      events.set(type, { declaration, validate });
    }

    const record: PackageEvents = {
      revision: options.revision ?? '',
      token: options.token ?? {},
      events,
    };
    this.packages.set(packageName, record);
    bag.add(`plugin-events:${packageName}`, () => this.retire(packageName, record));
    return diagnostics;
  }

  /** Committed revision token of the registration (diagnostics/tests). */
  revisionOf(packageName: string): string | undefined {
    return this.packages.get(packageName)?.revision;
  }

  /** True when the package currently has `type` registered. */
  has(packageName: string, type: string): boolean {
    return this.packages.get(packageName)?.events.has(type) === true;
  }

  getDiagnostics(): readonly PluginEventDiagnostic[] {
    return [...this.diagnostics.values()];
  }

  /** Raw `ctx.emit` entry point; the token ties the call to one activation. */
  emitFrom(packageName: string, token: object, event: PluginEmitEvent): PluginEmitResult {
    if (!event || typeof event.type !== 'string') {
      return this.drop(packageName, undefined, 'invalid-namespace', 'ctx.emit requires a string event type');
    }
    const { type, properties, sessionID, ...rest } = event;
    // `properties` is the neutral envelope; bare extra keys stay supported for
    // packages written against the older flat ctx.emit shape.
    const payload = properties !== undefined ? properties : rest;
    return this.emit(packageName, type, payload, sessionID, token);
  }

  /**
   * Emits one registered event.
   *
   * @param properties `event.properties` — validated against the declaration
   *   schema and published inside the neutral envelope.
   * @param sessionID Explicit session envelope; falls back to
   *   `properties.sessionID`. Required for `scope:"session"` events.
   */
  emit(
    packageName: string,
    type: string,
    properties?: unknown,
    sessionID?: string,
    token?: object,
  ): PluginEmitResult {
    const record = this.packages.get(packageName);
    if (!record) {
      return this.drop(packageName, type, 'unloaded', `plugin package "${packageName}" is not active`);
    }
    if (typeof type !== 'string' || type.length === 0) {
      return this.drop(packageName, undefined, 'invalid-namespace', 'event type must be a non-empty string');
    }
    if (token !== undefined && record.token !== token) {
      return this.drop(packageName, type, 'stale-emitter', `plugin package "${packageName}" emitted from a superseded activation`);
    }
    if (this.canonicalTypes.has(type)) {
      return this.drop(packageName, type, 'canonical-event', `canonical event "${type}" cannot be emitted by a plugin package`);
    }
    const prefix = `plugin:${packageName}:`;
    if (!type.startsWith(prefix)) {
      const code = type.startsWith('plugin:') ? 'foreign-namespace' : 'invalid-namespace';
      return this.drop(
        packageName,
        type,
        code,
        code === 'foreign-namespace'
          ? `event "${type}" does not belong to package "${packageName}"`
          : `event "${type}" must use the plugin:<package>: namespace`,
      );
    }
    const registered = record.events.get(type);
    if (!registered) {
      return this.drop(packageName, type, 'unregistered-event', `event "${type}" is not registered by "${packageName}"`);
    }
    if (properties !== undefined && !isPlainObject(properties)) {
      return this.drop(packageName, type, 'invalid-properties', `event "${type}" properties must be a plain object`);
    }
    const payload: Record<string, unknown> = properties ?? {};
    const size = jsonByteSize(payload);
    if (size === null) {
      return this.drop(packageName, type, 'invalid-properties', `event "${type}" properties must be JSON-serializable`);
    }
    if (size > PLUGIN_UI_LIMITS.maxActionPayloadBytes) {
      return this.drop(
        packageName,
        type,
        'payload-too-large',
        `event "${type}" properties exceed ${PLUGIN_UI_LIMITS.maxActionPayloadBytes} bytes`,
      );
    }
    if (registered.validate && !registered.validate(payload)) {
      return this.drop(packageName, type, 'schema-invalid', `event "${type}" properties do not match its schema`);
    }

    const resolvedSession = nonEmptyString(sessionID)
      ? sessionID
      : nonEmptyString(payload.sessionID) ? payload.sessionID : undefined;
    if (registered.declaration.scope === 'session' && resolvedSession === undefined) {
      return this.drop(packageName, type, 'missing-session', `session-scoped event "${type}" requires a sessionID`);
    }

    const frame: PluginEventFrame = { type, properties: payload };
    if (resolvedSession !== undefined) frame.sessionID = resolvedSession;
    try {
      this.broadcast?.(frame);
    } catch (err) {
      return this.drop(packageName, type, 'broadcast-failed', `broadcast failed: ${describeError(err)}`);
    }
    return { ok: true };
  }

  private namespaceProblem(prefix: string, type: string): Error | null {
    if (this.canonicalTypes.has(type)) {
      return new Error(`canonical event "${type}" cannot be registered by a plugin package`);
    }
    if (!type.startsWith(prefix)) {
      return new Error(
        type.startsWith('plugin:')
          ? `event "${type}" belongs to another package (expected prefix "${prefix}")`
          : `event "${type}" must use the ${prefix}* namespace`,
      );
    }
    if (!EVENT_SEGMENT_PATTERN.test(type.slice(prefix.length))) {
      return new Error(`event "${type}" must end with a non-empty event name`);
    }
    return null;
  }

  private retire(packageName: string, record: PackageEvents): void {
    if (this.packages.get(packageName) === record) this.packages.delete(packageName);
  }

  private drop(
    packageName: string,
    type: string | undefined,
    code: PluginEventDiagnosticCode,
    message: string,
  ): PluginEmitResult {
    this.record({ packageName, type, code, message });
    return { ok: false, error: code, message };
  }

  private record(diagnostic: Omit<PluginEventDiagnostic, 'at' | 'count'>): PluginEventDiagnostic {
    const key = `${diagnostic.packageName}:${diagnostic.type ?? ''}:${diagnostic.code}`;
    const existing = this.diagnostics.get(key);
    const entry: PluginEventDiagnostic = existing
      ? { ...existing, message: diagnostic.message, at: new Date().toISOString(), count: existing.count + 1 }
      : { ...diagnostic, at: new Date().toISOString(), count: 1 };
    if (!existing && this.diagnostics.size >= this.maxDiagnostics) {
      const oldest = this.diagnostics.keys().next();
      if (!oldest.done) this.diagnostics.delete(oldest.value);
    }
    this.diagnostics.set(key, entry);
    try {
      this.onDiagnostic?.(entry);
    } catch {
      /* diagnostics must never break emission */
    }
    return entry;
  }
}
