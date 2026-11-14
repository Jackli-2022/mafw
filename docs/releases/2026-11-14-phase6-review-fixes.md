# Phase 6 独立 Review 修复记录

- 日期：2026-11-14
- 范围：`docs/superpowers/plans/2026-11-14-phase6-trust-hardening.md` 的独立 review 修复
- Review 基线：`0dd1a61c`
- 修复 commit：`0129f916`、`4ba2258f`

## 已修复（Critical）

| 问题 | 修复 |
|---|---|
| 安全模式 / quarantine 不阻止激活 | `PluginHostOptions.activationBlocked`；boot 闭包读 safeMode/quarantine；blocked 包从 active 移除并 dispose |
| quarantine / safe mode 可被 enable/reload/apply 绕过 | `PackageManager.assertNotBlocked` + install 前置检查；409 `safe_mode_active` / `plugin_quarantined` |
| worker `workerAction` 导致 actions 全部 invalid | `actions[name] = meta`；真实 `PluginHost + WorkerHost + bootstrap` 集成测试通过 |
| 覆盖安装失败可能删掉旧版本 | 安装前校验 source `main`；post-copy 失败时 `lastGood.restore` |
| worker 消息处理抛异常可能杀死 gateway | `handleMessage` 外层 try/catch；`config.get` 单独失败回包 |

## 已修复（Important）

- **I1** boot rollback 后清空旧 fingerprint/files 基线，避免恢复版本被 drift quarantine。
- **I2** `PluginHost.onActivationFailure/Success` 接到 `PluginSafety`；worker `onCrash` 计入失败；成功重置计数/degraded。
- **I3** overwrite 更新 commit 前失败 → 自动恢复 last-good、标记 degraded、审计 rollback；恢复失败才 quarantine。
- **I4** check/doctor 的 worker 激活带 `probe`，不做 drift/quarantine 副作用。
- **I5** `plugin.json` 不再被 integrity 当作 unexpected；新增真实包 positive 测试。activation 阶段强制 manifest integrity 仍未做。
- **I6** `runCheckPackage` 接受单文件包；legacy `.js` 不再硬失败。
- **I7** worker 队列改为可 reject；崩溃/停止时排队调用收到 `worker_crashed`/`worker_stopped`。
- **I8** worker 读取 `MAFW_WORKER_PERMISSIONS`，config.read/write、events、actions 按声明 gating；host 二次校验。
- **I10** 状态 v2 缺 safety 字段视为损坏 → safe mode。
- **I13** trusted/v1 重装成功后清 quarantine；remove 清 quarantine；unquarantine 重置失败计数与 degraded。
- **I16** boot 用 `permissionFlagFor(process.execPath)` 探测 worker；不可用则 install 409 / host 拒绝。

## 明确未修复（Important，需后续）

- **I9 审计 principal / install.rejected / activate.failed / doctor**：manager 仍没有 principal 上下文；部分事件未写。
- **I11 Desktop trust surface**：只加了 safe-mode banner；没有 kill/resume/doctor/quarantine/rollback 控件，没有 v2 consent 安装；list DTO 仍缺 trust 字段，safe mode 下列表可能为空。
- **I12 drill 真实性**：多数场景仍是模块级/桩级；`boot-loop-rollback` 与 `update-rollback-in-window` 共用函数；worker crash 场景未起真实 worker；报告缺 `commit`。
- **I14 kill switch runtime fallback**：停掉 runtime-owning 包后没有切回默认 runtime。
- **I15 健康窗口细节**：applyPending 仍用 state fingerprint；`lastGood.snapshot` 失败仍写 lastKnownGood；pending 版本可能被再次快照。
- **I17 untrusted → v1/trusted 覆盖降级**：service 仍可用 v1 覆盖 untrusted 包，绕过 human-only 信任降级。
- **I5 activation integrity**：manifest 声明 integrity 未在 host 激活时强制（只在安装时）。
- **I9/I11/I12 的 release 文案**：`phase6a`/`phase6b`/`phase6c` release 中“desktop 展示”“10/10 真实 drill”“auto-quarantine”描述需按实际能力收窄。

## 验证

- 定向插件套件：42 suites / 376 tests pass。
- gateway typecheck：0。
- gateway 全量：见 `gateway-review-fixes.log`（待记录）。

## 结论

Phase 6 的**安全边界**（safe mode / quarantine / worker 隔离 / 覆盖失败恢复 / 崩溃隔离）在 review 后已补上关键 wiring。  
但 **Desktop 信任操作面、审计完整性、drill 真实性和 runtime fallback** 仍是 Important 缺口；在这些补齐前，不应把 Phase 6 标成“生产就绪”。
