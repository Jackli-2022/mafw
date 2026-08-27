import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { GatewayDatabase } from '../../src/memory/gateway-db';

describe('Goal outcomes', () => {
  let db: GatewayDatabase;
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'goal-outcomes-'));
    db = new GatewayDatabase(path.join(tmpDir, 'test.db'));
  });

  afterEach(() => {
    db.close();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  test('upsertGoalOutcome inserts and updates', () => {
    const outcome = {
      goal_id: 'g1',
      project_id: 'proj1',
      verdict: 'PASS',
      rounds: 2,
      duration_ms: 5000,
      tokens_input: 1000,
      tokens_output: 500,
      total_cost: 0.01,
      tool_error_count: 0,
      thumbs_up: 1,
      thumbs_down: 0,
      policy_version: 'builtin-v1',
      evolution_proposal_id: null,
      failure_kind: null,
      failure_signature: null,
      created_at: '2026-08-27T00:00:00Z',
      archived_at: '2026-08-27T01:00:00Z',
    };
    db.upsertGoalOutcome(outcome);
    const rows = db.listGoalOutcomes({});
    expect(rows).toHaveLength(1);
    expect(rows[0].goal_id).toBe('g1');
    expect(rows[0].verdict).toBe('PASS');

    // Upsert updates
    db.upsertGoalOutcome({ ...outcome, verdict: 'FAIL', rounds: 3 });
    const rows2 = db.listGoalOutcomes({});
    expect(rows2).toHaveLength(1);
    expect(rows2[0].verdict).toBe('FAIL');
    expect(rows2[0].rounds).toBe(3);
  });

  test('listGoalOutcomes filters by policy and verdict', () => {
    db.upsertGoalOutcome({
      goal_id: 'g1', project_id: 'p1', verdict: 'PASS', rounds: 1,
      duration_ms: null, tokens_input: null, tokens_output: null, total_cost: null,
      tool_error_count: null, thumbs_up: 0, thumbs_down: 0,
      policy_version: 'v1', evolution_proposal_id: null,
      failure_kind: null, failure_signature: null, created_at: null, archived_at: '2026-08-27T00:00:00Z',
    });
    db.upsertGoalOutcome({
      goal_id: 'g2', project_id: 'p1', verdict: 'FAIL', rounds: 2,
      duration_ms: null, tokens_input: null, tokens_output: null, total_cost: null,
      tool_error_count: null, thumbs_up: 0, thumbs_down: 0,
      policy_version: 'v2', evolution_proposal_id: null,
      failure_kind: 'exec_error', failure_signature: null, created_at: null, archived_at: '2026-08-27T00:00:00Z',
    });
    expect(db.listGoalOutcomes({ policy: 'v1' })).toHaveLength(1);
    expect(db.listGoalOutcomes({ verdict: 'FAIL' })).toHaveLength(1);
    expect(db.listGoalOutcomes({ project: 'p1' })).toHaveLength(2);
  });

  test('addGoalSession and listGoalSessions', () => {
    db.addGoalSession({ goal_id: 'g1', session_id: 's1', phase: 'plan', loop: 1 });
    db.addGoalSession({ goal_id: 'g1', session_id: 's2', phase: 'execute', loop: 1 });
    const sessions = db.listGoalSessions('g1');
    expect(sessions).toHaveLength(2);
    expect(sessions.map(s => s.session_id).sort()).toEqual(['s1', 's2']);

    // Duplicate insert ignored
    db.addGoalSession({ goal_id: 'g1', session_id: 's1', phase: 'plan', loop: 1 });
    expect(db.listGoalSessions('g1')).toHaveLength(2);
  });
});
