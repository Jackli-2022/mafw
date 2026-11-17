# 大脑如何决定“记住什么、回放什么、何时改写”

> 2026-11-19。触发：MAFW 的 novelty / mismatch / surprise 在扩充验证集上全部接近随机（见
> `docs/research/2026-11-19-memory-worthiness-and-replay-signals.md`）。
> 本文只看神经科学：大脑不是“加一个新鲜度分数”，而是一条多时间尺度、多信号、带门控的流水线。

## 0. 一句话

大脑分三步：**编码时打标签（tag）→ 离线时按“标签 × 预测误差 × 未来相关性”挑选回放 → 回放时按与图式的差异决定“强化 / 改写 / 新建”**。
novelty 只是“打标签”的输入之一，而且它的作用主要发生在**离线调度**，不是在线打分。

## 1. 编码：先打标签，不急着决定去留

- **清醒 SPW-R 是标签机制**：小鼠迷宫任务中，奖励消耗时的 awake sharp-wave ripple 会重放刚刚的 trial；
  睡眠中 SWR 优先重放**清醒时被标记过的** trial（Yang et al., *Science* 2024, “Selection of experience for memory by hippocampal sharp wave ripples”）。
  → 编码时的短暂重激活，决定了哪些经历进入“待巩固队列”。
- **情绪唤醒由 BLA/去甲肾上腺素调制度**：BLA 的 NE 激活让情绪事件记得更强、更久；
  2025 年的工作进一步显示，NE 还通过 DG 的 miR-134 促进**相似事件之间的模式分离**（Nat Neurosci 2025），
  并在 NREM 睡眠中通过 BLA–M2–S1 协调增强记忆（Neuron 2025）。
  → 唤醒不是“更重要”这么简单，它同时调节**强度**和**区分度**。
- **标签有窗口**：人类研究显示，salience 偏置只在训练后一定时间内的睡眠中生效；错过窗口，补觉也挽不回（Nat Commun 2023 引用的睡眠剥夺实验）。
  → 标签必须落到一个**有时间窗的队列**，而不是即时分数。

## 2. 回放：按预测误差和未来相关性挑，不按“新奇”挑

- **RPE 偏置，而非 reward 偏置**：2025 年 *Nature Communications* 的迷宫 RL 实验比较了四种回放策略，
  只有 **reward-prediction-error 偏置**的回放能提高模型预测力；纯 reward 偏置和随机回放都不行。
- **回放速率随经历量增加、随熟悉度下降**：睡眠中某条轨道的回放率与白天跑过的轨迹数成正比，与熟悉度成反比；
  清醒回放的累计次数（受 novelty 与 duration 共同影响）预测哪些记忆在睡眠中被优先回放（Nat Commun 2023）。
  → 这解释了我们测到的“长度/观测数比 novelty 更能预测是否被写成记忆”：**大脑也把“量”当优先级**。
- **回放服务未来相关性**：Neuron 2025 的模型把“当前目标”和“未来可能的目标”统一起来——回放偏好取决于**估计的未来相关性**，不是当前 reward。
- **回放有自我回避**：刚走过的路径在约 3 秒内不被回放，避免立刻自我重复（Science 2025）。
  → 回放调度需要**去重/冷却**，不是每轮都重放最近的东西。
- **睡眠节律是全局调度器**：SO–spindle–ripple 耦合给出时间窗；spindle 密度与图式整合、海马-皮层脱钩相关（Trends Cogn Sci 2024；J Neurosci 2016）。

## 3. 改写：预测误差是“门”，而且是非单调的

- **PE 触发再巩固**：记忆被 reminder 激活后，只有在出现预测误差（预期与实际不符）时才进入可改写状态；
  没有 PE 的重复激活通常不会 destabilize（Sevenster 等；Trends Neurosci 2019）。
- **PE 过大 → 不是改写，而是新建/消退**：少量未强化 cue → 再巩固；大量 → extinction（新学习）。
  → 存在**倒 U 形**：小 PE 忽略、中 PE 改写、大 PE 新建。
- **边界条件**：记忆的强度/年龄会保护它不被改写；2026 年的人体研究进一步指出，**强度**比年龄更关键。
- 多巴胺同时参与 PE、显著新异性和再巩固的门控（Neuroscience 2026 review）。

## 4. 图式：一致就加速，不一致就多回放

- 与已有 schema 一致的新信息，巩固更快、对海马依赖更少（Tse et al. 2007；van Kesteren 等）；
  spindle 密度预测 schema 收益与海马脱钩（J Neurosci 2016）。
- CLS（互补学习系统）：海马快速编码单个 episode，皮层慢速提取统计结构；睡眠回放是两者之间的教师信号。
- 推论：**新信息与图式的一致性，应该影响“回放多少次/是否走海马”**，而不是只影响检索相似度。

## 5. 把大脑的流水线映射到 MAFW

| 大脑机制 | 我们现在有什么 | 缺什么 |
|---|---|---|
| 编码标签（awake SWR / NE） | `salience`（量化 0.35/0.5/0.65）、`novelty`、`surprise` | 标签没有进入**有时间窗的待巩固队列**；没有唤醒/纠正/错误等“重要性”来源 |
| RPE 偏置回放 | 无 outcome；goal verdict 存在但未接 | 用 goal verdict / 任务成败给 episode 打 reward / RPE |
| 回放调度（SO–spindle–ripple、去重、冷却） | 每小时固定跑；`replayPriority = salience × (1+novelty) × 衰减` | 没有 tag 队列、没有冷却/自我回避、没有预算调度 |
| PE 门控的改写（倒 U） | consolidation 有 LLM judge + Laya 冲突门 | `mismatch` 没有参与 update-vs-create；没有“大 PE 新建”的显式规则 |
| 图式一致性 | `schemaClusters` 存在 | 未用于写入/回放优先级 |
| 睡眠窗口 | 每小时/每日 pipeline | 没有“标签后 N 小时内必须巩固”的时限 |

## 6. 建议（按大脑机制，不按分数）

1. **Tag + 待巩固队列**（对应编码标签）
   - 每轮编码时写一个 `replay_tag`：错误、用户纠正、决策、goal 关联、异常输出等事件加权；
   - 进入有 TTL 的队列（例如 24h），到期未回放则降级，不直接丢 raw。
2. **RPE 来自结果**（对应 RPE 偏置）
   - 从 `goal_node_runs` / goal verdict / 任务成败取 reward；
   - 用 `RPE = reward − 预期` 给 episode 排序，而不是用 reward 本身；
   - 没有 outcome 的 episode 用中性值，不猜。
3. **PE 门控的写入**（对应倒 U）
   - `mismatch` 低 → 强化/合并；中 → 更新（reconsolidation）；高 → 新建（pattern separation）；
   - 与现有 consolidation judge 串联，作为**先验/路由**，不是替代 judge。
4. **图式一致性**
   - 新 unit 与 schema cluster 的相似度高 → 少回放、快速并入；低 → 多回放、保留细节。
5. **调度与冷却**
   - 离线窗口（夜间/空闲）批量回放，带预算；
   - 同一 episode 在 N 小时内不重复回放（自我回避）；
   - 回放内容按 tag × RPE × 未来相关性排序，而不是固定小时轮询。

## 7. 结论

- **“多加一个新鲜度”不成立**：大脑的 novelty/surprise 主要服务于**打标签和调度**，不是“值不值得记”的唯一判据。
- 真正决定长期记忆的是：**标签是否留下、有没有 RPE、PE 是否落在可改写的区间、与图式是否一致、以及有没有在窗口内被回放**。
- 对 MAFW，最小可行改造不是再调一个标量，而是：**tag 队列 + outcome/RPE + PE 三路门控**。这三件事都能落在现有 T1/episode/consolidation 结构上。

## 参考

- Yang et al., *Science* 2024, Selection of experience for memory by hippocampal sharp wave ripples.
- *Nature Communications* 2025, Post-learning replay of hippocampal-striatal activity is biased by reward-prediction signals.
- *Nature Communications* 2023, The role of experience in prioritizing hippocampal replay.
- *Neuron* 2025, Between planning and map building: Prioritizing replay when future goals are uncertain.
- *Science* 2025, The time course and organization of hippocampal replay（自我回避）.
- *Nature Neuroscience* 2025, Noradrenergic activation of the BLA facilitates memory specificity for similar events.
- *Neuron* 2025, Amygdalo-cortical dialogue underlies memory enhancement by emotional association.
- *Trends in Cognitive Sciences* 2024, Coupled sleep rhythms for memory consolidation.
- *J Neurosci* 2016, Sleep spindle density predicts the effect of prior knowledge on memory consolidation.
- *Trends in Neurosciences* 2019, Prediction Error and Memory Reactivation: How Incomplete Reminders Drive Reconsolidation.
- *Neuroscience* 2026, Breaking boundaries: Dopamine’s role in prediction error, salient novelty, and memory reconsolidation.
- *Phil Trans R Soc B* 2026, Memory strength at reactivation, not memory age, governs prediction-error-driven updating.
- 本仓：`docs/research/2026-11-19-memory-worthiness-and-replay-signals.md`
