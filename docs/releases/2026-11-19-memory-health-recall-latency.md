# 2026-11-19 · 记忆向量完整性、T1 计账与 live recall 图扇出修复

## 交付标识

- Gateway 版本：**v5.1.0**
- 本切片代码提交：
  - `8ba50415c` — route-write 仅在成功写库后发布局部向量
  - `6a1ad5897` — active 向量覆盖统计、孤儿诊断与契约产物
  - `8e013c43e` — T1 flush 确认计数
  - `5819070cb` — T1 non-null 分页边界
  - `92e9ea57c` — secondary expansion 图扇出初版
  - `1e709122b` — 最终 review 修复：snapshot 保持 legacy、向量新鲜度守卫
- 根因与计划：`docs/research/2026-11-18-memory-health-root-causes.md`，计划提交 `6bb321720`。
- 构建/重启时共享 HEAD：`71d31a588`（含并行会话的后续 client-channel/session-ui 提交；这些不属于本切片）。
- 运行验证：Gateway v5.1.0，PID 2332，instance `984ff9e4-c484-4125-830a-07305ee7d819`，health `ok`。
- 全部提交仅在本地 main，**未 push**。

## 1. 修复内容

### Harmonic 向量写入

`decideRouting` 不再为尚未决定落盘的 unit 写共享向量库。按需计算的局部向量通过内部回调交给 `routeAndWrite`，只在 `store.write` 成功后、目标 id 仍无向量时发布：

- skip（含 provenance reinforce）不发布新 unit 向量，阻断主要孤儿来源；
- create/redundant/separate/update 成功写库后立即可参与下一次路由去重，不等待约 2 秒 indexer flush；
- 写库 reject 不发布；
- 若 indexer 已在写库期间写入精确向量，不覆盖它。

没有清理历史孤儿，没有修改其它硬删除/merge/unmerge 路径。

### 覆盖率统计

新增 `computeHarmonicVectorCoverage`，`memory.stats` 与 embedding runtimeState 共用：

- `coverage = activeWithVectors / activeEntries`，active 为 `!superseded_by`；
- `vectors/indexEntries` 保留 raw 计数；
- `rawCoverage` 不 clamp，继续暴露旧口径异常；
- 新增 optional `activeEntries/activeWithVectors/orphanVectors/rawCoverage`；
- gateway schema、route interface、SDK 类型和三类 checked-in 契约产物同步，旧 required 集不变。

重启后实测：activeEntries=11,730、activeWithVectors=11,730、coverage=1；vectors=17,514、indexEntries=17,090、orphanVectors=545、rawCoverage≈1.0248。孤儿仍来自历史和其它未修路径，不能解读为已清零。

### T1 backfill

- `T1BackfillResult` 区分 queued 与 flush 确认的 indexed；flush reject 时 indexed=0、failed=queued。
- `listT1RowsForBackfill` 的 archive 计数与 SELECT 都采用 `observation_key IS NOT NULL`，避免跨 archive→active 边界重复。
- 文档明确 T1 indexer 是共享队列，flush 可包含同期 live 捕获；不存在 `indexed + failed <= queued` 的严格不变量。

本轮**没有运行真实 backfill/decay/embed**，没有提高 T1 实际历史覆盖率；dense 仍为 `shadow`。

### live boundary 图扇出

最终行为通过 `secondaryGraphExpand` 分开：

- 默认/true：secondary 调用不传 `graphExpand`，保持 legacy；R8 snapshot builder 未改，行为与优化前一致。
- 仅 live `GET /api/recall/context` fallback 传 `secondaryGraphExpand:false`。
- 基础 pass 的图扩展、FOK、topK、recency、note-board、dense、scan、graph seed 均未改。

关闭 secondary graph 不是纯成本变化：graph-only 邻居不再进入 secondary 候选池，组内打分也会变化。质量结论只来自 paired 实测，不声称语义等价。

## 2. 质量验证

### 当前 BASE 漂移

早期已验证基线 18/30 在本轮执行前已因语料/能量状态变化降到 17/30。`implicit-sidecar-health` 的 FOK ratio 1.3473 低于 high=1.35，导致 AUTO/implicit/agreement 各少 1；HEAD before 也同样 miss。因此本切片采用**同一语料 paired 零回退 + live before/after**，不把无关漂移算作本改动回归。

### 离线固定 40 条 paired

同一冻结 17,047-entry 语料，真实模块，before/after 0 flip：

| 指标 | before | after |
|---|---:|---:|
| AUTO hit | 17/30 | 17/30 |
| exact / current-state / implicit | 10/10 / 6/10 / 1/10 | 10/10 / 6/10 / 1/10 |
| false injection | 0/10 | 0/10 |
| stale injection | 0 | 0 |
| agreement | 25/30 | 25/30 |
| REST hit@1 / hit@3 / MRR | 63.3% / 73.3% / 0.672 | 63.3% / 73.3% / 0.672 |

Snapshot 未跑 CE/embedding 质量实验；它由默认调用形状测试保证仍走 legacy secondary graph。

### 重启后 live 40 条

Before artifact：`C:\Users\15524\AppData\Local\Temp\opencode\personal-recall-before-graph-fanout.json`。
After artifacts：同目录 `personal-recall-after-memory-health.json`、`personal-recall-after-memory-health-warm.json`。

| 指标 | live before | live after | live after warm |
|---|---:|---:|---:|
| AUTO hit | 17/30 | 17/30 | 17/30 |
| exact / current-state / implicit | 10/10 / 6/10 / 1/10 | 同左 | 同左 |
| false / stale | 0/10 / 0 | 0/10 / 0 | 0/10 / 0 |
| agreement | 25/30 | 25/30 | 25/30 |
| REST p50 / p95 | 32 / 44ms | 33 / 48ms | 32 / 38ms |
| AUTO p50 / p95 | 164 / 242ms | 171 / 274ms | 162 / 226ms |

`exact-search-recall-memories` 的 after 候选尾部出现一条新写入的相关记忆 `gsouyr` 及邻居，目标仍 rank 1；这是测量间语料生长，不是命中/false/stale 回退。

**100ms 边界仍未达标。** 固定 40 条多为短查询，不应用其整体 p50 否认或夸大长查询优化。

## 3. 性能证据

离线同进程、3 轮预热 + 15 轮交替：

| 查询 | before p50/p95 | after p50/p95 | base / secondary 图 SQL |
|---|---:|---:|---:|
| 538 字 CN+EN | 288.4 / 303.4ms | **144.9 / 153.8ms** | 100 / 100 → 100 / 0 |
| 685 字 English | 266.2 / 273.7ms | **127.2 / 143.7ms** | 100 / 100 → 100 / 0 |

短/中查询没有 secondary pass，无显著变化。长查询约 2× 改善只适用于该离线形状；live 首轮/热态整体 AUTO 延迟见上，不能合并成单一收益数字。

## 4. 测试与构建

- **新增测试：31 个**（route-write +7；coverage/route/contract +16；T1 backfill +2；expansion graph +6）。
- 父会话最终 focused：**6 suites / 352 tests，352 passed，0 failed**。
- 子代理最终 fix-wave focused：118 suites / 853 tests 全通过；recall 路由/挂钩 5 suites / 37 tests 全通过。
- Gateway 与 gateway-sdk：`npx tsc --noEmit -p tsconfig.json` 均 exit 0。
- `npm run build`：成功；随后完成 Gateway restart 与上述 live 验证。

### 全量 suite 实际状态（不是全绿）

`npm test -- --forceExit` 的 Jest 汇总：

- **1055 suites：1051 passed，4 failed**；
- **8506 tests：8497 passed，7 failed，2 skipped**；
- 测试汇总完成后进程因既有异步句柄未退出，外层 1200s 命令超时。

失败项：
- `runtime/prompt-budget-wiring.test.ts`
- `runtime/architecture-boundaries.test.ts`
- `architecture/legacy-route-inventory.test.ts`（2 个失败断言）
- `runtime/validate-shape.test.ts`（3 个失败断言）

这些文件及其指向的 runtime/transport 实现不在本切片 diff；本切片 focused 与类型/构建门均通过。不得将本轮汇报写成“全量测试全绿”。

## 5. 残留与后续

- 100ms 实时契约仍需独立切片；可再评估 exact-evidence corpus cache 和冷启动 prewarm，一次只改一个变量。
- 历史孤儿向量与其它硬删除路径未修；prune 属于数据操作，需单独 dry-run/备份。
- T1 历史覆盖与“近端 12k vs 全历史”策略仍未统一；本轮不做 3 万条嵌入。
- implicit 需要独立 session-shaped snapshot 评测；固定 40 条继续只代表无 sessionID 的 live 路径。
- 共享 main 的 7 个全量测试失败应由对应 runtime/transport 改动所有者处理，不在本切片顺手修改。
