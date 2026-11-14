# Gateway E10f 全量读表面收口：设计（2026-11-14）

> 目标：把 catalog 中**所有 JSON GET 读接口**补齐 200 response schema，并把 E10 系列遗留的 4 个工程尾巴清掉。
> 规则沿用 `2026-11-13-gateway-e10-contract-coverage-design.md` §2。

## 0. 基线（实测）

- catalog：318 ops，69 个有 response schema。
- 未覆盖：249 = **62 GET** + 162 POST + 16 DELETE + 6 PATCH + 3 PUT。
- 62 GET 中 6 个不是 JSON：`media.artifact` / `pods.a2aArtifact` / `mobile.ttsArtifact`（二进制）、
  `plugins.webAsset`（HTML/静态）、`plugins.webEvents` / `event.subscribe`（SSE）。
- 本波覆盖剩余 **56 个 JSON GET** → 终值 **125/318（39.3%）**；overrides 12 → 11（`automations.list` 转 code-first）。

## 1. 范围（4 个 schema 批次）

### E10f-A 会话 / 任务 / 终端 / usage（16）

`cognition.rules`、`session.structured`、`tasks.list`、`tasks.get`、`tasks.output`、
`session.trajectory`、`session.run`、`session.discovery`、`session.discoverySkill`、
`experience.actions`、`background.jobs.list`、`background.jobs.output`、`terminal.list`、
`session.usage`、`session.usagePluginsList`、`session.usagePluginSourceGet`。

### E10f-B 项目 / manager / runtime / 元数据（16）

`mafwCommands.list`、`manager.session`、`project.current`、`fileHistory.list`、`runtime.get`、
`runtime.contract`、`runtime.config.get`、`plugins.client`、`models.get`、`media.plugins`、
`tts.voices`、`voice.status`、`python.status`、`agent.capabilities`、`media.resolveTask`、`embedding.get`。

### E10f-C Goal / Lead / Events / Standing / Automations / Pods（16）

`lead.boundaries.list`、`lead.topics.list`、`lead.topics.get`、`events.sources.list`、
`events.threads.list`、`events.threads.triggers`、`events.threads.subscriptions.list`、
`events.deliveries.list`、`standingGoals.list`、`standingGoals.runs`、`automations.list`（override → code-first）、
`automations.get`、`automations.history`、`pods.ensure`、`pods.memory.get`、`orchestration.outcomes`。

- `automations.list`：先读 override，schema 以 handler 为准；删除 override 条目并更新 `$comment`。

### E10f-D 观测 / 设备 / A2A JSON（8）

`dashboard.stats`、`mobile.devicesList`、`mobile.pairingCode`、`devices.list`、
`session.subagents.result`、`health.root`、`a2a.agentCard`、`pods.a2aCard`。

### E10f-E 工程尾巴（4）

1. **note-board `perNoteCap`**：`recall.pinned` / `memory.listSticky` 的 budget 补 `perNoteCap`，同步 SDK `StickyNoteBudget`。
2. **`memory.get` HarmonicUnit 编译期桥**：gateway 侧加 `AssertEq`/类型级断言，锁住 schema 与 `core/memory/harmonic-types.ts` 漂移。
3. **`session.list` override 残留**：catalog 已 code-first，删除 `overrides.json` 中无效 `session.list` 条目（12 → 11 与 automations 一起）。
4. **mobile triage phantom 兜底**：`triage_page.dart` 的 `reason` 兜底改为真实 `summary`/`proposedGoal`（与 desktop `triage-model` 对齐）。

## 2. 明确排除（不建模，原因入库）

- 6 个非 JSON GET（见上）。
- 全部 POST/PUT/PATCH/DELETE 的请求体与响应（187 ops）；本波只做读表面。
- TUI triage phantom（`pi-tui` 缺失，无法门禁验证；保持 deferred）。
- 强制版本协商（产品决策未定）。

## 3. 约束

- handler 为事实源；有 SDK DTO 的 op 加/保持 `AssertEq`；runtime-owned payload 用边界对象 + owner 注释。
- 每批一个 commit `(E10f-X)`；每批更新 `schema-coverage.test.ts` 清单与阈值（56 个逐批累加）。
- 生成物入库；`emit:openapi` + `gen:api` 幂等，每批 diff 只允许该批目标 op。
- 4 个 schema 批次在**同一 worktree 顺序执行**，避免 catalog / 生成物并发冲突。

## 4. 门禁

每批：gateway tsc 0 + targeted（api-contract / schema-coverage / 相关路由）+ analyze TOTAL 0 + SDK tsc/contract。
收口：gateway 全量（9 env-red）、coverage 125/318、SDK 226、desktop 全量、mobile targeted + analyze、kernel-split 7/7。
