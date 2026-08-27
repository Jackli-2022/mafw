import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { GatewayDatabase } from '../../src/memory/gateway-db';
import { recordGoalOutcome, inferFailureKind, buildFailureSignature } from '../../src/orchestration/outcome-recorder';

describe('outcome-recorder', () => {
  let db: GatewayDatabase;
  let tmpDir: string;
  let mafwDir: string;
  let projectDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'outcome-rec-'));
    db = new GatewayDatabase(path.join(tmpDir, 'test.db'));
    projectDir = tmpDir;
    mafwDir = path.join(tmpDir, '.mafw');
    fs.mkdirSync(path.join(mafwDir, 'state'), { recursive: true });
    fs.mkdirSync(path.join(mafwDir, 'requests'), { recursive: true });
  });

  afterEach(() => {
    db.close();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  test('inferFailureKind returns correct kinds', () => {
    expect(inferFailureKind({ verdict: 'PASS', lastError: null })).toBeNull();
    expect(inferFailureKind({ verdict: 'CANCELLED', lastError: null })).toBe('user_cancel');
    expect(inferFailureKind({ verdict: 'MAX_RETRIES', lastError: null })).toBe('max_retries');
    expect(inferFailureKind({ verdict: 'FAIL', lastError: 'waves.json not found' })).toBe('bad_plan');
    expect(inferFailureKind({ verdict: 'FAIL', lastError: 'archive_failed' })).toBe('archive_error');
    expect(inferFailureKind({ verdict: 'FAIL', lastError: 'some other error' })).toBe('exec_error');
  });

  test('buildFailureSignature normalizes text', () => {
    const sig = buildFailureSignature('exec_error', 'Error at /path/to/file.ts:123 with id abc12345');
    expect(sig).toBe('exec_error:Error at path to file ts N with id');
  });

  test('recordGoalOutcome aggregates trajectory and feedback', () => {
    fs.writeFileSync(
      path.join(mafwDir, 'state', 'g1.json'),
      JSON.stringify({ policySnapshot: { version: 'v1', proposalId: null } }),
      'utf-8'
    );
    fs.writeFileSync(
      path.join(mafwDir, 'requests', 'g1.json'),
      JSON.stringify({ createdAt: '2026-08-27T00:00:00Z' }),
      'utf-8'
    );
    db.addGoalSession({ goal_id: 'g1', session_id: 's1', phase: 'plan', loop: 1 });
    const rawDb = (db as any).db;
    rawDb.prepare(`
      INSERT INTO trajectory_turns (project_id, session_id, turn_id, turn_start_ms, turn_end_ms, duration_ms,
        tool_count, tool_error_count, reasoning_count, agent_switch_count, tokens, cost, finish, model, provider, agent, user_text)
      VALUES ('proj1', 's1', 1, 0, 100, 100, 0, 2, 0, 0, '{"input":100,"output":50,"reasoning":0,"cache":{"read":0,"write":0}}', 0.01, 'stop', 'm', 'p', 'a', 'hi')
    `).run();

    fs.mkdirSync(path.join(projectDir, '.mafw', 'feedback'), { recursive: true });
    fs.writeFileSync(
      path.join(projectDir, '.mafw', 'feedback', 't1-123.json'),
      JSON.stringify({ goalId: 'g1', type: 'thumbs_up' }),
      'utf-8'
    );

    recordGoalOutcome(db, {
      goalId: 'g1',
      verdict: 'PASS',
      rounds: 2,
      projectDir,
      mafwDir,
      projectId: 'proj1',
    });

    const outcomes = db.listGoalOutcomes({});
    expect(outcomes).toHaveLength(1);
    expect(outcomes[0].verdict).toBe('PASS');
    expect(outcomes[0].policy_version).toBe('v1');
    expect(outcomes[0].tokens_input).toBe(100);
    expect(outcomes[0].total_cost).toBe(0.01);
    expect(outcomes[0].tool_error_count).toBe(2);
    expect(outcomes[0].thumbs_up).toBe(1);
  });

  test('recordGoalOutcome fail-open on error', () => {
    expect(() => {
      recordGoalOutcome(db, {
        goalId: 'g1',
        verdict: 'PASS',
        rounds: 1,
        projectDir,
        mafwDir,
        projectId: 'proj1',
      });
    }).not.toThrow();
  });
});
