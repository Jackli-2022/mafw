import * as fs from 'fs';
import { makeHarness, seedGoal } from './helpers/goal-driver-harness';
import { recoverGoals, watchdogScan } from '../../src/core/goal/recovery';
import { nodeArtifactPaths } from '../../src/core/goal/node-prompts';

const settle = async () => { await new Promise((r) => setImmediate(r)); await new Promise((r) => setImmediate(r)); };

describe('恢复语义（spec §6：产物优先 → 会话探测 → 重试）', () => {
  it('重启时产物已出现 → 兑现为完成（不浪费已完成工作）', async () => {
    const h = makeHarness();
    seedGoal(h, 'g1', { patch: {
      nextNode: 'plan',
      nodeSession: { id: 'ses_dead', phase: 'plan', startedAt: 't', attempt: 1, runId: 1 },
    } });
    const a = nodeArtifactPaths(h.mafwDir, 'g1', 1);
    fs.writeFileSync(a.waves, JSON.stringify({ waves: [], status: 'ready' }), 'utf-8');

    await recoverGoals({ driver: h.driver, states: [{ goalId: 'g1', mafwDir: h.mafwDir }] });
    await settle();
    const st = h.load('g1')!;
    expect(st.nextNode).toBe('execute'); // plan 已兑现并推进
    expect(st.nodeSession?.phase).toBe('execute'); // 链式启动 execute
  });

  it('无产物 + 会话死 → 节点重试（attempt+1，新会话）', async () => {
    const h = makeHarness();
    seedGoal(h, 'g1', { patch: {
      nextNode: 'plan',
      nodeSession: { id: 'ses_dead', phase: 'plan', startedAt: new Date().toISOString(), attempt: 1, runId: 1 },
    } });
    await recoverGoals({
      driver: h.driver, states: [{ goalId: 'g1', mafwDir: h.mafwDir }],
      probeSession: async () => 'dead',
    });
    await settle();
    const st = h.load('g1')!;
    expect(st.nodeSession).not.toBeNull();
    expect(st.nodeSession!.attempt).toBe(2);
    expect(st.nodeSession!.id).not.toBe('ses_dead');
  });

  it('无产物 + attempt 已达上限 → archive_fail', async () => {
    const h = makeHarness();
    seedGoal(h, 'g1', { patch: {
      nextNode: 'plan',
      nodeSession: { id: 'ses_dead', phase: 'plan', startedAt: 't', attempt: 2, runId: 1 },
    } });
    await recoverGoals({
      driver: h.driver, states: [{ goalId: 'g1', mafwDir: h.mafwDir }],
      probeSession: async () => 'dead',
    });
    await settle();
    expect(h.load('g1')!.nextAction).toBe('FAILED');
  });

  it('无 probeSession（能力门降级）→ 视为 dead 重试', async () => {
    const h = makeHarness();
    seedGoal(h, 'g1', { patch: {
      nextNode: 'plan',
      nodeSession: { id: 'ses_dead', phase: 'plan', startedAt: 't', attempt: 1, runId: 1 },
    } });
    await recoverGoals({ driver: h.driver, states: [{ goalId: 'g1', mafwDir: h.mafwDir }] });
    await settle();
    expect(h.load('g1')!.nodeSession!.attempt).toBe(2);
  });

  it('watchdog：startedAt 超时 → abort + 重试', async () => {
    const h = makeHarness({ nodeTimeoutMs: 1 });
    seedGoal(h, 'g1', { patch: {
      nextNode: 'plan',
      nodeSession: { id: 'ses_slow', phase: 'plan', startedAt: new Date(Date.now() - 60_000).toISOString(), attempt: 1, runId: 1 },
    } });
    await watchdogScan({ driver: h.driver, states: [{ goalId: 'g1', mafwDir: h.mafwDir }], now: Date.now(), timeoutMs: 30_000 });
    await settle();
    expect(h.calls.some((c) => c.op === 'abort' && c.sid === 'ses_slow')).toBe(true);
    expect(h.load('g1')!.nodeSession!.attempt).toBe(2);
  });

  it('无 nodeSession 的非终态 → 直接 advance', async () => {
    const h = makeHarness();
    seedGoal(h, 'g1', { patch: { nextNode: 'execute', wavePlanPath: 'x' } });
    await recoverGoals({ driver: h.driver, states: [{ goalId: 'g1', mafwDir: h.mafwDir }] });
    await settle();
    expect(h.load('g1')!.nodeSession?.phase).toBe('execute');
  });
});
