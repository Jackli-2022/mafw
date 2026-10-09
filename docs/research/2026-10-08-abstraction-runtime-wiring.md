# 抽象层与运行时的接线：双系统的真缺口（W 系列）

> 日期：2026-10-08
> 前序：`2026-10-08-brain-like-roadmap.md` §2.5（双系统并行差距）的修正与深化
> 核心论点：抽象能力不足的真因不在生产侧（蒸馏质量）而在**接线侧**——抽象产物没有结构性通道回到正在行动的 runtime。

## 1. 问题陈述（代码实证，2026-10-08 核查）

我们蒸馏出的抽象（reflection insights / L5 公理 / 失败模式）到达行动中 agent 的通道盘点：

| 通道 | 条件化程度 | 覆盖 |
|---|---|---|
| 边界 recall（`<recall>`） | BM25 查询条件化——**问不到就不出现** | 有机率命中任何条目 |
| pinned `<user-profile>` | 常驻 | 仅身份/偏好（语义上非抽象产物） |
| `<note-board>` | 常驻但用户驱动 | 仅用户叮嘱 |
| L5 公理 | **纯 pull**：`GET /api/l5/axioms` + `mafw_get_axioms` 工具 | 零自动注入 |
| goal snapshot | 常驻但仅 manager | 仅 goal 进度 |

**结论：抽象层（reflection 蒸馏 + L5）与 runtime 之间没有 push 通道。** 对照脑：新皮层的抽象不是"存起来等检索"——预测加工（Friston 自由能）下皮层用 schema **持续预测输入**，抽象在线塑造感知与行动；schema 理论（Bartlett 1932）里感知本身就是 schema 驱动的重构；分层 RL 的 options 框架（Sutton/Precup/Singh 1999）里时间抽象是控制器**直接调用**的可执行结构。

## 2. 业界做法（接线模式目录）

| 工作 | 抽象形态 | 接线方式 | 验证 |
|---|---|---|---|
| **ExpeL**（AAAI-24，arXiv:2308.10144） | 自然语言 insight | **推理时检索注入 acting prompt**——经验学习闭环的教科书实现 | ✅ 已拉取 |
| **AWM**（Agent Workflow Memory，arXiv:2409.07429） | 可复用 workflow（动作例程） | 归纳后**选择性提供给 agent 指导后续生成**；Mind2Web +24.6% / WebArena +51.1%，跨域泛化 +8.9~14.0pt | ✅ 已拉取 |
| Letta/MemGPT | persona/关键事实 core blocks | **常驻上下文** + agent 自编辑——抽象=永在场先验 | 知识库引用 |
| Voyager（arXiv:2305.16291） | 技能库（可执行代码） | 检索后**直接运行**——抽象接进 action 空间而非仅上下文 | ✅ 已拉取（前次调研） |
| Generative Agents（arXiv:2304.03442） | reflection 树 | reflection → planning 直接喂计划层 | ✅ 已拉取（前次调研） |

四种接线模式：**注入式**（ExpeL/AWM：条件化但有任务级触发器）、**常驻式**（Letta：小预算永在场）、**物化式**（Voyager：抽象变成可调用能力）、**规划层式**（GA：抽象直接进 plan）。

## 3. 设计：MAFW 的抽象→runtime 接线（W 系列）

| # | 通道 | 对应业界模式 | 改法 | 基建 |
|---|---|---|---|---|
| W1 | **常驻先验块 `<agent-priors>`** | Letta 常驻式 | system 注入（车道 1 物化，compaction 免疫）：top L5 公理 + top 失败模式 + 能力账本摘要，预算 ~800 字符 | L5Store.getTop 现成；注入点 = system.transform/物化 systemPrompt |
| W2 | **workflow 物化** | Voyager/AWM 物化式 | 高频 procedural 记忆（need 信号）→ 草稿 skill 文件（`.opencode/skills/`）→ 审批进 runtime 原生技能系统——抽象从文本变可调用能力 | need 信号 + 插件 skills 目录现成 |

### 3.1 W2 展开：md ↔ md 同源打通（2026-10-08 用户指出）

**格式同构已验证**：记忆 OKF = frontmatter(type/id/cue_anchors/energy…) + md 正文；SKILL.md = frontmatter(name/description) + md 正文。打通不需要新格式、不需要强模型——**抽象在 curator 写记忆时已完成，物化是机械渲染**。

**渲染映射**：

| SKILL.md | 来源 |
|---|---|
| `name` | slug(primary_abstraction) 或 curator 命名 |
| `description`（触发条件，skill 发现的命门） | primary_abstraction + cue_anchors 拼装 |
| 正文 | memory_value（procedural 已带"→ next time"路标约定） |

**通道设计**：
1. **提升判据**：procedural + 高 need（RetrievalEventBuffer 7 天命中）+ 高 energy + `verified:` 锚点——"被反复检索且验证过的程序性知识"才配成为能力
2. **审批门**：skill 改变 runtime 能力面 → draft 进 staging → triage/人审 → 落 `.opencode/skills/`（项目级）或 `~/.config/opencode/skills/`（跨项目级，按记忆适用范围分流）
3. **闭环**：物化后**记忆变指针**（memory_value 改写为"已物化为 skill:<name>，直接用"——指针优于全文原则的闭环，skill 文件成为 artifact 真相源）；skill 调用出现在轨迹里 → need 信号回流 → 不用的 skill 降级回纯记忆
4. **可逆**：降级 = 删 skill 文件，记忆本体仍在

这条通道补上了"next-time 路标只能指向已存在 skill"的缺口——路标第一次可以指向**记忆自己长出来的** skill。

### 3.2 不是什么记忆都值得做 skill：提升判据体系（脑 + 业界）

用户问题：不是所有记忆都配成为 skill。判据从两侧取证：

**脑（技能固化/习惯形成的条件）**：
- **Schneider & Shiffrin（1977）一致映射**：自动控制只在**一致的 cue→response 映射**下形成；可变映射永远走控制加工——内容高度条件分支化的知识不应固化
- **Anderson ACT-R proceduralization**：陈述性→程序性知识需要**同一程序的反复执行**（练习驱动，非时间驱动）
- **习惯 vs 目标导向双系统**（基底节）：习惯=缓存策略，只在**稳定环境**经重复+奖赏形成；环境多变时保持目标导向（灵活但贵）——在漂移环境里固化习惯会产生自动化错误
- Fitts & Posner 三阶段：cognitive→associative→autonomous，自动化是练出来的不是写出来的

**业界**：
- **JIT 分层编译**（HotSpot）：默认解释执行（=检索），只有**热点**（调用计数超阈值）才编译（=skill 化）；profile-guided 用真实运行数据决策；**逆优化（deopt）存在**——假设失效即回退。最贴切的工业隐喻
- **Voyager**（已验证）：技能入库的门 = **自验证成功**（执行通过才存）
- **AWM**（已验证）：只归纳"commonly reused routines"——跨任务频率是唯一门票
- **Self-RAG**（已验证，arXiv:2310.11511）：检索与否是学出的**自适应决策**（reflection token），不一刀切

**MAFW 提升闸门（五级，全部信号现成）**：

| 闸门 | 判据 | 信号源 |
|---|---|---|
| G1 热度（JIT 类比） | 7 天检索命中 ≥ 阈值 | RetrievalEventBuffer need |
| G2 一致映射 | 内容=确定性步骤序列，非条件分支丛 | curator 提升前结构判断 |
| G3 验证过（Voyager 门） | 带 `verified:` 锚点或关联 goal PASS | cue_anchors / goal_outcomes |
| G4 稳定性 | 近 N 天未被 supersede/修订（漂移中的知识固化=放大错误） | updated_at vs supersede 史 |
| G5 成本不对称 | 检索成本×频率 > skill 化成本；skill description 全进发现面，**列表膨胀会稀释 skill 选择** | 计数即可 |

**逆优化通道（deopt）**：skill 长期不被调用 → 降级回纯记忆；关联记忆被 supersede → skill 回炉修订。习惯可消退。
| W3 | **schema 驱动感知** | Bartlett/Friston pattern completion | 边界 recall 命中 schema 簇时整簇 gist 作为"先验预测"注入 | 依赖 D5（S2 簇已有） |
| W4 | **goal 级先验** | options/GA 规划层式 | plan 节点注入能力账本+失败谱（自我认知 L1/L2 的消费点） | v4.22.0 plan 节点已接线 |

### 关键设计约束

- **W1 预算纪律**：常驻块每轮烧 token，必须小而高浓度（只放 L5/top 失败谱，不放语义细节——细节仍走检索）；内容与 `<memory-guide>` 一样稳定靠前以保前缀缓存
- **W2 审批门**：skill 物化改变 runtime 能力面，必须过人审（triage），防 curator 自举出坏能力
- **测量**：W1 在场 vs 缺席的同 failure-signature 复发率；W2 物化后同类任务完成轮数；先验块 token 成本 vs 避免的重试成本

## 4. 与路线图的关系

A 系列（§2.5）全在**生产侧**（怎么抽象得更好）；W 系列是**接线侧**（抽象如何回到行动）。两侧独立可并行，但 W1 是全部方向里杠杆最高成本最低的——它不要求抽象质量先提升（先接现有的 L5+失败谱，质量随 A 系列跟进）。
