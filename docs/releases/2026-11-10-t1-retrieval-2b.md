# 2026-11-10 · T1 Retrieval Phase 2B（未部署）

- **分支**：`feat/t1-retrieval-2a`（延续 2A，未合并/未部署）
- **计划**：`docs/superpowers/plans/2026-11-10-t1-retrieval-2b.md`
- **设计**：`docs/superpowers/specs/2026-11-10-t1-experience-knowledge-skill-design.md` §5.2 / §6.1
- **本阶段提交**：`7d490690`（FTS5）→ `2bbec398`（RRF 融合）→ `145da4d7`（自动回填）→ `96215766`（SQLite BLOB）
- **状态**：已实现并通过全量门禁；**尚未部署**

## 交付内容

### 1. FTS5 词面索引

`t1_fts`（FTS5 `trigram`）覆盖 active + archive 原始行：

- 写入 `GatewayDatabase.append()` 时同步插入；归档移动不改内容，因此无需改 FTS。
- `deleteTurn()` / `deleteSession()` 按 `observation_key` 同步删除。
- 构造期若 FTS 为空但源表有行，自动 `rebuildT1Fts()` 一次；重建先清空再导入，幂等。
- `buildT1FtsQuery()` 把用户输入拆成 ≥3 字符 token、逐项加引号并 OR，FTS 语法字符不会注入；无合格 token 返回空。
- `searchT1Lexical()` 用 `bm25()` 排序 + `snippet()` 取证据片段，按 trace 去重。

效果：函数名、路径、错误码、配置键、数字、中文短语等精确串可直接命中，不再只依赖 dense 语义相似度。

### 2. Dense + Lexical RRF 融合

`createGatewayT1Search` 现在并行取两路：

- dense：原 `makeT1Search`（archive 优先、active 回退）。
- lexical：`t1_fts` 查询（`config.recall.t1Recall.lexical`，默认 `true`）。
- `fuseT1Hits` 以 `1/(60+rank)` 融合，同 trace 合并；命中两路的条目排序更高；词面 excerpt 优先。
- 任一路异常/关闭时另一路照常返回；无 embedding runtime 时仍有词面结果。
- `T1Hit` 新增可选 `sources: ('dense'|'lexical')[]` 与 `score`；事件记录使用 `score ?? cosine`。

### 3. T1 向量自动回填

- `GatewayDatabase.listT1RowsForBackfill()`：archive 优先、active 次之，全局 offset 分页。
- `backfillT1Vectors()`：扫描分页、跳过已有 key、文本截断 2000 字符、单次上限默认 200 条。
- 每日 `memory:decay` 在 Harmonic 回填后自动执行；`t1BackfillLimit`（默认 200，0/负数关闭）。
- heartbeat counts 新增 `t1BackfillIndexed` / `t1BackfillMissing` / `t1BackfillFailed`。
- `/api/memory/stats` 已有 `t1.vectors/activeRows/archiveRows/coverage`，现在覆盖率会随回填收敛。

### 4. SQLite 二进制 T1 向量

- 新表 `t1_vectors(key PK, dims, model, vector BLOB, updated_at)`；向量为 little-endian `Float32`。
- `SqliteT1VectorStore` 实现 `VectorStoreLike`：内存 `Map<string, Float32Array>` + 按行 dirty flush，避免每次 flush 重写约 500MB JSON。
- `initEmbeddingRuntime({ vectorDb })` 在 gateway 内默认使用 SQLite 后端；无 DB 句柄（测试/评测）自动回退 JSON。
- 首次迁移：当前 model 在表中无行且 `vectors-t1-<tag>.json` 存在时导入；成功后 JSON 改名为 `.migrated-<ISO>`（保留备份，不删除）；损坏 JSON 不抛出、不改名。
- 回滚：`config.memory.embedding.t1VectorStore = 'json'`。

## 门禁结果

- gateway 全量：`npx jest --runInBand --forceExit` → **740 suites / 5777 tests，0 fail**
- SDK：`cd packages/gateway-sdk && npm test` → **205 tests，0 fail**
- 类型：`cd gateway; npx tsc --noEmit -p tsconfig.json` → **rc=0**
- 根构建：`npm run build` → **rc=0**
- 2B 新增测试：**32**（FTS 10、融合 6、自动回填 8、SQLite 向量 6、decay T1 接线 2；总计从 5745 → 5777）

## 资源预期（一次性迁移）

- 生产 T1 JSON 当前约 **536MB / 68,284 archive 行 / 1024 dims**；Float32 BLOB 理论约 **280MB**（4 bytes × 1024 × 行数），另加 SQLite 页开销。
- FTS5 trigram 索引实测约 **3.5KB/行**（5,000 行合成基准：插入 0.23s、索引约 17.7MB、20 次查询 76ms）；按 68k 行估算约 **240MB** 与数秒级首次重建。
- 首次 SQLite 迁移会在启动期解析旧 JSON（与现状启动解析成本同量级），导入后旧 JSON 改名保留，磁盘峰值会短时叠加。

## 已知限制

- trigram 索引要求查询 token ≥3 字符；1–2 字符查询返回空（不改用 LIKE）。
- 仍是内存暴力 cosine，没有 sqlite-vec / ANN；`Float32` 未量化。
- FTS 索引常驻 `gateway.db`，首次部署的 DB 体积会增加约 200–300MB。
- 首次启动的 FTS 重建是同步的；生产建议部署前在副本上预热一次，或接受数秒级启动延迟。
- 切换 embedding model 后旧 model 的行仍留在 `t1_vectors`（按 model 过滤，不可检索但不自动删除）。
- 仍未实现 T1 activation / ACT-R 强化、provenance 传播、原文重放与 Skill v1。
- 未部署；部署需单独执行并观察首次迁移的日志与内存峰值。
