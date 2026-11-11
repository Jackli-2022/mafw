# Project Agent Workbench — Stage-first 设计

日期：2026-11-12
状态：产品方向已确认；本文用于实现规划
关系：扩展 `2026-11-11-project-agent-workbench-experience-design.md`。与其信息架构冲突处，以本文为准；Goal / 验收 / 评审项的权限语义不变。

## 1. 意图与问题

MAFW Desktop 已经具备 Project、Lead / Tech Lead、Goal、Pod、文件预览、编辑、批注、评审项和验收。但工作台的呈现仍然是**容器导航**：

- `project / goal / content / review` 四个 context 混用了 scope、subject、lens 三个维度；
- 项目首页是一个必须进入的 dashboard，而不是恢复点；
- 文件树、全局 L2、编辑器 Tab、内容 scope 标题栏、执行抽屉层层叠加；
- 审阅是一个目的地，切换后丢失当前对象；
- 执行抽屉覆盖右栏头部，破坏“我在哪”的连续性；
- Chat 同时承担对话、委托、监控、配置、文件导航，标题栏变成控制面板。

本设计从第一性原理重新推导工作台和人与 Agent 的关系。核心判断：

> **Chat 决定工作是什么，Workbench 证明工作是什么，Agent 执行，人验收。**

工作台不是 dashboard，是**精密仪器**：它只回答“实际是什么、哪一版、改了什么、是否可信”。Chat 允许模糊，工作台不允许模糊。

## 2. 已确认的决定

以下为用户在 2026-11-11 / 2026-11-12 讨论中明确确认的方向：

1. **Chat 是决定工作的地方**，不是通用控制台。
2. **一个仓库 = 一个世界**。本轮不引入 workspace + roots 多根模型。
3. **保留 Lead 聊天、Goal、Tech Lead**；它们是有效的产品骨架。
4. **工作台采用框 / 台 / 镜 / 械 / 栈 / 取六个原语**，不再使用四个平级 context。
5. **项目是 scope / frame，不是页面**；项目首页不再是默认目的地。
6. **审阅是变更集的镜头**，不是同级目的地。
7. **人类专属验收、评审项状态权威、revision 隔离、PASS 不自动合并**保持不变。
8. **Agent 可以自主，但不能自决；可逆归 Agent，不可逆归人。**

以下为本文推荐、但尚未被用户逐条确认的决定，builder 可以按此规划，但应在实现前标注为“推荐默认”：

- 新 Goal 默认授权级别 **3（批准后执行）**；可逆、低风险、范围明确的工作可显式升到 **4（授权内自主）**；**5（自决）永远不允许**。
- 现有 Goal 形态映射：`standard → 3`，`quick → 4`（窄范围、可逆、跳过独立 Reviewer），`standing → 4`（预批准 standing mandate；当前 gateway 仍返回 501，设计先保留映射）。高风险（merge / delete / schema / 安全 / 保护分支）始终升级给人。
- 世界身份使用稳定 id（仓库内 marker 或 remote + 初始 commit 派生），路径只是位置。
- 保留一个**可打开的世界总览**作为兜底 subject，但默认不打开；没有焦点时优先进入取景器。
- 正式决定只给不可逆、高成本、歧义或阻塞的事项做卡片；其余走“带假设的委托”。
- `discussing` Goal 草稿可以按现有 P0 流程直接创建；**进入执行前**必须看到委托单预览。这样既不回退“无创建前确认”，也不让 Agent 在未确认的情况下开始工作。
- 工作台焦点变化**不静默切换 Chat 线程**；Lead → Tech Lead 的 handoff、或用户显式点“与 Tech Lead 讨论”才切换。检查 Goal 变更集时，Chat 保持原线程，composer 显示当前 scope chip 和切换入口。
- 用户模式（导演 / 协作者 / 审阅者 / 操作者 / 所有者）从表面与意图派生，不是持久全局状态；模式改变 Agent 行为与可用动作，不改变底层权限。

## 3. 目标

- 工作台任意时刻只有**一个对象**在台上，框始终说明世界、scope、对象、版本和状态。
- 换镜不换台：阅读、变更、证据、审阅、决定是同一对象的不同问题。
- 审阅不再是一个页面：队列在械，锚点在台，决定在记录。
- 返回是弹栈，恢复 scroll / selection / lens，而不是回首页重新找。
- 导航收进取景器（⌘P），文件树、Goal 列表、最近内容不再常驻抢舞台。
- 项目是框，不是房间；打开项目回到上次焦点，没有焦点才进取景器。
- Chat 的产物是决定，不是回复；决定有 board、episode、record、work order。
- Agent / 用户契约可见：mandate、autonomy、escalation、human-only 边界。
- 保留现有好体验：文档直开、预览/固定 Tab、分屏对照、跨重启持久化、Goal 详情注意力顺序。

## 4. 非目标

- 不做多根 workspace；一个 Goal 不跨世界。
- 不改变 NodeDriver / run 的基本执行语义。
- 不提供 Agent / MCP 代理人类验收、风险接受、评审项解决或合并的路径。
- 不默认暴露完整执行轨迹、工具调用、节点日志、session id、runtime 名。
- 不在本文确定具体组件拆分、数据库 DDL、事件名、最终像素尺寸。
- 不做跨项目个人 Agent；委托契约模型可以向上扩展，但本轮不实施。

## 5. 反目标

即使功能齐全，以下情况也算失败：

- 用户必须理解 Pod、隐式 Session 或 runtime 角色才能推进工作。
- 切换镜头后对象被销毁，或 scroll / selection 丢失。
- 审阅需要离开当前变更集，进入另一个页面。
- 项目首页仍然是必须经过的 dashboard。
- Agent 可以自行把人的评审项标成已解决，或自行验收。
- 执行状态比结果、变更和证据更显眼。
- 旧版本内容被展示为当前版本。
- 每条消息都变成决定卡，产生决定疲劳。
- 用户需要管理文件树、Tab、context 才能找到对象。

## 6. 硬约束与不可退化边界

- 数据根 `~/.mafw`；统一数据层 `~/.mafw/memory/gateway.db`。
- 业务核心只经 `RuntimeAccess` / runtime facade；客户端只消费 MAFW View DTO + Experience Action。
- 不向客户端暴露 runtime 名、内部能力位、隐式 Session ID。
- 人类专属验收：请求带 `actorSessionID` → 403；不提供 MCP 验收工具。
- 计划批准绑定 `planHash` / `evalHash`；计划被编辑自动作废旧批准。
- Review 必须逐 task + 逐必需 Goal 条件给结果与证据；漏项 / 证据空 → FAIL。
- 每个 Goal revision 一个 worktree / branch；PASS 不自动合并，人工验收才 merge。
- 评审项状态真相在 Goal，不在 Chat；Chat 只是投影。
- 桌面 UI 只使用 `@mafw/ui` v2 组件与主题 token；禁止新增裸 `<button>` / `<input>` / 裸 `title`。
- 主题只有一套 token；禁止硬编码色值。
- 跨重启状态按世界 / scope / root 隔离，存储失败 fail-open。
- `SessionCreateOpts.directory` 必须是绝对路径；runtime 使用 `requireSessionDir`。
- 缺失能力返回中性 503；文案不含 runtime 名与 capability flag 名。

## 7. 世界模型

### 7.1 一个仓库 = 一个世界

- `Project` 在本轮等价于 repo / world。
- 世界身份应与路径解耦：推荐仓库内 `.mafw/project.json` 的稳定 id，或 remote + 初始 commit 派生。当前 `Project.id` 是 `projectDir`，仓库移动会断身份；builder 可在迁移阶段处理，但新设计不应把路径当身份。
- 世界的分层：

| 层 | 内容 | 工作台用途 |
|---|---|---|
| 身份 | 名字、root、remote、稳定 id | 框 |
| 状态 | HEAD、branch、worktree、dirty、untracked | 框 |
| 物质 | 文件、目录、产物 | 台 |
| 历史 | commit、revision、baseline | 镜（变更） |
| 语义 | 约定、记忆、决定、术语 | 框 / 械（引用） |
| 工作 | Goal、thread、review item、decision | 取 / 镜 |
| 政策 | 权限、配额、团队 | 械（门禁） |

### 7.2 Scope

```text
World (repo)
  └ Scope: project main worktree | goal revision worktree
      └ Subject: file | change set | goal | review item | evidence | web | terminal | plugin
          └ Lens: orient | read | edit | changes | evidence | review | decide | interact
```

- 项目主目录是默认 scope。
- Goal revision worktree 是显式 scope；只有从 Goal 结果 / 变更进入时才切换。
- worktree 不是新世界；它是同一世界内的 scope。
- Goal 不跨世界。跨仓库工作必须开另一个世界；本轮不支持。

## 8. 焦点模型

工作台的状态不是 context，而是一组焦点：

```ts
type Focus = {
  scope: Scope
  subject: SubjectRef
  lens: Lens
  place: Place
}

type Place = {
  scroll?: number
  selection?: unknown
  anchor?: unknown
  split?: SubjectRef
  filter?: unknown
}

type WorkbenchState = {
  worldId: WorldId
  stack: Focus[]
  kept: SubjectRef[]
}
```

派生关系：

```text
Frame       = f(world, scope, subject)
Stage       = f(subject, lens)
Instruments = f(subject, lens, role)
```

UI 不拥有独立状态；框、台、械都是焦点栈的投影。任何面板不得与框断言矛盾。

## 9. 对象模型

### 9.1 Subject 类型

| Subject | 身份 | 默认镜 | 框显示 | 械 |
|---|---|---|---|---|
| World 总览 | worldId | orient | world · state | 继续 / 需要你 / 浏览 |
| Goal 总览 | goalId | orient | world / goal | 提问 / 计划 / 结果 |
| 文件 | root + rel + version | read | world / scope / version | 编辑 / 批注 / 变更 / 引用 |
| 变更集（项目） | worldId + baseline（HEAD） | changes | world / project / baseline | diff / 批注 / 引用 |
| 变更集（Goal） | goalId + revision | changes | world / goal / rev | 队列 / 证据 / 审阅 / 决定 |
| 评审项 | id + anchor | decide | world / goal / rev / file | 解决 / 重开 / 回应 |
| 证据 | id | evidence | world / goal / rev | 打开 / 对照 |
| 网页 | url | interact | world / external | 导航 / 截取 / 引用 |
| 终端 | sessionId | interact | world / scope | 运行 / 截取 / 引用 |
| 插件 | pluginId + surface | interact | world / plugin | 插件动作 |

**项目不在这个表里。** 项目不是 subject，它是 frame。世界总览是 subject，但它是兜底取景器，不是项目页面。

项目主目录的直接编辑产生“项目变更集” subject，baseline 为 HEAD。它没有 Goal 归属，不进入 Goal 评审项状态机；只有人显式交给 Lead / Goal 时才进入委托与验收闭环。这延续 `2026-11-11-project-agent-workbench-experience-design.md` §7.6。

### 9.2 框

框只有一行，最多两行：

```text
世界 / scope / subject · version · state · relations
```

例子：

```text
MAFW / 项目文件 / docs/architecture/desktop.md · HEAD · clean
MAFW / Goal X · rev 3 / src/a.ts · dirty · 2 unresolved
MAFW / Goal X · rev 3 / 变更集 · 12 files · PASS
```

框必须在任何时刻回答：

- 我在哪个世界；
- 什么 scope（项目主目录 / Goal revision）；
- 看的是什么对象；
- 什么版本（内容版本 / revision / commit）；
- 什么状态（dirty / stale / read-only / conflict / unresolved / verdict / external）；
- 和谁有关（produced by / referenced by / belongs to）。

框是真相层。任何浮层、抽屉、分屏、插件面板都不得盖住框。

### 9.3 镜

| 镜 | 问题 | 适用 |
|---|---|---|
| orient | 这里有什么、我该做什么 | World / Goal |
| read | 它是什么 | 文件 / 文档 |
| edit | 我要改它 | 文件 |
| changes | 它改了什么 | 变更集 / 文件 |
| evidence | 凭什么相信 | 变更集 / Goal / 证据 |
| review | 哪里有问题、是否解决 | 变更集 / 文件 / 评审项 |
| decide | 接受、打回、承担风险 | Goal / 变更集 / 评审项 |
| interact | 操作它 | 网页 / 终端 / 插件 |

规则：

- 镜是问题，不是位置。
- 换镜默认只替换 lens，不改变 subject，不入栈。
- 如果当前 subject 不支持该镜，派生合适的 subject 并 push。例如 Goal 总览点“变更” → 进入 changeSet。
- 镜只显示当前 subject 适用的项；数量是状态，不是导航。
- 镜切换必须保留 place（scroll / selection）。

### 9.4 台

- 台只放一个 subject；分屏是显式的一对 subject。
- 台是最大面积；文档、diff、锚点、决策记录是主角。
- 文件：代码 / Markdown / 图片 / PDF / Office / CSV / SVG 等由 viewer 选择。
- 变更集：diff 摘要 / 逐文件 diff / hunk。
- 评审项：带锚点的文件 / diff，评审项在械里展开。
- Goal：总览叙事（承诺、注意力、进度、结果、证据、历史）。
- World：兜底取景器 / launchpad，不是 dashboard。
- 网页 / 终端 / 插件：各自 surface；框上标明 external / terminal / plugin。
- 台不拥有导航；文件树、Goal 列表、最近内容都不常驻。
- 台的 scroll / selection / split 存在 `place`，由栈恢复。

### 9.5 械

- 械从 `subject + lens + role` 派生，只显示当前有效的动作、证据、批注、队列、决定。
- 文件 read：批注、编辑、保存、引用、相关变更。
- 文件 changes：hunk、diff 导航、批注、审阅队列。
- 变更集 review：评审队列、证据、决定动作。
- 评审项：意见正文、锚点、回应、解决 / 重开。
- Goal orient：开放问题、决定、进度、证据。
- 械绝不覆盖框；可折叠，折叠后台获得更多空间。
- 没有全局工具栏；动作跟着对象和镜走。

### 9.6 栈

- 打开 subject / 切换 scope = push。
- 换镜 = replace，不入栈。
- 跟随对象（变更集里的文件、评审项锚点）= push。
- 返回 = pop，恢复 scroll / selection / lens / split。
- 面包屑 = 跳到栈中某一层，并截断其后的层。
- 切换世界 = 保存当前世界的栈，加载目标世界的栈。
- 分屏 = 当前 focus 带两个 subject，不产生新栈层。
- 关闭保留对象 = 从 `kept` 移除，不弹栈。
- 栈按世界持久化；重启后恢复。

### 9.7 取

取景器是唯一导航入口：

- 世界（切换 repo）
- Goal（当前世界）
- 文件（当前 scope）
- 变更 / 评审项（当前 Goal）
- 最近内容
- 线程（Chat）
- 命令

`⌘P` 打开，输入即过滤，回车即 push。取景器替代：

- 常驻文件树；
- 全局 L2 Tab；
- Goal 列表作为常驻卡片；
- 最近内容卡片。

取景器记住每个 scope 的展开 / 选中状态；文件树状态仍然持久化，但不再常驻。

## 10. Chat：决定面

**Thread 与 Episode 的既有映射。** 本文的 thread 就是现有模型：Lead thread（每个项目一条）+ Tech Lead thread（每个 Goal / revision 一条）。`lead_topic` 仍是 handoff provenance，不是新的用户可见话题系统。本文的 episode 是**视图分组**：由用户显式标记或 Agent 提议、人确认的一组消息 / 决定，用来把“围绕一个问题的讨论”折叠成决定记录；它不是 topic 的替代，也不改变 session / ContextManifest。参见 `2026-11-10-lead-techlead-thread-handoff-design.md`。

### 10.1 决定的定义

一个决定 = 在不确定性下，从多个可能未来里承诺一个。至少包含：

- 问题：到底在选什么；
- 选项：含“不做 / 维持现状”；
- 依据：引用、证据、当前状态；
- 决定人：谁有权拍板；
- 理由：为什么选这个；
- 后果：什么变成真的、什么被放弃；
- 复盘点：什么时候需要重看。

### 10.2 七类决定

| 类型 | 谁提议 | 谁决定 | 产物 |
|---|---|---|---|
| 方向 | Lead / Tech Lead | 人 | Goal 意图 |
| 方案 | Tech Lead | 人批准 | Plan |
| 范围 | Tech Lead | 人 | scope / non-goals |
| 授权 | 系统 / Tech Lead | 人 | 风险确认、预算 |
| 验收 | Reviewer 证据 | **仅人** | accept / reject |
| 优先级 | Lead | 人 | 队列顺序 |
| 处置 | 人 | 人 | merge / abandon / rework |

现有 plan 批准、风险确认、Goal 验收、评审项解决、merge gate 本质上都是决定；后端权限规则各自保留，Chat / 工作台用同一套决定呈现协议。

### 10.3 生命周期

```text
提出 → 取证 → 形成选项 → 承诺 → 执行 → 验证 → 关闭
                    ↘ 搁置（带复盘点）
                    ↘ 重开（新证据）
```

### 10.4 Chat 信息架构

```text
[Thread header]   责任 · scope · 状态
[Decision board]  需要你定 / 待确认 / 已定 / 已搁置
[Episodes]        每个 episode 围绕一个问题；关闭后折叠成决定记录
[Composer]        讨论 / 提议 / 委托 / 解决
```

- **活决定在 transcript 之上**，不在滚动记录里。
- **Transcript 是决定的证据链**，不是产品本身。
- **Episode 按问题分组**，不按时间分组；关闭的 episode 折叠成一行决定记录。
- 每条决定记录链接回产生它的消息、引用、变更和 Goal。

**决定板的数据来源。** 决定板不是新的真相库，而是现有 attention / approval / review / acceptance 记录的聚合投影：`/api/attention` 的 review / failed / pending 项、plan 批准、风险确认、Goal accept、评审项状态、direction 决定。rail 的 attention badge 仍是全局入口；决定板是 Chat 内的同源投影。两者必须读同一个聚合，不允许出现两套“需要你”计数。历史 Goal 不需要回填；能从现有记录派生的就派生，不能派生的只显示当前状态。

### 10.5 Composer

- **讨论**：默认；不承诺，允许发散。
- **提议**：要求 Agent 给出选项、取舍、建议；产出决定卡。
- **委托**：人确认后创建 / 绑定 Goal，带 scope、预期、验收、授权、证据计划。
- **解决**：人解决评审项 / 决定；Agent 不能代做。

“发送”和“委托”必须是两个动作。`discussing` Goal 草稿可以按 P0 直接创建；“进入执行”（NodeDriver 启动 / 工作开始）前必须看到委托单预览并获得人确认。这样既不回退“无创建前确认”，也不让 Agent 在未确认的情况下开始工作。

### 10.6 委托单

委托单是 Goal 的承诺视图，至少包含：

| 字段 | 回答 |
|---|---|
| 委托人 | 谁拥有结果 |
| 受托人 | 哪个角色负责 |
| 范围 | 哪个世界、哪些路径、哪个 revision |
| 意图 | 做什么、为什么 |
| 约束 | non-goals、不可牺牲项 |
| 验收 | 怎样算完成 |
| 裁量 | Agent 可以自己决定什么 |
| 升级 | 什么必须回来问人 |
| 预算 | 时间、token、风险 |
| 证据 | 交付时给我看什么 |
| 终止 | 什么时候停 |
| 审计 | 留下什么记录 |

Goal 仍是后端执行资源；委托单是它对人可见、可确认的那一面。

### 10.7 决定仪式

正式程度 = f(可逆性, 代价, 不确定性)：

- **正式决定**：不可逆、高成本、跨范围、验收 / 合并、方向分叉。
- **轻量委托**：可逆、低风险、在已授权范围内 → 记录假设，不打断。
- **只告知**：健康执行、普通进展 → 不进决定板。
- **必须打断**：阻塞、需要授权、证据不足。

默认是“带假设的委托”，不是“每步都问”。

### 10.8 决定记录

- 由 Agent 起草，人确认；Agent 不能自己把决定标成已定。
- 记录问题、选项、依据、决定人、理由、后果、复盘点、关联 Goal / revision / 变更 / 评审项。
- 持久化到世界 / Goal；Chat 和历史可检索。
- 决定记录是跨时间存活的记忆；消息不是。

## 11. Agent / 用户模型

### 11.1 委托关系

- 用户 = 委托人（principal），不是操作员。拥有世界、目标、验收、风险。
- Agent = 受托角色（agent），不是聊天机器人，也不是一群角色。
- 产品职责：降低信息不对称、对齐目标、保留最终权威。

### 11.2 委托契约

Chat 谈判契约，Goal 执行契约，Workbench 验证契约，Decision 关闭契约。

契约字段见 §10.6。实现时可以用 Goal 字段 + 决定记录 + 权限策略组合表达，不要求新建一个大对象。

### 11.3 代理的四个参数

```text
Agency = Mandate × Discretion × Escalation × Audit
```

- **Mandate**：可以做什么。
- **Discretion**：可以自己决定什么。
- **Escalation**：什么时候必须停。
- **Audit**：必须留下什么。

任何一个为零，代理要么无用，要么危险。

### 11.4 授权阶梯

| 级 | Agent 行为 | 人的角色 | 例子 |
|---|---|---|---|
| 0 回答 | 只提供信息 | 问 | “这个文件做什么？” |
| 1 建议 | 给选项，不行动 | 选 | “怎么修？” |
| 2 草案 | 产出但不提交 | 审 | “写个 patch，不要应用” |
| 3 批准后执行 | 先计划，批准后做 | 批 | “先给计划，再做” |
| 4 授权内自主 | 可逆步骤自主，事后报告 | 监控 | “修测试，别动 API” |
| 5 自决 | **永远不允许** | 验收 | 接受、合并、承担风险 |

推荐默认：新 Goal 从 3 开始；可逆、低风险、范围明确的工作显式升到 4；5 永远保留给人。

与现有 Goal 形态的映射：

| Goal 形态 | 授权级别 | 含义 |
|---|---|---|
| `standard` | 3 | 先批准计划，再在计划内执行；Reviewer / Goal Eval 按现有流程。 |
| `quick` | 4 | 窄范围、可逆、单 task；跳过独立 Reviewer，结果 `UNREVIEWED`；人仍验收。 |
| `standing` | 4 | 预批准 standing mandate；高风险动作升级；当前 gateway 仍返回 501，设计先保留映射。 |

`quick` 仍受现有 gateway 约束：`requiresApproval` 高风险拒绝 quick、`planReview: 'manual'` 拒绝 quick、`MAFW_GOAL_MODES=0` 只允许 standard。

执行层：本轮不新增 runtime policy engine；授权级别通过现有 `goalMode` + plan 批准 + 评审 / 验收门 + 工具权限表达。UI / prompt 负责显示级别、升级与 human-only 边界。若需要强制拦截“计划外写 / 删除 / 网络”，作为单独工作流，不在本设计里假装已实现。

### 11.5 用户的五种模式

| 模式 | 问题 | 表面 | 权力 |
|---|---|---|---|
| 导演 | 我们要做什么 | Chat | 定意图、优先级 |
| 协作者 | 你怎么看 | Chat | 探索，不承诺 |
| 审阅者 | 对不对 | Workbench | 解决、打回 |
| 操作者 | 我来 | Workbench | 直接编辑、运行 |
| 所有者 | 接受吗 | Decision | 验收、风险、合并 |

同一个人，不同模式，权力不同。UI 应显示当前模式，Agent 应随之改变行为。

协作是对称的，产出理解；委托是不对称的，产出工作。Chat 必须支持两种模式，并显示当前模式。

模式从表面与意图派生，不是持久全局状态：Chat 的讨论 / 提议对应导演 / 协作者，Workbench 的审阅 / 操作镜头对应审阅者 / 操作者，Decision 镜头对应所有者。模式改变 Agent 的 prompt / 可用动作，不改变 mandate 或权限；权限仍由角色、授权级别和 human-only 边界决定。

### 11.6 一个负责人

Agent 的职能：解释、计划、执行、回应、报告、记忆。

但用户不需要管理一个团队。原则：

- 世界 → Lead；
- Goal → Tech Lead；
- Builder / Reviewer 是 Staff，只在技术详情里出现。

用户找一个人问，这个人对结果负责。团队是后台，不是界面。

### 11.7 责任 / 权限 / 问责

| Scope | 负责 | 权限 | 问责 |
|---|---|---|---|
| 世界 | Lead | 提议、分配、讨论 | 用户 |
| Goal | Tech Lead | 计划、执行、回应 | 用户 |
| 变更 | Builder | 计划内编辑 | Tech Lead |
| 证据 | Reviewer | 验证、裁决 | Tech Lead |
| 验收 | 用户 | 接受 / 拒绝 / 风险 | 用户 |

Agent 可以有责任和有限权限，但**永远不承担最终问责**。

### 11.8 可逆性法则

不是“信任 Agent”，是“信任可逆性”。

| 动作 | 默认权限 |
|---|---|
| scope 内读 | 允许 |
| 计划内写 | 允许 |
| 计划外写 | 升级 |
| 删除 | 升级 |
| 网络 / 外部副作用 | 策略或升级 |
| 超预算 | 升级 |
| 解决人的评审项 | 永不 |
| 验收 / 合并 | 永不 |

### 11.9 信任与失败模式

```text
Trust = Competence × Transparency × Reversibility × Alignment
```

- 能力：模型、工具、记忆、计划。
- 透明：框、变更集、证据、决定记录。
- 可逆：worktree、revision、checkpoint、不自动合并。
- 对齐：mandate、评审项、人类验收。

Agent 失败模式与对策：

| 失败 | 症状 | 对策 |
|---|---|---|
| 越权 | 改了范围外 | mandate + scope check |
| 不作为 | 什么都问 | discretion + 默认值 |
| 漂移 | 忘了原意 | decision record + intent anchor |
| 不透明 | 说不清改了什么 | change set + evidence |
| 提前完成 | 没证据就说 done | acceptance + reviewer |
| 自决 | 自己解决自己的意见 | human-only resolution |
| 失忆 | 忘了约定 | world memory + decisions |
| 谄媚 | 顺着用户说 | reviewer + 记录异议 |

用户失败模式与对策：

| 失败 | 症状 | 对策 |
|---|---|---|
| 意图模糊 | Agent 猜 | 结构化 brief |
| 橡皮图章 | 不看就接受 | attention queue + evidence |
| 过度信任 | 跳过审阅 | human-only accept |
| 过度干预 | 什么都管 | autonomy ladder + track record |
| 上下文丢失 | 忘了为什么 | decision record + focus stack |
| 决定疲劳 | 逃避决定 | ceremony threshold + defaults |

### 11.10 身份与连续性

- **角色 > 模型**：用户面对的是 Lead / Tech Lead，不是模型。模型是设置。
- **Scope > Session**：连续性由世界 / Goal / thread / decision 承载，不是 session。
- **委托人 > 窗口**：用户身份是 principal + mode，不是窗口。
- **决定 > 消息**：跨时间存活的是决定记录，不是聊天滚动。

## 12. 交互场景

1. **打开世界**：恢复上次焦点；没有焦点时进取景器 / 世界总览。世界总览包含继续 / 需要你 / 全部 Goal / standing / 团队属性 / New Goal；文件与最近内容在取景器。项目首页不是默认目的地。
2. **读文件**：框显示 world / scope / file / version / state；台是内容；械是批注与动作；无 context 标题栏。
3. **换镜**：读文件 → 变更 / 审阅 / 决定；对象不变，台和械变化；栈不增加。
4. **跟随对象**：变更集点文件、评审项点锚点；push；框更新；返回恢复。
5. **Goal 审阅**：Goal 总览 → 变更集 → 审阅镜头 → 评审项 → 解决 / 重开；队列在械；返回逐层恢复。
6. **决定 / 检查**：Chat 决定板 → 提议 → 委托单 → 人确认 → Goal；Agent 不能自己验收。打开 Goal 变更集不静默切换 Chat；Chat 保持当前线程，composer 显示 scope chip 和显式“与 Tech Lead 讨论”入口。
7. **执行**：Goal 框显示 running / 3 of 7；Goal 总览展开进度；执行不覆盖框。
8. **分屏**：同一框，两个 subject；副对象默认只读；关闭分屏不影响主对象。
9. **浏览器 / 终端**：瞬态 subject；框标 external / terminal；不进项目树；可保留但不参与验收。
10. **插件**：插件是 subject；插件内部 Tab 留在台内，不占全局 L2。
11. **切世界**：保存当前栈，加载目标世界的栈；Goal 不跨世界。
12. **世界外文件**：瞬态对象，框明确标记 outside world；不进入 Goal / 评审 / 验收，除非人显式导入。

## 13. 与现有实现的关系

当前代码中需要迁移的主要位置：

- `packages/desktop/src/renderer/mafw/workbench-context.ts`：`WorkbenchContext` 将被焦点模型替代。
- `packages/desktop/src/renderer/mafw/components/WorkbenchShell.tsx`：当前 context / surface / execution 抽屉壳。
- `packages/desktop/src/renderer/mafw/components/ContentScopeHeader.tsx`：scope / intent / browser / terminal / review / split 的复合头，将被框 + 镜替代。
- `packages/desktop/src/renderer/mafw/components/WorkbenchCodeView.tsx`：文件树 + 编辑器 + 浏览器 + 终端 + 插件 L2 的容器。
- `packages/desktop/src/renderer/mafw/components/EditorDock.tsx`：预览 / 固定 Tab、草稿、选区、滚动恢复。
- `packages/desktop/src/renderer/mafw/content-scope-state.ts`：树展开 / 选中 / 打开文件 / 活动文件 / 阅读位置 / 选区 / 文件树抽屉。
- `packages/desktop/src/renderer/mafw/editor-drafts.ts`：草稿 / mtime / EOL。
- `packages/desktop/src/renderer/mafw/recent-content.ts`：最近内容。
- `packages/desktop/src/renderer/mafw/MafwShell.tsx`：context、scope、intent、split、返回、插件 surface 的编排。

映射约束：

- Lead thread / Tech Lead thread / `lead_topic` / `ChatPane` 的现有模型保留；episode 只是在消息与决定上做视图分组，不新建会话模型。Tech Lead thread 仍按 Goal / revision 一条。
- `ProjectWorkView` 的非文件部分（New Goal、standing、团队属性、审批、全部 Goal）迁入世界总览 subject 或 rail；文件与最近内容迁入取景器。世界总览是可选 subject，不是默认页。

复用要求：

- 现有文件预览、Monaco / CodeMirror、批注锚点、diff、Goal / Pod DTO、SSE、worktree、验收门禁能复用就复用。
- `content-scope-state` 与 `editor-drafts` 的持久化能力保留，但 key 从“四 context”迁移到“world + scope + subject”。
- `recent-content` 保留，作为取景器的一个分类。
- 现有 Goal 详情注意力顺序保留，作为 Goal 总览 subject 的默认叙事。
- 现有 preview/pin、split、draft restore 行为保留，迁入焦点模型。

## 14. 推荐迁移顺序

每一阶段应可独立交付，并且不破坏权限门禁。

1. **状态模型**：引入 `SubjectRef` / `Focus` / `FocusStack` / `Place`；把现有 content scope 状态映射进去；提供纯函数与单元测试。
2. **框与台**：用一条 frame bar 替换 context 标题 + content scope 标题 + 编辑器 Tab 头；台接管当前对象；暂留文件树但降级为可收起。
3. **取景器**：实现 ⌘P；文件树 / Goal 列表 / 最近内容迁入取景器；保留树状态持久化。
4. **镜**：把 reading/editing 开关、review context、split 开关收敛为 lens bar；review 变成 change set / file 的镜头。
5. **Goal / World scope**：Goal context 变成 frame + Goal 总览 subject；项目首页变成上次焦点 + 兜底取景器；执行抽屉变成框状态 + Goal 总览段。
6. **Chat 决定面**：decision board、episode、decision record、composer 四模式、委托单预览。
7. **Agent / 用户可见性**：mandate、autonomy badge、escalation card、handoff card；技术细节默认隐藏。
8. **持久化与恢复**：按世界保存栈、kept、place；重启恢复；跨世界切换。
9. **清理旧入口**：删除 `WorkbenchContext`、四个 context 的持久化、旧 L2 切换、执行抽屉、重复标题栏；补迁移兼容。

builder 可以调整顺序，但不得改变 §6 的硬约束与 §15 的验收语义。

## 15. 验收场景

以下场景必须可验证：

1. 打开项目恢复到上次焦点；没有焦点时进取景器；项目首页不是默认页。
2. 打开文件时框显示 world / scope / subject / version / state；台直接显示内容；没有 context 标题栏。
3. 换镜后对象、scroll、selection 不变；栈不增加；返回回到上一个 subject。
4. Goal 审阅时，变更集是台，评审队列是械；评审项聚焦时台显示带锚点的文件；返回逐层恢复。
5. 决定板显示需要你定 / 待确认 / 已定 / 已搁置；Agent 不能自己把决定标成已定。
6. 委托前显示委托单预览；未确认不创建 / 不启动 Goal。
7. 人类专属验收：带 `actorSessionID` 的验收请求 403；Agent / MCP 无验收路径。
8. 评审项只能由人解决 / 重开；Agent 回应不改变为已解决。
9. 执行状态出现在框 / Goal 总览；任何浮层不覆盖框。
10. 浏览器 / 终端是瞬态 subject，框标 external / terminal，不进项目树。
11. 分屏是两个 subject、同一框；副对象默认只读；关闭分屏不影响主对象。
12. 重启后恢复栈、kept、drafts、scroll / selection；世界切换保存 / 加载各自栈。
13. 取景器能找到文件、Goal、变更、评审项、决定；打开时 scope / lens 正确。
14. 世界外文件被标记，不进入 Goal / 评审 / 验收。
15. 旧工作流不退化：预览 / 固定 Tab、草稿恢复、diff、批注、Goal 注意力顺序、worktree 隔离、PASS 不自动合并。

验证手段：

- 纯函数 / 状态模型单元测试（焦点栈、lens 适用性、place 恢复、取景器查询）。
- 组件 / 集成测试（框、台、械、取景器、决定板）。
- desktop 全量 `npm test`（带 `--conditions=browser`）。
- `npx tsgo --noEmit -p tsconfig.json`。
- `npx electron-vite build`。
- 实机冒烟：项目恢复、文件直开、换镜、评审项、决定、分屏、浏览器 / 终端、重启恢复。
- 若触及 gateway / SDK：补跑对应全量测试；验收 / 评审 / worktree 门禁必须有回归。

## 16. 留给 builder 的决定

以下不改变产品边界，builder 可以自行决定：

- `SubjectRef` / `Focus` / `Stack` 的具体模块与 store 拆分。
- frame bar / lens bar / instrument rail 的组件边界与 CSS 结构。
- 框的一行 / 两行布局、状态徽标优先级、窄窗降级。
- 取景器的查询、排序、分组、键盘交互。
- 决定记录的存储位置：新表、Goal 字段、现有 approval / review 模型扩展，或组合。
- 决定板 / rail badge 的聚合实现：扩展现有 `/api/attention`，还是新增聚合端点；必须保持单一计数来源。
- `discussing` 草稿与“进入执行”在 Goal 状态机中的表达；不得回退“无创建前确认”，也不得让未确认的 NodeDriver 启动。
- Chat episode 的识别是 Agent 提议、显式标记，还是混合。
- 委托单是 Goal 的投影视图，还是新建轻量对象；不得改变权限语义。
- 世界稳定 id 的 marker 格式与迁移策略。
- 旧 `content-scope-state` / `editor-drafts` key 的迁移与回退。
- 项目变更集的 baseline、diff 聚合与 UI；与 Goal 变更集共用 viewer。
- 世界总览 subject 的具体内容与排序；文件与最近内容必须在取景器可达。
- 分屏是否限制同世界（推荐限制；跨世界对照另做）。
- 大变更集的虚拟化、diff 加载与性能策略。
- 视觉 token、间距、动效；遵循 `docs/superpowers/specs/2026-11-12-desktop-visual-language-design.md` 与现有主题约束。

## 17. 参考

- `docs/superpowers/specs/2026-11-11-project-agent-workbench-experience-design.md`
- `docs/superpowers/specs/2026-11-12-desktop-visual-language-design.md`
- `docs/superpowers/specs/2026-11-10-lead-techlead-thread-handoff-design.md`
- `docs/superpowers/specs/2026-11-10-goal-shapes-quick-goals-design.md`
- `docs/architecture/desktop.md`
- `docs/architecture/goal.md`
- `docs/architecture/pod.md`
- `docs/releases/2026-11-11-project-agent-workbench-shell-ia.md`
- `docs/releases/2026-11-11-project-agent-workbench-project-home.md`
- `docs/releases/2026-11-11-project-agent-workbench-content-intent.md`
- `docs/releases/2026-11-11-project-agent-workbench-viewer-tools.md`
- `docs/releases/2026-11-11-project-agent-workbench-goal-attention.md`
- `docs/releases/2026-11-11-project-agent-workbench-persistence-split.md`
- 视觉方向稿：`.superpowers/brainstorm/1785-1794412579/content/workbench-stage-first.html`、`workbench-mechanics.html`
- 截图：`.mafw/qa/wb-mock-overview.png`、`.mafw/qa/wb-mock-mechanics.png`
