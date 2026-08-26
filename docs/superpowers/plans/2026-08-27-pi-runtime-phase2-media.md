# Pi Runtime Phase 2：媒体 Agent 消费 AgentRuntime Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 媒体 agent（A2A）执行后端从"单次 ModelRuntime.complete"升级为"AgentRuntime 会话"——图片追问在同一 AgentSession 内连续 prompt（真多轮记忆）；视频/音频保持已验证的 complete + fixMediaPayload 路径（wire 重写不在 AgentSession 面内验证，回退保底）。`media.engine: pi` 路由接入。

**Architecture:** 新增 `gateway/src/media/media-runtime-executor.ts`（实现现有 `PromptFn` 接口，内部维护会话 Map + 超时 + cancel hook）。`MediaAgent`/`MediaService` 的调用面**零改动**——executor 作为 `MediaServiceDeps.prompt` 注入。`media-engine` 路由：现有 `resolvePrompt` 钩子加 `engine === 'pi'` 分支返回 executor 的 prompt。`media-agent.ts` 的 `cancelTask` 小改：若 executor 有 `cancel()` 则调用（中止会话）。超时：`Promise.race`（默认 180s，pluginConfig 可配）+ `session.abort()`。

**Tech Stack:** TypeScript（gateway 编译为 CJS，tsc）、jest + ts-jest、pi-coding-agent（ESM 桥）。

## Global Constraints

- **行为保持不变**：media-plugin 系统（`~/.mafw/media-plugins/*.js` 自定义引擎）继续工作；默认引擎仍是 pi；opencode 路径全程不变。
- 不新增任何 npm 依赖。
- **`PromptFn` 接口不变**：`(parts: PromptPart[], opts: PromptOptions) => Promise<string>`（media-service.ts:67）。
- **`MediaInput`/`MediaConfig` 不变**：media-service.ts:51 / :40。
- gateway 源码静态导入不带 `.js` 后缀；动态 `import()` 保持 `.js` 后缀风格。
- 测试放 `tests/unit/gateway/`（导入 `../../../gateway/src/...` 不带 `.js`）或 `gateway/tests/unit/`。
- **git commit 步骤默认挂起**：每个任务的 "Commit" 步骤需在执行前向用户确认后才执行。
- 会话键：`hash(dataUrl + providerID + modelID)`——同一媒体的追问复用同一 AgentSession（媒体不重传）。
- 图片（image）走 AgentSession；视频/音频（video/audio）走 `ModelRuntime.complete` + `fixMediaPayload`（保持 Phase 1 前的已验证路径）。
- 超时默认 180s（与 pi-adapter 一致），`Promise.race` + `session.abort()`。

---

### Task 1: MediaRuntimeExecutor（PromptFn 实现）

**Files:**
- Create: `gateway/src/media/media-runtime-executor.ts`
- Test: `gateway/tests/unit/media-runtime-executor.test.ts`

**Interfaces:**
- Consumes: `PromptFn` / `PromptPart` / `PromptOptions`（media-service.ts）、`AgentRuntime`（runtime/contract.ts）、`fixMediaPayload`（pi-adapter.ts）
- Produces: `class MediaRuntimeExecutor`——`prompt: PromptFn`、`cancel(key: string): Promise<void>`、`dispose(): Promise<void>`、`deps` 可注入（测试 mock AgentRuntime）
- Produces: `createMediaRuntimeExecutor(rt: AgentRuntime, opts?): MediaRuntimeExecutor`

**会话管理：**
- `Map<string, { sessionID: string; kind: MediaKind; dataUrl: string; createdAt: number }>`
- key = `sha256(dataUrl + providerID + modelID).slice(0, 16)`
- 首轮（无 key 命中）：`rt.session.create({ directory })` + `rt.session.promptAsync({ sessionID, parts: [FilePart(媒体), TextPart(问题)] })` + 取 messages 最新 assistant 文本
- 追问（key 命中）：`rt.session.promptAsync({ sessionID, message: 文本 })` + 取最新 assistant 文本
- TTL GC：`opts.sessionTtlMs`（默认 24h），prompt 前惰性清理过期项
- 超时：`Promise.race([分析, timeout(180s)])` → 超时调 `rt.session.abort(sessionID)` + 抛错
- video/audio：不建会话，直接 `complete` 路径（deps.completeFn 可注入，默认 pi-adapter 风格）

- [ ] **Step 1: Write the failing test**

```ts
// tests/unit/gateway/media-runtime-executor.test.ts
import { createMediaRuntimeExecutor } from '../../../gateway/src/media/media-runtime-executor';
import type { AgentRuntime } from '../../../gateway/src/runtime/contract';

const fakeRuntime = (): AgentRuntime => {
  const sessions = new Map<string, any>();
  return {
    name: 'pi',
    capabilities: {} as any,
    external: true,
    session: {
      create: async () => { const id = `pi_${sessions.size}`; sessions.set(id, { msgs: [] }); return { id }; },
      promptAsync: async (opts: any) => { const s = sessions.get(opts.sessionID); s.msgs.push({ role: 'user', content: [{ type: 'text', text: opts.message ?? '' }] }); s.msgs.push({ role: 'assistant', content: [{ type: 'text', text: `answer-${s.msgs.length}` }] }); },
      prompt: async () => ({ parts: [] }),
      messages: async (opts: any) => ({ data: sessions.get(opts.sessionID).msgs }),
      get: async () => ({}), delete: async () => {}, abort: jest.fn(async () => {}),
      list: async () => [], todo: async () => [], children: async () => [], summarize: async () => ({}),
    } as any,
    global: { event: async () => ({ stream: [] }) } as any,
    provider: { list: async () => ({ all: [], connected: [], default: {} }) } as any,
    app: { agents: async () => [] } as any,
    config: { get: async () => ({}), update: async () => ({}) } as any,
    getBaseUrl: () => 'http://127.0.0.1:3000',
  } as any;
};

describe('MediaRuntimeExecutor', () => {
  it('first image turn creates session and returns assistant text', async () => {
    const rt = fakeRuntime();
    const ex = createMediaRuntimeExecutor(rt as any, { sessionTtlMs: 60000 });
    const out = await ex.prompt(
      [{ type: 'file', url: 'data:image/png;base64,AAAA', mime: 'image/png' }, { type: 'text', text: 'what is this?' }],
      { providerID: 'xiaomi', modelID: 'mimo-v2.5' },
    );
    expect(out).toContain('answer-');
  });

  it('follow-up for the same media reuses the session (no new create)', async () => {
    const rt = fakeRuntime();
    const ex = createMediaRuntimeExecutor(rt as any, { sessionTtlMs: 60000 });
    const createSpy = jest.spyOn(rt.session, 'create');
    await ex.prompt([{ type: 'file', url: 'data:image/png;base64,AAAA', mime: 'image/png' }], { providerID: 'xiaomi', modelID: 'mimo-v2.5' });
    await ex.prompt([{ type: 'text', text: 'tell me more' }], { providerID: 'xiaomi', modelID: 'mimo-v2.5' });
    expect(createSpy).toHaveBeenCalledTimes(1);
  });

  it('cancel aborts the session for a media key', async () => {
    const rt = fakeRuntime();
    const ex = createMediaRuntimeExecutor(rt as any, { sessionTtlMs: 60000 });
    await ex.prompt([{ type: 'file', url: 'data:image/png;base64,AAAA', mime: 'image/png' }], { providerID: 'xiaomi', modelID: 'mimo-v2.5' });
    await ex.cancel('sha256(data:image/png;base64,AAAA\x00xiaomi\x00mimo-v2.5)'.slice(0, 16));
    expect(rt.session.abort).toHaveBeenCalled();
  });

  it('video media falls back to completeFn without session', async () => {
    const completeFn = jest.fn(async () => 'video analysis');
    const rt = fakeRuntime();
    const ex = createMediaRuntimeExecutor(rt as any, { completeFn, sessionTtlMs: 60000 });
    const out = await ex.prompt(
      [{ type: 'file', url: 'data:video/mp4;base64,AAAA', mime: 'video/mp4' }],
      { providerID: 'xiaomi', modelID: 'mimo-v2.5' },
    );
    expect(out).toBe('video analysis');
    expect(completeFn).toHaveBeenCalled();
    expect(rt.session.create).not.toHaveBeenCalled();
  });

  it('dispose clears all sessions', async () => {
    const rt = fakeRuntime();
    const ex = createMediaRuntimeExecutor(rt as any, { sessionTtlMs: 60000 });
    await ex.prompt([{ type: 'file', url: 'data:image/png;base64,AAAA', mime: 'image/png' }], { providerID: 'xiaomi', modelID: 'mimo-v2.5' });
    await ex.dispose();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest tests/unit/gateway/media-runtime-executor.test.ts`（root 级）
Expected: FAIL — Cannot find module

- [ ] **Step 3: Implement MediaRuntimeExecutor**

```ts
// gateway/src/media/media-runtime-executor.ts
import { createHash } from 'crypto';
import type { PromptFn, PromptPart, PromptOptions } from './media-service';
import type { AgentRuntime } from '../runtime/contract';
import { fixMediaPayload } from './pi-adapter';
import { readOpencodeAuth, DEFAULT_AUTH_PATH } from './auth-util';
import { log } from '../core/utils/logger';

export interface MediaRuntimeExecutorOptions {
  /** 会话 TTL（默认 24h） */
  sessionTtlMs?: number;
  /** 单次分析超时（默认 180s） */
  timeoutMs?: number;
  /** video/audio 单次路径（默认内部 complete 实现） */
  completeFn?: (parts: PromptPart[], opts: PromptOptions) => Promise<string>;
  /** auth.json 路径（默认 DEFAULT_AUTH_PATH） */
  authPath?: string;
}

interface SessionEntry {
  sessionID: string;
  kind: string;
  dataUrl: string;
  createdAt: number;
}

export function mediaSessionKey(dataUrl: string, providerID: string, modelID: string): string {
  return createHash('sha256').update(dataUrl).update('\x00').update(providerID).update('\x00').update(modelID).digest('hex').slice(0, 16);
}

export class MediaRuntimeExecutor {
  private sessions = new Map<string, SessionEntry>();
  private readonly ttlMs: number;
  private readonly timeoutMs: number;

  constructor(
    private readonly rt: AgentRuntime,
    private readonly opts: MediaRuntimeExecutorOptions = {},
    private readonly completeFn: (parts: PromptPart[], opts: PromptOptions) => Promise<string>,
  ) {
    this.ttlMs = opts.sessionTtlMs ?? 24 * 60 * 60 * 1000;
    this.timeoutMs = opts.timeoutMs ?? 180_000;
  }

  /** PromptFn 实现——MediaService 注入点。 */
  prompt: PromptFn = async (parts, opts) => {
    const filePart = parts.find((p) => p.type === 'file');
    const textPart = parts.find((p) => p.type === 'text');
    const kind = this.kindOf(filePart);

    // video/audio：单次 complete 路径（fixMediaPayload wire 重写，已验证）
    if (kind !== 'image' || !filePart) {
      return this.withTimeout('media analysis', () => this.completeFn(parts, opts));
    }

    const dataUrl = String(filePart.url ?? '');
    const key = mediaSessionKey(dataUrl, opts.providerID, opts.modelID);
    this.gc();
    let entry = this.sessions.get(key);

    try {
      if (!entry) {
        const { id } = await this.rt.session.create({ directory: undefined });
        entry = { sessionID: id, kind, dataUrl, createdAt: Date.now() };
        this.sessions.set(key, entry);
        // 首轮：媒体 + 文本一起发
        await this.rt.session.promptAsync({
          sessionID: id,
          parts: [{ type: 'file', url: dataUrl, mime: filePart.mime }, ...(textPart ? [{ type: 'text', text: String(textPart.text ?? '') }] : [])],
        });
      } else {
        const text = textPart ? String(textPart.text ?? '') : '请描述这个媒体内容。';
        await this.rt.session.promptAsync({ sessionID: entry.sessionID, message: text });
      }
      return this.withTimeout('fetch latest assistant message', async () => {
        const { data } = await this.rt.session.messages({ sessionID: entry!.sessionID });
        const latest = [...data].reverse().find((m: any) => m?.role === 'assistant');
        const text = (latest?.content || []).map((c: any) => c?.text ?? '').join('\n').trim();
        return text || '（无文本输出）';
      });
    } catch (err: any) {
      if (entry) await this.cancel(key);
      log.error(`[MediaRuntimeExecutor] analysis failed: ${err?.message ?? String(err)}`);
      throw err;
    }
  };

  /** A2A cancelTask 调用：中止指定媒体会话。 */
  async cancel(key: string): Promise<void> {
    const entry = this.sessions.get(key);
    if (entry) {
      try { await this.rt.session.abort({ sessionID: entry.sessionID }); } catch { /* ignore */ }
    }
  }

  async dispose(): Promise<void> {
    for (const entry of this.sessions.values()) {
      try { await this.rt.session.delete({ sessionID: entry.sessionID }); } catch { /* ignore */ }
    }
    this.sessions.clear();
  }

  private kindOf(filePart?: PromptPart): string {
    if (!filePart) return 'text';
    const mime = String(filePart.mime ?? filePart.url ?? '');
    if (mime.startsWith('video/')) return 'video';
    if (mime.startsWith('audio/')) return 'audio';
    return 'image';
  }

  private gc(): void {
    const now = Date.now();
    for (const [key, entry] of this.sessions) {
      if (now - entry.createdAt > this.ttlMs) {
        this.sessions.delete(key);
        try { void this.rt.session.delete({ sessionID: entry.sessionID }); } catch { /* ignore */ }
      }
    }
  }

  private async withTimeout<T>(label: string, fn: () => Promise<T>): Promise<T> {
    let timer: NodeJS.Timeout | undefined;
    try {
      return await Promise.race([
        fn(),
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => reject(new Error(`${label} timed out after ${this.timeoutMs}ms`)), this.timeoutMs);
        }),
      ]);
    } finally {
      if (timer) clearTimeout(timer);
    }
  }
}

export function createMediaRuntimeExecutor(
  rt: AgentRuntime,
  opts: MediaRuntimeExecutorOptions = {},
): MediaRuntimeExecutor {
  const authPath = opts.authPath ?? DEFAULT_AUTH_PATH();
  const completeFn = opts.completeFn ?? (async (parts: PromptPart[], po: PromptOptions) => {
    // pi-adapter 风格单次分析（video/audio wire 重写）
    const { createPiPromptAdapter } = await import('./pi-adapter.js');
    const adapter = createPiPromptAdapter({ fixPayload: fixMediaPayload, authPath });
    return adapter(parts, po);
  });
  return new MediaRuntimeExecutor(rt, opts, completeFn);
}
```

> 注意：`createPiPromptAdapter` 默认从 auth.json 取 key——与 Phase 1 的 credentials 链一致（executor 复用既有 pi-adapter 认证逻辑）。若 MediaService 传入时已带 credentials，可后续注入。

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest tests/unit/gateway/media-runtime-executor.test.ts`
Expected: PASS, 5/5

- [ ] **Step 5: Verify build**

Run: `npm run build`（根目录）
Expected: exit 0

- [ ] **Step 6: Commit（挂起，需用户确认）**

```bash
git add gateway/src/media/media-runtime-executor.ts tests/unit/gateway/media-runtime-executor.test.ts
git commit -m "feat(media): add MediaRuntimeExecutor (AgentRuntime-backed PromptFn)"
```

---

### Task 2: media.engine 路由接入（resolvePrompt 'pi' 分支）

**Files:**
- Modify: `gateway/src/index.ts`（MediaService 构造处 resolvePrompt 注入）
- Test: `tests/unit/gateway/media-engine-routing.test.ts`

**Interfaces:**
- Consumes: `createMediaRuntimeExecutor`（Task 1）、`MediaServiceDeps.resolvePrompt`（media-service.ts:113）
- Produces: `resolvePrompt(kind, cfg)` 中 `cfg.engine === 'pi'`（或未指定引擎时的默认）返回 executor 的 prompt；其他引擎名走现有 media-plugin 查找

**路由语义（现有 media-service.ts:168-169 已支持）：**
```
engineName = cfg[kind]?.engine ?? cfg.engine ?? 'pi'
promptFn = resolvePrompt(kind, cfg) ?? deps.prompt
```
- `resolvePrompt` 返回 undefined → 用默认 `deps.prompt`（现有 pi-adapter 或插件引擎）
- `resolvePrompt` 返回非 undefined（runtime 引擎）→ 用它

**实现：** index.ts 中创建 MediaService 时：
1. 若激活 runtime 是 pi（`runtime.name === 'pi'`）→ `resolvePrompt` 返回 `createMediaRuntimeExecutor(runtime)` 的 prompt（image 会话；video/audio 走 complete）
2. 否则 → 返回 undefined（现有行为）

**注意：** `cfg.engine` 在 media 配置段默认 'pi'——所以 **pi runtime 激活时默认就走 executor**；非 pi runtime 保持现状（media-plugin 引擎或 pi-adapter）。

- [ ] **Step 1: Write the failing test**

```ts
// tests/unit/gateway/media-engine-routing.test.ts
import { mediaEngineResolverFor } from '../../../gateway/src/index';

jest.mock('../../../gateway/src/core/utils/logger', () => ({
  log: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));

describe('mediaEngineResolverFor', () => {
  it('returns a prompt fn when runtime is pi', async () => {
    const rt = { name: 'pi', session: { create: jest.fn(), promptAsync: jest.fn(), messages: jest.fn(async () => ({ data: [] })) } } as any;
    const resolver = await mediaEngineResolverFor(rt);
    expect(typeof resolver).toBe('function');
    const fn = resolver('image', { provider: 'xiaomi', model: 'mimo-v2.5' } as any);
    expect(typeof fn).toBe('function');
  });

  it('returns undefined when runtime is not pi', async () => {
    const rt = { name: 'opencode' } as any;
    const resolver = await mediaEngineResolverFor(rt);
    expect(resolver).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest tests/unit/gateway/media-engine-routing.test.ts`
Expected: FAIL — `mediaEngineResolverFor` 不存在

- [ ] **Step 3: 导出 mediaEngineResolverFor + index.ts 接线**

```ts
// gateway/src/index.ts 新增导出函数（或独立小模块）
import { MediaService, MediaKind, MediaConfig, PromptFn } from './media/media-service';
import { createMediaRuntimeExecutor } from './media/media-runtime-executor';
import type { AgentRuntime } from './runtime/contract';

export async function mediaEngineResolverFor(rt: AgentRuntime | null | undefined): Promise<(kind: MediaKind, cfg: MediaConfig) => PromptFn | undefined> {
  if (rt?.name !== 'pi') return () => undefined;
  const executor = createMediaRuntimeExecutor(rt);
  return (kind: MediaKind, cfg: MediaConfig) => executor.prompt;
}
```

```ts
// index.ts 中 MediaService 构造处（现有 createMediaService / 组装点）：
// 在 runtime 创建后（opencodeClient 赋值后），构造 resolver 并注入
const mediaResolver = await mediaEngineResolverFor(runtime);
// ... 传给 MediaService deps: { prompt, resolvePrompt: mediaResolver }
```

> 接线点以现有 MediaService 创建位置为准（grep `new MediaService` 找）。executor 生命周期与 gateway 同寿（stop 时 dispose 可选，随进程退出）。

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest tests/unit/gateway/media-engine-routing.test.ts`
Expected: PASS, 2/2

- [ ] **Step 5: Verify build + 回归**

Run: `npm run build`（根目录）→ exit 0
Run: `npx jest tests/unit/gateway/media-*.test.ts`（root，media 相关）→ 全部通过

- [ ] **Step 6: Commit（挂起，需用户确认）**

```bash
git add gateway/src/index.ts tests/unit/gateway/media-engine-routing.test.ts
git commit -m "feat(media): route media.engine=pi to AgentRuntime executor"
```

---

### Task 3: cancelTask 接线（A2A 取消 → executor.cancel）

**Files:**
- Modify: `gateway/src/media/media-agent.ts`（cancelTask）
- Test: `tests/unit/gateway/media-agent-cancel.test.ts`

**Interfaces:**
- Consumes: `MediaAgentOptions.cancelHook?: (taskId: string) => Promise<void>`（新增可选）
- Produces: cancelTask 中调用 `this.options.cancelHook?.(taskId)`（fail-open）

**实现：**
1. `MediaAgentOptions` 加 `cancelHook?: (taskId: string) => Promise<void>`
2. `cancelTask(taskId, bus)` 中：现有逻辑（load + 标记 CANCELED）后，`try { await this.options.cancelHook?.(taskId); } catch { /* ignore */ }`
3. index.ts 组装 MediaAgent 时：cancelHook 调 executor 的 cancel（按 taskId → media key 映射，需要 MediaAgent 侧能拿到 key——简化：executor 暴露 `cancelAll()` 或按 taskId 登记）

**简化方案：** executor 增加 `sessionsByTask: Map<taskId, key>`？——过重。改为：**cancelHook 直接调 executor.dispose() 太重；改为 executor 增加 `cancelLatest()` 取消最近会话**？不精确。

**更简单的正确方案：** MediaAgent execute() 已持有 key 上下文（resolveMedia 后有 dataUrl + provider/model）——但 executor 的 key 计算在 executor 内部。让 executor 暴露 `cancelForDataUrl(dataUrl, providerID, modelID)`，MediaAgent 在 cancelTask 时无从知晓 dataUrl。

**最终方案（务实）：** cancelHook 语义 = "取消进行中的分析"。executor 维护 `inflight: Map<key, Promise>` 并在 prompt 开始时登记、结束时清除；`cancelInflight()` 中止所有进行中会话。MediaAgent cancelTask → `cancelHook?.()` → `executor.cancelInflight()`。粒度粗但语义正确（A2A 取消本来就是任务级，且媒体分析通常单并发）。

- [ ] **Step 1: Write the failing test**

```ts
// tests/unit/gateway/media-agent-cancel.test.ts
// mock MediaAgent 构造 + cancelHook 被调用
// executor.cancelInflight 中止进行中的 prompt
```

- [ ] **Step 2: Run test to verify it fails**
- [ ] **Step 3: 实现 cancelHook + cancelInflight**

```ts
// media-runtime-executor.ts 增加：
private inflight = new Set<string>();
// prompt 开始时：this.inflight.add(key); 结束时 finally delete
async cancelInflight(): Promise<void> {
  for (const key of this.inflight) await this.cancel(key);
  this.inflight.clear();
}
```

```ts
// media-agent.ts：
// MediaAgentOptions 加 cancelHook?: (taskId: string) => Promise<void>;
// cancelTask 末尾：
try { await this.options.cancelHook?.(taskId); } catch { /* fail-open */ }
```

```ts
// index.ts MediaAgent 组装处：
cancelHook: async () => { await executor?.cancelInflight(); },
```

- [ ] **Step 4: Run test to verify it passes**
- [ ] **Step 5: Verify build + 回归**

Run: `npm run build` + `npx jest tests/unit/gateway/media-agent.test.ts`（既有）+ 新测试

- [ ] **Step 6: Commit（挂起，需用户确认）**

```bash
git add gateway/src/media/media-agent.ts gateway/src/media/media-runtime-executor.ts tests/unit/gateway/media-agent-cancel.test.ts
git commit -m "feat(media): wire A2A cancelTask to executor cancelInflight"
```

---

### Task 4: 集成验证 + 文档

**Files:**
- Modify: `gateway/tests/unit/media-runtime-executor.test.ts`（补 cancelInflight 测试）
- Modify: `AGENTS.md`（§5.14 补 MediaRuntimeExecutor 记录）

- [ ] **Step 1: 补 cancelInflight 测试**

```ts
it('cancelInflight aborts in-flight sessions', async () => {
  // 慢 prompt（未 resolve）→ cancelInflight → abort 被调
});
```

- [ ] **Step 2: Verify 全量**

Run: `npm run build`（根目录）→ exit 0
Run: `npx jest --runInBand tests/unit/runtime/`（gateway）→ 全绿（46）
Run: `npx jest tests/unit/gateway/media-*.test.ts`（root）→ 全绿
Run: root 级 runtime 回归 → 全绿（54）

- [ ] **Step 3: 更新 AGENTS.md §5.14**

在媒体系统段落追加：

```markdown
- **MediaRuntimeExecutor**（`gateway/src/media/media-runtime-executor.ts`）：媒体 agent 的
  AgentRuntime 后端——`media.engine: pi`（默认）时 `resolvePrompt` 返回 executor 的 PromptFn；
  图片追问在同一 AgentSession 内连续 prompt（真多轮记忆，同一 dataUrl 复用会话）；
  视频/音频保持 ModelRuntime.complete + fixMediaPayload 单次路径；超时 180s + abort；
  A2A cancelTask → cancelInflight 中止进行中会话
```

- [ ] **Step 4: Commit（挂起，需用户确认）**

```bash
git add AGENTS.md gateway/tests/unit/media-runtime-executor.test.ts
git commit -m "docs(media): document MediaRuntimeExecutor in §5.14"
```

---

## 收尾验证

- [ ] `npm run build` exit 0
- [ ] gateway runtime 46/46 + media 相关全绿
- [ ] root media 测试全绿 + runtime 回归 54/54
- [ ] 无新增 TODO

## 验收标准（规格 §13 Phase 2 范围）

1. 图片首轮/追问走 AgentRuntime 会话（同一 dataUrl 复用，create 仅一次）
2. 视频/音频走 complete + fixMediaPayload（单次，wire 重写不回归）
3. A2A cancelTask → executor abort（cancelInflight）
4. `media.engine` 支持 pi（runtime 名）与其他插件引擎名双路由
5. opencode 路径全程行为不变（回归全绿）