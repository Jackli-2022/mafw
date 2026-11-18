# 2026-11-18 · Implicit Recall 与低置信准入边界

## 结论

一次尝试通过“词级重叠 ≥2、覆盖率 ≥25% 时准入 top-1”把 implicit AUTO 从 2/10 提到 6/10、总量 18/30 提到 22/30，但独立 review 否决，未上线、未提交，所有未提交实现已撤回。

否决理由不是测试失败，而是它改变了既有产品语义：

- 把 `low-confidence` / `no-memory` 重新渲染为普通 `inject`；
- 丢失低置信声明；
- 用非确定性身份证据获取“相关记忆：见下方”；
- 同域负例可以被通用词准入，例如“记忆注入为什么重复”与“记忆衰减与注入频率”共享 `记忆/注入` 两个单位即可通过。

这违反既定约束：普通 no-memory / low-confidence 本体保持抑制，只有确定性 exact title/cue/identifier 证据可以旁路。

## 8 条 implicit miss 的真实分层

在冻结 40 条和当前 live 索引上：

| 类型 | 数量 | 例子 | 真实原因 |
|---|---:|---|---|
| 已在 inject 且命中 | 2 | `implicit-sidecar-health`、`implicit-worker-transcript` | 不是 miss |
| 目标在 BM25 rank 1，但被 FOK 压制 | 4 | field-passing、multisession-gap、unattended-background、live-index-overwrite | 长 paraphrase 使 top1/mean 平坦，分别落于 low-confidence 或 no-memory |
| 目标在 REST 20–30 名，边界 6 候选池外 | 2 | note-board-must-surface、audit-file-line | 候选池/排序问题 |
| 目标不在 REST top50 | 2 | log-redaction、response-language | 检索召回缺口，可能需要更好的 query rewrite 或 dense 通道 |

因此“implicit 差”不是单一问题，不能用一个放宽准入的规则一次解决。

## 为什么不能用 2-unit 规则

离线 40 条确实得到：

- AUTO 18→22
- implicit 2→6
- false injection 0
- agreement 26→30

但 reverse control 只来自远域无答案 query。独立 review 构造同域输入后证明：

- 不同主题但共享两个常见词即可准入；
- 英文停用词过滤后，3 个 common content words 可获得 100% coverage，25% 门槛失效；
- 规则改变后 `no-memory` 被升级为 `inject`，FOK 不确定性和 arbiter 声明都被抹掉。

这说明 40 条 fixture 的增益不能证明规则可泛化。

## 安全选项

### A. 保持抑制，先修 FOK 校准（不改变语义）

目标：识别“top1 确实存在且语义证据充分，只是 top1/mean 变平”的情况，并明确将其分类为一种**带声明的词级准入**，而不是伪装成 confident inject。

若产品允许新增状态，必须同时满足：

- 独立 `status`/marker，例如 `lexical-admission`；
- header/body 明确标注“基于词级证据，未经过语义验证”；
- 只在 FOK 实际评估后发生；
- 与 snapshot cross-encoder 路径分开；
- 有同域负例与英文 held-out 控制集。

这需要用户显式批准新的准入类别，不能静默修改现有 low-confidence 契约。

### B. 保持现有四类状态，只改候选召回/排序

针对 FOK 已经是 `inject` 但目标不在 top3 的 query：

- 分析 note-board/audit 两个 20–30 名目标为何落选；
- 改进 cue/concept expansion 或候选融合；
- 不改变 no/low 本体抑制；
- 先离线重放，再上线。

这类改动可能提高 1–2 条，但不会触碰策略边界。

### C. 真正对话指代另做上下文路径

快照滚动窗口已包含最近 turns，但当前 frozen runner 没有 per-row sessionID。真实“这个/那个/继续”类指代应由 snapshot 的 rolling query 处理，不应在静态 personal-recall 集里伪造成功。

需要单独构造带 session context 的指代评测，验证：

- query 只有代词/短指令时是否使用最近上下文；
- topic-shift 时不会把旧主题带入；
- 100ms fallback 不重新引入昂贵模型。

## 附：只改排序的安全尝试也未保留

在拒绝放宽准入后，又尝试了“连续短语支持因子”：对 BM25×energy×salience 后的 recallK 窗口加最多 +50%，不进入 raw FOK 输入。离线 40 条仅把 `current-mcp-transport` 从 miss 变 hit：

- AUTO 18→19，current-state 6→7；
- exact/implicit/false/stale/agreement 不变。

review 仍否决该实现，原因不是正确性，而是收益/风险不成立：

- 只在短独立问题上有明显份额；真实长 turn 中连续短语占比接近 0，功能基本失效；
- 4 字 CJK bag 本身即可触发接近满额 boost，会放大本切片试图修复的 unigram 偏差；
- 长 query 计算为最坏 O(|q|²)，病理输入实测可达数十 ms；
- 它改变 downstream lexical-support 所见的顺序，因此“admission zone 完全不变”的声明过强；
- 为一个 fixture 行引入无开关的全局排序因子不划算。

该实现及测试未提交，已撤回。当前生产仍是词级 veto 版本，AUTO 18/30、false 0/10。

## 当前保留状态

- 生产仍是词级 veto 版本，false injection 0/10。
- implicit 仍为 2/10，AUTO 18/30。
- 未提交实验中新增的 21 个准入测试和实现已移除。
- 这次尝试作为负结果保留，不把“离线 +4”包装成已交付质量。
