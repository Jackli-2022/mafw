# Gateway E3 契约硬化：设计（2026-11-11）

> 来源：58 项清单中的 **A7 + B5/B6/B7/B8/B9**。目标：让"catalog = 可达面"可被测试证明；删除声明死亡的 Mode B；框架级错误带机器码；Experience 动作有路由绑定；版本握手可 opt-in 强制执行；核心读接口有 response schema。

## 1. 意图

E1/E2 修了行为与恢复；E3 修"契约层的不一致"：目录里有 11 个不可达 op、幽灵测试只查字符串、Mode B 声明死亡却仍在热路径、错误格式六种方言、动作描述符无绑定、318 ops 仅 11 个有 schema。**均不改变正常路径的响应形状**（错误仅增加字段；删除的都是不可达面）。

## 2. 非目标

- 不迁移 always-200 孤岛（dashboard/memory 旧语义保持；仅记录）。
- 不做全量 318 ops 类型化（仅 4 个读接口一个增量，建立机制）。
- 不引入请求级"强制"版本拒绝（仅：客户端主动携带 epoch 时校验；不携带则照旧）。
- 不发版/不改 SDK 主客户端语义（仅新增可选项与删除已死方法）。

## 3. 逐项设计

### E3-1 幽灵 catalog 清理 + 可达性守卫（A7）
- 删除 11 个不可达 op：`dashboard.costs`、`dashboard.alignment`、`dashboard.userAnswer`、`feedback.record`、`session.metrics`、`health.check`、`gateway.pause`、`gateway.resume`、`gateway.cancel`、`gateway.checkpoint`、`gateway.rollback`（实现仅在死模块 `src/dashboard/{api,server}.ts`，运行时从不实例化）。
- 删除死模块 `gateway/src/dashboard/`（含 server），确认无其他 import。
- 替换 `tests/unit/api-contract.test.ts` 的幻影断言（源码字符串出现）为**可达性守卫**：
  - catalog 每个 op 必须满足其一：`attachHandler('<id>'` 字面出现（含动态 attach 的 id 列表）→ attached；或在 `TRANSPORT_ALLOWLIST`（transport 手写分支：media.createTask/a2a.agentCard/media.artifact、health.root、goals.controlLegacy 等）；或在 `DASHBOARD_RESIDUE_ALLOWLIST`（R5 保留：goals.get/loops/loopsAt 由 dashboard 兜底? — 注意 goals.get 已在 E1 注册，从名单移除；仅保留真正由 dashboard catch-all 服务的形状）；或在 `RUNTIME_PROXY_ALLOWLIST`（session.command 由 serve 代理）。
  - 允许名单每项必须带一句 reason；测试断言"名单只减不增"由人工 review。
- 验收：删除后 `emit:openapi` 产物 307-11=296 ops；新守卫测试红→绿；`analyze-routes` 仍 0。

### E3-2 删除 Mode B（B7）
- 声明死亡（`chat-sessions.ts` 自述零消费者；SDK `subscribeToSession` 仅测试引用）。
- 删除：`events-sse.ts` 的 `?sessionID` 分支与 `chatSessions` dep；`runtime/event-dispatch.ts` 的 `modeBDelta` stage（24→23）与 `chatSessions` deps；`chat/chat-sessions.ts` 模块及测试；SDK `client.ts/types.ts` 的 `subscribeToSession` 及测试；catalog 中如有 Mode B 专属描述同步。
- 更新 event-dispatch 测试（stage 数量/名称断言）与 kernel 的 ctx 构建。
- 验收：全量测试绿；`/api/events?sessionID=x` 不再注册 per-session 流（按 Mode A 处理或忽略参数——保持向后兼容：忽略参数走 Mode A）。

### E3-3 框架级错误机器码（B6 增量）
- 新增 `gateway/src/core/http/api-error.ts`：`errorBody(message, code, retryable?)` → `{error, code, retryable?}`；constants：`unauthorized`、`forbidden`、`capability_unavailable`、`schema_epoch_mismatch`、`not_found`、`internal`。
- 应用点（仅框架边界）：transport 的 401/403/500、registry-dispatch 401、`capGuard` 503、E3-5 的 409。路由内业务错误保持原样（记录在文档：错误信封按层）。
- 验收：上述边界的响应含 `code`；既有 `error` 字符串不变；SDK 客户端不破坏（多字段容忍）。

### E3-4 Experience 动作绑定（B8）
- `ActionDescriptor` 增加 `operationId?: string`（可选，additive）。projector 为每个映射到 catalog 的动作填 operationId（建立最小映射表：有 route 的动作才填；无 route 的保留空）。
- 验收：`GET /api/experience/actions` 中至少 1 个 supported 动作带 operationId，且该 id 存在于 catalog（测试交叉断言）；无绑定动作不填。

### E3-5 版本握手（B5，opt-in）
- transport：所有响应加 `X-MAFW-Schema-Epoch: <schemaEpoch>`；若请求带 `X-MAFW-Schema-Epoch` 且与本地 `schemaEpoch` 不等 → 409 `{error,code:'schema_epoch_mismatch'}`（在 auth 之后、registry 之前）。
- desktop handshake 已有启动期校验，不改；SDK 不强制发送（后续波次可选）。
- 验收：带错配 header → 409 且 `code` 正确；不带 → 正常；响应头存在。

### E3-6 读接口 response schema 增量（B9）
- 为 4 个读 op 增加 response schema（沿用现有 schema 声明机制，参考 `session.list` 的 typed 方式）：`goals.get`（E1 形状）、`projects.list`、`presence`、`usage summary`（若形状稳定；不稳定则换 `stats`）。
- `emit:openapi` 后 openapi.json 对应 op 有 schema；`api-schema.gen.ts` 重新生成（若环境允许；否则记录并保证 contract 测试通过）。
- 验收：contract 测试断言这 4 个 op 在 openapi 中有 `responses.200.content` schema；SDK 类型编译通过。

### E3-7 收口
- gateway.md 现状段 + `docs/releases/2026-11-11-gateway-e3-contract.md`；全量门禁（gateway/SDK/desktop/TUI）+ 已知环境红记录。

## 4. 测试策略

TDD；可达性守卫是"结构性测试"（数据驱动：catalog × attach 扫描 × 三类 allowlist）；删除类任务先加"当前存在/当前被引用"的现状测试，再删除（红→绿以结构断言为主）。跨包：SDK 删除方法需同步 contract 测试。

## 5. 风险

| 风险 | 缓解 |
|---|---|
| 可达性守卫误杀动态 attach（pods/wave 循环） | 扫描器同时识别 `attachHandler('id'` 与 `attachHandler(<var>` 的注册表来源；以实测"catalog - attached = ∅"为目标迭代 |
| Mode B 删除影响未知外部调用方 | 仅忽略参数不报错；SDK 方法删除记入 release breaking 清单 |
| 409 版本拒绝误伤客户端 | 仅当客户端主动携带 epoch 才校验；不携带永远放行 |
| schema 增量改动 wire | 只加 schema 元数据，不改 handler 输出 |
