# GLM-5.3 架构 spec 独立审查

- 日期：2026-11-12
- 审查模型：`gateway/glm-5.3`
- 审查对象：`docs/superpowers/specs/2026-11-12-fixed-core-capability-architecture-design.md`
- 关联：`docs/superpowers/plans/2026-11-12-fixed-core-capability-roadmap.md`
- 结论：**With fixes**。Phase 0 可在小修后启动；Phase 1 在 C1/C2 解决前不可执行。

## Strengths

1. **§4.7「类比不成立的地方」是 spec 最好的部分。** 明确列出没有 ring 0、没有 MMU、没有模块卸载、IPC ≠ syscall、没有抢占等边界，避免了架构类比暗中设定预期。
2. **§2 反目标可测试。** “Registry 变成新上帝对象”“插件失败拖垮 100ms recall”“原生组件注入破坏 preload/sandbox”都是这类重构的真实失败模式。
3. **§7 kernel change budget（每个新 provider 核心文件改动 0 行）可机械检查**，配合架构守卫能防止 strangler 停滞。
4. **§4.6 拒绝按目录拆分平面**（一个包、一个 revision、`contributes` 键）是正确的；目录拆分破坏 action/event/descriptor 的原子 revision。
5. **路线图对证据诚实**：S1/S2 有 commit 和测试数，S3–S5 明确前置，Phase 2–6 不提前展开。
6. **非目标承重**：session log / memory schema / Goal-Pod 状态机 / authz 不做热插拔，正确识别了不可约核心。
7. **B 路线骨架正确**：无 flag-day、冻结 ISA、现有测试作为 v2 验收。

## Critical（Must Fix）

### C1. `kernel-v2` 在 spec 与 roadmap 中是两个不兼容的东西

- **Where:** spec §6.2 bullet 1 vs roadmap line 125 / Task 1.1–1.3。
- **What:** §6.2 说 v2 在独立 worktree / 端口 / 数据副本启动（独立进程）；roadmap Phase 1 note 说 registry/lifecycle 在 `gateway/src/kernel-v2/`（进程内并行模块）。具体任务又指向 `gateway/src/core/capability-registry.ts`、`gateway/src/core/provider-lifecycle.ts`、`gateway/src/tts/registry.ts`，即 route A 的原地机制。
- **Why:** 两种拓扑风险/时间/回滚完全不同。3–4 周做独立进程 v2 不可信；进程内 `kernel-v2/` 不满足 §6.2 的隔离承诺。实现者会静默执行 route A。
- **Fix:** 二选一并让 spec + tasks 一致。建议：Phase 0/1 用**进程内 `gateway/src/kernel-v2/` 并行模块**（不接 live gateway）；等重写 boot/event/persistence 时再加**独立 v2 进程 + 端口 + 数据副本**。明确 v1 模块复用政策（哪些 import，哪些重写）。

### C2. §6.2 太薄，无法满足自己的 G0.3：shadow compare、数据交接、会话连续性未定义

- **Where:** spec §6.2；roadmap Task 0.3 gate。
- **What:** 没说 shadow compare 比较什么（HTTP status+body？事件流？时延？），网络 provider（usage）如何处理非确定性（需要 record/replay fixtures，不是 live compare），比较基础设施在哪。也没说 cutover 时 v2 从数据副本接管 live `~/.mafw`：DB schema 必须对 v1 向后兼容以支持回滚，in-flight agent session 必须在重启边界 drain，SSE 消费者需要 cursor/event-replay 连续性。没有 v1 change-freeze 政策，v2 要持续 cherry-pick，形成并行重写死亡螺旋。
- **Why:** 并行重写最常见的失败就是 shadow compare 从未建、cutover 变成 flag-day、回滚因数据已迁移不可能。
- **Fix:** 扩 §6.2 或链接 ADR：
  1. 每个子系统的 shadow compare 定义（确定性 replay fixtures；TTS buffer byte-compare；事件序列 golden files）。
  2. Cutover runbook：session drain → data handover → schema forward/backward compat → rollback drill 作为 **gate deliverable**。
  3. v1 迁移期政策（fixes-only 或明确双维护预算）。
  4. “cutover complete” 定义，包括 v1 `MafwScheduler` 退役标准。

### C3. “观察 + 拦截”共用 fail-open，是策略绕过洞

- **Where:** spec §0.1 row 2（Interrupt/hook point：观察或拦截，fail-open）vs §3（审批/权限/审计不换、canonical 事件 fail-closed）vs roadmap Phase 3（先不做 gate/rewrite，只 observe）。
- **What:** 观察和拦截被混在一个 fail-open 策略里。`tool before` hook 超时/抛错被跳过，就是一个可被慢速静默禁用的权限门。
- **Why:** 这是“可调整点”模型唯一能违反自身不变量之处。fail-open 适合 telemetry observer，不适合 authorization path。
- **Fix:** 拆成 **observer**（post-hoc、只读、fail-open、超时预算）与 **interceptor**（pre-hook、fail-closed：错误/超时 = deny 或 veto，绝不跳过）。明确审批/审计不能是 fail-open hook。Interceptor 未设计前，从 v1 hook point 删除“拦截”和 `tool before/after`。

### C4. Runtime-contract 不变量不在“永不替换”列表，而 runtime 被列为 driver

- **Where:** spec §0 driver row（runtime 可调整）vs §3 永不替换。
- **What:** AGENTS.md 的硬 runtime 不变量缺失：flat-only history `{ data, nextCursor }`、未知/非法事件 fail-closed、中性 503 不含 runtime/capability 名、`SessionCreateOpts.directory` 必填绝对路径。读者可能认为替换 runtime provider 可以改 history 形状或错误语义。
- **Why:** runtime 是 desktop/TUI/mobile 的高频消费面；“provider replacement must not change semantics”只是愿望，没绑定到具体不变量。
- **Fix:** 把四条 runtime 不变量加入 §3；在 §0/§0.1 driver 列表注明：“runtime = `RuntimeAccess` 后的 adapter 实现；`RuntimeDefinition`/event mapping/fail-closed/503-neutral semantics 是 ISA，不是 driver。”

### C5. `contributes` manifest 未与现有 plugin contract 对账，schema 也表达不了它要求的平面区分

- **Where:** spec §4.6 示例 + routing rules；roadmap Task 0.4（`PluginPlane = "gateway" | "desktop"`）vs `packages/plugin-contract/src/types.ts`、`gateway/src/plugins/package-types.ts`。
- **What:** (a) 今天 `ui`/`actions`/`events` 由 `activate()` 返回，不在 `plugin.json`；client descriptor 有严格 allowlist。spec 把 actions/events/panels 移进 manifest `contributes`，但没说 manifest 声明与 activate 返回值的关系（优先级？去重？data-only 包是否只需 manifest？谁校验？），也没说现有包必须继续通过校验。
  (b) 平面 schema 只有 `gateway`/`desktop`，而 `contributes.desktop` 同时包含纯数据 slot（panels/menuItems）和执行面（webSurfaces），所以“desktop plane = 宿主读 descriptor”并非一致；平面声明无法表达，仍靠 key 名推断。
- **Why:** (a) 可能在 Task 0.4/Phase 4 破坏所有已安装包；(b) desktop host 没有 schema 级信号区分沙箱页面与纯数据渲染，信任边界靠宿主记得 key 含义。
- **Fix:** §4.6 加映射表（manifest key ↔ activate() return key ↔ client descriptor key），定义优先级，明确“现有包校验不变；`contributes` 在 apiVersion N 是 additive/optional”。拆分 desktop key：`desktop.ui`（declarative）、`desktop.web`（webview execution）、`desktop.main`（legacy）。

## Important（Should Fix）

### I1. `kind: core` 是自封信任
manifest 作者自己声明 trust tier。应改为安装器/宿主策略校验：`core` 仅第一方白名单/指纹；`trusted` 需显式用户安装同意；声明 core 但不在白名单 = hard validation failure。

### I2. Phase 6 前 `untrusted` provider 行为未定义
manifest schema 在 Phase 0/1 落地，worker host 在 Phase 6。没有 worker 时遇到 untrusted，应 fail-closed 拒绝，不能降级为 in-process。

### I3. 缺 provider conformance kits
ISA 冻结了接口和不变量，但可替换 provider（尤其 Phase 5 memory）没有强制的 conformance suite。每个 Service Definition 应附带 conformance test kit；非内置 provider 激活前必须通过。Task 0.1 的“不变量 → 测试/守卫”应产出这份 inventory。

### I4. Goal node/eval 可替换 vs Goal/Pod 状态机不换，边界未画
应明确：node/eval **实现**是 driver；NodeDriver 状态机、人类验收、`planHash`/`evalHash` 绑定是 core。memory 同样注明 provider ≠ schema/invariants。

### I5. 引用的 microkernel research doc 不存在
`docs/research/2026-11-12-microkernel-capability-research.md` 在当前 worktree 和 main 都不存在（在 gateway spike 分支）。spec header 引用不可审查。应落地该文档或修正路径。

### I6. Phase 1 任务引用不存在的 S1 产物
S1 在 `spike/capability-registry-tts` @ `5a248271`，未合入。当前分支没有 `capability-registry.ts` / `tts-registry-capability.test.ts`。应加 Task 0.x “port/merge S1”，或把 Tasks 1.1/1.3 改成 Create 并引用 spike。

### I7. Provider lifecycle 从 validate 开始，module load 在其之前
top-level module code 挂起会阻塞 event loop，activate-time fail-soft 无效。生命周期应扩为 `load → validate → …`；load throw 可 fail-soft，load hang 只有 untrusted worker 能防；作为 untrusted 继续拒绝的理由。

### I8. L3 hotplug 回避 Node module cache 现实
“无状态 provider”热替换后旧模块仍在 `require.cache`；共享依赖版本冲突；“stateless”未定义。应把 stateless 定义为可检查契约（无 module-level mutable state、无 process listener、无 require-time side effect），并说明 L3 是 **re-registration** 不是 unload；共享依赖版本共存不在 L3 范围。

### I9. 跨平面 bridge authz 未说明，未引用现有 web-ticket
repo 已有 `plugin-web-ticket.ts`、包级 HTTP 路由、包内 action 引用、`plugin:<pkg>:*` 命名空间。spec 未说明 sanctioned bridge，也未写明：webview surface 绝不能拿 gateway apiToken；必须走 scoped ticket/bridge。应在 §3 加 invariant “apiToken never crosses into a webview”。

### I10. legacy `desktop-main` 只有 deprecation 窗口，没有硬化
`~/.mafw/ui-plugins/*.js` 是用户可写目录中的 full-privilege Electron-main 代码，是最大信任面。应默认关闭或显式用户同意，加完整性检查（可行时），并给移除日期。

## Minor

- M1：`service registry` vs `capability registry` 词汇漂移；统一或定义两者。
- M2：§4.3 同 scope priority tie-break 未定义；建议 registration order → package name。
- M3：§4.1 `integrity` 语义未定义（hash 什么、何时校验、谁校验）。
- M4：budgets 放在 MMU/保护环下不准确；它是 cgroup/scheduler 类资源控制。
- M5：§6.2 desktop cutover “Solid 视图保留，或并行窗口”未决；Phase 1 应选并行窗口。
- M6：§7 “全量测试基线稳定”没有数字；建议每个 gate 前 N 次连续 clean full-suite。

## Missing Sections / Decisions

1. **Threat model**：buggy trusted plugin vs malicious installed package vs supply-chain compromise。I1/I2/I10 都依赖它。
2. **Capability interface versioning policy**：多版本共存、deprecation window、breaking-change 规则；这是 ISA 稳定的真正机制。
3. **Cutover runbook as deliverable**：per-subsystem steps、session drain、data handover、rollback drill、v1 decommission。
4. **Performance contract for registry on hot paths**：100ms recall 前的 registry 解析必须缓存；提升为 §4 requirement。
5. **Diagnostics/observability contract**：diagnostic record 的字段与出口；Phase 0 冻结 manifest 时一起冻结。

## Assessment

**Ready for Phase 0/1?** **With fixes** — Phase 0 可在小修后启动；Phase 1 在 C1/C2 解决前不可执行。

**Reasoning:** Phase 0 是文档/契约工作，只需修 I5、C4、C5 即可产出连贯的 contract freeze。Phase 1 目前不可执行：spec 与 roadmap 对 `kernel-v2` 物理形态不一致（C1），且 route B 自己 G0.3 要求的 shadow compare/cutover/data handover 机制不存在（C2）；按当前任务表执行会静默变成 route A。

## Resolution（2026-11-12）

| 项 | 修复 |
|---|---|
| C1 | spec §6.1 明确 Phase 0/1 进程内 `gateway/src/kernel-v2/` 模块，Phase 1.5 才独立入口/端口/数据副本；roadmap Task 0.3/1.5 对齐。 |
| C2 | spec §6.2/§6.3 增加 shadow compare、cutover runbook、v1 fixes-only、rollback drill、`MafwScheduler` 退役标准；roadmap Task 0.3/1.5。 |
| C3 | spec §0.1 拆 observer（fail-open）与 interceptor（fail-closed）；v1 只 observe。 |
| C4 | spec §3 增加 runtime 四条不变量；roadmap Global Constraints/Review Focus 同步。 |
| C5 | spec §4.6 增加 manifest ↔ activate ↔ client descriptor 映射；拆 `desktop.ui` / `desktop.web` / `desktop.main`；现有包继续通过。 |
| I1/I2 | spec §2.1 威胁模型 + §4.1/§4.5 kind claim/安装策略/untrusted fail-closed。 |
| I3 | spec §4.8 conformance kits；roadmap Phase 2 完成定义。 |
| I4 | spec §3/§4.4/§6 + roadmap Phase 5 写清 memory/goal 实现 vs 核心边界。 |
| I5 | `docs/research/2026-11-12-microkernel-capability-research.md` 已落到当前分支。 |
| I6 | roadmap 增加 Task 0.5（Port S1 spike）。 |
| I7 | spec §4.2 lifecycle 增加 `load`；Task 1.2 覆盖 load fail-soft。 |
| I8 | spec §4.4 定义 stateless 契约与 L3 = re-registration，不承诺 unload。 |
| I9 | spec §3/§4.6 明确 webview 不拿 apiToken，走 ticket/bridge。 |
| I10 | spec §4.6 + roadmap Global Constraints：`ui-plugins` 默认关闭/显式同意。 |
| M1–M6 | spec §0/§4.3/§4.1/§4.11、roadmap Review Focus 已逐项处理。 |
