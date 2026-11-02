# Runtime Isolation / Experience 全量迁移 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 完成除 dsh 外的全部 Runtime Isolation / Experience 收尾：所有现役客户端消费 MAFW View DTO 与 Experience Contract，最后实际删除 flat↔wire、旧 SDK namespace、旧路由别名和前端兼容推导。

**Architecture:** 先建立唯一的 View DTO 源与 Experience v2 schema，再补齐 gateway 的 background/terminal 中性面和 surface 门禁；随后迁移 session-ui、desktop、TUI/SDK、mobile；全部消费者切换后，才翻转历史/SSE 出口并删除兼容层。adapter 内部的原生协议翻译始终保留。

**Tech Stack:** TypeScript、Node 22、Jest、node --test/tsx、SolidJS、Dart/Flutter、现有 runtime manifest/experience emitter、SSE 与 WebSocket。

**Spec:** `docs/superpowers/specs/2026-11-02-runtime-experience-full-migration-design.md`

## Global Constraints

- 范围排除 dsh；mobile 必须纳入；本批结束实际删除所列兼容 shim。
- 不承诺旧 desktop/TUI/mobile 连接新 gateway；本批是有意 breaking change。
- gateway 业务核心不得读取 runtime 名称、裸 capabilities、原生 SDK 类型或 runtime 私有路径；composition root 与 Diagnostics/Admin 例外必须逐点白名单。
- 前端业务组件只消费 Experience Action Descriptor 与 MAFW View DTO；Diagnostics/Admin 不得向业务组件转发裸 runtime 面。
- 原生优先；可靠 fallback 才使用 MAFW 能力；不支持时 `supported=false`，不得伪造语义。
- adapter 内部 native→canonical 翻译不属于待删 shim。
- 所有生成物由 emitter 生成，禁止手改：`runtime-contract.json`、`experience-contract.json`、`gateway-paths.json`、`openapi.json`、`api-schema.gen.ts`、`view-dto.json`。
- `ActionDescriptor` 不变量：`supported=false ⇒ enabled=false`；`enabled=true ⇒ supported=true`；loading/error 不得投影成 `unsupported`。
- 每个任务先红后绿；每个任务结束单独 commit；不提交用户并行改动。
- gateway typecheck：`cd gateway; npx tsc --noEmit -p tsconfig.json`。
- desktop typecheck：`cd packages/desktop; npx tsgo --noEmit -p tsconfig.json`。
- 全量 gateway：`cd gateway; npx jest --runInBand --forceExit`。
- Node 包全量：`npm test -w @mafw/sdk`、`npm test -w @mafw/session-ui`、`npm test -w @mafw/tui`、`npm run test:desktop`。

## Review Focus

1. **flat DTO 字段完备性**：tool part 的 `id/callID/tool/toolClass/state`、text/reasoning 的 `time/synthetic/signature`、message 的 `summary/model/agent/error/stopReason` 在历史与 live 路径都不能丢；由 Task 1、Task 8、Task 9、Task 14 的 golden 钉住。
2. **supported 与 enabled 分离**：busy、loading、missing-data、对象级不可逆不能伪装成 unsupported；由 Task 2、Task 10 的 Experience 矩阵钉住。
3. **background 三源去重**：同一个 shell/subagent 通过 TaskService 与 runtime/subagent 来源各出现一次时必须按稳定 id 合并；由 Task 3、Task 11 钉住。
4. **terminal 中性协议**：desktop 只允许 MAFW ticket、WS URL 与版本化帧，不能出现 `x-opencode-ticket`、原生 `/api/pty` 或原生帧帧头；由 Task 4、Task 11 钉住。
5. **升级后 replay/mobile 无旧形状**：event_log 旧 `properties.info` 必须迁移；旧 mobile wire 不保留 fallback；由 Task 13、Task 14、Task 15 钉住。

---

### Task 1: MAFW View DTO 单一源与 gateway mirror

**Files:**
- Create: `packages/gateway-sdk/src/view-dto.ts`
- Create: `packages/gateway-sdk/src/view-dto.test.ts`
- Create: `scripts/sync-view-dto.mjs`
- Create: `gateway/src/runtime/view-dto.generated.ts`
- Create: `gateway/tests/unit/runtime/view-dto-sync.test.ts`
- Create: `packages/gateway-sdk/contract/view-dto.json`
- Modify: `packages/gateway-sdk/src/index.ts`
- Modify: `gateway/src/runtime/canonical-types.ts`
- Modify: `package.json`

**Interfaces:**
- Produces: `VIEW_DTO_CONTRACT_VERSION: '2026.11.0'`
- Produces: `MafwMessage`, `MafwPart`, `MafwSession`, `MafwSessionStatus`, `MafwDiff`, `MafwProvider`, `MafwModel`, `MafwAgent`, `MafwPermissionRequest`, `MafwQuestionRequest`, `MafwBackgroundJob`, `MafwPartTime`
- Produces: `isMafwMessage(v: unknown): v is MafwMessage`、`isMafwPart(v: unknown): v is MafwPart`
- Produces: `VIEW_DTO_REQUIRED_FIELDS: Record<string, readonly string[]>`
- `gateway/src/runtime/canonical-types.ts` 改为从 `./view-dto.generated` re-export，现有 `MafwMessage` / `MafwPart` 导入路径不变。

- [ ] **Step 1: Write the failing tests**

`packages/gateway-sdk/src/view-dto.test.ts`:
```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  isMafwMessage,
  VIEW_DTO_REQUIRED_FIELDS,
  type MafwMessage,
} from './view-dto';

test('message and tool part keep identity and canonical fields', () => {
  const msg: MafwMessage = {
    id: 'msg_1', sessionID: 'ses_1', role: 'assistant',
    model: { providerID: 'pi', modelID: 'm1' },
    stopReason: 'cancelled',
    content: [{
      id: 'part_1', sessionID: 'ses_1', messageID: 'msg_1', type: 'tool',
      callID: 'call_1', tool: 'shell', toolClass: 'shell', canonicalTool: 'bash',
      state: { status: 'completed', input: { command: 'pwd' }, output: '/tmp' },
    }],
  };
  assert.equal(isMafwMessage(msg), true);
  assert.deepEqual(VIEW_DTO_REQUIRED_FIELDS.part, ['id', 'type']);
});

test('provider models are always arrays', () => {
  assert.deepEqual(VIEW_DTO_REQUIRED_FIELDS.provider, ['id', 'name', 'models']);
  assert.deepEqual(VIEW_DTO_REQUIRED_FIELDS.model, ['id', 'name']);
});
```

`gateway/tests/unit/runtime/view-dto-sync.test.ts`:
```ts
import * as fs from 'fs';
import * as path from 'path';

const root = path.resolve(__dirname, '../../../..');
const source = path.join(root, 'packages/gateway-sdk/src/view-dto.ts');
const mirror = path.join(root, 'gateway/src/runtime/view-dto.generated.ts');

test('gateway View DTO mirror matches the SDK source', () => {
  const expected = fs.readFileSync(source, 'utf-8')
    .replace(/^\/\*\*[\s\S]*?\*\/\n/, '');
  const actual = fs.readFileSync(mirror, 'utf-8')
    .replace(/^\/\*\*[\s\S]*?\*\/\n/, '');
  expect(actual.trim()).toBe(expected.trim());
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -w @mafw/sdk -- --test-name-pattern=view-dto`
Expected: FAIL（`view-dto.ts` 不存在）。

Run: `cd gateway; npx jest --runInBand tests/unit/runtime/view-dto-sync.test.ts`
Expected: FAIL（mirror 不存在）。

- [ ] **Step 3: Implement the contract source, sync script, and mirror**

实现完整判别联合，至少包含 spec §5.2/§5.3 的字段。`MafwMessage` 使用 `role: 'user' | 'assistant'`、`content?: MafwPart[]`、`model?: {providerID:string; modelID:string}`、`stopReason?: StopReason`；`MafwPart` 使用 `id/type` 主干和 text/reasoning/tool/file/step-start/step-finish/compaction/agent/data-* 变体。允许 `extensions?: Record<string, unknown>`，禁止通用 `native`。

`scripts/sync-view-dto.mjs` 读取 SDK 源文件，替换首部注释为：

```ts
/** AUTO-GENERATED from packages/gateway-sdk/src/view-dto.ts — run npm run sync:view-dto. */
```

写入 gateway mirror。`package.json` 增加 `"sync:view-dto": "node scripts/sync-view-dto.mjs"`。

在 `packages/gateway-sdk/contract/view-dto.json` 写入 `{ contractVersion, messages, parts, session, diff, provider, agent, permission, question, background }` 的字段清单；`VIEW_DTO_REQUIRED_FIELDS` 是同一清单的 TypeScript 投影。增加 freshness 测试比较 JSON 与常量。

`canonical-types.ts` 仅保留 re-export 与旧守卫转出，不再维护第二份接口。

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -w @mafw/sdk -- --test-name-pattern=view-dto`
Expected: PASS。

Run: `cd gateway; npx jest --runInBand tests/unit/runtime/view-dto-sync.test.ts`
Expected: PASS。

Run: `cd gateway; npx tsc --noEmit -p tsconfig.json`
Expected: rc=0。

- [ ] **Step 5: Commit**

```bash
git add packages/gateway-sdk/src/view-dto.ts packages/gateway-sdk/src/view-dto.test.ts packages/gateway-sdk/src/index.ts packages/gateway-sdk/contract/view-dto.json scripts/sync-view-dto.mjs gateway/src/runtime/view-dto.generated.ts gateway/src/runtime/canonical-types.ts gateway/tests/unit/runtime/view-dto-sync.test.ts package.json
git commit -m "feat(contract): add shared MAFW view DTO"
```

---

### Task 2: Experience Contract v2（supported/enabled 与动作扩容）

**Files:**
- Modify: `gateway/src/experience/experience-contract.ts`
- Modify: `gateway/src/experience/experience-projector.ts`
- Modify: `packages/gateway-sdk/src/experience-contract.ts`
- Modify: `packages/gateway-sdk/src/experience.test.ts`
- Modify: `gateway/tests/unit/experience/experience-contract.test.ts`
- Modify: `gateway/tests/unit/experience/experience-json.test.ts`
- Modify: `gateway/tests/unit/experience/experience-store.test.ts`（若桌面 store 测试路径不同，以现有 store 测试为准）
- Modify: `gateway/scripts/emit-experience-contract.ts`
- Modify: `packages/gateway-sdk/contract/experience-contract.json`

**Interfaces:**
- Produces: `ActionDescriptor { supported: boolean; enabled: boolean; reason?: ActionUnavailableReason; warningKey?: string; semantics?: Record<string, unknown> }`
- Produces: `ExperienceActionsResponse { experienceVersion: string; minClientVersion?: string; sessionID?: string; actions: Partial<Record<ExperienceActionId, ActionDescriptor>> }`
- Produces action ids：`checkpoint.restore`、`checkpoint.create`、`branch.fork`、`branch.revert`、`branch.unrevert`、`branch.diff`、`run.control`、`session.worktree`、`session.summarize`、`session.switch-agent`、`session.switch-model`、`session.discovery`、`approval.permission`、`approval.question`、`background.jobs`、`terminal.attach`、`prompt.steer`、`session.background`、`mcp.manage`、`mcp.config.write`
- Produces helper: `action(supported: boolean, enabled: boolean, reason?: ActionUnavailableReason, semantics?: Record<string, unknown>): ActionDescriptor`

- [ ] **Step 1: Write the failing invariant tests**

```ts
test('supported/enabled invariant and all action ids project', () => {
  const actions = projectExperienceActions(fakeAccessAll(), { busy: true });
  expect(Object.keys(actions).sort()).toEqual([...EXPERIENCE_ACTION_IDS].sort());
  for (const a of Object.values(actions)) {
    if (!a.supported) expect(a.enabled).toBe(false);
    if (a.enabled) expect(a.supported).toBe(true);
  }
  expect(actions['run.control']).toMatchObject({ supported: true, enabled: false, reason: 'busy' });
  expect(actions['branch.fork'].supported).toBe(true);
  expect(actions['branch.fork'].enabled).toBe(false);
});

test('unsupported and busy are distinct', () => {
  const noAccess = projectExperienceActions(null, { busy: false });
  expect(noAccess['branch.fork']).toEqual({ supported: false, enabled: false, reason: 'unsupported' });
});
```

SDK 侧测试固定 `EXPERIENCE_VERSION`、20 个 id 与 gateway 完全一致。

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd gateway; npx jest --runInBand tests/unit/experience/experience-contract.test.ts`
Expected: FAIL（`supported` 缺失、action 数量不符）。

- [ ] **Step 3: Implement gateway + SDK schema and projection**

busy 只影响需要空闲/可写状态的 action：`checkpoint.restore`、`branch.fork/revert/unrevert`、`run.control` 的 suspend 语义、`prompt.steer` 等；纯查询动作仍 `enabled=true`。`checkpoint.restore` 增加 `semantics.sessionBacked: true`；`branch.revert` 增加 `{files,undo}`；`run.control` 增加 `{suspend,resume,discard,requireBusy}`。

更新 emitter 与 JSON，禁止手改生成物。

- [ ] **Step 4: Run tests and typecheck**

Run: `cd gateway; npx jest --runInBand tests/unit/experience`
Expected: PASS。

Run: `npm test -w @mafw/sdk`
Expected: PASS。

Run: `cd gateway; npm run emit:experience-contract`
Expected: 只有预期 JSON 变化。

- [ ] **Step 5: Commit**

```bash
git add gateway/src/experience packages/gateway-sdk/src/experience-contract.ts packages/gateway-sdk/src/experience.test.ts gateway/tests/unit/experience gateway/scripts/emit-experience-contract.ts packages/gateway-sdk/contract/experience-contract.json
git commit -m "feat(experience): separate support from availability"
```

---

### Task 3: 统一 background jobs 聚合与 canonical 事件

**Files:**
- Create: `gateway/src/core/background/background-jobs.ts`
- Create: `gateway/tests/unit/background/background-jobs.test.ts`
- Create: `gateway/src/routes/background-jobs.ts`
- Create: `gateway/tests/unit/background/background-jobs-route.test.ts`
- Modify: `gateway/src/experience/experience-projector.ts`
- Modify: `gateway/src/runtime/mafw-vocabulary.ts`
- Modify: `gateway/src/runtime/event-flow-matrix.ts`
- Modify: `packages/gateway-sdk/src/events.ts`
- Modify: `gateway/src/runtime/opencode-events.ts`
- Modify: `gateway/src/runtime/opencode-21-events.ts`
- Modify: `gateway/src/routes/route-catalog.ts`
- Modify: `gateway/src/index.ts`
- Modify: `packages/gateway-sdk/src/client.ts`
- Modify: `packages/gateway-sdk/src/types.ts`
- Modify: `packages/desktop/src/preload/mafw-types.ts`
- Modify: `packages/desktop/src/preload/mafw-api.ts`

**Interfaces:**
- Produces: `MafwBackgroundJob`（Task 1）与 `MafwBackgroundOutput`（`cursor`, `data`, `truncated`）
- Produces: `mergeBackgroundJobs(parentSessionID: string, rows: BackgroundRows): MafwBackgroundJob[]`
- Produces: `BackgroundRows { tasks: TaskEntity[]; runtimeShells: RuntimeShellRow[]; subagents: SessionInfo[] }`
- Produces REST：`GET /api/background/jobs?sessionID=`、`GET /api/background/jobs/:id/output?sessionID=&cursor=`、`POST /api/background/jobs/:id/cancel`
- Produces canonical event：`background.job.updated { job: MafwBackgroundJob }`
- SDK：`background.jobs.list(sessionID)`、`background.jobs.output(sessionID,id,cursor?)`、`background.jobs.cancel(sessionID,id)`；preload 同名通道。

- [ ] **Step 1: Write failing aggregation tests**

```ts
test('dedupes task-owned shell and subagent rows by stable ids', () => {
  const jobs = mergeBackgroundJobs('ses_parent', {
    tasks: [
      task({ id: 'task_1', kind: 'shell', shellID: 'sh_1', status: 'working' }),
      task({ id: 'task_2', kind: 'subagent', childSessionID: 'ses_child', status: 'completed' }),
    ],
    runtimeShells: [shell({ id: 'sh_1', command: 'sleep 1' }), shell({ id: 'sh_2', command: 'pwd' })],
    subagents: [session({ id: 'ses_child', title: 'child' }), session({ id: 'ses_loose', title: 'loose' })],
  });
  expect(jobs.map((j) => j.id).sort()).toEqual(['sh_2', 'ses_loose', 'task_1', 'task_2']);
  expect(jobs.find((j) => j.id === 'task_1')?.source).toBe('mafw-task');
});

test('maps shell synthetic lifecycle to canonical background.job.updated', () => {
  const out = translateOpencode21Event({
    type: 'session.next.synthetic',
    data: { sessionID: 'ses_1', metadata: { source: 'shell', shellID: 'sh_1', status: 'completed', exitCode: 0 } },
  });
  expect(out?.payload.type).toBe('background.job.updated');
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd gateway; npx jest --runInBand tests/unit/background/background-jobs.test.ts`
Expected: FAIL（模块不存在）。

- [ ] **Step 3: Implement pure merger, route service, event translation**

状态映射：`working/input_required → running`、`completed → completed`、`failed → failed`、`cancelled → cancelled`；runtime shell 的 timeout/killed 分别映射 `failed`/`cancelled`。同一 `task_1` 优先 source `mafw-task`，保留 `runtimeShellID`/`childSessionID`。`session.background` 保持独立 action；`background.jobs` 始终 supported（MAFW tasks 是本地能力），semantics 声明可用来源与 verbs。

route 接线统一经 RuntimeAccess 的 `session.shell` 与 TaskService；不直接暴露 runtime shell DTO。更新 SDK/preload 与 event vocabulary，双向词汇测试必须同步。

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd gateway; npx jest --runInBand tests/unit/background tests/unit/runtime/vocabulary-sync.test.ts`
Expected: PASS。

Run: `npm test -w @mafw/sdk`
Expected: PASS。

- [ ] **Step 5: Commit**

```bash
git add gateway/src/core/background gateway/src/routes/background-jobs.ts gateway/src/experience gateway/src/runtime gateway/src/routes/route-catalog.ts gateway/src/index.ts gateway/tests/unit/background packages/gateway-sdk/src packages/desktop/src/preload
git commit -m "feat(background): unify runtime, task and subagent jobs"
```

---

### Task 4: 中性 terminal PTY 契约与 gateway WebSocket

**Files:**
- Create: `gateway/src/runtime/pty.ts`
- Create: `gateway/src/terminal/terminal-protocol.ts`
- Create: `gateway/src/terminal/terminal-service.ts`
- Create: `gateway/src/routes/terminal.ts`
- Create: `gateway/tests/unit/terminal/terminal-protocol.test.ts`
- Create: `gateway/tests/unit/terminal/terminal-service.test.ts`
- Modify: `gateway/src/runtime/contract.ts`
- Modify: `gateway/src/runtime/contract-surfaces-core.ts`
- Modify: `gateway/src/runtime/contract-manifest.ts`
- Modify: `gateway/src/runtime/opencode-adapter.ts`
- Modify: `gateway/src/runtime/runtime-facade.ts`
- Modify: `gateway/src/index.ts`
- Modify: `gateway/src/routes/route-catalog.ts`
- Modify: `packages/gateway-sdk/src/client.ts`
- Modify: `packages/gateway-sdk/src/types.ts`
- Modify: `packages/desktop/src/preload/mafw-types.ts`
- Modify: `packages/desktop/src/preload/mafw-api.ts`

**Interfaces:**
- Produces: `RuntimePtyChannel`：`create(opts): Promise<{id:string}>`、`connect(opts): Promise<{url:string; headers?:Record<string,string>}>`、`resize(opts): Promise<void>`、`remove(opts): Promise<void>`
- Produces: `MAFW_TERMINAL_PROTOCOL = 'mafw-terminal/1'`
- Produces MAFW 帧：`{v:1,type:'input',data:string}`、`{v:1,type:'resize',cols:number,rows:number}`、`{v:1,type:'output',data:string}`、`{v:1,type:'meta',event:string,payload?:unknown}`、`{v:1,type:'close',code:number,reason?:string}`
- Produces REST：`POST/GET /api/terminal/sessions`、`DELETE /api/terminal/sessions/:id`、`POST /api/terminal/sessions/:id/connect-ticket`；WS：`/api/terminal/sessions/:id/connect?ticket=`
- Produces Experience `terminal.attach`，semantics `{persistent:true, protocol:'mafw-terminal/1'}`

- [ ] **Step 1: Write failing protocol and service tests**

```ts
test('encodes and decodes MAFW terminal frames', () => {
  const encoded = encodeTerminalFrame({ v: 1, type: 'input', data: 'ls\r' });
  expect(decodeTerminalFrame(encoded)).toEqual({ v: 1, type: 'input', data: 'ls\r' });
});

test('maps runtime native meta frames behind the adapter boundary', async () => {
  const service = createTerminalService({ runtime: fakePtyRuntime() });
  const { id } = await service.create({ directory, cwd: directory, cols: 120, rows: 30 });
  const conn = await service.connect(id, directory);
  expect(conn.protocol).toBe('mafw-terminal/1');
  expect(JSON.stringify(conn)).not.toMatch(/opencode|ticket/i);
});
```

增加 gate 测试：runtime 无 `pty` 时 create 返回中性 503，`terminal.attach.supported=false`。

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd gateway; npx jest --runInBand tests/unit/terminal`
Expected: FAIL（模块不存在）。

- [ ] **Step 3: Implement adapter-owned PTY and gateway translation**

opencode adapter 实现 `pty` channel（原生 `/api/pty`、connect-token 与 WS 只存在于 adapter）；gateway WS 只向 desktop 发送 MAFW 帧，并把 input/resize/close 翻译回原生帧。ticket 由 gateway 随机生成、短 TTL、绑定 ptyId+directory，HTTP 与 WS 必须 loopback + ticket 校验。

`index.ts` 的 `upgrade` 路由必须在既有 `/api/ws`/voice 之外增加 `/api/terminal/sessions/.../connect`，不得继续让 desktop 直连 runtime。

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd gateway; npx jest --runInBand tests/unit/terminal tests/unit/runtime/runtime-access-surface-ids.test.ts`
Expected: PASS。

Run: `cd gateway; npx tsc --noEmit -p tsconfig.json`
Expected: rc=0。

- [ ] **Step 5: Commit**

```bash
git add gateway/src/runtime/pty.ts gateway/src/runtime/contract.ts gateway/src/runtime/contract-surfaces-core.ts gateway/src/runtime/contract-manifest.ts gateway/src/runtime/opencode-adapter.ts gateway/src/runtime/runtime-facade.ts gateway/src/terminal gateway/src/routes/terminal.ts gateway/src/routes/route-catalog.ts gateway/src/index.ts gateway/tests/unit/terminal packages/gateway-sdk/src packages/desktop/src/preload
git commit -m "feat(terminal): add neutral PTY protocol and gateway bridge"
```

---

### Task 5: Gateway route surface 门禁与 worktree 归属

**Files:**
- Create: `gateway/src/core/worktree/worktree-availability.ts`
- Create: `gateway/tests/unit/worktree/worktree-availability.test.ts`
- Create: `gateway/tests/unit/runtime/runtime-route-gates.test.ts`
- Modify: `gateway/src/routes/session-diff.ts`
- Modify: `gateway/src/routes/session-summarize.ts`
- Modify: `gateway/src/routes/session-mutations.ts`
- Modify: `gateway/src/routes/session-switch.ts`
- Modify: `gateway/src/routes/restart-agent.ts`
- Modify: `gateway/src/routes/permission.ts`
- Modify: `gateway/src/routes/skill-content.ts`
- Modify: `gateway/src/routes/session-worktree.ts`
- Modify: `gateway/src/routes/wave1-handlers.ts`
- Modify: `gateway/src/index.ts`
- Modify: `gateway/tests/unit/runtime/architecture-boundaries.test.ts`

**Interfaces:**
- Produces `resolveWorktreeAvailability(input: { directory: string; directorySupported: boolean; gitAvailable: boolean }): { supported: boolean; reason?: 'unsupported' | 'missing-data' }`
- 所有 gated route 调用 `RuntimeAccess.can(surfaceId)`；缺能力返回中性 `503 {error:'runtime does not support <surface>'}`，错误中不得出现 runtime 名。

- [ ] **Step 1: Write failing gate tests**

```ts
test('session diff uses the branch.diff surface, not capabilities.diffApi', async () => {
  const res = await invoke(handleSessionDiff, rtWith({ 'branch.diff': false }));
  expect(res.status).toBe(503);
  expect(res.body.error).toBe('runtime does not support branch.diff');
});

test('permission reply is gated on both entry routes', async () => {
  expect(await invokeLegacyPermissionReply(rtWithout('approval.permissionReply'))).toMatchObject({ status: 503 });
});

test('worktree availability comes from git + directory contract', () => {
  expect(resolveWorktreeAvailability({ directory: repo, directorySupported: true, gitAvailable: true })).toEqual({ supported: true });
  expect(resolveWorktreeAvailability({ directory: '/tmp', directorySupported: true, gitAvailable: false })).toEqual({ supported: false, reason: 'missing-data' });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd gateway; npx jest --runInBand tests/unit/runtime/runtime-route-gates.test.ts tests/unit/worktree`
Expected: FAIL（当前裸 capabilities/无 worktree 门）。

- [ ] **Step 3: Replace raw capabilities with RuntimeAccess and add worktree gate**

`wave1-handlers` 统一注入 `getAccess`，删除 `getCapabilities` 与 raw client 传递。`session-mutations` 用 `session.delete`/`session.update` surface；`session-switch` 用 `session.switchAgent`/`session.switchModel`；`restart-agent` 用 `process.restart`；`skill-content` 用 `discovery.loadSkill`。

`POST /api/session` 的 worktree 分支调用 `resolveWorktreeAvailability`，仅当 supported 才创建；产品上不再按 `worktreeApi` 拒绝 pi/claude。

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd gateway; npx jest --runInBand tests/unit/runtime/runtime-route-gates.test.ts tests/unit/worktree`
Expected: PASS。

- [ ] **Step 5: Commit**

```bash
git add gateway/src/routes gateway/src/core/worktree gateway/src/index.ts gateway/tests/unit/runtime/runtime-route-gates.test.ts gateway/tests/unit/worktree gateway/tests/unit/runtime/architecture-boundaries.test.ts
git commit -m "fix(runtime): gate routes through runtime access"
```

---

### Task 6: Gateway core 能力门与 runtime 私有知识清理

**Files:**
- Create: `gateway/src/runtime/runtime-diagnostics.ts`
- Create: `gateway/tests/unit/runtime/core-runtime-neutrality.test.ts`
- Modify: `gateway/src/core/discovery/discovery-service.ts`
- Modify: `gateway/src/core/instructions/instruction-sync-service.ts`
- Modify: `gateway/src/media/media-runtime-executor.ts`
- Modify: `gateway/src/core/approval/policy-service.ts`
- Modify: `gateway/src/core/manager/manager-session-runtime.ts`
- Modify: `gateway/src/core/diff/turn-diff.ts`
- Modify: `gateway/src/runtime/opencode-adapter.ts`
- Modify: `gateway/src/index.ts`
- Modify: `gateway/src/runtime/contract.ts`
- Modify: `gateway/src/runtime/contract-surfaces-core.ts`

**Interfaces:**
- Produces `RuntimeDiagnosticsView { name: string; capabilities: RuntimeCapabilities; activeDialect?: string }`
- Produces surface `media.session`（optional channel `mediaSession`），替代 `index.ts` 的 `runtime.name === 'pi'`。
- Produces `resolveManagerRuntime(slot: { runtime?: string; id?: string }): string | null`：仅返回显式 `slot.runtime`，不得从 id 前缀猜。
- Produces `canDiscovery(access): boolean`、`canInstructionSync(access): boolean`、`canMediaSession(access): boolean`，分别由 discovery/instructions/media 模块导出。
- `turn-diff` 只接受 adapter 提供的 `session.snapshotTree` 原语；gateway 不再包含 `~/.local/share/opencode` 路径。

- [ ] **Step 1: Write failing neutrality tests**

```ts
test('discovery/instructions/media use RuntimeAccess surfaces', () => {
  const access = fakeAccess({ 'discovery.list': false, 'discovery.loadSkill': false, 'session.instructions.write': false, 'media.session': false });
  expect(canDiscovery(access)).toBe(false);
  expect(canInstructionSync(access)).toBe(false);
  expect(canMediaSession(access)).toBe(false);
});

test('turn diff does not know runtime private storage paths', () => {
  const src = fs.readFileSync('src/core/diff/turn-diff.ts', 'utf-8');
  expect(src).not.toMatch(/\.local\/share\/opencode|opencode\/snapshot/);
});

test('manager session ownership is explicit, not id-prefix inference', () => {
  expect(resolveManagerRuntime({ id: 'pi_123' })).toBeNull();
  expect(resolveManagerRuntime({ id: 'pi_123', runtime: 'pi' })).toBe('pi');
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd gateway; npx jest --runInBand tests/unit/runtime/core-runtime-neutrality.test.ts`
Expected: FAIL。

- [ ] **Step 3: Implement neutral channels and remove private knowledge**

`discovery` / `instructions` / media 从 deps 接收 `getAccess`；`policy-service` 删除 runtimeName 参数。`manager-session-runtime` 读取持久槽位中的显式 runtime 字段，无字段时返回 unknown，不按前缀猜。快照树读取下沉到 adapter 的 `session.snapshotTree` surface；opencode 适配器保留原生路径知识。`index.ts` 用 `access.can('media.session')` 选择 MediaRuntimeExecutor。

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd gateway; npx jest --runInBand tests/unit/runtime/core-runtime-neutrality.test.ts`
Expected: PASS。

Run: `cd gateway; npx tsc --noEmit -p tsconfig.json`
Expected: rc=0。

- [ ] **Step 5: Commit**

```bash
git add gateway/src/core gateway/src/media gateway/src/runtime gateway/src/index.ts gateway/tests/unit/runtime/core-runtime-neutrality.test.ts
git commit -m "refactor(runtime): remove private knowledge from core"
```

---

### Task 7: RuntimeFacade 业务面收窄与扫描器硬化

**Files:**
- Modify: `gateway/src/runtime/runtime-facade.ts`
- Modify: `gateway/tests/unit/runtime/runtime-facade.test.ts`
- Modify: `gateway/src/index.ts`
- Modify: `gateway/tests/unit/runtime/architecture-boundaries.test.ts`
- Create: `gateway/tests/fixtures/runtime-boundary-fixtures/business-leak.ts.txt`
- Modify: `gateway/tests/unit/runtime/dependency-boundary.test.ts`

**Interfaces:**
- 业务可见 `RuntimeFacade` 删除 `name`、`capabilities`、`config`、`completion`、`credentials`、`agentProcess`、`getBaseUrl`、`healthCheck`、`activeDialect`。
- 组合根持有 `runtimeDiagnostics`；RuntimeAccess 通过内部 raw 持有能力，不经 facade 读取。
- scanner 使用正则覆盖 `?.`、cast、getter、`capabilities.<x>`、`runtimeName === '...'`、`~/.local/share/opencode`。

- [ ] **Step 1: Write failing facade and scanner tests**

```ts
test('business facade does not expose diagnostics fields', () => {
  const fake = fakeRuntime({ name: 'opencode', capabilities: { diffApi: true } });
  const facade = await createRuntimeFacade(fake, opts);
  expect((facade as any).name).toBeUndefined();
  expect((facade as any).capabilities).toBeUndefined();
});

test('scanner catches optional-chain and cast capabilities', () => {
  const leaks = scanSource('const x = rt?.capabilities?.diffApi; const y = (rt as any).name === "pi";');
  expect(leaks.map((l) => l.rule)).toEqual(['runtime-name', 'raw-capability']);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd gateway; npx jest --runInBand tests/unit/runtime/runtime-facade.test.ts tests/unit/runtime/architecture-boundaries.test.ts`
Expected: FAIL（facade 仍暴露 name/capabilities；fixture 不被抓）。

- [ ] **Step 3: Narrow facade and enforce allowlists**

组合根在创建 facade 前保存 diagnostics；业务模块只接 facade/access。scanner 扫 `src/routes`、`src/core`、`src/media`、`src/trajectory` 及 `index.ts` 中抽出的业务模块；composition root / diagnostics 使用精确文件和符号白名单，禁止整文件目录豁免。

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd gateway; npx jest --runInBand tests/unit/runtime`
Expected: PASS。

Run: `cd gateway; npx tsc --noEmit -p tsconfig.json`
Expected: rc=0。

- [ ] **Step 5: Commit**

```bash
git add gateway/src/runtime/runtime-facade.ts gateway/src/index.ts gateway/tests/unit/runtime gateway/tests/fixtures/runtime-boundary-fixtures
git commit -m "refactor(runtime): narrow facade and harden boundary scans"
```

---

### Task 8: Flat history 可选出口与 data-part/enrich 支持

**Files:**
- Create: `gateway/src/core/data-parts/merge-flat.ts`
- Create: `gateway/src/routes/session-history-flat.ts`
- Create: `gateway/tests/unit/routes/session-history-flat.test.ts`
- Create: `gateway/tests/unit/data-parts/merge-flat.test.ts`
- Modify: `gateway/src/runtime/tool-classes.ts`
- Modify: `gateway/src/index.ts`
- Modify: `gateway/src/routes/route-catalog.ts`
- Modify: `packages/gateway-sdk/src/client.ts`
- Modify: `packages/gateway-sdk/src/types.ts`
- Modify: `packages/gateway-sdk/src/client.test.ts`
- Modify: `packages/gateway-sdk/contract/overrides.json`

**Interfaces:**
- `GET /api/sessions/:id/messages?format=flat` 返回 `{ data: MafwMessage[]; nextCursor?: string }`。
- `mergeDataPartsIntoFlat(messages: MafwMessage[], rows: DataPartRow[]): MafwMessage[]`。
- SDK `session.messages(opts & { format?: 'flat' })`；`session.history(opts)` 固定 flat。
- `enrichHistoryParts` 同时接受 `content` 与旧 `parts`（Task 15 删除旧分支）。

- [ ] **Step 1: Write failing flat history tests**

```ts
test('flat history preserves tool identity and merges data parts', async () => {
  const body = await get('/api/sessions/ses_1/messages?format=flat');
  expect(body.data[1]).toMatchObject({
    role: 'assistant',
    content: [
      { id: 'part_tool', type: 'tool', tool: 'shell', toolClass: 'shell', canonicalTool: 'bash' },
      { id: 'data_card', type: 'data-card', data: { ok: true } },
    ],
  });
  expect((body.data[1] as any).info).toBeUndefined();
  expect((body.data[1] as any).parts).toBeUndefined();
});

test('SDK history calls format=flat', async () => {
  await client.session.history({ sessionID: 'ses_1' });
  expect(fetchMock.mock.calls[0][0]).toContain('/api/sessions/ses_1/messages?format=flat');
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd gateway; npx jest --runInBand tests/unit/routes/session-history-flat.test.ts tests/unit/data-parts/merge-flat.test.ts`
Expected: FAIL。

- [ ] **Step 3: Implement flat route path without changing the default yet**

`format=flat` 为迁移期显式选项；默认仍输出 wire 直到 Task 15。flat 路径不得调用 `toWireHistory`。Data-part overlay、tool enrich、nextCursor 与 wire 路径保持同等语义。更新 overrides 的 `session.messages` responseSchema 为 union 或 flat 目标 schema。

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd gateway; npx jest --runInBand tests/unit/routes/session-history-flat.test.ts tests/unit/data-parts`
Expected: PASS。

Run: `npm test -w @mafw/sdk`
Expected: PASS。

- [ ] **Step 5: Commit**

```bash
git add gateway/src/core/data-parts gateway/src/routes/session-history-flat.ts gateway/src/runtime/tool-classes.ts gateway/src/index.ts gateway/src/routes/route-catalog.ts gateway/tests/unit/routes/session-history-flat.test.ts gateway/tests/unit/data-parts packages/gateway-sdk/src packages/gateway-sdk/contract/overrides.json
git commit -m "feat(history): add canonical flat history path"
```

---

### Task 9: session-ui 全量类型中立化

**Files:**
- Modify: `packages/session-ui/package.json`
- Modify: `packages/session-ui/src/context/data.tsx`
- Modify: `packages/session-ui/src/components/message-part.tsx`
- Modify: `packages/session-ui/src/components/session-turn.tsx`
- Modify: `packages/session-ui/src/components/message-nav.tsx`
- Modify: `packages/session-ui/src/components/session-diff.ts`
- Modify: `packages/session-ui/src/components/session-review.tsx`
- Modify: `packages/session-ui/src/components/message-file.ts`
- Modify: `packages/session-ui/src/components/session-retry.tsx`
- Modify: `packages/session-ui/src/pierre/media.ts`
- Modify: `packages/session-ui/src/v2/components/session-review-file-preview-v2.tsx`
- Modify: `packages/session-ui/src/components/timeline-playground.stories.tsx`
- Modify: corresponding `*.test.ts`
- Create: `packages/session-ui/src/components/view-dto.test.ts`

**Interfaces:**
- Consumes Task 1 `@mafw/sdk` re-export of `MafwMessage/MafwPart/MafwDiff/MafwSessionStatus/Mafw...`.
- 保持导出：`ToolRegistry`、`ToolProps`、`ToolComponent`、`SessionTurn`、`DataProvider`、`useData`、`readPartText`、`registerPartComponent`。

- [ ] **Step 1: Write the failing neutrality test**

```ts
test('session-ui has no runtime SDK dependency or old wire fields', () => {
  const files = walk('src');
  expect(files.flatMap((f) => grep(f, /@opencode-ai\/sdk/))).toEqual([]);
  expect(files.flatMap((f) => grep(f, /item\.info|\binfo\?\.|\.parts\s*\?\?/))).toEqual([]);
});

test('tool part reads canonical identity fields', () => {
  const part: MafwPart = toolPart({ id: 'p1', tool: 'shell', toolClass: 'shell', canonicalTool: 'bash' });
  expect(renderToolTitle(part)).toBe('bash');
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -w @mafw/session-ui`
Expected: FAIL（new test 命中 SDK import/旧字段）。

- [ ] **Step 3: Migrate types and normalize shape at ingestion**

13 个文件切到 View DTO；两处值 import 改为 explicit `import type`，最终直接删除 SDK dependency。`file-diff-shape`、`tool-output`、`task-session` 保留为 desktop 摄取层使用的纯归一函数，session-ui 渲染组件只读规范形。补齐旧 DTO 缺失字段的读取：`model`、`summary`、`stopReason`、`error.message`、`part.time`、`part.synthetic`。

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -w @mafw/session-ui`
Expected: PASS。

Run: `cd packages/session-ui; npx tsgo --noEmit`
Expected: rc=0。

- [ ] **Step 5: Commit**

```bash
git add packages/session-ui
git commit -m "refactor(session-ui): consume MAFW view DTO"
```

---

### Task 10: Desktop Experience 中枢与 chat/checkpoint 迁移

**Files:**
- Modify: `packages/desktop/src/renderer/mafw/experience-store.ts`
- Modify: `packages/desktop/src/renderer/mafw/experience-store.test.ts`
- Modify: `packages/desktop/src/renderer/mafw/MafwShell.tsx`
- Modify: `packages/desktop/src/renderer/mafw/components/ChatPane.tsx`
- Modify: `packages/desktop/src/renderer/mafw/components/CheckpointOverlay.tsx`
- Modify: `packages/desktop/src/renderer/mafw/components/checkpoint-revert.ts`
- Modify: `packages/desktop/src/renderer/mafw/components/server-checkpoints.ts`
- Modify: `packages/desktop/src/renderer/mafw/components/experience-copy.ts`
- Delete: `packages/desktop/src/renderer/mafw/components/branch-actions.ts`
- Delete: `packages/desktop/src/renderer/mafw/components/branch-actions.test.ts`
- Modify: `packages/desktop/src/renderer/mafw/session-turn-diffs.ts`
- Modify: `packages/desktop/src/renderer/mafw/components/turn-diffs.ts`
- Modify: `packages/desktop/src/renderer/mafw/pages/Config.tsx`
- Modify: corresponding tests
- Modify: `packages/desktop/src/renderer/mafw/experience-boundaries.test.ts`

**Interfaces:**
- `experienceStore` 增加 `status(): 'idle'|'loading'|'ready'|'unavailable'|'incompatible'|'error'`、`supported(id): boolean`、`enabled(id): boolean`、`semantics(id)`、`whenReady(timeoutMs=3000)`。
- `MafwShell` 不再向 `ChatPane` 传 `runtimeName/runtimeCaps`。
- `MafwShell.loadSessionHistory/loadOlder` 与 `ChatPane` 历史摄取改用 SDK `session.history`，直接消费 flat `MafwMessage[]`；本任务删除 `item.info || item` / `item.parts ??` 读取。
- `session-turn-diffs` key 改为 `${sessionID}|${candidates}`，不含 runtime 名。

- [ ] **Step 1: Write failing store and component tests**

```ts
test('loading is not unsupported and old responses cannot overwrite new runtime', async () => {
  store.begin(1);
  expect(store.supported('branch.fork')).toBe(false);
  expect(store.status()).toBe('loading');
  store.resolve(2, { experienceVersion, actions: { 'branch.fork': supportedAction() } });
  expect(store.supported('branch.fork')).toBe(false);
});

test('busy checkpoint remains server-backed', () => {
  const action = { supported: true, enabled: false, reason: 'busy', semantics: { sessionBacked: true } };
  expect(serverMode({ checkpointAction: action, serverCheckpoints: [] })).toBe(true);
});

test('experience boundary scan rejects runtimeCaps and runtimeName', () => {
  expect(scan('const x = props.runtimeCaps.diffApi;')).toContain('runtime-caps');
  expect(scan('if (runtimeName === "pi") {}')).toContain('runtime-name');
});

test('desktop history ingestion accepts flat messages only', async () => {
  const view = await loadHistoryView(fakeSdk([flatMessage()]));
  expect(view.messages[0].content[0].id).toBe('part_1');
  expect((view.messages[0] as any).info).toBeUndefined();
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm run test:desktop -- --test-name-pattern="experience|checkpoint|turn-diff"`
Expected: FAIL。

- [ ] **Step 3: Replace caps branches with Experience actions**

拆除 MafwShell `rtCaps/rtName`；worktree、fork、revert、diff、run、checkpoint 全部读 actions。ChatPane 删除两个 props 及 6 处 caps 分支；`revertWarning` 只消费 descriptor semantics。CheckpointOverlay 用 `supported/sessionBacked` 判定服务端模式，busy 时保持服务端只读。删除无 actions 时的前端业务推导和 `branch-actions.ts`。

ChatPane 命令列表与 Config 技能页从 legacy `command`/`skill` namespace 改走 `discovery` DTO；Task 15 才能删除旧 SDK namespace。Config 自己拉 Diagnostics；不得把 `runtimeCaps` 作为 prop 传给 ChatPane。

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm run test:desktop -- --test-name-pattern="experience|checkpoint|turn-diff|boundary"`
Expected: PASS。

Run: `cd packages/desktop; npx tsgo --noEmit -p tsconfig.json`
Expected: rc=0。

- [ ] **Step 5: Commit**

```bash
git add packages/desktop/src/renderer/mafw
git commit -m "refactor(desktop): drive chat and checkpoints from experience"
```

---

### Task 11: Desktop background 与 terminal 迁到中性面

**Files:**
- Modify: `packages/desktop/src/main/terminal/local-terminal.ts`
- Modify: `packages/desktop/src/main/terminal/local-terminal.test.ts`
- Modify: `packages/desktop/src/main/terminal/terminal-service.ts`
- Modify: `packages/desktop/src/main/terminal/terminal-ipc.ts`
- Modify: `packages/desktop/src/renderer/mafw/components/TerminalSurface.tsx`
- Modify: `packages/desktop/src/renderer/mafw/components/TerminalView.tsx`
- Modify: `packages/desktop/src/renderer/mafw/background-capability.ts`
- Modify: `packages/desktop/src/renderer/mafw/background-reconcile.ts`
- Modify: `packages/desktop/src/renderer/mafw/components/BackgroundDock.tsx`
- Modify: `packages/desktop/src/renderer/mafw/components/BackgroundWorkBar.tsx`
- Modify: `packages/desktop/src/renderer/mafw/MafwShell.tsx`
- Modify: `packages/desktop/src/renderer/mafw/sse/handlers/background.ts`
- Modify: corresponding tests
- Modify: `packages/desktop/src/preload/mafw-api.ts`
- Modify: `packages/desktop/src/preload/mafw-types.ts`

**Interfaces:**
- Consumes Task 3 `background.jobs.*` 与 Task 4 terminal REST/WS.
- desktop terminal 只使用 `MAFW_TERMINAL_PROTOCOL='mafw-terminal/1'` 帧；无 `persist:...` 原生协议知识。
- desktop background 只消费 `MafwBackgroundJob` + `background.job.updated`。

- [ ] **Step 1: Write failing client tests**

```ts
test('local terminal uses MAFW terminal endpoints and frames only', async () => {
  await ops.probe();
  await ops.attach(dir, 'ses_1', sub, key);
  const urls = fetchMock.mock.calls.map((c) => String(c[0]));
  expect(urls.every((u) => !/\/api\/pty|\/api\/info/.test(u))).toBe(true);
  expect(wsUrls[0]).toContain('/api/terminal/sessions/');
  expect(JSON.stringify(calls)).not.toMatch(/x-opencode-ticket|persistentPty/);
});

test('background updates consume canonical jobs and dedupe', () => {
  const jobs = applyBackgroundJobEvent([], job({ id: 'task_1', source: 'mafw-task', status: 'running' }));
  const next = applyBackgroundJobEvent(jobs, job({ id: 'task_1', source: 'mafw-task', status: 'completed' }));
  expect(next).toHaveLength(1);
  expect(next[0].status).toBe('completed');
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm run test:desktop -- --test-name-pattern="terminal|background"`
Expected: FAIL。

- [ ] **Step 3: Rewrite desktop adapters onto neutral gateway APIs**

`local-terminal` 删除 `info/tokenFor/createPty` 原生代码，改为 probe Experience `terminal.attach`、CRUD `/api/terminal/sessions`、MAFW frame codec。BackgroundDock/WorkBar/reconcile 改走 `background.jobs.list/output/cancel` 和 canonical event；`session.background` action 保持独立。preload 删除 shells 暴露，增加 background/terminal 方法。

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm run test:desktop -- --test-name-pattern="terminal|background"`
Expected: PASS。

Run: `cd packages/desktop; npx tsgo --noEmit -p tsconfig.json`
Expected: rc=0。

- [ ] **Step 5: Commit**

```bash
git add packages/desktop/src/main/terminal packages/desktop/src/renderer/mafw packages/desktop/src/preload
git commit -m "refactor(desktop): use neutral terminal and background APIs"
```

---

### Task 12: TUI Experience store、flat history 与中性 DTO

**Files:**
- Create: `packages/tui/src/store/experience-store.ts`
- Create: `packages/tui/tests/experience-store.test.ts`
- Create: `packages/tui/tests/experience-actions.test.ts`
- Create: `packages/tui/tests/permission-dto.test.ts`
- Modify: `packages/tui/src/store/chat-store.ts`
- Modify: `packages/tui/src/store/connection.ts`
- Modify: `packages/tui/src/ui/app.ts`
- Modify: `packages/tui/src/ui/overlays.ts`
- Modify: `packages/tui/src/ui/agent-items.ts`
- Modify: `packages/tui/src/ui/goals-tab.ts`
- Modify: `packages/tui/tests/chat-store.test.ts`
- Modify: `packages/tui/tests/goals-tab.test.ts`
- Modify: `packages/tui/tests/agent-items.test.ts`
- Modify: `packages/tui/tests/slash-commands.test.ts`

**Interfaces:**
- `TuiExperienceStore`：`load(sessionID)`、`status`、`action(id)`、`supported(id)`、`invalidate()`。
- TUI `SessionApi.messages` 使用 flat `MafwMessage[]`；删除 `HistoryItem`。
- `permissionSummary` 接受 `MafwPermissionRequest`，不读 `patterns`。

- [ ] **Step 1: Write failing TUI tests**

```ts
test('TUI history reads content only and tool fallback uses canonical fields', async () => {
  const store = new ChatStore(fakeSession([flatMessage()]));
  await store.load('ses_1');
  expect(store.turns()[0].parts[0]).toMatchObject({ type: 'tool', tool: 'bash' });
});

test('fork/compact/undo are gated by experience actions', async () => {
  const store = new TuiExperienceStore(fakeClient({ 'branch.fork': { supported: false, enabled: false, reason: 'unsupported' } }));
  expect(await runCommand('/fork', store, client)).toMatch(/不支持|不可用/);
  expect(client.session.fork).not.toHaveBeenCalled();
});

test('pi permission shape does not crash', () => {
  expect(permissionSummary({ requestId: 'r', toolName: 'shell', args: {}, risk: 'low' })).toMatch(/shell/);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -w @mafw/tui`
Expected: FAIL。

- [ ] **Step 3: Implement TUI flat + Experience**

删除 `{info,parts}` 双形状；`/fork`、`/compact`、`/undo`、`/redo`、agent/model/permission 用 action。provider models 一律数组；agent 用 `MafwAgent`。只订阅有消费者的 canonical 事件，`background.job.updated` 可更新后台状态。busy prompt 使用 Experience steer/queue 语义。

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -w @mafw/tui`
Expected: PASS。

Run: `npm run typecheck -w @mafw/tui`
Expected: rc=0。

- [ ] **Step 5: Commit**

```bash
git add packages/tui
git commit -m "refactor(tui): consume experience and flat view DTO"
```

---

### Task 13: Mobile flat DTO、canonical SSE 与 CI

**Files:**
- Modify: `mobile/lib/src/models/mafw_models.dart`
- Modify: `mobile/lib/src/network/gateway_client.dart`
- Modify: `mobile/lib/src/pages/chat_page.dart`
- Modify: `mobile/lib/src/services/push_service.dart`
- Modify: `mobile/test/*.dart`
- Create: `mobile/test/view_dto_test.dart`
- Create: `mobile/test/event_envelope_test.dart`
- Modify: `.github/workflows/ci.yml`
- Modify: `mobile/README.md`

**Interfaces:**
- `MafwMessage.fromJson` 直接接收 flat `{id,sessionID,role,content,...}`；`MafwPart.fromJson` 读 `toolClass/canonicalTool/state`。
- `MafwEvent` 只解 `mafw_event` 信封及 canonical 内层类型；删除 `opencode_event` 兼容。
- 迁移期 `GatewayClient.messages` 显式请求 `format=flat`（Task 15 翻转默认后删除该参数）。
- CI 增加 Flutter job：`flutter pub get && flutter analyze && flutter test`，只在 mobile/contract 相关变更路径触发（可保留手动 dispatch）。

- [ ] **Step 1: Write failing Dart tests**

```dart
test('flat history parses content parts without info envelope', () {
  final msg = MafwMessage.fromJson({
    'id': 'm1', 'sessionID': 's1', 'role': 'assistant',
    'content': [{'id': 'p1', 'type': 'tool', 'tool': 'shell', 'state': {'status': 'completed'}}],
  }, sessionID: 's1');
  expect(msg.text, isNull);
  expect(msg.parts.single.tool, 'shell');
});

test('canonical envelope exposes background job update', () {
  final ev = MafwEvent.fromJson({
    'type': 'mafw_event',
    'data': {'type': 'background.job.updated', 'properties': {'job': {'id': 'task_1'}}},
  });
  expect(ev.innerType, 'background.job.updated');
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd mobile; flutter test test/view_dto_test.dart test/event_envelope_test.dart`
Expected: FAIL（当前只读 info/opencode_event）。

- [ ] **Step 3: Implement flat/canonical mobile migration and CI**

删除 info 信封与旧事件分支；历史解析 `content`，消息文本可继续从 text part 派生。SSE/push 只接受 `mafw_event`，`message.updated` 读 `properties.message`；事件处理不引入 runtime 名称。更新 README 的 breaking 说明。CI 不要求构建 AAB。

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd mobile; flutter analyze`
Expected: rc=0。

Run: `cd mobile; flutter test`
Expected: PASS。

- [ ] **Step 5: Commit**

```bash
git add mobile .github/workflows/ci.yml
git commit -m "refactor(mobile): migrate to flat view DTO and canonical events"
```

---

### Task 14: SSE egress 翻转与 event_log 旧帧迁移

**Files:**
- Create: `gateway/src/events/event-log-migrate.ts`
- Create: `gateway/tests/unit/events/event-log-migrate.test.ts`
- Modify: `gateway/src/runtime/event-broadcast.ts`
- Modify: `gateway/tests/unit/runtime/event-broadcast.test.ts`
- Modify: `gateway/src/index.ts`
- Modify: `packages/desktop/src/renderer/mafw/sse/chat-reducers.ts`
- Modify: `packages/desktop/src/renderer/mafw/sse/handlers/chat-stream.ts`
- Modify: `packages/desktop/src/renderer/mafw/sse/handlers/background.ts`
- Modify: `packages/desktop/src/renderer/mafw/sse/handlers/subagents.ts`
- Modify: corresponding tests

**Interfaces:**
- `message.updated` properties 固定 `{ message: MafwMessage }`，不再有 `info`。
- `migrateEventLogInfoToMessage(db): { scanned: number; migrated: number }` 幂等，只改 `message.updated` 且有 `info` 无 `message` 的行。
- gateway 启动顺序：DB migration → API/SSE ready。

- [ ] **Step 1: Write failing event tests**

```ts
test('message.updated never emits properties.info', () => {
  const wire = toEventPayload('message.updated', { sessionID: 's', message: flatMessage() });
  expect(wire.info).toBeUndefined();
  expect(wire.message.id).toBe('msg_1');
});

test('event log migration rewrites legacy info once', () => {
  const first = migrateEventLogInfoToMessage(db);
  expect(first.migrated).toBe(2);
  const second = migrateEventLogInfoToMessage(db);
  expect(second.migrated).toBe(0);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd gateway; npx jest --runInBand tests/unit/events/event-log-migrate.test.ts tests/unit/runtime/event-broadcast.test.ts`
Expected: FAIL。

- [ ] **Step 3: Flip SSE payload and add startup migration**

删除 `toWireEventPayload` 调用；desktop 三个 handler/reducer 统一读 `properties.message`。migration 先备份失败安全、事务内逐行 rewrite；坏 JSON 保留并计入 warning，不阻断启动。TUI 不消费 message.updated，但更新事件 golden。

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd gateway; npx jest --runInBand tests/unit/events tests/unit/runtime/event-broadcast.test.ts`
Expected: PASS。

Run: `npm run test:desktop -- --test-name-pattern="sse|reducer|chat-stream"`
Expected: PASS。

- [ ] **Step 5: Commit**

```bash
git add gateway/src/events gateway/src/runtime/event-broadcast.ts gateway/src/index.ts gateway/tests/unit/events gateway/tests/unit/runtime/event-broadcast.test.ts packages/desktop/src/renderer/mafw/sse
git commit -m "feat(events): emit canonical message payload and migrate replay log"
```

---

### Task 15: Wire 翻转与兼容 shim 删除

**Files:**
- Delete: `gateway/src/runtime/wire-compat.ts`
- Delete: `gateway/tests/unit/runtime/wire-compat.test.ts`
- Modify: `gateway/src/index.ts`
- Modify: `gateway/src/runtime/normalize-messages.ts`
- Modify: `gateway/src/runtime/event-broadcast.ts`
- Modify: `gateway/src/runtime/tool-classes.ts`
- Modify: `gateway/src/routes/route-catalog.ts`
- Modify: `gateway/src/routes/runtime-config-route.ts`
- Modify: `packages/gateway-sdk/src/client.ts`
- Modify: `packages/gateway-sdk/src/types.ts`
- Modify: `packages/gateway-sdk/src/client.test.ts`
- Modify: `packages/gateway-sdk/contract/*`
- Modify: `packages/desktop/src/preload/mafw-api.ts`
- Modify: `packages/desktop/src/preload/mafw-types.ts`
- Modify: `packages/desktop/src/renderer/mafw/MafwShell.tsx`
- Modify: `packages/desktop/src/renderer/mafw/components/ChatPane.tsx`
- Modify: `packages/tui/src/store/chat-store.ts`
- Modify: `mobile/lib/src/network/gateway_client.dart`
- Modify: existing tests/fixtures

**Interfaces:**
- `/api/sessions/:id/messages` 默认且唯一输出 flat `{data: MafwMessage[]}`；删除 `format=flat` 参数。
- SDK `session.messages` 只返回 `{data: MafwMessage[]}`。
- 删除本批迁移面：`session.shells`/`requestRuntime`、`opencodeConfig`、legacy `command/skill`、`/api/opencode-config`、本批取消的 preload 别名。
- `applyNormalizeMessages` / `wrapRuntimeMessages` 等零生产消费者通道删除。

- [ ] **Step 1: Write failing deletion guards**

```ts
test('wire compat and legacy client surfaces are gone', () => {
  expect(fs.existsSync('src/runtime/wire-compat.ts')).toBe(false);
  expect(read('src/index.ts')).not.toMatch(/toWireHistory|properties\.info/);
  expect(read('../../packages/gateway-sdk/src/client.ts')).not.toMatch(/opencodeConfig|requestRuntime|shells\s*=/);
});

test('history default is flat', async () => {
  const res = await get('/api/sessions/ses_1/messages');
  expect(res.data[0].content).toBeDefined();
  expect(res.data[0].info).toBeUndefined();
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd gateway; npx jest --runInBand tests/unit/runtime/history-default-flat.test.ts`
Expected: FAIL（文件仍存在/默认 wire）。

- [ ] **Step 3: Flip default and delete migration shims**

删除 `toWireHistory/toWireInfo/toWireEventPayload` 与所有调用；flat data-part merge、enrich 成为唯一路径。SDK/preload/TUI/mobile 删除旧双形状读取。删除旧 SDK namespace、旧路由及其 catalog 项；重新生成 OpenAPI/contracts。保留 adapter 内部 native 翻译。

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd gateway; npx jest --runInBand tests/unit/runtime tests/unit/routes`
Expected: PASS。

Run: `npm test -w @mafw/sdk; npm test -w @mafw/tui; npm run test:desktop`
Expected: PASS。

- [ ] **Step 5: Commit**

```bash
git add -A gateway/src/runtime gateway/src/routes gateway/src/index.ts gateway/tests packages/gateway-sdk packages/desktop/src packages/tui/src mobile/lib mobile/test
git commit -m "refactor!: remove wire and legacy client compatibility shims"
```

---

### Task 16: 架构守卫、文档与全量验收

**Files:**
- Modify: `gateway/tests/unit/runtime/architecture-boundaries.test.ts`
- Create: `gateway/tests/unit/runtime/route-surface-catalog.test.ts`
- Create: `gateway/tests/unit/runtime/history-exit-golden.test.ts`
- Modify: `packages/desktop/src/renderer/mafw/experience-boundaries.test.ts`
- Create: `packages/tui/tests/experience-boundaries.test.ts`
- Create: `packages/session-ui/src/architecture.test.ts`
- Modify: `.opencode/skills/runtime-plugin-authoring/SKILL.md`
- Modify: `docs/guides/runtime-plugin-authoring.md`
- Modify: `AGENTS.md`
- Modify: `docs/superpowers/specs/2026-11-02-runtime-experience-full-migration-design.md`（仅实现偏差）

**Interfaces:**
- gateway scanner 枚举 composition root 与 Diagnostics 例外；覆盖 routes/core/media/trajectory 与抽出的 index 业务模块。
- route→surface catalog 测试逐条断言 gated route 使用 `getAccess`，缺能力中性 503。
- 历史/SSE golden 覆盖 opencode、pi、claude 三种 canonical 输入。
- 前端 scanner 覆盖 desktop 全域、TUI、session-ui；Config 白名单逐文件。

- [ ] **Step 1: Write failing negative fixtures**

```ts
test('negative fixtures are caught', () => {
  expect(scanGatewayFixture('if (rt.name === "pi") {}')).toContain('runtime-name');
  expect(scanGatewayFixture('(rt as any).capabilities.diffApi')).toContain('raw-capability');
  expect(scanDesktopFixture('const caps = props.runtimeCaps;')).toContain('runtime-caps');
  expect(scanTuiFixture('item.info ?? item')).toContain('wire-shape');
});
```

- [ ] **Step 2: Run tests to verify fixtures fail before cleanup**

Run: `cd gateway; npx jest --runInBand tests/unit/runtime/architecture-boundaries.test.ts tests/unit/runtime/route-surface-catalog.test.ts tests/unit/runtime/history-exit-golden.test.ts`
Expected: fixture 触发的断言先 FAIL，随后生产扫描为 PASS。

- [ ] **Step 3: Add guards, docs, and run full gates**

更新作者指南与 AGENTS 的实际契约；记录删除面、breaking change、`supported/enabled`、background/terminal 协议。运行：

```powershell
cd gateway; npx jest --runInBand --forceExit; npx tsc --noEmit -p tsconfig.json; npm run build
cd ..; npm test -w @mafw/sdk; npm run build -w @mafw/sdk
npm test -w @mafw/session-ui; npm test -w @mafw/tui
npm run test:desktop
cd packages/desktop; npx tsgo --noEmit -p tsconfig.json; npx electron-vite build
cd ../../adapters/claude; npm test; npm run build
cd ../../mobile; flutter analyze; flutter test
```

Expected: 全部 rc=0，无失败；生成物 diff 只含预期文件。

- [ ] **Step 4: Run real smoke**

启动 gateway 与 desktop dev，验证：

- checkpoint/steer/background/MCP 四场景仍工作。
- worktree、fork/revert/unrevert、per-turn diff、run suspend/resume、background 三源、terminal 本地 tab。
- 关闭重开 desktop：flat 历史可恢复；SSE 重连不收到 `properties.info`。
- pi/opencode 切换后 Experience actions 只变化 semantics/supported，不出现 runtime 名分支。
- mobile 连接真实 gateway：历史与 SSE 更新正常。
- 截图与日志归档在交付说明。

- [ ] **Step 5: Commit**

```bash
git add gateway/tests packages/desktop/src/renderer/mafw/experience-boundaries.test.ts packages/tui/tests/experience-boundaries.test.ts packages/session-ui/src/architecture.test.ts .opencode/skills/runtime-plugin-authoring/SKILL.md docs/guides/runtime-plugin-authoring.md AGENTS.md docs/superpowers/specs/2026-11-02-runtime-experience-full-migration-design.md
git commit -m "test: enforce full runtime experience migration"
```

---

## Self-Review

- **Spec coverage:** spec §5 DTO → Task 1/8/9/10/12/13；§6 Experience → Task 2/3/4/10；§7 gateway → Task 3/4/5/6/7/8/14；§8 clients → Task 9/10/11/12/13；§9 shim 删除 → Task 14/15；§10 顺序与 §11 守卫 → Task 15/16；§12 验收 → Task 16。
- **Type consistency:** `MafwMessage/MafwPart/MafwBackgroundJob` 由 Task 1 定义；`ActionDescriptor.supported/enabled` 由 Task 2 定义；Task 3/4/10/11/12 使用同一名称。没有 two-source helper 名称漂移。
- **Review Focus coverage:** 字段完备 Task 1/8/9/14；supported/enabled Task 2/10；background 去重 Task 3/11；terminal 中性 Task 4/11；replay/mobile Task 13/14/15。
- **删除边界:** Task 15 只删本批客户端兼容层；adapter native 翻译保留，符合 spec §9.2。
