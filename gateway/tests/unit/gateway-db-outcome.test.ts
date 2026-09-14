import { GatewayDatabase } from '../../src/memory/gateway-db';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

describe('GatewayDatabase.getOutcomeForSession', () => {
  let dir: string;
  let db: GatewayDatabase;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gwdb-'));
    db = new GatewayDatabase(path.join(dir, 'test.db'));
  });

  afterEach(() => {
    db.close();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  function outcome(over: Record<string, any> = {}): any {
    return {
      goal_id: 'g1',
      project_id: 'p',
      verdict: 'FAILED',
      rounds: 2,
      duration_ms: 1000,
      tokens_input: 10,
      tokens_output: 20,
      total_cost: 0.1,
      tool_error_count: 1,
      thumbs_up: 0,
      thumbs_down: 2,
      policy_version: 'builtin-v1',
      evolution_proposal_id: null,
      failure_kind: 'test_failure',
      failure_signature: null,
      created_at: '2026-09-01T00:00:00Z',
      archived_at: '2026-09-02T00:00:00Z',
      ...over,
    };
  }

  it('returns the outcome for a goal the session participated in', () => {
    db.upsertGoalOutcome(outcome());
    db.addGoalSession({ goal_id: 'g1', session_id: 's1', phase: 'execute', loop: 1 });
    const o = db.getOutcomeForSession('s1');
    expect(o?.goal_id).toBe('g1');
    expect(o?.verdict).toBe('FAILED');
    expect(o?.thumbs_down).toBe(2);
  });

  it('returns null for an unknown session', () => {
    expect(db.getOutcomeForSession('nope')).toBeNull();
  });

  it('returns the most recently archived outcome when the session joined several goals', () => {
    db.upsertGoalOutcome(outcome({ goal_id: 'g1', archived_at: '2026-09-02T00:00:00Z' }));
    db.upsertGoalOutcome(
      outcome({ goal_id: 'g2', verdict: 'COMPLETED', archived_at: '2026-09-10T00:00:00Z' }),
    );
    db.addGoalSession({ goal_id: 'g1', session_id: 's1', phase: 'execute', loop: 1 });
    db.addGoalSession({ goal_id: 'g2', session_id: 's1', phase: 'execute', loop: 2 });
    expect(db.getOutcomeForSession('s1')?.goal_id).toBe('g2');
  });

  it('ignores goal_sessions that have no outcome row yet', () => {
    db.addGoalSession({ goal_id: 'ghost', session_id: 's1', phase: 'plan', loop: 1 });
    expect(db.getOutcomeForSession('s1')).toBeNull();
  });
});
