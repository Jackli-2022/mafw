# T2-3 类型化 data part 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** data-`<name>` part 全链：canonical 类型 + 注入 API + 非 transient overlay 持久化与历史合并 + 同 id 调和 + transient 纯直播 + 通用数据卡。

**Architecture:** `session_data_parts` overlay 表（session 作用域 id）由 `DataPartService` 写入；注入路由广播 `part.updated`；历史出口用纯函数把 overlay 行合并进 wire parts；桌面按 id upsert、data-* 不置忙、transient 在终态清理；session-ui 加前缀回退的数据卡。

**Spec:** `docs/superpowers/specs/2026-10-26-t2-data-parts-design.md`

## Global Constraints

- 版本 `v4.39.0`；push/发布需确认。
- additive only：不改 plan/usage/canonical 既有 part 语义；data-* 走透传兜底之外的新命名类型。
- id 统一 `data_` 前缀（session 作用域）；name `[a-z0-9][a-z0-9_-]{0,31}`；data ≤64KB。
- 只允许 assistant 消息承载；同 id 跨消息 → 409；transient 删同 id 持久行。
- 每会话 200 行修剪；会话删除清理 overlay。
- 桌面 part.updated 对 data-* 不置忙；transient 在 turn 终态/切会话清理。
- 路由挂 wave1（鉴权位置沿用现状，已登记架构债）。

## Review Focus

1. **id 作用域与碰撞**：同 body.id 在两会话互不影响；最终 id 恒有 `data_` 前缀（不与 runtime part id 撞）。
2. **part.updated 置忙副作用**：离线注入不得把空闲会话钉在 busy/working。
3. **user 消息承载**：缺省取最新 assistant；user/foreign messageID → 400。
4. **transient 生命周期**：不落库、同 id 持久行删除、终态/切会话清理、历史不复活。
5. **历史合并一致性**：只合并窗口内现存 assistant 消息；runtime 同 id 优先；分页（before）同样生效。

---

### Task 1: canonical 类型与校验工具

**Files:** `gateway/src/runtime/canonical-types.ts`、新建 `gateway/src/core/data-parts/data-part.ts`、`gateway/tests/unit/data-parts/data-part.test.ts`

**Interfaces:**
```ts
export const DATA_PART_PREFIX = 'data-'
export function isDataPartType(type: string): boolean            // ^data-[a-z0-9][a-z0-9_-]{0,31}$
export function dataPartNameOf(type: string): string | null
export function normalizeDataPartId(raw?: string): string         // data_<sanitized> | data_<uuid>
// uuid 由注入 deps 提供，normalize 接受 idFactory
export function isDataPart(part: any): part is DataPart
// MafwPart union 增加 DataPart（type `data-${string}`, data: unknown, transient?: boolean）
```

- [ ] 测试：合法/非法 name；id 前缀幂等；`isDataPart` 接受/拒绝；union 编译。
- [ ] 实现 → 跑绿 → commit `feat(data-parts): canonical data part + validation utils`。

---

### Task 2: overlay 表与方法

**Files:** `gateway/src/memory/gateway-db.ts`、`gateway/tests/unit/gateway-db-data-parts.test.ts`

**Interfaces:**
```ts
export interface SessionDataPartRow { session_id; id; message_id; type; data_json; created_at; updated_at }
upsertSessionDataPart(row): void      // ON CONFLICT(session_id,id) DO UPDATE data/type/updated_at
getSessionDataPart(sessionId, id): SessionDataPartRow | undefined
listSessionDataParts(sessionId, opts?: { messageIds?: string[] }): SessionDataPartRow[]
deleteSessionDataPart(sessionId, id): void
pruneSessionDataParts(sessionId, keep: number): number   // 最新 keep 行
deleteSessionDataParts(sessionId): void
```

- [ ] 测试：upsert 同 id 更新；两会话同 id 隔离；messageIds 过滤；prune 保最新；会话删除。
- [ ] 实现 → 绿 → commit `feat(data-parts): session_data_parts overlay table`。

---

### Task 3: DataPartService

**Files:** 新建 `gateway/src/core/data-parts/data-part-service.ts`、测试 `gateway/tests/unit/data-parts/data-part-service.test.ts`

**Interfaces:**
```ts
export class DataPartError extends Error { constructor(public status: number, message: string) }
export interface DataPartServiceDeps {
  db: {...Task2 methods...}
  runtime(): { session: { messages(o): Promise<{data:any[]}> } } | null
  broadcast(e: any): void; now(): string; newId(): string
}
create(input: { sessionID; name; id?; data; transient?; messageID? }): Promise<DataPart>
// 1 name/id/data/64KB 校验；2 取 messages(limit:200) 找 assistant 目标（显式须命中 assistant，否则 400/404）
// 3 同 id 已有持久行且 message_id 不同 → 409
// 4 transient → delete 同 id 持久行；否则 upsert + prune(200)
// 5 part = {id, type:`data-${name}`, data, ...(transient?{transient:true}), sessionID, messageID}
// 6 broadcast({type:'part.updated', properties:{part}, sessionID}); return part
```

- [ ] 测试覆盖 Review Focus 1/3/4：id 作用域、assistant 目标、user/foreign 400、transient 删持久行、同 id 跨消息 409、64KB、prune。
- [ ] 实现 → 绿 → commit `feat(data-parts): DataPartService (validate/persist/broadcast)`。

---

### Task 4: HTTP 路由 + catalog + wave1

**Files:** 新建 `gateway/src/routes/session-data.ts`；`route-catalog.ts`（`session.data`）、`wave1-handlers.ts`；`gateway/tests/unit/routes/session-data.test.ts`

**Interfaces:** `POST /api/sessions/:id/data` body `{name,id?,data,transient?,messageID?}` → `{part}`；`DataPartError.status` 透传；其它 500；非匹配返回 false。

- [ ] 路由测试（mock service）：200/400/404/409/500、query 容忍、non-match。
- [ ] 实现 + catalog + wave1 + emit-openapi + gen:api → 绿 → commit `feat(data-parts): POST /sessions/:id/data`。

---

### Task 5: 历史合并

**Files:** 新建 `gateway/src/core/data-parts/merge.ts`、`gateway/src/index.ts`（messages 路由）、`gateway/tests/unit/data-parts/merge.test.ts`

**Interfaces:**
```ts
export function mergeDataPartsIntoWire(wire: Array<{info:any; parts:any[]}>, rows: SessionDataPartRow[]): void
// 按 message_id 分组；只对 wire 中现存消息追加；同 id 已存在（runtime）→ 跳过；
// data_json 解析失败 → 跳过该行；顺序 created_at asc；原地修改 wire（引用语义）
```
- messages 路由：`wireData` 后查询 `listSessionDataParts(id, {messageIds: wire 的消息 id})` → merge；`loadOlder` 同一路径自动生效。
- [ ] 测试：追加、同 id runtime 优先、窗口外忽略、坏 JSON 跳过、分页窗口。
- [ ] 实现 → 绿 → commit `feat(data-parts): merge overlay into history egress`。

---

### Task 6: SDK + preload

**Files:** `packages/gateway-sdk/src/types.ts`、`client.ts`、`client.test.ts`；`packages/desktop/src/preload/mafw-api.ts`、`mafw-types.ts`

**Interfaces:** `DataPart` 类型；`session.data({path:{id}, body:{...}}): Promise<{part: DataPart}>`；preload `sessions.data(sessionID, body)`。

- [ ] client 测试（method/path/body/返回）→ 实现 → SDK 绿 → commit `feat(sdk): data part injection surface`。

---

### Task 7: 桌面 + session-ui 渲染

**Files:** `packages/desktop/src/renderer/mafw/sse/handlers/chat-stream.ts`（data-* 不置忙）、`sse/chat-reducers.ts`（`clearTransientDataParts`）、`ChatPane.tsx`（切会话/turn 终态清理调用）、`packages/session-ui/src/components/parts-rules.ts`、`message-part.tsx`、新建 `components/data-part.tsx`、测试

**Interfaces:**
```ts
// chat-reducers
export function clearTransientDataParts(state, sid): { part } | null   // 删除 type data-* 且 transient 的 part
// session-ui
export function isDataPartType(type: string): boolean
export function DataPartCard(props: { part: any }): JSX
// visibility: parts-rules/session-turn 对 data-* 返回可见
// message-part: PART_MAPPING[type] ?? (isDataPartType(type) ? DataPartCard : undefined)
```
- 卡片：name 徽标 + transient 标记 + JSON pretty（≤240px 滚动，>8KB 截断）。只读。
- ChatPane：sid 变化与三终态时调用 clear（store 信号更新）。
- [ ] reducer/纯模型测试 + session-ui 可见性/渲染（渲染测试若成本高则纯模型 + SSR render）。
- [ ] 实现 → desktop 全量 + tsgo + build → commit `feat(desktop): data part card + transient cleanup`。

---

### Task 8: 收尾

- [ ] 全量矩阵（gateway/SDK/TUI/desktop/session-ui）+ 根 build。
- [ ] 版本 4.39.0 + AGENTS 条目（Batch 11/T2-3：commits、测试计数）。
- [ ] 真机冒烟 `gateway/scripts/smoke-data-parts.mjs`：
  1. 会话跑一轮（产出 assistant 消息）
  2. 注入非 transient data part → 历史 GET 出现
  3. 同 id 二次注入 → 值替换、无重复
  4. transient 注入 → 直播 part.updated 收到；重载历史不出现
  5. user messageID → 400；跨消息同 id → 409；>64KB → 400
- [ ] 部署 + 冒烟 → 汇报（不 push）。
