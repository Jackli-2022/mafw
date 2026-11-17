# T1 atom 参数重标定实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.
> Steps use checkbox (`- [ ]`) syntax.

**Goal:** 用业界标准流程（固定切分 + 目标函数 + PR 曲线 + bootstrap CI + 稳定性 + 版本化）重标定 T1 稀疏原子的
`topK / minScore / minTop1 / queryMinScore / referenceSet`，默认行为在验证通过前不变。

**Architecture:** 参数从代码常量迁移到 `atom-params.json`（带 model tag + reference hash + 指标 + CI）；
新增离线标定脚本与标注查询集；encoder/search 从参数集读取；只有 held-out 指标显著更好才切换默认值。

**Spec / 依据:**
- `docs/research/2026-11-19-atom-parameter-audit.md`（现状：24 条参考、阈值不可辨识）
- `docs/research/2026-11-19-industry-calibration-practice.md`（流程标准）

## Global Constraints

- 不改 raw T1、不改检索契约；默认参数必须保持现有行为，直到 Task 6 的门槛通过。
- 参数只从参数集读取，禁止再出现散落的魔法数字。
- 训练/验证/测试分离：测试集只在最终评估用一次。
- 所有指标带 bootstrap 95% CI；CI 跨 0 / 与当前重叠 → 不切换。
- 换 embedding 模型必须重算 baseline 与阈值；参数集与 model tag 绑定。
- 在 `main` 上 native 执行；不建 worktree；不 stage 其他会话文件。

## Review Focus

- 参考文本必须随机/分层，不能是 `sampleTurnTexts` 的前 N 条。
- baseline 的抽样误差必须报告（mean ± SE），不能只报一个数组。
- 阈值必须在 held-out 查询上选；不能用调参集报指标。
- 查询阈值必须来自查询侧分布或 conformal risk control，不能由单例决定。
- 参数切换必须可回滚（旧参数集保留）。

---

### Task 1: 参数集与读取路径

**Files:**
- Create: `gateway/src/recall/atom-params.ts`
- Create: `gateway/config/atom-params.json`（默认 = 当前值）
- Modify: `gateway/src/recall/t1-semantic-atoms.ts`（`select` 默认从参数集读）
- Modify: `gateway/src/recall/t1-search.ts`（`MIN_RETRIEVAL_ATOM_SCORE` 改为参数集读取）
- Test: `gateway/tests/unit/recall/atom-params.test.ts`

**Interfaces:**
```ts
export interface AtomParams {
  version: string;
  modelTag: string;
  referenceHash: string;
  querySetVersion: string;
  topK: number;
  minScore: number;
  minTop1: number;
  queryMinScore: number;
}
export function loadAtomParams(): AtomParams;   // fail-open → DEFAULTS
export const DEFAULT_ATOM_PARAMS: AtomParams;   // 当前线上值
```

- [ ] 写失败测试：默认值等于当前（2 / 0.02 / 0.05 / 0.08）；坏 JSON → 回退默认；`select` 与 `queryMinScore` 使用参数集。
- [ ] 运行并确认失败。
- [ ] 实现参数集、读取与两处接线（保持默认值不变）。
- [ ] 运行测试 + tsc。
- [ ] 提交 `feat(memory): load atom params from a versioned set`。

---

### Task 2: 标注查询集（与参数无关）

**Files:**
- Create: `evaluation/t1/calibration/atom-queries.jsonl`
- Create: `gateway/scripts/build-atom-queries.ts`

**方法（关键：标签不能由原子生成）：**
- 从真实 T1 随机抽 60 个 `user_input` turn，取其 `intent` 文本作为 query；
  正例 = 该 turn 所在 episode 的 `episode_id`（离线记录，不依赖 atom）。
- 另抽 20 个查询，要求不命中任何目标 episode（负例，来自不同 session 的主题）。
- 按 session 切分：40 train / 10 val / 10 test；负例按 2:1:1 分配。
- 每条记录：`{query, sessionId, split, expectedEpisodeId | null, expectedTraceId}`。

- [ ] 写脚本并生成 80 条（标注规则写进脚本注释）。
- [ ] 人工抽查 20 条：query 是否真的指向该 episode；不通过则重抽。
- [ ] 提交 `test(eval): add an atom calibration query set`。

---

### Task 3: 随机参考集与 baseline 估计

**Files:**
- Create: `gateway/scripts/sample-atom-reference.ts`
- Create: `gateway/scripts/fixtures/atom-reference-240.json`（含 ids + 文本 + hash）

**方法：**
- 分层随机：按 `source`（user/assistant/tool/reasoning）+ session 抽样，n=240；
  排除空文本与重复；记录 `sha256(texts)`。
- 计算 baseline：每个 anchor 的 mean ± SE（SE = sd/√n）。
- 同时保留 5 个 24 条的随机子样本，供 Task 5 的稳定性检查。

- [ ] 写脚本，生成参考集与 5 个子样本。
- [ ] 运行，输出每 anchor 的 mean/SE；确认 SE 显著小于 `minScore`（否则先增大 n）。
- [ ] 提交 `test(eval): freeze a random atom reference set`。

---

### Task 4: 标定脚本（PR + bootstrap + Pareto）

**Files:**
- Create: `gateway/scripts/calibrate-atom-params.ts`
- Modify: `gateway/scripts/audit-atom-params.ts`（复用采样/embedding 逻辑）

**方法：**
- 对 `topK ∈ {1,2,3}` × `minScore ∈ {0.01…0.05}` × `minTop1 ∈ {0.02…0.10}`：
  - 在 **val** 上算 recall@3（query → episode）、atoms/turn、弃权率；
  - 对每个配置做 per-query bootstrap（2000 次）→ 95% CI；
  - 输出 Pareto 前沿（recall vs atoms/turn）与候选点。
- 目标：`atoms/turn ≤ 2.0` 前提下最大化 recall@3；平局取更简单（topK 小、阈值高）。
- 输出 `atom-calibration-report.json`（含 CI、样本量、modelTag、referenceHash）。

- [ ] 实现脚本（只读 DB，不写参数）。
- [ ] 在 train+val 上跑出 Pareto 与候选点；测试集保持不动。
- [ ] 提交 `feat(eval): calibrate atom params with bootstrap CI`。

---

### Task 5: 稳定性与查询阈值

**Files:**
- Modify: `gateway/scripts/calibrate-atom-params.ts`
- Test: `gateway/tests/unit/recall/atom-params.test.ts`

**方法：**
- 用 Task 3 的 5 个 24 条子样本 + all-240 分别重算 baseline，重复 Task 4；
  报告最优参数的分布与 stability path（哪些参数在 ≥4/5 个子样本中保持同一选择）。
- 查询阈值：在 train+val 的 query 原子上取分数分布，按目标 FNR/precision 选点；
  用 conformal risk control 计算 `E[loss] ≤ α` 的阈值（损失 = 漏检/误检），在 val 上验证。
- 参数不可辨识（CI 重叠）→ 保留当前值，记录为“未获支持”。

- [ ] 实现稳定性与阈值计算。
- [ ] 运行，输出 `stability` 与 `queryMinScore` 候选。
- [ ] 提交 `feat(eval): check atom parameter stability`。

---

### Task 6: 最终评估与切换门槛

**Files:**
- Modify: `gateway/config/atom-params.json`（只在通过时）
- Create: `docs/releases/2026-11-19-atom-parameter-recalibration.md`

**门槛（全部满足才切换默认）：**
1. test 集 recall@3 提升的 95% CI 下界 > 0；
2. atoms/turn 不高于当前 +10%；
3. 至少 4/5 参考子样本选择同一参数区间；
4. 查询阈值在 val 上达到目标 FNR，且不劣化拒绝率。

不满足 → 参数集保持不变，release note 记录“测量完成、未切换”。

- [ ] 在 test 上评估一次（只一次），写报告。
- [ ] 通过则更新 `atom-params.json` 并保留旧版本；否则不动。
- [ ] 全量 gateway suite、tsc、build。
- [ ] 提交 `docs(release): atom parameter recalibration`。

---

### Task 7（可选，需单独确认）: 接入每日衰减/回填

- 只在新 turn 上用新参数；历史原子**不重算**，除非单独批准（会改变检索结果）。
- 增加 `stats.t1.atoms.paramsVersion`，便于观测。
