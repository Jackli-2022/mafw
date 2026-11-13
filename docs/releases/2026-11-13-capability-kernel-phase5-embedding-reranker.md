# Capability Kernel Phase 5 / Embedding & Reranker Providers 交付记录

- 日期：2026-11-13
- 版本：5.1.0（未 bump、未发布）
- 范围：embedding / reranker 的模型、API、本地引擎与策略 provider
- Spec：`docs/research/2026-11-13-phase5-stateful-capabilities-review.md`
- 路线图：`docs/superpowers/plans/2026-11-12-fixed-core-capability-roadmap.md` §Phase 5
- 详细 plan：`docs/superpowers/plans/2026-11-13-kernel-v2-phase5-embedding-reranker.md`

## 交付范围

### Embedding provider

- `EmbeddingProvider` 增加可选元数据：`modelTag` / `maxInputTokens` / `batchLimit` / `health()` / `dispose()`。
- 新增 `gateway/src/memory/embedding-namespace.ts`：
  - `modelTag + dims + version` 命名空间。
  - 保留既有 `vectors-<modelTag>.json` / `vectors-t1-<modelTag>.json` 文件名。
  - `assertEmbeddingDims()` 统一维度校验。
- 新增 `gateway/src/memory/embedding-registry.ts`：
  - 内置 `dashscope` / `local-onnx` / `local-llamacpp` 工厂。
  - `embeddingProviderIdFromConfig()` 把现有配置映射到 provider id。
  - 未知/抛错工厂 fail-open 为 null；创建实例 LIFO dispose。
- `initEmbeddingRuntime` 支持注入 provider，runtime 暴露 `providerId` / `modelTag` / `dims` / `namespace`。
- `MemoryVectorStore` 按 `dims + version` 校验文件；不匹配时改写到带 `-d<dims>-v<version>` 后缀的命名空间，旧文件保留。
- `SqliteT1VectorStore` 改用 `(model, dims, key)` 复合主键的 `t1_vectors_v2` 表；首次启动从旧 `t1_vectors` 复制，旧表保留。
- `kernel.initEmbeddingServices` 通过 registry 创建 provider；hot-swap 前 dispose 旧 runtime（取消防抖/丢弃在飞结果）和旧 provider；新 runtime 初始化失败时 dispose 新 provider 并回退 BM25-only。
- 写时路由在每次 hot-swap 后重新绑定到新 runtime（`wireRouteWriteDeps`），不会继续用旧 provider/旧 vector store。
- `/api/memory/embedding-config`：
  - GET 暴露 `providerId` / `modelTag` / `dims` / `baseUrl`。
  - POST 只接受 provider/engine/model/threads/llamacpp；`baseUrl` 仍只允许通过 config file 设置（避免任意 endpoint 拿到 API key / SSRF）。
- 向量是派生数据：换模型只重建向量；旧命名空间文件保留，切回旧 provider 可直接复用。

### Reranker provider

- `Reranker` 增加 `strategy` / `health()` / `dispose()`。
- 内置 strategy：`heuristic` / `cross-encoder` / `llamacpp`。
- 新增 `gateway/src/memory/reranker-registry.ts`：工厂注册、未知 id fail-open、LIFO dispose。
- `reranker-singleton` 通过 registry 解析；配置变化时 dispose 旧实例（兼容 legacy `killServer`）。
- 新增 `reranker-hot-path.test.ts`：同步边界 recall 模块不得 import `reranker` / `getReranker` / `applyReranker`。
- reranker 仍只服务后台快照 / 显式搜索，不进入 100ms 同步边界 recall。

### Conformance kit

- `gateway/tests/helpers/kernel-v2/embedding-conformance.ts`
  - name / modelTag / dims / maxInputTokens / batchLimit
  - query/document 返回数量与维度
  - 有限数值、health 合法性
- `gateway/tests/helpers/kernel-v2/reranker-conformance.ts`
  - name / strategy
  - 候选子集、topK、无重复、分数有限、health 合法性
- 两个 kit 只返回错误列表，不抛错，供未来 provider 激活前复用。

## 行为说明

- **memory 核心未改**：`MemoryService`、`HarmonicUnitFileStore`、谐波索引、soft supersede、T1 隔离、100ms recall、pinned/sticky 逻辑保持原样；memory 仍不按项目/会话分区。
- **默认行为不变**：`memory.embedding.provider=off` 时不创建 runtime；未配置 reranker 时仍为 `off`。
- **维度隔离**：同 `modelTag`、不同 dims 的旧向量文件不会被加载；新维度写到独立后缀命名空间，旧文件保留，切回旧维度仍可读。
- **版本隔离**：`vectors-*.json` 写入 `version`；旧文件缺省按 v1 读取。
- **T1 回滚**：`t1_vectors_v2` 以 `(model, dims, key)` 为主键；新维度写入不会覆盖旧维度行。
- **热切换**：旧 runtime dispose 后取消防抖、丢弃队列/在飞结果；旧 provider 不再被调用。
- **失败回退**：embedding init / embed 失败 → dense 通道关闭或 `computeDenseScores` 返回 null，BM25 仍可用；reranker 失败/不可用 → 未精排结果。
- **模型/API/本地/策略**：由 provider 工厂与 config 选择，不引入第三方包 loader；自定义 endpoint 走 config file。

## 验证

- 本计划新增 **31 个测试**（embedding metadata/registry/runtime/namespace/route/switch/dispose、reranker strategy/registry/hot-path/conformance、live wiring source pin、minors 回归）。
- gateway 全量：**7108 passed / 1 skipped / 7109 total**（905 suites）。
- gateway typecheck：`npx tsc --noEmit -p tsconfig.json` 退出 0。
- SDK build + tests：`npm run build -w @mafw/sdk` 通过；`npm test -w @mafw/sdk` **224 / 224 pass**。
- 定向回归：embedding runtime / vector store / T1 / embedding-config / reranker factory / singleton / conformance 全部通过。

## 明确未做

- 不把 memory 做成 provider，不做 project/session 分区。
- 不做第三方 provider 包 loader / 安装流程（Phase 6）。
- 不迁移/删除旧向量文件；不做 ANN/外部向量库。
- 不做 reranker 的 100ms 同步路径，不改变 supersede/T1/最终结果过滤。
- 不改变 `/api/memory/search`、`mafw_search_hybrid`、边界 recall 的契约。

## Rollback

- embedding：把 `memory.embedding.provider` 切回旧值（或 `off`）并重启/热切换；旧 `vectors-<modelTag>.json` / `t1_vectors_v2` 旧维度行保留，切回即可复用。
- 新 provider 初始化失败：runtime 为 null，dense 通道关闭，BM25 继续工作。
- reranker：把 `search.reranker` 设为 `off`；旧 sidecar 由 singleton dispose。
- 代码回滚：回退本阶段提交即可；没有 memory schema/unit 迁移。

## 审查修复（2026-11-13）

- **C1 向量文件被新维度覆盖**：`MemoryVectorStore` 在 dims/version 不匹配时改写到 `-d<dims>-v<version>` 命名空间；旧 unsuffixed 文件保留。补充“新维度写入后切回旧维度仍可读”的测试。
- **C2 热切换旧 runtime 在飞 flush**：`EmbeddingRuntime.dispose()` 取消防抖、`EmbeddingIndexer.close()` 丢弃队列并在 `await` 后拒绝写入；kernel 先 dispose 旧 runtime 再 dispose provider。补充 dispose / 在飞 flush 测试。
- **I2 T1 回滚**：`t1_vectors_v2` 使用 `(model, dims, key)` 复合主键；旧 `t1_vectors` 首次启动复制一次并保留。补充“新维度写入后切回旧维度仍可读”的测试。
- **I1 写时路由旧引用**：抽出 `wireRouteWriteDeps()`，每次 hot-swap 重新绑定；`initServices` 复用。
- **I4 baseUrl 安全**：POST 不再接受 `baseUrl`（返回 400）；自定义 endpoint 只允许 config file 设置，避免任意 endpoint 拿到 API key / SSRF。
- **I5 reranker 引用泄漏**：registry 增加 `retainCreated`；live singleton 使用 `retainCreated:false`；`CrossEncoderReranker.dispose()` 释放模型句柄。
- **I6 embed 输出校验**：`EmbeddingIndexer` 校验向量数量/维度/有限值，非法批次丢弃；`SqliteT1VectorStore` 写入固定 dims。
- **I8 conformance kit 抛错**：空 name / 非法 metadata 转为错误列表；kit 不再抛错。
- **I7 live wiring**：新增 `embedding-live-wiring.test.ts` source pin；完整 kernel hot-swap harness 仍未覆盖（见 Deferred）。
- **Deferred（Important）**：`LlamaCppServerProvider` / `LlamaCppReranker` 在“正在启动时 dispose”的 generation/epoch 竞态未修；代价是极端 hot-swap 时可能遗留一个 sidecar。后续单独处理。

## Minor 修复（2026-11-13）

- **命名空间碰撞**：lossy sanitize 的新 provider 加 8 位 FNV-1a 后缀；内置 provider 显式 `modelTag`，保留既有文件名。
- **metadata 未消费**：`EmbeddingIndexer` 使用 `provider.batchLimit` 作为默认批大小，并用 `maxInputTokens` 收紧文本窗口。
- **no-op reinit**：`lastEmbeddingConfigKey` 相同且 runtime 存在时跳过重建，避免无意义 sidecar 重启。
- **baseUrl 语义**：config / route / SDK 注释明确它是完整 endpoint，不是 base URL。
- **registry 死路径**：`register` 标注为 test/dev seam；live 只解析内置 provider。
- **hot-path 守卫**：从只扫 `recall-context.ts` 扩展为扫描 `src/recall/*.ts` + `routes/recall.ts` 的 import/调用。
- **空输出 reranker**：conformance 对非空输入返回空列表报错。
- **未知 reranker id**：先解析新实例，解析失败保留当前实例，不再先 dispose 再降级。

## 关键 commit

- `a2c9ddb8` feat(memory): add embedding provider metadata and namespace
- `54642000` feat(memory): add embedding provider registry
- `3320021f` feat(memory): inject embedding providers and isolate vector namespaces
- `8c52b0f8` feat(memory): wire embedding provider registry into live runtime
- `bd6fa559` feat(memory): add reranker provider registry
- `e57ed031` test(memory): add embedding and reranker conformance kits
- `383e449b` fix(memory): preserve vector namespaces across provider switches（审查修复 C1/C2/I1–I6/I8）

## Next

Phase 5 剩余：automation trigger/action、goal eval/executor、storage backend 取舍。memory 保持固定产品能力；embedding/reranker 已可替换。
