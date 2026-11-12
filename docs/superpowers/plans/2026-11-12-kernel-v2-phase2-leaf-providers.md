# Kernel v2 Phase 2 Leaf Providers Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把 media、ASR、commands、notifications、automation action 从内核组合根中拆成 kernel-v2 可替换 provider，并用 S3 子进程 probe 证明“provider 拥有子进程”时生命周期、ledger、health、fallback 成立。

**Architecture:** 延续路线 B：所有新代码在 `gateway/src/kernel-v2/` 与独立测试中，不接 live gateway、不写 `~/.mafw`。Provider 实现可以 import v1 叶子实现（sidecar/engine/media/commands），但 kernel-v2 核心文件不得 import provider；消费者只通过 capability adapter 解析。S3 先于 ASR；media 先于其余 provider。每个 provider 有默认实现、可替换实现、health、fallback、dispose、diagnostics 和 conformance kit。

**Tech Stack:** TypeScript / Node、Jest（gateway）、`@mafw/plugin-contract`、现有 `MediaService` / `MediaPluginLoader` / `AsrEngine` / `Qwen3AsrSidecar` / `custom-commands` / `AutomationEngine` 类型、`http` 内置模块。

**Spec:** `docs/superpowers/specs/2026-11-12-fixed-core-capability-architecture-design.md`

**Roadmap:** `docs/superpowers/plans/2026-11-12-fixed-core-capability-roadmap.md`

## Global Constraints

- 路线 B：Phase 2 仍只在 `gateway/src/kernel-v2/` 做进程内并行模块，**不接 live gateway、不碰 `~/.mafw` 数据、不写 live DB**。
- v1 路径是 fallback：不改 `gateway/src/kernel.ts`、`boot.ts`、`http/transport.ts`、`voice/registry.ts`、`media/media-plugin-loader.ts`、`commands/custom-commands.ts`、`automation-engine.ts` 的现有行为。
- 核心不变量不可替换：人类验收、审批/权限/审计、记忆 soft supersede / T1 / 100ms recall、canonical 事件顺序、DB 迁移、`planHash`/`evalHash`、desktop preload/webview sandbox、runtime 四条。
- `kernel-v2/*.ts` 核心文件不得 import `kernel-v2/providers/**`；provider 不得 import v1 组合根（`kernel.ts` / `boot.ts` / `http/transport.ts`）。
- Provider 可以 import v1 叶子模块（`media/media-service`、`media/media-plugin-loader`、`voice/types`、`voice/engines/asr/qwen3-vllm`、`voice/sidecar/qwen3-asr-sidecar`、`commands/custom-commands`、`automation-engine` 的纯类型），但不得 import 单例或组合根。
- 所有生产代码先写失败测试，再实现；每个 task 结束提交。
- 每个 provider 必须有：Service Definition、default provider、replaceable provider、health、fallback、dispose、diagnostics、conformance kit。
- `untrusted` provider 在 Phase 6 worker 隔离前 **fail-closed 拒绝**，不得静默回退进程内。
- 子进程 provider 必须满足：失败启动不留 orphan；adopted 进程永不 kill；stop/dispose 幂等；kill 失败隔离并进 diagnostics。
- 全量门禁：每个 milestone 结束跑定向测试；G2 前在 canonical build 上连续 2 次 clean full-suite。
- 任何实现与 spec 冲突时，以 spec 为准并先改 spec。

## Review Focus

- **Provider 拥有子进程**：sidecar 启动失败、健康超时、进程中途退出、重复 stop、外部 adopted 进程，五种情况下都不能留 orphan，也不能把健康检查拖进 boot 主链。
- **Media 语义不变**：未知 engine、engine 不支持该 modality、`builtinPi` 未激活时，`MediaService.analyze()` 的 fallback 行为必须与 v1 `resolveMediaPrompt` 一致，不改变 HTTP/DTO/缓存 key。
- **Scope 不泄漏**：project/session 级 media/ASR/commands provider 不得被其他 project/session 解析到；global fallback 必须显式。
- **Notification 失败隔离**：一个 channel 抛错/超时不能阻止其他 channel，也不能把异常抛回 broadcast 热路径；事件 payload 不含 secret。
- **Automation action 移除**：规则引用的 action 被 unregister 后，执行必须返回 `missing`/error，而不是崩溃或静默成功。
- **Commands 合并顺序**：project 覆盖 user、package 覆盖 legacy、单个坏 source 不擦除其他命令；watcher dispose 后不再触发更新。

---

## File Structure

```text
gateway/src/kernel-v2/
  subprocess-ledger.ts          # 新增：子进程所有权/状态/ledger/dispose
  probes/
    asr-subprocess.ts           # 新增：S3 sidecar-owning provider probe
  providers/
    media.ts                    # 新增：media capability adapter + register helper
    asr.ts                      # 新增：ASR capability adapter + register helper
    asr-sidecar.ts              # 新增：sidecar provider 与 AsrCapability 的绑定
    commands.ts                 # 新增：command source capability
    notifications.ts            # 新增：fan-out notification channel capability
    automation.ts               # 新增：automation action provider capability
gateway/tests/helpers/kernel-v2/
  media-conformance.ts          # 新增：media conformance kit
  asr-conformance.ts            # 新增：ASR conformance kit
  commands-conformance.ts       # 新增：commands conformance kit
  notifications-conformance.ts  # 新增：notifications conformance kit
  automation-conformance.ts     # 新增：automation conformance kit
gateway/tests/fixtures/kernel-v2/
  media-echo-provider.ts        # 新增：测试包 provider（不改核心替换 media）
  asr-fake-provider.ts          # 新增：测试包 provider（替换 ASR）
  command-package-source.ts     # 新增：测试包 command source
  notification-webhook-channel.ts # 新增：测试包 notification channel
  automation-echo-action.ts     # 新增：测试包 automation action
gateway/tests/integration/
  kernel-v2-g2.test.ts          # 新增：G2 “测试包替换内置 provider”证明
docs/research/
  2026-11-12-s3-asr-subprocess-probe.md  # 新增：S3 结论
docs/releases/
  2026-11-12-capability-kernel-phase2.md # 新增：交付记录
```

> 说明：`embedding` / `reranker` 从 Phase 2 移到 Phase 5。它们是 memory 的有状态部分，会提前触碰进程级单例和回填；Phase 2 只做无状态/短生命周期叶子 provider。本计划同时更新路线图这一处。

---

## Milestone 2A：S3 子进程 probe

### Task 2.1：SubprocessLedger（核心服务）

**Files:**
- Create: `gateway/src/kernel-v2/subprocess-ledger.ts`
- Test: `gateway/tests/unit/kernel-v2/subprocess-ledger.test.ts`

**Interfaces:**
- Produces:
```ts
export type SubprocessOwnership = "provider" | "external"
export type SubprocessState = "starting" | "running" | "stopped" | "failed"

export interface SubprocessHandle {
  pid?: number
  stop(): Promise<void>
  stopSync?(): void
}

export interface SubprocessRecord {
  id: string
  pid?: number
  ownership: SubprocessOwnership
  state: SubprocessState
  startedAt: number
  stoppedAt?: number
  reason?: string
}

export class SubprocessLedger {
  track(id: string, handle: SubprocessHandle, ownership?: SubprocessOwnership): void
  adopt(id: string, handle: SubprocessHandle): void
  markRunning(id: string): void
  markFailed(id: string, reason: string): void
  markStopped(id: string, reason?: string): void
  snapshot(): SubprocessRecord[]
  active(): SubprocessRecord[]
  dispose(): Promise<Array<{ id: string; error: string }>>
}
```
- `track` 重复 id 抛 `subprocess already tracked: <id>`，防止覆盖泄漏。
- `dispose()` 按注册逆序 stop 所有 `ownership: "provider"` 的记录；`external` 只标记 stopped，不调用 stop；stop 抛错进返回数组，继续处理下一条；重复调用返回空数组。
- 不 import 任何 v1 模块。

- [ ] **Step 1: 写失败测试**

```ts
import { SubprocessLedger, type SubprocessHandle } from '../../../src/kernel-v2/subprocess-ledger'

function handle(pid: number, over: Partial<SubprocessHandle> = {}): SubprocessHandle {
  return { pid, stop: async () => {}, ...over }
}

describe('SubprocessLedger', () => {
  test('tracks a spawned child and exposes it as active', () => {
    const ledger = new SubprocessLedger()
    ledger.track('qwen3', handle(1234))
    ledger.markRunning('qwen3')
    expect(ledger.active()).toEqual([
      expect.objectContaining({ id: 'qwen3', pid: 1234, ownership: 'provider', state: 'running' }),
    ])
  })

  test('rejects duplicate ids instead of overwriting a live handle', () => {
    const ledger = new SubprocessLedger()
    ledger.track('qwen3', handle(1))
    expect(() => ledger.track('qwen3', handle(2))).toThrow(/already tracked/)
  })

  test('adopted processes are never stopped by dispose', async () => {
    let stops = 0
    const ledger = new SubprocessLedger()
    ledger.adopt('external', handle(9, { stop: async () => { stops += 1 } }))
    await ledger.dispose()
    expect(stops).toBe(0)
    expect(ledger.snapshot()[0]).toMatchObject({ ownership: 'external', state: 'stopped' })
  })

  test('dispose stops owned processes in reverse order and isolates failures', async () => {
    const order: string[] = []
    const ledger = new SubprocessLedger()
    ledger.track('a', handle(1, { stop: async () => { order.push('a') } }))
    ledger.track('b', handle(2, { stop: async () => { order.push('b'); throw new Error('boom') } }))
    const errors = await ledger.dispose()
    expect(order).toEqual(['b', 'a'])
    expect(errors).toEqual([{ id: 'b', error: 'boom' }])
    await expect(ledger.dispose()).resolves.toEqual([])
  })

  test('failed and stopped records stay in the snapshot for diagnostics', () => {
    const ledger = new SubprocessLedger()
    ledger.track('a', handle(1))
    ledger.markFailed('a', 'health timeout')
    ledger.track('b', handle(2))
    ledger.markStopped('b')
    expect(ledger.active()).toEqual([])
    expect(ledger.snapshot()).toEqual([
      expect.objectContaining({ id: 'a', state: 'failed', reason: 'health timeout' }),
      expect.objectContaining({ id: 'b', state: 'stopped' }),
    ])
  })
})
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npx jest --runInBand tests/unit/kernel-v2/subprocess-ledger.test.ts`
Expected: FAIL — `Cannot find module .../subprocess-ledger`

- [ ] **Step 3: 实现 `SubprocessLedger`**

实现要点：内部用 `Map<string, { record; handle }>` 保持插入顺序；`dispose` 用 `[...map.values()].reverse()`；`markRunning` 只允许 `starting` → `running`，非法迁移抛错；`startedAt` 用 `Date.now()`。

- [ ] **Step 4: 跑测试确认通过**

Run: `npx jest --runInBand tests/unit/kernel-v2/subprocess-ledger.test.ts`
Expected: PASS（5 tests）

- [ ] **Step 5: 提交**

```bash
git add gateway/src/kernel-v2/subprocess-ledger.ts gateway/tests/unit/kernel-v2/subprocess-ledger.test.ts
git commit -m "feat(kernel-v2): add subprocess ledger"
```

---

### Task 2.2：S3 sidecar-owning ASR provider probe

**Files:**
- Create: `gateway/src/kernel-v2/probes/asr-subprocess.ts`
- Test: `gateway/tests/unit/kernel-v2/asr-subprocess-probe.test.ts`
- Consumes: `ProviderHandle` from `gateway/src/kernel-v2/provider-lifecycle.ts`; `SubprocessLedger` from Task 2.1; `AsrEngine` from `gateway/src/voice/types.ts`

**Interfaces:**
- Produces:
```ts
export interface SidecarLike {
  start(): Promise<void>
  stop(): Promise<void>
  stopSync?(): void
  isReady(): Promise<boolean>
  isExternal?(): boolean
  readonly pid?: number
}

export interface AsrSidecarProviderOptions {
  id: string
  sidecar: SidecarLike
  engine: AsrEngine
  ledger: SubprocessLedger
  startupTimeoutMs?: number
}

export interface AsrSidecarProvider extends ProviderHandle {
  readonly engine: AsrEngine
  readonly sidecar: SidecarLike
  startOnce(): Promise<void>
}

export function createAsrSidecarProvider(options: AsrSidecarProviderOptions): AsrSidecarProvider
```
- `load()` 只做校验（engine.name 非空、capabilities 合法），不 spawn。
- `activate()` 调 `startOnce()`；`startOnce` 用 `Promise` 缓存并发调用，成功后 `ledger.track` 或 `ledger.adopt`。
- `deactivate()`：owned 时 `sidecar.stop()`；external 时不 stop；`ledger.markStopped`；幂等。
- `health()`：`sidecar.isReady()` 为 true 且 ledger 非 failed → `healthy`；否则 `failed`。
- `dispose()`：`deactivate()` 后再 `sidecar.stopSync?.()` 仅当 owned；幂等。

- [ ] **Step 1: 写失败测试**

```ts
import { createAsrSidecarProvider } from '../../../src/kernel-v2/probes/asr-subprocess'
import { SubprocessLedger } from '../../../src/kernel-v2/subprocess-ledger'
import type { AsrEngine } from '../../../src/voice/types'

function engine(name = 'qwen3-asr-vllm'): AsrEngine {
  return {
    name,
    capabilities: { streaming: 'native', languages: ['zh'], punctuation: true, timestamps: 'none', sampleRate: 16000 },
    isAvailable: async () => ({ ok: true }),
    createStream: () => ({ push: () => {}, end: async () => ({ text: '', durationMs: 0, engine: name, final: true }), abort: () => {}, onPartial: () => {} }),
    transcribe: async () => ({ text: '', durationMs: 0, engine: name, final: true }),
  }
}

function sidecar(over: Record<string, unknown> = {}) {
  const calls = { start: 0, stop: 0, stopSync: 0 }
  const value = {
    pid: 4321,
    async start() { calls.start += 1 },
    async stop() { calls.stop += 1 },
    stopSync() { calls.stopSync += 1 },
    async isReady() { return true },
    isExternal() { return false },
    ...over,
  }
  return { value, calls }
}

describe('S3 ASR sidecar provider', () => {
  test('load does not spawn; activate starts exactly once under concurrency', async () => {
    const { value, calls } = sidecar()
    const provider = createAsrSidecarProvider({ id: 'qwen3', sidecar: value, engine: engine(), ledger: new SubprocessLedger() })
    await provider.load()
    expect(calls.start).toBe(0)
    await Promise.all([provider.activate(), provider.activate()])
    expect(calls.start).toBe(1)
  })

  test('start failure is fail-soft, records failed and leaves no active child', async () => {
    const { value } = sidecar({ start: async () => { throw new Error('sidecar_unavailable') } })
    const ledger = new SubprocessLedger()
    const provider = createAsrSidecarProvider({ id: 'qwen3', sidecar: value, engine: engine(), ledger })
    await expect(provider.activate()).rejects.toThrow(/sidecar_unavailable/)
    expect(ledger.active()).toEqual([])
    expect(ledger.snapshot()[0]).toMatchObject({ id: 'qwen3', state: 'failed' })
  })

  test('external adoption is recorded but never stopped', async () => {
    const { value, calls } = sidecar({ isExternal: () => true })
    const ledger = new SubprocessLedger()
    const provider = createAsrSidecarProvider({ id: 'qwen3', sidecar: value, engine: engine(), ledger })
    await provider.activate()
    expect(ledger.snapshot()[0]).toMatchObject({ ownership: 'external', state: 'running' })
    await provider.deactivate()
    expect(calls.stop).toBe(0)
    expect(calls.stopSync).toBe(0)
  })

  test('unhealthy sidecar reports failed health and falls back in registry', async () => {
    const { value } = sidecar({ isReady: async () => false })
    const ledger = new SubprocessLedger()
    const provider = createAsrSidecarProvider({ id: 'qwen3', sidecar: value, engine: engine(), ledger })
    await provider.activate()
    await expect(provider.health()).resolves.toBe('failed')
  })

  test('deactivate and dispose are idempotent and stop an owned child once', async () => {
    const { value, calls } = sidecar()
    const provider = createAsrSidecarProvider({ id: 'qwen3', sidecar: value, engine: engine(), ledger: new SubprocessLedger() })
    await provider.activate()
    await provider.deactivate()
    await provider.deactivate()
    await provider.dispose()
    expect(calls.stop).toBe(1)
    expect(calls.stopSync).toBe(1)
  })
})
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npx jest --runInBand tests/unit/kernel-v2/asr-subprocess-probe.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: 实现 provider**

实现要点：`startOnce` 用一个 `startPromise` 字段缓存；失败时清空该字段，允许下一次 activate 重试；`activate` 成功后 `ledger.markRunning`（external 用 `adopt` 直接 running）；`deactivate` 先判断 `sidecar.isExternal?.()`，避免把 adopted 进程当自己的；`dispose` 只调用一次 `stopSync`。

- [ ] **Step 4: 跑测试确认通过**

Run: `npx jest --runInBand tests/unit/kernel-v2/asr-subprocess-probe.test.ts`
Expected: PASS（5 tests）

- [ ] **Step 5: 提交**

```bash
git add gateway/src/kernel-v2/probes/asr-subprocess.ts gateway/tests/unit/kernel-v2/asr-subprocess-probe.test.ts
git commit -m "feat(kernel-v2): prove sidecar-owning provider lifecycle (S3)"
```

---

### Task 2.3：S3 结论与决策

**Files:**
- Create: `docs/research/2026-11-12-s3-asr-subprocess-probe.md`

- [ ] **Step 1: 写 probe 报告**

报告必须包含：

```markdown
# S3：ASR provider with subprocess

- 日期、关联任务、commit
- 要回答的问题：provider 拥有子进程时，生命周期/ledger/health/fallback 是否成立？
- 证据：测试文件、测试数、覆盖的 5 种情况（启动失败、健康超时、中途退出、重复 stop、adopted）
- 决策：
  1. ASR 可以走 provider 路线，不需要把 sidecar 留在组合根。
  2. 子进程所有权用 SubprocessLedger 记录；external 进程只观察不 kill。
  3. provider health 是同步可读状态；sidecar 的异步 isReady 由 activate 探测并缓存。
  4. fallback 由 registry tier + health 完成；ASR capability 不自己实现 fallback。
- 未决：端口分配、GPU 争用、Python 打包、worker 隔离（Phase 6）
- 对 Phase 2 的影响：ASR provider 放在 media 之后；复用 Task 2.1/2.2 的 ledger 和 provider 形状。
```

- [ ] **Step 2: 提交**

```bash
git add docs/research/2026-11-12-s3-asr-subprocess-probe.md
git commit -m "docs: record S3 ASR subprocess probe"
```

**Milestone 2A gate:** `npx jest --runInBand tests/unit/kernel-v2/subprocess-ledger.test.ts tests/unit/kernel-v2/asr-subprocess-probe.test.ts` 全绿；S3 报告落盘；v1 文件零改动。

---

## Milestone 2B：Media provider

### Task 2.4：Media capability adapter

**Files:**
- Create: `gateway/src/kernel-v2/providers/media.ts`
- Test: `gateway/tests/unit/kernel-v2/media-provider.test.ts`
- Consumes: `CapabilityRegistry`、`CapabilityScope`、`CapabilityTier`；`MediaKind` / `MediaConfig` / `PromptFn` from `gateway/src/media/media-service.ts`
- Produces: `MediaProvider`、`MediaCapability`、`createMediaCapability`、`registerMediaProvider`

**Interfaces:**
```ts
export interface MediaProvider {
  id: string
  modalities: string[]
  prompt: PromptFn
  builtin?: boolean
  health?: () => CapabilityHealth
}

export interface MediaCapability {
  resolve(kind: MediaKind, cfg: MediaConfig, scope?: CapabilityScope): PromptFn | undefined
  engines(scope?: CapabilityScope): Array<{ id: string; modalities: string[]; tier: CapabilityTier }>
}

export function createMediaCapability(
  registry: CapabilityRegistry<MediaProvider>,
  deps: { builtinPi: () => PromptFn | undefined; onFallback?: (reason: string, engine: string, kind: MediaKind) => void },
): MediaCapability

export function registerMediaProvider(
  registry: CapabilityRegistry<MediaProvider>,
  provider: MediaProvider,
  tier?: CapabilityTier,
  scope?: CapabilityScope,
): void
```

解析语义（必须与 v1 `resolveMediaPrompt` 一致）：

1. engine name = `cfg[kind]?.engine ?? cfg.engine ?? "pi"`。
2. 从 `registry.list(scope)` 找该 id；找不到 → `onFallback("unknown-engine")` → `builtinPi()`。
3. 找到但 `builtin === true` → `builtinPi()`。
4. 找到但 `modalities` 不含该 kind → `onFallback("unsupported-modality")` → `builtinPi()`。
5. `builtinPi()` 返回 undefined 时返回 undefined（调用方回退 `MediaService.deps.prompt`）。
6. 任何情况下不抛错。

- [ ] **Step 1: 写失败测试**

```ts
import { CapabilityRegistry } from '../../../src/kernel-v2/capability-registry'
import { createMediaCapability, registerMediaProvider, type MediaProvider } from '../../../src/kernel-v2/providers/media'
import type { MediaConfig } from '../../../src/media/media-service'

const cfg = (over: Partial<MediaConfig> = {}): MediaConfig => ({ provider: 'xiaomi', model: 'mimo-v2.6-pro', ...over })
const prompt = (name: string) => async () => name

function registry() {
  return new CapabilityRegistry<MediaProvider>({ defaultId: 'pi', capability: 'media', version: '1.0.0', revision: 'test', plane: 'gateway' })
}

describe('Media capability adapter', () => {
  test('defaults to builtin pi', () => {
    const reg = registry()
    registerMediaProvider(reg, { id: 'pi', modalities: ['image', 'video', 'audio'], prompt: prompt('pi'), builtin: true })
    const media = createMediaCapability(reg, { builtinPi: () => prompt('builtin-pi') })
    expect(media.resolve('image', cfg())).toBeDefined()
    expect(media.engines()).toEqual([{ id: 'pi', modalities: ['image', 'video', 'audio'], tier: 'builtin' }])
  })

  test('package overrides builtin with the same id', () => {
    const reg = registry()
    registerMediaProvider(reg, { id: 'pi', modalities: ['image'], prompt: prompt('builtin'), builtin: true })
    registerMediaProvider(reg, { id: 'pi', modalities: ['image'], prompt: prompt('package') }, 'package')
    const media = createMediaCapability(reg, { builtinPi: () => prompt('builtin-pi') })
    expect(media.engines()[0]).toMatchObject({ id: 'pi', tier: 'package' })
  })

  test('unknown engine falls back to builtin pi and reports the reason', () => {
    const reasons: string[] = []
    const reg = registry()
    registerMediaProvider(reg, { id: 'pi', modalities: ['image'], prompt: prompt('pi'), builtin: true })
    const media = createMediaCapability(reg, { builtinPi: () => prompt('builtin-pi'), onFallback: (reason) => reasons.push(reason) })
    expect(media.resolve('image', cfg({ image: { model: 'x', engine: 'missing' } }))).toBeDefined()
    expect(reasons).toEqual(['unknown-engine'])
  })

  test('unsupported modality falls back and reports the reason', () => {
    const reasons: string[] = []
    const reg = registry()
    registerMediaProvider(reg, { id: 'pi', modalities: ['image'], prompt: prompt('pi'), builtin: true })
    registerMediaProvider(reg, { id: 'vision-only', modalities: ['image'], prompt: prompt('vision') })
    const media = createMediaCapability(reg, { builtinPi: () => prompt('builtin-pi'), onFallback: (reason) => reasons.push(reason) })
    expect(media.resolve('video', cfg({ video: { model: 'x', engine: 'vision-only' } }))).toBeDefined()
    expect(reasons).toEqual(['unsupported-modality'])
  })

  test('missing builtin pi returns undefined instead of throwing', () => {
    const reg = registry()
    registerMediaProvider(reg, { id: 'pi', modalities: ['image'], prompt: prompt('pi'), builtin: true })
    const media = createMediaCapability(reg, { builtinPi: () => undefined })
    expect(media.resolve('image', cfg())).toBeUndefined()
  })

  test('scope isolation: project provider is not visible globally', () => {
    const reg = registry()
    const project = { kind: 'project', projectId: 'p1' } as const
    registerMediaProvider(reg, { id: 'pi', modalities: ['image'], prompt: prompt('global'), builtin: true })
    registerMediaProvider(reg, { id: 'local', modalities: ['image'], prompt: prompt('project') }, 'package', project)
    const media = createMediaCapability(reg, { builtinPi: () => prompt('builtin-pi') })
    expect(media.engines().some((item) => item.id === 'local')).toBe(false)
    expect(media.engines(project).some((item) => item.id === 'local')).toBe(true)
  })
})
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npx jest --runInBand tests/unit/kernel-v2/media-provider.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: 实现 adapter**

实现要点：`resolve` 用 `registry.list(scope)` 而不是 `resolve`，因为需要拿到 tier 和 provider 的 `modalities`/`builtin` 元数据，并且要避免 registry 在未知 id 时抛错；`engines` 直接映射 `list()`，不调用 health。

- [ ] **Step 4: 跑测试确认通过**

Run: `npx jest --runInBand tests/unit/kernel-v2/media-provider.test.ts`
Expected: PASS（6 tests）

- [ ] **Step 5: 提交**

```bash
git add gateway/src/kernel-v2/providers/media.ts gateway/tests/unit/kernel-v2/media-provider.test.ts
git commit -m "feat(kernel-v2): add media provider adapter"
```

---

### Task 2.5：Media conformance kit + 测试包 provider

**Files:**
- Create: `gateway/tests/helpers/kernel-v2/media-conformance.ts`
- Create: `gateway/tests/fixtures/kernel-v2/media-echo-provider.ts`
- Test: `gateway/tests/unit/kernel-v2/media-conformance.test.ts`

**Interfaces:**
```ts
// media-conformance.ts
export interface MediaConformanceFactory {
  create(): {
    registry: CapabilityRegistry<MediaProvider>
    builtinPi: () => PromptFn | undefined
    onFallback: (reason: string, engine: string, kind: string) => void
  }
}
export function runMediaConformance(name: string, factory: MediaConformanceFactory): void

// media-echo-provider.ts
export function createMediaEchoProvider(): MediaProvider
```

Kit 必须覆盖：default、override、unknown fallback、unsupported modality、missing builtin、scope isolation、dispose 后不可解析。Kit 用 `describe`/`test`，可被后续 provider 复用。

- [ ] **Step 1: 写失败测试（先只引用 kit）**

```ts
import { CapabilityRegistry } from '../../../src/kernel-v2/capability-registry'
import { registerMediaProvider, type MediaProvider } from '../../../src/kernel-v2/providers/media'
import { runMediaConformance } from '../../helpers/kernel-v2/media-conformance'

runMediaConformance('media adapter', {
  create() {
    const registry = new CapabilityRegistry<MediaProvider>({ defaultId: 'pi', capability: 'media', version: '1.0.0', revision: 'kit', plane: 'gateway' })
    return { registry, builtinPi: () => async () => 'builtin', onFallback: () => {} }
  },
})

test('test package provider resolves without core edits', async () => {
  const { createMediaEchoProvider } = await import('../../fixtures/kernel-v2/media-echo-provider')
  const provider = createMediaEchoProvider()
  expect(provider.id).toBe('echo')
  expect(provider.modalities).toEqual(['image'])
})
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npx jest --runInBand tests/unit/kernel-v2/media-conformance.test.ts`
Expected: FAIL — helper/fixture not found

- [ ] **Step 3: 实现 kit 与 fixture**

Kit 内部用 `createMediaCapability`，并断言与 Task 2.4 相同的语义；fixture 的 `prompt` 返回 `echo:<text>`，只支持 `image`。Kit 不 import fixture。

- [ ] **Step 4: 跑测试确认通过**

Run: `npx jest --runInBand tests/unit/kernel-v2/media-conformance.test.ts`
Expected: PASS（7 tests）

- [ ] **Step 5: 提交**

```bash
git add gateway/tests/helpers/kernel-v2/media-conformance.ts gateway/tests/fixtures/kernel-v2/media-echo-provider.ts gateway/tests/unit/kernel-v2/media-conformance.test.ts
git commit -m "test(kernel-v2): add media conformance kit and package fixture"
```

**Milestone 2B gate:** media adapter + kit 全绿；未知 engine / unsupported modality 的 fallback 与 v1 语义一致；测试包 provider 不改核心即可注册。

---

## Milestone 2C：ASR provider

### Task 2.6：ASR capability adapter

**Files:**
- Create: `gateway/src/kernel-v2/providers/asr.ts`
- Test: `gateway/tests/unit/kernel-v2/asr-provider.test.ts`
- Consumes: `CapabilityRegistry`、`AsrEngine` / `AsrCapabilities` / `assertAsrCapabilities` from `gateway/src/voice/types.ts`

**Interfaces:**
```ts
export interface AsrCapability {
  resolve(name?: string, scope?: CapabilityScope): AsrEngine
  list(scope?: CapabilityScope): Array<{ id: string; capabilities: AsrCapabilities; tier: CapabilityTier }>
  available(name?: string, scope?: CapabilityScope): Promise<{ ok: boolean; reason?: string }>
}

export function createAsrCapability(registry: CapabilityRegistry<AsrEngine>): AsrCapability

export function registerAsrEngine(
  registry: CapabilityRegistry<AsrEngine>,
  engine: AsrEngine,
  tier?: CapabilityTier,
  scope?: CapabilityScope,
): void
```

`registerAsrEngine` 调 `assertAsrCapabilities`，非法 capabilities 在注册时抛错。`available()` 调 `engine.isAvailable()`；异常转 `{ ok: false, reason }`，不抛出。

- [ ] **Step 1: 写失败测试**

```ts
import { CapabilityRegistry } from '../../../src/kernel-v2/capability-registry'
import { createAsrCapability, registerAsrEngine } from '../../../src/kernel-v2/providers/asr'
import type { AsrEngine } from '../../../src/voice/types'

function engine(name: string, over: Partial<AsrEngine> = {}): AsrEngine {
  return {
    name,
    capabilities: { streaming: 'native', languages: ['zh'], punctuation: true, timestamps: 'none', sampleRate: 16000 },
    isAvailable: async () => ({ ok: true }),
    createStream: () => ({ push: () => {}, end: async () => ({ text: '', durationMs: 0, engine: name, final: true }), abort: () => {}, onPartial: () => {} }),
    transcribe: async () => ({ text: '', durationMs: 0, engine: name, final: true }),
    ...over,
  }
}
function registry() {
  return new CapabilityRegistry<AsrEngine>({ defaultId: 'qwen3-asr-vllm', capability: 'asr', version: '1.0.0', revision: 'test', plane: 'gateway' })
}

describe('ASR capability adapter', () => {
  test('defaults to qwen3 and lists tier/capabilities', () => {
    const reg = registry()
    registerAsrEngine(reg, engine('qwen3-asr-vllm'))
    const asr = createAsrCapability(reg)
    expect(asr.resolve().name).toBe('qwen3-asr-vllm')
    expect(asr.list()[0]).toMatchObject({ id: 'qwen3-asr-vllm', tier: 'builtin' })
  })

  test('package overrides legacy overrides builtin', () => {
    const reg = registry()
    registerAsrEngine(reg, engine('x'))
    registerAsrEngine(reg, engine('x'), 'legacy')
    registerAsrEngine(reg, engine('x'), 'package')
    expect(createAsrCapability(reg).list().find((item) => item.id === 'x')?.tier).toBe('package')
  })

  test('unknown name falls back to the default engine', () => {
    const reg = registry()
    registerAsrEngine(reg, engine('qwen3-asr-vllm'))
    expect(createAsrCapability(reg).resolve('missing').name).toBe('qwen3-asr-vllm')
  })

  test('invalid capabilities fail at registration', () => {
    const reg = registry()
    const bad = engine('bad')
    bad.capabilities = { ...bad.capabilities, sampleRate: 0 }
    expect(() => registerAsrEngine(reg, bad)).toThrow(/sampleRate/)
  })

  test('available() converts a thrown probe into a reason', async () => {
    const reg = registry()
    registerAsrEngine(reg, engine('qwen3-asr-vllm', { isAvailable: async () => { throw new Error('down') } }))
    await expect(createAsrCapability(reg).available()).resolves.toEqual({ ok: false, reason: 'down' })
  })
})
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npx jest --runInBand tests/unit/kernel-v2/asr-provider.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: 实现 adapter**

`list()` 从 `registry.list(scope)` 映射；`available()` 用 `resolve` 后 `await engine.isAvailable()`，catch 返回 reason；不缓存 async 可用性。

- [ ] **Step 4: 跑测试确认通过**

Run: `npx jest --runInBand tests/unit/kernel-v2/asr-provider.test.ts`
Expected: PASS（5 tests）

- [ ] **Step 5: 提交**

```bash
git add gateway/src/kernel-v2/providers/asr.ts gateway/tests/unit/kernel-v2/asr-provider.test.ts
git commit -m "feat(kernel-v2): add asr provider adapter"
```

---

### Task 2.7：Sidecar provider ↔ ASR capability 绑定与 fallback

**Files:**
- Create: `gateway/src/kernel-v2/providers/asr-sidecar.ts`
- Create: `gateway/tests/helpers/kernel-v2/asr-conformance.ts`
- Create: `gateway/tests/fixtures/kernel-v2/asr-fake-provider.ts`
- Test: `gateway/tests/unit/kernel-v2/asr-sidecar-provider.test.ts`
- Consumes: `createAsrSidecarProvider`（Task 2.2）、`createAsrCapability`（Task 2.6）

**Interfaces:**
```ts
export interface BindAsrSidecarOptions {
  registry: CapabilityRegistry<AsrEngine>
  provider: AsrSidecarProvider
  tier?: CapabilityTier
  scope?: CapabilityScope
}

export function bindAsrSidecar(options: BindAsrSidecarOptions): {
  providerId: string
  engine: AsrEngine
  health(): 'healthy' | 'failed'
  dispose(): Promise<void>
}
```

绑定行为：注册 engine 到 registry，带同步 `health` 回调读取 provider 的缓存健康状态；`dispose()` 先 unregister（`replaceTier` 过滤）再 provider.dispose。**不**在 registry 里放异步 `isAvailable`。

- [ ] **Step 1: 写失败测试**

```ts
import { CapabilityRegistry } from '../../../src/kernel-v2/capability-registry'
import { createAsrCapability } from '../../../src/kernel-v2/providers/asr'
import { bindAsrSidecar } from '../../../src/kernel-v2/providers/asr-sidecar'
import { createAsrSidecarProvider } from '../../../src/kernel-v2/probes/asr-subprocess'
import { SubprocessLedger } from '../../../src/kernel-v2/subprocess-ledger'
import type { AsrEngine } from '../../../src/voice/types'

function engine(name: string): AsrEngine { /* 同 Task 2.6 的 fake */ }

test('unhealthy builtin sidecar falls back to a package engine', async () => {
  const reg = new CapabilityRegistry<AsrEngine>({ defaultId: 'qwen3-asr-vllm', capability: 'asr', version: '1.0.0', revision: 'test', plane: 'gateway' })
  const ledger = new SubprocessLedger()
  let ready = false
  const sidecar = { pid: 1, async start() {}, async stop() {}, stopSync() {}, async isReady() { return ready }, isExternal() { return false } }
  const provider = createAsrSidecarProvider({ id: 'qwen3-asr-vllm', sidecar, engine: engine('qwen3-asr-vllm'), ledger })
  const bound = bindAsrSidecar({ registry: reg, provider })
  await provider.activate()
  reg.register('package', { id: 'qwen3-asr-vllm', value: engine('fallback-asr') })
  ready = false
  reg.invalidate()
  expect(createAsrCapability(reg).resolve('qwen3-asr-vllm').name).toBe('fallback-asr')
  await bound.dispose()
})

test('dispose removes the provider and stops the child', async () => {
  // 断言 registry.list(scope) 不再含 provider；ledger active 为空；provider.stop 调用一次
})
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npx jest --runInBand tests/unit/kernel-v2/asr-sidecar-provider.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: 实现绑定 + kit + fixture**

`bindAsrSidecar` 在注册时给 entry 加 `health: () => provider._cachedHealth ?? "healthy"`；provider 在 activate/health 时更新该值。Kit 覆盖 default/override/fallback/dispose。fixture 提供 `createFakeAsrEngine('fake-asr')`。

- [ ] **Step 4: 跑测试确认通过**

Run: `npx jest --runInBand tests/unit/kernel-v2/asr-sidecar-provider.test.ts`
Expected: PASS（6 tests）

- [ ] **Step 5: 提交**

```bash
git add gateway/src/kernel-v2/providers/asr-sidecar.ts gateway/tests/helpers/kernel-v2/asr-conformance.ts gateway/tests/fixtures/kernel-v2/asr-fake-provider.ts gateway/tests/unit/kernel-v2/asr-sidecar-provider.test.ts
git commit -m "feat(kernel-v2): bind sidecar asr provider with fallback"
```

**Milestone 2C gate:** S3 provider 与 ASR capability 闭环；sidecar unhealthy 时 package/legacy fallback 可见；dispose 停子进程。

---

## Milestone 2D：Commands provider

### Task 2.8：Command source capability

**Files:**
- Create: `gateway/src/kernel-v2/providers/commands.ts`
- Test: `gateway/tests/unit/kernel-v2/commands-provider.test.ts`
- Create: `gateway/tests/helpers/kernel-v2/commands-conformance.ts`
- Create: `gateway/tests/fixtures/kernel-v2/command-package-source.ts`
- Consumes: `CustomCommandSpec` from `gateway/src/commands/custom-commands.ts`

**Interfaces:**
```ts
export interface CommandSource {
  id: string
  scan(scope?: CapabilityScope): Promise<CustomCommandSpec[]>
  watch?(onChange: () => void): () => void
  dispose?(): void | Promise<void>
}

export interface CommandCapability {
  list(scope?: CapabilityScope): Promise<CustomCommandSpec[]>
  sources(scope?: CapabilityScope): Array<{ id: string; tier: CapabilityTier }>
  dispose(): Promise<void>
}

export function createCommandCapability(registry: CapabilityRegistry<CommandSource>): CommandCapability
export function registerCommandSource(registry: CapabilityRegistry<CommandSource>, source: CommandSource, tier?: CapabilityTier, scope?: CapabilityScope): void
```

合并语义：按 tier 升序（builtin → legacy → package）扫描，同名命令后扫描者覆盖；每个 source 的 `scan` 失败只跳过该 source（fail-open）。`dispose()` 逆序调用每个 source 的 `dispose`，隔离错误。

- [ ] **Step 1: 写失败测试**

```ts
import { CapabilityRegistry } from '../../../src/kernel-v2/capability-registry'
import { createCommandCapability, registerCommandSource, type CommandSource } from '../../../src/kernel-v2/providers/commands'
import type { CustomCommandSpec } from '../../../src/commands/custom-commands'

const spec = (name: string, template = name): CustomCommandSpec => ({ name, description: name, template, sourceFile: `${name}.md` })
const source = (id: string, specs: CustomCommandSpec[], over: Partial<CommandSource> = {}): CommandSource => ({ id, scan: async () => specs, ...over })

describe('Command capability adapter', () => {
  test('merges builtin -> legacy -> package with later tiers overriding names', async () => {
    const reg = new CapabilityRegistry<CommandSource>({ defaultId: 'builtin', capability: 'commands', version: '1.0.0', revision: 'test', plane: 'gateway' })
    registerCommandSource(reg, source('builtin', [spec('help', 'builtin')]))
    registerCommandSource(reg, source('user', [spec('help', 'user'), spec('ship')]), 'legacy')
    registerCommandSource(reg, source('pkg', [spec('ship', 'package')]), 'package')
    const commands = createCommandCapability(reg)
    expect((await commands.list()).map((c) => [c.name, c.template])).toEqual([['help', 'user'], ['ship', 'package']])
  })

  test('a failing source is skipped without erasing other commands', async () => {
    const reg = new CapabilityRegistry<CommandSource>({ defaultId: 'builtin', capability: 'commands', version: '1.0.0', revision: 'test', plane: 'gateway' })
    registerCommandSource(reg, source('bad', [], { scan: async () => { throw new Error('boom') } }))
    registerCommandSource(reg, source('good', [spec('ok')]), 'legacy')
    expect((await createCommandCapability(reg).list()).map((c) => c.name)).toEqual(['ok'])
  })

  test('dispose calls each source dispose in reverse order and isolates errors', async () => {
    const order: string[] = []
    const reg = new CapabilityRegistry<CommandSource>({ defaultId: 'a', capability: 'commands', version: '1.0.0', revision: 'test', plane: 'gateway' })
    registerCommandSource(reg, source('a', [], { dispose: async () => { order.push('a') } }))
    registerCommandSource(reg, source('b', [], { dispose: async () => { order.push('b'); throw new Error('x') } }))
    await expect(createCommandCapability(reg).dispose()).resolves.toBeUndefined()
    expect(order).toEqual(['b', 'a'])
  })

  test('scope isolation: project source is not visible globally', async () => {
    const reg = new CapabilityRegistry<CommandSource>({ defaultId: 'a', capability: 'commands', version: '1.0.0', revision: 'test', plane: 'gateway' })
    const project = { kind: 'project', projectId: 'p1' } as const
    registerCommandSource(reg, source('a', [spec('global')]))
    registerCommandSource(reg, source('p', [spec('project')]), 'package', project)
    const commands = createCommandCapability(reg)
    expect((await commands.list()).map((c) => c.name)).toEqual(['global'])
    expect((await commands.list(project)).map((c) => c.name)).toEqual(['project'])
  })
})
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npx jest --runInBand tests/unit/kernel-v2/commands-provider.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: 实现 adapter + kit + fixture**

实现要点：合并时用 `Map<string, CustomCommandSpec>`；source 顺序取 `registry.list(scope)` 后按 tier 升序稳定排序；`dispose` 用 `Promise.allSettled` 但保持逆序调用。Kit 由 Task 2.8 的 4 个语义组成；fixture 是静态 `CommandSource`，返回 `package:hello`。

- [ ] **Step 4: 跑测试确认通过**

Run: `npx jest --runInBand tests/unit/kernel-v2/commands-provider.test.ts`
Expected: PASS（4 tests）

- [ ] **Step 5: 提交**

```bash
git add gateway/src/kernel-v2/providers/commands.ts gateway/tests/helpers/kernel-v2/commands-conformance.ts gateway/tests/fixtures/kernel-v2/command-package-source.ts gateway/tests/unit/kernel-v2/commands-provider.test.ts
git commit -m "feat(kernel-v2): add command source capability"
```

---

## Milestone 2E：Notifications provider

> 定义：这里的 notifications 是 **gateway 出站通知通道**（mobile push / webhook / OS 通知适配器），不是桌面 OS Notification 本体。桌面 `Notification` 仍在 desktop main，Phase 4/6 处理。核心 `broadcast()` 不可替换；通知通道是它的下游 fan-out。

### Task 2.9：Notification channel capability

**Files:**
- Create: `gateway/src/kernel-v2/providers/notifications.ts`
- Test: `gateway/tests/unit/kernel-v2/notifications-provider.test.ts`
- Create: `gateway/tests/helpers/kernel-v2/notifications-conformance.ts`
- Create: `gateway/tests/fixtures/kernel-v2/notification-webhook-channel.ts`

**Interfaces:**
```ts
export interface NotificationEvent {
  type: string
  [key: string]: unknown
}

export interface NotificationChannel {
  id: string
  send(event: NotificationEvent): Promise<void> | void
  health?: () => CapabilityHealth
  dispose?(): void | Promise<void>
}

export interface NotificationResult {
  delivered: string[]
  failed: Array<{ id: string; error: string }>
  skipped: string[]
}

export interface NotificationCapability {
  notify(event: NotificationEvent, scope?: CapabilityScope): Promise<NotificationResult>
  channels(scope?: CapabilityScope): Array<{ id: string; tier: CapabilityTier }>
}

export function createNotificationCapability(registry: CapabilityRegistry<NotificationChannel>): NotificationCapability
export function createPushNotificationChannel(id: string, gateway: { onBroadcast(event: Record<string, unknown>): Promise<void> }): NotificationChannel
```

语义：fan-out 到所有 healthy channel；`failed`/unhealthy 记入 `skipped`；单个 channel 抛错只进 `failed`；`notify` 永不抛错；事件对象按引用传入但 capability 不修改它。

- [ ] **Step 1: 写失败测试**

```ts
import { CapabilityRegistry } from '../../../src/kernel-v2/capability-registry'
import { createNotificationCapability, type NotificationChannel } from '../../../src/kernel-v2/providers/notifications'

const channel = (id: string, over: Partial<NotificationChannel> = {}): NotificationChannel => ({ id, send: async () => {}, ...over })

function registry() {
  return new CapabilityRegistry<NotificationChannel>({ defaultId: 'push', capability: 'notifications', version: '1.0.0', revision: 'test', plane: 'gateway' })
}

describe('Notification capability adapter', () => {
  test('fans out to every healthy channel', async () => {
    const seen: string[] = []
    const reg = registry()
    reg.register('builtin', channel('push', { send: (e) => { seen.push(`push:${e.type}`) } }))
    reg.register('package', channel('webhook', { send: (e) => { seen.push(`webhook:${e.type}`) } }))
    const result = await createNotificationCapability(reg).notify({ type: 'goal.updated' })
    expect(seen.sort()).toEqual(['push:goal.updated', 'webhook:goal.updated'])
    expect(result.delivered.sort()).toEqual(['push', 'webhook'])
  })

  test('one channel failure does not block the others and is reported', async () => {
    const seen: string[] = []
    const reg = registry()
    reg.register('builtin', channel('push', { send: () => { throw new Error('socket down') } }))
    reg.register('package', channel('webhook', { send: () => { seen.push('webhook') } }))
    const result = await createNotificationCapability(reg).notify({ type: 'x' })
    expect(seen).toEqual(['webhook'])
    expect(result.failed).toEqual([{ id: 'push', error: 'socket down' }])
  })

  test('unhealthy channels are skipped, not failed', async () => {
    const reg = registry()
    reg.register('builtin', channel('push', { health: () => 'failed' }))
    reg.register('package', channel('webhook'))
    const result = await createNotificationCapability(reg).notify({ type: 'x' })
    expect(result.skipped).toEqual(['push'])
    expect(result.delivered).toEqual(['webhook'])
  })

  test('no channels returns an empty result and never throws', async () => {
    const reg = registry()
    await expect(createNotificationCapability(reg).notify({ type: 'x' })).resolves.toEqual({ delivered: [], failed: [], skipped: [] })
  })

  test('push channel adapter forwards the event without mutating it', async () => {
    const seen: unknown[] = []
    const channel = createPushNotificationChannel('mobile', { onBroadcast: async (event) => { seen.push(event) } })
    const event = { type: 'goal.updated', goalId: 'g1' }
    await channel.send(event)
    expect(seen).toEqual([event])
    expect(event).toEqual({ type: 'goal.updated', goalId: 'g1' })
  })
})
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npx jest --runInBand tests/unit/kernel-v2/notifications-provider.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: 实现 adapter + kit + fixture**

实现要点：`registry.list(scope)` 返回所有可见 winner；`healthOf` 同步检查；`Promise.allSettled` 并发发送但结果按 `delivered/failed` 分类；`event` 只读传入。`createPushNotificationChannel` 不 import `PushGateway`，只用结构类型。

- [ ] **Step 4: 跑测试确认通过**

Run: `npx jest --runInBand tests/unit/kernel-v2/notifications-provider.test.ts`
Expected: PASS（5 tests）

- [ ] **Step 5: 提交**

```bash
git add gateway/src/kernel-v2/providers/notifications.ts gateway/tests/helpers/kernel-v2/notifications-conformance.ts gateway/tests/fixtures/kernel-v2/notification-webhook-channel.ts gateway/tests/unit/kernel-v2/notifications-provider.test.ts
git commit -m "feat(kernel-v2): add notification channel capability"
```

**Milestone 2E gate:** fan-out、失败隔离、health skip、push adapter 全部绿；`notify` 不抛回主链。

---

## Milestone 2F：Automation action provider

### Task 2.10：Automation action capability

**Files:**
- Create: `gateway/src/kernel-v2/providers/automation.ts`
- Test: `gateway/tests/unit/kernel-v2/automation-provider.test.ts`
- Create: `gateway/tests/helpers/kernel-v2/automation-conformance.ts`
- Create: `gateway/tests/fixtures/kernel-v2/automation-echo-action.ts`

**Interfaces:**
```ts
export interface AutomationActionInput {
  ruleId: string
  source?: "cron" | "event" | "user"
  [key: string]: unknown
}

export interface AutomationActionProvider {
  id: string
  handler(input: AutomationActionInput): Promise<unknown>
  health?: () => CapabilityHealth
  dispose?(): void | Promise<void>
}

export interface AutomationCapability {
  resolve(type: string, scope?: CapabilityScope): AutomationActionProvider
  actions(scope?: CapabilityScope): Array<{ id: string; tier: CapabilityTier }>
  run(type: string, input: AutomationActionInput, scope?: CapabilityScope):
    Promise<{ ok: true; value: unknown } | { ok: false; error: "missing" | "failed"; message: string }>
}

export function createAutomationCapability(registry: CapabilityRegistry<AutomationActionProvider>): AutomationCapability
export function registerAutomationAction(registry: CapabilityRegistry<AutomationActionProvider>, action: AutomationActionProvider, tier?: CapabilityTier, scope?: CapabilityScope): void
```

`run` 语义：action 不存在 → `{ ok:false, error:"missing" }`；handler 抛错 → `{ ok:false, error:"failed", message }`；成功 → `{ ok:true, value }`。`run` 永不抛错。核心 `AutomationEngine.validateRule` / cron 调度不在 provider 范围。

- [ ] **Step 1: 写失败测试**

```ts
import { CapabilityRegistry } from '../../../src/kernel-v2/capability-registry'
import { createAutomationCapability, registerAutomationAction, type AutomationActionProvider } from '../../../src/kernel-v2/providers/automation'

const action = (id: string, over: Partial<AutomationActionProvider> = {}): AutomationActionProvider => ({ id, handler: async () => id, ...over })
function registry() {
  return new CapabilityRegistry<AutomationActionProvider>({ defaultId: 'echo', capability: 'automation-action', version: '1.0.0', revision: 'test', plane: 'gateway' })
}

describe('Automation action capability', () => {
  test('resolves default and package override', () => {
    const reg = registry()
    registerAutomationAction(reg, action('echo'))
    registerAutomationAction(reg, action('echo'), 'package')
    const automation = createAutomationCapability(reg)
    expect(automation.resolve('echo').id).toBe('echo')
    expect(automation.actions()[0].tier).toBe('package')
  })

  test('unknown action fails closed instead of throwing', async () => {
    const reg = registry()
    await expect(createAutomationCapability(reg).run('missing', { ruleId: 'r1' })).resolves.toMatchObject({ ok: false, error: 'missing' })
  })

  test('handler error is isolated and reported', async () => {
    const reg = registry()
    registerAutomationAction(reg, action('bad', { handler: async () => { throw new Error('boom') } }))
    const result = await createAutomationCapability(reg).run('bad', { ruleId: 'r1' })
    expect(result).toEqual({ ok: false, error: 'failed', message: 'boom' })
  })

  test('success returns the handler value', async () => {
    const reg = registry()
    registerAutomationAction(reg, action('echo', { handler: async (input) => ({ ruleId: input.ruleId }) }))
    await expect(createAutomationCapability(reg).run('echo', { ruleId: 'r9' })).resolves.toEqual({ ok: true, value: { ruleId: 'r9' } })
  })

  test('dispose unregisters and calls provider dispose once', async () => {
    let disposals = 0
    const reg = registry()
    registerAutomationAction(reg, action('echo', { dispose: async () => { disposals += 1 } }))
    await reg.dispose()
    expect(disposals).toBe(1)
  })
})
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npx jest --runInBand tests/unit/kernel-v2/automation-provider.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: 实现 adapter + kit + fixture**

实现要点：`resolve` 用 registry；`run` 先 `registry.get`/`list` 查存在性，再 try/catch handler；不要调用 v1 `AutomationEngine.executeRule`。fixture 的 handler 返回 `{ echoed: input.ruleId }`。

- [ ] **Step 4: 跑测试确认通过**

Run: `npx jest --runInBand tests/unit/kernel-v2/automation-provider.test.ts`
Expected: PASS（5 tests）

- [ ] **Step 5: 提交**

```bash
git add gateway/src/kernel-v2/providers/automation.ts gateway/tests/helpers/kernel-v2/automation-conformance.ts gateway/tests/fixtures/kernel-v2/automation-echo-action.ts gateway/tests/unit/kernel-v2/automation-provider.test.ts
git commit -m "feat(kernel-v2): add automation action capability"
```

---

## Milestone 2G：G2 gate、守卫与文档

### Task 2.11：核心/provider 边界守卫

**Files:**
- Modify: `gateway/tests/unit/architecture/kernel-v2-boundaries.test.ts`

- [ ] **Step 1: 写失败守卫**

新增两条断言：

1. `kernel-v2` 核心文件（排除 `providers/**`、`main.ts`、`facade.ts`、`probes/**`）不得出现 `from './providers/` 或 `from './probes/`。
2. `kernel-v2/providers/**` 不得 import `src/kernel.ts`、`src/boot.ts`、`src/http/transport.ts`、`src/voice/registry.ts`、`src/media/media-plugin-loader.ts` 的默认导出单例（只允许 type-only import 或纯函数）。

- [ ] **Step 2: 跑守卫确认失败**

Run: `npx jest --runInBand tests/unit/architecture/kernel-v2-boundaries.test.ts`
Expected: FAIL — 新的 provider import 被检测到（如果实现违反）或守卫不存在

- [ ] **Step 3: 修正 import**

把 provider 中的实现依赖改成 type-only import；核心文件不 import provider。

- [ ] **Step 4: 跑守卫确认通过**

Run: `npx jest --runInBand tests/unit/architecture/kernel-v2-boundaries.test.ts`
Expected: PASS（6 tests）

- [ ] **Step 5: 提交**

```bash
git add gateway/tests/unit/architecture/kernel-v2-boundaries.test.ts gateway/src/kernel-v2
git commit -m "test(kernel-v2): guard core/provider import direction"
```

---

### Task 2.12：G2 集成证明

**Files:**
- Create: `gateway/tests/integration/kernel-v2-g2.test.ts`
- Consumes: Task 2.4–2.10 的 adapters 与 fixtures

测试必须证明：**一个测试包可以在不改 gateway 核心的情况下替换内置 media / TTS / usage / ASR provider。**

- [ ] **Step 1: 写失败测试**

```ts
import { CapabilityRegistry } from '../../src/kernel-v2/capability-registry'
import { createTtsCapability } from '../../src/kernel-v2/providers/tts'
import { createUsageCapability } from '../../src/kernel-v2/providers/usage'
import { createMediaCapability, registerMediaProvider } from '../../src/kernel-v2/providers/media'
import { createAsrCapability, registerAsrEngine } from '../../src/kernel-v2/providers/asr'
import { createMediaEchoProvider } from '../fixtures/kernel-v2/media-echo-provider'
import { createFakeAsrEngine } from '../fixtures/kernel-v2/asr-fake-provider'

test('a test package can replace builtin media/asr without core edits', () => {
  const mediaRegistry = new CapabilityRegistry({ defaultId: 'pi', capability: 'media', version: '1.0.0', revision: 'g2', plane: 'gateway' })
  registerMediaProvider(mediaRegistry, { id: 'pi', modalities: ['image', 'video', 'audio'], prompt: async () => 'pi', builtin: true })
  registerMediaProvider(mediaRegistry, createMediaEchoProvider(), 'package')
  const media = createMediaCapability(mediaRegistry, { builtinPi: () => async () => 'builtin' })
  expect(media.engines().find((item) => item.id === 'echo')?.tier).toBe('package')

  const asrRegistry = new CapabilityRegistry({ defaultId: 'qwen3-asr-vllm', capability: 'asr', version: '1.0.0', revision: 'g2', plane: 'gateway' })
  registerAsrEngine(asrRegistry, createFakeAsrEngine('qwen3-asr-vllm'))
  registerAsrEngine(asrRegistry, createFakeAsrEngine('package-asr'), 'package')
  expect(createAsrCapability(asrRegistry).list().map((item) => item.id)).toContain('package-asr')
})
```

同时断言 TTS/usage 的 package tier 覆盖仍成立（复用 Phase 1 测试的 fixture，不新写核心）。

- [ ] **Step 2: 跑测试确认失败（或通过）**

Run: `npx jest --runInBand tests/integration/kernel-v2-g2.test.ts`
Expected: PASS（如果 adapters 已实现）；若失败，修 fixture/import。

- [ ] **Step 3: 提交**

```bash
git add gateway/tests/integration/kernel-v2-g2.test.ts gateway/tests/fixtures/kernel-v2
git commit -m "test(kernel-v2): prove G2 package provider replacement"
```

---

### Task 2.13：文档、路线图与交付记录

**Files:**
- Modify: `docs/architecture/gateway.md`（kernel-v2 段增加 Phase 2 provider 清单）
- Modify: `docs/superpowers/plans/2026-11-12-fixed-core-capability-roadmap.md`（embedding 移到 Phase 5；Phase 2 状态）
- Create: `docs/releases/2026-11-12-capability-kernel-phase2.md`
- Modify: `docs/superpowers/plans/2026-11-12-kernel-v2-phase2-leaf-providers.md`（勾选进度；记录测试数）

- [ ] **Step 1: 更新架构文档**

在 `docs/architecture/gateway.md` 的 kernel-v2 段追加：

```markdown
Phase 2（2026-11-12）新增叶子 provider：
- `subprocess-ledger.ts`：子进程所有权/ledger/dispose。
- `providers/media.ts`：media engine 解析，fallback 与 v1 `resolveMediaPrompt` 一致。
- `providers/asr.ts` / `asr-sidecar.ts`：ASR engine registry + sidecar provider 绑定。
- `providers/commands.ts`：command source 合并（user/project/package）。
- `providers/notifications.ts`：出站通知 fan-out；核心 broadcast 不变。
- `providers/automation.ts`：automation action provider；cron/规则校验仍在核心。
```

- [ ] **Step 2: 修正路线图**

Phase 2 顺序改为：`S3 → media → ASR → commands → notifications → automation action`；明确 `embedding/reranker` 在 Phase 5。Phase Overview 的 Phase 2 主要交付删掉 embedding。

- [ ] **Step 3: 写交付记录**

必须包含：日期、版本 5.1.0（未 bump）、commit 列表、定向测试数、gateway 全量连续 2 次结果、typecheck、明确未做（未接 live、未改 v1、未做 worker 隔离/包加载）、rollback（删除 provider 注册即可恢复旧路径）。

- [ ] **Step 4: 跑最终门禁**

```bash
cd gateway
npx jest --runInBand tests/unit/kernel-v2 tests/unit/architecture/kernel-v2-boundaries.test.ts tests/integration/kernel-v2-g2.test.ts
npx tsc --noEmit -p tsconfig.json
npx jest --runInBand --forceExit
npx jest --runInBand --forceExit
```

Expected: 定向全绿；typecheck 通过；全量连续 2 次 clean。若出现 `instance-ownership` 时序 flake，单文件重跑并记录，不归因 kernel-v2。

- [ ] **Step 5: 提交**

```bash
git add docs/architecture/gateway.md docs/superpowers/plans/2026-11-12-fixed-core-capability-roadmap.md docs/releases/2026-11-12-capability-kernel-phase2.md docs/superpowers/plans/2026-11-12-kernel-v2-phase2-leaf-providers.md
git commit -m "docs: record kernel-v2 phase 2 leaf providers"
```

**Gate G2：** 测试包可以在不改 gateway 核心的情况下替换内置 media/TTS/usage/ASR provider；全量绿；诊断可解释 fallback。

---

## Self-Review

- **Spec coverage:** Phase 2 的 5 个叶子 provider + S3 probe 均有对应 task；embedding 明确移到 Phase 5 并在 Task 2.13 修正路线图。
- **Step scan:** 每个 task 都有失败测试、失败运行、实现、通过运行、提交五步；测试断言给出具体值，实现只给签名与语义。
- **Type consistency:** `CapabilityScope` / `CapabilityTier` / `CapabilityHealth` 全部来自 `capability-registry.ts`；`ProviderHandle` 来自 `provider-lifecycle.ts`；`CustomCommandSpec` / `AsrEngine` / `MediaConfig` / `PromptFn` 使用 v1 叶子类型，不复制 DTO。
- **Review Focus:** 子进程、media fallback、scope、notification fan-out、automation missing、commands 合并顺序均有对应测试。
- **Proportion:** 计划只写接口、语义和测试断言，不写实现体；执行者按签名与测试补全实现。

## Execution Handoff

Phase 2 计划已落盘。建议按 Milestone 2A → 2G 顺序执行；每个 milestone 结束跑定向门禁，G2 前跑全量连续 2 次。执行方式沿用当前会话的 native 模式（不使用 worktree）。
