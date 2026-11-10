# 2026-11-10 · Gateway 内核 D3 启动/内核/HTTP 拆分（boot-kernel）

- **分支**：`feat/gateway-kernel-d3-boot-kernel`（stacked on **未合并**的 D2 `feat/gateway-kernel-d2-event-dispatch` @ `42c78685`）
- **计划**：`docs/superpowers/plans/2026-11-10-gateway-kernel-d3-boot-kernel.md`
- **设计**：`docs/superpowers/specs/2026-11-09-gateway-kernel-microkernel-design.md`
  §3 / §5.1 / §5.5 / §7（验收按 §7 字面执行，见 D3-R1）
- **过程记录**：`.superpowers/sdd/2026-11-10-gateway-kernel-d3-boot-kernel/`
  （`progress.md` 台账 + `task-3/6/7/8/9-report.md`）

## 交付内容

`gateway/src/index.ts` **8120 行 → 33 行**；类名仍是 `MafwScheduler`（D3-R7），其余全部落到下列模块：

| 文件 | 行数 | 职责 |
|---|---|---|
| `src/index.ts` | 33 | 日志 + `import { MafwScheduler } from './kernel'` + `export { MafwScheduler }` + `require.main === module` bootstrap（逐字） |
| `src/kernel.ts` | 6209 | `class MafwScheduler`：组合根 / `initServices()` / 子系统方法（原 index.ts 类体逐字搬迁，302,769 字节归一化比对 0 diff） |
| `src/boot.ts` | 1048 | `bootKernel(kernel)`（原 `start()` 逐字，83 成员 `BootKernel` 视图）+ `BOOT_STEPS` 27 步有序声明 |
| `src/http-router.ts` | 42 | spec §5.1 facade：re-export `createRequestListener` / `TransportDeps` / `createWsHub` / `WsHub`（无逻辑、无分发） |
| `src/http/transport.ts` | 523 | `createRequestListener(deps)`：CORS/OPTIONS → auth → registry → plugin web → file history → transport 分支 → dashboard 兜底（R6 顺序保留）→ `/register` → `/control` → `/health` → 反代 → 500 |
| `src/http/ws-upgrade.ts` | 203 | `createWsHub(server, deps)`：`/api/ws` / voice / terminal / plugin WS 上行 + 30s 心跳 + 60s push 维护；`dispose()` 接 `shutdown()` |
| `src/server/event-hub.ts` | 131 | `EventHub`：`broadcast()` / `setupEventBus()` / `sseClients` / `wsClients`；kernel 保留同名委托方法（70+ 闭包调用点零改动） |
| `src/subsystems/api-routes.ts` | 725 | `attachAllRoutes(deps)`：46 条 attach（45 个 `attach*` + 1 条 typed route），顺序 46/46 原样；lead/pod 外来货物逐字 |
| `src/subsystems/dashboard-legacy.ts` | 240 | `handleDashboardAPI`（R5 兜底）逐字，transport 经 `dashboardDispatch` 依赖调用 |

- **HTTP 传输 + WS 升级**（Task 3）：原 `startApiServer()` 里 598 行回调 → `createRequestListener`；
  138 行 `upgrade` / `wss` / `voiceWss` / `terminalWss` / 心跳 / push 维护 → `createWsHub`；
  `startApiServer()` 变成 59 行「取 deps → 建 listener → listen banner」。
- **路由迁移收尾**（Task 2/3/4）：`/api/runtime-config` 挂上既有幻影 catalog 条目；
  `handleDashboardAPI` 出类。`scripts/analyze-routes.cjs` 对 `index.ts` 的 TOTAL **24 → 0**。
- **boot 序列**（Task 5）：27 个启动块保留原顺序，`BOOT_STEPS` 只声明名字与前置依赖；
  DB-open-before-migration 的存量气味**记录不修**（D3-R6，行为等价优先）。
- **事件枢纽**（Task 7）：`broadcast()` / `setupEventBus()` / `sseClients` / `wsClients` 归属
  `EventHub`；`broadcast-seq` 与 `sse-attach` 的源码钉随之改指 hub，容器 live identity 保持。
- **清理**（Task 9）：`http/transport.ts` 删除 211 行 D1/P5 迁移 tombstone 注释（D1/D2 历史由
  git + `docs/releases/` 承载）；`kernel.ts` 的组合根里本就没有迁移注释（随 handler 一起进了
  transport）。删除只写不读的 `voiceWss` / `terminalWss` 类字段与赋值（hub 自己持有；`wsHub`
  字段保留，`shutdown()` 读它做 `dispose()`），`ws` import 收敛为 `WebSocket`。
- **文档**：`docs/architecture/gateway.md` 文件地图 / 进程生命周期 / 新增「内核拆分（D3）」现状段；
  本文即交付记录。

## 本波提交

| # | hash | 内容 |
|---|---|---|
| 1 | `d8fb0b54` | `test(gateway): D3 split guards (RED)` — index < 1000、模块存在、`.match`/`.startsWith` 纪律、entry shape |
| 2 | `69f8ee5d` | `refactor(gateway): extract http leaf helpers (D3 Task 1)` — `readBody` / `normalizeDir` / `isPortHealthy` → `core/http/http-util.ts` |
| 3 | `a1b9e2d1` | `refactor(gateway): migrate /api/runtime-config to RouteRegistry (D3 Task 2)` — 幻影条目转实；删死模块 `routes/runtime-config-route.ts` |
| 4 | `ab0304de` | `refactor(gateway): extract HTTP transport + WS upgrade (D3 Task 3)` — `http/transport.ts` + `http/ws-upgrade.ts`；analyzer 24 → 5 |
| 5 | `dc9a3256` | `refactor(gateway): extract dashboard legacy dispatch (D3 Task 4)` — analyzer 5 → 0 |
| 6 | `28df6ca1` | `refactor(gateway): extract boot sequence (D3 Task 5)` — `boot.ts`（`bootKernel` + `BOOT_STEPS`） |
| 7 | `72a1bb9c` | `refactor(gateway): extract route attach orchestration (D3 Task 6)` — `subsystems/api-routes.ts` |
| 8 | `8ef7901f` | `refactor(gateway): extract event hub (D3 Task 7)` — `server/event-hub.ts` |
| 9 | `55c907ca` | `refactor(gateway): move MafwScheduler to kernel.ts, index.ts becomes entry (D3 Task 8)` — 35 个源码扫描测试同提交重指 |
| 10 | 本提交 | `docs(gateway): D3 closeout — tombstones, docs, delivery record (D3 Task 9)` |

## 裁决（D3-R1..R11）

- **D3-R1（验收口径）**：验收 = spec §7 字面（`index.ts < 1000`、模块存在、API routes
  registry-only、transport 收口）。spec §3 的 `index < 100` / `kernel ~400` / `subsystems ~300`
  留给 D4。
- **D3-R2（`.match` 纪律）**：通配分发只允许收敛后的显式比较；守卫扫描
  `index.ts` + `http-router.ts` + `http/*`，要求零 `req.url?.match` / `req.url?.startsWith`。
  `mobile/media-proxy.ts` ×2、`mobile/tts-artifact.ts` ×1、`routes/session-mutations.ts` ×2
  是存量违规，allowlist 记录，不新增。
- **D3-R3（transport 范围）**：A2A / well-known / artifact / MCP / SPA / register / control /
  health / proxy 整体进 `http/transport.ts`；register/control 的业务体作为模块私有端口逐字保留；
  dashboard 联合分支仍在 `/api/goals/control` 之前（R6 死臂保留）。
- **D3-R4（event hub）**：`broadcast()` / `setupEventBus()` / `sseClients` / `wsClients` 归
  `server/event-hub.ts`；kernel 保留同名委托，`broadcast-seq` 重指 hub。
- **D3-R5（runtime-config 先手）**：`GET/PATCH /api/runtime-config` 先迁
  `routes/runtime-config.ts`，消掉 R9 分析器盲区。
- **D3-R6（boot）**：`boot.ts` = 抽取即原样 + `BOOT_STEPS` 依赖声明；DB-open-before-migration
  只在注释中记录，不在本波修复。
- **D3-R7（类搬迁）**：类名保持 `MafwScheduler`，搬到 `kernel.ts`；`index.ts` 只留入口 + re-export。
- **D3-R8（BootKernel 桥）**：83 个成员（多为 private）由单个有注释的
  `bootView(): BootKernel` 强转桥接；`CANONICAL_TYPE_SET` 收进 `canonicalTypes()` 访问器以
  避免 TDZ/循环依赖。接受。
- **D3-R9（执行位置）**：共享 checkout 在任务中被另一 agent 切到 `feat/p2-main-merge`；
  Task 6 起在临时 worktree 内实现 / 验证 / 提交（node_modules junction），共享 checkout 的
  git 状态全程未动。
- **D3-R10（hub 桥）**：hub 保留同名私有桥（`eventStore` / `startGoal` / `goalDriver` /
  `getMilestonePush()`）over live getter，使搬移体**逐字节不变**；`sseClients` / `wsClients`
  是 readonly public 字段（从不重赋 → live identity 给 ws-upgrade 与 plugin SSE writer）。
- **D3-R11（环境修复）**：共享根 `node_modules` 被发现 529 个包目录缺 `package.json`（jest 无法启动），
  以**增量**方式修复（`@mafw/*` junction + 按 lockfile 精确复制）；未触碰 git / `package-lock.json`。
  `@anthropic-ai/claude-agent-sdk` 故意不装，使两个 claude 套件保持与 BASE 相同的环境红。

## 数字

| 指标 | D1 收尾 | D3 收尾 |
|---|---|---|
| `index.ts` 行数 | 8204 | **33** |
| `kernel.ts` 行数 | —（类在 index） | 6209 |
| analyzer `TOTAL`（index.ts） | 24 | **0**（match 0 / equals 0） |
| transport dispatcher 钉扎 | — | 19（exact 12 + prefix 6 + slot 1，就地钉在 `http/transport.ts`） |
| `kernel-split-guards` | 0/7（RED） | **7/7** |
| 迁移 tombstone 注释 | ~210 行（handler 内） | 0 |

## 测试与门禁

| 门禁 | 结果 |
|---|---|
| `node scripts/analyze-routes.cjs` | **TOTAL 0 (match 0, equals 0)** |
| `node node_modules/typescript/bin/tsc --noEmit -p tsconfig.json` | **1 error：`src/runtime/adapter-event-mapper.ts` TS2366**（存量、未触碰文件；touched files 0） |
| `jest tests/unit/ --no-coverage --forceExit --runInBand` | **732/734 suites、5764/5769 tests pass**；仅 `claude-adapter-acceptance` / `claude-adapter-coverage` 环境红（`@anthropic-ai/claude-agent-sdk` 未安装，与 BASE 相同） |
| `kernel-split-guards` + `legacy-route-inventory` + `tests/unit/http/` + `core-runtime-neutrality` | **5 suites / 61 tests passed** |
| SDK contract（`packages/gateway-sdk/src/contract.test.ts`） | **4/4 pass** |

## 环境注记

- **TS1479 漂移**：共享依赖树漂移期间，`tsc` 曾在未触碰文件报 16 条 TS1479；修复后复跑只剩
  1 条存量 TS2366（`adapter-event-mapper.ts`，BASE 同样报）。
- **node_modules 修复**（D3-R11）：只做增量；早期一次误作用域的 `npm install` 在
  `C:\Users\15524\node_modules` 留下 ~92 个包，已标记待清理（不影响仓库）。
- **并行跑的全量抖动**：非串行全量跑额外出现 `memory/laya-client`、`checkpoint/restore-git`、
  `pod/pod-worktree-service` 超时（三者隔离跑 33/33 通过，串行全量也全绿）——并行负载下的
  git / 端口时序抖动，与本次改动无关。
- **worktree 执行**（D3-R9）：D3 Task 6+ 在 `.superpowers/d3-worktree`（branch
  `feat/gateway-kernel-d3-boot-kernel` @ `55c907ca`）中完成；node_modules 用 junction 指回共享树。

## 遗留（D4）

- **spec §3 目标**：`index < 100`（已满足 33）/ `kernel ~400` / `subsystems ~300` 未达 ——
  `kernel.ts` 仍是 6.2k 行组合根，`initServices()`（1104 行）与各注册面是首要拆分对象。
- `subsystems/` 目前只有 `api-routes.ts` / `dashboard-legacy.ts`，粒度偏粗。
- `EventTapCallback` 等还散着 `any`，需要类型化。
- 三个 entry 负向 pin（`core-runtime-neutrality` 的剥离器样本、`architecture-boundaries` /
  `dependency-boundary` 的入口文件名断言）仍按 `index.ts` 读取：这是**故意**的入口完整性检查，
  正向断言（`can('media.session')` 等）已在 `kernel.ts`。
- `busySessions` / queue 语义、lead/pod 外来货物仍在 kernel 内；按 D1/D2 纪律继续「先钉后移」。

> spec（§3/§5.1/§5.5/§7）未回改，以本记录与 `docs/architecture/gateway.md` 现状段为准。
