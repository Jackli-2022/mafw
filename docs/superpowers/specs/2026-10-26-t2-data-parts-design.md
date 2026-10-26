# T2-3 类型化 data part（AI SDK 6 语义）Design

> 日期：2026-10-26 · 状态：草案（待 builder check）
> 上游：`docs/superpowers/specs/2026-10-22-contract-gap-research/06-gap-synthesis.md` §3 Tier 2「data part 类型化自定义数据」
> 事实源：AI SDK 6 data parts（`data-<name>` + `id` 调和 + `transient` 不入历史）

## 1. 意图

`MafwPart` 是封闭枚举 + 透传兜底：usage/plan 是特权内置，上层应用（插件、宿主适配器、工具卡）无法把**自有结构化数据**挂进消息流并渐进更新。research 判断：开放 `data-{name}` 变体可让工具卡/泳道图/自定义 UI 直接受益，且与 AI SDK 6 语义对齐。

本批：**data part 全链**——canonical 类型 + 网关注入 API + 非 transient 持久化 overlay（历史出口合并）+ 同 id 调和 + transient 只广播 + 桌面/会话 UI 通用数据卡。**不迁移** plan/usage（保留现有事件通道）。

## 2. 现状（2026-10-26 侦察）

- `MafwPart`（`gateway/src/runtime/canonical-types.ts`）已有开放透传变体 `{type: string; [k:string]:unknown}`——data-* 结构上已可通过，缺的是**命名类型、校验、注入面与渲染**
- 历史 egress：`/api/sessions/:id/messages` → `toWireHistory`（flat→wire，parts 引用直通）；数据只来自 runtime 消息存储
- 直播：`part.updated` canonical 事件 → 桌面 `applyPartUpsert` **已按 part.id 替换**（同 id 调和天然成立）
- 桌面渲染：`session-ui` 的 `PART_MAPPING[part.type]` 精确查表；未知类型（含 `data-*`）被跳过 → 需动态前缀回退
- 无任何 data part 注入/存储/渲染代码（grep 零命中）

## 3. 目标

1. canonical `DataPart`：`{ type: 'data-<name>', id, data, transient?, sessionID?, messageID?, native? }`
2. `POST /api/sessions/:id/data` 注入（name/id/data/transient/messageID 可选），广播 `part.updated`
3. 非 transient 落 `session_data_parts` overlay 表；历史出口按 messageID 合并；同 id upsert 渐进更新
4. transient 只广播、不入库、不进历史（重载即消失）
5. `session-ui` 通用数据卡：名称徽标 + JSON 视图 + transient 标记；`data-*` 前缀回退渲染
6. SDK/preload：`session.data(...)` + `DataPart` 类型
7. 限额：name `[a-z0-9][a-z0-9_-]{0,31}`；data JSON ≤64KB；id 缺省生成 `data_<uuid>`

## 4. 非目标

- 不迁移 `plan.updated`/`usage.updated` 等现有特权 part（后续批次可迁）
- 不为每个 name 定义 schema（v1 通用 JSON；专用卡后续注册）
- 不做 data part 检索/观察/记忆回流（transient 语义天然排除）
- 不做删除/过期（overlay 随消息删除级联；会话删除清理）
- 不映射 runtime 原生自定义 part → data-*（透传兜底已够）

## 5. 设计

### 5.1 Canonical 类型（gateway + SDK 镜像）

```ts
export interface DataPart extends MafwPartBase {
  type: `data-${string}`      // name 从类型后缀解析（AI SDK 同款）
  data: unknown               // 任意 JSON 值
  transient?: boolean         // true = 仅直播，不入历史
}
// MafwPart union 追加 DataPart（在开放透传变体之前，保留透传兜底）
export const DATA_PART_PREFIX = 'data-'
export function isDataPartType(type: string): type is `data-${string}`
export function dataPartNameOf(type: string): string | null   // 校验 name 正则
```

- 结构守卫 `isMafwPart` 保持宽松（id+type string）——data-* 已合法；新增 name 校验只在**注入入口**执行
- `event-field-contract`：data-* 不要求 text/tool 字段（已按 type 分支，无新增）

### 5.2 Overlay 存储（gateway.db `session_data_parts`）

```sql
session_id TEXT NOT NULL,
id TEXT NOT NULL,               -- **session 作用域**：最终 id = `data_<归一化 body.id 或 uuid>`
message_id TEXT NOT NULL,
type TEXT NOT NULL,             -- data-<name>
data_json TEXT NOT NULL,
created_at TEXT NOT NULL,
updated_at TEXT NOT NULL,
PRIMARY KEY (session_id, id)
-- INDEX (session_id, message_id, created_at)
```

- **id 命名空间（builder #1）**：body.id 允许 `[A-Za-z0-9._:-]{1,64}`；存储/广播 id 统一加 `data_` 前缀（未带则加），与 runtime part id（`prt_`/`msg_...-pN`）不可能碰撞；同 body.id → 同最终 id（调和稳定）
- `upsertSessionDataPart(row)`：`INSERT ... ON CONFLICT(session_id,id) DO UPDATE SET data_json/type/updated_at`
- **禁止跨消息移动（builder #4）**：同 id 已存在且 message_id 不同 → 409（不静默改归属）
- `listSessionDataParts(sessionId, messageIds?)`；`deleteSessionDataParts(sessionId)`
- 修剪（builder #6）：写入后每会话保留最新 200 行（删除最老）；消息级 revert 的孤儿不可见（历史合并按现存消息 id 过滤），不做级联删除；**取消 §4/§6 的"随消息删除级联"表述**
- transient=true 注入时**删除**同 id 持久行（transient 覆盖旧持久值，避免重载复活旧数据——builder #5）

### 5.3 注入 API

```
POST /api/sessions/:id/data
body { name, id?, data, transient?, messageID? }
→ 200 { part: DataPart }
```

- 校验：name 正则；`data` 必须可 JSON 序列化且 `JSON.stringify(data).length ≤ 65536`；`transient` 布尔；`messageID` 必须是本会话的 **assistant** 消息（builder #3：user 消息不渲染 parts，会造永久不可见行）——缺省取最新 assistant；无 assistant → 400
- `id` 归一化见 5.2；同 id 改 messageID → 409
- 非 transient → overlay upsert；transient → 删除同 id 持久行 + 不落库
- 广播 `mafwBroadcast({type:'part.updated', properties:{part}, sessionID})`（复用既有词汇，零新增事件）
- 能力门：无（sessionApi 足够）；路由挂 wave1（catalog `session.data`）；鉴权沿用 wave1 现状（builder #7：同一 dispatch 在 token 门之前，属既有架构债，不在本批修）

### 5.4 历史合并（`/api/sessions/:id/messages`）

- 取回 runtime 消息 → `toWireHistory` 后，查询本页消息 id 集合的 overlay 行
- 按 `message_id` 分组，**追加**到对应消息 `parts`；若 parts 里已有同 id（runtime 原生 data part）→ runtime 优先，overlay 跳过
- overlay 消息不在本页窗口 → 忽略（不合成消息）
- 顺序：overlay 行按 created_at 追加在 runtime parts 之后
- `loadOlder`（before 分页）同样生效
- 会话删除：`deleteSessionDataParts`

### 5.5 直播与调和

- `part.updated` 载荷 part 含 `messageID`、`id`、`type`、`data`、`transient`
- 桌面 `applyPartUpsert` 已按 id 替换；data part 无 text 特殊吸收（仅精确 id）
- **不置忙（builder #2）**：`sse/handlers/chat-stream.ts` 的 part.updated 分支对 `data-*` 跳过 `setSessionStatus(busy)`/`phase(writing)`——离线注入不得把空闲会话钉在 busy
- **transient 生命周期（builder #5）**：turn 终态时桌面清理该会话的 transient data part；会话切换/重新加载历史时同样清理（历史只从 overlay 恢复持久行）
- 重载历史时 transient 消失（未入库）；非 transient 由 5.4 恢复

### 5.6 渲染（session-ui）

- `parts-rules.ts` / `session-turn` 可见性：`data-*` 视为可见（有 data）
- `message-part.tsx`：`PART_MAPPING[type] ?? (isDataPartType(type) ? DataPartCard : undefined)`
- `DataPartCard`：
  - 头部：`data` 徽标 + name（去前缀）+ transient 标记
  - 主体：JSON 美化（`JSON.stringify(data, null, 2)`），最大高度 ~240px 滚动，超长截断标记
  - 空 data → `（空数据）`
  - 无交互控件（v1 只读）
- 样式沿用现有 `--font-data`/`--bg-inset` 类；新增少量 class

### 5.7 SDK / preload

```ts
export interface DataPart { id; type: `data-${string}`; data: unknown; transient?: boolean; sessionID?; messageID? }
session.data({ path:{id}, body:{ name, id?, data, transient?, messageID? } }): Promise<{part: DataPart}>
```
preload 同步 `window.api.mafw.sessions.data(sessionID, body)`。

### 5.8 测试

- canonical：isDataPartType/name 校验；守卫接受 data-*；非 data 拒绝
- DB：upsert 同 id 更新、list 按 created_at、会话删除
- 路由：name/data 校验、64KB 限额、缺省 messageID、transient 不落库、非 transient 落库+广播载荷
- 历史合并：分页内合并、同 id runtime 优先、窗口外忽略
- 桌面：reducer 同 id 替换 data part；session-ui 渲染可见性/JSON 截断（纯模型）
- 真机冒烟：注入非 transient → 历史出现；同 id 二次注入 → 值替换不重复；transient → 直播可见、重载消失

## 6. 风险

| 风险 | 处置 |
|---|---|
| 数据体积撑爆消息/SSE | 64KB 上限 + 历史合并截断（>64KB 行跳过并日志） |
| name/type 伪造 | 仅 `data-` 前缀；name 正则；id 统一 `data_` 命名空间 |
| overlay 与 runtime 消息删除不同步 | 会话删除清理；revert 孤儿不可见（合并按现存消息 id 过滤）；每会话 200 行修剪（不追消息级级联） |
| transient 误入历史 | 注入路径显式分支 + 同 id 持久行删除 + 桌面终态/切会话清理 |
| 桌面未知 data-* 被跳过 | PART_MAPPING 前缀回退 + 可见性规则（assistant 路径） |
| 跨消息移动 | 409 禁止（同 id 固定归属） |

## 7. 我的裁量

- v1 通用 JSON 卡，不做 per-name UI（注册表留后续）
- 不迁移 plan/usage
- 64KB / name 32 字符 / id 命名空间与生成规则
- transient 不落库也不参与观察/记忆；终态/切会话清理
- overlay 不做独立 GET API（历史合并即读路径）；不做删除 API
- id 跨消息移动禁止；revert 孤儿不级联（不可见 + 200 行修剪）
- 鉴权沿用 wave1 现状（已登记架构债）
