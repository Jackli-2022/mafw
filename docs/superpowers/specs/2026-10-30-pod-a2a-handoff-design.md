# Pod A2A Handoff 设计与路线图

日期：2026-10-30
状态：Approved（2026-10-30，用户确认“按推荐来，默认 A2A”）
上游：
- `docs/superpowers/specs/2026-10-29-project-pod-lite-design.md`（Pod 组织模型）
- `docs/superpowers/specs/2026-10-30-pod-desktop-panel-design.md`（桌面面板）
- `docs/research/2026-10-30-task-handoff-memory-boundary.md`（业界调研）

## 1. 意图

把「Leader 给 Worker 发任务消息」从**自由文本 + 只落库**升级为 **A2A 协议 handoff**：

- Leader 用 A2A `message/send` 把任务信息交给 Worker；
- Worker 在 prompt 里收到结构化任务（目标/验收/上下文/产物引用）；
- 任务状态、产物、回复走 A2A Task/Artifact 生命周期；
- Pod task 仍是权威，A2A 是协议层/互操作层；
- 长期记忆仍是 MAFW 谐波记忆，A2A 不承担记忆。

一句话：**A2A 负责“任务怎么交、怎么回、产物在哪”，Pod 负责“项目团队怎么组织”，谐波记忆负责“以后怎么想起来”。**

## 2. 目标 / 非目标

### 目标

- G1：一个 Pod 暴露标准 A2A Agent（AgentCard + JSON-RPC），外部/内部客户端可发现并发送任务。
- G2：`message/send` 创建/更新 Pod task + Pod message，并把 handoff 投递进 Worker prompt。
- G3：A2A TaskState 与 Pod task 状态双向映射，Pod task 为权威视图。
- G4：产物以 A2A Artifact 引用回传，不把大文件塞进消息。
- G5：投递幂等、可重放；长驻会话 push，NodeDriver node session pull。
- G6：Worker 的长期记忆行为不变（`mafw_add_memory` / `<recall>`）。

### 非目标

- N1：v1 不做 per-member AgentCard（一个 Pod 一个 Agent）。
- N2：不做公网 A2A 联邦/跨组织认证；v1 loopback-only。
- N3：不把 A2A Task 变成第二套任务状态机。
- N4：不把 A2A Message/Task 自动写进谐波记忆。
- N5：不做完整 mailbox UI 改造；桌面仍用 Pod 面板。
- N6：不做 A2A push notification webhook（v1 用 SSE/内部事件）。
- N7：不替换 Media Agent 的 `/a2a`；Pod 用独立路径。

## 3. 总体架构

```
A2A Client（Leader / 外部 agent）
   │  message/send (JSON-RPC)
   ▼
POST /a2a/pods/:podId
   │
   ▼
PodA2AAgent (AgentExecutor, @a2a-js/sdk)
   │  parts: text + data + file refs
   ▼
PodA2ABridge
   ├─ PodStore / PodTaskService   ← 权威任务状态
   ├─ PodMessageService          ← 消息/投递记录
   ├─ PodAccess                  ← 成员/actor 校验
   └─ PodMessageDelivery         ← prompt 投递
          ├─ coordination → promptAsync(queue)
          └─ plan/execute/review → 下一个 node prompt 注入 pending
```

### 端点

```
POST /a2a/pods/:podId                         A2A JSON-RPC
GET  /a2a/pods/:podId/.well-known/agent-card.json
GET  /a2a/pods/:podId/artifacts/:artifactId
```

- 与 Media Agent 的 `POST /a2a` 分开，避免 single-card 冲突。
- v1 base URL = `http://127.0.0.1:<port>/a2a/pods/<podId>`；AgentCard 放在该 base 下。
- 外部客户端通过 Pod id 发现；Pod id 不可猜（sha1 前缀 + 注册项目根）。

### 模块

| 文件 | 职责 |
|---|---|
| `gateway/src/core/pod/pod-a2a-agent.ts` | AgentCard、AgentExecutor、message/send、tasks/* |
| `gateway/src/core/pod/pod-a2a-bridge.ts` | A2A Message/Task ↔ Pod 服务；状态映射；幂等 |
| `gateway/src/core/pod/pod-a2a-artifacts.ts` | artifact 索引/路径校验/下载 |
| `gateway/src/core/pod/pod-message-delivery.ts` | push/pull/pending/idempotency |
| `gateway/src/routes/pod-a2a.ts` | HTTP 路由、版本头、错误映射 |
| `gateway/src/core/pod/pod-store.ts` | 新增 `pod_a2a_links` 表/方法 |

## 4. A2A 对象映射

| A2A | Pod |
|---|---|
| AgentCard | Pod 能力卡：roster、skills（handoff/status/memory-read）、streaming/push 能力 |
| Message | handoff/回复；`messageId` ↔ `PodMessage.id` |
| Task | 一次 Pod task 执行视图；`taskId` ↔ `pod_a2a_links.a2a_id` |
| contextId | `pod:<podId>:goal:<goalId>`（无 goal 时 `pod:<podId>`） |
| Artifact | Pod task 的产物引用；URL 指向 `/a2a/pods/:podId/artifacts/:id` |
| metadata | `podId/fromMemberId/toMemberId/podTaskId/goalId` |
| TaskState | 映射到 Pod task status（见 §5） |

### Message parts

```json
{
  "messageId": "msg_01...",
  "contextId": "pod:pod_x:goal:g_123",
  "role": "user",
  "parts": [
    { "text": "实现 wave 2 的登录限流" },
    { "data": {
        "podTaskId": "podtask_...",
        "goalId": "g_123",
        "title": "登录限流",
        "expectedOutput": "测试通过 + receipt",
        "contextRefs": ["docs/auth.md"],
        "artifactRefs": [],
        "acceptance": ["npm test 通过"],
        "budget": { "maxTurns": 8 }
    }},
    { "file": { "uri": "http://127.0.0.1:3000/a2a/pods/pod_x/artifacts/art_1" } }
  ],
  "metadata": {
    "podId": "pod_x",
    "fromMemberId": "m_lead",
    "toMemberId": "m_builder"
  }
}
```

- `kind:'request'` 才创建/更新 Pod task；`note/review/decision` 只写消息。
- `data` part 是机器可读；`text` 是给模型的主叙述；`file` 只放引用。
- 缺 `toMemberId` 默认广播（仅 Lead/coordination 允许）。
- `message/send` 允许 A2A 的两种正常返回：`kind:'request'` 返回 Task（长任务），`note` 等短消息返回 Message（即时确认）。

## 5. 状态映射（Pod 权威）

| A2A TaskState | Pod task status |
|---|---|
| submitted | pending |
| working | in_progress |
| input-required | blocked（等输入） |
| auth-required | blocked（等授权） |
| completed | done |
| failed | failed |
| canceled | failed/aborted（按来源） |
| rejected | failed/reopened（review 驳回） |

- Pod 的 `review` / `reopened` 是 Pod 语义；在 A2A `metadata.podStatus` 里保留，A2A 状态映射为 `working` / `failed`。
- `tasks/get` 从 Pod task 读取，不读独立 TaskStore。
- `tasks/cancel` 取消 Worker run/session，并更新 Pod task。
- `tasks/resubscribe` 桥接 `pod.updated` / session 事件为 A2A 流（v1 可先返回快照 + 短流）。

## 6. 数据模型

新增映射表（不复制状态）：

```sql
CREATE TABLE pod_a2a_links (
  id TEXT PRIMARY KEY,
  pod_id TEXT NOT NULL,
  local_kind TEXT NOT NULL,      -- 'task' | 'message'
  local_id TEXT NOT NULL,
  a2a_id TEXT NOT NULL,
  context_id TEXT,
  created_at TEXT NOT NULL,
  UNIQUE(pod_id, local_kind, local_id),
  UNIQUE(pod_id, local_kind, a2a_id)
);
```

`pod_messages` 增列：

```sql
protocol TEXT,                 -- 'pod' | 'a2a'
external_message_id TEXT,
parts_json TEXT,
delivered_at TEXT,
delivered_session_id TEXT,
read_at TEXT
```

- 迁移为幂等 `ALTER TABLE`（repo 无迁移框架）。
- `pod_tasks` 不新增状态列；通过 `pod_a2a_links` 关联。

## 7. 投递语义（PodMessageDelivery）

### 7.1 分流

| 收件人 | 策略 |
|---|---|
| coordination（Lead/Manager 长驻） | `promptAsync`，`delivery:'queue'` |
| plan / execute / review（NodeDriver session） | 不额外推 turn；下一次 node prompt 注入 pending handoff |
| 无 session | pending；绑定时重放 |
| busy 长驻 | 仍用 `promptAsync` queue；不要 steer 打断 |

### 7.2 幂等

- `(a2a messageId, sessionId)` 只投一次；
- `delivered_at` 在 prompt 接受后写；
- 失败保持 pending；
- 新 session 绑定只重放未投递，不重放已投递；
- 同一 `message/send` 重试返回原 Task/Message。

### 7.3 NodeDriver 保护

- node session 的 pending handoff 只在下一次 `podContext`/prompt 里注入；
- 不因为 handoff 额外产生 `turn.completed`；
- `tasks/cancel` 走 RunState/abort，不直接改 goal state。

## 8. 安全边界

- v1 `/a2a/pods/*` loopback-only；外部 A2A 接入需要 v2 认证。
- `message/send` 的 actor 必须映射到 Pod 成员；跨 Pod 403。
- `toMemberId` 必须属于该 Pod；广播仅 Lead。
- A2A 消息是**不可信输入**：不能携带权限批准、不能替代用户确认；工具调用仍走审批。
- Artifact 路径只允许 Pod 目录/项目目录白名单；拒绝 traversal。
- 消息内容写入 `pod_messages` 前做 secret redaction（复用 `redactSecrets`）。

## 9. 分阶段路线图

### P0：A2A 契约 spike（0.5 天）

- 用现有 `@a2a-js/sdk` + MediaAgent 模式跑一个最小 `PodA2AAgent`：
  - AgentCard 可发现；
  - `message/send` 返回 Task；
  - `tasks/get` 读 mock Pod task；
  - artifact URL 可下载。
- 产出：接口形状/版本头/错误码/AgentCard 路径结论。
- 不接生产 PodStore。

### P1：数据模型与映射（0.5–1 天）

- `pod_a2a_links` 表 + `pod_messages` 列；
- `PodStore` CRUD + 迁移；
- 单元测试：幂等、唯一约束、local/a2a 双向查找。

### P2：Bridge 核心（1–1.5 天）

- `PodA2ABridge`：
  - `message/send` → PodMessage/PodTask；
  - `tasks/get` → Pod task → A2A Task；
  - `tasks/cancel` → Pod task + run abort；
  - `artifactId` 映射。
- 单元测试：状态映射、幂等、权限、未知 task 404。

### P3：A2A Server + 路由（1 天）

- `PodA2AAgent`（AgentExecutor）+ AgentCard；
- `/a2a/pods/:podId` JSON-RPC、card、artifact 路由；
- 版本头 `A2A-Version: 1.0`；
- 路由测试：JSON-RPC 形状、错误映射、loopback。

### P4：PodMessageDelivery（1–1.5 天）

- push/pull 分流、pending 重放、幂等；
- NodeDriver prompt 注入；
- 测试：长驻 push、node pull、无 session 重放、重复消息只投一次、busy queue。

### P5：桌面/SDK/工具接线（0.5–1 天）

- Pod 面板显示 A2A task id / 投递状态 / 产物；
- `mafw_pod_message` 可走 A2A（或保留 REST，内部桥接）；
- SDK/preload 类型；
- E2E：Leader 发任务 → Worker prompt 收到 → 任务板更新 → 产物回传。

### P6：验证与文档（0.5 天）

- A2A client 集成测试；
- 全量回归；
- GUI 冒烟；
- AGENTS/research 更新。

### P7（可选，v2）

- per-member AgentCards；
- 外部 A2A 认证/公网；
- push notification webhook；
- A2A streaming 进度；
- A2A 与 MCP 的 tool/context 边界文档。

## 10. 验收

1. `GET /a2a/pods/:podId/.well-known/agent-card.json` 返回有效卡。
2. `message/send` 创建 Pod task/message；同 messageId 重试不重复。
3. Worker prompt 收到 handoff（coordination push / node pull）恰好一次。
4. `tasks/get` 与 Pod task 状态一致；`tasks/cancel` 生效。
5. Artifact 引用可下载，路径逃逸被拒。
6. 跨 Pod/非成员 403；未授权权限声明不被接受。
7. 不向谐波记忆写入任何 handoff 内容。
8. 现有 goal/node/task 测试不回归；NodeDriver 完成判定不受影响。
9. 桌面面板可见 A2A task/投递状态，原有 Pod 功能不回归。

## 11. 风险与缓解

| 风险 | 缓解 |
|---|---|
| 两套任务状态机 | Pod task 权威；A2A 只做视图/映射 |
| NodeDriver 多出 turn | node session 用 pull，不 push |
| 消息重复投递 | `(messageId, sessionId)` 幂等 + delivered_at |
| 消息丢失 | pending + 绑定时重放 + 409/错误可见 |
| A2A 路由与 Media `/a2a` 冲突 | 独立 `/a2a/pods/*` 路径 |
| Artifact 路径逃逸 | 白名单 + realpath 校验 |
| Prompt injection / 权限冒充 | 消息标记为 agent 来源；审批不因消息放行 |
| 外部暴露 | v1 loopback-only；v2 认证 |
| 协议版本漂移 | 固定 `@a2a-js/sdk` 版本 + A2A-Version 头 + 契约测试 |

## 12. 已确认决策（2026-10-30）

| 决策 | 选择 |
|---|---|
| Agent 拓扑 | **v1 一个 Pod 一个 A2A Agent**；`metadata.toMemberId` 路由；per-member card 留 v2 |
| Task 权威 | **Pod task 权威**；A2A Task 是视图 |
| 外部暴露 | **v1 loopback-only**；公网/外部认证留 v2 |
| 投递策略 | **coordination push + NodeDriver node pull**；不向 node session 额外 push turn |
| A2A 范围 | 只做 task/handoff/artifact；**不做 memory** |
| `mafw_pod_message` | **默认走 A2A**；A2A 不可达/旧 gateway 时回退 REST，并记录 `protocol` |
| Artifact 位置 | `~/.mafw/pods/<podId>/artifacts/`；URL 经白名单 + realpath 校验 |
| `tasks/resubscribe` v1 | 快照 + 短流（sticky `pod.updated` 事件），完整 SSE 留 v2 |

## 13. 开放问题（不阻塞 v1）

- per-member AgentCard 的认证模型（v2）。
- 外部 A2A 客户端是否需要独立 API token/AgentCard 认证（v2）。
- A2A streaming 进度是否复用现有 `pod.updated` 还是新增 task delta（v2）。
- Pod task `review/reopened` 在 A2A metadata 的最终命名（v1 用 `metadata.podStatus`）。
