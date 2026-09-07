# Manager Rotate-on-Demand + /btw + Goal Awareness Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 支持"开新话题"（rotate manager session）、`/btw` 一次性支线问答、manager 每轮 goal 快照注入与 goal 里程碑免回复推送（`noReply: true`），并修复 rotate 正确性直接依赖的既有 bug。

**Architecture:** Gateway 新增 rotate 路由（deps 注入可单测）+ goal 快照聚合挂进现有 `/api/recall/context` + 里程碑推送挂 `eventBus("phase_transition")` 与 `archiveGoal()`，推送用 opencode 现成的 `promptAsync(noReply: true)` 硬免回复。桌面端加"新话题"按钮 + 修 `handleNewGoal` fallback。三条失效的 `manager-report-*` 自动化规则退役。

**Tech Stack:** TypeScript (CJS, tsc build), jest (`--runInBand`), SolidJS desktop (`@opencode-ai/ui/v2`), gateway-sdk。

**Spec:** `docs/superpowers/specs/2026-09-03-manager-rotate-design.md`

## Global Constraints

- Gateway 测试命令：`npm test`（gateway/ 目录下，jest `--runInBand`）
- Gateway 构建：`npm run build`（gateway/ 目录下，含 tsc 类型检查）
- Desktop typecheck：`npm run typecheck`（opencode-dev/packages/desktop/ 下，tsgo）
- gateway-sdk 测试：`npx vitest run`（opencode-dev/packages/gateway-sdk/ 下）
- 桌面 UI 约定：禁止裸 `<button>`；用 `ButtonV2` / `TooltipV2`（`openDelay: 300`）/ `showToastV2`
- Gateway 侧 logger：`import { log } from '../core/utils/logger'`（或相对路径 `../utils/logger`），Error 用 `err.message`
- HTTP 路由正则：query string 兼容用 `(?:\?|$)` 锚定
- kv API：`GatewayDatabase.kvGet/kvSet/kvDelete/kvAll(scope, key?)`，已存在（gateway/src/memory/gateway-db.ts:409-434）
- 每个任务一个 commit；commit 前跑该任务的测试

---

### Task 1: SdkSessionResource.updateMetadata

**Files:**
- Modify: `gateway/src/resources/sdk-session.ts`（在 `registerExternal` 之后新增方法）
- Test: `gateway/tests/unit/sdk-session-update-metadata.test.ts`（新建）

**Interfaces:**
- Produces: `updateMetadata(id: string, metadata: Record<string, unknown>): Promise<SessionRecord | null>` — 整体替换 metadata 并落盘；未知 id 返回 null。Task 3 的 rotate 依赖它把旧 session 的 `metadata` 从 `{ mafw: { role: 'manager', pinned: true, ... } }` 降级为 `{ mafw: { role: 'manager-archived' } }`（替换整个 mafw 对象即移除 pinned/exempt 标记）。

- [ ] **Step 1: Write the failing test**

```ts
// gateway/tests/unit/sdk-session-update-metadata.test.ts
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { SdkSessionResource } from '../../src/resources/sdk-session';

describe('SdkSessionResource.updateMetadata', () => {
  let dir: string;
  let res: SdkSessionResource;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mafw-sdk-session-'));
    res = new SdkSessionResource(undefined, dir);
  });

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('replaces metadata and persists to disk', async () => {
    await res.registerExternal('ses_a', 'C:/proj', { mafw: { role: 'manager', pinned: true, exemptFromTrim: true } });
    const updated = await res.updateMetadata('ses_a', { mafw: { role: 'manager-archived' } });
    expect(updated?.metadata).toEqual({ mafw: { role: 'manager-archived' } });
    const onDisk = JSON.parse(fs.readFileSync(path.join(dir, 'ses_a.json'), 'utf-8'));
    expect(onDisk.metadata).toEqual({ mafw: { role: 'manager-archived' } });
  });

  it('returns null for unknown session', async () => {
    expect(await res.updateMetadata('ses_missing', { a: 1 })).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd gateway; npx jest tests/unit/sdk-session-update-metadata.test.ts --runInBand`
Expected: FAIL — `updateMetadata is not a function`（或 TypeScript 报方法不存在）

- [ ] **Step 3: Write minimal implementation**

在 `gateway/src/resources/sdk-session.ts` 的 `registerExternal` 方法后新增：

```ts
  /** Replace (not merge) a session's metadata and persist. Returns null if unknown. */
  async updateMetadata(id: string, metadata: Record<string, unknown>): Promise<SessionRecord | null> {
    const record = this.sessions.get(id);
    if (!record) return null;
    record.metadata = metadata;
    record.time.updated = Date.now();
    this.saveToDisk(record);
    return record;
  }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd gateway; npx jest tests/unit/sdk-session-update-metadata.test.ts --runInBand`
Expected: PASS（2 个用例）

- [ ] **Step 5: Commit**

```bash
git add gateway/src/resources/sdk-session.ts gateway/tests/unit/sdk-session-update-metadata.test.ts
git commit -m "feat(gateway): add SdkSessionResource.updateMetadata for session metadata replacement"
```

---

### Task 2: Goal 快照聚合 + recall/context 注入

**Files:**
- Create: `gateway/src/core/manager/goal-snapshot.ts`
- Test: `gateway/tests/unit/goal-snapshot.test.ts`（新建）
- Modify: `gateway/src/index.ts`（`/api/recall/context` handler，~4282-4322）

**Interfaces:**
- Produces: `buildGoalSnapshot(mafwDir: string, opts?: { maxGoals?: number }): string | null` — 读 `<mafwDir>/state/*.json`，过滤 `nextAction ∈ {COMPLETED, FAILED}` 的终结 goal，返回 `<goal-snapshot>...\n</goal-snapshot>` 块或 null。Task 3 无依赖；index.ts recall handler 调用。

- [ ] **Step 1: Write the failing test**

```ts
// gateway/tests/unit/goal-snapshot.test.ts
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { buildGoalSnapshot, collectActiveGoals } from '../../src/core/manager/goal-snapshot';

function writeState(mafwDir: string, goalId: string, state: Record<string, unknown>): void {
  fs.writeFileSync(path.join(mafwDir, 'state', `${goalId}.json`), JSON.stringify(state), 'utf-8');
}

describe('buildGoalSnapshot', () => {
  let mafwDir: string;

  beforeEach(() => {
    mafwDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mafw-snap-'));
    fs.mkdirSync(path.join(mafwDir, 'state'), { recursive: true });
  });

  afterEach(() => fs.rmSync(mafwDir, { recursive: true, force: true }));

  it('returns null when no state dir or no active goals', () => {
    expect(buildGoalSnapshot(path.join(mafwDir, 'nonexistent'))).toBeNull();
    expect(buildGoalSnapshot(mafwDir)).toBeNull();
  });

  it('renders active goals and skips terminal ones', () => {
    writeState(mafwDir, 'g1', { goalId: 'g1', title: 'T1', phase: 'EXECUTING', round: 2, nextAction: 'CONTINUE' });
    writeState(mafwDir, 'g2', { goalId: 'g2', title: 'T2', phase: 'ARCHIVED', round: 5, nextAction: 'COMPLETED' });
    const snap = buildGoalSnapshot(mafwDir)!;
    expect(snap).toContain('<goal-snapshot>');
    expect(snap).toContain('g1: T1 [phase=EXECUTING round=2]');
    expect(snap).not.toContain('g2');
    expect(snap).toContain('</goal-snapshot>');
  });

  it('marks pending question count', () => {
    writeState(mafwDir, 'g3', {
      goalId: 'g3', title: 'T3', phase: 'REVIEWING', round: 1, nextAction: 'ASK_USER',
      pendingQuestion: { questions: [{ q: 'a' }, { q: 'b' }] },
    });
    expect(buildGoalSnapshot(mafwDir)).toContain('pendingQ=2');
  });

  it('caps goals at maxGoals', () => {
    for (let i = 0; i < 15; i++) {
      writeState(mafwDir, `g${i}`, { goalId: `g${i}`, title: `T${i}`, phase: 'EXECUTING', round: 1, nextAction: 'CONTINUE' });
    }
    const snap = buildGoalSnapshot(mafwDir, { maxGoals: 10 })!;
    expect(collectActiveGoals(mafwDir).length).toBe(15);
    expect(snap.split('\n').length).toBe(12); // open tag + 10 lines + close tag
  });

  it('skips corrupt state files', () => {
    fs.writeFileSync(path.join(mafwDir, 'state', 'bad.json'), '{not json', 'utf-8');
    writeState(mafwDir, 'gok', { goalId: 'gok', title: 'T', phase: 'EXECUTING', round: 1, nextAction: 'CONTINUE' });
    expect(collectActiveGoals(mafwDir).map(g => g.goalId)).toEqual(['gok']);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd gateway; npx jest tests/unit/goal-snapshot.test.ts --runInBand`
Expected: FAIL — module not found

- [ ] **Step 3: Write minimal implementation**

```ts
// gateway/src/core/manager/goal-snapshot.ts
import * as fs from 'fs';
import * as path from 'path';

const TERMINAL_ACTIONS = new Set(['COMPLETED', 'FAILED']);

export interface GoalSnapshotEntry {
  goalId: string;
  title: string;
  phase: string;
  round: number;
  pendingQuestions: number;
}

export function collectActiveGoals(mafwDir: string): GoalSnapshotEntry[] {
  const stateDir = path.join(mafwDir, 'state');
  if (!fs.existsSync(stateDir)) return [];
  const entries: GoalSnapshotEntry[] = [];
  for (const file of fs.readdirSync(stateDir).filter(f => f.endsWith('.json'))) {
    try {
      const s = JSON.parse(fs.readFileSync(path.join(stateDir, file), 'utf-8'));
      if (TERMINAL_ACTIONS.has(s.nextAction)) continue;
      const pendingQ = s.pendingQuestion
        ? (Array.isArray(s.pendingQuestion.questions) ? s.pendingQuestion.questions.length : 1)
        : 0;
      entries.push({
        goalId: s.goalId || file.replace('.json', ''),
        title: s.title || s.goalId || file.replace('.json', ''),
        phase: s.phase || 'UNKNOWN',
        round: s.round ?? 0,
        pendingQuestions: pendingQ,
      });
    } catch { /* skip corrupt state */ }
  }
  return entries;
}

export function buildGoalSnapshot(mafwDir: string, opts?: { maxGoals?: number }): string | null {
  const maxGoals = opts?.maxGoals ?? 10;
  const goals = collectActiveGoals(mafwDir);
  if (goals.length === 0) return null;
  const lines = goals.slice(0, maxGoals).map(g =>
    `- ${g.goalId}: ${g.title} [phase=${g.phase} round=${g.round}${g.pendingQuestions > 0 ? ` pendingQ=${g.pendingQuestions}` : ''}]`,
  );
  return `<goal-snapshot>\n${lines.join('\n')}\n</goal-snapshot>`;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd gateway; npx jest tests/unit/goal-snapshot.test.ts --runInBand`
Expected: PASS（5 个用例）

- [ ] **Step 5: Wire into /api/recall/context（仅 manager session）**

修改 `gateway/src/index.ts` 的 `/api/recall/context` handler（4282-4322）。顶部（其他 import 附近）加：

```ts
import { buildGoalSnapshot } from './core/manager/goal-snapshot';
```

将 handler 内部改为（保留原查询逻辑，插入快照计算与拼接）：

```ts
        if (req.url?.startsWith('/api/recall/context') && req.method === 'GET') {
          try {
            const parsedUrl = new URL(req.url!, `http://${req.headers.host || 'localhost'}`);
            const query = parsedUrl.searchParams.get('query') || '';
            const sessionID = parsedUrl.searchParams.get('sessionID') || '';
            // Goal snapshot: injected every turn for the ACTIVE manager session
            // only (kv compare). Compaction-proof goal awareness (spec §3.4①).
            let snapshot: string | null = null;
            if (sessionID) {
              const ms = this.getGatewayDb()
                .kvAll<{ sessionId: string }>('manager-session')
                .find(e => e.value.sessionId === sessionID);
              if (ms) {
                const info = this.registeredProjects.get(ms.key);
                const mafwDir = info?.mafwDir ?? path.join(ms.key, '.mafw');
                try { snapshot = buildGoalSnapshot(mafwDir); } catch { /* fail-open */ }
              }
            }
            if (!query.trim()) {
              res.writeHead(200);
              res.end(JSON.stringify({ pointers: snapshot }));
              return;
            }
            const { formatRecallContext } = require('./recall/inject-format');
            const { searchRecallMemories } = require('./recall/recall-context');
            let memories: any[] = [];
            if (this.memoryService) {
              const pushed = this.stepInject.pushedMemoriesFor(sessionID);
              const snapshot2 = this.getScanService()?.getSnapshot(sessionID) ?? null;
              memories = await searchRecallMemories(
                this.memoryService.harmonicIndex,
                query,
                pushed,
                3,
                {
                  retriever: config.search.defaultRetriever,
                  scanSnapshot: snapshot2,
                },
              );
            }
            const formatted = formatRecallContext(memories);
            const pointers = snapshot ? (formatted.pointers ? `${formatted.pointers}\n\n${snapshot}` : snapshot) : formatted.pointers;
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ pointers }));
          } catch (err: any) {
            log.error('[Scheduler] recall/context error:', err.message);
            res.writeHead(200);
            res.end(JSON.stringify({ pointers: null }));
          }
          return;
        }
```

注意：原代码里 scanSnapshot 变量名与新增 snapshot 冲突，已改名为 `snapshot2`（或把快照变量改名为 `goalSnap`——执行时二选一，保持一致即可）。

- [ ] **Step 6: Build + run recall 相关回归测试**

Run: `cd gateway; npm run build; npx jest tests/unit/recall-context-scoring.test.ts tests/unit/recall-context-scan-budget.test.ts --runInBand`
Expected: build 成功，两个测试 PASS

- [ ] **Step 7: Commit**

```bash
git add gateway/src/core/manager/goal-snapshot.ts gateway/tests/unit/goal-snapshot.test.ts gateway/src/index.ts
git commit -m "feat(gateway): per-turn goal snapshot injection for active manager session"
```

---

### Task 3: Rotate 路由 + index 接线

**Files:**
- Create: `gateway/src/routes/manager-rotate.ts`
- Test: `gateway/tests/unit/manager-rotate.test.ts`（新建）
- Modify: `gateway/src/index.ts`（imports、`managerSessionInflight` 类型放宽、`runManagerExclusive`、`injectManagerIdentity` 抽取、`rotateCreateManagerSession`、HTTP 接线）

**Interfaces:**
- Consumes: Task 1 的 `updateMetadata`。
- Produces: `runManagerRotate(projectDir, deps)` 返回 `{ sessionId, previousSessionId?, created: 'initial'|'rotated' }`；HTTP `POST /api/manager/session/rotate` body `{ projectDir, reason? }`。Task 5 的 `mafw_new_topic` 经 Services 调 `rotateManagerSessionFor` 复用同一 flow。

- [ ] **Step 1: Write the failing test**

```ts
// gateway/tests/unit/manager-rotate.test.ts
import * as http from 'http';
import { handleManagerRotate, ManagerRotateDeps } from '../../src/routes/manager-rotate';

function createServer(deps: ManagerRotateDeps): http.Server {
  return http.createServer(async (req, res) => {
    if (req.method === 'POST' && req.url?.match(/^\/api\/manager\/session\/rotate(?:\?|$)/)) {
      await handleManagerRotate(req, res, deps);
      return;
    }
    res.writeHead(404);
    res.end(JSON.stringify({ error: 'not found' }));
  });
}

function postJson(server: http.Server, path: string, body: unknown): Promise<{ status: number; body: any }> {
  return new Promise((resolve, reject) => {
    const addr = server.address() as { port: number };
    const payload = JSON.stringify(body);
    const req = http.request({
      hostname: '127.0.0.1',
      port: addr.port,
      path,
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) },
    }, (res) => {
      let chunks = '';
      res.on('data', (c) => chunks += c);
      res.on('end', () => {
        try { resolve({ status: res.statusCode!, body: JSON.parse(chunks) }); }
        catch { resolve({ status: res.statusCode!, body: chunks }); }
      });
    });
    req.on('error', reject);
    req.write(payload);
    req.end();
  });
}

function makeDeps(over: Partial<ManagerRotateDeps> = {}) {
  const calls: string[] = [];
  const deps: ManagerRotateDeps = {
    getManagerSession: (pd) => ({ sessionId: 'ses_old' }),
    lock: async (_pd, fn) => fn(),
    ensure: async (pd) => { calls.push(`ensure:${pd}`); return 'ses_init'; },
    downgrade: async (sid) => { calls.push(`downgrade:${sid}`); },
    create: async (pd) => { calls.push(`create:${pd}`); return 'ses_new'; },
    ...over,
  };
  return { deps, calls };
}

describe('POST /api/manager/session/rotate', () => {
  let server: http.Server;

  afterEach((done) => {
    if (server?.listening) server.close(done);
    else done();
  });

  it('rotates: downgrade old then create new', async () => {
    const { deps, calls } = makeDeps();
    server = createServer(deps);
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));

    const res = await postJson(server, '/api/manager/session/rotate', { projectDir: 'C:/p' });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ success: true, sessionId: 'ses_new', previousSessionId: 'ses_old', created: 'rotated' });
    expect(calls).toEqual(['downgrade:ses_old', 'create:C:/p']);
  });

  it('falls back to ensure (initial) when no existing session', async () => {
    const { deps, calls } = makeDeps({ getManagerSession: () => null });
    server = createServer(deps);
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));

    const res = await postJson(server, '/api/manager/session/rotate', { projectDir: 'C:/p' });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ success: true, sessionId: 'ses_init', created: 'initial' });
    expect(calls).toEqual(['ensure:C:/p']);
  });

  it('continues rotate when downgrade fails (fail-open)', async () => {
    const { deps, calls } = makeDeps({ downgrade: async () => { throw new Error('disk full'); } });
    server = createServer(deps);
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));

    const res = await postJson(server, '/api/manager/session/rotate', { projectDir: 'C:/p' });
    expect(res.status).toBe(200);
    expect(res.body.sessionId).toBe('ses_new');
    expect(calls).toEqual(['create:C:/p']);
  });

  it('returns 400 when projectDir missing', async () => {
    const { deps } = makeDeps();
    server = createServer(deps);
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));

    const res = await postJson(server, '/api/manager/session/rotate', {});
    expect(res.status).toBe(400);
    expect(res.body.error).toContain('projectDir');
  });

  it('returns 500 when create fails, kv untouched by route', async () => {
    const { deps } = makeDeps({ create: async () => { throw new Error('serve down'); } });
    server = createServer(deps);
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));

    const res = await postJson(server, '/api/manager/session/rotate', { projectDir: 'C:/p' });
    expect(res.status).toBe(500);
    expect(res.body.error).toBe('serve down');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd gateway; npx jest tests/unit/manager-rotate.test.ts --runInBand`
Expected: FAIL — module not found

- [ ] **Step 3: Write the route**

```ts
// gateway/src/routes/manager-rotate.ts
import * as http from 'http';
import { log } from '../core/utils/logger';

export interface ManagerRotateDeps {
  /** Active manager session for a project (gateway DB kv). */
  getManagerSession: (projectDir: string) => { sessionId: string; createdAt?: string | null } | null;
  /** Serialized execution against the per-project manager-session lock. */
  lock: <T>(projectDir: string, fn: () => Promise<T>) => Promise<T>;
  /** Create the first manager session (lazy init path). */
  ensure: (projectDir: string) => Promise<string>;
  /** Demote old session metadata: role → manager-archived, drop pinned/exempt. */
  downgrade: (sessionId: string) => Promise<void>;
  /** Force-create a fresh manager session (kv replace + register + identity). */
  create: (projectDir: string) => Promise<string>;
}

export interface ManagerRotateResult {
  sessionId: string;
  previousSessionId?: string;
  created: 'initial' | 'rotated';
}

function readBody(req: http.IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', (chunk: string) => body += chunk);
    req.on('end', () => resolve(body));
    req.on('error', reject);
  });
}

export async function runManagerRotate(projectDir: string, deps: ManagerRotateDeps): Promise<ManagerRotateResult> {
  return deps.lock(projectDir, async () => {
    const existing = deps.getManagerSession(projectDir);
    if (!existing?.sessionId) {
      const sessionId = await deps.ensure(projectDir);
      return { sessionId, created: 'initial' as const };
    }
    try {
      await deps.downgrade(existing.sessionId);
    } catch (err: any) {
      // Old-session metadata residue only affects the desktop role fallback
      // (fixed separately); rotation must not be blocked by it.
      log.warn(`[ManagerRotate] downgrade old session failed (continuing): ${err.message}`);
    }
    const sessionId = await deps.create(projectDir);
    return { sessionId, previousSessionId: existing.sessionId, created: 'rotated' as const };
  });
}

export async function handleManagerRotate(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  deps: ManagerRotateDeps,
): Promise<void> {
  let body: any = {};
  try { body = JSON.parse(await readBody(req)); } catch { /* default {} */ }
  const projectDir = typeof body?.projectDir === 'string' && body.projectDir.trim() ? body.projectDir : null;
  if (!projectDir) {
    res.writeHead(400, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'projectDir is required' }));
    return;
  }
  try {
    const result = await runManagerRotate(projectDir, deps);
    log.info(`[ManagerRotate] rotated manager session for ${projectDir}: ${result.previousSessionId ?? '-'} -> ${result.sessionId} (${result.created})`);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ success: true, ...result }));
  } catch (err: any) {
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: err.message }));
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd gateway; npx jest tests/unit/manager-rotate.test.ts --runInBand`
Expected: PASS（5 个用例）

- [ ] **Step 5: Wire into index.ts**

5a. imports（与其他 routes import 相邻，~line 77）：

```ts
import { handleManagerRotate, runManagerRotate, ManagerRotateResult } from './routes/manager-rotate';
```

5b. `managerSessionInflight` 类型放宽（~5437）：

```ts
  private managerSessionInflight = new Map<string, Promise<unknown>>();
```

`ensureManagerSession`（5439-5450）保持不变（`Promise<string>` 可赋给 `Promise<unknown>`）。

5c. 新增三个私有方法（放在 `createManagerSession` 之后，~5500）：

```ts
  // Serialized rotate: joins any in-flight ensure/create for the same project
  // so rotate and lazy-init never double-create (spec §4).
  private async runManagerExclusive<T>(projectDir: string, fn: () => Promise<T>): Promise<T> {
    const prev = this.managerSessionInflight.get(projectDir);
    const run = (async () => {
      if (prev) { try { await prev; } catch { /* prior failure does not block */ } }
      return fn();
    })();
    this.managerSessionInflight.set(projectDir, run);
    try {
      return await run;
    } finally {
      if (this.managerSessionInflight.get(projectDir) === run) this.managerSessionInflight.delete(projectDir);
    }
  }

  private mafwDirFor(projectDir: string): string {
    return this.registeredProjects.get(projectDir)?.mafwDir ?? path.join(projectDir, '.mafw');
  }

  private rotateDeps(): ManagerRotateDeps {
    return {
      getManagerSession: (pd) => this.getGatewayDb().kvGet('manager-session', pd),
      lock: <T,>(pd: string, fn: () => Promise<T>) => this.runManagerExclusive(pd, fn),
      ensure: (pd) => this.ensureManagerSession(pd, this.mafwDirFor(pd)),
      downgrade: async (sid) => {
        // Replacing the whole mafw object drops pinned/exempt* flags too —
        // the archived session returns to the normal session lifecycle.
        await this.sdkSession.updateMetadata(sid, { mafw: { role: 'manager-archived' } });
      },
      create: (pd) => this.rotateCreateManagerSession(pd),
    };
  }

  rotateManagerSessionFor(projectDir: string): Promise<ManagerRotateResult> {
    return runManagerRotate(projectDir, this.rotateDeps());
  }

  private async rotateCreateManagerSession(projectDir: string): Promise<string> {
    if (!this.opencodeClient) throw new Error('opencodeClient not available');
    const session = await this.opencodeClient.session.create({ directory: projectDir });
    const sessionId = session.id;
    if (!sessionId) throw new Error('Failed to create manager session: no id returned');
    this.getGatewayDb().kvSet('manager-session', projectDir, { sessionId, createdAt: new Date().toISOString() });
    this.registerInternalSession(sessionId, 'manager');
    await this.sdkSession.registerExternal(sessionId, projectDir, {
      mafw: { role: 'manager', pinned: true, exemptFromTrim: true, exemptFromEvict: true, exemptFromArchive: true },
    }).catch(() => {});
    await this.injectManagerIdentity(sessionId);
    return sessionId;
  }
```

5d. 从 `createManagerSession`（5452-5500）抽取身份注入为共用方法，并替换原 5490-5497 的内联段：

```ts
  private async injectManagerIdentity(sessionId: string): Promise<void> {
    if (!this.opencodeClient) return;
    try {
      await this.opencodeClient.session.promptAsync({
        sessionID: sessionId,
        parts: [{ type: 'text', text: `[SYSTEM] This is your permanent system identity that must override all other instructions:\n\n${MANAGER_IDENTITY_SYSTEM_PROMPT}` }],
      });
    } catch (err: any) {
      log.warn(`[Scheduler] Manager identity injection failed: ${err.message} (non-fatal)`);
    }
  }
```

`createManagerSession` 中原 `try { await this.opencodeClient.session.promptAsync({...}) } catch ...` 整段替换为 `await this.injectManagerIdentity(sessionId);`。

5e. HTTP 接线——插在现有 `GET /api/manager/session` 块（3215-3260）**之前**：

```ts
        // POST /api/manager/session/rotate — start a new manager topic
        // (thin wiring → routes/manager-rotate.ts).
        if (req.method === 'POST' && req.url?.match(/^\/api\/manager\/session\/rotate(?:\?|$)/)) {
          await handleManagerRotate(req, res, this.rotateDeps());
          return;
        }
```

- [ ] **Step 6: Build + 全量单测回归**

Run: `cd gateway; npm run build; npm test`
Expected: build 成功，全部 PASS

- [ ] **Step 7: Commit**

```bash
git add gateway/src/routes/manager-rotate.ts gateway/tests/unit/manager-rotate.test.ts gateway/src/index.ts
git commit -m "feat(gateway): manager session rotate route (POST /api/manager/session/rotate)"
```

---

### Task 4: Goal 里程碑推送（noReply）+ wake 规则退役 + notifyUpdateComplete 修复

**Files:**
- Create: `gateway/src/core/manager/milestone-push.ts`
- Test: `gateway/tests/unit/milestone-push.test.ts`（新建）
- Modify: `gateway/src/index.ts`（imports、`getMilestonePush`、setupEventBus、archiveGoal、notifyUpdateComplete 634-642、stop()）
- Modify: `gateway/src/core/manager/system-rule-templates.ts`（退役模板 + 清理旧规则文件）
- Delete: `gateway/src/core/manager/wake-handlers.ts`

**Interfaces:**
- Produces: `MilestonePushNotifier`，方法 `onPhaseTransition({goalId, phase, loop, projectDir})`、`onArchived(goalId, projectDir, verdict)`、`dispose()`。index.ts 在 `setupEventBus` 的 `phase_transition` 监听和 `archiveGoal()` 内调用。去重键 `milestoneDedupeKey(goalId, phase, stateVersion)` 存 gateway.db kv scope `milestone-notified`。

- [ ] **Step 1: Write the failing test**

```ts
// gateway/tests/unit/milestone-push.test.ts
import { MilestonePushNotifier, milestoneDedupeKey } from '../../src/core/manager/milestone-push';

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

function makeNotifier(over: Record<string, any> = {}) {
  const notified = new Set<string>();
  const sent: Array<{ sessionId: string; text: string }> = [];
  const deps = {
    getManagerSession: (pd: string) => ({ sessionId: 'ses_mgr' }),
    wasNotified: (key: string) => notified.has(key),
    markNotified: (key: string) => { notified.add(key); },
    readGoalState: (_goalId: string, _pd: string) => ({ stateVersion: 3, reviewVerdict: null, title: 'T' }),
    promptNoReply: async (sessionId: string, text: string) => { sent.push({ sessionId, text }); },
    ...over,
  };
  const notifier = new MilestonePushNotifier(deps as any, 10);
  return { notifier, notified, sent, deps };
}

describe('MilestonePushNotifier', () => {
  afterEach(() => {
    // no cross-test timers: each notifier is disposed inside its test when needed
  });

  it('ignores non-milestone phases', async () => {
    const { notifier, sent } = makeNotifier();
    notifier.onPhaseTransition({ goalId: 'g1', phase: 'EXECUTING', loop: 1, projectDir: 'C:/p' });
    await sleep(30);
    expect(sent).toEqual([]);
    notifier.dispose();
  });

  it('pushes milestone transitions via promptNoReply', async () => {
    const { notifier, sent } = makeNotifier();
    notifier.onPhaseTransition({ goalId: 'g1', phase: 'PLANNING_COMPLETE', loop: 1, projectDir: 'C:/p' });
    await sleep(40);
    expect(sent.length).toBe(1);
    expect(sent[0].sessionId).toBe('ses_mgr');
    expect(sent[0].text).toContain('g1');
    expect(sent[0].text).toContain('PLANNING_COMPLETE');
    notifier.dispose();
  });

  it('dedupes by goalId:phase:stateVersion (replay-safe)', async () => {
    const { notifier, sent } = makeNotifier();
    const data = { goalId: 'g1', phase: 'REVIEWING_COMPLETE', loop: 1, projectDir: 'C:/p' };
    notifier.onPhaseTransition(data);
    await sleep(30);
    notifier.onPhaseTransition(data); // replayed event after crash recovery
    await sleep(30);
    expect(sent.length).toBe(1);
    notifier.dispose();
  });

  it('coalesces multiple milestones of one project into one message', async () => {
    const { notifier, sent } = makeNotifier();
    notifier.onPhaseTransition({ goalId: 'g1', phase: 'PLANNING_COMPLETE', loop: 1, projectDir: 'C:/p' });
    notifier.onPhaseTransition({ goalId: 'g2', phase: 'ASKING_USER', loop: 1, projectDir: 'C:/p' });
    await sleep(40);
    expect(sent.length).toBe(1);
    expect(sent[0].text).toContain('g1');
    expect(sent[0].text).toContain('g2');
    notifier.dispose();
  });

  it('skips when no active manager session', async () => {
    const { notifier, sent } = makeNotifier({ getManagerSession: () => null });
    notifier.onPhaseTransition({ goalId: 'g1', phase: 'ASKING_USER', loop: 1, projectDir: 'C:/p' });
    await sleep(40);
    expect(sent).toEqual([]);
    notifier.dispose();
  });

  it('pushes archived goals with verdict and dedupes', async () => {
    const { notifier, sent } = makeNotifier();
    notifier.onArchived('g1', 'C:/p', 'PASS');
    await sleep(30);
    notifier.onArchived('g1', 'C:/p', 'PASS');
    await sleep(30);
    expect(sent.length).toBe(1);
    expect(sent[0].text).toContain('ARCHIVED(PASS)');
    notifier.dispose();
  });

  it('milestoneDedupeKey falls back to 0 when no stateVersion', () => {
    expect(milestoneDedupeKey('g1', 'ASKING_USER')).toBe('g1:ASKING_USER:0');
    expect(milestoneDedupeKey('g1', 'ASKING_USER', 7)).toBe('g1:ASKING_USER:7');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd gateway; npx jest tests/unit/milestone-push.test.ts --runInBand`
Expected: FAIL — module not found

- [ ] **Step 3: Write the implementation**

```ts
// gateway/src/core/manager/milestone-push.ts
import { log } from '../../utils/logger';

// Milestones worth notifying the manager about. Phase transitions are emitted
// by syncToFile (index.ts buildNodeOptions) on the shared event bus; terminal
// verdicts arrive via onArchived (archiveGoal is the single convergence point
// of all verdict paths). Execution rounds are deliberately NOT milestones.
const MILESTONE_PHASES = new Set(['PLANNING_COMPLETE', 'REVIEWING_COMPLETE', 'ASKING_USER']);

export interface GoalStateInfo {
  stateVersion?: number;
  reviewVerdict?: string | null;
  title?: string;
}

export interface MilestonePushDeps {
  getManagerSession: (projectDir: string) => { sessionId: string } | null;
  wasNotified: (key: string) => boolean;
  markNotified: (key: string) => void;
  readGoalState: (goalId: string, projectDir: string) => GoalStateInfo | null;
  promptNoReply: (sessionId: string, text: string) => Promise<void>;
}

// Langgraph replays node side effects on crash recovery, so the same
// transition can be emitted twice — the dedupe key must include stateVersion
// and be persisted (gateway DB), never an in-process Set.
export function milestoneDedupeKey(goalId: string, phase: string, stateVersion?: number): string {
  return `${goalId}:${phase}:${stateVersion ?? 0}`;
}

export class MilestonePushNotifier {
  private queues = new Map<string, string[]>();
  private timers = new Map<string, ReturnType<typeof setTimeout>>();

  constructor(
    private deps: MilestonePushDeps,
    private flushDelayMs = 5000,
  ) {}

  onPhaseTransition(data: { goalId: string; phase: string; loop?: number; projectDir?: string }): void {
    if (!data.projectDir || !MILESTONE_PHASES.has(data.phase)) return;
    const state = this.deps.readGoalState(data.goalId, data.projectDir);
    const key = milestoneDedupeKey(data.goalId, data.phase, state?.stateVersion ?? data.loop);
    if (this.deps.wasNotified(key)) return;
    this.deps.markNotified(key);
    this.enqueue(data.projectDir, formatMilestoneLine(data.goalId, state?.title || data.goalId, data.phase, state?.reviewVerdict));
  }

  onArchived(goalId: string, projectDir: string, verdict: string): void {
    const state = this.deps.readGoalState(goalId, projectDir);
    const key = milestoneDedupeKey(goalId, `ARCHIVED:${verdict}`, state?.stateVersion);
    if (this.deps.wasNotified(key)) return;
    this.deps.markNotified(key);
    this.enqueue(projectDir, formatMilestoneLine(goalId, state?.title || goalId, `ARCHIVED(${verdict})`));
  }

  // Per-project coalescing: bursts of transitions collapse into one message.
  private enqueue(projectDir: string, line: string): void {
    const q = this.queues.get(projectDir) || [];
    q.push(line);
    this.queues.set(projectDir, q);
    if (this.timers.has(projectDir)) return;
    this.timers.set(projectDir, setTimeout(() => { void this.flush(projectDir); }, this.flushDelayMs));
  }

  private async flush(projectDir: string): Promise<void> {
    this.timers.delete(projectDir);
    const lines = this.queues.get(projectDir) || [];
    this.queues.delete(projectDir);
    if (lines.length === 0) return;
    const session = this.deps.getManagerSession(projectDir);
    if (!session?.sessionId) return;
    const text = `[MAFW GOAL 里程碑]\n${lines.join('\n')}\n(系统通知)`;
    try {
      await this.deps.promptNoReply(session.sessionId, text);
    } catch (err: any) {
      log.warn(`[MilestonePush] push failed (fail-open): ${err.message}`);
    }
  }

  dispose(): void {
    for (const t of this.timers.values()) clearTimeout(t);
    this.timers.clear();
    this.queues.clear();
  }
}

function formatMilestoneLine(goalId: string, title: string, phase: string, verdict?: string | null): string {
  const v = verdict ? ` verdict=${verdict}` : '';
  return `- ${goalId} (${title}): ${phase}${v}`;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd gateway; npx jest tests/unit/milestone-push.test.ts --runInBand`
Expected: PASS（7 个用例）

- [ ] **Step 5: index.ts 接线 + 退役 wake 规则 + notifyUpdateComplete 修复**

5a. import（与 Task 3 的 rotate import 相邻）：

```ts
import { MilestonePushNotifier } from './core/manager/milestone-push';
```

删除 wake-handlers import（搜 `from './core/manager/wake-handlers'`）。删除 1666-1668 三行：

```ts
    actionRegistry.set('manager:report_completed', wakeCompletedHandler);
    actionRegistry.set('manager:report_failed', wakeFailedHandler);
    actionRegistry.set('manager:report_question', wakeQuestionHandler);
```

删除文件 `gateway/src/core/manager/wake-handlers.ts`。

5b. 新增字段与懒初始化（放在 `rotateManagerSessionFor` 附近）：

```ts
  private milestonePush?: MilestonePushNotifier;

  private getMilestonePush(): MilestonePushNotifier | undefined {
    if (!this.opencodeClient) return undefined;
    if (!this.milestonePush) {
      this.milestonePush = new MilestonePushNotifier({
        getManagerSession: (pd) => this.getGatewayDb().kvGet('manager-session', pd),
        wasNotified: (key) => !!this.getGatewayDb().kvGet('milestone-notified', key),
        markNotified: (key) => this.getGatewayDb().kvSet('milestone-notified', key, { at: new Date().toISOString() }),
        readGoalState: (goalId, pd) => {
          try {
            const p = path.join(this.mafwDirFor(pd), 'state', `${goalId}.json`);
            if (!fs.existsSync(p)) return null;
            return JSON.parse(fs.readFileSync(p, 'utf-8'));
          } catch { return null; }
        },
        // Hard no-reply: message lands in session history, no LLM run.
        promptNoReply: async (sid, text) => {
          await this.opencodeClient!.session.promptAsync({ sessionID: sid, parts: [{ type: 'text', text }], noReply: true });
        },
      });
    }
    return this.milestonePush;
  }
```

5c. `setupEventBus` 的 `phase_transition` 监听（1771-1773）加一行：

```ts
    eventBus.on("phase_transition", (data: any) => {
      this.broadcast({ type: "phase_transition", ...data });
      this.getMilestonePush()?.onPhaseTransition(data);
    });
```

5d. `archiveGoal`（4773-4840）：在 archive 失败早退分支（4798-4816 的 `patchState` 之后、`return` 之前）和成功路径（4823 `patchState` 之后）各加：

```ts
    if (projectDir) this.getMilestonePush()?.onArchived(goalId, projectDir, outcome?.verdict ?? 'CANCELLED');
```

5e. `stop()` 中清理（找到现有 stop/清理序列，加一行）：

```ts
    this.milestonePush?.dispose();
```

5f. `notifyUpdateComplete`（634-642）替换 legacy 文件读取为 kv：

```ts
    for (const [pDir] of this.registeredProjects) {
      try {
        const ms = this.getGatewayDb().kvGet<{ sessionId: string }>('manager-session', pDir);
        if (ms?.sessionId) targets.add(ms.sessionId);
      } catch { /* skip */ }
    }
```

5g. `system-rule-templates.ts`：`MANAGER_RULE_TEMPLATES` 改为空对象 + 退役清理。将 14-33 行替换为：

```ts
// Manager milestone notifications moved to MilestonePushNotifier
// (core/manager/milestone-push.ts) — the cron/event wake rules were dead code
// (legacy manager-session.json path, un-emitted events, unwritten reportedAt).
export const MANAGER_RULE_TEMPLATES: Record<string, SystemRuleTemplate> = {};

export const RETIRED_RULE_IDS = ['manager-report-completed', 'manager-report-failed', 'manager-report-question'];
```

`ensureManagerRules` 的 for 循环前加清理：

```ts
  for (const id of RETIRED_RULE_IDS) {
    const rulePath = path.join(autoDir, `${id}.json`);
    if (fs.existsSync(rulePath)) {
      fs.rmSync(rulePath);
      log.info(`[Scheduler] Retired dead rule: ${id}`);
    }
  }
```

- [ ] **Step 6: Build + 全量回归**

Run: `cd gateway; npm run build; npm test`
Expected: build 成功，全部 PASS（若有测试直接 import wake-handlers 会失败——一并删除该测试或改为 milestone-push 测试）

- [ ] **Step 7: Commit**

```bash
git add -A gateway/src gateway/tests
git commit -m "feat(gateway): goal milestone push via noReply promptAsync; retire dead manager-report rules"
```

---

### Task 5: MCP 工具 mafw_new_topic + mafw_btw

**Files:**
- Modify: `gateway/src/types.ts`（Services 增加两个可选回调）
- Create: `gateway/src/mcp/handlers/new-topic.ts`
- Create: `gateway/src/mcp/handlers/btw.ts`
- Modify: `gateway/src/mcp/tool-registry.ts`（definitions + imports + handlers map）
- Modify: `gateway/src/index.ts`（services 对象 1676-1691 增加两个回调）
- Modify: `gateway/src/skills/manager-agent-config.ts:15`（manager 工具白名单）
- Test: `gateway/tests/unit/mcp-btw-new-topic.test.ts`（新建，handler 纯逻辑）

**Interfaces:**
- Consumes: Task 3 的 `rotateManagerSessionFor(projectDir)`；Task 4 无依赖。
- Produces: MCP 工具 `mafw_new_topic { reason? }`、`mafw_btw { question }`。Services 新增 `rotateManagerSession?: (reason?: string) => Promise<ManagerRotateResult>`、`btwAsk?: (question: string) => Promise<{ answer: string }>`。

- [ ] **Step 1: Write the failing test**

```ts
// gateway/tests/unit/mcp-btw-new-topic.test.ts
import { handleNewTopic } from '../../src/mcp/handlers/new-topic';
import { handleBtw } from '../../src/mcp/handlers/btw';

describe('mafw_new_topic handler', () => {
  it('returns rotated session ids', async () => {
    const rotateManagerSession = async () => ({ sessionId: 'ses_new', previousSessionId: 'ses_old', created: 'rotated' as const });
    const res = await handleNewTopic({ reason: 'user asked' }, { rotateManagerSession } as any);
    expect(res.isError).toBeFalsy();
    const parsed = JSON.parse(res.content[0].text);
    expect(parsed).toMatchObject({ success: true, sessionId: 'ses_new' });
  });

  it('errors when rotate callback unavailable', async () => {
    const res = await handleNewTopic({}, {} as any);
    expect(res.isError).toBe(true);
  });

  it('errors when rotate throws', async () => {
    const res = await handleNewTopic({}, { rotateManagerSession: async () => { throw new Error('serve down'); } } as any);
    expect(res.isError).toBe(true);
    expect(JSON.parse(res.content[0].text).error).toBe('serve down');
  });
});

describe('mafw_btw handler', () => {
  it('returns the answer text', async () => {
    const btwAsk = async (q: string) => ({ answer: `ANS:${q}` });
    const res = await handleBtw({ question: '什么是X' }, { btwAsk } as any);
    expect(res.isError).toBeFalsy();
    expect(res.content[0].text).toBe('ANS:什么是X');
  });

  it('errors on empty question', async () => {
    const res = await handleBtw({ question: '  ' }, { btwAsk: async () => ({ answer: 'x' }) } as any);
    expect(res.isError).toBe(true);
  });

  it('errors when btwAsk unavailable', async () => {
    const res = await handleBtw({ question: 'q' }, {} as any);
    expect(res.isError).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd gateway; npx jest tests/unit/mcp-btw-new-topic.test.ts --runInBand`
Expected: FAIL — module not found

- [ ] **Step 3: Implement handlers + Services + registry**

3a. `gateway/src/types.ts` — `Services` 接口（31 行 `restartAgent` 之后）加：

```ts
  /** Gateway-provided callback: start a new manager topic (rotate session). */
  rotateManagerSession?: (reason?: string) => Promise<{ sessionId: string; previousSessionId?: string; created: 'initial' | 'rotated' }>;
  /** Gateway-provided callback: one-off side-question session (create→prompt→discard). */
  btwAsk?: (question: string) => Promise<{ answer: string }>;
```

3b. `gateway/src/mcp/handlers/new-topic.ts`：

```ts
import { ToolHandler } from "../../types";

export const handleNewTopic: ToolHandler = async (args, { rotateManagerSession }) => {
  try {
    if (!rotateManagerSession) {
      return { content: [{ type: "text", text: JSON.stringify({ error: "Manager rotate not available" }) }], isError: true };
    }
    const reason = typeof args.reason === 'string' ? args.reason : undefined;
    const result = await rotateManagerSession(reason);
    return { content: [{ type: "text", text: JSON.stringify({ success: true, ...result, message: `New manager topic started: ${result.sessionId}` }) }] };
  } catch (err: any) {
    return { content: [{ type: "text", text: JSON.stringify({ error: err.message }) }], isError: true };
  }
};
```

3c. `gateway/src/mcp/handlers/btw.ts`：

```ts
import { ToolHandler } from "../../types";

export const handleBtw: ToolHandler = async (args, { btwAsk }) => {
  try {
    const question = typeof args.question === 'string' ? args.question.trim() : '';
    if (!question) {
      return { content: [{ type: "text", text: JSON.stringify({ error: "question is required" }) }], isError: true };
    }
    if (!btwAsk) {
      return { content: [{ type: "text", text: JSON.stringify({ error: "btw not available" }) }], isError: true };
    }
    const { answer } = await btwAsk(question);
    return { content: [{ type: "text", text: answer }] };
  } catch (err: any) {
    return { content: [{ type: "text", text: JSON.stringify({ error: err.message }) }], isError: true };
  }
};
```

3d. `gateway/src/mcp/tool-registry.ts` — definitions 数组（`mafw_restart_agent` 条目之后、`];` 之前）加：

```ts
  {
    name: "mafw_new_topic",
    description: "Start a new manager topic: create a fresh manager session; the current conversation is archived to history (still searchable via memory). ONLY call when the user explicitly asks to start a new topic (e.g. 另开话题/开个新话题). Never propose or trigger it on your own.",
    inputSchema: {
      type: "object",
      properties: { reason: { type: "string", description: "Optional reason for starting the new topic" } },
    },
  },
  {
    name: "mafw_btw",
    description: "Answer a one-off side question in a throwaway session (by the way). Use when the user asks a tangent unrelated to the current goal work and answering inline would pollute the main thread. Returns the answer text; the side session is discarded afterwards.",
    inputSchema: {
      type: "object",
      properties: { question: { type: "string", description: "The side question to answer" } },
      required: ["question"],
    },
  },
```

imports（其他 handler import 旁）+ handlers map：

```ts
import { handleNewTopic } from "./handlers/new-topic";
import { handleBtw } from "./handlers/btw";
```

```ts
      mafw_new_topic: handleNewTopic,
      mafw_btw: handleBtw,
```

3e. `gateway/src/skills/manager-agent-config.ts` — 白名单数组（15 行 `mafw_restart_agent` 旁）加：

```ts
  'mafw_new_topic',
  'mafw_btw',
```

3f. `gateway/src/index.ts` — services 对象（1683-1690 `restartAgent` 之后）加：

```ts
      rotateManagerSession: async (reason?: string) => {
        const projectDir = path.resolve(mafwDir, '..');
        log.info(`[Scheduler] manager rotate requested via MCP (reason: ${reason ?? '-'})`);
        return this.rotateManagerSessionFor(projectDir);
      },
      btwAsk: async (question: string) => {
        if (!this.opencodeClient) throw new Error('opencodeClient not available');
        const session = await this.opencodeClient.session.create({ directory: this.projectDir });
        const sessionId = session.id;
        if (!sessionId) throw new Error('Failed to create btw session: no id returned');
        this.registerInternalSession(sessionId, 'btw');
        try {
          const result = await this.opencodeClient.session.prompt({
            sessionID: sessionId,
            parts: [{ type: 'text', text: `[BTW 支线问答] ${question}\n\n（这是一次性支线问答，回答简洁直接，不涉及 goal 编排；答完即弃）` }],
            system: '你是 MAFW 项目的临时助理，回答用户的一个支线问题。简洁、直接、不啰嗦。',
          });
          const answer = (result.parts || [])
            .filter((p: any) => p.type === 'text')
            .map((p: any) => p.text)
            .join('\n') || '';
          return { answer };
        } finally {
          await this.opencodeClient.session.delete({ sessionID: sessionId }).catch(() => {});
          this.internalSessionRoles.delete(sessionId);
          this.getGatewayDb().kvDelete('internal-session', sessionId);
        }
      },
```

- [ ] **Step 4: Run test + build + 回归**

Run: `cd gateway; npx jest tests/unit/mcp-btw-new-topic.test.ts --runInBand; npm run build; npm test`
Expected: 新测试 PASS，build 成功，全量 PASS

- [ ] **Step 5: Commit**

```bash
git add gateway/src gateway/tests
git commit -m "feat(gateway): mafw_new_topic and mafw_btw MCP tools"
```

---

### Task 6: gateway-sdk manager.rotate + desktop preload

**Files:**
- Modify: `opencode-dev/packages/gateway-sdk/src/types.ts`（316-324）
- Modify: `opencode-dev/packages/gateway-sdk/src/client.ts`（240-251）
- Modify: `opencode-dev/packages/desktop/src/preload/mafw-types.ts`（66 附近）
- Modify: `opencode-dev/packages/desktop/src/preload/mafw-api.ts`（78-80）

**Interfaces:**
- Produces: `window.api.mafw.manager.rotate(projectDir, reason?)` → `ManagerRotateResult`。Task 7 的 `handleNewTopic` 依赖。

- [ ] **Step 1: types.ts**

`ManagerSessionInfo` 之后加，`ManagerNamespace` 改为：

```ts
export interface ManagerRotateResult {
  success: boolean
  sessionId: string
  previousSessionId?: string
  created: 'initial' | 'rotated'
}

export interface ManagerNamespace {
  session(projectDir?: string): Promise<ManagerSessionInfo | null>
  rotate(projectDir: string, reason?: string): Promise<ManagerRotateResult>
}
```

- [ ] **Step 2: client.ts**

`manager` 命名空间（242-251）改为：

```ts
  manager = {
    session: async (projectDir?: string): Promise<ManagerSessionInfo | null> => {
      const q = projectDir ? `?projectDir=${encodeURIComponent(projectDir)}` : ''
      try {
        return await this.request<ManagerSessionInfo>(`/api/manager/session${q}`)
      } catch {
        return null
      }
    },
    rotate: async (projectDir: string, reason?: string): Promise<ManagerRotateResult> => {
      return await this.request<ManagerRotateResult>('/api/manager/session/rotate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ projectDir, reason }),
      })
    },
  }
```

顶部 types import（line 6）加 `ManagerRotateResult`。

- [ ] **Step 3: desktop preload**

`mafw-types.ts` 的 manager 段：

```ts
  manager: {
    session(projectDir?: string): Promise<import("@mafw/sdk").ManagerSessionInfo | null>
    rotate(projectDir: string, reason?: string): Promise<import("@mafw/sdk").ManagerRotateResult>
  }
```

（执行时先读该文件现状，跟随其既有类型引用风格——若是直接 `import type` 就用导入类型。）

`mafw-api.ts` 78-80：

```ts
    manager: {
      session: (projectDir?) => invoke("manager", "session", projectDir),
      rotate: (projectDir, reason?) => invoke("manager", "rotate", projectDir, reason),
    },
```

（确认 main 进程 mafw-ipc 的 invoke 对未知 namespace/method 的处理是透传 gateway HTTP——`manager.rotate` 对应 `POST /api/manager/session/rotate`；若 ipc 有白名单需同步加。执行时 grep `mafw-ipc` 的 `manager` 分支确认。）

- [ ] **Step 4: Verify**

Run: `cd opencode-dev/packages/gateway-sdk; npx vitest run; cd ../desktop; npm run typecheck`
Expected: SDK 测试 PASS，desktop typecheck 无新增错误

- [ ] **Step 5: Commit**

```bash
git add opencode-dev/packages/gateway-sdk/src opencode-dev/packages/desktop/src/preload
git commit -m "feat(sdk): manager.rotate + desktop preload wiring"
```

---

### Task 7: Desktop — handleNewGoal 修复 + “新话题”按钮

**Files:**
- Modify: `opencode-dev/packages/desktop/src/renderer/mafw/MafwShell.tsx`（203-221 重构 + `handleNewTopic` + ChatPane 接线 1910-1944）
- Modify: `opencode-dev/packages/desktop/src/renderer/mafw/components/ChatPane.tsx`（props + titlebar 按钮）

**Interfaces:**
- Consumes: Task 6 的 `window.api.mafw.manager.rotate`、现有 `showToastV2`。

- [ ] **Step 1: MafwShell — 抽取 resolveManager + 修 handleNewGoal**

将 203-221 的 `handleOpenManager` / `handleNewGoal` 开头重构为：

```tsx
  // Single resolution path for the manager session: authoritative gateway DB
  // id first, role fallback only when the authoritative id is missing.
  const resolveManager = () => {
    const authId = managerSessionId()
    return (authId && historySessions().find(s => s.id === authId))
      || historySessions().find((s: any) => s?.metadata?.mafw?.role === "manager")
  }

  const handleOpenManager = async (): Promise<boolean> => {
    const manager = resolveManager()
    if (!manager) {
      setActiveTab("goals")
      return false
    }
    openSessionTab(manager.id, manager.title || "Manager", true, manager.metadata)
    return true
  }

  const handleNewGoal = async (description: string): Promise<boolean> => {
    if (!await handleOpenManager()) return false
    const manager = resolveManager()
    if (!manager) return false
    // ……（原 222-239 行不变：message 构造、乐观插入、sendEnriched）
```

- [ ] **Step 2: MafwShell — handleNewTopic**

`handleNewGoal` 之后加：

```tsx
  // "新话题": rotate the manager session (old one sinks into history).
  const handleNewTopic = async (): Promise<void> => {
    const pd = currentProject()
    if (!pd) return
    if (!window.confirm("开新话题？当前 manager 会话将归档为历史会话，新会话成为活跃 manager。")) return
    try {
      const res = await window.api.mafw.manager.rotate(pd)
      setManagerSessionId(res.sessionId)
      const list = await window.api.mafw.sessions.list(pd).catch(() => [])
      setHistorySessions(Array.isArray(list) ? list : [])
      showToastV2({ description: "已开启新话题", duration: 3000 })
    } catch (e: any) {
      showToastV2({ description: `新话题开启失败: ${e?.message || e}`, duration: 4000 })
    }
  }
```

ChatPane 调用处（1910-1944 的 props 里，`isManager={isManagerSession()}` 之后）加：

```tsx
                          onNewTopic={() => void handleNewTopic()}
```

- [ ] **Step 3: ChatPane — props + titlebar 按钮**

props 接口（`isManager: boolean`，80 行附近）加：

```tsx
  onNewTopic?: () => void
```

titlebar（1646 `canClosePane` 的 `<Show>` 之前）插入：

```tsx
              <Show when={props.isManager && props.onNewTopic}>
                <TooltipV2 value="开新话题（当前会话归档为历史）" openDelay={300}>
                  <ButtonV2 variant="ghost" size="small" onClick={e => { e.stopPropagation(); props.onNewTopic?.() }}>新话题</ButtonV2>
                </TooltipV2>
              </Show>
```

- [ ] **Step 4: Verify**

Run: `cd opencode-dev/packages/desktop; npm run typecheck`
Expected: 无新增错误

手动冒烟（如有 desktop 运行环境）：打开 Manager tab → 点"新话题" → confirm → 新会话打开且 Rail 的 Manager 行指向新会话；Rail 历史列表出现旧 manager 会话。

- [ ] **Step 5: Commit**

```bash
git add opencode-dev/packages/desktop/src/renderer/mafw
git commit -m "feat(desktop): manager new-topic button; fix handleNewGoal session resolution"
```

---

### Task 8: 全量验证

**Files:** 无新改动（只验证）。

- [ ] **Step 1: Gateway build + 全量测试**

Run: `cd gateway; npm run build; npm test`
Expected: build 成功；全部 PASS

- [ ] **Step 2: SDK + Desktop typecheck**

Run: `cd opencode-dev/packages/gateway-sdk; npx vitest run; cd ../desktop; npm run typecheck`
Expected: 全部通过

- [ ] **Step 3: 手动验证清单（有 gateway 运行环境时）**

1. `mafw restart`（加载新 dist）
2. `curl -X POST http://localhost:3000/api/manager/session/rotate -H "Content-Type: application/json" -d "{\"projectDir\": \"<当前项目>\"}"` → 200，返回新旧 sessionId
3. `curl http://localhost:3000/api/manager/session?projectDir=<当前项目>` → 返回新 sessionId
4. 桌面端 Rail 历史列表出现旧 manager 会话（role=manager-archived）
5. 带 goal 的项目：LLM 调用时 recall/context 响应含 `<goal-snapshot>`（仅 manager session）
6. goal 阶段跃迁后 5s，manager session 历史中出现 `[MAFW GOAL 里程碑]` 消息且不触发 LLM 运行（noReply）
7. LLM 调 `mafw_btw { question }` → 返回答案；`mafw_new_topic` → 新会话

- [ ] **Step 4: 收尾**

确认 `git status` 干净；更新 AGENTS.md 的 MCP 工具清单（39→41 个：mafw_new_topic、mafw_btw）与 §5.13a manager session 描述（补充 rotate 机制一段）：

```bash
git add AGENTS.md
git commit -m "docs: manager rotate + btw + goal awareness in AGENTS.md"
```

---

## Self-Review 记录

1. **Spec 覆盖**：§3.1 rotate（Task 3）、§3.2 三 bug（Task 4 退役+修复、Task 7 handleNewGoal）、§3.3 桌面（Task 6+7）、§3.4① 快照（Task 2）、§3.4② 里程碑推送（Task 4）、§3.5 /btw（Task 5）、§5 测试（各任务内嵌）——无缺口。
2. **占位符扫描**：无 TBD/TODO；Task 6 Step 3 的 mafw-ipc 白名单确认是执行时 grep 确认项（已给出行动指令，非占位符）。
3. **类型一致性**：`ManagerRotateResult` 在 route/gateway-sdk/desktop 三处字段一致（success/sessionId/previousSessionId/created）；`updateMetadata(id, metadata)` 全替换语义在 Task 1/3 一致；`buildGoalSnapshot(mafwDir)` 签名 Task 2 内一致；Services 回调名 `rotateManagerSession`/`btwAsk` 在 types.ts、handlers、index.ts 三处一致。
