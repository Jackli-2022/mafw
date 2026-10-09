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
| W3 | **schema 驱动感知** | Bartlett/Friston pattern completion | 边界 recall 命中 schema 簇时整簇 gist 作为"先验预测"注入 | 依赖 D5（S2 簇已有） |
| W4 | **goal 级先验** | options/GA 规划层式 | plan 节点注入能力账本+失败谱（自我认知 L1/L2 的消费点） | v4.22.0 plan 节点已接线 |

### 关键设计约束

- **W1 预算纪律**：常驻块每轮烧 token，必须小而高浓度（只放 L5/top 失败谱，不放语义细节——细节仍走检索）；内容与 `<memory-guide>` 一样稳定靠前以保前缀缓存
- **W2 审批门**：skill 物化改变 runtime 能力面，必须过人审（triage），防 curator 自举出坏能力
- **测量**：W1 在场 vs 缺席的同 failure-signature 复发率；W2 物化后同类任务完成轮数；先验块 token 成本 vs 避免的重试成本

## 4. 与路线图的关系

A 系列（§2.5）全在**生产侧**（怎么抽象得更好）；W 系列是**接线侧**（抽象如何回到行动）。两侧独立可并行，但 W1 是全部方向里杠杆最高成本最低的——它不要求抽象质量先提升（先接现有的 L5+失败谱，质量随 A 系列跟进）。
