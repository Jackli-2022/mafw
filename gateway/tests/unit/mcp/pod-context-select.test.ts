// gateway/tests/unit/mcp/pod-context-select.test.ts
// Task 17：只有绑定项目的 Lead 能扩展 Goal 的上下文选择。
//
// 不变量：
// - 阶段基线由代码自动纳入，Lead 不需要（也不能）漏选；
// - Lead 只能选「可选补充 / 跨 Goal 引用」，且跨 Goal 必须过 Goal request 的 allowlist；
// - 缺失、敏感、越界的引用一律拒绝（fail-closed），不写选择文件；
// - Tech Lead / Builder / Reviewer 不能扩大自己的上下文。
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  PodContextSelectionService,
  createPodGoalContextTool,
  handlePodGoalContext,
} from '../../../src/mcp/handlers/pod-context-select';
import { DEFINITIONS, createToolRegistry } from '../../../src/mcp/tool-registry';

const NOW = '2026-11-03T00:00:00.000Z';

interface Fixture {
  mafwDir: string;
  goalDir: string;
  store: any;
  service: PodContextSelectionService;
}

function makeFixture(opts: { request?: Record<string, unknown>; activeRevision?: number } = {}): Fixture {
  const mafwDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mafw-ctx-select-'));
  const goalDir = path.join(mafwDir, 'goals', 'g1');
  fs.mkdirSync(path.join(goalDir, 'notes'), { recursive: true });
  fs.writeFileSync(path.join(goalDir, 'goal.md'), '# goal g1', 'utf-8');
  fs.writeFileSync(
    path.join(goalDir, 'request.json'),
    JSON.stringify({ title: 'g1', ...(opts.request ?? {}) }),
    'utf-8',
  );
  fs.writeFileSync(path.join(goalDir, 'direction.json'), JSON.stringify({ decisions: [] }), 'utf-8');
  fs.writeFileSync(path.join(goalDir, 'notes', 'design.md'), '# design', 'utf-8');
  fs.writeFileSync(path.join(mafwDir, 'waves.json'), JSON.stringify({ waves: [] }), 'utf-8');
  fs.writeFileSync(path.join(goalDir, 'goal-eval.json'), JSON.stringify({ conditions: [] }), 'utf-8');
  const revDir = path.join(mafwDir, 'revisions', 'g1', 'rev-2');
  fs.mkdirSync(revDir, { recursive: true });
  fs.writeFileSync(path.join(revDir, 'waves.json'), JSON.stringify({ waves: [] }), 'utf-8');
  fs.writeFileSync(path.join(revDir, 'goal-eval.json'), JSON.stringify({ conditions: [] }), 'utf-8');

  const activeRevision = opts.activeRevision ?? 2;
  const revisions = new Map<number, any>([
    [1, { podId: 'pod_1', goalId: 'g1', revision: 1, status: 'completed' }],
    [2, { podId: 'pod_1', goalId: 'g1', revision: 2, status: 'discussing' }],
  ]);
  const members = new Map<string, any>([
    ['ses_lead', { id: 'mem_lead', podId: 'pod_1', role: 'lead' }],
    ['ses_tl', { id: 'mem_tl', podId: 'pod_1', role: 'tech_lead' }],
    ['ses_builder', { id: 'mem_b', podId: 'pod_1', role: 'builder' }],
    ['ses_reviewer', { id: 'mem_r', podId: 'pod_1', role: 'reviewer' }],
    ['ses_other_lead', { id: 'mem_lead2', podId: 'pod_2', role: 'lead' }],
  ]);
  const store: any = {
    getGoalByGoalId: (goalId: string) => (
      goalId === 'g1'
        ? { id: 'podgoal_g1', podId: 'pod_1', goalId: 'g1', activeRevision }
        : null
    ),
    getGoalRevision: (podId: string, goalId: string, revision: number) => (
      podId === 'pod_1' && goalId === 'g1' ? revisions.get(revision) ?? null : null
    ),
    getPod: (podId: string) => (
      podId === 'pod_1'
        ? { id: 'pod_1', projectDir: mafwDir, status: 'active' }
        : null
    ),
    getMemberBySession: (sessionId: string) => members.get(sessionId) ?? null,
  };

  const service = new PodContextSelectionService({
    store,
    resolveMafwDir: (goalId: string) => (goalId === 'g1' ? mafwDir : null),
    now: () => NOW,
  });

  return { mafwDir, goalDir, store, service };
}

function selectionFile(goalDir: string): any {
  const target = path.join(goalDir, 'context-selection.json');
  return fs.existsSync(target) ? JSON.parse(fs.readFileSync(target, 'utf-8')) : null;
}

describe('PodContextSelectionService', () => {
  test('only the bound project Lead may change the Goal context', async () => {
    const f = makeFixture();

    for (const sessionID of ['ses_tl', 'ses_builder', 'ses_reviewer', 'ses_other_lead', '', 'ses_unknown']) {
      await expect(
        f.service.select({ goalId: 'g1', revision: 2, refs: [{ path: 'notes/design.md' }] }, sessionID),
      ).rejects.toMatchObject({ status: 403 });
    }
    expect(selectionFile(f.goalDir)).toBeNull();
  });

  test('the Lead adds an optional in-Goal ref and the manifest path/hash are persisted', async () => {
    const f = makeFixture();

    const result = await f.service.select(
      { goalId: 'g1', revision: 2, refs: [{ path: 'notes/design.md', label: 'design notes' }] },
      'ses_lead',
    );

    expect(result.revision).toBe(2);
    expect(result.block).toContain('[CONTEXT MANIFEST]');
    expect(result.block).toContain('g1/notes/design.md');
    // 阶段基线仍然自动纳入（Lead 不能漏选）。
    expect(result.block).toContain('goal.md');
    expect(result.block).toContain('request.json');
    expect(result.manifestHash).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(fs.readFileSync(result.manifestPath, 'utf-8')).toBe(result.block);

    const stored = selectionFile(f.goalDir);
    expect(stored.revisions['2'].refs).toEqual([
      expect.objectContaining({ path: 'notes/design.md', label: 'design notes' }),
    ]);
    expect(stored.revisions['2'].updatedBy).toBe('ses_lead');
    expect(stored.revisions['2'].manifest).toMatchObject({
      path: result.manifestPath,
      hash: result.manifestHash,
      stage: 'discussing',
    });
  });

  test('cross-Goal refs are rejected unless the Goal request allowlists them', async () => {
    const f = makeFixture();
    const otherGoalDir = path.join(f.mafwDir, 'goals', 'other-goal');
    fs.mkdirSync(otherGoalDir, { recursive: true });
    fs.writeFileSync(path.join(otherGoalDir, 'private-discussion.md'), 'secret', 'utf-8');

    await expect(
      f.service.select(
        { goalId: 'g1', revision: 2, refs: [{ path: 'other-goal/private-discussion.md' }] },
        'ses_lead',
      ),
    ).rejects.toThrow('cross-goal reference not allowed');
    expect(selectionFile(f.goalDir)).toBeNull();

    // 显式 allowlist（Goal request 声明）后同一条引用才允许进入。
    const allowed = makeFixture({ request: { contextAllowlist: ['other-goal/private-discussion.md'] } });
    fs.mkdirSync(path.join(allowed.mafwDir, 'goals', 'other-goal'), { recursive: true });
    fs.writeFileSync(
      path.join(allowed.mafwDir, 'goals', 'other-goal', 'private-discussion.md'),
      'shared conclusion',
      'utf-8',
    );
    const result = await allowed.service.select(
      { goalId: 'g1', revision: 2, add: [{ path: 'other-goal/private-discussion.md' }] },
      'ses_lead',
    );
    expect(result.block).toContain('other-goal/private-discussion.md');
  });

  test('a Lead-selected cross-Goal ref stays out of prompts that did not select it', async () => {
    const f = makeFixture({ request: { contextAllowlist: ['other-goal'] } });
    fs.mkdirSync(path.join(f.mafwDir, 'goals', 'other-goal'), { recursive: true });
    fs.writeFileSync(
      path.join(f.mafwDir, 'goals', 'other-goal', 'plan.md'),
      'other goal plan',
      'utf-8',
    );

    const block = await f.service.renderForNode({ goalId: 'g1', node: 'execute', revision: 2 });
    expect(block).toContain('goal.md');
    expect(block).not.toContain('other-goal/plan.md');

    await f.service.select(
      { goalId: 'g1', revision: 2, add: [{ path: 'other-goal/plan.md' }] },
      'ses_lead',
    );
    const widened = await f.service.renderForNode({ goalId: 'g1', node: 'execute', revision: 2 });
    expect(widened).toContain('other-goal/plan.md');
    expect(widened).toContain('Cross-goal (explicitly allowed)');
  });

  test('sensitive refs are rejected before anything is written', async () => {
    const f = makeFixture();
    fs.writeFileSync(path.join(f.goalDir, '.env'), 'TOKEN=1', 'utf-8');
    fs.mkdirSync(path.join(f.goalDir, 'secrets'), { recursive: true });
    fs.writeFileSync(path.join(f.goalDir, 'secrets', 'token.json'), '{}', 'utf-8');
    fs.mkdirSync(path.join(f.goalDir, 'keys'), { recursive: true });
    fs.writeFileSync(path.join(f.goalDir, 'keys', 'id_rsa'), 'x', 'utf-8');

    for (const target of ['.env', 'secrets/token.json', 'keys/id_rsa']) {
      await expect(
        f.service.select({ goalId: 'g1', revision: 2, refs: [{ path: target }] }, 'ses_lead'),
      ).rejects.toThrow(/sensitive context reference rejected/);
    }
    expect(selectionFile(f.goalDir)).toBeNull();
  });

  test('missing or escaping refs are rejected', async () => {
    const f = makeFixture();

    await expect(
      f.service.select({ goalId: 'g1', revision: 2, refs: [{ path: 'notes/missing.md' }] }, 'ses_lead'),
    ).rejects.toThrow('context reference not readable');
    await expect(
      f.service.select({ goalId: 'g1', revision: 2, refs: [{ path: '../escape.md' }] }, 'ses_lead'),
    ).rejects.toThrow(/escapes goal root/);
    expect(selectionFile(f.goalDir)).toBeNull();
  });

  test('refs can be removed and cleared by the Lead', async () => {
    const f = makeFixture();
    await f.service.select(
      { goalId: 'g1', revision: 2, refs: [{ path: 'notes/design.md' }] },
      'ses_lead',
    );

    const removed = await f.service.select(
      { goalId: 'g1', revision: 2, remove: ['g1/notes/design.md'] },
      'ses_lead',
    );
    expect(removed.manifest.optional).toEqual([]);
    expect(selectionFile(f.goalDir).revisions['2'].refs).toEqual([]);

    await f.service.select(
      { goalId: 'g1', revision: 2, add: [{ path: 'notes/design.md' }] },
      'ses_lead',
    );
    const cleared = await f.service.select({ goalId: 'g1', revision: 2, refs: [] }, 'ses_lead');
    expect(cleared.manifest.optional).toEqual([]);
  });

  test('cross-Goal goal ids are validated (no goals-root escape)', async () => {
    const f = makeFixture();
    // 目标文件确实存在（在 goals 根之外），只有 id 校验能挡住它。
    fs.writeFileSync(path.join(f.mafwDir, 'escape.md'), 'secret', 'utf-8');

    await expect(
      f.service.select(
        { goalId: 'g1', revision: 2, refs: [{ goalId: '../../escape', path: 'escape.md' }] },
        'ses_lead',
      ),
    ).rejects.toThrow(/goal id/);
    expect(selectionFile(f.goalDir)).toBeNull();

    // allowlist 本身也不能携带不安全的 goal id。
    const badAllowlist = makeFixture({ request: { contextAllowlist: ['../../escape'] } });
    await expect(
      badAllowlist.service.select(
        { goalId: 'g1', revision: 2, refs: [{ path: 'notes/design.md', scope: 'goal' }] },
        'ses_lead',
      ),
    ).rejects.toThrow(/goal id/);
    expect(selectionFile(badAllowlist.goalDir)).toBeNull();
  });

  test('only the active, non-terminal revision can be widened', async () => {
    const f = makeFixture();
    // revision 1 已完成（历史 revision 不可改写）。
    await expect(
      f.service.select({ goalId: 'g1', revision: 1, refs: [{ path: 'notes/design.md' }] }, 'ses_lead'),
    ).rejects.toMatchObject({ status: 409 });
    // 显式 revision 与活动 revision 不一致。
    await expect(
      f.service.select({ goalId: 'g1', revision: 3, refs: [{ path: 'notes/design.md' }] }, 'ses_lead'),
    ).rejects.toMatchObject({ status: 409 });
  });

  test('unknown goals are 404 and missing workspaces are 400', async () => {
    const f = makeFixture();
    await expect(
      f.service.select({ goalId: 'ghost', refs: [] }, 'ses_lead'),
    ).rejects.toMatchObject({ status: 404 });

    const broken = new PodContextSelectionService({
      store: f.store,
      resolveMafwDir: () => null,
      now: () => NOW,
    });
    await expect(
      broken.select({ goalId: 'g1', refs: [] }, 'ses_lead'),
    ).rejects.toMatchObject({ status: 400 });
  });
});

describe('mafw_pod_goal_context tool', () => {
  test('returns the rendered manifest and selected display paths', async () => {
    const f = makeFixture();
    const tool = createPodGoalContextTool(f.service);

    const result: any = await tool.execute(
      { goalId: 'g1', add: [{ path: 'notes/design.md' }] },
      { sessionID: 'ses_lead' },
    );

    expect(result.structuredContent).toMatchObject({
      success: true,
      goalId: 'g1',
      revision: 2,
      optional: ['g1/notes/design.md'],
      crossGoal: [],
    });
    expect(result.structuredContent.manifestHash).toMatch(/^sha256:/);
    expect(result.structuredContent.block).toContain('[CONTEXT MANIFEST]');
  });

  test('surfaces cross-Goal rejection to the caller', async () => {
    const f = makeFixture();
    fs.mkdirSync(path.join(f.mafwDir, 'goals', 'other-goal'), { recursive: true });
    fs.writeFileSync(
      path.join(f.mafwDir, 'goals', 'other-goal', 'private-discussion.md'),
      'secret',
      'utf-8',
    );
    const tool = createPodGoalContextTool(f.service);

    await expect(
      tool.execute(
        { goalId: 'g1', revision: 2, refs: [{ path: 'other-goal/private-discussion.md' }] },
        { sessionID: 'ses_lead' },
      ),
    ).rejects.toThrow('cross-goal reference not allowed');
  });

  test('the MCP handler degrades to 503 when the service is not wired', async () => {
    const result: any = await handlePodGoalContext({ goalId: 'g1' }, {} as any);
    expect(result.isError).toBe(true);
    expect(result.structuredContent).toMatchObject({ success: false, status: 503 });
  });

  test('the registry exposes mafw_pod_goal_context', () => {
    expect(DEFINITIONS.some((def) => def.name === 'mafw_pod_goal_context')).toBe(true);
    const registry = createToolRegistry();
    expect(typeof registry.handlers.mafw_pod_goal_context).toBe('function');
  });
});
