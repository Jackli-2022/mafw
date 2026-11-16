# Gateway E10j 交互与版本协商补齐交付记录（2026-11-16）

- 版本：gateway 4.16.1 / SDK 5.1.0 / desktop 5.1.0（**无版本号变更**；mobile 1.1.0+2 不变）
- 性质：E10 三层契约（请求 / 200 / 错误体）闭合后，补两处**可执行**缺口，均为客户端 / 渲染层：
  ① **TUI triage 改渲染真实 wire** —— 删掉已退役的 phantom `reason` / `goalId` / `severity`；
  ② **SDK 自动 schema epoch 协商**（`MafwClientOptions.schemaEpoch?: number | 'auto'`），desktop 与 TUI
  opt-in `'auto'`，gateway 升级后两端**自动重新协商**，不再静默按旧契约说话。
  **gateway 代码 / wire / 路由集合（327 ops / 293 paths）/ schema 台账零变化**（本波 gateway 零代码改动）；
  SDK 类型面只增一个可选字段。另把三项**明确 won't do** 写进决策（见 §4）。
- spec：`docs/superpowers/specs/2026-11-16-gateway-e10j-interaction-version-design.md`
- plan：`docs/superpowers/plans/2026-11-16-gateway-e10j-interaction-version.md`
- 架构现状：`docs/architecture/gateway.md` §「E10j 交互与版本协商补齐（2026-11-16）」+
  §「残余（E11 后仍 deferred）」；`docs/architecture/tui.md`、`docs/architecture/desktop.md`
  §「自动 schema epoch 协商」、`docs/architecture/mobile.md` §7.11
- 证据：`.superpowers/sdd/2026-11-16-gateway-e10j/{progress.md,J1-report.md,J2-report.md,
  gateway-jest.log,desktop-test.log,tui-jest.log,mobile-test.log}`
- TDD：每批先写失败断言 → 红 → 最小实现 → 一个 commit（J1 纯函数 6 条、J2 SDK 11 条 + 两处 opt-in 行为各 1 条）

## 波次与提交

- 分支：`feat/gateway-e10j-interaction-version`（worktree `.superpowers/e10j-worktree`）
- 基线：`3ede5a5a`（E10j spec + plan）

| commit | 任务 | 一句话 |
|---|---|---|
| `428653cb` | E10j-J1 | `fix(tui)`: 新纯函数 `ui/triage-view-model.ts#triageView(t)` + `triage-tab.ts` 改渲染真实 wire（6 条纯函数测试），不带 pi-tui 依赖 |
| `21e4b850` | E10j-J2 | `feat(sdk)`: `MafwClientOptions.schemaEpoch?: number \| 'auto'`（响应学习 + 409 刷新重试一次）；desktop `createGatewayClient` / TUI `createTuiClient` opt-in；SDK +11 / desktop +1 / TUI +1 测试 |
| 本记录 | E10j-J3 | `docs(gateway)`: 架构现状（gateway / desktop / tui / mobile）+ 本记录 + 全量门禁（docs-only） |

## 1. TUI triage 对齐真实 wire（J1）

真实磁盘记录（`~/.mafw/triage/*.json`）只有
`{ id, automationId, discoveredAt, source, summary, proposedGoal?, state, userAction, deadline,
llmSuggestions?, updatedAt? }`；`reason` / `goalId` / `severity` / `createdAt` **没有写出者**。

- `packages/tui/src/ui/triage-view-model.ts`（new，纯函数、不 import `pi-tui`、不 import `store`）：
  - title：`proposedGoal.title` → `summary.title`（仅 string，trim 后非空）→ `id`；
  - meta：`source · discoveredAt · 截止 deadline`，缺失 / 非法日期**静默省略**（永不打印 `Invalid Date`）；
  - badge：`state` 三态（`PENDING_CONFIRMATION→待确认` / `CONFIRMED→已确认` / `REJECTED→已拒绝`）+
    `llmSuggestions` 中**最高 priority** 条目的 `建议确认` / `建议拒绝` 后缀；
  - tone：neutral / warn / danger（颜色只由 tone 决定，不自造 severity 调色板）。
- `packages/tui/src/ui/triage-tab.ts`：列表行渲染 `[badge] title meta`，Enter 详情显示
  title / state / meta；approvals 区块（`[A] question goalId`）**不动**——那是 approval 的真实字段。
  布局、`handleMouseClick` 行映射、键位（`a/r/c/d/Enter`）逐字不变。
- 测试：`packages/tui/tests/triage-view-model.test.ts` **6 条**（title 回退 / 日期合法与非法 / 三态 badge /
  最高 priority 后缀 / phantom 字段不泄漏）；`mouse.test.ts` / `triage-store.test.ts` 夹具改成真实 wire 形状
  （断言不变）。
- 与桌面 `triage-model.ts` 的差异（有意）：桌面 title 还回退 `summary.skillDraft.name` /
  `summary.axiomDraft.name`，spec §1 未要求，TUI 直接回退 `id`；要完全对齐可后续扩 `titleOf`。

## 2. 自动 schema epoch 协商（J2）

transport 早已双向实现（`X-MAFW-Schema-Epoch` / 409 `schema_epoch_mismatch`，auth 之后、registry 之前），
但**没有任何客户端发送该头**——协商只有一半，gateway 升级后客户端静默沿用旧契约。J2 把另一半放进 SDK：

| 模式 | 请求头 | 响应 epoch | 409 行为 | 语义 |
|---|---|---|---|---|
| 未配置 | 从不发 | 忽略 | 原样抛 | 旧行为（向后兼容） |
| `number: N` | 恒发 `N` | 忽略（永不改写） | 原样抛 | 钉死契约 |
| `'auto'`，尚未学到 | 不发 | 缓存 | 无 epoch → 抛；带 epoch E → 采用并**重试一次** | 首次协商 |
| `'auto'`，已知 `E` | 发 `E` | 有数字就缓存 | 响应 epoch `F !== E` → 采用 `F` 重试一次；`F === E` / 无 / 非数字 → 抛 | 重新协商 |

- 请求头合并顺序：`Content-Type` → `options.headers` → `clientToken` → **schema epoch** → 调用点 headers
  （`buildHeaders()` 单一出口；重试用同一 path/init 重新构造头）。
- **重试上限 1 次**，无循环；第二次仍 409 直接抛。重放的请求在 transport 的 header 校验处就被拒，
  **不达 handler**（不产生第二次副作用）。
- `fetchPath`（SSE / 二进制 / 媒体流 / 裸 `Response`）**不带头、不重试**——与 `clientToken` 同规则；
  所以 SSE 订阅维持「不发头 = 放行」，不会因 epoch 漂移反复重连。
- 判定是**状态码 + 响应 epoch 与已知值不同**，不解析 body 的 `code`（`httpError()` 需要读流）；
  代价：极少数非 epoch 的 409 若恰带不同 epoch 会被重试一次（同 path/init，至多一次额外请求）。
- opt-in：desktop `src/main/human-token.ts#createGatewayClient`（唯一 client 构造入口，
  `mafw-ipc.ts` / `mafw-sidecar.ts` 都经它）与 TUI `src/store/human-token.ts#createTuiClient`。
  桌面 409（契约漂移）与 `withHumanTokenRetry` 的 403 + `human_principal_required`（凭据轮换）是
  两条互不重叠的通道，各自最多重试一次。
- 已知边界：gateway metadata 未加载时响应不带 epoch（`schemaEpoch === null`），`'auto'` 无从学习，
  请求保持无头（放行），409 原样上抛——这个窗口内不自愈。

## 3. 行为变化 / Breaking

- **gateway wire / 路由 / handler / schema 台账：零变化**（本波无 gateway 代码改动）。
- **SDK 类型面：additive**（`MafwClientOptions.schemaEpoch?`）；未配置的调用方行为逐字不变。
- **desktop / TUI**：发出的 JSON 请求在学到 epoch 后多一个请求头；epoch 漂移时会多发一次重试请求。
- **TUI 显示层**：triage 行与详情不再出现 `severity` / `reason` / `goalId` 文案，标题 / 时间 / badge
  改为真实字段（这是用户可见的修正，不是回归）。

## 4. 明确 won't do（本阶段定案）

1. **mobile 工作 tab 的任务 / 消息级增量 patch**：work overview 只有整页快照一个接口，没有
   「按 goal 取 task/message 增量」的端点；为局部 patch 新增端点属**新 API 设计**。现行一致性策略
   （flat 帧带 `goalId` → 只替换该 Goal 卡；其余变化 15s 全量兜底）已够用（`mobile.md` §7.11）。
2. **`tts.speakStream` 的响应 schema**：wire 是 `text/event-stream`（PCM16 分块事件），不是 JSON；
   OpenAPI 3.1 投影只描述 JSON content，硬塞会宣称一个假的 `application/json` 体。错误面已由 E10i 覆盖。
3. **500 / 502 / 408 / 415 显式状态**：与 `default`（`ErrorEnvelope`）同形，属实现故障面；
   逐 op 展开只是 description 噪声。

## 5. 验证（worktree @ `21e4b850` + J3 docs）

| 门 | 命令 | 结果 |
|---|---|---|
| gateway 类型 | `npx tsc --noEmit -p tsconfig.json`（`gateway/`） | **0 errors** |
| gateway 全量 | `npx jest --runInBand --forceExit --no-coverage`（`gateway/`） | **7675 tests（7663 passed / 9 failed / 3 skipped）**；suites **3 failed / 1 skipped / 946 passed（949 of 950）**；**9 条红全在 3 个已知 env-red suite**，零契约红；646.8s |
| 覆盖率台账 | `npm run schema:coverage` | **responses 320/327（97.9%）**；**write responses 194/195（99.5%）**；**requests 189/195（96.9%）**；**errors: default 327/327 + explicit 157（356 条：400×124 / 404×78 / 409×54 / 413×6 / 429×3 / 503×91）** —— 与 E10i 逐字相同 |
| 路由分析 | `node scripts/analyze-routes.cjs` | **`TOTAL 0 (match 0, equals 0)`** |
| 契约产物新鲜度 | `npm run emit:openapi`（gateway）→ `npm run gen:api`（SDK） | **327 routes → 293 paths / 327 operations**，overrides 命中 **10**；两次运行 `git status` 无生成物 diff |
| SDK 类型 | `npx tsc --noEmit -p tsconfig.json`（`packages/gateway-sdk`） | **0 errors** |
| SDK 全量 | `npm test` | **237 / 237 passed（0 fail）**（基线 226，本波 +11） |
| SDK contract | `node --import tsx --require ../../packages/test-shim/require-hook.cjs --test src/contract.test.ts` | **4 / 4 passed** |
| desktop 全量 | `npm run test:desktop`（worktree root） | **3875 tests / 736 suites（3874 passed / 1 failed / 0 skipped）**；唯一红 = `src/main/mafw-gateway-resolver.test.ts` dev-path（worktree 未构建 `gateway/dist`，已知 env-red） |
| desktop 类型 | `npx tsgo --noEmit -p tsconfig.json`（`packages/desktop`） | 只剩已知 `node:tls` **2 条**（`getCACertificates` / `setDefaultCACertificates`） |
| mobile 定向 | `flutter test test/pod_models_test.dart test/triage_card_model_test.dart` | **31 / 31 passed**（exit 0） |
| mobile analyzer | `flutter analyze`（`mobile/`） | **No issues found（0）** |
| TUI 纯函数 | `node --test tests/triage-view-model.test.ts` | **6 / 6 passed** |
| TUI human token | `node --test tests/human-token.test.ts` | **9 / 9 passed**（基线 8，本波 +1） |
| TUI 全量 | `node --test "tests/*.test.ts"` | **208 tests（188 passed / 19 failed / 1 skipped）** —— 19 条红全部 `ERR_MODULE_NOT_FOUND: @earendil-works/pi-tui`（env-red，与 J1 前一致） |
| kernel-split 守卫 | jest `tests/unit/architecture/kernel-split-guards.test.ts` | **7 / 7 passed（1 suite）** |
| runtime-contract | `node --test "src/**/*.test.ts"`（`packages/runtime-contract`） | **24 / 24 passed**；`npm run test:contract` 仍红于 `TS5023 rewriteRelativeImportExtensions`（wrapper 用 hoisted tsc 5.6.3，该包零改动） |

## 6. 新增测试（对基线 `3ede5a5a` 的增量）

| 文件 | 基线 → 终值 | 增量 | 依据 |
|---|---|---|---|
| `packages/tui/tests/triage-view-model.test.ts` | 0 → **6**（new file） | **+6** | J1 纯函数：title 回退 / meta 日期 / 三态 badge / 最高 priority / 无 phantom 泄漏 |
| `packages/gateway-sdk/src/client.test.ts` | 226 → **237** | **+11** | J2：首请求无头 → 缓存 → 次请求带头；409 刷新重试一次；同值 409 不重试；数字模式恒带；未配置不带头；`fetchPath` 不带不带重试 |
| `packages/desktop/src/main/human-token.test.ts` | 26 → **27** | **+1** | 端到端：`createGatewayClient` 的 `'auto'` 在真实 SDK client 上生效（epoch 回声 fake fetch） |
| `packages/tui/tests/human-token.test.ts` | 8 → **9** | **+1** | 同上（TUI `createTuiClient`） |
| gateway | 7675 → 7675 | **0** | 本波 gateway 零代码改动 |

**本波新增可执行 test case：19**（6 + 11 + 1 + 1）。

## 7. 已知红（非本波代码问题）

1. **gateway env-red 9 条 / 3 suites**：`tests/integration/plugin-package-e2e.test.ts`（npm staging 解析
   `@mafw/plugin-contract`）、`tests/unit/runtime/claude-adapter-acceptance.test.ts` /
   `claude-adapter-coverage.test.ts`（esbuild 在未预构建 worktree 解析不到
   `@anthropic-ai/claude-agent-sdk`）——与 E10e–E10i 同一集合。
   gateway 基线测试数比 E10i 记录的 7669 高 6：E10i 后合入的 4 个 gateway 修复（`362235bd` /
   `0065a111` / `e82fe1dd` / `7c11bffb`）带的用例，不是本波增量。
2. **desktop 1 条环境红**：worktree 未构建 `gateway/dist` → `src/main/mafw-gateway-resolver.test.ts` dev-path。
3. **desktop 类型 `node:tls` 2 条**：hoisted `@types/node` 缺 `getCACertificates` /
   `setDefaultCACertificates`（既有噪声）。
4. **TUI env-red**：`@earendil-works/pi-tui` 未安装 → 19 条 `ERR_MODULE_NOT_FOUND`；triage-tab 级渲染
   只能靠纯函数 + 夹具覆盖，`tsc --noEmit` 也有 pi-tui 相关诊断（J1 报告逐条列出）。
5. **`npm run test:contract`（`packages/runtime-contract`）** 仍红于 `TS5023
   rewriteRelativeImportExtensions`（wrapper 的 tsc 5.6.3 vs 5.7+ 选项），该包零改动，`node --test` 24/24。
6. **worktree 依赖解析缝隙**：root `node_modules/@mafw/sdk` 指向**主 checkout** 的 SDK（旧 `dist`）。
   J2 重建了本 worktree 的 SDK `dist` 并加了两条 gitignored 的 `packages/{desktop,tui}/node_modules/@mafw/sdk`
   junction，否则 opt-in 是 excess-property 类型错、自动 epoch 用例必红。正常 `npm install && npm run build`
   或合并后的主 checkout 无此问题。

## 8. Deferred（本波后仍保留）

- **强制版本协商**（gateway 拒绝未携带头的客户端）与 **SDK 全量 schema 类型化**：
  协商的客户端侧已由 J2 收口，gateway 仍是「只校验主动携带的头」的 opt-in 语义。
- **mobile 工作 tab 的任务 / 消息级增量 patch**、**`tts.speakStream` 响应 schema**、
  **500 / 502 / 408 / 415 显式状态**：本波定为 won't do（理由见 §4）。
- **TUI triage 与 desktop 的完整对齐**（`summary.skillDraft.name` / `axiomDraft.name` 回退）：
  spec §1 未要求，留作后续。
- **TUI 整包门禁**：需要安装 `@earendil-works/pi-tui` 才能使审查 `triage-tab.ts` 级渲染的用例转绿；
  本波按 spec 不装依赖。

## 9. 与 spec / plan 的差异（有意 deviation）

1. spec §2 写「收到 409 + `schema_epoch_mismatch`」才处理；实现按**状态码 409 + 响应 epoch 不同于已知值**
   判定（不解析 body，避免与 `httpError()` 争抢响应流）。副作用最多一次额外请求，见 §2。
2. spec §1 的 badge 描述为「state + 最高 priority 后缀」：实现还带 `建议确认` / `建议拒绝` 动作词
   （与桌面 badge 同构，信息量更高），文档已按实现记录。
3. TUI title 回退比桌面少两级（`skillDraft` / `axiomDraft`），见 §1 末。
