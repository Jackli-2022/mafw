import { HarmonicUnit } from '../core/memory/harmonic-types';

export interface PinnedDeps {
  getIndex(): { entries: any[] };
  readUnit(id: string): Promise<HarmonicUnit | null>;
}

export { PINNED_BUDGET } from '../recall/inject-format';

/**
 * Scan the harmonic index for pinned (and not superseded) entries, sort by
 * energy × salience, load full memory values, and render the disclosure
 * profile. Overflow beyond the budget is logged here (formatter only counts).
 */
export async function handleRecallPinned(deps: PinnedDeps): Promise<{
  profile: string | null;
  entries: Array<Pick<HarmonicUnit, 'id' | 'type' | 'primary_abstraction' | 'memory_value' | 'energy' | 'salience' | 'created_at'>>;
  budget: { max: number; maxChars: number; used: number };
}> {
  const { formatPinnedProfile, PINNED_BUDGET } = require('../recall/inject-format');

  const pinned = deps.getIndex().entries.filter((e: any) => e.pinned && !e.superseded_by);
  pinned.sort((a: any, b: any) =>
    (b.energy ?? 0) * (b.salience ?? 1) - (a.energy ?? 0) * (a.salience ?? 1));

  const units: HarmonicUnit[] = [];
  for (const e of pinned) {
    const u = await deps.readUnit(e.id);
    if (u) units.push(u);
  }

  const { profile, used } = formatPinnedProfile(units);
  if (units.length > used) {
    console.log(`[Recall] pinned overflow: ${units.length - used} entries dropped`);
  }

  const entries = units.slice(0, used).map(u => ({
    id: u.id,
    type: u.type,
    primary_abstraction: u.primary_abstraction,
    memory_value: u.memory_value,
    energy: u.energy,
    salience: u.salience,
    created_at: u.created_at,
  }));

  return { profile, entries, budget: { max: PINNED_BUDGET.max, maxChars: PINNED_BUDGET.maxChars, used } };
}
