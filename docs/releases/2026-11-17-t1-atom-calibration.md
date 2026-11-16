# 2026-11-17 · T1 atom 校准 + 查询接线 + 历史 turn code 回填

- **分支**：`main`（用户要求不建 worktree/分支）
- **实现 commits**：`6c4563b1`（校准）… `a21e8653`（检索强度下限）
- **设计**：`docs/superpowers/specs/2026-11-17-t1-atom-calibration-design.md`
- **计划**：`docs/superpowers/plans/2026-11-17-t1-atom-calibration.md`

## 问题

两层记忆分离把 embedding 原子写进了 `t1_sparse_terms`，但：

- 12 个 anchor 里默认留下 8 个（67% 密度），无关文本也拿满 8 个；
- 查询侧 `querySparseTermIds` 从不生成 `sem:`，原子只写不读；
- 因此 `sparse` 通道的 0.938 完全是词法 + alias，`intent_shift`（要求原子集合无交集）永远不会触发。

真实 Qwen3 的无关文本 cosine 底噪是 0.34–0.38，`0.35` 阈值低于底噪，这是根因。

## 方案

- **双校正**：`score = (cos - anchorBaseline) - mean(cos - anchorBaseline)`。
  baseline 来自最多 24 条真实 T1 文本（空库回退到 24 条中英通用句）。
- **选择**：top2，`minScore 0.02`，`minTop1 0.05`；低于 top1 阈值时**主动弃权**（0 原子）。
- **查询接线**：查询用同一 encoder 生成原子，作为 `sem:<id>` 进入倒排；写入/查询共享校准。
- **检索精度**：query 与 document 的 `sem:` 原子都要求 `>= 0.08`，弱原子只保留给 episode 边界，不参与检索。
- **边界**：`intent_shift` 从“原子无交集”改为 atom Jaccard < 0.2。
- **回填**：`backfillT1Atoms` 用 `encodeT1Turn` 一次补齐 features/actors/concepts/sparse/atoms；每日 `memory:decay` 续跑 128 条。

## 真实模型效果

`Qwen3-Embedding-0.6B.Q4_K_M`，16 条 fixture query，sparse 通道：

| 模式 | recall@3 | MRR | atoms/turn | 两两重叠 | miss |
|---|---:|---:|---:|---:|---|
| off（词法/alias） | 0.938 | 0.802 | 0 | 0 | `q-parse-holdout` |
| raw `0.35/top8`（旧） | 0.875 | 0.813 | 7.5 | 4.62 | `q-parse-cn`, `q-parse-holdout` |
| **calibrated** | **1.000** | **0.938** | **2.0** | **0.27** | — |

`q-parse-holdout`（`解码失败`）现在通过 `sem:error:json_parse` 命中；旧 raw 规则反而让 `q-parse-cn` 回退。

真实语料 398 turns 的密度扫描：`top2/0.05` 平均 1.21 atoms/turn、38% 弃权，旧 raw top8 是 5.36、重叠 2.87。

## 线上回填（`~/.mafw/memory/gateway.db`）

回填前：4,384 turns，features/actors/concepts/atoms **全为 0**；1,015 个 episode 全部是 `session_end`/`max_length`/`session_start`，0 个 `inferred`。

回填后：

| 指标 | 值 |
|---|---:|
| turns | 4,384 |
| features | 4,384 (100%) |
| actors | 4,173 (95%) |
| concepts | 1,703 (39%) |
| turns with atoms | 3,220 (73%) |
| atoms | 6,332（1–2/turn，avg 1.97） |
| calibration | 12 anchors / 22 reference texts |

episode：2,334（2,321 closed / 13 open）

| boundary | 数量 |
|---|---:|
| `session_end/idle_timeout` | 1,667 |
| `inferred/topic_shift` | 296 |
| `session_start/session_start` | 225 |
| `inferred/intent_shift` | 145 |
| `max_length/max_length` | 1 |

真实查询（`layer=episodes`）：

- `解码失败` → 一个 93–106 的 episode（`sparse`），不再命中 subagent 系统提示；
- `明天天气` → **无 episode**（弱原子被 0.08 下限挡掉）；
- `解析失败` / `覆盖率` / `合并` / `连接重置` → 均返回带 `turn/concept/sparse` 来源的 episode。

## 测试

新增 **27** 个测试（gateway），覆盖：

- 双校正数学：平坦文本 0 原子、hub anchor 归零、top2、`minTop1` 弃权、确定性排序
- encoder：校准只算一次、空参考回退、注入 baseline、两个 provider 独立、fail-open
- 真实 DB 参考文本采样：空库、去重、截断、确定性
- 查询接线：`sem:` 可达、弱原子过滤、全弱弃权、atom 失败不影响词法
- 回填：有界收敛、保留 lexical、零原子标记、encoder 失败不中断
- 边界：大 profile 下 1 个共享原子仍切分、半重叠不切分
- stats：`atoms` / `code` 覆盖字段

门禁：

```text
gateway full     984/984 suites；7866 tests（7864 passed，2 skipped，0 failed）
gateway tsc      rc=0
eval t1 tsc      rc=0
gateway build    rc=0
```

> 注：全量测试与 build 在共享 main 上执行，包含其他会话当时未提交的 `event-outbox`/`lead-outbox` 改动；这些改动 tsc 与全量测试均通过。

## 回滚

| 开关 | 作用 |
|---|---|
| `recall.t1Recall.semanticAtoms='off'` | 写入与查询原子同时停止；词法/概念不变 |
| `recall.t1Recall.denseIndex='on'` | 恢复 dense 融合（与原子独立） |
| `recall.t1Episodes.mode='shadow'` | episode 继续写，不参与召回 |
| `recall.reflectionInput='legacy-episodic'` | reflection 回到旧 episodic 输入 |

原子是 `t1_sparse_terms` 的附加行；`DELETE ... WHERE kind='semantic'` 即回到旧行为。

## 已知限制

- 12 个 anchor 本质是概念分类器，不是 SPLADE 式词表稀疏；真正的稀疏扩展需要 MLM 词头/单独模型。
- 27% 的历史 turn 没有原子（纯代码/工具输出），这些 turn 只靠词法/概念/actor 召回。
- 查询侧多一次 query embedding（约 10–30ms，仅异步 T1 搜索路径，不碰 100ms 边界）。
- episode 仍以“会话边界 + 弱信号”为主；`topic_shift` 296 个、`intent_shift` 145 个，质量需要后续人工抽查。
- 回填脚本是一次性 ops 工具，不在 CI 中；每日只续跑 128 条。
