/**
 * Client-safe projection of an activated plugin package.
 *
 * The Desktop receives only serializable data: identity, revision, the four
 * declarative UI slots and action/event metadata. Host declarations (handlers,
 * module references, `ctx`) never leave this process, and every descriptor is
 * an independent frozen copy so a published snapshot cannot be mutated by a
 * consumer or by later Host bookkeeping.
 */
import type { PluginClientDescriptor, PluginDiagnostic } from '@mafw/plugin-contract';
import type { ActivatedContributions } from './package-types';

/** One revision of the whole client-visible plugin surface. */
export interface PluginClientSnapshot {
  /** Opaque `<gatewayBootId>:<counter>` token. */
  revision: string;
  /** Active packages only; pending candidates are never projected. */
  plugins: PluginClientDescriptor[];
}

/** The part of an activation that may cross the process boundary. */
export type ClientContributions = Pick<ActivatedContributions, 'ui' | 'actions' | 'events'>;

export interface ClientDescriptorInput {
  name: string;
  /** Committed revision token of this package. */
  revision: string;
  /** Manifest version; defaults to `0.0.0` for packages without a manifest. */
  version?: string;
  activated: ClientContributions;
  title?: string;
  description?: string;
  /** Host diagnostics to surface next to the package (never functions). */
  diagnostics?: readonly PluginDiagnostic[];
}

function cloneJson<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function deepFreeze<T>(value: T): T {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value as Record<string, unknown>)) deepFreeze(child);
  }
  return value;
}

/**
 * Builds one immutable descriptor for a committed package.
 *
 * Anything the contract does not declare is dropped by the JSON clone (a
 * package cannot smuggle a function into the snapshot), and the copy is
 * detached from the Host declaration objects.
 */
export function buildClientDescriptor(input: ClientDescriptorInput): PluginClientDescriptor {
  const payload: Record<string, unknown> = {
    name: input.name,
    version: input.version ?? '0.0.0',
    revision: input.revision,
    ui: input.activated.ui,
    actions: input.activated.actions.map((action) => action.descriptor),
    events: input.activated.events.map((event) => event.descriptor),
  };
  if (input.title) payload.title = input.title;
  if (input.description) payload.description = input.description;
  if (input.diagnostics && input.diagnostics.length > 0) {
    payload.diagnostics = input.diagnostics.map((diagnostic) => ({ ...diagnostic }));
  }
  return deepFreeze(cloneJson(payload) as unknown as PluginClientDescriptor);
}

/**
 * Builds the immutable snapshot published after a commit.
 *
 * Packages are sorted by name so the payload is deterministic (Desktop diffs
 * by package name + revision, not by array position).
 */
export function buildClientSnapshot(
  revision: string,
  descriptors: readonly PluginClientDescriptor[],
): PluginClientSnapshot {
  const plugins = [...descriptors].sort((a, b) => a.name.localeCompare(b.name));
  return Object.freeze({
    revision,
    plugins: Object.freeze(plugins) as PluginClientDescriptor[],
  });
}
