# Gateway 内核重构 D2+D3 合并对账记录（2026-11-11）

## 合并链条

| commit | 内容 |
|---|---|
| `c46b8497` | merge-tmp：D2+D3 对账 main @ 901ed772（34 个 foreign index.ts hunk 织入 boot/kernel/transport/api-routes/dashboard-legacy） |
| `440006e9` | merge-tmp：再对账 main @ 7ee50700（P2.4 event layer，18 个 hunk 织入 kernel/event-hub/api-routes/boot/transport） |
| main 快进 | `git merge --ff-only merge-tmp` → **main @ 440006e9** |

## 背景（为什么需要人工对账）

- D2（事件分派表）+ D3（boot/kernel/http-router 拆分）工作在分支上完成；同期另一 agent 的 lead/pod P2 与 P2.4 event layer 直接落在 main。两条线对 `gateway/src/index.ts` 的写法根本不同（我们把类搬到 `kernel.ts`、`index.ts` 变成 33 行入口）。
- 冲突类三种：**foreign 功能文件**（取 main 最终版——分支上的搭载副本是较早快照）；**我们的重构文件**（取分支侧）；**index.ts**（取分支 33 行入口 + 把 main 的增量逐 hunk 移植到重构后的宿主模块）。
- 生成物（openapi/gateway-paths/api-schema）一律从合并后的 catalog 重新生成；catalog 双方增量实际 byte-identical（297→307 ops），未产生并集冲突。

## 移植摘要

- **Round 1（901ed772）**：34 hunks — boot.ts（builtin adapter 注册、serve 凭据）、kernel.ts（normalize/bridge/provider、serve seam、T1 家族、topic-memory、goal control）、http/transport.ts（proxyHeaders）、api-routes.ts（goal-control/lead fork/searchT1）、dashboard-legacy.ts（sourceTraceIds）。D2 的 24-stage 表与 main 内联事件链逐块等价，**无需移植**。
- **Round 2（P2.4）**：18 hunks — kernel.ts（EventLayerStore/Service、ingestInternalEvent、processEventThread、DEFAULT_BUILTIN_RUNTIME、skillsDir/runtimeConfigDir、credentials）、event-hub.ts（memory_*/goal/state/phase → event layer 注入）、api-routes.ts（attachEventRoutes + GitHub webhook HMAC）、boot.ts（skillsDir skill 安装、opencodeExternalMode）、transport/runtime-config 文案。
- 附带修正：`[OpenCodeConfig]`→`[RuntimeConfig]` 日志前缀（含其 wiring 测试）。

## 验证（合并后主树）

- gateway `tsc --noEmit -p tsconfig.json`：**0 errors**
- P2.4 event layer 专项：11 suites / 66 tests 绿 + integration event-layer 1/1
- 全量 unit：**5844 passed / 15 failed / 5859**（24 个环境套件红）——main 基线 `7ee50700` 同环境 5764/14/5778：合并树 **+81 collected、+80 passing**，唯一额外红为 load 敏感的 `instance-ownership`（隔离 6/6 全绿）
- integration：43 passed / 4 failed（env `plugin-package-e2e`，main 同）
- SDK contract 4/4；`analyze-routes.cjs` **TOTAL 0**；D2/D3/HTTP 守卫 144 tests 绿

## 环境注意（非代码问题）

- 本机 root `node_modules` 不完整（缺 `cross-spawn`/`jsonc-parser`/`openapi-typescript` 等）导致 23-24 个 adapter 套件与 desktop 构建在本地不可跑，main 基线同样红；健康环境需 `npm ci` 后跑 `npm run gen:api` 重新生成 `api-schema.gen.ts`（contract 4/4 已钉住 ops↔client 一致）。
- D3 期间共享根 node_modules 曾被掏空并做附加修复（Ruling D3-R11）；`C:\Users\15524\node_modules` 存在一次误装残留，待清理。
