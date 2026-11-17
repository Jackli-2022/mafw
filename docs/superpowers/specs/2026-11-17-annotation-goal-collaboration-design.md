# 批注、会话与 Goal 协作设计

日期：2026-11-17
状态：builder check 已完成，边界决定已回填；待用户全文批准后方可进入实施计划。

## 1. 意图

MAFW 当前把一次性文件批注、Goal 持久评审项和 Tech Lead 消息绑定在同一条发送管线中，导致：

- 同一个“批注”有时是聊天文本，有时是阻挡验收的评审项；
- 是否落成 Goal 评审项取决于当前 Chat tab，而不是用户意图；
- 文件作用域不参与发送路由，可能把项目文件或其他 Goal 的批注写进当前 Goal；
- 评审项没有确定性进入 plan / execute，Builder 可能看不到验收门所检查的意见；
- Goal 持久化与消息发送耦合，无法清晰表达“一批意见，一次委托”。

本设计从第一性原理收敛为三个用户概念：

| 概念 | 回答的问题 | 产物 |
|---|---|---|
| 批注 | 我在说哪里、说什么？ | 本地草稿：文件、位置、原文、意见 |
| 会话 | 我想和谁讨论？ | 普通消息：理解、解释、建议 |
| Goal | 谁负责把这件事做成并验收？ | 受管执行、评审项、变更与证据 |

核心基线（用户已于 2026-11-17 确认）：

> **普通批注默认不创建 Goal；只有点击“处理这些批注”才创建或选择 Goal。**

## 2. 目标

1. 创建、保存或发送普通批注时，不因文件作用域或当前 Chat tab 自动创建 Goal / review item。
2. 用户可以明确选择把批注发给 Lead、自由会话或某个 Goal 的 Tech Lead 讨论。
3. 用户可以明确选择一批批注，交给一个 Goal 处理；没有合适 Goal 时创建一个，有合适 Goal 时加入现有 Goal。
4. 锚点只描述来源文件与位置；处理目标在委托时单独确定，二者不得互相篡改。
5. 一次委托形成一个可追踪批次，Tech Lead / Builder 能确定性看到该批全部未解决意见。
6. 保持自由讨论、人类专属解决 / 验收、revision 隔离和现有 Plan / Eval 批准语义。

## 3. 非目标

- 不因“创建批注”“浏览 Goal 文件”“打开 Tech Lead tab”而自动创建 Goal。
- 不把 Lead 变成所有技术批注的默认转发信箱。
- 不恢复已移除的全局 composer 四模式选择器。
- 不新增第二套 Goal 执行器、评审状态机或持久批注真相源。
- 不让普通截屏、浏览器元素引用或 Plan 驳回意见自动进入文件评审项。
- 不在本轮实现自动无限重试 / 自动 rework 调度器、完整模糊重锚引擎或跨项目个人 Agent。
- 不改变 AI inline edit 已确定的规则：AI 编辑始终走 Quick Goal；人工直接编辑不强制 Goal。

## 4. 反目标

即使功能可用，出现以下行为也算失败：

- 当前 tab 从 Goal A 切到 Goal B 后，同一条草稿被写入不同 Goal；
- 用户只要求 Lead 解释，系统却创建 Goal 或持久评审项；
- 项目主目录批注被静默改写为 Goal worktree 批注；
- Goal B 的内容未经 Lead 显式选择而进入 Goal A 的跨 Goal 工作上下文；
- 每条批注都唤醒一次 Tech Lead 或创建一个 Goal / revision；
- Builder 看不见评审意见，最终验收却被这些意见阻挡；
- Tech Lead 仅回复“收到”就把意见标为已回应，或 Agent 代替人确认解决 / 验收；
- 通知失败后的重试重复创建评审项或 revision。

## 5. 用户模型：三个概念、两个动作

### 5.1 批注只是来源草稿

批注创建时只记录：

- 来源项目 / Goal revision（若浏览的是 Goal 本版文件）；
- 实际文件 root 与项目内相对路径 `rel`；
- 行范围、quote、JSON path、单元格、页面 / 区域等定位信息；
- 原文或代码快照、用户意见、创建时间；
- 可选的来源会话 ID（仅作 provenance，不决定路由）。

浏览项目主目录文件，来源就是项目；浏览 Goal 本版文件，来源就是该 Goal revision。**当前 Chat、当前 Lead / Tech Lead tab 不参与来源判定。**

### 5.2 动作一：发给某人讨论

用户显式选择接收者：项目 Lead、自由会话或某个 Goal 的 Tech Lead。

- 只发送普通消息，不创建 Goal，不创建 review item。
- 当前会话可以提供默认接收者建议，但不能覆盖用户选择。
- 没有打开会话时保留草稿，发送时再选择接收者；选择 Lead 时确保项目 Lead 会话存在。
- 发送后默认不强制切换当前工作台，提供“打开会话 / 查看回复”入口。这是本文的 UI 默认建议。
- 发送成功后，草稿从“待发送”列表出清，但其结构化批注 envelope 随消息保留；用户之后可从该消息选择原批注并执行明确委托，不需要重新划线或复制文本。
- 从讨论消息委托时仍复用原来的 annotation / submission ID，防止同一 envelope 被重复建项；旧讨论本身不 retroactively 变成工作。

### 5.3 动作二：处理这些批注

用户选择一批草稿并点击「处理这些批注」：

1. 明确目标 Goal：当前来源 Goal 可作为默认建议；项目来源或归属有歧义时，由用户选择新 Goal / 现有 Goal。
2. 将选中的草稿持久化为该 Goal active revision 的 review items。
3. 保留原始来源，不改写成目标 worktree 来源。
4. 在允许处理的阶段一次通知 / 恢复该 Goal 的 Tech Lead，由现有 Goal 生命周期决定讨论、计划、批准与执行；执行 / 评审中只记录到下一批，不打断当前工作。
5. 一批只形成一个委托，不为每条意见分别创建 Goal 或 revision。

自由会话和普通 Lead 解释仍保持原样；委托不会把原自由会话改造成 Tech Lead 会话。

## 6. 场景规则

| 场景 | 讨论 | 处理这些批注 |
|---|---|---|
| 发给 Lead 解释 | 普通 Lead 消息；无 Goal / review item | 用户明确确认工作后才取得 Goal |
| 当前打开另一个 Goal 的 Tech Lead | 仍发给用户选择的接收者，不按 tab 改道 | 只能写入用户选择且校验通过的 Goal，不写入当前 tab 的 Goal |
| 没有打开 Chat | 保存草稿；发送时选择接收者 | 选择 / 创建 Goal，不依赖 ChatPane 是否存在 |
| 当前是自由讨论 | 默认建议当前自由会话，可改发 Lead | 原自由会话不变，批注单独取得 Goal |
| 浏览当前 Goal revision 文件 | 可发给任意合法接收者，不自动落评审项 | 默认建议该 Goal active revision |
| 浏览历史 / 已验收 revision | 可作为历史内容讨论 | 不改写历史；显式创建后续 Goal / revision，并保留原来源 |
| Goal 正在执行 / Reviewer 评审 | 普通讨论不打断执行 | 意见可持久化，但当前 prompt 与执行不变；不打断、不并发开 revision |
| 十条普通批注 | 十条作为一个消息上下文发送 | 十条加入同一个 Goal，并形成一次委托 |

Goal 正在执行时，本轮不承诺自动调度重做：新意见保持可见且继续参与验收门；结果出来后，由人通过一次「打回并按批注修改」开启下一 revision，统一处理全部未解决项。UI 不得把“已记录”伪装成“已安排执行”。

## 7. 来源锚点与处理目标

### 7.1 来源不可变

`source` 在批注创建时冻结，至少包含：

- `project` 或 `goal` 来源类型；
- 项目目录；Goal 来源另含 `goalId + revision`；
- 文件 root、`rel`、定位锚与原文；
- 评审委托所需的内容版本或可验证的等价信息。

`root` 是物理位置解析信息，不是跨恢复的唯一身份；Goal 来源的稳定身份是项目 + goalId + revision + rel。

### 7.2 目标在委托时确定

`target` 是独立的 `{ podId, goalId, revision }`。项目来源批注交给 Goal 后，仍显示“来自项目主目录”；不得仅修改 `scopeKey` 使其看似源于 Goal worktree。

内容已经变化时：

- 可以用 quote / context 辅助重新定位；
- 多匹配或找不到时显示原始来源并请求人确认；
- 不用旧行号静默套到新版本；
- 主目录未保存 / 未提交修改不静默迁入 Goal worktree。

本轮采用保守的脏内容规则（设计者的实现选择，非新增用户概念）：

- 来源文件有未保存编辑器内容时，允许带原文讨论，但阻塞委托，先要求保存；
- 不自动把主目录未提交修改制作成 patch 或复制到 Goal worktree；
- 来源文件与目标 worktree 版本无法可靠对应时，阻塞“直接修改”路径，用户可先讨论，或自行提交 / stash / 对齐版本后再委托；
- 不额外给普通批注委托增加整仓干净规则，但新 Quick Goal / inline edit 已有的干净工作区要求继续生效；
- 与来源文件无关的工作区改动不得被批注委托读取或迁移。

### 7.3 不同预览只改变定位方式

代码行、文本 quote、JSON path、表格单元格、图片区域、PPTX 页码与 Diff hunk 都是资源内部定位方式，不决定 Goal 归属。Plan 批注继续走专用 plan rejection feedback，不进入本文件评审管线。

## 8. Lead / Tech Lead / Builder / 人的职责

| 角色 | 责任 | 权限边界 |
|---|---|---|
| Lead | 项目意图、进展、分派、跨 Goal 上下文选择 | 不默认承接每条技术批注，不代替人解决 / 验收 |
| Tech Lead | 当前 Goal 的讨论、计划、组织修改、逐条回应 | 只在解释或修改可供检查时标记 responded；不能 resolved |
| Builder | 按批准 Plan 与本批评审上下文实施 | 不改变评审状态，不自行扩 scope |
| Reviewer | 按 Plan / Goal Eval 与真实证据评审 | PASS 不等于人类验收，不自动解决意见 |
| 人 | 委托、确认解决 / 重开、打回、风险接受与验收 | 这些权限不得代理给 Agent / MCP |

`responded` 只是 Tech Lead 声明“已有可供人检查的回应”，不是机器证明质量，也不是问题关闭。本轮不新增“机器判断解释是否有实质内容”的契约：服务仍可只校验合法 session、active revision 与非空回应，但 Tech Lead 身份 / 工具说明必须禁止用“收到”等纯确认推进状态，并要求在可用时关联修改或证据。人可重开空泛回应，`responded` 仍阻挡普通验收；是否真正闭合继续由人判断，不为此新增必需 evidence schema。

Goal B 内容需要进入 Goal A 工作上下文时，继续走 Lead 显式跨 Goal 上下文选择；普通路由不得绕过。

因此，目标选择器本身不构成跨 Goal 授权：

- 项目来源批注可以由人显式选择新 Goal 或现有 Goal；
- Goal B 来源批注默认只能委托回 B 的合法后续工作；
- 要让 A 处理 B 的来源意见，必须先经 Lead 把该来源显式选入 A 的 ContextManifest，再进行委托；
- 即使用户在 picker 中直接点了 A，也不能跳过这一步，UI 应改为提供“经 Lead 交给 Goal A”的合法路径。

## 9. 批次与执行上下文

### 9.1 批次语义

一次委托先写入选中的 review items，再以当前 active revision 的全部未解决项形成本次工作快照。`pending` 与 `responded` 都属于未解决；只有人确认 `resolved` 后退出后续批次。

这里有两个不同但关联的概念，不需要暴露给用户：

- **委托批次**：一次人类动作写入了哪些草稿，用于幂等、审计和讨论消息；它不等同于一次执行。
- **执行快照**：某个 plan / rework 开始时，当前 revision 全部未解决 item IDs 的集合。多次委托可以合并进同一个执行快照，不要求每个委托分别跑一次计划。

执行快照只引用当前 revision 的 item IDs；origin IDs 保留跨 revision 来源，不另造“一个委托批次永久绑定一个未来 Plan”的生命周期。执行中发生多次委托时，在当前结果出来后合并到下一 revision 的同一快照，不形成多个排队 revision。

- 当前已发出的 prompt 不可变；晚到意见进入下一执行快照。
- 结果打回时复用现有 `rejectResult` 与 `carryForwardReviewItems`，已解决项留在旧 revision。
- 新 revision 使用 carry 后的新 item IDs，不能继续引用旧 revision 的只读 IDs。
- 验收继续读取实时未解决集合，而非旧工作快照；强制验收仍需人类风险确认。

### 9.2 确定性注入，而非 Tech Lead 手动转述

当前 review items 只经显式 Tech Lead 消息、attention 与验收门出现，未进入 Goal plan / execute。目标实现必须让 plan / execute 确定性获得本批快照，同时保持 Tech Lead 的语义责任：

- Tech Lead 负责把意见转化为 Plan / Goal Eval，不手工复制充当唯一传输通道；
- Builder 获得同一批上下文，不依赖隐藏聊天记录；
- 不自动把 review items 改写为 task acceptance / Goal Eval 条件，避免静默改变 planHash / evalHash 和 Reviewer 契约；
- Reviewer 继续评审批准后的 Plan / Eval，人类解决状态不充当 Reviewer 证据。

如果 Goal 已有待批准 / 已批准但尚未执行的 Plan（包括 queued 等待执行），新委托不得作为“旧批准计划之外的 Builder 附加上下文”直接进入 execute：

- Tech Lead 必须先吸收新意见并重新生成 / 修订 PlanPackage；
- Plan 或 Goal Eval 实质变化继续使旧批准失效，manual 模式必须重新获得人批准；
- quick 模式只按既有自动批准 / 授权语义生成新的 PlanPackage，不绕过 hash 与审计；
- 新执行快照必须与新的 PlanPackage 关联，不能沿用旧批准时的快照。

代码调研建议的落点是 `NodeDriver → node-prompts.ts` 的专用 provider，以正在执行的显式 revision 和本批快照渲染上下文：

- 不直接读取可变的 `goal.activeRevision`；
- 不把实时 DB 行硬塞进以稳定文件和 hash 为契约的 ContextManifest；
- 不走缺少 revision 且当前 fail-open 的 `podContext`；
- 不把人类评审项混入 planFeedback、reviewFeedback 或 reviewFix。

Prompt 注入只保证“看得见”，不等于“已调度”。Quick Goal 或 PASS 可能直接归档，因此显式委托 / 打回仍是本轮唯一 rework 触发方式。

## 10. 路由、失败与恢复约束

### 10.1 路由只解析一次

点击发送或委托时固定一份路由快照：动作、来源会话、来源 scope、目标接收者 / Goal revision。后续 staging、持久化、prompt、transport 和重试不得重新读取“当前 tab”。

本地草稿至少按 `(originSessionID, scopeKey)` 隔离；相同 `rel` 在项目、不同 Goal、不同 revision 下不得互相显示或发送。混合作用域选择必须明确分组或要求用户选择，不静默拆分。

Goal 评审落库不再要求当前正打开 Tech Lead tab；它依赖的是合法目标 Goal + active revision 和人类动作。Tech Lead 会话只负责后续讨论 / 执行。

### 10.2 幂等与通知失败

- review items 批量创建保持单事务。
- 落库成功、通知失败时，重试复用已有 item IDs，不重新创建意见或 revision。
- 重试 / 崩溃恢复必须有可验证的幂等方案；实现者可选择持久 submission key 或等价的 durable outbox。
- 本地草稿只能在可恢复状态已经建立后出清；普通聊天发送失败不得丢掉唯一草稿。
- Tech Lead 消息只保留一份带 review IDs 与必要锚点上下文的结构化表示，不重复附加 generic annotation block 和 review block。
- Goal revision diff 当前是 `previewOnly`；需要新增进入同一草稿 / 委托管线的评审入口，不复用 session diff 的 `promptAsync` 旁路。

## 11. 明确保留的独立路径

- 编辑器「引用」：只向 composer 插入引用。
- 普通截屏 / 浏览器元素捕获：默认仍是普通聊天上下文；只有显式转换才进入 Goal 委托。
- Plan 批注：只形成 Plan 驳回反馈。
- AI inline edit：继续按独立设计走 Quick Goal，不作为普通批注的例外。
- 人工直接编辑：仍是项目工作区修改，不强制 Goal。

## 12. 验收场景

1. 在项目文件树写批注并保存，不创建 Goal；刷新后草稿仍在正确项目 / 文件作用域。
2. 把该批注发给 Lead 解释，只产生 Lead 普通消息，Goal 数和 review item 数不变。
3. 当前打开 Goal A 的 Tech Lead，把 Goal B 文件批注发给 Lead，消息只进入 Lead，不写入 A 或 B。
4. 没有打开 Chat 时保存批注，之后选择 Lead / 自由会话发送，接收者正确且不丢草稿。
5. 在自由讨论选择十条批注并委托给一个 Goal，只创建一个委托批次和十条 review items；原自由会话保持不变。
6. 项目来源批注进入 Goal 后仍保留项目 root / scope / 原文 / 内容版本，不伪装成 worktree 来源。
7. 当前 Tech Lead 是 Goal A 时，项目或其他 Goal 草稿不得因发送而落入 A；历史 / 已验收 revision 必须走显式后续工作。
8. Goal revision diff 可以加入同一批注草稿；session diff 的直接 `promptAsync` 不绕过 Goal 路由。
9. 一次委托后 plan / execute 各出现一份完整批次数上下文；晚到意见不改变已发 prompt。
10. 执行中新增意见不打断当前工作；结果出来后一次打回开启一个 revision，未解决项只 carry 一次。
11. Tech Lead 只能在提供可检查回应后标记 responded；Builder、Reviewer、Lead 均不能 resolve / accept。
12. 落库后模拟通知失败与重试，item 和 revision 数量不增加，恢复后可继续通知。
13. 普通截屏、浏览器引用、Plan 批注、人工直接编辑保持各自原语义。
14. 未解决项继续阻挡普通验收；强制验收继续要求人类风险确认且不自动解决意见。
15. 批注发给 Lead 讨论后从待发送列表出清，但可从消息再次选择并委托；重复点击与重试不会重复建项。
16. 已批准 / 待执行 Plan 收到新委托时重新生成 PlanPackage，manual 模式旧批准失效；多次执行中委托在下一 revision 合并，而非排成多个 revision。

## 13. 测试要求

实施按 TDD 先行，至少覆盖：

- 路由矩阵：动作 × 来源 scope × 当前会话 × 显式接收者 / Goal；
- scope 分区、hydration、held、混合 scope、相同 rel 的隔离；
- 异步切 tab / revision 后仍使用同一路由快照；
- 项目来源晋升、历史 revision、跨 Goal 与 dirty 工作区保护；
- 讨论消息 envelope 后续委托、重复点击去重，以及未保存 / 目标版本不一致的阻塞行为；
- 委托批次创建、plan / execute 快照、晚到项、carry ID 与 Quick Goal 归档边界；
- 多次委托合并、plan_review / queued 新委托的 PlanPackage 重建与 manual 重新批准；
- 通知失败、重试、崩溃恢复与幂等；
- Goal diff 入口、Plan 批注 / captures 等独立路径不退化；
- human-only create / resolve / reopen / accept、responded 仍未解决及强制验收审计。

## 14. 留给实现者与后续计划的决定

以下不改变本产品模型，可在实施计划中由 builder 决定：

- 路由快照、submission key / outbox 的具体模块与持久化形式；
- 来源内容版本的编码、存储迁移与旧数据兼容方式；
- NodeDriver provider 的快照产物形状与 plan attempt 关联方式；
- Goal picker / 新 Goal 预览复用哪些现有组件；
- 在不恢复全局 composer 四模式的前提下，批注列表中“讨论 / 处理”动作的最终布局；
- 自动“下一安全边界”rework 调度是否需要另立后续设计。本轮不实现该调度器。
