# Batch 1 — 回合级结构化输出（outputSchema，Portable）Design

> 日期：2026-10-24 · 状态：已实施（Batch 1；commits `d2404f60` / `69034573` / `01be52f7` / `c8d2b5f6`）
> 上游：`docs/superpowers/specs/2026-10-23-batch0-21-parity-foundations-design.md` 之后的 Batch 1。

## 1. 意图与为什么

2.1 v2 的 `POST /api/session/{id}/prompt` **没有** `format` / `outputSchema` 字段（`OutputFormat` 只在遗留 v1 schema 里）。因此不能靠 adapter 一行透传；需要在 gateway 侧做一套 **runtime 中立** 的结构化输出通道：

- 模型通过工具 `mafw_submit_result` 交卷，gateway 用 JSON Schema 校验；
- 校验失败把具体错误返回给模型，模型在同一回合内自纠（in-turn retry）；
- 目标编排（plan/execute/review）优先消费已校验的结构化结果，文件产物保留为 fallback；
- 同步 `session.prompt()` 在终态后校验最终文本，失败可整回合重试（`retryCount`）；
- 后续 subagent / durable task 直接复用同一服务。

## 2. 目标 / 非目标

**目标**

1. `OutputSchemaSpec { name?, schema, retryCount? }` 进入 prompt 契约。
2. 新增工具 `mafw_submit_result`：opencode v1 插件 + pi runtime 工具面；调用 gateway `/api/structured/submit`。
3. JSON Schema 校验子集 + 错误路径（`$`、`$.waves[0].id`）。
4. 每次带 schema 的 prompt：注册 schema、在 prompt 尾部注入交卷指令（含 schema JSON）。
5. 同步 prompt：终态后校验文本，失败重试至 `retryCount`；返回 `structured` / `structuredError`。
6. 目标编排：plan/execute/review 各自 schema；`NodeDriver.completeNode` 优先用结构化结果，文件作为 fallback。
7. 可观测：`GET /api/sessions/:id/structured` 返回 spec/submitted/errors；无效提交计数。

**非目标**

- 不实现 2.1 原生 `format`（不存在于 v2 prompt）；不修改 opencode。
- 不做异步 prompt 的整回合自动重试（v1 用工具自纠 + goal 既有 attempt/watchdog；后续可加）。
- 不支持 `$ref` / 远程 schema；遇到时校验失败并明确报错。
- 不做结构化结果的专用 UI（先走事件/接口；桌面渲染留后续）。
- 不替换现有 goal 文件产物；结构化结果是并列门，不是唯一真相。

## 3. 契约

### 3.1 `OutputSchemaSpec`

```ts
export interface OutputSchemaSpec {
  name?: string;                 // 审计标签，如 'goal.plan'
  schema: Record<string, any>;   // JSON Schema（object 顶层；子集见 §4）
  retryCount?: number;           // 同步 prompt 失败后的整回合重试次数，默认 0，上限 3
}
```

- `SessionPromptOpts.outputSchema?: OutputSchemaSpec`（加法，缺省 = 现状）。
- `PromptResultEnvelope.structured?: unknown` / `structuredError?: string`。
- 同步 prompt 的 `structured` = 已校验通过的 data；`structuredError` = 重试耗尽后的最后错误。

### 3.2 工具 `mafw_submit_result`

参数：

```json
{ "type": "object", "properties": { "data": { "type": "object" } }, "required": ["data"] }
```

- 插件侧（opencode）用 `ctx.sessionID` 调 `POST /api/structured/submit {sessionID, data}`。
- pi 侧由 `runtime/mafw-tools.ts` 的 factory 注入 `sessionId`，同一 HTTP 出口。
- 成功：`{ ok:true, structured:true }`；失败：`{ ok:false, errors:[...] }`，工具返回 `isError`/失败文本，模型可在同回合重试。
- 工具说明明确：只有 prompt 里出现 `[MAFW STRUCTURED OUTPUT]` 时才调用。

### 3.3 HTTP

- `POST /api/structured/submit` `{sessionID, data}` → `{ok, errors}`（无 active schema → 400）。
- `GET /api/sessions/:id/structured` → `{name?, schema, submitted?, errors?, updatedAt}` 或 404。
- 路由进 route-catalog + wave1 handlers（契约可发现）。

### 3.4 Prompt 注入

在用户文本/最后一个 text part 之后追加：

```text
[MAFW STRUCTURED OUTPUT]
You must finish this turn by calling mafw_submit_result with a `data` object that conforms to this JSON Schema.
If validation fails, fix the data and call again. Do not rely on prose as the result.
Schema: <json>
```

目标节点 prompt 仍保留现有文件产物契约；schema 是额外硬门。

## 4. 校验子集

`gateway/src/runtime/json-schema.ts`，纯函数 `validateJsonSchema(schema, value): ValidationError[]`，错误含 `path` + `message`。

支持：

- `type`（string / array of string；含 `integer`、`null`）
- `properties`、`required`、`additionalProperties`（false / schema）
- `items`（schema；tuple 数组留后续）
- `enum`、`const`
- `minimum`/`maximum`/`exclusiveMinimum`/`exclusiveMaximum`/`multipleOf`
- `minLength`/`maxLength`/`pattern`
- `minItems`/`maxItems`/`uniqueItems`
- `anyOf`/`oneOf`/`allOf`
- `minProperties`/`maxProperties`

不支持：`$ref`、`$defs`、`patternProperties`、`dependentSchemas`、远程引用。遇到 `$ref` 返回明确错误（不静默放行）。

## 5. 流程

1. 调用方带 `outputSchema` 发起 prompt。
2. `SdkSessionResource` 调 `structuredOutput.register(sessionID, spec)`，把指令追加到 parts。
3. 模型在回合中调 `mafw_submit_result`。
4. `/api/structured/submit` 校验；失败返回 errors；成功存 `submitted`。
5. 回合结束：
   - 同步 prompt：`SdkSessionResource.prompt` 先看 submitted；没有则把最终文本去围栏后校验；失败按 `retryCount` 重发纠错 prompt；返回 `structured`/`structuredError`。
   - 异步 prompt：submitted 留在服务里；`GET /api/sessions/:id/structured` 可查。
6. Goal `completeNode`：先取 `structured`；存在则直接解析，跳过文件存在门；否则走现有文件解析。plan 的 `need_clarification`、execute 的 receipts、review 的 verdict 都按同一字段名消费。
7. 下一次带 schema 的 prompt 覆盖上一份；session delete 清理。

## 6. 失败模式 / 风险

- 模型从不调用工具：同步 prompt 走文本校验 + 重试；异步 goal 节点文件 fallback，文件也没有则现有 `artifact_missing` 失败。
- 工具调用早于 schema 注册（历史回放/重放）：返回 400 `no active output schema`，不污染。
- 同一 session 并发回合：schema 以 session 为键，后注册覆盖；Batch 1 接受（回合级并发在 2.1 inbox 下仍有限）。
- schema 很大：指令会膨胀 prompt；`retryCount` 默认 0，goal 节点按需 1；后续可做 schema 摘要/引用。
- 无效提交计数/错误文本可能很长：错误列表截断到 20 条、单条 300 字符。
- 目标节点同时写文件与交卷：以 structured 优先；文件仍保留供审计。
- `$ref`：直接报错，避免“看起来校验通过但实际没校验”。

## 7. 验收

1. 无 schema 的 prompt 行为不变。
2. 带 schema 的同步 prompt：模型交卷 → `structured` 返回且通过校验；非法 → 工具返回路径错误；重试耗尽 → `structuredError`。
3. 带 schema 的异步 prompt：`GET /api/sessions/:id/structured` 能看到 submitted/errors。
4. Goal plan 节点：`waves.json` 缺失但结构化交卷有效 → 节点成功；两者都缺 → `artifact_missing`。
5. Review 节点：结构化 `{verdict,feedback}` 直接驱动路由；文件 fallback 仍工作。
6. 测试：validator 单测、service/route 单测、插件工具/pi 工具单测、SdkSession prompt 重试、driver structured 优先；全量不回归。
