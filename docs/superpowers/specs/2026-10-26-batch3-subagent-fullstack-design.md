# Batch 3 — 子代理全栈（Design）

> 日期：2026-10-26 · 状态：已实施（Batch 3；commits `1da5ec3e` / `cf6c3fbc` / `eef2191d`）
> 上游：Batch 0 的 children 树/实时行；Batch 1 的 structured output；Batch 2 的 elicitation。Batch 4 durable task 复用本批的 parent/depth/task-handle 形态。

## 1. 意图与为什么

2.1 已有原生 `subagent` 工具（前台/`background:true`）与 `POST /api/session {parentID}`，所以“执行”不是缺口；缺口在**网关可编程面与血缘**：

- 没有 gateway-owned spawn/list/message/cancel/result API：TUI、goal 编排、pi runtime、脚本无法统一派子代理；
- 后台子代理只返回 sessionID，父会话没有“取结果/发消息/取消”的工具；
- `session.created` 不带 parentID/depth（Batch 0 靠 tool part 推导实时行）；
- 没有 depth/血缘目录，嵌套子代理只能靠打开子会话看；
- 结构化结果只存在于 Batch 1 的 per-session 服务，父会话没有读取入口。

本批把 2.1 的父子会话能力收编为 **gateway 一等子代理面**，不引入新 canonical 事件词汇：复用 `session.created/updated` + `turn.*`，用合成 `session.created` 补 parentID/depth。

## 2. 目标 / 非目标

**目标**

1. `POST /api/sessions/:parent/subagents`：创建带 `parentID` 的子会话、派 prompt、可选 `outputSchema`；返回 child id/depth/status。
2. `GET /api/sessions/:parent/subagents`：合并网关记录 + runtime children，返回 agent/description/status/depth/background。
3. `POST /api/sessions/:parent/subagents/:child/message`：父→子消息（经 child prompt，`delivery:'queue'`）。
4. `POST /api/sessions/:parent/subagents/:child/cancel`：abort 子会话。
5. `GET /api/sessions/:parent/subagents/:child/result`：优先 Batch 1 structured，否则最后 assistant 文本。
6. 合成 `session.created`（info 带 parentID/depth）让桌面 tracker 对 API-spawn 的子代理立即建行；children 路由返回每项 depth。
7. 工具面：`mafw_spawn_subagent` / `mafw_message_subagent` / `mafw_subagent_result`（opencode v1 插件 + pi factory），让没有原生 subagent 的 runtime 也能用。
8. 桌面 SubagentDock 按 depth 缩进，并显示当前会话的后代（嵌套树）；不改变现有通知/终态语义。

**非目标**

- 不重写 2.1 原生 `subagent` 工具；前台等待仍由原生工具负责。
- 不新增 `task.*` 词汇（留给 Batch 4 durable task）；不新增 canonical 事件类型。
- 不做 agent 间双向 RPC 协议；消息 = 带 sender 标记的 child prompt。
- 不做远程/跨机器子代理；不做权限模型变更（child 继承父目录/agent 参数）。
- 不做子代理专用 UI 编辑器；只在现有 dock 上加 depth/后代。

## 3. 2.1 实证

- `POST /api/session {location:{directory}, parentID}` 创建 child；`Session.Info.parentID` 可读。
- 原生 `subagent` 工具 part 的 `state.metadata.sessionID` = child；`background:true` 立即返回，前台等到完成。
- 没有 `sendMessage`/`/children` 路由；父→子只能用 child prompt（`delivery:'queue'|'steer'`）。
- `GET /api/session?parentID=` 列出 direct children；depth 需沿 parentID 链计算。
- `turn.completed/failed/aborted` 对 child 会话照常发出；Batch 0 tracker 已消费。

## 4. 设计

### 4.1 `SubagentService`（`gateway/src/runtime/subagent-service.ts`）

```ts
export interface SubagentRecord {
  id: string; parentID: string; depth: number;
  agent?: string; description?: string;
  status: 'running'|'completed'|'failed'|'aborted';
  background?: boolean; createdAt: number; updatedAt: number;
}
export interface SpawnSubagentOpts {
  parentID: string; directory?: string; agent?: string; description?: string;
  prompt: string; background?: boolean; model?: {providerID:string;modelID:string};
  outputSchema?: OutputSchemaSpec;
}
export class SubagentService {
  constructor(deps: {
    createSession(opts: {directory:string; parentID:string}): Promise<{id:string}>;
    getSession(sessionID:string): Promise<any>;
    promptChild(opts: {sessionID:string; prompt:string; agent?:string; model?:any; outputSchema?:OutputSchemaSpec}): Promise<void>;
    messageChild(sessionID:string, text:string): Promise<void>;
    abortChild(sessionID:string): Promise<void>;
    messages(sessionID:string, limit:number): Promise<any[]>;
    submitted(sessionID:string): unknown | undefined;
    broadcast(event: any): void;
  })
  spawn(opts): Promise<SubagentRecord>
  list(parentID): Promise<SubagentRecord[]>
  message(parentID, childID, text): Promise<void>
  cancel(parentID, childID): Promise<void>
  result(parentID, childID): Promise<{status; structured?; text?}>
  depthOf(sessionID): Promise<number>
}
```

- 记录 per childID，spawn 时写；list 以记录为骨架，合并 runtime children（未记录的 native 子代理按 `parentID` 补 depth/status）。
- `statusOf(info)`：`time.idle` 存在 → `outcome==='failed'` failed / `'interrupted'` aborted / completed；否则 running。
- `depthOf`：沿 `getSession().parentID` 走，缓存；根 depth=0，direct child=1。
- spawn：
  1. 取 parent info（directory/标题），`createSession({directory, parentID})`；
  2. `promptChild`（带 agent/model/outputSchema）；
  3. `getSession(child)` + depth；写记录；
  4. `broadcast({type:'session.created', properties:{sessionID:child.id, info:{...childInfo, parentID, depth}}})`。
- list 的 native children（无记录）也返回 depth；status 从 session.get。
- message：验证 child.parentID===parentID（记录或 session.get），`messageChild(child, '[from parent '+parentID+'] '+text)`。
- cancel：验证归属，`abortChild`。
- result：验证归属；`submitted(child)` 优先；否则 `messages(child, 5)` 取最后 assistant text；status 同 list。

### 4.2 路由（inline，靠近 `/children`）

- `POST /api/sessions/:parent/subagents` body `{agent, description, prompt, background?, model?, outputSchema?}` → 200 `{id,parentID,depth,status}`；缺 prompt 400；parent 不存在 404；异常 500。
- `GET /api/sessions/:parent/subagents` → `{items}`。
- `POST /api/sessions/:parent/subagents/:child/message` `{message}` → 200 `{ok:true}`；非父子 404。
- `POST /api/sessions/:parent/subagents/:child/cancel` → 200 `{ok:true}`。
- `GET /api/sessions/:parent/subagents/:child/result` → `{status,structured?,text?}`。

不走 route-catalog（与 `/children` 一致，免 SDK/契约再生成）；工具直连 HTTP。

### 4.3 合成事件 + children depth

- SubagentService.spawn 后广播 `session.created`（canonical，带 info.parentID/depth）；桌面 `mapSessionLifecycleEvent` 已消费。
- `/api/sessions/:id/children` 返回值每项加 `depth = await depthOf(id)+1`；桌面 `children-snapshot` 透传 depth。

### 4.4 工具（插件 + pi）

- `mafw_spawn_subagent` args `{agent?, description?, prompt, background?, model?, outputSchema?}`；父 session = ctx.sessionID/sessionId；POST route；返回 child id/status。**异步**：不等待完成；提示用 result 工具取果。
- `mafw_message_subagent` args `{sessionID, message}`；POST message route。
- `mafw_subagent_result` args `{sessionID}`；GET result route；输出 structured/text/status。
- 插件工具加入 `V1_TOOLS`；pi 加入 `TOOL_DEFS`；annotations 加三条（非只读、非破坏）。
- 工具描述明确：opencode 原生 `subagent` 仍可用于前台；本工具用于 gateway 追踪/后台/pi。

### 4.5 桌面

- `SubagentRow.depth?: number`；`session-created`/`children-snapshot` 透传；默认 1。
- `SubagentDock`：显示 `depth` 缩进（`padding-left: 8 + depth*12`），并列出**后代**：`descendantRows(rows, activeSessionId)` 递归包含 child 的 children；只对当前会话的树。
- 纯函数 `descendantRows` + 测试；不改通知/终态。
- 可选：行 title 右侧显示 `background` 标记；暂不做。

## 5. 失败模式 / 风险

- 原生 subagent 无记录：list 从 runtime children 补；depth 计算需 parent 链，深链有缓存，缺失 fail-open depth=1。
- 子会话已删：session.get 抛错 → status aborted，不崩 list。
- prompt 失败：spawn 返回 500，但 child 已创建 → 记录 `failed` + 尝试 delete？v1 保留 child 供审计，标记 failed。
- 父/子归属伪造：message/cancel/result 必须验证 parentID；不信任 request body 的 parent。
- 并发 spawn：Map 写入原子同步；重名 child 不存在。
- outputSchema 注册：spawn 用 `sdkSession.promptAsync`（Batch 1 路径），不是裸 adapter；否则无 instruction。
- 广播 session.created 与 runtime 自带事件重复：tracker 按 childID 去重；Rail 的 hidden 过滤依赖 parentID，合成事件安全。
- 嵌套树：dock 只显示 tracker 已知后代；未打开过的孙代理在 children snapshot 中只有 direct，需父行先出现；接受渐进补全。

## 6. 验收

1. `POST /subagents` 创建 child（parentID/depth），child 实际回复；`GET list` 有记录/status/depth。
2. 桌面在 <2s 出现新子代理行（合成 session.created），depth 缩进；原 session/turn 事件不重复。
3. `message` 让 child 收到 `[from parent ...]` 并继续；`cancel` 使 child 进入 aborted。
4. `result` 在 child 结束后返回 structured（spawn 带 schema）或最后文本。
5. 原生 subagent（不走 spawn API）仍在 list/children 中出现（native merge）。
6. 工具：spawn/message/result 在插件与 pi factory 均可用；session id 来自 ctx，不接受模型伪造。
7. 单测：service（spawn/depth/status/归属/result）、routes、tools、tracker depth/descendants、children depth；全量不回归。
