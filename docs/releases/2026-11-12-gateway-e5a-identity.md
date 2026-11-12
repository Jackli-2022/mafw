# Gateway E5a 身份闭环交付记录（2026-11-12）

## 波次

- 分支：`feat/gateway-e5a-identity-closure`（worktree `.superpowers/e5a-worktree`）
- 基线：`54f8e78d`（main，E5a spec/plan 落库时点）
- 范围：A2（human-only 判定）+ A13（per-device 凭据）+ 客户端凭据接线 + 收口 E5a-6
- spec：`docs/superpowers/specs/2026-11-12-gateway-e5a-identity-closure-design.md`
- plan：`docs/superpowers/plans/2026-11-12-gateway-e5a-identity.md`
- 架构现状：`docs/architecture/gateway.md` §「E5a 身份闭环（2026-11-12）」
- TDD：每项先写失败测试 → 最小实现 → 一个 commit；批证据见
  `.superpowers/sdd/2026-11-12-gateway-e5a-identity/{progress.md,batch1-report.md,batch2-report.md,batch3a-report.md,batch3b-report.md}`

## 提交

| commit | 任务 | 一句话 |
|---|---|---|
| `1abf3643` | E5a-1 | `core/human-token.ts` + principal 模型（`resolvePrincipal`/`isHumanPrincipal`/`humanOnlyDenied`）+ transport/WS 挂载 `mafwPrincipal` + kernel 启动加载 human token |
| `cbaddf0c` | E5a-2 | pod accept / review-items / decision 变更 / standing-goal 批准改判 `principal.kind === 'human'`；actorSessionID 检查保留 |
| `9557182e` | batch1 review | `redactLog` 覆盖 human/device 头与 `dev_…`；registry principal allowlist；WS voice 401 矩阵；human token 原子写 + 数据根创建；反向代理剥凭据头；`authorizeWsUpgrade` 废弃 |
| `d23cf927` | E5a-3 | `DeviceStore` 凭据（sha256 at rest / 轮换 / 撤销 / 旧记录兼容）+ pairing v2（URL 无 token）+ verify 发 `dev_` token + 设备列表脱敏 |
| `39d700c5` | batch2 review | 撤销时 terminate 在线 WS；pairing-verify body 8192 上限（413）；`rotate:true` 语义（409 不消费 nonce）；失效设备头回退到共享 token；凭据 lastSeen ≤1 写/小时；id/name/platform 边界 |
| `4445e101` | E5a-4 | SDK `clientToken`/`headers`；desktop/TUI 主进程 `readHumanToken()` + 统一 client 入口 |
| `48a5b2f1` | batch3a review | `createGatewayClient`/`createTuiClient` 单入口；fake-fetch 断言真实注入；`clientToken` trim；`fetchPath` 不带 token/base headers |
| `b8dbf228` | E5a-5 | mobile `pairing_link` v2/v1、`device_identity` 稳定 deviceId、`pairing_flow` verify 换 token、后台 WorkManager 凭据镜像 |
| `38f2b525` | batch3b review | 重配对 rotate 与 baseUrl 解耦 + 409 重试；PairingPage 编排测试；缺凭据 fail-closed；15s 超时 + 错误文案；deviceId 128 边界 |
| `458b4bf4` | E5a-6 | 架构/release 收口（docs-only） |
| `71df4462` | E5a-6 | 修正 gateway tsc 门禁口径（docs-only） |
| `2c416a95` | final review | `GET /api/mobile/pairing-code` 要求 human principal（堵住 service/local → nonce → device token 越权）；路由矩阵 + transport 端到端 |
| 本次 docs 同步 | final review | release / 架构 / ledger 同步（docs-only） |

## 交付项

- **A2（human-only 真闭合）**：`core/auth.ts` 统一 principal：
  `human`（human token / device token）、`service`（共享 `server.apiToken`）、`local`（loopback 无凭据）、
  `anonymous`。解析顺序 human → device → apiToken → loopback → anonymous，全部常数时间比较；
  失败/畸形一律 fail-closed。human-only 路由（accept、review-items create/resolve/reopen、
  decision confirm/shelve/reopen、goal-runs approve、mobile pairing-code）只认 `kind === 'human'`，
  403 `{ error:'human principal required', code:'human_principal_required' }`；
  `actorSessionID` 仍作为审计字段并继续 403。
- **A13（per-device 凭据）**：配对码 v2 `orcalore://pair?url&v=2&exp&nonce` 不含网关凭据；
  `POST /api/mobile/pairing/verify` 消费一次性 nonce 后发 `dev_` + 32B base64url token，
  `DeviceStore` 只存 `sha256(token)` 与 `tokenIssuedAt`；`Authorization: Bearer dev_…` /
  `X-MAFW-Device-Token` 认证为 `human`+`deviceId`；删除设备即撤销并断开在线 WS；
  同 deviceId 重签发即轮换（旧 token 立即失效）；legacy 记录仍可列出/推送但不能作为 human 凭据。
- **human token**：固定 `~/.mafw/human.token`（64 hex、原子写、POSIX 0600 best-effort、稳定复用）；
  kernel 启动加载，失败 `log.warn` + 空串 fail-closed。desktop/TUI 主进程读取并经 SDK
  `clientToken` 注入，token 不进 renderer/preload/插件 web/日志。SDK 合并顺序
  `Content-Type → options.headers → clientToken → 调用点 headers`，SSE/二进制路径不带 token。
- **配对 v1 兼容**：v1 链接仍解析（要求内嵌 token）；旧 App 手动 url+token 回退保留。

## 行为变化 / Breaking

1. **human-only 判定收紧（breaking，按安全修复）**：过去「没带 `actorSessionID`」即被视为人类；
   现在必须持 human token 或 device token。service/local（含 agent、MCP、自动化、旧移动共享 token）
   一律 403 `human_principal_required`。普通 API 的 loopback / 共享 token 三通道与 401 语义逐字不变。
2. **旧 desktop/TUI 无 human token → human-only 动作 403**：随本波发布的 desktop/TUI 已读取同一文件；
   未更新客户端只影响验收/审批类动作。
3. **移动端配对 breaking**：网关只发 v2 链接（无 token），旧 App 无法解析；
   旧 App 用共享 token 仍可普通 API，但 human-only 需重新配对拿 `dev_` token。
   v2 gateway 必须与支持 v2 的 mobile 同批发布。
4. **重配对需要显式 `rotate:true`**：`deviceId` 已有凭据且未带 `rotate` → 409
   `{code:'device_already_paired'}`（nonce 不消费，可重试）；`rotate:true` 替换凭据并使旧 token 失效。
5. **撤销语义**：`DELETE /api/mobile/devices/:id`（及 legacy `/api/devices/:id`）删除条目并 terminate
   该设备的在线 WS；`revokeDeviceToken` 只清凭据、保留推送注册。
6. **新增错误 `code` / 413**：human-only 403 增加 `code`；pairing-verify body > 8192 B → 413
   `payload_too_large`（其余路由不变）。
7. **Additive**：`MafwClientOptions.clientToken/headers`、设备记录 `deviceName`、human-only 403 `code`；
   反向代理剥离两个凭据头（不对 agent backend 外溢）；`MAFW_HUMAN_TOKEN_FILE`（desktop/TUI 仅读取端的
   路径覆盖，供测试/隔离 dev 使用，不是网关配置键，生产仍固定 `~/.mafw/human.token`）。
8. **契约面无变更**：无 catalog 增删；重生成 `emit:openapi`（315 routes → 281 paths / 315 operations）
   与 `merge-contract.mjs` 内容无 diff（工作区仅 CRLF→LF 归一化，已还原）。
9. **配对码生成 human-only（安全修复，final review F1）**：`GET /api/mobile/pairing-code` 需要
   human token（desktop/TUI 已带）或 device token；`service`（共享 apiToken / agent / MCP）、`local`
   （旧 desktop/TUI 未升级、未读 human token）与 anonymous 一律 403 `human_principal_required`，
   且拒绝发生在调用 pairing service 之前（不耗限频）。这堵死「service 铸 nonce → 未认证 verify
   → device token → human-only」的提权链。旧客户端只影响配对，普通 API 不受影响。

## 安全说明

- **凭据卫生**：human token 32 字节随机 hex，`.tmp` + `fsync` + `rename` + `chmod 0600`（Windows 依赖用户目录 ACL）；
  格式不合法自动重生成。device token 只存 sha256，比较常数时间；列表/注册响应剥离
  `deviceTokenHash`/`apiTokenHash`。
- **日志**：human/device 头、`Bearer …`、`?token=` 与任意 `dev_…` 一律脱敏；不泛化 64 hex。
- **外溢**：反向代理剥 `x-mafw-human-token` / `x-mafw-device-token`；SDK 只在 JSON `request()` 注入。
- **威胁模型**：human token 与 gateway 同 OS 用户，本机恶意进程可读；本波防的是
  **agent/自动化误调用、误审批被当成人类**，不是本机隔离。共享 apiToken 仍是全权 service 凭据（未轮换）。
- **失败模式**：human token 不可读 → human-only 403（普通 API 正常）；DeviceStore 损坏 → 设备凭据全部失效（重新配对）。

## 验证（worktree @ E5a-6 文档改动后；final review 复验见末行）

| 门 | 命令 | 结果 |
|---|---|---|
| gateway 类型 | `node node_modules/typescript/bin/tsc --noEmit -p tsconfig.json`（`gateway/`，gateway-local TS 5.9.3） | **0 errors**；根 `node_modules/typescript`（5.6.3）会报 16 条 pre-existing TS1479，非门禁命令（见已知红 #2） |
| gateway 全量 | `node ../node_modules/jest/bin/jest.js --runInBand --forceExit --no-coverage --json`（`gateway/`） | **6900 tests：6889 passed / 9 failed / 2 skipped**；**880 suites：876 passed / 3 failed / 1 skipped**（3 个均为已知 env-red；基线同命令 **6745 / 6735 / 9 / 1**，873 suites，失败集合相同 → **+155 tests**，无 E5a 失败） |
| SDK 类型 | `node ../../node_modules/typescript/bin/tsc --noEmit -p tsconfig.json`（`packages/gateway-sdk`） | **0 errors** |
| SDK 全量 | `node --import tsx --require ../../packages/test-shim/require-hook.cjs --test "src/*.test.ts"` | **229/229 passed** |
| SDK contract | 同上 `--test src/contract.test.ts` | **5/5 passed** |
| runtime-contract | `node ../../gateway/node_modules/typescript/bin/tsc -p tsconfig.test.json` + `node --test "src/**/*.test.ts"` | typecheck **0 errors**（TS 5.9.3）；**24/24 passed** |
| desktop | `npm run test:desktop`（worktree root） | **3517 tests：3460 passed / 57 failed**；基线 `54f8e78d` 同命令 **3503 / 3446 / 57** → **+14 tests，失败数不变**（同一批 pre-existing renderer/wiring 红） |
| desktop 类型 | `node node_modules/@typescript/native-preview/bin/tsgo.js --noEmit -p tsconfig.json`（`packages/desktop`） | **3 errors**：`src/main/index.ts` `node:tls` `getCACertificates` / `setDefaultCACertificates` ×2、`SubjectPicker.tsx` `world` ×1（全部 pre-existing；无 `clientToken` 报错） |
| TUI 测试 | `npm run test:tui` | **env-red**：`@earendil-works/pi-tui` 未安装（`ERR_MODULE_NOT_FOUND`，主 checkout 同样）；新增 13 个 touched 测试全部通过 |
| TUI 类型 | `node ../../node_modules/typescript/bin/tsc --noEmit -p tsconfig.json`（TS 5.6.3） | **69 errors**：21 × TS2307 `@earendil-works/pi-tui` + 级联 TS7006/TS2339 + 1 × TS5023（`rewriteRelativeImportExtensions` 需 TS ≥5.7）；无 `clientToken` 报错 |
| mobile 定向 | `flutter test test/pairing_link_test.dart test/device_identity_test.dart test/pairing_page_test.dart test/push_service_test.dart test/secure_config_test.dart test/ws_auth_test.dart` | **97 passed / 0 failed** |
| mobile 全量 | `flutter test` | **393 passed / 40 failed**，失败全为 4 个未触碰 widget 套件的 `did not complete`（flake，见「已知红」）；隔离运行 `direction_question` **26**、`lead_handoff` **20**、`reconnect_refetch_pages` **5**、`goal_composer` **14** 全绿 |
| mobile analyzer | `dart analyze lib test` | **No issues found**（0） |
| 路由扫描 | `node scripts/analyze-routes.cjs`（`gateway/`） | **TOTAL 0 (match 0, equals 0)** |
| kernel-split 守卫 | `jest tests/unit/architecture/kernel-split-guards.test.ts` | **7/7 passed** |
| 契约产物新鲜度 | `npm run emit:openapi`（`gateway/`）+ `node scripts/merge-contract.mjs`（SDK） | **内容无 diff**（281 paths / 315 operations；仅 CRLF→LF 工作区归一化） |
| final review 定向复验 | `node node_modules/jest/bin/jest.js tests/unit/routes/devices-credentials.test.ts tests/unit/routes/devices-mobile-wiring.test.ts tests/unit/core/ tests/unit/http/ --no-coverage --runInBand --forceExit`（`gateway/`） | **42 suites / 372 passed / 1 skipped / 0 failed**（exit 0） |
| final review 类型 | `node node_modules/typescript/bin/tsc --noEmit -p tsconfig.json`（`gateway/`，gateway-local TS 5.9.3） | **0 errors**（与上表同口径，未变） |

## 新增测试（对基线 `54f8e78d` 的增量）

| 面 | 新增 | 依据 |
|---|---|---|
| gateway | **+163** | 15 个改动测试文件：HEAD 232 例 vs 基线 69 例（7 个新文件 146 例 + 既有文件 +17 例；新文件：`human-token` 9、`principal` 28、`principal-auth` 23、`human-only-guards` 36、`device-store-credentials` 18、`pairing-v2` 5、`devices-credentials` 34；final review 新增 `pairing-code` 矩阵 6 + 端到端 1 + wiring 1） |
| SDK | **+12** | 217 → 229（`client-token.test.ts` + types） |
| desktop | **+14** | 3503 → 3517（`human-token.test.ts`、`human-token-wiring.test.ts`） |
| TUI | **+9** | `app-wiring` 4 → 5，新增 `human-token.test.ts` 8 |
| mobile | **+47** | 定向六文件 97 vs 基线同集 50；新增 `pairing_link_test` 12、`device_identity_test` 5，既有文件 +30 |

> 计数口径：均为可执行 test case 数（含 1 个 win32 skip 的 gateway 特例），不是断言数。

## 已知红（非本波代码问题）

1. **gateway 已知 env-red（9 tests / 3 suites，基线同红）**：`integration/plugin-package-e2e`
   （模拟 Desktop node_modules 的 `@mafw/plugin-contract` staging 失败）、
   `claude-adapter-acceptance` / `claude-adapter-coverage`（`@anthropic-ai/claude-agent-sdk` 缺失，
   esbuild 解析失败）。基线 `54f8e78d` 全量运行 = 同样 3 个 suite / 9 个 test。
2. **根 tsc（5.6.3）假红，非门禁**：用根 `node_modules/typescript` 跑 gateway 会报 16 条
   pre-existing TS1479（`@a2a-js/sdk` / `jose` / `@huggingface/transformers` 的 ESM-only 形态
   与 CJS 目标冲突，`vector-index` / `pod-a2a-*` / `media-agent` / `gliner-engine`）；
   gateway-local `node node_modules/typescript/bin/tsc`（5.9.3）为 **0 errors**，基线同。
   附带：给 jest 加 `--experimental-vm-modules` 会让 `@a2a-js/sdk` 在 7 个 suite 里
   `exports is not defined`——标准门禁命令不带该 flag，返回 0 个此类失败。
3. **desktop 57 个 pre-existing 失败**：renderer CSS/组件漂移（`workbench-shell-css`、`workbench-shell-wiring`
   等引用未落地组件/CSS 片段）。基线 `54f8e78d` = 3503 tests / 3446 pass / **57 fail**，HEAD = 3517 / 3460 / **57**，
   失败集合同批（本波零 renderer 改动）。
4. **TUI**：`@earendil-works/pi-tui` 未安装在本地 `node_modules`，全量 `test:tui` 与 `tsc`
   均因此红（主 checkout 可复现）；touched 两个测试文件 13/13 通过。
5. **mobile 全量 flake**：Windows `flutter test` 并发 widget 套件偶发 `did not complete`（旋转文件集：
   `direction_question` / `lead_handoff` / `reconnect_refetch_pages` / `goal_composer`），隔离单跑全绿；
   本波多次观测 393–417 pass / 7–55 fail 波动，静息基线也复现，属 runner flake。
6. **runtime-contract tsc PATH 怪癖**：`npm run test:contract` 的 `typecheck:test` 直接调 `tsc`，
   本机 PATH 上无 tsc（root 5.6.3 也不支持 `rewriteRelativeImportExtensions`）；
   用 `gateway/node_modules` 的 TS 5.9.3 显式执行 → 0 errors，测试 24/24。

## Deferred（明确不在 E5a 范围）

- **E5b**：C1 `event_log` 恢复源与 mobile 游标/幂等消费（本波只做身份，不动回放）。
- **E6**：desktop 单点扇出 / 单一实体缓存 / 事件→增量补丁 / mobile 增量。
- **其余 human gate**：计划批准（plan-approval）、triage、Lead 边界、permission approvals 仍可被
  service/local 调用；未纳入本波（需要人审语义与 UI 一起设计）。
- **MCP**：不提供 human 工具（验收/批准只走 HTTP）；`mafw_*` 工具集不变。
- **deviceName 来源**：移动端传 `Platform.localHostname`，无用户可编辑的设备名；列表展示为尽力值。
- **孤儿 v1 记录**：历史设备条目（无 `deviceTokenHash`）不会被自动清理，仅能列出/推送/重新配对。
- **WS deviceId 查询串**：`main.dart` 的 `WsClientV2` 仍未传 `?deviceId=`；设备 token principal 生效后
  由 principal 覆盖，但旧共享 token 连接仍依赖 query（未接线）。
- **human token 加固**：OS keychain / 进程签名 / per-owner fencing（同 OS 用户威胁模型见架构文档）。
- **`authorizeWsUpgrade`**：仅标 `@deprecated`，未删除（测试/旧调用方仍引用）。
