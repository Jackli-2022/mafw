# T2-1 检查点自动化 + 三态 Restore 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把「检查点」升格为 gateway 服务端一等实体：自动（turn 完成）+ 手动创建、三态 restore（对话/代码/全部）、untracked 残留报告、桌面时间线消费服务端列表。

**Architecture:** gateway.db 新表 `session_checkpoints` + `CheckpointService`（纯核心 deps 注入）；restore 组合既有原语（opencode revert stage `files` 参数 + snapshot git 树正向补丁 + `vcs.apply`），runtime 不加新动词。desktop overlay 在 `checkpointApi` 能力门内切服务端列表。canonical 事件 `session.checkpoint`（信封形态，`mafwBroadcast`——对齐 `session.config`/`queue.updated` 先例；**不是** flat-emit registry，设计文档 §5.7 该句按本计划修正）。

**Tech Stack:** TypeScript (gateway CJS / jest)、SQLite (better-sqlite3)、simple-git、@mafw/sdk、SolidJS + @mafw/ui/v2。

**Spec:** `docs/superpowers/specs/2026-10-26-t2-checkpoint-automation-design.md`

**已解决的实现期验证点（活体探测 2026-10-26，结论固化）：**
- ① serve 2.1 `/session/{id}/revert/stage` body schema 显式接受 `files: boolean | null`（OpenAPI `#/components/schemas` 实证；描述 "Stage or move a reversible session boundary and optionally apply its file changes"）→ **三态方案成立，无降级**。
- ② `vcs.apply` 是 "Apply a raw patch to the current working tree" 全量补丁端点，无文件类型限制（B3.1 的新增/删除/二进制限制来自客户端 `isInvertiblePatch` 反转算法，非服务端）→ **正向补丁直传成立**。

## Global Constraints

- 版本 `v4.37.0`；push/npm publish 需用户确认，本计划只做本机部署。
- additive only：现有 `revert`/`revertDiff`/`fork` 路由与语义零变化（`files` 缺省 true 向后兼容）。
- fail-open：自动检查点记录失败仅 warn，绝不影响回合本身与事件链。
- 路由正则必须容忍 query string：`(?:\?|$)` 锚定（AGENTS §6.5）。
- 词汇单源：SDK `events.ts` ↔ gateway `mafw-vocabulary.ts` 双侧同步，`vocabulary-sync.test.ts` 钉扎。
- desktop 组件规范：禁裸 `<button>`/`<title>`，用 `@mafw/ui/v2/*`（AGENTS §5.10）。
- 测试命令：gateway `cd gateway && npx jest <path> --runInBand`；全量 `npx jest --runInBand --forceExit`；SDK `cd packages/gateway-sdk && npm test`；TUI `cd packages/tui && npm test`；desktop `cd packages/desktop && npm test`。
- git 操作的路径含空格/引号场景走 `core.quotePath=false`（turn-diff 先例）；snapshot id 必须 40/64-hex 校验（`isSnapshotId`）。
- 工作树未跟踪文件 `docs/superpowers/plans/2026-10-22-workbench-phase2.md` 是并行会话产物，**不得触碰、不得提交**。

## Review Focus

实现者最容易做错、且测试必须钉住的输入类：

1. **immediate-delivery 下 user_{N+1} 已持久化**——auto anchor 若按「最后一条 user 消息」定位会错锚一轮。正确：从消息末尾反向找**最后一条 assistant** A_N，再从 A_N 向前找最近 user。→ Task 4 `planAutoCheckpoint` 测试。
2. **多 step 回合的 pre-turn 树**——tree 是本回合**第一条** assistant 的 `snapshot.start`（`selectTurnSnapshot` 同口径），不是最后一条的。→ Task 4 测试。
3. **files restore 时工作区有回合外手工编辑**——patch 上下文失配。`git apply --check` 预检（`--git-dir <snapRepo> --work-tree <projectDir>`）失败 → 400，不部分应用。→ Task 5 测试。
4. **tree=null 的 checkpoint 请求 files/both**——纯对话回合无文件状态：`files` → 400；`both` → 降级为仅对话截断 + `filesSkipped:true`。→ Task 5 测试。
5. **restore 后死条目**——session/both 截断历史后，`created_at` 晚于目标 checkpoint 的条目（含 manual）必须删除。→ Task 5 测试。

---

### Task 1: DB 层 — `session_checkpoints` 表与 GatewayDatabase 方法

**Files:**
- Modify: `gateway/src/memory/gateway-db.ts`（DDL 在 L287 `evolution_proposals` 表后追加；方法加在 goal_node_runs 方法群附近）
- Test: `gateway/tests/unit/gateway-db-checkpoints.test.ts`

**Interfaces:**
- Produces（后续任务依赖的精确签名）:

```ts
export interface SessionCheckpointRow {
  id: string;                 // ckpt_<uuid>
  session_id: string;
  project_dir: string;
  anchor_message_id: string;
  snapshot_tree: string | null;  // 40/64-hex 或 null
  untracked_json: string;        // JSON.stringify(string[])
  kind: string;                  // 'auto' | 'manual'
  created_at: string;            // ISO
}
// GatewayDatabase 上新增：
insertSessionCheckpoint(row: SessionCheckpointRow): void
getSessionCheckpoint(id: string): SessionCheckpointRow | undefined
listSessionCheckpoints(sessionId: string): SessionCheckpointRow[]   // ORDER BY created_at DESC
pruneSessionAutoCheckpoints(sessionId: string, keep: number): number
deleteSessionCheckpointsAfter(sessionId: string, createdAtIso: string): number  // created_at > ?，全部 kind
deleteSessionCheckpoints(sessionId: string): void
```

- [ ] **Step 1: 写失败测试** — 新建 `gateway/tests/unit/gateway-db-checkpoints.test.ts`：用临时目录 db（先例：查现有 gateway-db 测试的 tmp 初始化方式，`fs.mkdtempSync` + `new GatewayDatabase(path)`），覆盖：insert+get 往返（含 `snapshot_tree: null`）；list 按 created_at 倒序；prune 只裁 auto（101 条 auto 保 100，manual 不受影响，返回删除数）；deleteAfter 排除等于 createdAt 的目标自身、删晚于它的全部（含 manual）；delete 全删。

```ts
it('prune keeps newest 100 auto, never touches manual', () => {
  for (let i = 0; i < 102; i++) db.insertSessionCheckpoint(row('a', `ckpt_${i}`, 'auto', `1970-01-01T00:${String(i).padStart(2,'0')}:00Z`));
  db.insertSessionCheckpoint(row('a', 'ckpt_manual', 'manual', '1970-01-01T00:00:00Z'));
  expect(db.pruneSessionAutoCheckpoints('a', 100)).toBe(2);
  const rows = db.listSessionCheckpoints('a');
  expect(rows).toHaveLength(101);
  expect(rows.find(r => r.id === 'ckpt_manual')).toBeDefined();
  expect(rows.find(r => r.id === 'ckpt_0')).toBeUndefined();
});
```

- [ ] **Step 2: 跑测试确认失败** — `cd gateway && npx jest tests/unit/gateway-db-checkpoints.test.ts --runInBand`，期望 TypeError: db.insertSessionCheckpoint is not a function。
- [ ] **Step 3: 实现** — DDL 追加 `CREATE TABLE IF NOT EXISTS session_checkpoints (...)` + `CREATE INDEX IF NOT EXISTS idx_session_checkpoints ON session_checkpoints(session_id, created_at)`；六个方法全部 `this.db.prepare(...)`（`deleteSessionCheckpointsAfter` 用 `WHERE session_id = ? AND created_at > ?`；prune 用 `DELETE FROM session_checkpoints WHERE session_id=? AND kind='auto' AND id NOT IN (SELECT id FROM session_checkpoints WHERE session_id=? AND kind='auto' ORDER BY created_at DESC LIMIT ?)`）。
- [ ] **Step 4: 跑测试确认通过** — 同 Step 2 命令，期望 PASS。
- [ ] **Step 5: Commit** — `git add gateway/src/memory/gateway-db.ts gateway/tests/unit/gateway-db-checkpoints.test.ts && git commit -m "feat(checkpoint): session_checkpoints table + db methods"`

---

### Task 2: 契约 — `checkpointApi` 能力位 + revert `files` 参数 + commit 失败清 stage

**Files:**
- Modify: `gateway/src/runtime/contract.ts:27-56`（RuntimeCapabilities）与 `contract.ts:360-372`（session.revert 注释）；`gateway/src/runtime/opencode-adapter.ts:457-472`（revert 实现）；`gateway/src/runtime/opencode-runtime.ts`（基础能力位，sessionBranchApi: true 附近）
- Test: `gateway/tests/unit/runtime/revert-files.test.ts`

**Interfaces:**
- Produces:

```ts
// contract.ts RuntimeCapabilities 新增（sessionBranchApi 旁）：
/** checkpoint 记录/三态 restore 依赖 snapshot 树 + staged revert（opencode-only） */
checkpointApi?: boolean;
// RuntimeClient.session.revert 签名扩展：
revert(opts: { sessionID: string; messageID: string; partID?: string; files?: boolean }): Promise<void>
// opencode 基础能力集：checkpointApi: true（pi 插件不声明 → undefined → 路由 503）
```

- [ ] **Step 1: 写失败测试** — `revert-files.test.ts`：mock `directNative` 不可行（模块内闭包），改为测 adapter 的公开行为不可 mock 时退而测**契约层**：① `OPencodeRuntime` 基础 capabilities 含 `checkpointApi: true`；② contract.ts 类型层面 `files` 可选参数（编译即验证）。adapter 透传逻辑用**活体验证**（Step 4 冒烟）+ 类型断言测试：读 `opencode-adapter.ts` 编译产物无意义——直接写一个对 `revert` opts 形状的类型消费测试（`const opts: Parameters<NonNullable<RuntimeClient['session']['revert']>>[0] = { sessionID: 's', messageID: 'm', files: false }`）+ capabilities 断言。
- [ ] **Step 2: 跑测试确认失败** — `cd gateway && npx jest tests/unit/runtime/revert-files.test.ts --runInBand`，期望 capabilities 断言 FAIL。
- [ ] **Step 3: 实现** — contract.ts 加 `checkpointApi?: boolean` + revert 注释补 `files`（缺省 true）；opencode-runtime.ts 基础能力 `checkpointApi: true`；opencode-adapter revert 改为：stage body `files: opts.files !== false`；**commit 失败清理**——`await commit` 抛错时先 `await directNative(\`/session/${id}/revert\`, 'DELETE').catch(() => {})` 清 stage 再 rethrow（服务层据 502 语义透传）。
- [ ] **Step 4: 活体冒烟验证 ①**（固化三态前提）：造一个一次性会话 → 发一条消息等 turn 完成 → 经 gateway 反代 `POST http://127.0.0.1:3000/session/<id>/revert/stage` body `{"messageID":"<last>","files":false}` → 期望 200 且 `data` 里 files 列表为空/不含文件回滚语义 → `DELETE /session/<id>/revert` 清 stage → `POST /api/sessions/<id>` DELETE 删会话。结果（200 与否）记入 commit message。
- [ ] **Step 5: 跑全量 runtime 相关测试** — `npx jest tests/unit/runtime --runInBand`，期望全 PASS（含 validate/caps 快照若有）。
- [ ] **Step 6: Commit** — `git commit -m "feat(contract): checkpointApi capability + revert files flag (stage files:false verified live)"`

---

### Task 3: 词汇链 — `session.checkpoint` canonical 事件六处同步

**Files:**
- Modify: `packages/gateway-sdk/src/events.ts:15-25`（RUNTIME_EVENT_TYPES）；`gateway/src/runtime/mafw-vocabulary.ts:39-43`（MAFW 数据面组，sessionConfig 旁）；`gateway/src/runtime/event-flow-matrix.ts:62-64`（queue.updated/session.config 行旁）；`packages/tui/src/store/connection.ts:19-29`（KNOWN_EVENTS）；`packages/desktop/src/renderer/mafw/session-events.ts:106-112`（IGNORED_AT_SHELL）
- Test: 既有钉扎测试自动覆盖：`gateway/tests/unit/vocabulary-sync.test.ts`、`packages/tui/tests/event-coverage.test.ts`、`packages/desktop/src/renderer/mafw/session-events.test.ts`

**Interfaces:**
- Produces: canonical 事件名 `session.checkpoint`；载荷 `{ sessionID, checkpointId, kind }`（properties 内），经 `mafwBroadcast` 信封广播；desktop shell 显式 ignore（overlay 拉取式消费，不订阅刷新）。

- [ ] **Step 1: 五处加词** — 按上表精确位置各加一行 `"session.checkpoint"` / `sessionCheckpoint: 'session.checkpoint'`；event-flow-matrix 行语义：`R([], 'passthrough', 'ignore', 'ignore', 'T2-1：gateway 自发（CheckpointService 创建），desktop overlay 拉取式消费')`。
- [ ] **Step 2: 跑双侧钉扎** — `cd gateway && npx jest tests/unit/vocabulary-sync.test.ts --runInBand` + `cd packages/tui && npm test` + `cd packages/desktop && npm test`，期望全绿（sync/coverage/ignore 清单测试若断言长度需同步 +1）。
- [ ] **Step 3: Commit** — `git commit -m "feat(vocab): session.checkpoint canonical event, six-way sync"`

---

### Task 4: CheckpointService 创建/列表 + auto-recorder 纯函数

**Files:**
- Create: `gateway/src/core/checkpoint/checkpoint-service.ts`、`gateway/src/core/checkpoint/auto-recorder.ts`
- Modify: `gateway/src/core/diff/turn-diff.ts`（`roleOf`/`createdOf`/`unwrapMessage` 三个私有工具加 `export`——零行为变化）
- Test: `gateway/tests/unit/checkpoint/checkpoint-service.test.ts`、`gateway/tests/unit/checkpoint/auto-recorder.test.ts`

**Interfaces:**
- Consumes: Task 1 db 方法、Task 3 `sessionCheckpoint` 事件名。
- Produces（Task 5/6/7 依赖）:

```ts
// auto-recorder.ts（全纯函数）
export function planAutoCheckpoint(messages: any[]): { anchorMessageID: string; snapshotTree: string | null } | null
//   末尾反向找最后一条 assistant A_N → 无则 null；A_N 之前最近 user id → 无则 null；
//   tree = A_N 所在回合（该 user 之后）第一条 assistant 的有效 snapshot.start → 无则 null
export function latestSnapshotTree(messages: any[]): string | null
//   最后一条带有效 snapshot.end 的 assistant 的 end；无则 null
export function manualAnchor(messages: any[], explicit?: string): { anchorMessageID: string } | null
//   explicit 给定且消息列表含该 id → 用之；否则最后一条已持久化消息 id；空列表 → null
export function parseUntrackedLines(porcelain: string): string[]
//   仅 `?? ` 开头行；剥离状态列取路径（trim）；忽略空行

// checkpoint-service.ts
export interface SessionCheckpoint { id: string; sessionID: string; projectDir: string; anchorMessageID: string; snapshotTree: string | null; untracked: string[]; kind: 'auto' | 'manual'; createdAt: string }
export interface CheckpointDbDeps { /* Task 1 六方法 */ }
/** 完整依赖面一次定义（Task 4 建 service，Task 5 只增 restore 方法、不改本接口；
 *  Task 4 的测试 mock 全部成员——restore 相关成员在 create/list 路径不被触碰）。 */
export interface CheckpointServiceDeps {
  db: CheckpointDbDeps;
  runtime: {
    session: {
      get(opts: { sessionID: string }): Promise<any>;
      messages(opts: { sessionID: string; limit?: number }): Promise<{ data: any[] }>;
      revert(opts: { sessionID: string; messageID: string; files?: boolean }): Promise<void>;
      vcs: { apply(opts: { patch: string }): Promise<void> };
    };
  };
  git: { run(args: string[]): Promise<{ code: number; stdout: string; stderr: string }> };  // turn-diff GitRunner
  porcelainOf(projectDir: string): Promise<string>;   // `git status --porcelain`（注入）
  snapshotRoot?: string;
  broadcast(event: { type: string; [key: string]: any }): void;
  now(): string;      // ISO
  newId(): string;    // `ckpt_${randomUUID()}`
}
export class CheckpointService {
  constructor(deps: CheckpointServiceDeps)
  create(input: { sessionID: string; projectDir: string; anchorMessageID: string; snapshotTree: string | null; untracked: string[]; kind: 'auto' | 'manual' }): SessionCheckpoint
  //   insert → kind==='auto' 时 prune(100) → broadcast session.checkpoint（properties: { sessionID, checkpointId: id, kind }）
  list(sessionID: string): SessionCheckpoint[]
}
```

- [ ] **Step 1: 写 auto-recorder 失败测试** — 覆盖 Review Focus #1/#2：构造消息数组（含 `time.created` 排序键、`snapshot.start/end`、user 在 assistant 前的交替序列）：① 常规回合（U1→A1）→ anchor=U1、tree=A1.snapshot.start；② **末尾已持久化 U2**（immediate-delivery）→ anchor 仍是 U1；③ 多 step 回合（U1→A1a(start1,end1)→A1b(start2,end2)）→ tree=**start1**；④ 纯对话（assistant 无 snapshot）→ tree=null；⑤ 无 assistant → null；⑥ `latestSnapshotTree` 取末条有效 end；⑦ porcelain 解析（`?? a.txt\nM b.txt\n?? dir/\n` → `['a.txt','dir/']`）。
- [ ] **Step 2: 跑测试确认失败** — `npx jest tests/unit/checkpoint/auto-recorder.test.ts --runInBand`，期望模块不存在。
- [ ] **Step 3: 实现 auto-recorder.ts** — 复用 turn-diff 导出的 `roleOf/createdOf/unwrapMessage/isSnapshotId`（`isSnapshotId` 已导出）；排序逻辑照 `selectTurnSnapshot` 同式（created 升序、同分按原序）。
- [ ] **Step 4: 写 checkpoint-service 失败测试** — mock deps（db 用内存 Map 实现六方法、broadcast 记录调用、now 固定、newId 递增）：create 落库返回 camelCase DTO + auto 触发 prune(100) + broadcast 载荷 `{type:'session.checkpoint', properties:{sessionID, checkpointId, kind}, sessionID}`；manual 不 prune；list 倒序。
- [ ] **Step 5: 实现 checkpoint-service.ts 并跑绿两个测试文件**
- [ ] **Step 6: Commit** — `git commit -m "feat(checkpoint): CheckpointService create/list + auto-recorder pure fns"`

---

### Task 5: 三态 restore（正向补丁 + 预检 + 时间线倒带）

**Files:**
- Modify: `gateway/src/core/checkpoint/checkpoint-service.ts`（restore 方法 + 错误类）
- Test: `gateway/tests/unit/checkpoint/restore.test.ts`（mock deps 单测）+ `gateway/tests/unit/checkpoint/restore-git.test.ts`（真实 git fixture 集成）

**Interfaces:**
- Consumes: Task 1 db、Task 2 revert `files`、Task 4 service/纯函数、turn-diff `findSnapshotRepo`（已导出）。
- Produces:

```ts
export type CheckpointScope = 'session' | 'files' | 'both';
export class CheckpointRestoreError extends Error { constructor(public status: number, message: string) { super(message); } }
export interface CheckpointRestoreResult {
  scope: CheckpointScope;
  filesSkipped?: boolean;                 // both + tree=null 降级
  leftoverUntracked?: string[];           // files/both 返回
  preRestoreCheckpointId?: string;        // files 成功时
}
// service 新方法（deps 见 Task 4——本任务只加方法，接口不动）：
async restore(input: { sessionID: string; checkpointId: string; scope: CheckpointScope }): Promise<CheckpointRestoreResult>
```

**restore 流程（实现体要点）：**
- checkpoint 不存在/不属于该 session → `CheckPointRestoreError(404)`。
- `scope='session'`：`revert({sessionID, messageID: anchor, files: false})`（adapter 内 commit 失败已自动清 stage，错误上抛 502）→ `deleteSessionCheckpointsAfter(sessionID, ckpt.created_at)` → `{ scope }`。
- `scope='both'`：tree=null → 按 session 分支执行 + `{ scope, filesSkipped: true }`；否则 `revert({files: true})` → deleteAfter → 计算 leftover（同 files 分支第 7 步）。
- `scope='files'`：
  1. tree=null → 400 `'checkpoint has no file state'`；
  2. `messages({limit:200})` → `latestSnapshotTree` → null → 404 `'no current snapshot tree'`；
  3. latest===ckptTree → 幂等：跳到第 7 步（不 apply、不建 pre-restore）；
  4. `session.get` 拿 projectID → `findSnapshotRepo({root, projectID, start: ckptTree, end: latest, git})` → null → 404 `'snapshot trees not found (pruned?)'`；
  5. **pre-restore checkpoint**：`create({kind:'auto', anchor: 最后一条消息 id, snapshotTree: latest, untracked: parse(porcelain)})`；
  6. `patch = git.run(['--git-dir', repo, '-c','core.quotePath=false','diff','--binary', latest, ckptTree]).stdout`；写临时文件（`os.tmpdir()`）→ 预检 `git.run(['--git-dir', repo, '--work-tree', projectDir, 'apply', '--check', patchFile])` code!==0 → 400 `'workspace has out-of-turn changes; patch context mismatch'`；通过 → `runtime.session.vcs.apply({patch})`；
  7. leftover = `parseUntrackedLines(await porcelainOf(projectDir)).filter(f => !ckpt.untracked.includes(f))` → `{ scope, leftoverUntracked: leftover, preRestoreCheckpointId? }`。
- projectDir 来源：**restore 输入不带**（防伪造）——由 checkpoint row 的 `project_dir` 供 porcelain/work-tree 使用，`session.get` 仅取 projectID 定位 snapshot repo。

- [ ] **Step 1: 写 restore.test.ts（mock）** — 覆盖：404（无 checkpoint）；session scope 调 revert files:false + deleteAfter + 不建 pre-restore；both+null tree 降级 filesSkipped；files+null tree 400；files 幂等（latest===tree → 只算 leftover 不 apply）；files 成功链（pre-restore 建立顺序在 apply 前、vcs.apply 收到的 patch 文本、leftover 差集方向 = 当前 − checkpoint 时）；预检失败 400；deleteAfter 参数是 ckpt.created_at。
- [ ] **Step 2: 跑确认失败** — `npx jest tests/unit/checkpoint/restore.test.ts --runInBand`
- [ ] **Step 3: 实现 restore**（按上述流程）
- [ ] **Step 4: 写 restore-git.test.ts（真实 git 集成）** — fixture 编排（`fs.mkdtempSync`）：
  - `tmp/project`：`git init` + commit base（file1 内容 A）→ 改 file1=B + **新增 file2** + commit → 取两 commit tree id（`git rev-parse HEAD^{tree}` 各一次）；
  - `tmp/root/pid/repo.git`：`git init --bare`，从 project `git push` 两 commit；
  - 工作区回置：`git checkout <tree1 内容>`（用 `git --git-dir=repo.git --work-tree=project checkout -f <tree2> -- .`？不可——直接在 project 里 `git reset --hard <commit2>` 保持工作区=tree2）；
  - 断言：service.restore(files, ckptTree=tree1) → project 工作区 file1 回到 A、file2 被删（正向补丁天然处理新增/删除，Review Focus 之外的本路径关键收益）；
  - **预检分支**：手工改 file1 为 C → restore → 400；
  - **untracked 残留**：造 `untracked-new.txt`（不在 ckpt.untracked）→ restore 后出现在 leftoverUntracked。
  - GitRunner 用测试内联 execFile 包装（照 turn-diff.ts `defaultGit` 同式）。
- [ ] **Step 5: 跑两个测试文件确认通过**
- [ ] **Step 6: Commit** — `git commit -m "feat(checkpoint): three-scope restore with forward patch + pre-check + timeline rewind"`

---

### Task 6: HTTP 路由 + catalog + wave1 绑定 + 会话删除联动

**Files:**
- Create: `gateway/src/routes/session-checkpoints.ts`
- Modify: `gateway/src/routes/route-catalog.ts:51-55`（SDK_FACING_ROUTES session 组）；`gateway/src/routes/wave1-handlers.ts`（import + Wave1Gateway 增成员 + attachHandler×3）；`gateway/src/routes/session-mutations.ts:5-16`（SessionMutationDeps 增可选 `deleteCheckpoints?: (sessionID: string) => void`，delete 分支 fail-open 调用）；`gateway/src/index.ts`（CheckpointService 实例化 ~sessionConfig 旁 L3249 + attachWave1Handlers 处传入 + session-mutations deps 接线）
- Test: `gateway/tests/unit/routes/session-checkpoints.test.ts`

**Interfaces:**
- Consumes: Task 4/5 service。
- Produces（Task 8 SDK 对齐的路由契约）:

```
POST /api/sessions/:id/checkpoint        body?: { messageID?: string }     → 200 { checkpoint: SessionCheckpoint }
                                          （anchor: explicit 或 manualAnchor(messages)；tree: latestSnapshotTree(messages)）
GET  /api/sessions/:id/checkpoints                                          → 200 { checkpoints: SessionCheckpoint[] }
POST /api/sessions/:id/checkpoints/:cid/restore  body { scope, confirm: true } → 200 CheckpointRestoreResult
                                          （confirm!==true → 400；scope 非法 → 400；能力门 checkpointApi → 503；
                                           CheckpointRestoreError.status 透传；未知错误 500）
```
- 路由 handler 形态照 `session-branch.ts`（readBody/json 内联工具、返回 false 透传）；manual create 需 `runtime.session.messages` + projectDir（`session.get` 的 directory 或注册项目路径——**用 `session.get({sessionID}).directory`**，缺省 400）。
- catalog 行（三条，operationId 对齐 SDK 方法名）：`session.checkpoint` / `session.checkpoints` / `session.restoreCheckpoint`。

- [ ] **Step 1: 写失败测试** — mock deps（service 为 spy 对象、getRuntime 返回带/不带 `checkpointApi` 的 runtime）：503 能力门；restore 无 confirm → 400；scope 非法 → 400；cid 404（service 抛 CheckpointRestoreError(404) 透传）；create 手动默认 anchor 调用链（messages → manualAnchor → latestSnapshotTree → service.create）；GET 列表透传。路由正则用 `req.url` 带 `?x=1` 的形态断言不吞（Global Constraints）。
- [ ] **Step 2: 跑确认失败** — `npx jest tests/unit/routes/session-checkpoints.test.ts --runInBand`
- [ ] **Step 3: 实现路由 + catalog + wave1 + index 接线** — CheckpointService 构造 deps 从 gateway 实例取（`getGatewayDb()`、`this.broadcast.bind(this)`、runtime、`defaultGit` 从 turn-draft import、`porcelainOf` 用 simpleGit(`core/utils/git.ts` 封装或直接 `simpleGit(dir).status()` 转 porcelain 行——**用 simpleGit 的 `status()` 结果自行拼 `?? path` 行**，避免 porcelain 文本依赖）。session-mutations delete 联动 fail-open。`emit-openapi` 再生成：`cd gateway && npx ts-node --project tsconfig.json scripts/emit-openapi.ts` + `cd packages/gateway-sdk && npm run gen:api`（api-contract 新鲜度测试要求，先例见 emit-openapi.ts 头注释）。
- [ ] **Step 4: 跑路由测试 + api-contract** — `npx jest tests/unit/routes/session-checkpoints.test.ts tests/unit/api-contract.test.ts --runInBand`（后者路径若不同按实际）。
- [ ] **Step 5: Commit** — `git commit -m "feat(checkpoint): HTTP routes + catalog + wave1 + session-delete cleanup"`

---

### Task 7: 自动记录钩子（index.ts turn.completed 接线）

**Files:**
- Modify: `gateway/src/index.ts:1316` 附近（`identityState.clearTurnBindings` 之后、memoryWorker 早退之前）
- Test: 逻辑已在 Task 4 纯函数覆盖；本任务补一个接线门控单测 `gateway/tests/unit/checkpoint/auto-hook.test.ts`（测门控谓词抽出的纯函数或最小 spy 集成）

**Interfaces:**
- Consumes: Task 4 `planAutoCheckpoint`/`parseUntrackedLines`、CheckpointService.create。
- Produces: `private async recordAutoCheckpoint(sessionID: string): Promise<void>`（fail-open 由调用侧 catch）。

**接线体（含门控顺序，实现照此）：**
1. `this.runtime?.capabilities?.checkpointApi !== true` → return；
2. `this.internalSessionRoles.get(sessionID)` 有值 → return（worker/curator/btw/media）；
3. `session.get({sessionID})` → info null → return；`isHiddenSession(info, resolver)` true → return（历史 kv 角色表兜底）；
4. `session.messages({sessionID, limit: 50})` → `planAutoCheckpoint(messages)` null → return；
5. `untracked = parseUntrackedLines(<porcelain of info.directory>)`（simpleGit，失败 → 空数组继续）；
6. `this.checkpointService.create({sessionID, projectDir: info.directory, anchorMessageID, snapshotTree, untracked, kind: 'auto'})`；
7. 调用点：`if (type === MAFW.turnCompleted && sessionID) void this.recordAutoCheckpoint(sessionID).catch(err => log.warn(...))`——在 identityState 清理旁，**早于** memoryWorker 早退（保证早退会话也已被 role 门挡住；role 未登记的历史 worker 由 isHiddenSession 兜底）。

- [ ] **Step 1: 写门控测试** — auto-hook.test.ts 测 1-3 门控序（runtime 无能力/role 命中/hidden info → 不触达 messages），mock 最小 runtime + db。
- [ ] **Step 2: 跑确认失败 → 实现接线 → 跑绿**
- [ ] **Step 3: gateway 全量回归** — `cd gateway && npx jest --runInBand --forceExit`，期望全绿（基线 2629 + 本批新增）。
- [ ] **Step 4: Commit** — `git commit -m "feat(checkpoint): auto-record hook on turn.completed (fail-open, hidden-session gated)"`

---

### Task 8: SDK + preload

**Files:**
- Modify: `packages/gateway-sdk/src/types.ts:357-366`（SessionNamespace）+ `SessionCheckpoint`/`CheckpointRestoreResult` 类型（FileDiffInfo 旁 L368）；`packages/gateway-sdk/src/client.ts:232-267`（fork/revert 区）；`packages/desktop/src/preload/mafw-api.ts:97-107`（sessions 段）；`packages/desktop/src/preload/mafw-types.ts`（sessions 接口）
- Test: `packages/gateway-sdk/src/client.test.ts`（fork/revert 锚点区追加）

**Interfaces:**
- Produces:

```ts
// types.ts
export interface SessionCheckpoint { id: string; sessionID: string; projectDir: string; anchorMessageID: string; snapshotTree: string | null; untracked: string[]; kind: 'auto' | 'manual'; createdAt: string }
export type CheckpointScope = 'session' | 'files' | 'both'
export interface CheckpointRestoreResult { scope: CheckpointScope; filesSkipped?: boolean; leftoverUntracked?: string[]; preRestoreCheckpointId?: string }
// SessionNamespace 追加：
checkpoint(params: { path: { id: string }; body?: { messageID?: string } }): Promise<{ checkpoint: SessionCheckpoint }>
checkpoints(params: { path: { id: string } }): Promise<{ checkpoints: SessionCheckpoint[] }>
restoreCheckpoint(params: { path: { id: string; checkpointId: string }; body: { scope: CheckpointScope; confirm: true } }): Promise<CheckpointRestoreResult>
// preload（invoke 三方法，path/body 形态与 SDK 一致）：
window.api.mafw.sessions.checkpoint(sessionID, messageID?)
window.api.mafw.sessions.checkpoints(sessionID)
window.api.mafw.sessions.restoreCheckpoint(sessionID, checkpointId, scope)
```

- [ ] **Step 1: 写失败测试** — client.test.ts 追加三方法（fetch mock 断言 method/path/body：restore body `{scope, confirm:true}`；checkpoint 可空 body `{}`）。preload 无独立测试（静态类型由 desktop tsgo 把关）。
- [ ] **Step 2: 实现 types + client + preload → SDK 测试绿** — `cd packages/gateway-sdk && npm test`。
- [ ] **Step 3: desktop 类型检查** — `cd packages/desktop && npx tsgo --noEmit`（或包内 typecheck script），期望绿。
- [ ] **Step 4: Commit** — `git commit -m "feat(sdk): checkpoint/checkpoints/restoreCheckpoint + preload bridge"`

---

### Task 9: Desktop — 时间线服务端模式 + 三态恢复菜单

**Files:**
- Create: `packages/desktop/src/renderer/mafw/components/server-checkpoints.ts`（纯逻辑）
- Modify: `packages/desktop/src/renderer/mafw/components/CheckpointOverlay.tsx`（服务端模式分支）、`components/ChatPane.tsx`（loadServerCheckpoints/restoreCheckpoint handler + overlay props + 能力门）
- Test: `packages/desktop/src/renderer/mafw/components/server-checkpoints.test.ts`、`CheckpointOverlay` 相关测试文件（若有 overlay.test 按现有形态追加；无则纯逻辑测试覆盖 + 手工冒烟清单）

**Interfaces:**
- Consumes: Task 8 preload 三方法；`CheckpointOverlay` 现有 props（`caps`/`busy`/`onRevert`/`onRevertCode` 不变）。
- Produces:

```ts
// server-checkpoints.ts
export interface ServerCheckpointRow {
  checkpoint: SessionCheckpoint
  timeLabel: string          // toLocaleString 同 checkpoint-model 先例
  kindBadge: 'auto' | 'manual'
  filesAvailable: boolean    // snapshotTree !== null
  filesLabel: string         // filesAvailable ? '代码+对话' : '仅对话'
}
export function toServerRows(checkpoints: SessionCheckpoint[]): ServerCheckpointRow[]  // createdAt 倒序兜底
export function leftoverNotice(result: CheckpointRestoreResult): string[] | null       // 文案行数组；无 leftover → null
// overlay 新 props：
serverCheckpoints?: SessionCheckpoint[]
onRestoreCheckpoint?: (checkpointId: string, scope: CheckpointScope) => Promise<CheckpointRestoreResult | null>
onCreateCheckpoint?: () => Promise<boolean>
```

**行为要点：** `props.caps?.checkpointApi === true` → 头部「立即检查点」按钮（ButtonV2，调 onCreateCheckpoint 后重拉列表）+ 服务端列表区（每行 kindBadge、filesLabel、恢复菜单三选项 对话/代码/全部——`filesAvailable===false` 时 files 项与 both 降级为仅对话并禁用、复用 `revertWarning` 的 runtime-aware 警示文案、确认后调 onRestoreCheckpoint、leftoverNotice 以 notice 文本块呈现于 overlay 顶部，无删除按钮）；否则完全走现有本地构建路径（pi/旧 runtime 零变化）。busy 状态禁用全部动作（现有 `busy()` 谓词复用）。ChatPane 侧 handler：restore 成功后复用 `refreshAfterRevert()` + toast；会话切换/overlay 打开时拉取。

- [ ] **Step 1: 写 server-checkpoints.test.ts** — toServerRows 排序/徽标/filesAvailable；leftoverNotice 三态（files 无残留→null；有→文案含文件名；both filesSkipped→提示行）。
- [ ] **Step 2: 实现 server-checkpoints.ts → 绿**
- [ ] **Step 3: overlay/ChatPane 集成** — 按 Interfaces；ChatPane 不新开 IPC（renderer 直调 window.api）。
- [ ] **Step 4: desktop 全量** — `cd packages/desktop && npm test`（基线 1457+ 本批新增）+ `npx electron-vite build`。
- [ ] **Step 5: Commit** — `git commit -m "feat(desktop): server checkpoint timeline + three-scope restore menu"`

---

### Task 10: 全量验证、版本 v4.37.0、部署与冒烟

**Files:**
- Modify: `package.json`（version 4.37.0）、`AGENTS.md`（§4.1 后 Batch 9 段落，含 commits/测试计数）

**Interfaces:** 无代码。

- [ ] **Step 1: 全量测试矩阵** — gateway `npx jest --runInBand --forceExit`（记录计数）；SDK `npm test`；TUI `npm test`；desktop `npm test`；session-ui `npm test`。全部绿才继续。
- [ ] **Step 2: 构建矩阵** — 根 `npm run build`；desktop `npx electron-vite build`（若 Step 1 已跑可省，但需有一次完整通过记录）。
- [ ] **Step 3: 版本 + 文档** — `npm version 4.37.0 --no-git-tag-version`；AGENTS.md 追加 Batch 9 条目（spec/plan 路径、commit 哈希、测试计数、活体验证点①②结论）。
- [ ] **Step 4: 提交** — 代码 commits 已逐任务落；本步提交版本+文档：`git commit -m "chore(release): v4.37.0 — server checkpoints + three-scope restore"`。
- [ ] **Step 5: 本机部署** — `mafw stop` → `npm pack` → `npm install -g jack200714-mafw-4.37.0.tgz --force` → `mafw daemon` → `mafw version` 确认 4.37.0、`/api/runtime` active=opencode。
- [ ] **Step 6: 真机冒烟**（node fetch 脚本，逐项记录）：
  1. `POST /api/sessions`（目录=本仓库）→ promptAsync 一条消息 → 等 turn.completed → `GET /api/sessions/:id/checkpoints` 应含 ≥1 条 auto（snapshotTree 非空或 null 均合法）；
  2. `POST .../checkpoint`（manual）→ 200；
  3. 该会话内再 prompt 一轮改动文件 → 对**第一个 auto checkpoint** 执行 `restore {scope:'files', confirm:true}` → 200，工作区文件回滚、`leftoverUntracked` 为数组；pre-restore checkpoint 出现在列表顶端；
  4. 对 pre-restore checkpoint 再 restore files → 工作区还原（后悔药闭环）；
  5. `restore {scope:'session', confirm:true}` → 200 后列表中晚于目标的条目消失；
  6. `restore` 无 confirm → 400；不存在的 cid → 404；
  7. TUI `KNOWN_EVENTS`/SSE 面板无 unknown event 告警（session.checkpoint 到达）。
- [ ] **Step 7: 汇报** — 版本 + commit 哈希 + 测试计数 + 冒烟结果；**不 push**（等用户确认）。
