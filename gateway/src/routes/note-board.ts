import { HarmonicUnit } from '../core/memory/harmonic-types';

export interface NoteBoardDeps {
  getIndex(): { entries: any[] };
  readUnit(id: string): Promise<HarmonicUnit | null>;
}

export { NOTE_BOARD_BUDGET } from '../recall/inject-format';

/**
 * Scan the harmonic index for sticky (not expired, not superseded) entries,
 * sort soonest-expiry first, load full memory values, and render the note
 * board. Malformed sticky_until fails open (stays on board, sorted last) —
 * mirroring mem0's expiration semantics. Board membership expires, the
 * memory itself never does. `now` is injectable for tests.
 */
export async function handleNoteBoard(deps: NoteBoardDeps, now: Date = new Date()): Promise<{
  board: string | null;
  entries: Array<Pick<HarmonicUnit, 'id' | 'type' | 'primary_abstraction' | 'memory_value' | 'energy' | 'created_at' | 'sticky_until'>>;
  budget: { max: number; maxChars: number; used: number };
}> {
  const { formatNoteBoard, NOTE_BOARD_BUDGET } = require('../recall/inject-format');

  const active: Array<{ entry: any; untilMs: number }> = [];
  for (const e of deps.getIndex().entries) {
    if (!e.sticky_until || e.superseded_by) continue;
    const ms = new Date(e.sticky_until).getTime();
    if (Number.isNaN(ms)) {
      active.push({ entry: e, untilMs: Number.POSITIVE_INFINITY }); // fail-open, sort last
    } else if (ms > now.getTime()) {
      active.push({ entry: e, untilMs: ms });
    }
  }
  active.sort((a, b) => a.untilMs - b.untilMs);

  const units: HarmonicUnit[] = [];
  for (const { entry } of active) {
    const u = await deps.readUnit(entry.id);
    // The index entry is authoritative for board membership; fall back to its
    // sticky_until when the OKF frontmatter predates the field.
    if (u) units.push(u.sticky_until ? u : { ...u, sticky_until: entry.sticky_until });
  }

  const { board, used } = formatNoteBoard(units, now);
  if (units.length > used) {
    console.log(`[Recall] note-board overflow: ${units.length - used} entries dropped`);
  }

  const entries = units.slice(0, used).map(u => ({
    id: u.id,
    type: u.type,
    primary_abstraction: u.primary_abstraction,
    memory_value: u.memory_value,
    energy: u.energy,
    created_at: u.created_at,
    sticky_until: u.sticky_until,
  }));

  return { board, entries, budget: { max: NOTE_BOARD_BUDGET.max, maxChars: NOTE_BOARD_BUDGET.maxChars, used } };
}
