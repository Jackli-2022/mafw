# 记忆选择的计算骨架：need × gain，以及 2023–2026 的新证据

> 2026-11-19。上一份 `2026-11-19-how-the-brain-selects-memories.md` 讲机制；本文补**计算层**，
> 并对照现有实现找出“我们到底缺了哪一项”。不重复 `2026-09-23-brain-vs-ai-memory-survey.md` 已覆盖的
> CLS、遗忘、再巩固、B1 need×gain 结构。

## 1. 统一公式：priority = need × gain

Mattar & Daw（*Nature Neuroscience* 2018）把“该回放哪条记忆”写成一个可计算的目标：

- **need**：这个状态/记忆在未来有多可能被再次用到（expected future occupancy）。
- **gain**：访问它之后，行为/策略能改善多少（expected policy improvement）。
- **priority = need × gain**。

这条公式能同时解释 forward replay（为即将到来的选择做准备）、reverse replay（奖励后回传价值）、
以及睡眠中的离线回放；它还把“计划、学习、巩固”三种看似不同的回放功能统一到同一个目标下。
2025 年 *Neuron* 的后续工作把它扩展到“未来目标不确定”的情形：回放偏好取决于**估计的未来相关性**，
而不是当前目标。

**对照 MAFW**：`replayPriorityForMemory(e, need) = (1 + log1p(need)) × salience / energy`。
我们已经有 `need`（7 天检索命中次数）和 `energy`（衰减），但**没有 gain**：
所有记忆的 gain 被隐式当成 1。这不是“少一个新鲜度”，而是少了一整项“这次回放能改变什么”。

## 2. 2023–2026 的新证据（按流水线顺序）

### 2.1 编码：清醒回放是“标签”，不是“决定”

- 小鼠迷宫：奖励消耗时的清醒 SPW-R 会重放刚发生的 trial；睡眠 SWR 优先重放**清醒时被标记过**的 trial
  （Yang et al., *Science* 2024）。标签是“短暂重激活”，不是永久重要性评分。
- 情绪唤醒（BLA/NE）提高强度，同时通过 DG 的 miR-134 促进相似事件的**模式分离**
  （*Nature Neuroscience* 2025）；NREM 中 BLA–M2–S1 协调增强记忆（*Neuron* 2025）。
- 好奇/信息缺口：PACE 框架（Gruber & Ranganath, *TiCS* 2019）把“想知道答案”的状态与多巴胺、
  海马编码增强连起来；2020 年的实验进一步显示驱动好奇的是**不确定性**，不是期望价值。
  → 编码标签至少有三类：**唤醒、预测误差、信息缺口**。

### 2.2 回放：RPE 偏置，而不是 reward 或 novelty

- 2025 *Nature Communications*：四种回放策略里，只有 **reward-prediction-error 偏置**能提升学习；
  纯 reward 偏置与随机回放都不行。
- 回放率随经历量（轨迹数/时长）增加、随熟悉度下降（*Nature Communications* 2023）。
- 回放有**自我回避**：刚走过的路径约 3 秒内不被重放（*Science* 2025）；我们的回放没有冷却。
- 清醒回放给睡眠回放“打标签”；睡眠的 SO–spindle–ripple 耦合提供全局时间窗
  （*TiCS* 2024）。

### 2.3 改写：PE 是非单调门

- 没有预测误差的重复激活不会让记忆变得可改写；中等 PE → 再巩固；**过大 PE → 新建/消退**
  （*TiNS* 2019；*Neuroscience* 2026 review）。
- 边界条件：记忆强度比年龄更关键（*Phil Trans R Soc B* 2026）。
- 对我们的含义：`mismatch` 不该只当一个分数，而应是**三路路由**（合并 / 更新 / 新建）。

### 2.4 睡眠的两个化学环境

- NREM：低乙酰胆碱，利于巩固；REM：高乙酰胆碱、低去甲肾上腺素，利于**去情绪化/ depotentiation**
  与皮层整合（*Nature Reviews Neuroscience* 2024；*Communications Biology* 2025 的 TMR 实验甚至发现
  REM 期线索化会削弱记忆）。
- 对我们的含义：raw T1 不该被“去情绪化”，但皮层条目可以去掉一次性情绪色彩，只保留事实与教训。

## 3. 我们已经有什么、缺什么

| 计算项 | 脑/文献 | MAFW 现状 | 判断 |
|---|---|---|---|
| need | 未来占用（goal 相关性） | 7 天检索命中次数 | ◐ 有，但**向后看**（过去被检索 ≠ 未来会用到） |
| gain | 回放后策略改善 | 无（隐式=1） | ❌ 缺 |
| 编码 tag | 清醒 SPW-R / NE / 信息缺口 | salience 三档 + E2 信号 | ◐ 有分数，无**带 TTL 的队列** |
| RPE | reward − 预期 | goal verdict 未接 | ❌ 缺 |
| 冷却 | 3 秒自我回避 | 48h 排除已回放（记忆级） | ◐ 有，但粒度粗 |
| PE 路由 | 小/中/大 → 忽略/更新/新建 | consolidation judge + Laya | ◐ 有 judge，`mismatch` 未参与 |
| 图式一致 | 一致加速巩固 | schemaClusters 未用于写入 | ◐ |
| 睡眠化学环境 | NREM 巩固 / REM 去情绪化 | 每小时固定管线 | ❌ 无阶段区分 |

## 4. 三个可实现的实验（先测量，不急着上生产）

### E-A：把 need 从“过去命中”换成“未来占用”

- 代理：当前 goal / 最近任务的 topic 关键词与记忆锚点的重合度；
- 对比：现有 `needFor`（7 天命中）vs 新 need 的排序差异；
- 指标：下一周该记忆是否被实际检索/引用。

### E-B：给 gain 找一个可算的代理

gain 的定义是“回放后行为改变多少”。在 agent 里可用：
- 同一 cue 的 top-1 与 top-2 检索分数差（**不确定性越大，更新收益越大**）；
- 或 Laya/consolidation judge 的冲突分数（越高，更新越可能改变结论）；
- 先做 shadow：记录 gain 代理的分布，与“该记忆后来是否被更新/取代”对照。

### E-C：编码 tag 队列

- tag 来源：用户纠正、工具错误、未解决问题、goal 失败/重试；
- 队列 TTL 24h；到期未回放则降级（不删 raw）；
- 指标：tag 命中的记忆在 24h 内被回放/反思的比例，以及它们后来的检索命中率。

三个实验共用一套结果标签：**goal verdict / 任务成功失败 / 是否重试**，不再用“unit 是否存在”这种批次代理。

## 5. 结论

- 大脑的核心不是“给每轮打一个新鲜度”，而是 **need × gain 的调度 + 编码标签 + PE 路由 + 睡眠阶段**。
- 我们已经有 need 的骨架（B1），但 need 向后看、gain 缺失、tag 没有队列、RPE 没接——这解释了为什么
  novelty/surprise 怎么调都不过线。
- 下一步最便宜、最有信息量的是 **E-B（gain 代理）+ 结果标签**：它直接补上公式里缺的那一项，
  且不需要新增嵌入或 LLM 调用。

## 参考

- Mattar & Daw, *Nature Neuroscience* 2018, Prioritized memory access explains planning and hippocampal replay.
- *Neuron* 2025, Between planning and map building: prioritizing replay when future goals are uncertain.
- Yang et al., *Science* 2024, Selection of experience for memory by hippocampal sharp wave ripples.
- *Nature Communications* 2025, Post-learning replay of hippocampal-striatal activity is biased by reward-prediction signals.
- *Nature Communications* 2023, The role of experience in prioritizing hippocampal replay.
- *Science* 2025, The time course and organization of hippocampal replay.
- *Nature Neuroscience* 2025, Noradrenergic activation of the BLA facilitates memory specificity.
- *Neuron* 2025, Amygdalo-cortical dialogue underlies memory enhancement by emotional association.
- *TiCS* 2019, PACE framework（curiosity）；*Current Opinion in Behavioral Sciences* 2020（不确定性驱动好奇）.
- *Nature Reviews Neuroscience* 2024, Overnight neuronal plasticity and adaptation to emotional distress.
- *Communications Biology* 2025, Both slow wave and REM sleep contribute to emotional memory consolidation.
- *Trends in Neurosciences* 2019, Prediction error and memory reactivation；*Neuroscience* 2026, Dopamine and reconsolidation.
- 本仓：`docs/research/2026-09-23-brain-vs-ai-memory-survey.md`（B1 与缺口）、
  `docs/research/2026-11-19-how-the-brain-selects-memories.md`（机制版）。
