/**
 * Pure inventory projection for the plugin hub (`GET /api/plugins`).
 *
 * `PluginHost.getState()` only knows packages it scanned; disabled packages are
 * skipped by the scanner and therefore disappear from host state. The manager's
 * persisted disabled names are the only record left for them, so the Hub view
 * merges the two sources:
 *
 * - active / error / pending rows come from host state unchanged (revisions,
 *   diagnostics, contribution kinds);
 * - a disabled name overrides an active row (and drops its contributions, since
 *   a disabled package contributes nothing);
 * - disabled names without host state get a synthesized row so the UI can
 *   re-enable or remove them.
 *
 * Kept free of gateway state so the merge rules are directly testable.
 */
import type { PackageState } from './package-types';

/** One row of the Hub package inventory. */
export interface PackageInventoryEntry extends Omit<PackageState, 'status'> {
  status: PackageState['status'] | 'disabled';
  enabled: boolean;
}

/**
 * Merges host package state with manager-persisted disabled names.
 *
 * The result is sorted by name (locale-independent `localeCompare` matches the
 * host's own `getState()` ordering contract). Inputs are never mutated.
 */
export function mergePackageInventory(
  states: readonly PackageState[],
  disabledNames: Iterable<string>,
): PackageInventoryEntry[] {
  const disabled = new Set(disabledNames);
  const out = new Map<string, PackageInventoryEntry>();
  for (const state of states) {
    const isDisabled = disabled.has(state.name);
    out.set(state.name, {
      ...state,
      status: isDisabled ? 'disabled' : state.status,
      enabled: !isDisabled,
      contributions: isDisabled ? [] : state.contributions,
    });
  }
  for (const name of disabled) {
    if (out.has(name)) continue;
    out.set(name, { name, source: '', status: 'disabled', enabled: false, contributions: [] });
  }
  return [...out.values()].sort((a, b) => a.name.localeCompare(b.name));
}
