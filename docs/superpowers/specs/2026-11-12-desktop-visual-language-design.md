# MAFW Desktop 配色、组件样式与动效重校准（布局冻结）

日期：2026-11-12  
状态：待整体批准；深色方向已获用户认可  
范围：Desktop / `@mafw/ui` / `@mafw/session-ui` 的视觉语言，不改页面布局与信息架构

## 1. 意图与背景

当前 Desktop 的“廉价感”不是某个页面单独造成，而是视觉系统同时存在以下问题：

- 亮色实测约 91% 像素集中在 `#EFEEE9` 与 `#FAF9F5`，表面发灰、边界偏弱。
- 暗色相邻表面亮度差仅约 1.05–1.10:1；`--text-4 #5E5C57` 在 `#100F0E` 上约 2.87:1。
- 绿色同时承担主操作、选中、运行与成功，动作色和状态色无法区分。
- `--border` 被消费 49 次但未定义，工作台、编辑器、预览和项目卡片的部分边框声明实际失效。
- 0.5px 发丝线、低对比文字和 9–12px 多档小字叠加，在 Windows 缩放下显得模糊。
- 圆角、图标光学尺寸、v1/v2 阴影和焦点语言不统一。
- 120/140/160/200/240/280ms 并存，呼吸、旋转、闪烁和 shimmer 缺乏统一的状态语义。

业界调研采用 OpenCode 的精确边界、Codex 的文档式可读性、DSH Desktop 的暗色表面分层，以及 Grok/dots 仅用于真实 Agent 状态的反馈方式；不复制品牌、吉祥物、玻璃背景或页面结构。

## 2. 已确认决定与本设计的取舍

### 用户已确认

1. 本轮先不管布局，优先处理配色、样式和动效。
2. 深色方向采用视觉样张中的石墨中性表面、近白主操作、蓝紫聚焦与薄荷绿成功色。

### 本设计提出、随本文一起审批

1. 浅色沿用同一语义结构：炭黑主操作、蓝色交互、绿色成功，而不是暗色的简单反相。
2. 保留现有页面骨架、栏宽、路由、面板排列、响应式断点和组件 API。
3. 保留现有 token 消费面，通过语义重映射与逐处分类完成迁移，不进行盲目全局替换。
4. 不引入 spring/动画库，不增加主题数量，不更换字体或组件库。

## 3. 目标 / 非目标 / 反目标

### 目标

- 双主题都有清楚的表面层级、可读文字与可靠边界。
- 主操作、交互聚焦、运行状态、成功状态具有不同且稳定的语义。
- 核心控件共享圆角、边框、阴影、排印、图标和焦点规则。
- 动效只表达 hover、选中、进入、展开、进度、运行与完成；减少动效时保留信息。
- 修复 `--border` 断链，并让 v1/v2/session-ui 在同一画面里保持一致。

### 非目标

- 不改 chat / workbench / rail / dock 的布局、宽度、默认视图或信息架构。
- 不改 Goal、Pod、审批、runtime、gateway、记忆或文件预览行为。
- 不做 v1 → v2 组件迁移，不新增 npm 依赖，不重写 CSS 架构。
- 不重设计代码语法高亮色、插画、品牌 Logo 或移动端/TUI。

### 反目标

即使测试通过，出现以下情况也视为失败：

- 用大面积蓝色/绿色、渐变、光晕或玻璃拟态制造“高级感”。
- 通过降低文字对比度换取极简感。
- 为统一动效而删除状态文字、加载反馈或减少动效支持。
- 因字体/边框调整引入新的溢出、遮挡或意外换行。

## 4. Token 架构与兼容策略

采用三层职责，但不推倒现有变量：

1. **Primitive**：本文列出的 raw hex / duration / radius 值。
2. **Semantic**：沿用 `--bg-*`、`--text-*`、`--accent`、`--success` 等现有名称。
3. **Component**：只补充主操作等无法由旧语义准确表达的 token，例如 `--action-primary-bg` / `--action-primary-fg`。

三主题作用域保持现状：默认暗色、手动亮色、系统亮色；键集一致。`data-theme` 与 `data-color-scheme` 的既有双写机制不变，不增加第三条主题通道。

### 4.1 表面

| 现有 semantic | 暗色 | 亮色 | 用途 |
|---|---|---|---|
| `--bg-base` | `#111315` | `#F6F7F8` | 应用画布 |
| `--bg-inset` | `#15181B` | `#E9EBEE` | 内嵌区、输入与轨迹背景 |
| `--bg-raised` | `#181B1E` | `#F0F1F2` | 抬升表面/控件底 |
| `--bg-overlay` | `#202428` | `#FFFFFF` | 内容覆盖层 |
| `--bg-float` | `#282D32` | `#FFFFFF` | 菜单、弹层；亮色配合浮层阴影 |

### 4.2 文字

| 现有 semantic | 暗色 | 亮色 | 规则 |
|---|---|---|---|
| `--text-1` | `#F2F4F5` | `#181A1D` | 主文字 |
| `--text-2` | `#B8C0C7` | `#4E555D` | 正文/次级 |
| `--text-3` | `#939DA6` | `#606A74` | 有意义的元信息 |
| `--text-4` | `#8A959F` | `#606A74` | 次级元信息；保持全表面可读 |
| `--text-5` | `#8A959F` | `#606A74` | 存量消费仍有状态文字，先保证可读，不以名义“装饰”豁免 |

对比度按 **text × 全部实际 surface** 矩阵验收，不能只验证 token 字符串或 Canvas 单点。亮色 `#606A74` 在最深 inset 上为 4.61:1；暗色 `#8A959F` 在 float 上为 4.55:1，`#939DA6` 更高。disabled 通过组件 opacity/状态表达，不再依靠把 text-5 降到不可读。

### 4.3 动作与状态色

| Semantic | 暗色 | 亮色 | 用途 |
|---|---|---|---|
| `--accent` | `#9DB4FF` | `#2B54D8` | 选中、链接、focus、运行等交互 |
| `--action-primary-bg` | `#E8EAEC` | `#202226` | 主按钮、发送等主操作 |
| `--action-primary-fg` | `#17191B` | `#FFFFFF` | 主操作前景 |
| `--success` | `#6FC79B` | `#247A4D` | 通过、完成、成功进度 |
| `--warning` | `#E6B85C` | `#956100` | 警告/需审批 |
| `--danger` | `#F08B92` | `#C43D47` | 错误与危险操作 |
| `--info` | `var(--accent)` | `var(--accent)` | 信息提示 |

迁移纪律：

- 先审计 `var(--accent)` / `--accent-text` / `--accent-soft` 的全部消费，按“交互 / 主操作 / 成功”分类，禁止一把全局替换。
- **所有实心 commit/确认类主操作**使用 `--action-primary-*`：包括 ButtonV2 `contrast`、发送、新建 Goal、审批确认、flow 确认与 Pod/rail CTA；不新增 ButtonV2 API。每个区域仍只保留一个视觉主操作。
- tab、链接、focus 和运行指示使用 `--accent`。accent-soft 背景上的文字使用 text-1 或经对比验证的 accent；禁止暗色浅蓝紫实底继续搭配白字。
- `--on-accent` 只保留给确需 accent 实底的少量状态组件，并按主题验证前景；主操作不得借用它替代 `--action-primary-fg`。
- Goal Eval 通过、已完成、成功进度使用 `--success`。
- `--accent-success` 等历史别名收敛到 `--success`，保留兼容 alias，不增加新的绿色 raw 值。
- `--accent-dim` / `--accent-border` / `--accent-strong` / `--selection` / `--focus-ring` / `--composer-focus` 全部跟随交互蓝；Monaco 选区也使用同一 selection 语义。
- composer 使用实边框 + 2px focus ring；移除装饰性 `--composer-halo` / `--glow-accent`，不再以光晕承担焦点。

## 5. 边框、圆角、阴影、排印与图标

### 5.1 边框与焦点

- 在每个主题块定义 `--border: var(--border-base)`，修复 49 处断链；从测试白名单移除该债务。
- `--hairline` 从 0.5px 收敛为 **1px**；同时迁移现有 **55 处字面 0.5px 边框/ring**，因为当前 `var(--hairline)` 实际消费为 0。阴影内部非边框用途单独判断，不机械替换。
- 普通分隔：暗色 `#30363C`，亮色 `#DFE3E7`，不强制 3:1；它们不承担唯一控件识别。
- 输入/关键控件专用 strong：暗色 `#8B969F`，亮色 `#7C858E`，在各自 base/raised/inset 上至少 3:1；不得把这档 strong 扩散到所有分隔线。
- `:focus-visible` 使用 2px `--accent` + 2px 背景 offset，焦点对比至少 3:1；禁止仅用低透明光晕表示焦点。

### 5.2 圆角

组件职责只有三档，现有变量作为兼容 alias：

- 控件 6px：`--r-sm`。
- 内容容器 10px：`--r-md` / `--r-lg` 暂时同值。
- 浮层与 composer 12px：`--r-xl`。
- 999px 仅用于真正的圆点、头像和胶囊，不扩张到普通卡片。

### 5.3 阴影与材质

- 内容卡片、表单、聊天区、Monaco 和终端保持实底，不使用玻璃或背景渐变。
- 内容卡片不添加装饰阴影；阴影只用于 menu/dialog/toast/popover 等浮层。
- 暗色浮层采用低透明黑影 + 1px 边缘线；亮色使用柔和短阴影 + 边缘线。
- 对齐 v1/v2 的 elevation 映射，**只在 MAFW Desktop 现有作用域补齐** state/icon/border/focus token，不修改 `@mafw/ui` 的公开默认主题或发布语义。
- 对存量 raw 色值逐处分类：交互/成功/警告/危险迁移到 semantic；代码 syntax、diff 增删、OS 窗口关闭色可保留为独立 scoped primitive，不计入“新增体系外色”。
- 存量核心界面的装饰渐变、glow 与非必要 backdrop-filter 一并移除；进度条改为 solid semantic fill。既有测试若锁死渐变、0.5px 或内高光，需在同一 Wave 先改失败测试，不能为保旧断言保留冲突样式。

### 5.4 排印

- 保持 Inter Variable / JetBrains Mono Variable，不增加字体文件。
- 普通 UI 14px；有意义的辅助与元信息 12px；对话正文 16px/1.7；页面标题 24px 档。
- 路径、命令、hash、计数使用 mono 与 tabular nums。
- 核心 chrome、chat、Goal/Project、工具卡先清理 9/9.5/10/10.5/11px 的有意义文字；其余页面做同规则审计。
- 不改变布局栏宽；若 12px 迁移产生溢出，优先调整内部截断与 padding，不改信息架构。

### 5.5 图标与滚动指示

- 核心 chrome 使用已注册 SVG 图标，光学尺寸 16–18px、描边约 1.5px；不新增未注册图标名。
- 高可见度的 `✕ / + / ▸ / ▾` 等文本字形替换为已注册图标，保持命中区与布局尺寸。
- 保留消息导航功能，只校准刻度颜色、active 对比和 hover 反馈，不改变其位置或行为。

## 6. 动效系统

### 6.1 统一 token

| Token | 值 | 用途 |
|---|---:|---|
| `--dur-press` | 80ms | 按压缩放，幅度不超过 2% |
| `--dur-fast` | 120ms | hover、颜色、边框、图标 |
| `--dur-select` | 180ms | tab/选中位置与小状态迁移 |
| `--dur-enter` | 220ms | 内容进入、展开、结果更新 |
| `--dur-surface` | 240ms | popover/dialog/drawer |
| `--dur-progress` | 320ms | 新进度到达时的单次推进 |

- 标准曲线：`cubic-bezier(.2,.8,.2,1)`；退出使用既有加速曲线的等价 token。
- 旧 `--dur-1..4` 映射到上述尺度，标记 deprecated，不要求一次改完所有消费方。
- 既有 grid/panel 动效只改时长与曲线，不改最终几何、轨道尺寸或断点。

### 6.2 状态语言

- hover 只改背景、边框、颜色；按压位移/缩放克制。
- 本轮 tab 使用各自背景、边框、颜色与 180ms 状态过渡；**不新增测量 DOM 的共享滑动指示器 JS**，避免把视觉校准扩张成组件机制改造。共享指示器可作为后续独立动效增强另审。
- 表面进入最多 4px 位移 + opacity；弹层可用 `.98 → 1` 的轻微缩放。
- 进度只在数值更新时播放一次，完成即稳定。
- 同一区域最多一个循环状态指示器；运行用 1.6s 低频 opacity pulse，完成立即停止。
- spinner、phase pulse、shimmer 不得在同一状态上叠加；流式正文保留尾光标，完成即移除。
- 不为在线、空闲、已结束添加环境呼吸或装饰循环。

### 6.3 减少动效

- `prefers-reduced-motion` 下动画/过渡直达终态，保留文本和静态状态图标。
- 流式光标静止；运行点不闪；展开、tab、dialog 不发生位移或缩放。
- 保留现有局部 reduced-motion 覆盖，并统一纳入同一契约测试。

## 7. 实施波次

| Wave | 内容 | 主要文件/区域 |
|---|---|---|
| 0 | accent 消费分类、token 测试基线、`--border` 复现测试 | `mafw.css`、`theme-merge-css.test.ts`、`token-alignment.test.ts` |
| 1 | 双主题 primitive/semantic 映射、Desktop 作用域内 v1/v2 对齐、边框/焦点/圆角/阴影 | `mafw.css` 及必要的 Desktop scoped 样式；不改 `@mafw/ui` 公开默认主题 |
| 2 | 核心组件排印、图标、按钮、badge、composer、工具卡、消息导航 | Desktop chrome、`packages/session-ui`、相关 v2 CSS |
| 3 | 动效 token、循环状态收敛、reduced-motion 契约 | `mafw.css`、相关组件 CSS |
| 4 | 真实 Desktop 双主题与密集/空状态视觉验收、全量门禁 | chat、项目页、Goal 详情、编辑器/终端、popover |

每波先写失败测试，再实现；每波独立记录新增测试数与全量通过数。提交/版本号按仓库既有交付惯例处理，但不 push、deploy 或 release，除非用户另行批准。

## 8. 验收

### 自动验收

- 三主题 token 键集一致；不存在未定义的 `--border` 消费；旧 alias 不丢失。
- 文本对比：正常正文/元信息至少 4.5:1；焦点与关键控件边界至少 3:1。
- 主操作、交互、成功使用不同 semantic；无新增体系外绿色/蓝色 raw 值。
- 内容卡片无装饰阴影；focus-visible、disabled、loading、reduced-motion 状态存在。
- 动效只使用批准的 token；禁止同区域叠加循环；减少动效后信息仍完整。
- Desktop 全量测试、`npx tsgo --noEmit -p tsconfig.json`、`npx electron-vite build` 通过；desktop 测试命令保留 `--conditions=browser`。

### 真实 GUI 验收

分别截取亮色与暗色，并覆盖当前真实数据状态：

1. 项目页：多 Goal + 文件树 + 团队状态。
2. Goal 详情：长 Goal Eval、通过标签、进度与操作按钮。
3. Chat：长上下文、工具卡、composer、模型选择器。
4. 工作台：Monaco、终端、文件预览和至少一个浮层。
5. hover / focus / tab / 展开 / 运行→完成 / reduced-motion 的动态检查。

至少覆盖 1366 宽与当前 2560×1380 窗口；不得出现新增横向溢出、文字不可读、边框消失、暗色亮闪或主题双写不一致。

实施者使用现有 automation-server 截图并附证据；窗口尺寸和主题通过现有 UI/窗口能力调整，**不为了验收新增主进程端点**。自动截图完成后设置人工视觉检查点，未经用户确认不宣称 Wave 4 视觉验收通过。

## 9. 风险与回退

| 风险 | 处理 |
|---|---|
| `--accent` 重映射误伤成功状态 | 先分类审计，逐处迁移；不全局替换 |
| v1/v2 级联顺序造成局部旧色 | 在现有 MAFW 作用域补齐映射，用真实组件截图验证 |
| 1px 边框与 12px 元信息造成密度回归 | 保持布局，调内部 padding/截断；1366/2560 双宽度验收 |
| Windows 开发服务器漏掉整文件 CSS 变更 | 按 Desktop AGENTS.md 用 `touch` 或重启 dev，再 reload；构建产物另验 |
| 动效统一删除必要反馈 | 状态文字和静态图标优先保留，reduced-motion 专项验收 |
| 改动范围逐步扩张成布局重构 | 任何栏宽、排列、路由或默认视图变化都退回本文审批边界 |

## 10. 留给实施者的决定

- 在现有 CSS 分区内放置新 token 与兼容 alias 的具体位置。
- 按组件逐处迁移时的最小文件拆分与 commit 粒度。
- 非核心页面同类问题的修复顺序，只要不扩大为布局或组件 API 重构。

## 11. Builder Review 后的定稿修订

独立 reviewer 检查了当前 CSS、组件 token、测试与 automation-server。以下问题已直接在设计层收敛，不需要用户逐项做技术决策：

1. 文字与 accent 改为全表面对比度矩阵，亮文字与亮蓝适当加深，暗色弱文字适当提亮；深色方向不变。
2. 3:1 只强制 focus 与输入/关键控件专用 strong，不要求所有细分隔线变成重边框。
3. 主操作覆盖所有实心确认类动作，不只发送和新建 Goal。
4. 存量渐变、光晕、raw 色值和旧测试纳入本轮分类清理；syntax、diff、OS 专用色有明确豁免。
5. accent 家族、selection、composer 与 Monaco 选区统一交互语义，装饰 halo 退役。
6. v1/v2 对齐只在 Desktop 作用域进行，不改公开 UI 包默认主题。
7. 55 处字面 0.5px 才是实际迁移对象，不能只改 `--hairline` token。
8. 本轮不新增共享 tab 指示器 JS，避免视觉任务扩张成组件机制改造。
9. GUI 验收使用现有通道，最后保留人工视觉 gate，不新增验收专用主进程端点。

`token-alignment.test.ts` 当前不存在，Wave 0 新建；既有 `motion-tokens.test.ts`、`design-contract.test.ts` 等与新方向冲突的断言先改成新契约并确认失败，再改实现。
