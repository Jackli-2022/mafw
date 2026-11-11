# Gateway E1 止血：缺陷修复设计（2026-11-11）

> 来源：三份评估（OS 忠实度 / gateway↔client 交互 / 资源台账）合并出的 58 项清单中的 **A 类 bug + 2 个 XS 级缺陷（C7/B17）**。E1 只修"已证实的错误行为"，不改契约、不做架构深化。

## 1. 意图

把 14 个**确定性缺陷**在最小改动内清零：每项都有可复现的失败测试，修复后行为与文档契约一致。E2+（恢复闭环/契约硬化/资源台账/交互模型）不在本 spec 范围。

**判定原则**
- 只修"行为与既定契约不符"或"无台账资源被静默破坏"的问题；
- 不引入新协议、不改响应信封、不迁移路由；
- 每项 = 一个 RED 测试 + 一个最小 GREEN 改动 + 一个 commit；
- 修不了的部分（需要身份模型/协议变更）明确记为后续波次，不在本波硬做。

## 2. 非目标

- A2（actorSessionID 缺省=人类）：这是**已声明的 audit-hint 契约**（`pod-collaboration.ts:5-6`），不是 bug；真正的修复属于 E5 身份闭环（per-client principal）。
- A7（11 个不可达 catalog op）：需要逐 op 决策（实现/代理/删除），属 E3 契约硬化。
- A13 完整形态（per-device 凭据）：E5；本波只做"停止明文存 token + 校验可用性"的最小止血。
- WS 总线化、快照+增量协议、错误信封统一等 B 类结构项。

## 3. 逐项设计（14 项）

### E1-1 实例锁心跳（A1）
- **问题**：`InstanceLock.heartbeat()` 存在但无生产调用点；stale 判定（pid 存活 + heartbeat>30s）会把活进程的锁判为可回收，且无 fencing。
- **改法**：`boot.ts` 启动后以 10s 间隔调用 `instanceLock.heartbeat()`（unref），shutdown 清理；`instance-ownership` 文档注释说明 fencing 属 E5。
- **验收**：假时钟测试——心跳持续写入后，锁文件 mtime ≤ 10s；停止心跳 >30s 后 `isStale` 为 true（保持现状判定）。
- **文件**：`gateway/src/boot.ts`、`gateway/src/runtime/instance-lock.ts`（注释）。

### E1-2 事件发布类型守卫（A3）
- **问题**：`POST /api/events` 接受任意 `type` 并写入 event_log → 可伪造 `mafw_event`/`turn.completed` 并被所有客户端回放。
- **改法**：发布路由拒绝"保留命名"——`mafw_event` 前缀、`EVENT_FLOW_MATRIX` keys、`MAFW_FLAT_EVENT_NAMES`、`sync`；只允许 `plugin:<pkg>:*`（合法插件命名空间）与显式白名单（若现有合法调用方存在，grep 确认后列白名单）。返回 400 `{error}`。
- **验收**：单测——`mafw_event`/`turn.completed`/`session.created` → 400 且不 append；`plugin:demo:custom` → 200 且 append 一次；`eventBus` 内部发布路径不受影响（不经过该路由）。

### E1-3 WS send 项目选择（A4a）
- **问题**：`/api/ws` 的 `send` 帧省略 `sessionID` 时，在**第一个注册项目**建会话（多项目错投）。
- **改法**：与 `promptAsync` 一致，用 `resolvedProjectDir()`（当前项目）；无项目时 400 而非落到任意项目。
- **验收**：单测——注册两个项目、当前=第二个 → 无 sessionID 的 send 在第二个项目建会话；无注册项目 → ws_error 且不建会话。
- **范围外**：delivery/idempotencyKey 对齐（E2 的 B15）。

### E1-4 goals.get 与 goals.control（A5/A6）
- **问题**：`GET /api/goals/:id` 命中 dashboard 的 `/api/goals` 前缀兜底，返回**列表**；`POST /api/goals/control` 同被遮蔽，控制指令静默失效。
- **改法**：
  - 新增真实 handler 注册 `goals.get`（shadow 条目已存在）：读 `findGoalStatePath`/`loadGoalState` 返回单个 `Goal` 形状（404 当不存在）。
  - `goals.control`：把 control handler 注册到 registry（`/api/goals/control` POST），其 body 逻辑复用 transport 的 control 分支（`handleControlAction` 提为可注入函数，transport 保留 `/control` 旧路径）。
  - dashboard 前缀兜底保留，但只服务其余未实现形状（`/api/goals/:id/loops` 等），不再吞精确对。
- **验收**：wiring 测试——GET `/api/goals/<id>` 返回单对象（含 goalId）；未知 id → 404；POST `/api/goals/control` 到达 control handler（fake 断言被调），`/control` 旧路径仍工作。

### E1-5 会话目录严格化（A8）
- **问题**：`session.create` 的 `directory` 缺失时静默用 `resolvedProjectDir` 兜底；违反 AGENTS"必填绝对路径"。
- **改法**：`routes/sessions-core.ts` 的 create：缺失/非绝对路径 → 400 `{error:'directory must be an absolute path'}`；worktree 路由同样不再 `path.resolve(opts.directory ?? '.')`。
- **风险控制**：先 grep 所有内部调用方确认都传绝对路径；runtime-core 的 `ctxProjectDir` 兜底**不动**（适配器兼容，E2 再收紧），只在 gateway API 层强制。
- **验收**：单测——缺失 → 400；相对路径 → 400；绝对路径 → 正常创建。

### E1-6 死配置清理（A9）
- **问题**：`maxMemoriesPerTier` 只存在于类型与 loader，零消费者。
- **改法**：从 `core/types/config.d.ts` 与 `config-loader.ts` 删除（若用户 config.yaml 里存在该键，ignored 不报错——loader 是否 strict 需确认，保持非 strict）。
- **验收**：loader 测试——旧配置含该键仍加载成功；类型层面 tsc 通过；全仓 grep 0 命中。

### E1-7 移动端双投递去重（A10）
- **问题**：同一 broadcast 经 `wsClients` 与 `PushGateway.onlineDevices` 各发一次（副本 timestamp 不同）。
- **改法**：`EventHub.broadcast` 跳过"已在线 WS 的设备"：PushGateway 只对不在 `wsClients` 的在线设备投递（或反之，选定 ws 为主通道、push 仅兜底）。保持 1 msg/s 限流不变。
- **验收**：单测——一个在线设备 socket + push 记录器：broadcast 后 push 端 0 次、ws 端 1 次；离线设备（有 device 记录无 socket）→ push 1 次。

### E1-8 TUI 边沿触发（A11）
- **问题**：`ConnectionStore.healthTick()` 每秒 `onState('ok')` → App 每秒重载 Experience + queue。
- **改法**：状态变更才回调（ok→ok 不触发；down→ok 触发一次）；healthTick 只更新内部心跳。
- **验收**：`npm run test:tui` 新增单测——连续 5 次 ok tick → onState('ok') 仅 1 次；down 后 ok → 再 1 次。

### E1-9 desktop SSE 单例竞态（A12）
- **问题**：`connectSse` 在 `await` 前检查 `es`，并发调用（onMount + gateway-ready）可双开。
- **改法**：模块级 in-flight Promise 守卫（或同步置位 flag 再 await），确保并发调用复用同一连接。
- **验收**：desktop 单测（`--conditions=browser`）——并发两次 connectSse 只创建一个 EventSource（fake 构造计数=1）。

### E1-10 设备 token 存储止血（A13 部分）
- **问题**：设备注册把网关 token 当 `fcmToken` 明文写入 `~/.mafw/mobile-devices.json`；hash 字段从不校验。
- **改法**：`devices-mobile.ts` 不再把原始 token 写入 `fcmToken`（仅存 `apiTokenHash`）；注册时若设备带 token 则校验 hash 一致（不一致 401）。既有文件读取保持兼容（fcmToken 字段保留但不再写入新值）。
- **验收**：单测——注册后 store 中无原始 token 字符串；hash 不匹配 → 401；旧记录（仅 fcmToken）读取不崩。
- **范围外**：per-device 凭据（E5）。

### E1-11 全局异常兜底（A14）
- **问题**：gateway 进程无 `uncaughtException`/`unhandledRejection` → 任意遗漏异常直死。
- **改法**：`index.ts` 启动时注册两者：log.error（含堆栈）→ `process.exitCode = 1` → 受控退出（`process.exit(1)`，由 supervisor 拉起）；不吞掉、不"继续运行"。
- **验收**：子进程测试——spawn `dist/index.js` 或测试注入点，触发 unhandledRejection，断言进程退出码 1 且日志含错误；不得挂死。
- **注意**：与 desktop managed 的退出码 75 约定区分（75 只用于自更新）。

### E1-12 Registry TTL patch 语义（C7）
- **问题**：`register()` 对 active 记录 `ttlMs ?? null` 覆盖——调用方传 `undefined` 会把已有 TTL 清成永不过期。
- **改法**：`undefined` = 保持现有 TTL；`null` = 显式永久；数字 = 覆盖。
- **验收**：单测——先注册 ttl=60s，再注册 ttlMs=undefined → TTL 仍 60s；ttlMs=null → 永久。

### E1-13 SSE 卫生（B17）
- **问题**：Mode A SSE 无 `: ping`/`retry:`/`X-Accel-Buffering`；全局 CORS 的 methods/headers 缺 PUT/PATCH/DELETE/Authorization。
- **改法**：`sse-attach.ts` 加 `retry: 3000`、15s `: ping`（unref，close 清理）、`X-Accel-Buffering: no`；`config.server.cors` 默认值补全方法与头（Authorization/X-API-Token）；显式配置优先。
- **验收**：单测——attach 后响应头含 `X-Accel-Buffering: no`；15s 内收到 ping（fake timer）；OPTIONS 对 PUT/PATCH/DELETE 返回 204 且 ACAO 头正确。

### E1-14 收口（docs + 全量门禁）
- `docs/architecture/gateway.md` 现状段补 E1 段落（心跳/守卫/TTL 语义/SSE 卫生）；`docs/releases/2026-11-11-gateway-e1-stabilization.md` 交付记录；
- 门禁：gateway `tsc -p` + jest 全量；`npm run test:tui`；`npm run test:desktop`；SDK contract 4/4；已知环境红名单照旧（node_modules 缺包，需在健康环境复核）。

## 4. 测试策略

- 严格 TDD：每个 E1-x 先写失败测试并**确认按预期失败**，再最小实现。
- 断言真实行为（fake deps 注入，不 mock 被测单元）；守卫类测试放 `tests/unit/architecture` 或对应域目录。
- 每项一个 commit，commit 信息含 `E1-x`。
- 跨包任务（TUI/desktop）用各自 runner：`npm run test:tui` / `npm run test:desktop`（后者单文件需 `--conditions=browser`）。

## 5. 风险

| 风险 | 缓解 |
|---|---|
| E1-5 目录严格化破坏既有调用方 | 先 grep 全部内部调用；只收紧 API 层；保留 runtime-core 兜底（E2） |
| E1-4 goals.control 改动 dispatch 顺序 | R6 死臂测试先补上（现状 200 列表），再实现；transport 顺序断言测试通过 |
| E1-11 退出策略影响 managed supervisor | 用退出码 1（非 75）；只对未捕获异常；文档注明 |
| E1-7 push 去重改变移动端行为 | 只去重在线双投；离线路径保持；单测钉两种路径 |
