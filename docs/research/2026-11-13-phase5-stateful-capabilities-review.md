# Phase 5 有状态能力评审

- 日期：2026-11-13
- 审查对象：`docs/superpowers/plans/2026-11-12-fixed-core-capability-roadmap.md` §Phase 5
- 关联：`docs/superpowers/specs/2026-11-12-fixed-core-capability-architecture-design.md`、`docs/research/2026-11-12-microkernel-capability-research.md`
- 结论：**With fixes**。Phase 5 的目标和顺序是对的，但按当前路线图直接开工，会在 live 接线、memory 抽象边界、作用域、信任边界、数据迁移五处做成假 seam。C1–C5 解决前不建议写 memory provider 代码。

## Strengths

1. **风险判断正确**：把 memory / goal / automation / storage 放到最后，承认它们与 TTS/usage 这类叶子能力不是一个量级。
2. **不变量边界写得清楚**：memory schema、soft supersede、T1、100ms recall、NodeDriver、人类验收、`planHash`/`evalHash` 都明确留在核心。
3. **五件套方向正确**：接口 + 状态迁移策略、conformance kit、旧实现 fallback 一个发布周期、数据兼容/回滚演练、hot path 不引入 RPC。
4. **顺序有依据**：memory 先行，embedding 依赖 retrieval，storage 最后，符合依赖关系。
5. **复用已有基础**：`CapabilityRegistry`、`ProviderLifecycle`、manifest、diagnostics 已经在 Phase 1–3 落地，不需要另起一套。
6. **Gate G5 的意图正确**：安装时替换、重启生效、迁移可回滚、全量绿；问题在验收方式，不在方向。

## Critical（Must Fix）

### C1. G5 与当前 live 接线不匹配：Phase 2–4 的 provider 并没有接进 live gateway

**Where:**

- 路线图 `Phase 5` Gate G5：`有状态 provider 可以安装时替换并在重启后工作`。
- `gateway/src/runtime/v2-live.ts:7-8`：live bridge 只有 `MAFW_KERNEL_V2_TOOLS` / `MAFW_KERNEL_V2_OBSERVERS` 两个开关。
- `docs/releases/2026-11-12-capability-kernel-phase2.md:66-68`：明确写了 v2 未接 live gateway、没有 provider package loader / 安装流程。
- `gateway/src/kernel-v2/main.ts`：独立 shadow 入口只接了 TTS/usage，且是只读端口。

**What:** Phase 2 的 media / ASR / commands / notifications / automation action 只通过了测试台和 conformance kit；Phase 5 的 memory / embedding / goal 更没有 live 消费者。当前没有“安装一个 provider → 重启 gateway → 新 provider 接管”的路径，也没有 provider loader、uninstall；`lastKnownGood` 目前只是 diagnostics 字段，不是启动回退机制。

**Why:** 如果直接在 `kernel-v2` 里写 MemoryProvider，live `MafwScheduler` 仍然 `new MemoryService(mafwDir)`；G5 只能靠测试台“证明”，产品行为没变。这是 Phase 5 最大的假 seam 风险。

**Fix:** 在 memory provider 之前加 **Phase 5.0：live cutover scaffolding**：

1. 一个 live facade（例如 `MemoryAccess`）替换 kernel/routes/MCP 对 `MemoryService` 的直接访问，默认实现仍委托现有 `MemoryService`。
2. feature flag 选择 provider，默认旧实现；启动失败回退 last-known-good。
3. 最小 provider loader（先只支持第一方 allowlist 或配置选择）；第三方安装流程可留给 Phase 6，但 G5 要明确“安装”指哪一种。
4. 一个端到端验收：选择测试 provider → 重启 → 读写正常 → 卸载/禁用 → 回退旧实现且数据不丢。

如果 Phase 5 不做 provider loader，就把 G5 改成 **“配置选择的第一方 provider，重启生效”**，不要写“安装时替换”。

### C2. “MemoryStore” 抽象边界未定义，而现有 store 同时拥有持久化、索引和语义

**Where:**

- `gateway/src/memory/harmonic-file-store.ts:59-161`：`write()` 同时写 OKF 文件、更新 `.harmonic_index.json`、更新 anchor/coactivation graph、写 event log、触发 post-write listeners。
- `gateway/src/memory/harmonic-file-store.ts:189-235`：`markSuperseded()` / `setPinned()` 直接改 frontmatter + index。
- `gateway/src/memory/service.ts:10-25`：`MemoryService` 是具体类，直接持有 `HarmonicIndexManager`。
- `gateway/src/kernel.ts:1481-1493`、`:2727-2741`：kernel 仍在各处 `new HarmonicUnitFileStore(...)`。

**What:** “MemoryStore”可以指两种完全不同的东西：

- **(a) 整个 memory backend**：持久化 + 索引 + supersede/pin/sticky + 写后副作用；
- **(b) 纯持久化原语**：只读写 unit，索引/图/事件/语义仍由 core 负责。

当前实现是 (a)。如果 provider 按 (a) 设计，它就能绕过 soft supersede / T1 / pinned 等不变量；按 (b) 设计，core 又要保留索引、图、energy、listeners，provider 只是换文件格式，收益有限。路线图没有选。

**Why:** 这个选择决定接口、conformance、迁移格式、100ms 热路径和第三方信任边界。选错会得到一个“能注册但不能替换”的 store。

**Fix:** 先写 memory pipeline map，再选边界。建议：

- `MemoryPersistence`：unit 的 CRUD + 索引文件持久化；不拥有 supersede/pin/sticky/T1/retrieval 语义。
- `MemoryRetrieval`：只负责打分（BM25/token/hybrid 的候选分数）；supersede 链头解析、T1 过滤、近重折叠、pinned/sticky 注入仍由 core 统一后处理。
- 写路径（校验、OKF、index、graph、event log、energy、listeners）留在 core；provider 不拥有写后副作用。
- 若坚持 whole-backend provider，必须把“core 在出口强制 supersede/T1/去重”写成契约，并接受更高的 conformance 成本。

同时先做 consumer inventory：`kernel.ts`、`boot.ts`、routes、MCP、automation-engine 里所有 `MemoryService` / `HarmonicUnitFileStore` / `HarmonicIndexManager` 直接引用都要收口到 facade；否则 provider 只是旁路。

### C3. Memory 目前是全局的，路线图的 L2 scope 对 memory 不成立

**Where:**

- `gateway/src/kernel.ts`：`new MemoryService(mafwDir)`，base dir 是全局 `~/.mafw`。
- `gateway/src/memory/service.ts`：`HarmonicIndexManager(mafwDir)`，没有 project/session 参数。
- 路线图 §Phase 5 引用 spec §4.3：`memory/model/tool` 可按项目/会话选择 provider。

**What:** 当前谐波记忆没有项目/会话分区；`source_session_id` 只是来源标记，不是隔离。若 Phase 5 暴露 `{ kind: 'session' }` 或 `{ kind: 'project' }` 的 memory provider，会出现：

- provider 看到全部全局记忆（隔离假象）；
- 或者需要新增分区、跨 scope 合并、pinned/sticky/T1 的优先级规则；
- recall 结果可能混入其他项目/会话。

**Why:** 作用域是 provider 契约的一部分，不能后补；先写“可 scope”再发现数据没分区，会迫使后续 breaking change。

**Fix:** Phase 5 v1 明确 **memory provider 只支持 global scope**；项目/会话记忆隔离另立设计（数据分区 + 合并规则 + recall 过滤），不要把它塞进 provider 抽象。路线图把 `memory` 从 L2 示例里移除或标注“future”。

### C4. 第三方有状态 provider 是 Phase 5 的安全洞

**Where:**

- spec §4.5：`trusted` = gateway 进程内，靠安装同意 + manifest 权限 + audit + kill switch；worker 在 Phase 6。
- 路线图 G5：安装时替换有状态 provider。
- 当前 manifest 已有 `permissions` 字段，但没有 stateful provider 的 permission scope 定义。

**What:** 一个进程内 memory provider 可以读全部记忆，包括 pinned 用户画像、T1 原始观察、其他项目数据；当前没有权限 scope、audit、kill switch、integrity 的运行时强制。Phase 5 如果允许第三方包替换 memory，等于把最敏感的数据面交给未隔离代码。

**Why:** TTS/usage 的 blast radius 是输出质量；memory 的 blast radius 是隐私和事实正确性。不能沿用叶子 provider 的信任模型。

**Fix:** Phase 5 只允许 **第一方 allowlist / `kind: core`** 的有状态 provider；第三方有状态 provider 推迟到 Phase 6 worker + 权限 + audit + kill switch 之后。即使暂不强制，也先在 manifest 定义权限：

- `memory:read` / `memory:write` / `memory:t1` / `memory:profile`
- `storage:read` / `storage:write`
- `automation:schedule` / `goal:eval`

并在 diagnostics 中显示 provider 申请了哪些权限。

### C5. 数据迁移与回滚只有一句“演练”，没有格式和验收

**Where:**

- 路线图 §Phase 5：`数据兼容/回滚演练`、G5 `数据迁移可回滚`。
- 当前 memory 数据面：OKF 文件 + `.harmonic_index.json` v2 + `vectors-<model>.json` + SQLite T1 BLOB + `gateway.db` 表。
- 当前没有 memory format version、export/import、dual-read、reverse migration。

**What:** “数据迁移可回滚”不是一句 gate 文案。需要明确：

- 迁移哪些数据（units / index / vectors / T1 / graph / event log）；
- 源格式版本、目标格式版本；
- 备份位置与校验（count / hash / 抽样读取）；
- 双读或影子读窗口；
- 迁移期间的新写入如何处理；
- 反向迁移命令与演练结果。

**Why:** memory 是长期数据；没有反向迁移，provider 切换一次就等于单向门。向量维度/模型变化还会让旧向量不可用。

**Fix:** 在 Phase 5 plan 里先定义 **MemoryFormatManifest**（version、files、counts、checksum、producer），再写迁移/回滚脚本；G5 必须包含一次在数据副本上的完整演练：迁移 → 写入 → 回滚 → 校验旧 provider 可读且新写入不丢。

## Important（Should Fix）

### I1. EmbeddingProvider 契约缺元数据，换模型/维度会静默坏

`gateway/src/memory/embedding-provider.ts:28-32` 只有 `name/dims/embed`；`embedding-runtime.ts:25-30` 是进程单例；向量文件按 `provider.name` 打标签，T1 还有独立 SQLite BLOB。Phase 5 至少需要：

- `id` / `modelTag` / `dims` / `maxInputTokens` / `normalize` / `batchLimit`；
- 向量命名空间版本与维度校验；
- 换 provider 后的 backfill 作业与进度；
- 失败回退 BM25（现有 fail-open 语义保留）；
- query/document 前缀策略进契约，不能藏在实现里。

Reranker 单独定义，不要放进 100ms 同步 recall；只在异步扩展/精排路径使用。

### I2. Automation trigger 不应拥有 timer / schedule

Phase 2 的 `automation action` provider 已存在（`gateway/src/kernel-v2/providers/automation.ts`），但未接 live；Phase 5 若再做 trigger，必须明确：

- provider 只提供 trigger 定义或向 engine 发事件；
- cron 解析、去重、预算、enable/disable、missed-run 补偿仍由 core `AutomationEngine` 拥有；
- provider 不得持有全局 timer / interval，否则 dispose 泄漏、重复调度、绕过 budget。

### I3. Goal node/eval 不要开放新节点名

`gateway/src/core/goal/node-names.ts:10-19` 的 `GoalNodeName` 被 routing、artifacts、watchdog、recovery、timeline、prompts、identity 共同使用。开放新节点名等于把这些子系统全部变成可扩展，超出 Phase 5 收益。

建议 Phase 5 只做：

- `GoalNodeExecutor`：现有 `plan/probe/execute/review` 的实现可替换；
- `GoalEval` hook：评估逻辑可替换；
- 路由、状态机、人类验收、`planHash`/`evalHash`、artifact 校验仍留在 core。

### I4. StorageBackend 是 async 死接口，直接接 hot path 会破坏 100ms

`gateway/src/core/storage/types.ts` 全是 `Promise`；`FileStorage` / `SQLiteStorage` 没有消费者；gateway 实际用同步 `better-sqlite3`。写路径本身是 async，或许能容忍异步 port；但 `searchScored` 是同步的，检索读路径不能每次 `await`。如果为了“storage provider”把检索读也改成 async，边界 recall 的 100ms 契约会直接破，或者被迫把全量索引常驻内存，port 就失去意义。

建议二选一：

1. 删除死接口，Phase 5 不做通用 storage provider；
2. 只对非 hot path 的状态（导出、快照、审计归档）做 storage port；检索读保持同步/缓存。

不要为 `gateway.db` 造异步通用后端。

### I5. Conformance kit 没有统一注册/强制门

Phase 2 已有 `gateway/tests/helpers/kernel-v2/*-conformance.ts`，但没有“provider 激活前必须通过”的注册表。Phase 5 需要：

- 每个 capability 一个 kit + fixture；
- `provider -> required kits` 映射；
- 测试内直接注册 `package` tier 时必须显式通过 kit；
- memory kit 至少覆盖 soft supersede / T1 / 100ms / scope / pinned / sticky / `distinct_from` / 近重折叠。

### I6. 缺性能基线，G5 的“全量绿”不够

Phase 5 至少记录：

- boundary recall p50/p95（100ms 硬契约）；
- `searchScored` 延迟（1k / 10k entries）；
- index load 时间；
- write throughput；
- embedding backfill 吞吐与内存；
- 迁移前后 RSS。

没有这些数字，“provider 不拖慢记忆”无法验收。

### I7. 缺 stateful provider 的 health / diagnostics / fallback 机制

需要明确：

- provider state（loaded / active / degraded / failed）；
- format version、index loaded、last migration、last error；
- 启动失败回退旧实现，不进入 boot loop；
- `mafw health` / diagnostics 面能看到当前 memory provider 与数据格式；
- kill switch（至少配置级禁用）。

### I8. 直接引用面太大，先收口再谈 provider

`MemoryService` / `HarmonicUnitFileStore` / `HarmonicIndexManager` 在 `kernel.ts`、`boot.ts`、`automation-engine.ts`、routes、MCP 中大量直接引用。Phase 5 第一步应是 **facade + boundary guard**：

- 核心只依赖 `MemoryAccess`；
- 禁止 provider 之外 `new HarmonicUnitFileStore`；
- 现有测试全部跑在默认 facade 上；
- 然后才允许注册第二个 provider。

## Minor

- **M1：Phase 5 体量偏大。** 5 个能力 + 数据迁移，6–8 周偏乐观；建议拆成 5A（memory/embedding）与 5B（automation/goal/storage），各自 gate，或把 goal/storage 推到 Phase 6。
- **M2：顺序微调。** memory persistence → memory retrieval → embedding/reranker → automation → goal → storage；embedding 契约应跟着 retrieval 契约一起定，避免回填返工。
- **M3：术语统一。** “memory store / retrieval / backend / provider”在路线图里混用；先定义每个词对应哪个接口。
- **M4：版本策略缺失。** provider API version、memory format version、兼容/拒绝规则没有写；G5 前至少要冻结 `apiVersion`。
- **M5：Gate 基线要数字化。** 例如“连续 2 次全量 clean + recall p95 ≤ 100ms + 迁移演练通过”，不要只写“全量绿”。
- **M6：配置与密钥迁移。** embedding provider 切换涉及 API key、endpoint、模型缓存；diagnostics 必须脱敏，迁移不能把 key 写进日志。

## Missing Decisions

Phase 5 plan 开工前必须先回答：

1. Memory provider 是 **whole backend** 还是 **persistence + retrieval 两个接口**？
2. Memory 是否只支持 **global scope**？项目/会话隔离什么时候做？
3. Phase 5 是否允许第三方有状态 provider？如果不允许，G5 的“安装时替换”是否改成“配置选择第一方 provider”？
4. `StorageBackend` 是修成真 port，还是删除？
5. Goal 是否只允许现有节点的 executor 替换，还是允许新节点名？
6. Provider loader / live wiring 放在 Phase 5.0，还是明确推到 Phase 6？
7. Memory format version 覆盖哪些文件/表，回滚由谁执行？

## Proposed Revised Phase 5

建议把路线图拆成以下子阶段，而不是直接按五个能力平铺：

| 子阶段 | 内容 | 出口 |
|---|---|---|
| **5.0 Live scaffolding** | MemoryAccess facade、provider 选择/fallback、diagnostics、最小 loader、迁移框架 | 测试 provider 可切换并回退，默认行为不变 |
| **5.1 Memory persistence** | `MemoryPersistence` + 默认实现 + consumer 收口 + boundary guard | 现有 memory 测试全绿；provider 只换持久化 |
| **5.2 Memory retrieval** | `MemoryRetrieval` + core 出口后处理（supersede/T1/去重） | 100ms + LongMemEval 不回归 |
| **5.3 Embedding/reranker** | registry + modelTag/dims + backfill + BM25 fallback | 切换模型可回填/回退 |
| **5.4 Automation/Goal** | trigger 定义（core 调度）+ goal executor/eval hook | 不绕过 budget/状态机/人类验收 |
| **5.5 Storage** | 删除死接口，或只做非热路径 port | 不引入 async hot path |
| **5.6 G5 drill** | 数据迁移 → 写入 → 回滚 → 校验；性能基线 | G5 |

## Assessment

**Ready for Phase 5 implementation?** **With fixes — not yet.**

Phase 5 的方向正确，但当前路线图把“有状态 provider”当成一个已经存在的 live seam 来写。实际上：

- v2 还没有 live memory/automation/goal 消费者；
- memory store 同时拥有持久化和语义，边界没选；
- memory 是全局数据，L2 scope 是假承诺；
- 第三方 stateful provider 的信任模型还没到 Phase 6；
- 数据迁移只有目标，没有格式和演练。

**建议顺序：** 先做 5.0 live scaffolding + memory pipeline map + 数据格式清单，再决定 `MemoryPersistence` / `MemoryRetrieval` 接口；在这些完成前，不要写 `MemoryProvider` 实现代码。

**最小可执行下一步：**

1. 写 `docs/research/2026-11-13-phase5-memory-pipeline-map.md`（写路径、读路径、热路径、数据文件、消费者）。
2. 定 C2/C3/C4 三个决策（边界、scope、信任）。
3. 再写 memory store/retrieval 的详细 plan。
