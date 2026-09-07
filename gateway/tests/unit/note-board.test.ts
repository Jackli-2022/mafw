import { handleNoteBoard, NOTE_BOARD_BUDGET } from '../../src/routes/note-board';
import { formatNoteBoard } from '../../src/recall/inject-format';

const NOW = new Date('2026-09-07T00:00:00Z');
const inDays = (n: number) => new Date(NOW.getTime() + n * 86400e3).toISOString();
const agoDays = (n: number) => new Date(NOW.getTime() - n * 86400e3).toISOString();

function entry(overrides: Record<string, any> = {}) {
  return {
    id: 'mem_a', type: 'semantic', energy: 0.8, salience: 0.5,
    sticky_until: inDays(5),
    ...overrides,
  };
}

function deps(entries: any[], units: Record<string, any> = {}) {
  return {
    getIndex: () => ({ entries }),
    readUnit: async (id: string) => units[id] ?? {
      id, type: 'semantic', primary_abstraction: id, memory_value: `内容:${id}`,
      energy: 0.8, salience: 0.5, created_at: '2026-09-01T00:00:00Z',
    },
  };
}

describe('handleNoteBoard', () => {
  test('active sticky on board; expired and superseded excluded', async () => {
    const result = await handleNoteBoard(deps([
      entry({ id: 'mem_active', sticky_until: inDays(5) }),
      entry({ id: 'mem_expired', sticky_until: agoDays(1) }),
      entry({ id: 'mem_superseded', sticky_until: inDays(5), superseded_by: 'mem_x' }),
      entry({ id: 'mem_plain', sticky_until: undefined }),
    ]), NOW);
    expect(result.entries.map((e: any) => e.id)).toEqual(['mem_active']);
    expect(result.board).toContain('<note-board>');
    expect(result.board).toContain('内容:mem_active');
    expect(result.board).not.toContain('mem_expired');
  });

  test('malformed sticky_until fails open (stays on board)', async () => {
    const result = await handleNoteBoard(deps([
      entry({ id: 'mem_bad', sticky_until: 'not-a-date' }),
    ]), NOW);
    expect(result.entries.map((e: any) => e.id)).toEqual(['mem_bad']);
  });

  test('sorts soonest-expiry first; malformed dates last', async () => {
    const result = await handleNoteBoard(deps([
      entry({ id: 'mem_late', sticky_until: inDays(9) }),
      entry({ id: 'mem_bad', sticky_until: 'garbage' }),
      entry({ id: 'mem_soon', sticky_until: inDays(1) }),
    ]), NOW);
    expect(result.entries.map((e: any) => e.id)).toEqual(['mem_soon', 'mem_late', 'mem_bad']);
  });

  test('char budget drops overflow and reports used count', async () => {
    const longText = '长'.repeat(200);
    const entries = Array.from({ length: 8 }, (_, i) => entry({ id: `mem_${i}`, sticky_until: inDays(i + 1) }));
    const units: Record<string, any> = {};
    for (const e of entries) units[e.id] = { id: e.id, type: 'semantic', primary_abstraction: e.id, memory_value: longText, energy: 0.8, created_at: '2026-09-01T00:00:00Z' };
    const result = await handleNoteBoard(deps(entries, units), NOW);
    expect(result.board).not.toBeNull();
    expect(result.board!.length).toBeLessThanOrEqual(NOTE_BOARD_BUDGET.maxChars + 200); // tag + header overhead
    expect(result.budget.used).toBeLessThan(8);
    expect(result.budget.used).toBeGreaterThan(0);
  });

  test('empty set → board null, used 0', async () => {
    const result = await handleNoteBoard(deps([]), NOW);
    expect(result.board).toBeNull();
    expect(result.budget).toEqual({ ...NOTE_BOARD_BUDGET, used: 0 });
  });
});

describe('formatNoteBoard', () => {
  test('renders date, text and days-left per line', () => {
    const { board, used } = formatNoteBoard([
      { id: 'mem_1', memory_value: '周五前交方案', sticky_until: inDays(3) } as any,
    ], NOW);
    expect(used).toBe(1);
    expect(board).toContain('<note-board>');
    expect(board).toContain('周五前交方案');
    expect(board).toContain('剩 3 天');
    expect(board).toContain('</note-board>');
  });

  test('empty entries → null board', () => {
    expect(formatNoteBoard([], NOW).board).toBeNull();
  });
});
