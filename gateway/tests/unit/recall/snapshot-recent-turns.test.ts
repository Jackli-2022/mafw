/**
 * Task 3: the snapshot rolling window must read active + archived turns.
 *
 * The pre-fix kernel closure used `listTurns()` + `readTurn()`, which only see
 * the hot `t1_observations` table. After extraction archived the older turns,
 * the window collapsed to the newest short instruction, so the snapshot query
 * lost the real conversational context. The helper below uses the durable turn
 * list (`listSessionTurns`) plus the active/archive row primitive
 * (`readTurnRows`).
 */
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { GatewayDatabase, ObservationSource } from '../../../src/memory/gateway-db';
import { recentTurnTextsFromDb } from '../../../src/recall/snapshot-builder';

/** The pre-fix hot-table-only closure, kept as the RED witness. */
function hotOnlyTurnTexts(db: GatewayDatabase, sessionID: string, maxTurns: number): string[] {
  const out: string[] = [];
  for (const turn of db.listTurns(sessionID).slice(-maxTurns)) {
    for (const obs of db.readTurn(sessionID, turn.turn_id)) {
      if (obs.source === 'user_input' || obs.source === 'assistant_reply') out.push(obs.content);
    }
  }
  return out;
}

interface TurnSpec {
  user?: string;
  assistant?: string;
  extra?: Array<{ source: ObservationSource; content: string }>;
}

describe('recentTurnTextsFromDb — snapshot window reads active + archive', () => {
  let dir: string;
  let db: GatewayDatabase;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 't1-snapshot-window-'));
    db = new GatewayDatabase(path.join(dir, 'test.db'));
  });
  afterEach(() => {
    db.close();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  function appendTurn(sessionID: string, spec: TurnSpec) {
    const turn = db.beginTurn(sessionID);
    const push = (source: ObservationSource, content: string) => {
      db.append({
        session_id: sessionID,
        turn_id: turn.turn_seq,
        trace_id: turn.trace_id,
        source,
        content,
        failure: 0,
      });
    };
    if (spec.user !== undefined) push('user_input', spec.user);
    if (spec.assistant !== undefined) push('assistant_reply', spec.assistant);
    for (const row of spec.extra ?? []) push(row.source, row.content);
    return turn;
  }

  test('archived turns stay in the window (last four logical turns, chronological)', () => {
    const turns = [
      appendTurn('s1', { user: 'q1', assistant: 'a1' }),
      appendTurn('s1', { user: 'q2', assistant: 'a2' }),
      appendTurn('s1', { user: 'q3', assistant: 'a3' }),
      appendTurn('s1', { user: 'q4', assistant: 'a4' }),
      appendTurn('s1', { user: '排查一下', assistant: '收到' }),
    ];
    // Old turns have been extracted; only the newest short instruction is hot.
    for (const turn of turns.slice(0, 4)) {
      expect(db.archiveTurn('s1', turn.turn_seq)).toBeGreaterThan(0);
    }
    expect(db.listTurns('s1').map((t) => t.turn_id)).toEqual([turns[4].turn_seq]);

    // RED witness: the old hot-only closure sees just the short instruction.
    expect(hotOnlyTurnTexts(db, 's1', 4)).toEqual(['排查一下', '收到']);

    // The window keeps the archived turns, oldest → newest.
    expect(recentTurnTextsFromDb(db, 's1', 4)).toEqual([
      'q2', 'a2', 'q3', 'a3', 'q4', 'a4', '排查一下', '收到',
    ]);
  });

  test('only user_input / assistant_reply rows are window texts', () => {
    appendTurn('s1', {
      user: 'please recall this',
      assistant: 'recalled',
      extra: [
        { source: 'tool_result', content: 'tool output' },
        { source: 'reasoning', content: 'private reasoning' },
      ],
    });
    appendTurn('s1', {
      extra: [
        { source: 'tool_result', content: 'orphan tool row' },
        { source: 'reasoning', content: 'orphan reasoning row' },
      ],
    });

    expect(recentTurnTextsFromDb(db, 's1', 10)).toEqual(['please recall this', 'recalled']);
  });

  test('a turn with no observations contributes nothing', () => {
    appendTurn('s1', { user: 'before empty', assistant: 'before reply' });
    db.beginTurn('s1'); // logical turn with no rows
    appendTurn('s1', { user: 'after empty', assistant: 'after reply' });

    expect(recentTurnTextsFromDb(db, 's1', 10)).toEqual([
      'before empty', 'before reply', 'after empty', 'after reply',
    ]);
  });

  test('ordering is stable across calls and across a later archive', () => {
    const first = appendTurn('s1', { user: 'first q', assistant: 'first a' });
    appendTurn('s1', { user: 'second q', assistant: 'second a' });
    const before = recentTurnTextsFromDb(db, 's1', 2);

    // Archiving must not reorder or drop anything in the window.
    db.archiveTurn('s1', first.turn_seq);
    expect(recentTurnTextsFromDb(db, 's1', 2)).toEqual(before);
    expect(recentTurnTextsFromDb(db, 's1', 2)).toEqual(before);
    expect(before).toEqual(['first q', 'first a', 'second q', 'second a']);
  });

  test('maxTurns selects the newest logical turns, not the newest rows', () => {
    appendTurn('s1', { user: 'old q', assistant: 'old a' });
    appendTurn('s1', { user: 'new q', assistant: 'new a', extra: [{ source: 'tool_result', content: 't' }] });

    expect(recentTurnTextsFromDb(db, 's1', 1)).toEqual(['new q', 'new a']);
    expect(recentTurnTextsFromDb(db, 's1', 5)).toEqual(['old q', 'old a', 'new q', 'new a']);
  });

  test('maxTurns=0 (and non-positive) returns an empty window', () => {
    appendTurn('s1', { user: 'q', assistant: 'a' });
    expect(recentTurnTextsFromDb(db, 's1', 0)).toEqual([]);
    expect(recentTurnTextsFromDb(db, 's1', -3)).toEqual([]);
  });

  test('unknown session returns an empty window', () => {
    expect(recentTurnTextsFromDb(db, 'ses_missing', 4)).toEqual([]);
  });

  test('accepts the documented read surface (turn_id alias on a stub db)', () => {
    const stub = {
      listSessionTurns: (_sessionID: string) => [{ turn_id: 1 }, { turn_id: 2 }],
      readTurnRows: (_sessionID: string, turnID: number) =>
        turnID === 1
          ? [
              { source: 'user_input', content: 'one q' },
              { source: 'assistant_reply', content: 'one a' },
            ]
          : [
              { source: 'tool_result', content: 'skipped' },
              { source: 'assistant_reply', content: 'two a' },
            ],
    };

    expect(recentTurnTextsFromDb(stub, 'ses_stub', 2)).toEqual(['one q', 'one a', 'two a']);
  });
});
