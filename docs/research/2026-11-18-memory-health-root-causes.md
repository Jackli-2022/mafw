# 2026-11-18 · 记忆系统健康检查根因记录

## 范围

由三个 `gateway/volcengine/deepseek-v4.1-flash` 子代理分别只读调查：Harmonic/T1 向量覆盖、边界召回延迟、implicit answerability verifier。调查未修改生产代码、未写数据库、未重启 Gateway、未运行全量回填。

 live 状态：Gateway v5.1.0，PID 47436，HEAD `6cec31a05`；运行 payload 是仓库 `gateway/dist`，其 `gateway/src` 与 HEAD 一致。

## 1. Harmonic 向量覆盖 >100%

### 对账结果

调查时快照为 17,029 个 index id、17,474 个向量 key：

- 非 superseded 条目 11,692，**11,692/11,692 有向量**；
- 543 个向量 key 不在当前索引，其中 541 个可在路由审计里找到；
- 这 541 个中 529 个来自 `verdict=skip, decidedBy=dup`；
- 98 个索引条目没有向量，全部是 superseded；
- 算术闭环：17,474 - 17,029 = 543 - 98 = 445。

因此 >100% 不是 live 条目缺向量，而是统计分子/分母不是同一集合，且确有孤儿向量。

### 根因

- `gateway/src/routes/memory.ts:113-114,259-261` 直接计算 `vectors.size()/entries.length`，没有求交；`gateway/src/kernel.ts:2556-2568` 有第二份同口径公式。
- `gateway/src/memory/route-write.ts:95-105` 在 `decideRouting` 中为了搜索候选先 `vectors.upsert(unit.id, vec)`；随后 skip 分支不写条目，临时向量成为孤儿。这占当前可解释孤儿来源的绝大多数。
- 其它硬删除路径也有不删向量的残留，但不是本次主要来源；首个修复不声称覆盖所有历史路径。

### 当前影响

live 条目覆盖实际为 100%。孤儿在 dense topK 中浪费少量槽位，随后会被 Harmonic 检索过滤，不会作为未知 id 返回。

本轮不修数据、不 prune；先阻断新增孤儿并修正诊断口径。

## 2. T1 向量覆盖约 62%

调查时快照：52,319 vectors，84,396 active+archive rows，覆盖率 61.99%。

- 分母是物理行，分子是唯一内容 key；2,538 行与别行共享 key，因此该口径理论上限约 97%。
- 真缺口为 29,882 行 / 29,540 唯一 key，主要集中在 8–9 月历史归档；active 行缺向量为 0。
- 每日 `memory:decay` 回填上限 3000；当前没有停摆证据，但按该速度约需 10 天。
- `t1-backfill.ts` 当前把 queued 数直接报告为 indexed，flush 部分失败时可能高报。
- `gateway-db.ts:listT1RowsForBackfill` 用全部 archive 行数计算 offset，却只 select `observation_key IS NOT NULL`；当前 NULL=0，所以是潜在尾页跳过缺陷。
- T1 dense 当前是 `shadow`，不进入融合；61.9% 不影响今天的生产召回结果。

本轮只修真实落盘计数、分页边界和统计标注。是否补齐全部历史，必须先统一“近端 12k 窗口”与“全历史”策略，不能为好看而跑 3 万条嵌入。

## 3. 边界召回延迟

### 已复现

同一 dist 模块 + 同一索引的只读重放与 live 请求一致：

- 23 字 English 短查询：live search 约 84ms；
- 538 字 CN+EN 查询：约 379–400ms；
- 685 字 English 查询：约 371ms；
- 冷进程第一次查询可到 1.5–1.7s；快照 served 时 search=0ms。

receipt 在响应后 `setImmediate` 持久化，不是本轮慢查询根因。

### 主要根因

`searchRecallMemories` 的基础搜索之外，`expandQuery` 最多再做 4 次 `searchScored`。当前每次调用都重复执行图扩展：

- 每 pass 最多 50 个 seed；
- 每 seed 分别做一次 anchor 与 coactivation SQLite 查询；
- 538 字查询为 5 pass × 100 = **约 500 次同步 SQL**；
- 实测 graph ON 的 `searchRecallMemories` 约 275–289ms，graph OFF 约 100–107ms。

另一个独立成本是 `findExactRecallEvidence`：长 no-memory query 会做三轮全库元数据扫描， warm 约 50ms、cold 约 89ms。

### 首个修复变量

只让 4 个 secondary expansion pass 使用已有的 `graphExpand:false`；基础 pass 的图扩展保持不变。目标是把 538 字查询从约 379–400ms 降到约 150–200ms，同时固定 40 条质量不得回退。

不在同一切片修改 FOK、topK、recency、snapshot、note-board 或 graph seed 数。exact-evidence 缓存与冷启动 prewarm 留待本次单变量结果后决定。

## 4. implicit / verifier 测量的阻断发现

- 固定 40 条 AUTO 不带 sessionID，因此只测 live BM25 路径，snapshot/topic/goal 均不参与。
- 上次 CE 实验用裸问句打分；生产 snapshot 使用最近 4 个逻辑轮 / 600 字窗口，两者不是同一输入分布。
- `fok-samples.jsonl` 里部分目标已曾在 inject-zone 快照出现，不能把 live-path 2/10 解读为真实会话从未展示。
- 24 个 CE 错误中，22 个至少缺一个问句点名的实体或数值；只有 2 个是所有值都在但谓词错误。

因此当前不实现生产 answerability verifier。下一步若继续，应先建立**独立的 session-shaped snapshot 评测**，不能改动固定 40 条来假装改善；再决定是否值得做模型实验。

## 5. 明确不做

- 不自动展示普通 low/no-confidence 或 lexical clue；
- 不清理/重写现有向量库，不运行全历史 T1 backfill；
- 不把 CE 的 4/4 恢复当成可上线证据；
- 不覆盖工作区其他会话的未提交改动。
