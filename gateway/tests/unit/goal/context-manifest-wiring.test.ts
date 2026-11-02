// gateway/tests/unit/goal/context-manifest-wiring.test.ts
// Task 17：每个节点/探针 prompt 都先带确定性的 ContextManifest。
//
// 不变量：
// - 阶段基线（goal.md/request.json/...）由代码自动纳入，Lead 不能漏选；
// - 只有 Lead 显式选入的可选/跨 Goal 引用才出现，其它 Goal 的讨论绝不进入；
// - manifest 在最前，`[POD HANDOFF]` 与 Pod 记忆在其后、节点任务正文之前；
// - 清单文件与 hash 落盘（恢复时复用同一份内容）。
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { makeHarness, seedGoal, Harness } from '../helpers/goal-driver-harness';
import { renderNodePrompt, type NodePromptCtx } from '../../../src/core/goal/node-prompts';
import { validateProbeRequest } from '../../../src/core/goal/probe';
import { PodContextSelectionService } from '../../../src/mcp/handlers/pod-context-select';

const NOW = '2026-11-03T00:00:00.000Z';

interface Fixture {
  mafwDir: string;
  goalDir: string;
  store: any;
  service: PodContextSelectionService;
}

function makeFixture(opts: { request?: Record<string, unknown>; activeRevision?: number } = {}): Fixture {
  const mafwDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mafw-ctx-wiring-'));
  const goalDir = path.join(mafwDir, 'goals', 'g1');
  fs.mkdirSync(path.join(goalDir, 'notes'), { recursive: true });
  fs.writeFileSync(path.join(goalDir, 'goal.md'), '# goal g1', 'utf-8');
  fs.writeFileSync(
    path.join(goalDir, 'request.json'),
    JSON.stringify({ title: 'g1', ...(opts.request ?? {}) }),
    'utf-8',
  );
  fs.writeFileSync(path.join(goalDir, 'notes', 'design.md'), '# design', 'utf-8');

  const activeRevision = opts.activeRevision ?? 2;
  const store: any = {
    getGoalByGoalId: () => ({ id: 'podgoal_g1', podId: 'pod_1', goalId: 'g1', activeRevision }),
    getGoalRevision: (_podId: string, _goalId: string, revision: number) => (
      revision === 2 || revision === 1
        ? { podId: 'pod_1', goalId: 'g1', revision, status: revision === 1 ? 'completed' : 'implementing' }
        : null
    ),
    getPod: () => ({ id: 'pod_1', projectDir: mafwDir, status: 'active' }),
    getMemberBySession: (sessionId: string) => (
      sessionId === 'ses_lead' ? { id: 'mem_lead', podId: 'pod_1', role: 'lead' } : null
    ),
  };
  const service = new PodContextSelectionService({
    store,
    resolveMafwDir: () => mafwDir,
    now: () => NOW,
  });
  return { mafwDir, goalDir, store, service };
}

function ctx(overrides: Partial<NodePromptCtx> = {}): NodePromptCtx {
  return {
    goalId: 'g1',
    projectDir: 'C:/p',
    mafwDir: 'C:/p/.mafw',
    round: 1,
    maxRounds: 3,
    charterPath: 'C:/p/.mafw/goals/g1/goal.md',
    requestPath: 'C:/p/.mafw/goals/g1/request.json',
    ...overrides,
  };
}

function promptTexts(h: Harness): string[] {
  return h.calls.filter((c: any) => c.op === 'promptAsync').map((c: any) => c.parts[0].text);
}

describe('ContextManifest assembly', () => {
  test('the manifest carries the stage baseline and only Lead-selected refs', async () => {
    const f = makeFixture({ request: { contextAllowlist: ['other-goal'] } });
    fs.mkdirSync(path.join(f.mafwDir, 'goals', 'other-goal'), { recursive: true });
    fs.writeFileSync(
      path.join(f.mafwDir, 'goals', 'other-goal', 'private-discussion.md'),
      'other goal private talk',
      'utf-8',
    );

    const block = await f.service.renderForNode({ goalId: 'g1', node: 'execute', revision: 2 });
    expect(block).toContain('[CONTEXT MANIFEST]');
    expect(block).toContain('goal.md');
    expect(block).toContain('request.json');
    expect(block).not.toContain('other-goal/private-discussion');

    await f.service.select(
      { goalId: 'g1', revision: 2, refs: [{ path: 'notes/design.md' }] },
      'ses_lead',
    );
    const widened = await f.service.renderForNode({ goalId: 'g1', node: 'execute', revision: 2 });
    expect(widened).toContain('g1/notes/design.md');
    expect(widened).not.toContain('other-goal/private-discussion');
  });

  test('the manifest path and hash are persisted next to the goal workspace', async () => {
    const f = makeFixture();
    const block = await f.service.renderForNode({ goalId: 'g1', node: 'plan', revision: 2 });

    const stored = JSON.parse(
      fs.readFileSync(path.join(f.goalDir, 'context-selection.json'), 'utf-8'),
    );
    const entry = stored.revisions['2'];
    expect(entry.manifest.stage).toBe('planning');
    expect(fs.readFileSync(entry.manifest.path, 'utf-8')).toBe(block);
    expect(entry.manifest.hash).toMatch(/^sha256:[0-9a-f]{64}$/);

    // 同一输入 → 同一渲染（恢复时可直接复用）。
    const again = await f.service.renderForNode({ goalId: 'g1', node: 'plan', revision: 2 });
    expect(again).toBe(block);
  });

  test('probe manifests use the probe baseline stage', async () => {
    const f = makeFixture();
    const block = await f.service.renderForNode({ goalId: 'g1', node: 'probe', revision: 2 });
    expect(block).toContain('stage: probe');
    expect(block).toContain('goal.md');
  });
});

describe('renderNodePrompt manifest placement', () => {
  const manifest = '[CONTEXT MANIFEST]\ngoal: g1\n- goal.md (baseline)';

  test.each(['plan', 'execute', 'review'] as const)('%s puts the manifest before its task section', (node) => {
    const prompt = renderNodePrompt(node, ctx({ manifestBlock: manifest }));
    expect(prompt.indexOf('[CONTEXT MANIFEST]')).toBe(0);
    expect(prompt.indexOf('[CONTEXT MANIFEST]')).toBeLessThan(prompt.indexOf('任务：'));
  });

  test('probe prompts carry the manifest too', () => {
    const request = validateProbeRequest({
      id: 'p1',
      podId: 'pod_1',
      goalId: 'g1',
      revision: 2,
      question: 'Does the store accept optional fields?',
      hypothesis: 'Yes',
      scope: { paths: ['src'], commandClasses: ['read'], network: false, credentials: [] },
      budget: { maxMinutes: 5, maxUsd: 1 },
      evidenceRequired: ['test output'],
      affects: {},
    });
    const prompt = renderNodePrompt('probe', ctx({
      manifestBlock: manifest,
      probe: { request, workspaceDir: 'C:/tmp/probe', reportPath: 'C:/tmp/probe/report.json' },
    }));
    expect(prompt.indexOf('[CONTEXT MANIFEST]')).toBe(0);
    expect(prompt.indexOf('[CONTEXT MANIFEST]')).toBeLessThan(prompt.indexOf('任务：'));
  });
});

describe('composition root wiring', () => {
  const source = fs.readFileSync(path.join(process.cwd(), 'src', 'index.ts'), 'utf-8');

  test('the driver receives contextBlock and MCP services expose the selection service', () => {
    expect(source).toContain('contextBlock: async (goalId: string');
    expect(source).toContain('this.podContextSelectionService.renderForNode');
    expect(source).toContain('podContextSelect: this.podContextSelectionService');
  });
});

describe('NodeDriver manifest injection', () => {
  function stubDeps(h: Harness, block: string | null | (() => Promise<string>)): void {
    h.deps.contextBlock = typeof block === 'function'
      ? block
      : async () => block;
  }

  test('the manifest leads the prompt and Pod handoff/memory follow it', async () => {
    const h = makeHarness();
    seedGoal(h, 'g1', { patch: { nextNode: 'execute' } });
    const calls: Array<[string, string, number]> = [];
    h.deps.contextBlock = async (goalId: string, node: any, revision: number) => {
      calls.push([goalId, node, revision]);
      return '[CONTEXT MANIFEST]\ngoal: g1\n- goal.md (baseline)';
    };
    h.deps.podContext = () => '[POD HANDOFF] builder task\n\n<pod-memory>rules</pod-memory>';

    await h.driver.advance('g1');

    expect(calls).toEqual([['g1', 'execute', 1]]);
    const prompt = promptTexts(h).at(-1)!;
    const manifestAt = prompt.indexOf('[CONTEXT MANIFEST]');
    const handoffAt = prompt.indexOf('[POD HANDOFF]');
    const taskAt = prompt.indexOf('任务：');
    expect(manifestAt).toBe(0);
    expect(handoffAt).toBeGreaterThan(manifestAt);
    expect(taskAt).toBeGreaterThan(handoffAt);
  });

  test('probe prompts are built from the same manifest contract', async () => {
    const h = makeHarness();
    seedGoal(h, 'g1', { patch: { nextNode: 'probe', probeQueue: ['p1'] } });
    const request = validateProbeRequest({
      id: 'p1',
      podId: 'pod_1',
      goalId: 'g1',
      revision: 1,
      question: 'Does the store accept optional fields?',
      hypothesis: 'Yes',
      scope: { paths: ['src'], commandClasses: ['read'], network: false, credentials: [] },
      budget: { maxMinutes: 5, maxUsd: 1 },
      evidenceRequired: ['test output'],
      affects: {},
    });
    const workspaceDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mafw-ctx-probe-'));
    h.deps.probes = {
      podIdForGoal: () => 'pod_1',
      enqueue: () => [],
      take: () => request,
      report: () => null,
      complete: () => { throw new Error('unused'); },
      failProbe: () => {},
      requeueProbe: () => {},
      reportPath: (goalId: string, probeId: string) => path.join(h.mafwDir, 'goals', goalId, 'probes', `${probeId}.report.json`),
      prepareWorkspace: async () => ({
        dir: workspaceDir,
        dispose: async () => fs.rmSync(workspaceDir, { recursive: true, force: true }),
      }),
      disposeWorkspace: async (ws: any) => { await ws.dispose(); },
      bindSession: () => {},
    };
    const calls: string[] = [];
    h.deps.contextBlock = async (_goalId: string, node: any) => {
      calls.push(node);
      return '[CONTEXT MANIFEST]\ngoal: g1\n- goal.md (baseline)';
    };

    await h.driver.advance('g1');

    expect(calls).toEqual(['probe']);
    const prompt = promptTexts(h).at(-1)!;
    expect(prompt.indexOf('[CONTEXT MANIFEST]')).toBe(0);
    expect(prompt).toContain(request.question);
  });

  test('a broken manifest fails the node closed instead of running without context', async () => {
    const h = makeHarness();
    seedGoal(h, 'g1', { patch: { nextNode: 'execute' } });
    h.deps.contextBlock = async () => {
      throw new Error('required context missing: g1/goal.md');
    };

    await h.driver.advance('g1');
    await new Promise((resolve) => setImmediate(resolve));
    await new Promise((resolve) => setImmediate(resolve));

    expect(promptTexts(h)).toHaveLength(0);
    const state = h.load('g1')!;
    expect(state.nextNode).toBe('archive_fail');
    expect(state.lastError).toContain('required context missing');
    expect(h.calls.some((c: any) => c.op === 'archiveGoal')).toBe(true);
  });
});
