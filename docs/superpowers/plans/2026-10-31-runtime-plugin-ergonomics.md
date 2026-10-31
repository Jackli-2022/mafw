# Runtime 插件体验与契约强化 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让「接入一个新 runtime」从抄写级工程变成填表级工程：raw-event-first 成为唯一推荐路径、共享运行机械、能力声明单源、离线检查器与三级强制链，并迁移 claude/pi。

**Architecture:** gateway 侧新增「事件声明矩阵」与「能力来源解析」两个纯逻辑模块，作为 loader / validate / plugin-check 的单一判定源；适配器侧抽出 `packages/runtime-kit`（总线/会话注册表/turn 追踪），claude 改为推原生事件 + 声明映射表，翻译由 gateway 真执行器完成。

**Tech Stack:** TypeScript（gateway CJS + jest/ts-jest）、Node 22 类型剥离（adapters/claude `node --test`）、esbuild（claude 单文件打包）、esbuild 无关的纯 TS kit 包。

**Spec:** `docs/superpowers/specs/2026-10-31-runtime-plugin-ergonomics-design.md`

## Global Constraints

- 契约 JSON 变更必须 additive：`SCHEMA_VERSION` 保持 1，新字段可选。
- fail-open：任何插件错误不得让 gateway 崩溃；校验失败 → 能力降级 + `status:'error'`，仍注册。
- **不改 canonical 词汇**：`gateway/src/runtime/mafw-vocabulary.ts` 的 29 个 runtime 事件与 15 个扁平广播名不动。
- 能力盖印必须是**普通可写赋值**（`rt.capabilities = {...}`）；不得用 non-writable `defineProperty`——激活期降级路径（`coverage.applyEventStreamDeclarationDowngrade`、`validate.ts:166-169`）要继续能写。
- `packages/runtime-kit` v1 **只被 adapters 消费**；`gateway/src/**` 不得 import 它。
- 事件翻译 default-deny 语义不变：未命中映射 → 拦截 + 计数。
- 测试命令：gateway 测试在 `gateway/` 下 `npx jest --runInBand <path>`；claude 测试在 `adapters/claude/` 下 `npm test`；gateway 类型检查 `npx tsc --noEmit -p tsconfig.json`（在 gateway/ 下）。
- 每个任务结束提交一次（本地 commit），全部通过后再由用户确认推送。

## Review Focus

1. **矛盾声明**：插件同时导出 `eventTranslation:'self'` 与 `eventMappings` → 必须报错且行为确定为 declared-wins（映射照常生效），不得双重翻译或静默忽略。
2. **canonical 直推兼容**：插件不带 `eventSource` 直接推 canonical 信封（pi 风格）→ 必须原样放行，不得落 unmatched。
3. **实现但未声明**：插件实现了某 channel 却忘了能力位 → 自动补 true + 警告；channel 存在但运行时抛错 → presence 探针抓不到，归 conformance/plugin-test 责任（文档写明）。
4. **claude spawn 失败**：没有任何原生事件可推的本地失败 → 仍必须发 canonical `turn.failed` 且复位 turn 状态（否则下一回合无 `turn.started`）。
5. **plugin-check 健壮性**：文件缺 name / createRuntime 抛错 / require 失败 → 报告 + 退出码 1，绝不 uncaught 崩溃。
6. **codegen 完整性**：`--preset desktop` 生成物必须覆盖该 preset 全部 requiredSurfaces 的桩，不得有面被静默漏掉。

---

### Task 1: 事件声明矩阵（eventTranslation）

**Files:**
- Modify: `gateway/src/runtime/event-mapper.ts:49-53`（`EventMappingEntry` 增字段）
- Create: `gateway/src/runtime/event-declaration.ts`
- Modify: `gateway/src/runtime/loader.ts:145-205`
- Modify: `gateway/src/index.ts:1729-1734`
- Test: `gateway/tests/unit/runtime/event-declaration.test.ts`（新建）
- Test: `gateway/tests/unit/runtime/loader-event-mappings.test.ts`（追加用例）

**Interfaces:**
- Produces:
  ```ts
  export type EventTranslationMode = 'declared' | 'self'
  export interface EventDeclarationResolution {
    mode: EventTranslationMode
    eventStream: boolean
    issues: string[]
  }
  export function resolveEventDeclaration(
    caps: Pick<RuntimeCapabilities, 'eventStream'>,
    entry: EventMappingEntry,
  ): EventDeclarationResolution
  ```
- `EventMappingEntry` 增 `eventTranslation?: EventTranslationMode`。

**判定规则（唯一事实源，loader/index/plugin-check 都调用它）：**

| 输入 | 结果 |
|---|---|
| `eventTranslation:'self'` + 无映射/transform | `{mode:'self', eventStream: 声明值, issues: []}` |
| `eventTranslation:'self'` + 有映射或 transform | `{mode:'declared', eventStream: 声明值, issues: ['eventTranslation self contradicts eventMappings/transformEvent — declared wins']}` |
| 未声明 + 有映射或 transform | `{mode:'declared', eventStream: 声明值, issues: []}` |
| `eventStream:true` + 无声明 + 未声明 self | `{mode:'declared', eventStream:false, issues:['eventStream capability declared but no eventMappings/transformEvent — default-deny would drop the entire native stream; capability downgraded']}` |
| `eventStream:false` | `{mode: 由 self 判定同上, eventStream:false, issues: []}` |

- [ ] **Step 1: 写失败的纯逻辑测试**

`gateway/tests/unit/runtime/event-declaration.test.ts`：覆盖上表 5 行 + 「self 与映射矛盾时 mode 为 declared 且 issues 非空」。

```ts
import { resolveEventDeclaration } from '../../../src/runtime/event-declaration'

test('self without declarations keeps eventStream', () => {
  expect(resolveEventDeclaration({ eventStream: true }, { eventTranslation: 'self' }))
    .toEqual({ mode: 'self', eventStream: true, issues: [] })
})
test('self contradicting mappings → declared wins + issue', () => {
  const r = resolveEventDeclaration({ eventStream: true }, {
    eventTranslation: 'self',
    eventSource: { typePath: '$.type' },
    eventMappings: [{ from: 'x', to: 'turn.completed' }],
  })
  expect(r.mode).toBe('declared')
  expect(r.eventStream).toBe(true)
  expect(r.issues.join(' ')).toContain('contradicts')
})
test('eventStream without declarations still downgrades', () => {
  const r = resolveEventDeclaration({ eventStream: true }, {})
  expect(r.eventStream).toBe(false)
  expect(r.issues).toHaveLength(1)
})
```

- [ ] **Step 2: 跑测试确认失败**

Run（`gateway/` 下）: `npx jest --runInBand tests/unit/runtime/event-declaration.test.ts`
Expected: FAIL — cannot find module `event-declaration`

- [ ] **Step 3: 实现 `event-declaration.ts`**

按上表实现（调用 `hasEventDeclarations`），导出 `resolveEventDeclaration` 与类型。

- [ ] **Step 3b: 接线 loader**

`loader.loadFile` 用 `resolveEventDeclaration(capabilities, eventExtras)` 取代 162-169 行手写分支：`eventStream:false` 时写回能力并记 issues 进 `state.error`；`eventTranslation` 随 `meta.set` 保存。

- [ ] **Step 3c: 接线 activation**

`index.ts:1732` 的 `applyEventStreamDeclarationDowngrade(rt, hasEventDeclarations(plugin))` 改为 `resolveEventDeclaration(rt.capabilities, plugin)`；`eventStream:false` 时写回 `(rt as any).capabilities.eventStream = false` 并 log.error issues。

- [ ] **Step 4: 跑测试确认通过**

Run: `npx jest --runInBand tests/unit/runtime/event-declaration.test.ts tests/unit/runtime/loader-event-mappings.test.ts tests/unit/runtime/loader.test.ts`
Expected: PASS（loader 追加用例：文件插件导出 `eventTranslation:'self'` 且无映射 → `status:'ok'`、capabilities.eventStream 保持 true）

- [ ] **Step 5: Commit**

```bash
git add gateway/src/runtime/event-declaration.ts gateway/src/runtime/event-mapper.ts gateway/src/runtime/loader.ts gateway/src/index.ts gateway/tests/unit/runtime/event-declaration.test.ts gateway/tests/unit/runtime/loader-event-mappings.test.ts
git commit -m "feat(runtime): event declaration matrix with self-translation escape"
```

---

### Task 2: 能力声明单源盖印 + 反向校验

**Files:**
- Create: `gateway/src/runtime/capability-source.ts`
- Modify: `gateway/src/runtime/validate.ts:69-171`
- Modify: `gateway/src/index.ts:1717-1751`
- Test: `gateway/tests/unit/runtime/capability-source.test.ts`（新建）
- Test: `gateway/tests/unit/runtime/validate-shape.test.ts`（追加用例）

**Interfaces:**
- Consumes: `ContractSubject` / `probePasses`（`./coverage`）、`buildRuntimeContractManifest`（`./contract-manifest`）。
- Produces:
  ```ts
  export function resolveDeclaredCapabilities(moduleCaps?: Partial<RuntimeCapabilities>): RuntimeCapabilities
  /** 普通赋值覆盖实例；返回不一致的能力名列表描述（null=一致/无实例声明） */
  export function stampDeclaredCapabilities(rt: { capabilities?: unknown }, declared: RuntimeCapabilities): string | null
  /** 实现了但没声明的能力 → 自动补 true + warning（仅对存在 presence 探针面的能力） */
  export function deriveUndeclaredCapabilities(
    subject: ContractSubject,
    caps: RuntimeCapabilities,
  ): { caps: RuntimeCapabilities; warnings: string[] }
  ```

- [ ] **Step 1: 写失败测试**

`capability-source.test.ts`：

```ts
test('stamp overwrites instance declaration and reports differing keys', () => {
  const rt: any = { capabilities: { sessionApi: true, eventStream: false } }
  const msg = stampDeclaredCapabilities(rt, { ...minimalCapabilities(), eventStream: true })
  expect(rt.capabilities.eventStream).toBe(true)
  expect(msg).toContain('eventStream')
})
test('derive enables a capability whose presence surfaces are all implemented', () => {
  const rt: any = { name: 'x', capabilities: minimalCapabilities(), completion: { complete: async () => ({ text: '' }) } }
  const subject = { rt, source: 'file' as const }
  const out = deriveUndeclaredCapabilities(subject, rt.capabilities)
  expect(out.caps.completionApi).toBe(true)
  expect(out.warnings[0]).toContain('completionApi')
})
test('derive does not enable when only part of the gated surfaces exist', () => {
  const rt: any = { name: 'x', capabilities: minimalCapabilities(), mcp: { list: async () => [] } }
  const out = deriveUndeclaredCapabilities({ rt, source: 'file' as const }, rt.capabilities)
  expect(out.caps.mcpApi).toBeFalsy()
})
```

`validate-shape.test.ts` 追加：构造实现 `completion.complete` 但声明不含 `completionApi` 的 runtime → `validateRuntime` 的 `warnings` 含 `implemented but not declared`，且 `rt.capabilities.completionApi === true`。

- [ ] **Step 2: 跑测试确认失败**

Run: `npx jest --runInBand tests/unit/runtime/capability-source.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3a: 实现 `capability-source.ts`**

`resolveDeclaredCapabilities` = `{ ...minimalCapabilities(), ...(moduleCaps ?? {}) }`。

`stampDeclaredCapabilities`：记录差异键（实例已有 caps 且 `JSON.stringify(inst[k]) !== JSON.stringify(declared[k])`），然后 `rt.capabilities = { ...declared }`；返回 `` `declared capabilities differ from instance on: ${keys.join(', ')}` `` 或 null。

`deriveUndeclaredCapabilities`：遍历 `buildRuntimeContractManifest().capabilities`；对该能力取 `surface.capability === c.id && verification === 'presence'` 的面；`faces.length > 0 && !caps[c.id] && faces.every(s => probePasses(subject, s))` → 置 true 并 push `` `${c.id} is implemented (${ids.join(', ')}) but not declared — auto-enabled; declare it in module.exports.capabilities` ``。

- [ ] **Step 3b: 接线 validate.ts**

在读取 `caps` 后、`computeCoverage` 前构建 subject → 调 derive → 有变化时写回 `(rt as any).capabilities` 并用新 caps 继续（避免 coverage 用旧声明）。末尾降级回写逻辑保持不变。

- [ ] **Step 3c: 接线 index.ts 盖印**

`activatePluginRuntime`：`const rt = await plugin.createRuntime(...)` 之后立即 `const mismatch = stampDeclaredCapabilities(rt, plugin.capabilities); if (mismatch) log.error(...)`；**顺序** = stamp → 事件声明矩阵（Task 1）→ `applyRuntimeValidation`。

- [ ] **Step 4: 跑测试确认通过**

Run: `npx jest --runInBand tests/unit/runtime/capability-source.test.ts tests/unit/runtime/validate-shape.test.ts tests/unit/runtime/validate-coverage.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add gateway/src/runtime/capability-source.ts gateway/src/runtime/validate.ts gateway/src/index.ts gateway/tests/unit/runtime/capability-source.test.ts gateway/tests/unit/runtime/validate-shape.test.ts
git commit -m "feat(runtime): single-source capabilities with reverse derivation"
```

---

### Task 3: coverage 译文模式标注

**Files:**
- Modify: `gateway/src/runtime/coverage.ts:36-77,124-191`
- Test: `gateway/tests/unit/runtime/coverage.test.ts`

**Interfaces:**
- `RuntimeCoverage['static']` 增：
  ```ts
  translation: { mode: 'declared' | 'self'; note: string }
  ```

- [ ] **Step 1: 写失败测试**

```ts
test('declaration eventTranslation self is annotated (not recommended)', () => {
  const subject = { rt: fakeRt, declaration: { eventTranslation: 'self' as const }, source: 'file' as const }
  const cov = computeCoverage(subject, buildRuntimeContractManifest())
  expect(cov.static.translation).toEqual({ mode: 'self', note: expect.stringContaining('not recommended') })
})
test('absent eventTranslation defaults to declared', () => {
  const cov = computeCoverage({ rt: fakeRt, source: 'file' }, buildRuntimeContractManifest())
  expect(cov.static.translation).toEqual({ mode: 'declared', note: '' })
})
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npx jest --runInBand tests/unit/runtime/coverage.test.ts`
Expected: FAIL — `translation` undefined

- [ ] **Step 3: 实现**

`computeCoverage` 读取 `subject.declaration?.eventTranslation ?? 'declared'`，写入 `static.translation`。无需改 `GET /api/runtime`——`index.ts:2310` 已整体返回 `coverage`。

- [ ] **Step 4: 跑测试确认通过**

Run: `npx jest --runInBand tests/unit/runtime/coverage.test.ts tests/unit/runtime/validate-coverage.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add gateway/src/runtime/coverage.ts gateway/tests/unit/runtime/coverage.test.ts
git commit -m "feat(runtime): annotate translation mode in contract coverage"
```

---

### Task 4: `packages/runtime-kit`

**Files:**
- Create: `packages/runtime-kit/package.json`
- Create: `packages/runtime-kit/src/index.ts`
- Create: `packages/runtime-kit/src/event-bus.ts`
- Create: `packages/runtime-kit/src/session-registry.ts`
- Create: `packages/runtime-kit/src/turn-tracker.ts`
- Create: `packages/runtime-kit/src/event-bus.test.ts`
- Create: `packages/runtime-kit/src/session-registry.test.ts`
- Create: `packages/runtime-kit/src/turn-tracker.test.ts`
- Modify: `package.json`（root scripts 增 `"test:kit": "node --test packages/runtime-kit/src"`）

**Interfaces（后续任务依赖，务必逐字一致）：**

```ts
export interface EventBus<T = any> {
  push(value: T): void
  event(): Promise<{ stream: AsyncIterable<T> }>
}
export function createEventBus<T = any>(): EventBus<T>

export interface RegistrySession<Q> {
  directory: string
  busy: boolean
  queue: Q[]
  controller: { interrupt(): void } | null
}
export interface SessionRegistry<Q, X extends object = {}> {
  get(sid: string): (RegistrySession<Q> & X) | undefined
  getOrCreate(sid: string, directory: string): RegistrySession<Q> & X
  begin(sid: string): void
  attach(sid: string, controller: { interrupt(): void } | null): void
  enqueue(sid: string, item: Q): void
  finish(sid: string): Q | null
  clearQueue(sid: string): void
  delete(sid: string): void
  entries(): IterableIterator<[string, RegistrySession<Q> & X]>
}
export function createSessionRegistry<Q, X extends object = {}>(
  init?: (directory: string) => X,
): SessionRegistry<Q, X>

export interface TurnTrackerOptions<T> {
  push(value: T): void
  sessionIdOf(raw: T): string | undefined
  isTurnStart(raw: T): boolean
  isTerminal(raw: T): boolean
  makeTurnStarted(sessionID: string): T
}
export interface TurnTracker<T> {
  push(raw: T): void
  reset(sessionID: string): void
}
export function createTurnTracker<T>(opts: TurnTrackerOptions<T>): TurnTracker<T>
```

**语义约定：** 总线不重放（订阅前 push 的值丢弃，与 claude 现状一致）；注册表 `finish` 置 `busy:false` 并 FIFO 出队一条；tracker 每会话首条 start → 先 push 合成 start 再 push 原事件，terminal → 复位后 push，`reset` 供本地失败路径调用。

- [ ] **Step 1: 写失败测试（三个文件）**

- `event-bus.test.ts`：两个订阅者都收到同一批值；无订阅时 push 不缓存（后订阅收不到）。
- `session-registry.test.ts`：同 sid `getOrCreate` 返回同引用；`enqueue` 两条后 `finish` 依次返回 FIFO 项；`clearQueue` 清空；`delete` 后 `get` 为 undefined；`init(directory)` 扩展字段生效。
- `turn-tracker.test.ts`：首条 start → 输出 `[turn.started, raw]`；同会话第二条 start → 仅 `[raw]`；terminal 后再次 start → 重新合成；`sessionIdOf` undefined → 原样透传；`reset(sid)` 后下一 start 重新合成。

- [ ] **Step 2: 跑测试确认失败**

Run: `npm run test:kit`
Expected: FAIL — 找不到模块

- [ ] **Step 3: 实现三个模块 + index.ts 再导出 + package.json**

`packages/runtime-kit/package.json`：`{ "name": "@mafw/runtime-kit", "version": "0.0.0", "private": true, "type": "module", "main": "src/index.ts", "scripts": { "test": "node --test src" } }`。内部相对 import 一律带 `.ts` 后缀（Node 类型剥离 + esbuild 都能解析）。

- [ ] **Step 3b: 注册 workspace**

Run（repo 根）: `npm install`
Expected: rc=0；`package-lock.json` 出现 `packages/runtime-kit` 条目（workspace 链接）。

- [ ] **Step 4: 跑测试确认通过**

Run: `npm run test:kit`
Expected: PASS（三个文件全部通过）

- [ ] **Step 5: Commit**

```bash
git add packages/runtime-kit package.json package-lock.json
git commit -m "feat(runtime-kit): shared bus, session registry, turn tracker"
```

---

### Task 5: 离线检查器 `plugin-check`

**Files:**
- Create: `gateway/src/runtime/plugin-check.ts`
- Modify: `gateway/src/runtime/event-mapper.ts`（导出 `canonicalTypeSet()`）
- Modify: `bin/mafw.js`（命令表 line ~66 + case ~446 + help）
- Test: `gateway/tests/unit/runtime/plugin-check.test.ts`

**Interfaces:**
- `event-mapper.ts` 增：
  ```ts
  export function canonicalTypeSet(): ReadonlySet<string> // RUNTIME_IDENTITY_TYPES 的 Set
  ```
- `plugin-check.ts`：
  ```ts
  export interface PluginCheckOptions { file: string; preset?: PresetId; strict?: boolean }
  export interface PluginCheckReport {
    file: string
    name?: string
    status: 'ok' | 'error'
    error?: string
    translation: { mode: 'declared' | 'self'; issues: string[] }
    hard: string[]
    downgraded: string[]
    warnings: string[]
    preset: PresetId
    presetMissing: string[]
    samples?: { total: number; translated: number; suppressed: number; unmatched: number; invalid: number }
  }
  export async function runPluginCheck(opts: PluginCheckOptions): Promise<PluginCheckReport>
  export function pluginCheckExitCode(r: PluginCheckReport, strict?: boolean): number
  ```
- 退出码：`status==='error' || hard.length>0` → 1；`strict && presetMissing.length>0` → 1；`samples && samples.total>0 && samples.translated===0` → 1；否则 0。
- 插件侧新增可选模块导出：`sampleEvents?: any[]`（原生事件数组；loader 忽略，plugin-check 使用）。

- [ ] **Step 1: 写失败测试（临时目录夹具）**

```ts
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'plugin-check-'))
const good = path.join(dir, 'good.js')
fs.writeFileSync(good, `module.exports = {
  name: 'good', capabilities: { eventStream: true },
  eventSource: { typePath: '$.type' },
  eventMappings: [{ from: 'done', to: 'turn.completed' }],
  sampleEvents: [{ type: 'done', sessionID: 's1' }],
  async createRuntime() { return { name: 'good', capabilities: {},
    session: { async create(){return {id:'s1'}}, async promptAsync(){}, async prompt(){return {parts:[]}},
      async messages(){return {data:[]}}, async get(){return {}}, async delete(){}, async abort(){},
      async list(){return []}, async todo(){return []}, async children(){return []}, async summarize(){} },
    global: { async event(){ return {stream: (async function*(){})()} } },
    provider: { async list(){return {all:[],connected:[],default:{}}} },
    app: { async agents(){return []} },
    config: { async get(){return {}}, async update(c){return c} },
    tools: { async registerTools(){}, nativeTools(){return []} },
    getBaseUrl(){return 'http://127.0.0.1:3000'} } } }`)
test('good plugin exits 0', async () => {
  const r = await runPluginCheck({ file: good })
  expect(r.status).toBe('ok')
  expect(r.samples?.translated).toBe(1)
  expect(pluginCheckExitCode(r)).toBe(0)
})
```
追加：缺 name → status error + exit 1；`createRuntime` 抛错 → status error；`eventTranslation:'self'` 无映射 → `translation.mode==='self'`；strict + 只实现 session 的面 → `presetMissing` 非空且 exit 1。

- [ ] **Step 2: 跑测试确认失败**

Run: `npx jest --runInBand tests/unit/runtime/plugin-check.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: 实现 `plugin-check.ts` + CLI**

流程：清 `require.cache` → `require(file)` → 校验 name/createRuntime → 构建 entry → `validateEventMappings(entry, canonicalTypeSet())` → `resolveEventDeclaration` → `createRuntime(createRuntimePluginContext(undefined, { gatewayPort: config.server.apiPort }))` → `stampDeclaredCapabilities(rt, resolveDeclaredCapabilities(mod.capabilities))` → `validateRuntime(rt, file)` → 若 `Array.isArray(mod.sampleEvents)` 用 `applyEventMappings` 逐条统计（hooks 计数 translated/suppressed/unmatched；输出非 canonical → invalid）→ 组装报告。全程 try/catch，异常进 `status:'error'`。

`bin/mafw.js`：命令表加 `'plugin-check'`；case：
```js
case 'plugin-check': await runPluginCheckCli(); break;
```
`runPluginCheckCli` 动态 require `../gateway/dist/runtime/plugin-check.js`，解析 `process.argv.slice(3)`（file、`--preset`、`--strict`、`--json`），打印报告并设 `process.exitCode`；gateway dist 缺失时提示先 `npm run build`。

- [ ] **Step 4: 跑测试确认通过**

Run: `npx jest --runInBand tests/unit/runtime/plugin-check.test.ts tests/unit/runtime/event-declaration.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add gateway/src/runtime/plugin-check.ts gateway/src/runtime/event-mapper.ts bin/mafw.js gateway/tests/unit/runtime/plugin-check.test.ts
git commit -m "feat(runtime): offline plugin-check with sampleEvents"
```

---

### Task 6: claude 迁 raw-event-first + kit

**Files:**
- Modify: `adapters/claude/src/events.ts`（删迷你执行器，保留表 + transform）
- Modify: `adapters/claude/src/runtime.ts`（推原生事件 + kit）
- Modify: `adapters/claude/src/index.ts`（`eventTranslation`，能力单源）
- Modify: `adapters/claude/tests/events.test.ts`（只测 transform 纯函数）
- Modify: `adapters/claude/tests/runtime.test.ts`（raw 总线 + tracker）
- Create: `gateway/tests/unit/runtime/claude-adapter-mappings.test.ts`（真执行器跑同一张表）

**Interfaces:**
- `events.ts` 新增：
  ```ts
  export function isClaudeTurnStart(raw: any): boolean // raw?.type === 'user'
  export function isClaudeTerminal(raw: any): boolean  // raw?.type === 'result'
  ```
- `runtime.ts` 使用 `createEventBus` / `createSessionRegistry` / `createTurnTracker`（`../../../packages/runtime-kit/src/index.ts`）。

- [ ] **Step 1: 先写 gateway 侧真执行器测试（失败）**

`gateway/tests/unit/runtime/claude-adapter-mappings.test.ts` 导入 `'../../../adapters/claude/src/events'`，用 `applyEventMappings(raw, entry, t => canonicalTypeSet().has(t))` 覆盖现有 events.test.ts 的 ①–⑩（system×3 / result 七终态 / assistant 拆分 / user 文本 / tool_result / stream_event 三分派）。关键断言：result 行输出 `turn.completed` 且带 usage/cost；未知类型（`task_progress`）→ `[]`（suppressed）；**新增契约断言：user 文本事件经表执行后只有 `message.updated` + `part.updated`，不含 `turn.started`**（合成归 tracker——现状会输出 turn.started，故此断言当前必红）。

- [ ] **Step 2: 跑测试确认失败**

Run（`gateway/`）: `npx jest --runInBand tests/unit/runtime/claude-adapter-mappings.test.ts`
Expected: FAIL — 至少 `turn.started` 反断言失败（现表执行 user 文本会输出 turn.started，说明合成仍挂在 transformEvent 上）

- [ ] **Step 3a: 删除迷你执行器**

`events.ts`：删 `getPath/setPath/evalField/matchWhen/translateClaudeEvent`（约 45-94、286-318 行）与 `turnStartedBySession`、`__resetClaudeTurnState`；保留 `CLAUDE_EVENT_SOURCE`、`CLAUDE_EVENT_MAPPINGS`、`claudeTransformEvent`；删除 transform 内 user 分支的 turn.started 合成（该状态归 tracker），保留 `isClaudeTurnStart`/`isClaudeTerminal` 导出。

- [ ] **Step 3b: 改造 runtime**

`runtime.ts`：`spawn` 循环 `bus.push({ ...msg, session_id: sid0 })`（raw）；失败分支 `tracker.reset(sid); bus.push({ payload: { type: 'turn.failed', properties: { sessionID: sid, error: message } }, sessionID: sid })`；会话状态改由 `createSessionRegistry`（`firstPrompt` 放扩展字段）；删除实例 `capabilities` 对象。

- [ ] **Step 3c: 入口声明单源**

`index.ts`：导出 `export const eventTranslation = 'declared'`；capabilities 保持唯一一份（runtime.ts 那份已删）。

- [ ] **Step 4: 更新 claude 测试并跑绿**

`tests/events.test.ts` 保留 transform 级断言（assistant/user/tool_result/stream_event/声明完整性），删除 turn.started/result 复位断言（迁到 runtime/tracker 测试）。`tests/runtime.test.ts` 断言：raw 事件进总线后由 tracker 合成 turn.started；spawn 失败发出 canonical turn.failed 且下一回合重新合成 start。

Run: `npx jest --runInBand tests/unit/runtime/claude-adapter-mappings.test.ts`（gateway/）与 `npm test`（adapters/claude/）
Expected: 两边 PASS

- [ ] **Step 5: 构建 + plugin-check 验收**

Run（`gateway/`）: `npx tsc -p tsconfig.json`
Run（repo 根）: `node bin/mafw.js plugin-check adapters/claude/dist/claude.js --preset core`
（先 `cd adapters/claude && npm run build`）
Expected: 输出 `status: ok`、`translation.mode: declared`、退出码 0

- [ ] **Step 6: Commit**

```bash
git add adapters/claude/src adapters/claude/tests gateway/tests/unit/runtime/claude-adapter-mappings.test.ts
git commit -m "refactor(adapter-claude): raw-event-first via gateway executor + runtime-kit"
```

---

### Task 7: manifest 驱动脚手架 + openai 模板重写

**Files:**
- Modify: `scripts/generate-runtime-plugin.mjs`

**Interfaces:**
- CLI：`--preset core|conversation|autonomous|desktop`（缺省 `conversation`）、`--check <file>`（委托 gateway dist plugin-check）、`--template openai`（默认空骨架，事件出口为 canonical v2）。
- 生成物模块导出：`preset`、`eventSource`、`eventMappings`、`transformEvent?`、`sampleEvents`、`eventTranslation:'declared'`。

- [ ] **Step 1: 改造 manifest 读取与桩生成**

`loadManifest()` 读 `packages/gateway-sdk/contract/runtime-contract.json`；`stubsFor(preset)` 按 `requiredSurfaces`：`session.*` 面生成同名方法桩（注释带 surface `title`）、`tools.registerTools`/`tools.nativeTools`/`events.global` 生成对应桩、其余生成 `// TODO(contract:<id>): <title>` 注释。

- [ ] **Step 2: 重写 openai 模板事件出口**

生成插件在 SSE 循环里推**原始事件**（附路由字段）：
`{ type:'chunk', sessionID, messageID, partID, choices, usage? }`、`{ type:'done', sessionID, messageID, usage }`、`{ type:'error', sessionID, error }`；
声明映射行：
```js
eventSource: { typePath: '$.type', sessionIdPath: '$.sessionID' },
eventMappings: [
  { from: 'chunk', to: 'part.delta', when: [{ path: '$.choices[0].delta.content', exists: true }],
    fields: { messageID: { path: '$.messageID' }, partID: { path: '$.partID' }, field: { const: 'text' }, delta: { path: '$.choices[0].delta.content' } } },
  { from: 'done', to: 'turn.completed', fields: { messageID: { path: '$.messageID' }, usage: { path: '$.usage' }, cost: { path: '$.cost' } } },
  { from: 'error', to: 'turn.failed', fields: { error: { path: '$.error' } } },
],
sampleEvents: [{ type: 'done', sessionID: 'sample', messageID: 'm1' }],
```

- [ ] **Step 3: `--check` 委托 plugin-check**

`--check <file>`：`require('../gateway/dist/runtime/plugin-check.js')` 跑报告并透传退出码（dist 缺失 → 退出码 2 + 提示）。

- [ ] **Step 4: 验证（开发工具，无单测；用执行验证）**

Run: `node scripts/generate-runtime-plugin.mjs --name smoke --preset core --out <tmp> --mock --self-test`
Expected: self-test 退出码 0
Run: `node scripts/generate-runtime-plugin.mjs --name smoke2 --template openai --preset conversation --out <tmp>`
Run: `node bin/mafw.js plugin-check <tmp>/smoke2.js --preset conversation --strict`
Expected: 退出码 0（若生成物缺面则补桩直到通过——这是脚手架完整性的验收）

- [ ] **Step 5: Commit**

```bash
git add scripts/generate-runtime-plugin.mjs
git commit -m "feat(codegen): manifest-driven runtime plugin scaffold (v2 events)"
```

---

### Task 8: pi 核对 + 文档 + 全量门禁

**Files:**
- Modify: `docs/guides/runtime-plugin-authoring.md`
- Modify: `gateway/src/runtime/loader.ts`（README_CONTENT）
- Test: `gateway/tests/unit/runtime/loader-builtin.test.ts`（追加用例）

- [ ] **Step 1: pi 单源回归测试**

追加断言：`loader.registerBuiltin('pi', factory, PI_CAPABILITIES, false, …)` 后 `loader.get('pi')!.capabilities === PI_CAPABILITIES`（对象同一性）。确认 `pi-runtime.ts:241` 返回同一对象——若不满足则改为引用同一常量。

- [ ] **Step 2: 更新编写指南与 loader README**

指南：新增「事件声明（declared 是标准路径）」「`eventTranslation:'self'` 逃逸与代价」「`sampleEvents` + `mafw plugin-check` 离线检查」「`preset` 导出」四节；测试命令、退出码语义、与 `mafw plugin-test`（在线）的分工。README_CONTENT 同步三句：declared 推荐、self 逃逸需标注、sampleEvents/plugin-check。

- [ ] **Step 3: 全量门禁**

Run（`gateway/`）: `npx jest --runInBand --forceExit`
Expected: 全部 suites PASS
Run（`gateway/`）: `npx tsc --noEmit -p tsconfig.json`
Expected: rc=0
Run（repo 根）: `npm run test:kit`
Expected: PASS
Run（`adapters/claude/`）: `npm test && npm run build`
Expected: PASS + dist 生成
Run（repo 根）: `node bin/mafw.js plugin-check adapters/claude/dist/claude.js --preset core`
Expected: 退出码 0
Run（`packages/desktop/`）: `npx tsgo --noEmit -p tsconfig.json`（本批零桌面改动，作为回归）
Expected: rc=0

- [ ] **Step 4: Commit**

```bash
git add docs/guides/runtime-plugin-authoring.md gateway/src/runtime/loader.ts gateway/tests/unit/runtime/loader-builtin.test.ts
git commit -m "docs(runtime): plugin authoring guide for declared events + plugin-check"
```

---

## Self-Review

- **Spec 覆盖**：G1→Task 1/6；G2→Task 4；G3→Task 2；G4→Task 7；G5→Task 1(降级)/2(校验)/3(标注)/5(check)；G6→Task 6/8。§4.7 兼容矩阵由 Task 1 的判定表承接（v1 只区分 declared/self；带恒等行的 legacy 自翻译者行为等价 declared，无需额外分支）。
- **类型一致性**：`EventTranslationMode` 在 Task 1 定义、Task 3/5/6 引用；`TurnTracker.reset` 在 Task 4 定义、Task 6 使用；`canonicalTypeSet` 在 Task 5 定义并在 Task 6 测试中复用。
- **Review Focus 归属**：1→Task 1 测试；2→Task 1/6（claude 信封直推路径）；3→Task 2；4→Task 6 runtime 测试；5→Task 5；6→Task 7 验收。
