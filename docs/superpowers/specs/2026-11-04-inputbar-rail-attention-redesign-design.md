# Inputbar / Rail / Attention 重设计 · 设计文档

日期：2026-11-04
状态：**范围已收窄（2026-11-04 第二次裁决）**——attention/通知层以 `2026-11-04-pod-event-layer-ambient-attention-design.md` 为准，本设计只保留 composer + rail 视觉 + switchAgent 门（+ composer 所需的 Thinking 管道）

> **2026-11-04 supersession note（已裁决）**：本设计定稿当天，并行批次 §5.27「右主 Agent 工作台」
> 落地（commits `65ee6344`..`b4c2c61a` + deferred minors + Tech Lead 入口批，desktop 2810/2810）。
> 经用户裁决（2026-11-04）：**rail 保留，不走 0px**——§5.27 的既成架构成立（rail = 导航+团队状态列，
> meta = 审批(badge)/Config）。本设计原 §3.3「rail 0px」**撤回**，替代为 §3.3' rail 视觉精修
> （原「收起的 rail 丑」反馈仍需处理，但只在视觉层，不动布局）。
> 另：§5.27 退役 WorkspaceHome/全页 goals 路由——composer 尺度按 §5.27 新 token 对齐
> （`--mafw-chat-composer: 16px`、max-height 220px）。

> **2026-11-04 supersession note 2（attention 归属，第二次裁决）**：用户裁决
> **`docs/superpowers/specs/2026-11-04-pod-event-layer-ambient-attention-design.md` 为 attention /
> 常驻存在感 / 通知层的唯一权威设计**。因此本设计的以下部分**撤出**，移交该批次实现：
> - §3.2 attention 通知链（`pod.updated {kind:'attention'}`、toast/OS/点击回焦）——**不再实施**；
> - Q3 发射点/重发语义、Q5 作用域（其设计为跨项目，取代本设计的项目作用域 A）；
> - 托盘 presence（其设计为 L1/L2/L3 三层 + `GET /api/presence`，取代本设计的「托盘不并入」）。
>
> 本设计保留并继续实施：composer 收敛（§3.1 + Q2/Q6 + Thinking 管道）、rail 视觉精修（§3.3'）、
> switchAgent 双向门（Q4）。

来源：brainstorm 会话（视觉伴侣迭代确认）+ 两份调研：
- `docs/research/2026-11-04-inputbar-redesign-research.md`（composer）
- `docs/research/2026-11-04-left-rail-industry-research.md`（rail + AI 产品参考系 + attention 审计 §8）

## 0. 意图与为什么

三个互相咬合的问题，一次收敛：

1. **Composer 内容未收敛**：常态 17 元素（业界 4-6）；输入/导航/输出/教学四类动作混排 + 5 个会话状态 pill 摊开；4 档容器降级全是补丁。方向已定：**B 方案（Claude 式会话配置单菜单）**，默认标签显示**模型名**，思考档位**恒显示**、非默认出小徽标。
2. ~~pod attention 通知链缺失~~ —— **移交** `2026-11-04-pod-event-layer-ambient-attention-design.md`（用户裁决以该设计为准，本设计不实施）。
3. **收起 rail 的视觉问题**：用户反馈「收起的 rail 丑」（会话/搜索按钮字形、虚线＋、密度）。裁决（2026-11-04）：**rail 保留**（§5.27 已把它定为导航+团队状态列），只做**视觉层精修**——字形重描 + 实心＋ + 间距，不动宽度与布局。

外加一项 API 强制措施：`switchAgent` 裸透传允许把任意会话切到 `lead`，制造脱离 `LeadSessionRegistry` coordination 槽位的野 Lead 会话——后端堵死。

## 1. 目标 / 非目标 / 反目标

**目标**
- Composer 常态 17 → ~7 元素；降级档 4 → ≤2。
- Thinking 档位进入会话菜单（恒显示；依赖 `thinkingLevelSupported` 管道）。
- Rail 视觉精修：丑的三层来源（粗体字形/虚线＋/密度）治掉，**不动宽度与布局**（§5.27 架构成立）。
- `switchAgent` 网关侧双向门（coordinator 身份）。

**非目标**
- **不做 attention 通知链 / 托盘 presence / 跨项目聚合**——归 pod-event-layer 设计（本设计不实施）。
- 不动左 dock 展开态的面结构与 rail 宽度（46px 保持，§5.27 已 GUI 验证各档宽度）。
- 不动键位：Tab（plan/build 循环）、`/`、`@`、Ctrl+Enter（排队）、↑↓（历史）、Ctrl+B（左栏）、Ctrl+P（面板）全部原样——**UI 收按钮不砍功能**。
- 不动 chips 行、发送/暂停按钮位置、DuplexVoiceBar。
- 不做 TUI/mobile 侧改动（后续独立评估）。

**反目标**
- 不动 rail 布局/宽度/分组（46px、顶部＋→目的地→spacer→审批/Config 全部保持）——视觉精修不等于结构重排。
- 不引入「图标/文字」切换类配置项。
- 不把审批模式收进会话配置菜单（安全域刻意独立常驻）。

## 2. 约束

- 现行测试基线：desktop **2810/2810（617 suites）**（§5.27 + Tech Lead 入口批后）；受影响契约测试：`design-contract.test.ts`（菜单标签/断点断言）、`composer-toolbar-css.test.ts`、`lead-coordinator-wiring.test.ts`（lockedLead 钉扎）、`agent-identity.test.ts`（接线钉扎）、rail 相关钉扎。
- UI 组件约定：`ButtonV2`/`TooltipV2`/`ToastV2`；禁裸 `<button>`。ButtonV2 classList 多 token 陷阱（语义属性选择器优先）。
- 测试必须带 `--conditions=browser`（desktop AGENTS）。
- TDD 先行；逐任务提交；门禁 `tsgo --noEmit -p tsconfig.json` + `electron-vite build` rc=0。
- gateway 侧改动走既有事件词汇（`pod.updated` 扁平顶层、`properties` 载荷）与 route catalog 登记流程。

## 3. 设计

### 3.1 Composer 收敛（B 方案）

**收起态布局**（44px 工具条）：

```
左：［＋ 附件菜单］［🛡 审批 pill］                    右：［🎤］［12% 上下文微标］［deepseek-flash ▾ 会话菜单］［⏸ busy］［➤ 发送］
```

- **＋ 附件菜单**：附件（文件选择）/ 截屏批注 / 引用 Agent（打开 @ 提及 picker）。原三个独立按钮收拢。
- **🛡 审批 pill**：现状保留但收起态图标化（hover/非默认档显示短标签）；三档循环行为不变。
- **上下文微标**：现状 context pill 不变（12% · $0.06，点击开用量），降级档位里优先级最低。
- **会话配置 pill**：默认标签 = **模型名**（`deepseek-flash ▾`）；**偏差小徽标**——agent 非 build 时前置 `plan`/`lead`/`create` 徽标（accent 色，plan 用 accent），thinking 非默认档时前置 `⚡ high` 徽标。默认态只有模型名。
- **菜单展开态**（发送旁 popover）：
  - Agent 行：`build · Tab 切 plan`（点击展开 build/plan 两项）；Lead 会话锁定显示 `lead`；mafw-create 会话显示 `create`（锁定）。
  - 模型行：点击展开模型列表（复用 ModelPicker 数据）。
  - Thinking 行：**恒显示**（不再按能力隐藏；runtime 不支持时禁用态 `—`，tooltip 说明）。档位 off/minimal/low/medium/high/xhigh/max。
  - ⚙ 全部设置 → 打开会话设置（现有 config 面）。
- **降级到 ⋯ 更多菜单**：审阅改动、语音播报（原本就在）、暂停回合（原本就在）。更多菜单不再有「切换 Agent/切换模型」两项（被会话菜单取代）。
- **删除**：`/` 命令按钮、`@` 引用按钮（typed affordance，靠打字+补全；`＋` 菜单保留「引用 Agent」入口）、keyhint 整行浮层（教学并入 placeholder：`输入消息…（/ 命令 · @ 引用）`）、plan/build 三态循环 pill（Tab 与菜单覆盖）。
- **降级档位**（4→2）：≤620 隐藏上下文微标 + 会话菜单 pill 收窄（模型名 ellipsis 加严）；≤520 显示 ⋯ 入口（＋ 菜单并进 ⋯）。结构护栏（min-width/overflow）保留兜底。
- **保留不动**：`applyAgentSwitch`/`agentPicks`/sticky 恢复（Creator/plan 入口/发送链 agent 绑定/ExecutionView agentLabel 都依赖）；`agentSel` prop；@ 提及 picker 与 autocomplete；`sessions.switchAgent` SDK 调用（3.4 的网关门只拦 lead）。

### 3.2 Attention 通知链 —— **撤回（移交 pod-event-layer）**

本设计原 §3.2（`pod.updated {kind:'attention'}` 发射点、toast/OS/点击回焦、托盘口径）整体**撤出**，以
`docs/superpowers/specs/2026-11-04-pod-event-layer-ambient-attention-design.md` 为准（用户裁决 2026-11-04）：
事件层（`pod_events` + `pod.event` SSE + presence + 通知/托盘/任务栏）由该批次实现；p0 attention 是其
`PodAttentionItem` 读时投影（该设计 §3.2/§10.5 明确 p0 不进事件表）。本设计不再产生任何 attention 事件或通知。

### 3.3' Rail 视觉精修（保留 46px，不动布局）

依据 `docs/research/2026-11-04-left-rail-industry-research.md` §4——丑的三层来源逐个治：

- **字形重描**（主要病灶，用户点名会话/搜索按钮）：讨论 `bubble-5`、搜索 `magnifying-glass`、便签 `sticky-note`、资源 `team-three` 四枚目的地字形按 **1.2-1.3px 线宽线性 glyph** 重描（v2 图标集内新增/替换路径；参考同批 `icon-registry-coverage.test.ts` 机制——未知名静默回退 plus 的教训）。meta 组 `checklist`/`settings-gear` 同批检查，不达线性一致性则一并重描。
- **＋ 去虚线**：`new-action` 的 dashed 描边是占位符视觉语言（业界无人用于常驻动作；M3 把顶部定义为 FAB 槽）——改实心 tint（保留 accent 色），hover 态不变。
- **密度松绑**：按钮 gap 5px → 8px、padding 8px → 10px（46px 宽内 34px 按钮边距 6px 的挤压感），宽度本身不动。
- **激活态微调（可选）**：现状 12% 填充块保留；如视觉评审仍觉闷，可收为 M3 式药丸（hug 图标），builder 按实际效果裁决——不强制。
- **不做的**：不加标签、不改宽度、不动分组顺序、不加断点。

### 3.4 switchAgent 强制措施（网关）

- `POST /api/sessions/:id/agent`（`routes/session-switch.ts`）：目标 agent 解析为 coordinator 身份（`resolveIdentityAlias` → `lead`，含历史 `manager`）时 **403**，除非该会话已是 Pod coordination 绑定（`LeadSessionRegistry` 权威槽位上的会话）。
- `mafw-create` 不拦（工具壳身份，Creator 流程自身保证全新会话）。
- 错误文案中性：`coordinator sessions are managed by the pod`（不泄 runtime 名）。
- SDK/桌面无需改动（桌面会话菜单本来就不提供切 lead）；契约测试：`session-switch` 路由加 coordinator 拒绝用例。

## 4. 任务切分建议（TDD）

1. **switchAgent 网关门**（双向 403 + 测试）。
2. **Thinking 管道**（网关 `thinkingLevelSupported` + SDK 类型 + 桌面 `session.config` 消费）。
3. **Composer 收敛**（会话菜单 + 删按钮 + keyhint 并入 + 降级档重算 + 契约测试更新）。
4. **Rail 视觉精修**（四枚字形重描 + ＋去虚线 + 间距松绑；视觉契约测试同步）。
5. 终审：全量 desktop + gateway 相关套件 + tsgo/build；GUI 冒烟（会话菜单三态、composer 窄窗两档、rail 视觉对照截图）。

> attention 通知链（原任务 1）**移交** pod-event-layer 批次，见 supersession note 2。

## 5. Builder check 裁决（2026-11-04 审查后定稿）

**Q1 · 工作空间/Config 与 ＋ 的去处**：~~迁 topstrip~~ **已被 §5.27 裁决取代**——§5.27 把 rail meta 定为「审批(badge)/Config」并退役 WorkspaceHome（项目工作移入右工作台「工作」主面），本项无需实施。留档：SessionStrip 已有 ＋ 的事实仍然成立，rail ＋ 的去留作为 builder 视觉精修时的顺手判断（保留亦可——46px 布局不动的前提下不强制）。

**Q2 · Thinking 的三层现实**：thinkingLevel 桌面零消费（`session.config` 事件在 ignore 清单、无 GET 调用）——因此**含网关与状态管道**：① 会话菜单打开时 `GET /api/session/:id/config` 拉取（SSE `session.config` 事件从 ignore 清单移出，增量 patch）；② 「默认档」= `thinkingLevel` **unset**（undefined）——徽标只在显式设定后出现（含显式 off），显示档位名；③ 「runtime 不支持」信号 = config GET 响应新增 additive 字段 `thinkingLevelSupported: boolean`（`SessionConfigService` 小改）；④ v1 **删掉 ⚙ 全部设置行**（菜单只有 Agent/模型/Thinking；per-session 设置面超范围，留后续）。

**Q3 · attention 发射点与重发语义**：**~~撤回~~**（移交 pod-event-layer；其 p0 不进事件表，重发/去重语义由该设计 §3.2/§10.5 决定）。

**Q4 · switchAgent 门双向**：① 非 coordination 会话切 **到** lead/manager → 403；② coordination 绑定会话切 **离** lead 到任何身份 → 403（防孤儿化注册槽位）；③ allowlist 白名单 = runtime 原生（build/plan 等）+ `mafw-create`，其余解析为注册表身份的目标一律 403（worker 身份本来就不该经此路由）；④ `lead-archived` 会话已解绑，不受限（可正常改造复用）。

**Q6 · 会话菜单 Agent 行含「默认」**：展开三项 **默认 / plan / build**（对齐 Tab 三态循环的完整状态集）——鼠标用户可回默认，不砍功能。

**Q5 · attention 作用域**：**~~撤回~~**（pod-event-layer 为跨项目权威设计，取代本设计的项目作用域 A；托盘 presence 归其 L1/L2/L3，见 supersession note 2）。

## 6. 留给 builder 的执行裁决

- 会话菜单 popover 的实现（复用 picker 形态还是独立小组件）与 AgentRow 展开交互。
- rail 字形的具体 SVG 路径与激活态是否收为药丸（视觉评审裁决，不强制）。

## 7. 验收线

- composer 常态 ≤7 元素；断点档 ≤2；所有既有键位回归用例通过。
- `switchAgent` 切 lead 403（非 coordination 会话）；coordination 会话切离 lead 403；build/plan/mafw-create 正常；archived 会话不受限。
- rail：46px 宽度/分组/布局零变化；四枚新字形渲染无回退（`icon-registry-coverage` 类守护）；＋无虚线；视觉对照截图留档。
- desktop 全量 + 契约测试绿；`tsgo -p` / `electron-vite build` rc=0；新增测试逐任务报告。
