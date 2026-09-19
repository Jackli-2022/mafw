# MAFW Desktop 全面重设计（精致暗色 + 品牌绿）— 设计文档

> 日期：2026-09-20
> 前置：v2 美化（docs/archive/ui/MAFW界面美化-开发文档.md，2026-08-03 落地为现 v3 色板）、
> Rail 重设计（2026-09-01-rail-redesign-design.md，ChatGPT 式扁平列表已实施）
> 状态：设计已获用户逐节批准（§1–§4）

## 1. 背景与调研

### 1.1 现状评估（截图 + 代码分析）

当前 desktop（Electron + SolidJS，mafw.css 4209 行 v3 token 体系）功能完整但"工程师原型"质感：

- v3 token 体系（四阶背景/六阶文字/品牌绿/双主题）已存在，问题在**执行细节**
- 右栏信息堆叠过密，对齐混杂（左右对齐混用、视觉流乱）
- TabStrip 激活态弱（仅绿点）、面板分割线不统一、间距混乱
- Composer 绿色光晕突兀、输入区工具栏与右侧下拉拼凑感
- 模型分布图表原始（默认库样式）
- 无动效体系、无空状态设计

### 1.2 业界对标（2026-09 调研）

| 对标 | 设计语言 | 采纳点 |
|---|---|---|
| opencode desktop（本项目 UI fork 源，@mafw/ui/@mafw/session-ui） | 中性灰 mono、1px 实线边框、无光晕、高密度 | 边框纪律、信息密度控制 |
| DSH Desktop（anywhere-labs/dsh-desktop，27k★，截图已分析） | 深蓝灰底 + DeepSeek 蓝、半透明层次、8-12px 圆角、线性图标 | 深邃蓝调背景、可折叠思考过程、底部性能指标、克制玻璃感 |
| Codex（OpenAI） | ChatGPT 系中性灰、大圆角、大留白 | assistant 无边框排版流、任务卡片化 |
| pi（earendil-works） | minimal harness 美学、纸感 | 少即是多、排版驱动 |
| zcode（Z.ai CLI） | TUI 形态为主 | 仅作密度参考 |

### 1.3 用户决策记录

- 范围：**全面重设计**（视觉 + 布局重组 + 动效 + 空状态）
- 审美：**精致暗色 + 品牌绿**（对标 dsh 科技感，保留 MAFW 绿）
- 主题：**双主题同步**到同等精致度
- 布局：**允许重组**（RightDock 融合、Rail 内部重组等，不改功能语义）
- 交付：**分波，对话体验优先**

## 2. 目标 / 非目标

**目标**：把 desktop 从"能用"升到"业界水准的精致"；建立 token v4 + 动效 + 空状态三个此前缺失的体系层。

**非目标**：
- 不改功能语义、数据流、gateway API
- 不引入 UI 组件库替换（继续 @mafw/ui v2 组件约定：ButtonV2/TextInputV2/TooltipV2/LoaderV2/ToastV2）
- 不做虚拟滚动/动画库引入（CSS 原生动效足够）
- SplitView 分屏、窗口控制、Tray、语音管线结构不动

## 3. 设计

### §1 视觉语言（Token v4）

**背景五阶**（纯中性黑 → 冷蓝调深灰）：

```
--bg-base:    #09090B   窗口最底层
--bg-raised:  #101014   Rail/面板
--bg-overlay: #17171D   卡片
--bg-float:   #1F1F27   浮层/popover
--bg-inset:   #0D0D10   新增：凹陷井（代码块/指标条/思考展开/工具输出）
```

**品牌绿收敛为信号色**（只在：主动作/活跃选中/运行中/成功 四种语义出现）：

```
--accent:        #46DC82（不变）
--accent-strong: #5CE896   hover/按下
--accent-soft:   rgba(70,220,130,.12)   底色铺陈
--accent-border: rgba(70,220,130,.35)   激活描边
--info: #6CA6F1   新增（进行中/链接）；warning/danger 保留
```

**卡片配方**（全应用统一）：`1px --border-subtle 边框 + 顶部内侧高光 inset 0 1px 0 rgba(255,255,255,.03) + 浮层才用 --shadow-float`；发光只留给 focus ring 与活跃态。

**尺度**：
- 圆角 6px chips / 8px 控件 / 10px 卡片 / 14px 浮层
- 排版：UI 基准 13px、消息正文 15px、指标 `tabular-nums`、代码 mono
- Motion token：`--dur-1: 120ms`（hover）/ `--dur-2: 160ms`（press）/ `--dur-3: 200ms`（面板）/ `--dur-4: 240ms`（模态）；`--ease: cubic-bezier(.25,0,0,1)`

**亮色主题**：同构映射（纸白 #FAFAFA 底、#1F9D5A 绿、黑系 alpha 边框），每个暗色变量必须有亮色对应（测试断言）。

### §2 布局重组

**Rail**：
- 项目切换器简化（项目名 + chevron，hover 才显边框）
- New session 主 CTA 化：accent-soft 底 + accent-border 描边，hover 实心绿
- 会话行高 32px 呼吸感、日期分组保留、hover 统一、manager 星标精化
- 底部 UsagePill：进度条细线化 + tabular 数字

**TabStrip 激活态升级**：激活 pill `bg-overlay` 底 + 文字提亮 + 2px 绿色底部指示条；徽标统一小圆点数字。

**RightDock 五栏融合为四栏**：`任务 | 轨迹 | 用量 | 便签`（usage+quota 合并）：
- 用量 tab 三段式：上下文条 → KPI 行（tokens/成本/命中率）→ 分模型统计 + 配额分区（原 quota 整块并入，今日/7天/30天窗口切换保留）
- 指标行规范：label 12px muted 左 / value 13px tabular 右 / hairline 分隔
- 模型分布图自绘 CSS（细轨 + 圆角 + 绿渐变填充），替换默认图表样式

**页面骨架统一**：所有 pages 统一 PageHeader（标题+副标题+操作区）+ 卡片网格；Config 左导航保留跟新 token。

### §3 对话区（Wave 1 核心）

- **用户消息**：右对齐气泡——accent-soft 底 + accent-border 描边、圆角 10px（右下 4px 小角）
- **assistant**：无边框全宽排版流（760px 居中列保留）
- Sticky agent header 减负（12px / text-3，滚动才显 hairline）；turn 间 24px / part 间 12px
- **思考过程可折叠**（dsh 式）：折叠行 `✻ 已思考 12s` muted 单行；展开 = bg-inset 井 + 左 2px accent 竖线
- **Tool cards**：折叠单行 28px（图标+动词短语+状态点+耗时）；状态点运行中绿 pulse / 成功灰 / 失败 danger；路径命令 mono 12px 省略；展开输出进 inset 井
- **Composer**：单盒保留；focus 双层柔焦（1px accent-border + 4px accent-soft 外晕）；工具栏左 28px ghost 图标钮（附件/命令/模型/agent）、右上下文余量 pill + 32px 发送钮（实心绿 hover 微上移，busy 变停止钮 danger 描边）；附件 chips 20px 缩略图
- **Flow cards**（Ask/Permission）：左 3px 语义色竖条 + 图标，按钮组右下
- **Phase indicator**：减噪 3px + 12px 阶段名

### §4 动效、空状态与验收

**动效**（只用 transform/opacity，合成层）：

| 场景 | 效果 |
|---|---|
| 新消息进入 | fade + translateY 4px→0（200ms，仅最新条） |
| Tab 切换 | 内容淡入 160ms |
| 卡片/行 hover | 边框提亮 + 背景微升（120ms） |
| Dock/面板伸缩 | 200ms width+opacity |
| 模态/popover | 240ms scale .98→1 + fade |
| 运行中状态点 | 2s pulse |
| Loading | 1.2s skeleton shimmer |

- `prefers-reduced-motion: reduce` 全局禁用
- 不做：视差、大幅位移、弹跳

**空状态**：每个 dock tab / page 空态 = CSS glyph 图标 + 一句话 + 主 CTA（Dashboard 无 goals / Approvals 无待审 / Triage 空 / 便签空板）；WelcomeHome 排版精化。

## 4. 实施波次（方案一）

| Wave | 内容 | 验收物 |
|---|---|---|
| 0 | Token v4（新变量增量进入，v3 名字全保留）+ motion token + token 对齐测试 | 测试绿 + 双主题截图 |
| 1 | 对话体验：SessionTurn 消息流/composer/tool cards/思考折叠/TabStrip 激活态/flow cards | 截图对比 + 结构测试 |
| 2 | 骨架：Rail 重组 + RightDock usage+quota 融合 + UsagePill + PageHeader 组件 | 融合数据聚合单测 + 截图 |
| 3 | 全页面：Dashboard/Goals(TaskList)/Memory/Approvals/Triage/Automations/Config + 全部空状态 | 各页双主题截图 |
| 4 | 微动效收尾：动效清单全量 + skeleton + hover 微交互 | reduced-motion 验证 |

每波独立 commit + 版本号 + 新增测试数汇报（用户惯例）。

**计划拆分**：writing-plans 阶段按波出计划——首份计划覆盖 Wave 0+1（token v4 + 对话体验），Wave 2/3/4 各自续份计划（前波验收后再写，避免计划过期）。

## 4.1 落地文件映射

| 区域 | 文件 |
|---|---|
| token v4 / 动效 token | `packages/desktop/src/renderer/mafw/mafw.css`（主题变量层 §顶部 + motion 段） |
| token 对齐测试 | `packages/desktop/tests/token-alignment.test.ts`（新） |
| 对话区 | `components/ChatPane.tsx`、`MafwToolCards.tsx`、`AskCard.tsx`、`PermissionCard.tsx`、scoped session-ui overrides（mafw.css §4.5） |
| TabStrip | `components/TabStrip.tsx` |
| Rail | `components/Rail.tsx`、`UsagePill.tsx` |
| RightDock 融合 | `RightDock.tsx`、`UsageDock.tsx` + `QuotaDock.tsx` → 聚合模块 `usage-merge.ts`（新，纯函数） |
| 页面/空状态 | `pages/*.tsx`、`WelcomeHome.tsx` |

## 5. 测试与验收策略

1. **token 对齐测试**（新增）：解析 mafw.css，断言暗/亮主题变量一一对应、v4 新 token（bg-inset/accent-strong/accent-soft/accent-border/info/dur-*/ease）齐全、无硬编码色值回归（关键选择器白名单外禁 hex）
2. **数据聚合单测**：RightDock 融合的 usage+quota merge 纯函数
3. **结构断言**：TabStrip/Rail/composer 关键组件渲染结构
4. **视觉门禁**：每波 `mafw_desktop_screenshot` + 双主题各一张人工确认
5. **回归安全**：v3 变量名全保留（v2 token 覆盖层继续工作）；CSS 总量 ≤ 4209 行 +15%（~4840 行）
6. 性能：动效仅 transform/opacity；不新增运行时依赖

## 6. 风险

| 风险 | 缓解 |
|---|---|
| scoped session-ui 覆盖层（§4.5）与新设计冲突 | Wave 1 先修 scoped overrides，保持选择器特异性不变 |
| RightDock 融合动 15s 轮询两处数据源 | 融合为单一聚合函数 + 单测，UI 只消费聚合结果 |
| 动效导致低端机掉帧 | 仅合成层属性 + reduced-motion 兜底 |
| 亮色主题细节漂移 | token 对齐测试机械保证 |
| mafw.css 超 15% 预算 | Wave 内重构等价旧规则而非累加；每波行数检查 |
