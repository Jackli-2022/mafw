# 固定核心 + 可调整点实施路线图

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
>
> 这是**项目路线图**：Phase 0/1 已写到可执行任务；Phase 2–6 在各自决策门通过后再展开详细计划。不要把整份路线图当成一次性 big-bang 实施单。

**Goal:** 把 gateway / desktop 调整为“固定核心 + 可调整点”，主要参考计算机底层架构（ISA / 内核 / driver / 总线 / 保护环 / 用户态）；先让叶子能力可调整，再让插件扩展 agent tools / events / UI，最后处理有状态能力。

**Architecture:** 逻辑微内核四层（ISA / 内核 / driver / 用户态）。核心保留生命周期、传输、事件内核、安全策略、持久化原语、插件宿主和契约；能力实现通过 manifest + provider registry 注册，消费者只依赖接口。**路线 B 已选**：Phase 0/1 先在 `gateway/src/kernel-v2/` 做进程内并行模块，Phase 1.5 再加独立 v2 入口/端口/数据副本；契约门禁 + shadow compare + cutover，不做 flag-day。

**Tech Stack:** TypeScript / Node、gateway 现有 Jest 套件、desktop `node --test` + Solid、现有 unified plugin package 契约、runtime contract。

**Spec:** `docs/superpowers/specs/2026-11-12-fixed-core-capability-architecture-design.md`

## Global Constraints

- 路线 B：Phase 0/1 只在 `gateway/src/kernel-v2/` 做进程内并行模块，**不接 live gateway、不碰 `~/.mafw` 数据**；Phase 1.5 才加独立 v2 入口/端口/数据副本。禁止在现役 `main` flag-day 替换。不引入 Cordis；不换 Solid/Electron/SQLite/Monaco。
- 核心不变量不可替换：人类验收、审批/权限/审计、记忆 soft supersede / T1 隔离 / 100ms recall、canonical 事件顺序、DB 迁移、`planHash`/`evalHash` 绑定、desktop preload/webview sandbox，以及 runtime 四条（flat history / 非法事件 fail-closed / 中性 503 / `SessionCreateOpts.directory` 绝对路径）。
- 所有新 seam 必须 TDD；每个任务先写失败测试，再实现，再跑全量。
- 新旧路径并存时，旧路径是 fallback；新路径通过门禁后才能删除旧路径。
- 安装时替换（L1）/项目或会话作用域（L2）优先；L3 是 **re-registration**，只给符合 stateless 契约的 provider，不是 module unload。
- Desktop UI 只做声明式槽位或 sandboxed web surface；禁止把原生 Solid 组件注入 renderer。
- 每个 phase 必须有 rollback；失败的 provider 不得拖垮 boot / SSE / recall / 人类验收。
- 每个 provider 必须有 health、诊断、last-known-good；核心只依赖接口和 manifest。
- 保留 legacy 插件目录至少一个发布周期，并写 deprecation 时间；`~/.mafw/ui-plugins` 在迁移期默认关闭/显式同意，不静默加载 full-privilege main 代码。
- 文档：架构变化写 `docs/architecture/<subsystem>.md`；带日期/commit 的交付写 `docs/releases/`；调研/spike 结论写 `docs/research/`。

## Review Focus

- **坏 provider 不拖垮 boot**：load/activate 抛错或超时，gateway 仍能启动到 safe mode；fallback 可观测。
- **替换不改变语义**：TTS/usage/media 等替换后，HTTP 状态码、DTO、事件、warn 文案不变；runtime 四条不变量有守卫。
- **作用域不泄漏**：project/session 级 provider 不得被其他项目/会话解析到；global fallback 必须显式；priority tie-break 确定。
- **dispose 完整**：timer/listener/PTY/watcher/subprocess 在替换/卸载时全部释放；LIFO、失败隔离。
- **observer ≠ interceptor**：observer 失败 fail-open；interceptor 失败必须 deny/veto；v1 不开放 interceptor。
- **插件失败不阻塞热路径**：event observer、tool handler、UI action 失败必须隔离，不能拖慢 100ms recall 或 SSE。
- **不改变信任边界**：desktop 插件不能拿到完整 `window.api`；webview 不拿 apiToken；gateway 插件不能绕过审批/审计。
- **cutover 可回滚**：shadow compare 有 golden fixtures；session drain、data handover、schema 前后兼容、rollback drill 都是 gate deliverable。
- **全量测试基线稳定**：每个 gate 前在 canonical build 上连续 2 次 clean full-suite；worktree 构建产物差异不能当作长期解释。

## Probe / Spike Register

Probe 的作用是让 tech lead 在看详细计划前先看清关键未知；每个 probe 有明确问题、证据和决策。

| Probe | 状态 | 要回答的问题 | 证据 | 决策 |
|---|---|---|---|---|
| S1 Gateway CapabilityRegistry over TTS | 完成 | 通用 registry 能否接管真实 provider 且消费者零改动？ | `spike/capability-registry-tts` @ `5a248271`；20 个新测试；定向 88/88 | Task 0.5 port 到 kernel-v2；Phase 1 生产化 |
| S2 Desktop context-menu contribution slot | 完成 | 固定 shell 能否托管声明式 UI 槽位并保持信任边界？ | `spike/desktop-menu-slot` @ `a2357b71`；11 个新测试；context-menu 37/37；desktop 全量 3543/3543 | 采用 host-side slot；Phase 4 接 plugin-contract |
| S3 ASR provider with subprocess | 待做 | provider 拥有子进程时，生命周期/ledger/health/fallback 是否成立？ | 待定 | Phase 2 前完成；决定 ASR 是否先于其他 provider |
| S4 Menu item end-to-end | 待做 | `plugin-contract.ui.menuItems` → gateway action → desktop slot 是否闭环？ | 待定 | Phase 4 前完成 |
| S5 Canonical event observer | 待做 | 只读事件订阅能否 fail-open、可过滤、不阻塞主链？ | 待定 | Phase 3 前完成 |
| S6 v1/v2 shadow compare | 待做 | 只读 shadow 能否稳定对比 HTTP/TTS/events/usage 且可回滚？ | 待定 | Phase 1.5 gate 前完成 |

## Phase Overview

| Phase | 目标 | 主要交付 | 决策门 | 估算 |
|---|---|---|---|---|
| 0 | 冻边界与契约 | spec、ADR、manifest 草案、插件平面契约、diagnostics/versioning 契约、S1 port、架构守卫 | G0：核心边界评审通过，零行为变化 | 1–2 周 |
| 1 | 内核 MVP + 叶子生产化 | kernel-v2 registry/lifecycle、TTS/usage adapter、独立 v2 只读 shadow | G1：v2 只读 shadow 通过；v1 全量绿 | 3–4 周 |
| 2 | Gateway 叶子 provider | media、ASR、commands、notifications、automation action（embedding 移到 Phase 5） | G2：测试包调整内置 provider，核心零改动 | 6–8 周 |
| 3 | Agent tools + event observer | `tools` contribution、只读 canonical 事件订阅 | G3：插件加工具 + 观察事件，闭环可用 | 4–6 周 |
| 4 | Desktop UI 槽位 | menuItems、composer action、panel rail、chat part 评估 | G4：插件贡献 menu + composer 端到端 | 4–6 周 |
| 5 | 有状态能力 | memory store/retrieval/embedding、automation、goal node/eval、storage | G5：有状态 provider 可安装时替换/重启生效 | 6–8 周 |
| 6 | 信任与运维硬化 | worker 隔离、kill switch、safe mode、plugin doctor、兼容门 | G6：不可信插件不越权；回滚可演练 | 持续 |

## Phase 0：边界与契约（1–2 周）

**目标**：先把“什么不可换、什么先换、怎么换”写死，零行为变化。

### Task 0.1：冻结核心不变量

**Files:**
- Modify: `docs/superpowers/specs/2026-11-12-fixed-core-capability-architecture-design.md`（已创建，按审查修订后定稿）
- Modify: `docs/architecture/gateway.md`、`docs/architecture/desktop.md`（只加现状指针，不改行为）

- [ ] 评审 spec §0 的计算机架构映射与 §3 的核心清单，确认 gateway / desktop 各自的“固定核心”和“可调整点”。
- [ ] 把每个不变量映射到现有测试/守卫与 conformance kit；没有守卫/kit 的列出补测任务。
- [ ] 记录 tech lead 决议：威胁模型、信任模型、UI 扩展边界、作用域、L3 范围。
- [ ] 确认 runtime 四条不变量、webview apiToken 禁止项进入守卫计划。
- [ ] 确认 diagnostics/versioning/performance 契约字段（Task 0.6）。

**Gate G0**：spec 通过评审；每个不变量有 owner、守卫或 conformance kit；无代码行为变化。

### Task 0.2：Manifest 草案 + 架构守卫草案

**Files:**
- Create: `gateway/src/kernel-v2/manifest.ts`（类型 + 纯校验，不接线）
- Create: `gateway/tests/unit/kernel-v2/manifest.test.ts`
- Create: `gateway/tests/unit/architecture/kernel-v2-boundaries.test.ts`（先 RED）

- [ ] 写 manifest 校验测试：id/version/apiVersion、kind（claim）、provides/requires、activation、permissions、planes、integrity。
- [ ] 实现纯校验；不注册、不激活、不改 boot。
- [ ] 写守卫测试：`gateway/src/kernel-v2/**` 不得 import 任何 provider 实现；provider 不得 import kernel-v2；不得 import v1 `kernel.ts`/`boot.ts`/`http/transport.ts`。
- [ ] 运行 `npx jest --runInBand tests/unit/kernel-v2/manifest.test.ts tests/unit/architecture/kernel-v2-boundaries.test.ts`。

**Gate G0.2**：manifest 纯校验通过；守卫可运行；零运行时行为变化。

### Task 0.3：路线 B 的隔离与 cutover 清单

**Files:**
- Modify: `docs/superpowers/specs/2026-11-12-fixed-core-capability-architecture-design.md` §6
- Modify: 本路线图 Phase 1/2

- [x] tech lead 选择：**B 并行 `kernel-v2` 结构性重写**（2026-11-12）。
- [ ] 确认 Phase 0/1 拓扑：**进程内 `gateway/src/kernel-v2/` 模块，不接 live gateway**；Phase 1.5 才加独立 v2 入口/端口/数据副本。
- [ ] 列出 shadow compare 对象：HTTP（status+normalized JSON）、TTS（byte compare）、events（golden sequence）、usage（record/replay）。
- [ ] 列出 cutover runbook：fixes-only、session drain、data snapshot、schema 前后兼容、rollback drill、v1 退役标准。
- [ ] 确认 v1 复用政策：只 import 契约/纯 domain；不 import v1 组合根或单例。
- [ ] 把选择与清单写入 spec §6；Gate G0.3 以清单完整为准。

**Gate G0.3**：路线 B 的拓扑、shadow compare、cutover、rollback、v1 复用政策均落盘；不碰现役 `~/.mafw` 数据与全局配置。

### Task 0.4：插件平面契约（gateway / desktop）

**Files:**
- Modify: `packages/plugin-contract/src/types.ts`（新增 `PluginPlane`、`contributes` 类型）
- Modify: `packages/plugin-contract/src/validate.ts`
- Create: `packages/plugin-contract/src/planes.test.ts`
- Modify: `gateway/src/plugins/package-types.ts`（类型对齐，暂不改 loader）

- [ ] 写失败测试：manifest 可声明 `contributes.gateway` / `contributes.desktop.ui` / `contributes.desktop.web` / `contributes.desktop.main`；可并存；未知平面拒绝。
- [ ] 定义 `PluginPlane = "gateway" | "desktop-ui" | "desktop-web" | "desktop-main"`；执行面与数据面分离。
- [ ] 写失败测试：只有 desktop declarative 贡献的包不要求 `activate()`；只有 gateway 贡献的包不要求 UI descriptor；现有统一包 fixture 继续通过。
- [ ] 写失败测试：manifest 与 activate 同时声明同一 id 且元数据不一致 → validation error。
- [ ] 实现纯类型/校验；**不接线** gateway/desktop loader，不改现有安装行为。
- [ ] 跑 `npm run test:plugin-contract` 与 `npx tsc --noEmit -p tsconfig.json`（gateway）。

**Gate G0.4**：平面契约可校验；现有统一包仍通过；零运行时行为变化。

### Task 0.5：Port S1 spike 到 kernel-v2

**Files:**
- Create: `gateway/src/kernel-v2/capability-registry.ts`（从 `spike/capability-registry-tts` @ `5a248271` 的 `gateway/src/core/capability-registry.ts` port）
- Create: `gateway/tests/unit/kernel-v2/capability-registry.test.ts`（port 13 个测试）
- Create: `gateway/src/kernel-v2/providers/tts-registry.ts`（spike 的 TtsEngineRegistry 适配版）
- Create: `gateway/tests/unit/kernel-v2/tts-registry-capability.test.ts`（port 7 个测试）

- [ ] 从 spike 分支取文件，不直接修改 v1 `gateway/src/tts/registry.ts`。
- [ ] 保留 spike 的 default/override/fallback/list/dispose 行为。
- [ ] 跑 `npx jest --runInBand tests/unit/kernel-v2/capability-registry.test.ts tests/unit/kernel-v2/tts-registry-capability.test.ts`（20 个测试）。
- [ ] 记录 port 差异（文件名/import 路径/兼容层）。

**Gate G0.5**：S1 产物在当前分支可运行；v1 文件零改动；20 个测试通过。

### Task 0.6：冻结 diagnostics / versioning / performance 契约

**Files:**
- Create: `gateway/src/kernel-v2/diagnostics.ts`（类型 + 纯工厂）
- Create: `gateway/src/kernel-v2/capability-version.ts`（apiVersion 校验/兼容判断）
- Create: `gateway/tests/unit/kernel-v2/diagnostics.test.ts`
- Create: `gateway/tests/unit/kernel-v2/capability-version.test.ts`

- [ ] 写失败测试：diagnostic record 字段完整、无 secret/Host 代码。
- [ ] 写失败测试：同 major additive 通过；跨 major 默认拒绝；显式 provider set 才允许共存。
- [ ] 实现纯类型/校验；不接线。
- [ ] 把 spec §4.10 performance contract 映射到 Phase 1.1 的 cache/100ms 预算测试。
- [ ] 跑 `npx jest --runInBand tests/unit/kernel-v2/diagnostics.test.ts tests/unit/kernel-v2/capability-version.test.ts`。

**Gate G0.6**：诊断/版本契约字段冻结；零运行时行为变化。

## Phase 1：内核 MVP + TTS/usage 生产化（3–4 周）

**目标**：在 `gateway/src/kernel-v2/` 内把 S1 变成生产级内核，先包装两个叶子 provider；不改变 v1 HTTP/DTO，不接 live gateway。

> 拓扑：Phase 0/1 只在 `gateway/src/kernel-v2/` + 独立测试中运行；Phase 1.5 才加独立 v2 入口/端口/数据副本。v1 默认/fallback。

### Task 1.1：生产级 CapabilityRegistry

**Files:**
- Modify: `gateway/src/kernel-v2/capability-registry.ts`
- Test: `gateway/tests/unit/kernel-v2/capability-registry.test.ts`

**Interfaces:**
- Produces: `CapabilityRegistry<T>`，支持 `scope`、`priority`、`health`、`diagnostics`、`dispose`。
- Consumes: `CapabilityTier`（保留 builtin/legacy/package 兼容层）。

- [ ] 写失败测试：scope 解析（global/project/session）、同 scope priority、priority tie-break、health 失败回退 last-known-good、跨 scope 不泄漏。
- [ ] 实现 scope 叠加与 priority；保留现有 tier 兼容。
- [ ] 写失败测试：activate 失败不抛出到 boot；diagnostics 记录 provider id/reason。
- [ ] 实现 health/fallback 诊断；不接 kernel.stop()。
- [ ] 跑 `npx jest --runInBand tests/unit/kernel-v2/capability-registry.test.ts`。

### Task 1.2：Provider lifecycle

**Files:**
- Create: `gateway/src/kernel-v2/provider-lifecycle.ts`
- Test: `gateway/tests/unit/kernel-v2/provider-lifecycle.test.ts`

**Interfaces:**
- `ProviderHandle`: `load()`, `activate()`, `deactivate()`, `health()`, `dispose()`。
- `ProviderLifecycle`: `load → validate → resolve → activate → active/degraded → drain → dispose`。

- [ ] 写失败测试：load throw fail-soft；依赖顺序、循环失败、activate 超时、deactivate 失败隔离、LIFO dispose。
- [ ] 实现生命周期状态机；不接 boot。
- [ ] 写失败测试：必需 provider 失败 → safe mode；可选 provider 失败 → degraded；untrusted 无 worker → fail-closed。
- [ ] 实现 safe mode/degraded/拒绝结果对象。
- [ ] 跑 `npx jest --runInBand tests/unit/kernel-v2/provider-lifecycle.test.ts`。

### Task 1.3：TTS provider adapter

**Files:**
- Create: `gateway/src/kernel-v2/providers/tts.ts`
- Create: `gateway/tests/unit/kernel-v2/tts-provider.test.ts`
- Verify: `gateway/tests/unit/tts-registry.test.ts`（v1 原 30 测试保持）

- [ ] 写失败测试：默认 mimo、package > legacy > builtin、未知 fallback、dispose、health 回退。
- [ ] 实现 adapter，包装现有 `TtsEngine` 接口；不 import v1 `kernel.ts`/`routes/tts.ts`。
- [ ] 跑 `npx jest --runInBand tests/unit/kernel-v2/tts-provider.test.ts tests/unit/tts-registry.test.ts`。

### Task 1.4：Usage provider adapter

**Files:**
- Create: `gateway/src/kernel-v2/providers/usage.ts`
- Create: `gateway/tests/unit/kernel-v2/usage-provider.test.ts`
- Verify: `gateway/tests/unit/usage/plugin-loader.test.ts`（v1 行为不变）

- [ ] 写失败测试：usage provider 通过 registry 解析；同名 package > legacy > builtin；缺省 fallback；record/replay fixture。
- [ ] 实现 adapter，包装 `ExternalAdapter` 接口；不 import v1 `kernel.ts`/`usage-poller.ts`。
- [ ] 写失败测试：provider 移除后 poller 不崩溃；diagnostics 可见。
- [ ] 跑 usage 全套 + `npx tsc --noEmit -p tsconfig.json`。

### Task 1.5：独立 v2 入口 + shadow compare

**Files:**
- Create: `gateway/src/kernel-v2/main.ts`（独立入口）
- Create: `gateway/src/kernel-v2/facade.ts`（health / tts voices / usage read-only）
- Create: `scripts/kernel-v2-shadow.mjs`（对比 v1/v2 只读响应）
- Create: `gateway/tests/integration/kernel-v2-shadow.test.ts`

- [ ] 写失败测试：v2 入口使用 `MAFW_KERNEL_V2_PORT` + `MAFW_KERNEL_V2_DATA_DIR`；不读 live `~/.mafw`。
- [ ] 写失败测试：health / tts voices / usage 的 normalized JSON 与 v1 golden 一致。
- [ ] 实现只读 facade + shadow harness；writes 不在本阶段。
- [ ] 跑 `npx jest --runInBand tests/integration/kernel-v2-shadow.test.ts`；记录差异。
- [ ] 写 rollback 演练：停 v2 不影响 v1。

**Gate 1.5**：v2 独立进程只读 shadow 通过；v1 无行为变化；rollback 演练通过。

### Task 1.6：架构守卫 + 文档

**Files:**
- Modify: `gateway/tests/unit/architecture/kernel-v2-boundaries.test.ts`
- Modify: `docs/architecture/gateway.md`
- Create: `docs/releases/2026-11-12-capability-kernel-phase1.md`

- [ ] 守卫：v2 不 import v1 组合根/单例；v1 不 import v2；provider 不 import kernel。
- [ ] 记录 provider 清单、fallback、diagnostics、shadow 结果。
- [ ] 跑全量 gateway 套件（`npx jest --runInBand --forceExit`），记录 clean baseline（连续 2 次）。

**Gate G1**：kernel-v2 模块 + 独立 v2 只读 shadow 通过；v1 全量绿；无 v1 HTTP/DTO 变化；rollback = 不启动 v2。

## Phase 2：Gateway 叶子 provider（6–8 周，2026-11-12 已交付 G2）

**目标**：把叶子能力逐个搬出内核，每个 provider 独立可替换。每个 provider 单独写详细计划。

**状态**：S3 子进程 probe 与 media/ASR/commands/notifications/automation action 已落地；G2 测试包替换证明通过。交付记录：`docs/releases/2026-11-12-capability-kernel-phase2.md`。

**顺序**：S3 → media → ASR → commands → notifications → automation action/trigger。

> `embedding` / `reranker` 移到 Phase 5：它们是 memory 的有状态部分，会提前触碰进程级单例和回填。
> Phase 2 详细计划：`docs/superpowers/plans/2026-11-12-kernel-v2-phase2-leaf-providers.md`

每个 provider 的完成定义：

- Service Definition + default provider + replaceable provider。
- manifest 注册 + health + fallback + dispose + conformance kit。
- 统一插件包贡献面（如果适用）；legacy 路径保留。
- 测试：默认、覆盖、fallback、dispose、scope、包贡献、kit。
- 核心文件零改动（manifest/registry 除外）。
- rollback：删除 provider 注册，恢复旧路径。

**Gate G2**：一个测试插件包可以在不改 gateway 核心的情况下替换内置 media/TTS/usage/ASR provider；全量绿；诊断可解释。

## Phase 3：Agent tools + event observer（4–6 周，2026-11-12 已交付 G3 harness）

**目标**：插件真正能扩展 agent，而不只是 UI/provider。

**状态**：S5 observer、plugin-contract tools 声明、ToolContributionRegistry、G3 fake-runtime/conformance harness 已落地。交付记录：`docs/releases/2026-11-12-capability-kernel-phase3.md`。

> Phase 3 详细计划：`docs/superpowers/plans/2026-11-12-kernel-v2-phase3-agent-tools-observer.md`
> 本 phase 先做 kernel-v2 registry + conformance harness；live 接线在 Phase 3.5/4 cutover；interceptor 仍未开放。

### tools contribution

- `plugin-contract` + `plugin.json` 增加 `tools` 声明：name/description/inputSchema/handler。
- gateway 把工具注册进 runtime 的 `tools.registerTools`（或 MCP 工具表）。
- 命名空间 `plugin:<package>:<tool>`；per-session 作用域；权限/审批沿用现有策略。
- 失败隔离：工具 handler 抛错只返回 tool error，不拖垮 turn。

### event observer

- 只读 canonical 事件订阅：`session.*` / `message.*` / `tool.*`。
- 过滤：session/project/type；超时/异常 fail-open；不能阻塞主链。
- **只做 observer**；interceptor/gate/rewrite 不在本 phase，且必须 fail-closed 另行设计。
- 生命周期：provider dispose 时自动退订。

**Gate G3**：一个插件包可以声明工具并被 agent 调用；一个 observer 可以收到 tool 事件；核心闭环无回归。

## Phase 3.5：Live wiring（2026-11-12 已交付，默认关闭）

**目标**：把 Phase 3 的 observer/tools 以 feature flag 接进 v1 live 路径，不改变默认行为。

- 唯一 bridge `runtime/v2-live.ts`；`kernel.ts` / `boot.ts` 只 import bridge。
- `MAFW_KERNEL_V2_OBSERVERS=1`：事件链新增 `canonicalObserverTap` stage（conformanceTap 之后、internalFilter 之前）。
- `MAFW_KERNEL_V2_TOOLS=1`：`activateRuntimeTools` 合并 plugin tools；merge 失败回退 builtin。
- `MafwScheduler.registerCanonicalObserver()` / `registerPluginTool()` 显式注册口。
- 详细计划：`docs/superpowers/plans/2026-11-12-kernel-v2-phase3-5-live-wiring.md`
- 交付记录：`docs/releases/2026-11-12-capability-kernel-phase3-5.md`

**Gate G3.5**：flag 关闭 v1 零行为变化；flag 打开 observer/tool 可用；失败 fail-open；全量绿。

## Phase 3.6：Plugin host 自动注册（2026-11-13 已交付，默认关闭）

**目标**：统一插件包在 `activate()` 贡献 tools/observers 后，由 PackageHost 自动同步到 live bridge，并按 revision 退订。

- `activate()` 新增 `tools` / `observers` 数组；validator 校验后进入 `ActivatedContributions`。
- `PluginHost.bindKernelV2(cb)` 发布 `PluginToolEntry[]` / `PluginObserverEntry[]`（含 revision）。
- `runtime/v2-live.ts` 的 `syncPluginContributions()` 按 revision diff；remove/disable/stop 发布空数组。
- 命名空间：`plugin:<package>:<tool>` / `plugin:<package>:<observer>`；包 tool 暂只支持 global scope。
- 详细计划：`docs/superpowers/plans/2026-11-13-kernel-v2-plugin-host-auto-registration.md`
- 交付记录：`docs/releases/2026-11-13-capability-kernel-phase3-6.md`

**Gate G3.6**：activate 贡献自动注册；reload 换 revision；remove/disable 退订；flag 关闭零执行；全量绿。

## Phase 4：Desktop UI 槽位（4–6 周，2026-11-13 收口，G4 达成）

**目标**：固定 shell + 更多声明式槽位；不注入原生组件。

**状态**：S4 `ui.menuItems`、composer action、panel rail entry 已端到端交付：contract 校验 → gateway 投影 → desktop 宿主渲染 → package action / 现有 focus 路径。chat part renderer 完成评估，决定暂不实现（保留 `data-*` + `DataPartCard` 兜底；未来唯一推荐形状为 `ui.dataPartCards`）。Phase 4 收口。
**详细计划**：`docs/superpowers/plans/2026-11-13-kernel-v2-phase4-desktop-ui-slots.md`
**交付记录**：`docs/releases/2026-11-13-capability-kernel-phase4-s4.md`、`docs/releases/2026-11-13-capability-kernel-phase4-composer.md`、`docs/releases/2026-11-13-capability-kernel-phase4-panel-rail.md`、`docs/releases/2026-11-13-capability-kernel-phase4-closeout.md`
**评估**：`docs/research/2026-11-13-chat-part-renderer-evaluation.md`

**顺序**：`desktop.ui.menuItems`（先做 S4）→ composer action → panel rail entry → chat part renderer 评估（完成，暂不实现）。

每个槽位的完成定义：

- `plugin-contract` data-only descriptor + gateway 校验/投影。
- desktop host registry + merge + action routing。
- 作用域/排序/上限/去重/失败 fallback。
- 测试：descriptor 校验、host merge、action 调用、卸载、revision guard。
- 不改变 preload/webview sandbox。

**Gate G4**：一个插件包可以贡献 menu item + composer action，端到端可用；desktop 全量绿；无原生组件注入。

## Phase 5：有状态能力（6–8 周，memory 已移出 provider 范围，需按剩余范围重估）

**目标**：处理真正难替换的能力，但只做安装时替换/重启生效，不做热插拔。

**memory 定位（2026-11-13 决策）**：memory 是 MAFW 的**产品能力**，不是可替换 provider。`MemoryService` / `HarmonicUnitFileStore` / 谐波索引 / soft supersede / T1 / 100ms recall / pinned/sticky 逻辑不改；不做 project/session 分区；memory 的模型调用使用当前运行中的 runtime（`RuntimeAccess` / `process.completion` / `runtimeCompletionChannel`）。Phase 5 不再包含 memory store/retrieval provider。

**剩余顺序**：automation trigger/action → goal eval/executor → storage backend（embedding/reranker 是否仍按 provider 待确认）。

**边界**：goal 的 **实现**可替换；NodeDriver 状态机、路由、人类验收、`planHash`/`evalHash` 绑定是核心。memory 整体不在 provider 范围。

每个剩余能力必须先有：

- 稳定接口 + 状态迁移策略。
- capability 对应的 conformance kit。
- 旧实现作为 fallback 至少一个发布周期。
- 数据兼容/回滚演练。
- 不在 hot path 引入 RPC。

**Gate G5**：剩余有状态 provider 可以安装/配置替换并在重启后工作；数据迁移可回滚；全量绿；memory 行为与基线一致（不因 Phase 5 改动）。

## Phase 6：信任与运维硬化（持续）

**目标**：让“可替换”在第三方/不可信场景下也安全。

- worker/child host for untrusted providers；白名单 RPC。
- kill switch / quarantine / safe mode / last-known-good。
- plugin doctor：manifest、权限、health、版本、诊断。
- 兼容门：apiVersion、host range、deprecation。
- 审计：谁加载了什么、何时、失败原因。
- 演练：坏插件、回滚、版本 skew、状态迁移失败。

**Gate G6**：不可信插件无法越权读 fs/net；崩溃爆炸半径限制在一个 worker；回滚可演练。

## Migration Cost

假设 1–2 名工程师、现有测试纪律、不换基础技术：

| 阶段 | 估算 | 说明 |
|---|---|---|
| Phase 0 | 1–2 周 | 主要是 spec/ADR/守卫，无行为变化 |
| Phase 1 | 3–4 周 | kernel-v2 registry/lifecycle + TTS/usage adapter + 只读 shadow |
| Phase 2 | 6–8 周 | 6 个叶子 provider，逐个迁移 |
| Phase 3 | 4–6 周 | tools + observer，涉及 runtime 契约 |
| Phase 4 | 4–6 周 | 3–4 个 UI 槽位 + contract |
| Phase 5 | 6–8 周 | 有状态迁移，风险最高 |
| Phase 6 | 持续 | 信任/隔离/运维 |

**早期价值**：2–3 个月拿到叶子 provider 可调整；4–6 个月拿到插件 tools + UI 槽位；6–9 个月拿到大部分能力可调整。全量“可调整点”不含不可替换不变量；完整第三方信任隔离另算。

**缓冲**：每个 phase 加 30–50% 回归/文档/环境缓冲；有状态迁移单独加数据演练时间。

## Risks & Mitigations

| 风险 | 影响 | 缓解 |
|---|---|---|
| Registry 变成新上帝对象 | 核心更耦合 | 核心只管 lifecycle/scope/health；provider 逻辑不进 core |
| “可调整点”侵蚀不变量 | 安全/验收/记忆正确性回归 | spec §3 永不替换清单 + 守卫测试 |
| Node 无法可靠卸载模块 | L3 泄漏/版本共存 | L3 只做 stateless re-registration；其余 restart；不承诺 unload |
| shadow compare 未落地 | cutover 变 flag-day | Phase 1.5 gate；golden fixtures + rollback drill |
| 两套插件体系长期并存 | 认知/维护成本 | legacy deprecation 时间表；统一包优先 |
| Desktop 原生组件注入 | preload/sandbox 失守 | 坚持声明式 + webview sandbox |
| Contract 漂移 | 客户端/插件静默坏 | apiVersion + 契约测试 + 兼容门 |
| Worktree/构建产物差异 | 假红灯/假绿灯 | 每个门禁记录 clean baseline；CI 统一构建 |
| 迁移期性能回退 | recall/SSE 延迟 | 热路径同进程；registry 解析缓存；性能门禁 |

## Decision Gates

- **G0**：spec/核心不变量评审通过；manifest/守卫草案可运行；零行为变化。
- **G1**：kernel-v2 只读 shadow 通过；v1 全量绿；无 v1 HTTP/DTO 变化。
- **G2**：叶子 provider 可替换；核心零改动。
- **G3**：插件工具 + 事件 observer 可用；核心闭环无回归。
- **G4**：插件 UI 槽位端到端；desktop 全量绿；信任边界不变。
- **G5**：有状态 provider 安装时替换；迁移可回滚。
- **G6**：不可信插件隔离；回滚演练通过。

## Execution Handoff

Phase 0/1 已写到可执行任务。建议执行方式：

1. 先由 tech lead 评审 spec + 本路线图，确认 §8 开放决策。
2. 按 Phase 0 → Phase 1 顺序执行；每个 task 独立 TDD + 提交。
3. 每个 phase 结束后写 `docs/releases/` 交付记录，并跑全量门禁。
4. Phase 2–6 在各自 gate 通过后，再展开详细计划；不要提前把所有任务写成代码级计划。
