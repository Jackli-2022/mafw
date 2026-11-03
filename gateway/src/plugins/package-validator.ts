/**
 * Unified plugin contribution validation.
 *
 * Runs after `activate()` resolves and before anything is published (loader
 * callbacks, action/event registries, client snapshot). The Host trusts its own
 * code but never trusts what a package *declares*: events must live in the
 * package's own `plugin:<package>:*` namespace, actions must carry callable
 * handlers, UI must only reference declared actions/events, and every JSON
 * Schema must be a self-contained 2020-12 document (no remote `$ref`, no code
 * evaluation).
 *
 * Diagnostics are returned as a list of human-readable strings instead of
 * throwing per field, so the PluginHost can record all problems of a candidate
 * in one pass and keep the previously committed revision.
 */
import Ajv2020 from 'ajv/dist/2020';
import {
  PLUGIN_UI_LIMITS,
  validateClientDescriptor,
  type PluginActionDescriptor,
  type PluginClientDescriptor,
  type PluginEventDescriptor,
  type PluginJsonSchema,
  type PluginUiContribution,
} from '@mafw/plugin-contract';
import type {
  ActivatedContributions,
  PluginActionDeclaration,
  PluginEventDeclaration,
  PluginContributions,
  UnifiedPluginContributions,
} from './package-types';
const NAME_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;
const EVENT_SEGMENT_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

const ACTION_DECLARATION_KEYS = [
  'title',
  'description',
  'inputSchema',
  'outputSchema',
  'timeoutMs',
  'handler',
] as const;
const EVENT_DECLARATION_KEYS = [
  'type',
  'title',
  'description',
  'schema',
  'payloadSchema',
  'scope',
] as const;

const FORBIDDEN_KEY_NAMES = new Set(['__proto__', 'prototype', 'constructor']);

/** Draft 2020-12 is the only accepted dialect (`$schema` may add a trailing `#`). */
const SUPPORTED_SCHEMA_DIALECT = 'https://json-schema.org/draft/2020-12/schema';

/** Placeholder identity used only to reuse the shared descriptor validator. */
const DESCRIPTOR_VERSION_PLACEHOLDER = '0.0.0';
const DESCRIPTOR_REVISION_PLACEHOLDER = 'staging';

type PlainObject = Record<string, unknown>;

/**
 * Compiles one schema with a throwaway Ajv instance.
 *
 * Validation must be side-effect free across packages: a shared Ajv would
 * reject a second package whose `$id` happens to collide with an earlier one
 * ("schema with key or id already exists"), which is a registry problem for
 * Task 4 to own per package, not a validity problem here.
 */
function compileSchema(schema: PluginJsonSchema): void {
  const instance = new Ajv2020({ strict: false, validateFormats: false, allErrors: false });
  instance.compile(schema);
}

function isPlainObject(value: unknown): value is PlainObject {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function describeError(err: unknown): string {
  if (err instanceof Error) return err.message;
  return String(err);
}

function jsonByteLength(value: unknown): number | null {
  try {
    return Buffer.byteLength(JSON.stringify(value), 'utf8');
  } catch {
    return null;
  }
}

function checkKnownFields(
  value: PlainObject,
  allowed: readonly string[],
  label: string,
  errors: string[],
): void {
  for (const key of Object.keys(value)) {
    if (!allowed.includes(key)) errors.push(`${label} has unknown field "${key}"`);
  }
}

/**
 * Walks the schema looking for constructs that would let a package pull in
 * external logic: non-local `$ref` and any `$schema` other than 2020-12.
 */
function collectSchemaProblems(value: unknown, pointer: string, problems: string[]): void {
  if (Array.isArray(value)) {
    value.forEach((item, index) => collectSchemaProblems(item, `${pointer}/${index}`, problems));
    return;
  }
  if (!isPlainObject(value)) return;

  for (const [key, child] of Object.entries(value)) {
    if (key === '$ref' && typeof child === 'string' && !child.startsWith('#')) {
      problems.push(`remote $ref "${child}" is not allowed (${pointer}/$ref)`);
      continue;
    }
    if (key === '$schema' && typeof child === 'string') {
      const normalized = child.endsWith('#') ? child.slice(0, -1) : child;
      if (normalized !== SUPPORTED_SCHEMA_DIALECT) {
        problems.push(
          `$schema "${child}" is not supported; plugin schemas must use JSON Schema 2020-12 (${pointer}/$schema)`,
        );
      }
      continue;
    }
    collectSchemaProblems(child, `${pointer}/${key}`, problems);
  }
}

/**
 * Validates one plugin JSON Schema: self-contained object, within the action
 * payload budget, 2020-12 only, no remote `$ref`, and compilable by Ajv.
 *
 * Exported for Task 4, which reuses the same rules when compiling action and
 * event schemas per revision.
 */
export function validatePluginSchema(label: string, schema: unknown): string[] {
  const errors: string[] = [];
  if (!isPlainObject(schema)) {
    errors.push(`${label} must be a JSON Schema object`);
    return errors;
  }
  const size = jsonByteLength(schema);
  if (size === null) {
    errors.push(`${label} must be JSON-serializable`);
    return errors;
  }
  if (size > PLUGIN_UI_LIMITS.maxActionPayloadBytes) {
    errors.push(`${label} exceeds ${PLUGIN_UI_LIMITS.maxActionPayloadBytes} bytes`);
    return errors;
  }

  const problems: string[] = [];
  collectSchemaProblems(schema, '#', problems);
  for (const problem of problems) errors.push(`${label} ${problem}`);
  if (errors.length > 0) return errors;

  try {
    compileSchema(schema as PluginJsonSchema);
  } catch (err) {
    errors.push(`${label} is not a valid JSON Schema: ${describeError(err)}`);
  }
  return errors;
}

interface CollectedActions {
  declarations: Record<string, PluginActionDeclaration>;
  /** Raw descriptor projection handed to the shared contract validator. */
  descriptors: Array<Record<string, unknown>>;
}

function collectActions(value: unknown, errors: string[]): CollectedActions {
  const out: CollectedActions = { declarations: {}, descriptors: [] };
  if (value === undefined) return out;
  if (!isPlainObject(value)) {
    errors.push('actions must be an object mapping action name to declaration');
    return out;
  }

  for (const [name, raw] of Object.entries(value)) {
    const label = `action "${name}"`;
    if (name.length === 0 || name.length > 128 || !NAME_PATTERN.test(name)) {
      errors.push(`${label} name must not contain ":" or whitespace`);
      continue;
    }
    if (FORBIDDEN_KEY_NAMES.has(name)) {
      errors.push(`${label} name is not allowed`);
      continue;
    }
    if (!isPlainObject(raw)) {
      errors.push(`${label} declaration must be an object`);
      continue;
    }
    checkKnownFields(raw, ACTION_DECLARATION_KEYS, label, errors);
    if (typeof raw.handler !== 'function') {
      errors.push(`${label} handler must be a function`);
      continue;
    }
    if (raw.inputSchema !== undefined) {
      errors.push(...validatePluginSchema(`${label} inputSchema`, raw.inputSchema));
    }
    if (raw.outputSchema !== undefined) {
      errors.push(...validatePluginSchema(`${label} outputSchema`, raw.outputSchema));
    }
    if (raw.timeoutMs !== undefined) {
      const timeout = raw.timeoutMs;
      if (typeof timeout !== 'number' || !Number.isInteger(timeout) || timeout <= 0) {
        errors.push(`${label} timeoutMs must be a positive integer`);
      } else if (timeout > PLUGIN_UI_LIMITS.maxActionTimeoutMs) {
        errors.push(
          `${label} timeoutMs exceeds the maximum of ${PLUGIN_UI_LIMITS.maxActionTimeoutMs}ms`,
        );
      }
    }

    const declaration: PluginActionDeclaration = {
      handler: raw.handler as PluginActionDeclaration['handler'],
    };
    if (raw.title !== undefined) declaration.title = raw.title as string;
    if (raw.description !== undefined) declaration.description = raw.description as string;
    if (raw.inputSchema !== undefined) declaration.inputSchema = raw.inputSchema as PluginJsonSchema;
    if (raw.outputSchema !== undefined) declaration.outputSchema = raw.outputSchema as PluginJsonSchema;
    if (raw.timeoutMs !== undefined) declaration.timeoutMs = raw.timeoutMs as number;

    out.declarations[name] = declaration;
    const descriptor: Record<string, unknown> = { name };
    for (const key of ['title', 'description', 'inputSchema', 'outputSchema', 'timeoutMs'] as const) {
      if (declaration[key] !== undefined) descriptor[key] = declaration[key];
    }
    out.descriptors.push(descriptor);
  }
  return out;
}

interface CollectedEvents {
  declarations: PluginEventDeclaration[];
  descriptors: Array<Record<string, unknown>>;
}

function collectEvents(
  packageName: string,
  value: unknown,
  canonicalTypes: ReadonlySet<string>,
  errors: string[],
): CollectedEvents {
  const out: CollectedEvents = { declarations: [], descriptors: [] };
  if (value === undefined) return out;
  if (!Array.isArray(value)) {
    errors.push('events must be an array of event declarations');
    return out;
  }

  const prefix = `plugin:${packageName}:`;
  const seen = new Set<string>();
  value.forEach((raw, index) => {
    const label = `events[${index}]`;
    if (!isPlainObject(raw)) {
      errors.push(`${label} must be an object`);
      return;
    }
    checkKnownFields(raw, EVENT_DECLARATION_KEYS, label, errors);
    const type = raw.type;
    if (typeof type !== 'string' || type.trim().length === 0) {
      errors.push(`${label}.type must be a non-empty string`);
      return;
    }
    if (canonicalTypes.has(type)) {
      errors.push(
        `event type "${type}" is a canonical runtime event and cannot be registered by a plugin package`,
      );
      return;
    }
    if (!type.startsWith(prefix)) {
      if (type.startsWith('plugin:')) {
        errors.push(`event type "${type}" belongs to another package (expected prefix "${prefix}")`);
      } else {
        errors.push(`event type "${type}" must use the plugin:<package>: namespace (expected "${prefix}")`);
      }
      return;
    }
    if (!EVENT_SEGMENT_PATTERN.test(type.slice(prefix.length))) {
      errors.push(`event type "${type}" must end with a non-empty event name`);
      return;
    }
    if (seen.has(type)) {
      errors.push(`duplicate event type "${type}"`);
      return;
    }
    seen.add(type);

    if (raw.schema !== undefined && raw.payloadSchema !== undefined) {
      errors.push(`event "${type}" declares both schema and payloadSchema; use schema only`);
      return;
    }
    const schema = raw.schema ?? raw.payloadSchema;
    if (schema !== undefined) {
      errors.push(...validatePluginSchema(`event "${type}" schema`, schema));
    }
    const scope = raw.scope;
    const validScope = scope === 'global' || scope === 'session';
    if (scope !== undefined && !validScope) {
      errors.push(`event "${type}" scope must be "global" or "session"`);
    }

    const declaration: PluginEventDeclaration = { type };
    if (raw.title !== undefined) declaration.title = raw.title as string;
    if (raw.description !== undefined) declaration.description = raw.description as string;
    if (schema !== undefined) declaration.schema = schema as PluginJsonSchema;
    // Invalid scopes are reported above and never carried into the declaration,
    // so the shared contract cannot duplicate the same diagnostic.
    if (validScope) declaration.scope = scope as PluginEventDeclaration['scope'];

    out.declarations.push(declaration);
    const descriptor: Record<string, unknown> = { type };
    for (const key of ['title', 'description'] as const) {
      if (declaration[key] !== undefined) descriptor[key] = declaration[key];
    }
    if (declaration.schema !== undefined) descriptor.schema = declaration.schema;
    // Scope is part of the client descriptor contract (§15.3): preserve the
    // declaration instead of dropping it in the Host-only declaration.
    if (declaration.scope !== undefined) descriptor.scope = declaration.scope;
    out.descriptors.push(descriptor);
  });
  return out;
}

interface Analysis {
  errors: string[];
  ui: PluginUiContribution;
  actions: CollectedActions;
  events: CollectedEvents;
  /** Present only when the shared contract accepted the projection. */
  descriptor?: PluginClientDescriptor;
}

function analyze(
  packageName: string,
  contributions: UnifiedPluginContributions,
  canonicalTypes: ReadonlySet<string>,
): Analysis {
  const errors: string[] = [];
  if (typeof packageName !== 'string' || !NAME_PATTERN.test(packageName)) {
    return {
      errors: [`package name "${String(packageName)}" must match ${NAME_PATTERN}`],
      ui: {},
      actions: { declarations: {}, descriptors: [] },
      events: { declarations: [], descriptors: [] },
    };
  }
  if (!isPlainObject(contributions)) {
    return {
      errors: ['contributions must be an object'],
      ui: {},
      actions: { declarations: {}, descriptors: [] },
      events: { declarations: [], descriptors: [] },
    };
  }

  const actions = collectActions(contributions.actions, errors);
  const events = collectEvents(packageName, contributions.events, canonicalTypes, errors);

  // Delegate cross-reference, id, size and config-form-subset validation to the
  // shared contract so gateway and Desktop cannot drift.
  const descriptorInput = {
    name: packageName,
    version: DESCRIPTOR_VERSION_PLACEHOLDER,
    revision: DESCRIPTOR_REVISION_PLACEHOLDER,
    ui: contributions.ui ?? {},
    actions: actions.descriptors,
    events: events.descriptors,
  };
  const validated = validateClientDescriptor(descriptorInput);
  if (!validated.ok) {
    errors.push(validated.error);
    return { errors, ui: {}, actions, events };
  }
  return { errors, ui: validated.value.ui, actions, events, descriptor: validated.value };
}

/**
 * Validates the declarative half of an `activate()` result.
 *
 * @param canonicalTypes Runtime canonical event vocabulary — any name in this
 *   set is rejected even if a package tries to claim it inside its namespace.
 * @returns Human-readable diagnostics; empty array means the contribution set
 *   is publishable.
 */
export function validateUnifiedContributions(
  packageName: string,
  contributions: UnifiedPluginContributions,
  canonicalTypes: ReadonlySet<string>,
): string[] {
  return analyze(packageName, contributions, canonicalTypes).errors;
}

export type BuildActivatedContributionsResult =
  | { ok: true; value: ActivatedContributions }
  | { ok: false; errors: string[] };

/**
 * Validation + projection for a candidate package.
 *
 * @returns `ok: true` with client-safe DTOs and Host declarations, or
 *   `ok: false` with every diagnostic collected in one pass.
 */
export function buildActivatedContributions(
  packageName: string,
  contributions: UnifiedPluginContributions,
  canonicalTypes: ReadonlySet<string>,
): BuildActivatedContributionsResult {
  const analysis = analyze(packageName, contributions, canonicalTypes);
  const { errors, ui, actions, events, descriptor } = analysis;
  if (errors.length > 0) return { ok: false, errors };
  if (!descriptor) {
    return { ok: false, errors: ['plugin descriptor could not be validated'] };
  }

  const descriptorByName = new Map<string, PluginActionDescriptor>(
    descriptor.actions.map((action) => [action.name, action]),
  );
  const descriptorByType = new Map<string, PluginEventDescriptor>(
    descriptor.events.map((event) => [event.type, event]),
  );

  const activatedActions = Object.entries(actions.declarations).flatMap(([name, declaration]) => {
    const actionDescriptor = descriptorByName.get(name);
    return actionDescriptor ? [{ name, descriptor: actionDescriptor, declaration }] : [];
  });
  const activatedEvents = events.declarations.flatMap((declaration) => {
    const eventDescriptor = descriptorByType.get(declaration.type);
    return eventDescriptor ? [{ descriptor: eventDescriptor, declaration }] : [];
  });

  const {
    actions: _actions,
    events: _events,
    ui: _ui,
    ...legacy
  } = contributions as UnifiedPluginContributions;

  return {
    ok: true,
    value: {
      ui,
      actions: activatedActions,
      events: activatedEvents,
      legacy: legacy as PluginContributions,
    },
  };
}
