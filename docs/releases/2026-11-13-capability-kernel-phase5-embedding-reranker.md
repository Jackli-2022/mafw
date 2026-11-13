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
- `MemoryVectorStore` 按 `dims + version` 校验文件；不匹配时跳过旧文件、从空命名空间开始（旧文件保留）。
- `SqliteT1VectorStore` 按 `model + dims` 加载，避免混用不同 embedding space。
- `kernel.initEmbeddingServices` 通过 registry 创建 provider；hot-swap 前 dispose 旧 provider；新 runtime 初始化失败时 dispose 新 provider 并回退 BM25-only。
- `/api/memory/embedding-config`：
  - GET 暴露 `providerId` / `modelTag` / `dims`。
  - POST 接受 `baseUrl`（空或 http(s)），持久化并触发 hot-swap + background backfill。
- 向量是派生数据：换模型只重建向量；旧向量文件保留，切回旧 provider 可直接复用。

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
- **维度隔离**：同 `modelTag`、不同 dims 的旧向量文件不会被加载；旧文件保留，切回旧维度仍可读。
- **版本隔离**：`vectors-*.json` 写入 `version`；旧文件缺省按 v1 读取。
- **失败回退**：embedding init / embed 失败 → dense 通道关闭或 `computeDenseScores` 返回 null，BM25 仍可用；reranker 失败/不可用 → 未精排结果。
- **模型/API/本地/策略**：由 provider 工厂与 config 选择，不引入第三方包 loader。

## 验证

- 本计划新增 **21 个测试**（embedding metadata/registry/runtime/namespace/route/switch、reranker strategy/registry/hot-path/conformance）。
- gateway 全量：**7098 passed / 1 skipped / 7099 total**（904 suites）。
- gateway typecheck：`npx tsc --noEmit -p tsconfig.json` 退出 0。
- 定向回归：embedding runtime / vector store / T1 / embedding-config / reranker factory / singleton / conformance 全部通过。

## 明确未做

- 不把 memory 做成 provider，不做 project/session 分区。
- 不做第三方 provider 包 loader / 安装流程（Phase 6）。
- 不迁移/删除旧向量文件；不做 ANN/外部向量库。
- 不做 reranker 的 100ms 同步路径，不改变 supersede/T1/最终结果过滤。
- 不改变 `/api/memory/search`、`mafw_search_hybrid`、边界 recall 的契约。

## Rollback

- embedding：把 `memory.embedding.provider` 切回旧值（或 `off`）并重启/热切换；旧 `vectors-<modelTag>.json` / T1 rows 保留，切回即可复用。
- 新 provider 初始化失败：runtime 为 null，dense 通道关闭，BM25 继续工作。
- reranker：把 `search.reranker` 设为 `off`；旧 sidecar 由 singleton dispose。
- 代码回滚：回退本阶段提交即可；没有 memory schema/unit 迁移。

## 关键 commit

- `a2c9ddb8` feat(memory): add embedding provider metadata and namespace
- `54642000` feat(memory): add embedding provider registry
- `3320021f` feat(memory): inject embedding providers and isolate vector namespaces
- `8c52b0f8` feat(memory): wire embedding provider registry into live runtime
- `bd6fa559` feat(memory): add reranker provider registry
- `e57ed031` test(memory): add embedding and reranker conformance kits

## Next

Phase 5 剩余：automation trigger/action、goal eval/executor、storage backend 取舍。memory 保持固定产品能力；embedding/reranker 已可替换。
