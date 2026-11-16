# Desktop 高级感与动效调研（2026-11-16）

- 状态：调研完成（未改产品代码）
- 范围：MAFW Desktop 现有视觉/动效；Hermes Desktop；OpenCode Desktop；Linear；Vercel Geist；IBM Carbon；Material 3 Expressive；Apple HIG；Emil Kowalski 的动效原则
- 方法：运行中的 MAFW Desktop 截图 + `packages/desktop/src/renderer/mafw/mafw.css` / `packages/session-ui` CSS 审计 + 官方产品页/文档/截图
- 结论一句话：**我们不是“特效不够”，而是“视觉竞争太多、动效没有编排”。高级感来自减法、层级和连续性，不来自 glass / glow / 渐变。**

---

## 0. TL;DR

1. Hermes Desktop、OpenCode Desktop、Linear 的共同点不是“更炫”，而是**更少的视觉竞争**：一个焦点、一个 accent、少量结构线、克制的图标与颜色。
2. MAFW 的工程底子不差：已有 16px/1.6 的聊天阅读排版、720/880 的内容宽度、完整主题 token、reduced-motion、press/focus 语义、欢迎页 40ms stagger。
3. 但界面层面存在明显的“工程正确、视觉过载”：
   - `mafw.css` 有 **219 条 `border:`**、**382 条 `border-radius:`**（其中 269 条是裸 px）、**78 条 `box-shadow:`**；
   - **57 条 `animation:`** 里 26 条用裸 ms，只有 4 个通用 entrance keyframe；
   - **123 个 `:hover` 对 13 个 `:active`**，按压反馈只在少数控件；
   - **0 处 View Transition / shared element**，没有跨表面连续性；
   - 半径 token `--r-md` 与 `--r-lg` 都是 10px，实际使用里 3/4/5/6/8/10/12px 混用；
   - `session-progress-indicator-v2.css` 手写了 **24 个近乎相同的 keyframes**。
4. 最值得做的不是“加特效”，而是四件事：
   - **Chrome 退后**：rail / topstrip / 非活动 tab 变暗、变紧凑、减少彩色点与图标；
   - **边框预算**：每屏只保留 1–2 层结构线，嵌套卡片改用间距/表面色差；
   - **几何收敛**：半径 6/10/14、elevation 3 层、文字 3 级灰；
   - **动效编排**：press / hover / focus / enter / exit / shared-element 分层，空间动效才用 spring。
5. 不建议：全屏 glassmorphism、紫蓝渐变、泛光、所有卡片悬浮、过量 spring、把高频交互做成动画。这些正是“AI 味 / 廉价感”的来源。

---

## 1. 业界基准

### 1.1 Hermes Desktop（Nous Research）

官方截图（Microsoft Store）：

- 深色近黑工作区，左侧窄 sidebar，中间 chat，右侧可扩展；
- 空状态用 **巨大的衬线 display 字** “HERMES AGENT” 建立品牌锚点，正文只有一句说明；
- 设置页是三栏结构：主导航 / 列表 / 详情，大量留白，小号 uppercase 分组标签，单一蓝色 accent；
- 结构线非常少，面板之间主要靠**色差与留白**分隔，而不是每条边都画线；
- 营销图里 app 浮在蓝色氛围背景上，但**工作区本身是实底**，没有把玻璃效果带进高密度操作区。

可借鉴：

- 空状态/首屏的 typographic anchor（不是插画堆满）；
- 设置的“三栏 + 大留白 + 小标签”；
- chrome 退后、内容先行；
- 一个 accent，状态色只做小面积提示。

不照搬：

- 营销页的氛围背景 / 玻璃外框；
- 巨型 serif 字不适合所有工作页面，只适合 welcome / onboarding / empty。

### 1.2 OpenCode Desktop

官方产品页/OG 图与页面源码：

- 背景是接近纯黑的 `#0c0c0c`，文字纯白，只有一个蓝色小点作为状态 accent；
- 首屏是巨大的像素 display 字 + 极大的负空间，右侧只露一条窄的 session UI；
- session tabs 在顶部，紧凑、带彩色状态点，活动 tab 轻微抬起；
- 页面几乎没有阴影和大面积边框，代码面板本身就是“纹理”；
- 字体预加载、hero 图预加载，首屏不跳。

动效（从产品页源码直接读到）：

- 卡片 grow **380ms** / shrink **340ms**；
- easing `cubic-bezier(0.32, 0.72, 0, 1)`；
- page fade **220ms**，page delay 60ms，image fade 160ms；
- 使用 **View Transitions API** 做卡片与产品页之间的共享元素 morph，距离越远时长按比例缩短。

可借鉴：

- **连续性**：同一对象在列表与详情之间 morph，而不是“关一个弹窗、开另一个页面”；
- 极黑背景 + 极高对比文字 + 一个 accent；
- tabs 紧凑、状态点克制；
- 首屏排版比装饰更重要。

### 1.3 Linear

Linear 2026-03 的设计刷新文章给了一个非常直接的判断：

> “Don’t compete for attention you haven’t earned.”
> “Structure should be felt, not seen.”

他们的具体动作：

- 侧边栏**变暗**，让主内容区优先；
- 顶部 tabs **更紧凑**，更小图标与文字；
- 减少图标数量与彩色底板；
- 减少无意义分隔线，**软化边框对比、把边角变圆**；
- 默认暗色从冷蓝灰转向**更暖、更低饱和**的灰。

这几乎逐条对应 MAFW 目前的问题：rail/topstrip 太亮、tab 太多太满、图标/彩色点太多、边框太多、色温偏冷。

### 1.4 Vercel Geist

Geist Materials 把 surface / floating 分成明确预设：

- surface：base 6px、small 6px、medium 12px、large 12px；
- floating：tooltip 6px、menu 12px、modal 12px、fullscreen 16px；
- 每个预设固定 fill / stroke / shadow，不允许每个组件随手写。

可借鉴：

- **半径与 elevation 是预设，不是每次现写**；
- 页面表面最多 3 层，浮层才用 shadow；
- 结构线是“预设的一部分”，不是装饰。

### 1.5 Carbon / Material 3 / Apple HIG

**IBM Carbon**：

- 区分 productive motion（效率、克制）与 expressive motion（重要时刻）；
- duration tokens：70 / 110 / 150 / 240 / 400 / 700ms；
- 微交互 90–120ms；exit 比 enter 快；大位移更长；
- 评价清单：motion 是否有目的、是否响应、是否细致、是否不打扰。

**Material 3 Expressive**：

- 空间动效与效果动效分开：
  - spatial 可以有 spring / overshoot；
  - effects（颜色、透明度）不该 overshoot；
- expressive fast spatial ≈ 350ms，effects ≈ 150ms；
- 标准 duration 仍是 100ms（short）/ 300ms（medium）级别；
- spring 参数以 stiffness / damping / initial velocity 表达，而不是一条万能 bezier。

**Apple HIG**：

- 动效要有目的，不能压过体验；
- 反馈动效短暂、精确；
- **高频交互一般不加自定义动画**；
- 让人可以取消/不等动画；
- 必须尊重 reduced motion。

可借鉴：

- 我们的 80/120/180/220/240/320 分层是合理的，不需要推翻；
- 需要补的是 **exit 更快、spatial spring、shared element、以及“高频不加动画”的纪律**。

---

## 2. MAFW 现状审计

### 2.1 量化

| 指标 | 现状 | 含义 |
|---|---:|---|
| `mafw.css` 行数 | 8,733 | 单文件已经很大，视觉规则分散 |
| `border:` 声明 | 219 | 结构线过多，容易像线框图 |
| `border-radius:` 声明 | 382 | 几何不收敛 |
| 裸 px 半径 | 269 | token 没有真正统治 |
| `box-shadow:` | 78 | 浮层/卡片阴影偏多 |
| `backdrop-filter` | 3 | 材质层次几乎不存在 |
| `transition:` | 74 | 其中 71 条已用 token，基础不错 |
| `animation:` | 57 | 27 条用 token，26 条裸 ms |
| `@keyframes` | 24 条声明（23 个唯一名称，`mafw-dock-in` 重复） | 通用入场只有 4 个 |
| `:hover` / `:active` / `:focus-visible` | 123 / 13 / 29 | hover 丰富，按压反馈稀缺 |
| `will-change` / `contain` | 0 / 0 | 没有显式性能提示 |
| View Transition / shared element | 0 | 没有跨表面连续性 |

半径分布（出现次数）：

- `8px` 43、`50%` 42、`999px` 41、`6px` 40、`var(--r-sm)` 37、`4px` 36、`var(--r-md)` 28、`var(--r-lg)` 20、`10px` 18、`3px` 18、`5px` 7、`12px` 7。

问题不在“有 8px 和 6px”，而在于 **同一层级的组件没有统一选择**：列表行 4/6px、卡片 8/10px、弹层 10/12px，靠人眼看不出规则。

### 2.2 截图观察（当前运行界面）

- 顶部同时出现 **10 个 session tab**，每个 26px 高、13px 字、彩色 agent dot、活动/非活动都占同样的视觉重量；标题大量截断成 “Just ok r… / Pod 与右… / dsh supe…”。
- 左侧 rail 与 topstrip 的亮度接近内容区，chrome 没有退后。
- 右侧 Goal 详情是嵌套卡片：外层 panel、hero、chip 行、代码结果卡、版本历史卡，每层都有边框/底色；失败卡用大面积浅红底色 + 红字，视觉上比主内容更抢眼。
- 聊天正文本身的排版是好的：16px、1.6 行高、720/880 列宽、tabular numerals。
- 文字灰阶 `text-3/4/5` 在暗色下几乎相同（`#939DA6` / `#8A959F` / `#8A959F`），元信息缺少层级。
- 颜色同时有 periwinkle accent、绿/橙/红状态、语法高亮；状态色进入了大面积背景，而不是只做小标记。
- 空状态：`mafw-chat-empty` 只是 13px 的一行字；`mafw-empty-state` 是 44px 圆底 glyph + 13px 标题；welcome 页有 26px 标题和 40ms stagger，但只在 welcome 出现。

### 2.3 动效现状

已有优点：

- 动效 token 分层明确：press 80 / fast 120 / select 180 / enter 220 / surface 240 / progress 320；
- `prefers-reduced-motion` 已覆盖；
- 欢迎页有 40ms 的 chips → title → actions 级联；
- 流式响应有尾光标；
- 部分控件有 `:active`；
- `grid-template-rows: 0fr → 1fr` 已用于折叠。

缺口：

- **没有共享元素**：tab → 会话、Goal 卡 → Goal 详情、文件树 → 预览都是“换一块内容”，没有空间连续性；
- **没有 spring**：全部是 cubic-bezier；对拖拽、面板、开关、重排这类空间动作，缺一点“物理感”；
- **按压反馈少**：13 个 `:active` 对 123 个 `:hover`，大量可点击卡片/行没有按下反馈；
- **exit 缺失**：大多数地方只有 enter，关闭/消失是瞬时的；
- **动画 keyframes 手写膨胀**：24 个 progress dot keyframes 可以用 1 个 keyframe + 负 delay 完成；
- **高频 hover 动画太多**：列表每行都在 transition background/color/box-shadow，真正需要动效的地方反而没有编排；
- **没有性能预算**：0 个 `will-change` / `contain`，长列表 + 多动画时容易掉帧；
- **重复定义**：`mafw-dock-in` 在两个位置定义；`.mafw-goal-panel` 也有两套定义。

---

## 3. 为什么看起来“廉价”

按影响排序：

1. **没有焦点**。一个屏幕上同时有 10 个 tab、rail 图标、状态点、Goal 标题、红色失败卡、多个 chip。用户 1 秒内不知道该看哪里。高级界面每屏只有一个明确主角。
2. **结构靠线，不靠空间**。219 条 border 让界面像线框图；Linear 的结论是“结构应该被感觉到，而不是被看见”。嵌套卡片 + 每层边框是廉价感的最大来源。
3. **几何没有系统**。半径 3/4/5/6/8/10/12 混用，`r-md == r-lg`；elevation 3 级但 20 处 float shadow。人眼说不出哪里不对，但会觉得“没做完”。
4. **颜色在喊**。失败卡大面积浅红、状态 chip 多色、accent 与语法色同时出现。高级界面把颜色当“标点”，不是“底色”。
5. **动效没有物理**。所有东西都是 120–240ms 的淡入/位移；没有 origin、没有 continuity、没有 press。看起来像“CSS 过渡集合”，不像一个会回应的物体。
6. **文字层级平**。UI 大量 13px，`text-3/4/5` 几乎同色；没有 display 尺寸的工作页标题。高级感很大一部分来自“大小对比 + 留白”，不是字体本身。
7. **空状态没有 atmosphere**。`mafw-chat-empty` 一行 13px 灰字；Hermes 用整屏排版建立品牌记忆。空状态是用户第一次进入产品时的“第一印象”，现在被浪费了。
8. **高频元素过度装饰**。每个 tab 都有彩色 dot，每个列表行都有 hover 过渡；真正重要的运行状态反而不突出。

---

## 4. 高级感的 6 条可执行原则

1. **注意力预算**：每屏只有一个主焦点；导航、工具栏、元信息主动退后。判断标准：截图眯眼时，第一眼看到的是不是当前任务。
2. **结构不靠边框**：优先用间距、表面色差、对齐和一条 hairline；嵌套层级超过 2 层时，先删边框而不是加阴影。
3. **几何收敛**：半径、间距、字号、elevation 都从固定集合里选；不允许“这次 8px 下次 10px”。
4. **动效是空间关系**：从触发点出现、向来源消失、共享元素保持连续；enter 220ms、exit 140ms，高频交互 80–120ms。
5. **物理只给空间**：位置/缩放/拖拽可以用 spring；颜色、透明度、阴影用曲线，不要 overshoot。
6. **状态诚实 + 颜色克制**：成功/失败用 dot + 文本 + 小面积背景，不用整卡染色；一个 accent 负责交互，语义色只负责状态。

---

## 5. 三个方向

| 方向 | 感觉 | 关键动作 | 风险 | 适配度 |
|---|---|---|---|---|
| **A. Precision Instrument（推荐）** | 精密、安静、贵而不炫 | 近黑中性底、一个 periwinkle accent、chrome 退后、边框预算、6/10/14 半径、克制的共享元素动效 | 低；延续现有 token 与反渐变约束 | ★★★★★ |
| **B. Editorial Workspace** | 有呼吸感、像高端写作工具 | 更暖的纸灰、更大的标题、更多留白、welcome/空状态用 display 字，工作区仍克制 | 中；需要重做色温与排版尺度 | ★★★★ |
| **C. Cinematic Glass** | 氛围、玻璃、发光 | 全局背景光斑、glass 浮层、渐变边框、更强阴影 | 高；容易落入“AI 味”，与现有 visual-language 测试冲突，密度高的工程界面可读性下降 | ★★ |

推荐 **A + 少量 B**：

- 工作区走 A（安静、精密、低噪音）；
- welcome / 空状态 / onboarding 借 B 的排版锚点；
- 不把 C 带进工作区，最多用于营销图或启动页。

---

## 6. 建议的落地顺序

### P0：先做减法（预计 1–2 天，收益最大）

1. **Chrome 退后**
   - rail / topstrip 背景降到与 base 同一层，非活动图标/文字降到 `text-3`；
   - 非活动 tab 去掉彩色 dot（只在 running / failed / waiting 时显示一个点）；
   - tab 超过 6 个时压缩为 icon + 短标题 / 仅 icon，其余进 overflow；
   - close 只在 active 或 hover 时出现（现在已部分如此，扩展到全部）。
2. **边框预算**
   - Goal 详情的内层卡片去掉 border，改用 `--bg-raised` / `--bg-inset` 色差 + 16/24px 间距；
   - 只有输入框、可交互边界、modal 保留 1px 强边框；
   - 分隔线统一为一条 `--border-hairline`，不再每层画框。
3. **几何收敛**
   - `--r-sm: 6px`、`--r-md: 10px`、`--r-lg: 14px`、`--r-xl: 18px`（消除 md == lg）；
   - 列表行 6px、卡片 10px、浮层 14px、modal 18px；
   - 逐步替换 269 条裸 px；新增 CSS 禁止裸半径（可加测试）。
4. **颜色克制**
   - 失败卡改中性底 + 2px 红色左轨 + 红色图标/标签，正文保持中性；
   - 状态 chip 用 dot + 文本，不再整块 tinted background（critical 除外）；
   - `text-3/4/5` 收敛为 3 级：primary / secondary / tertiary。
5. **空状态**
   - `mafw-chat-empty` 改成：品牌 mark + 一句 20–24px 的标题 + 3 条安静的建议动作；
   - welcome 已经是好底子，保留 40ms stagger，但把标题提升到 30–32px，减少 chips 数量。

### P1：动效编排（预计 2–3 天）

1. **Motion v8 token**（在现有 80/120/180/220/240/320 上扩展，不推翻）
   - `--dur-exit: 140ms`；
   - `--ease-exit: cubic-bezier(.4,0,1,1)`；
   - `--ease-spatial: cubic-bezier(.22,1,.36,1)`；
   - spring 只用于 transform：snappy 500/30、gentle 260/26（用 WAAPI / CSS `linear()` 近似，不引入每帧 JS）。
2. **微交互**
   - 所有可点击卡片/行：`:active { transform: scale(.985) }` + 80ms；
   - hover 只改背景/颜色/1px 抬升，不再每行做 box-shadow transition；
   - focus ring 120ms 淡入，保持现有 2px 可见性。
3. **表面入场/退场**
   - modal / command palette / popover：scale(.98) + fade，enter 180–220ms，exit 140ms；
   - scrim：52% 黑 + 8–12px blur（现在 goal overlay 只有 2px blur）；
   - 抽屉/侧栏：宽度过渡 + 内容 stagger 20ms，避免“整块突然出现”。
4. **Tab / 导航连续性**
   - active tab indicator 用 FLIP 或 View Transition 滑动，180ms；
   - 切换 session 时保留 header 的位置，内容 fade/translate 6px，220ms；
   - 不在高频 tab 切换上做大幅动画。
5. **折叠/展开**
   - tool card、details、队列：`grid-template-rows: 0fr → 1fr` + opacity，180ms；
   - 关闭时 140ms，先淡出再收高度。

### P2：共享元素与细节（预计 3–5 天）

1. **View Transitions**
   - session tab → 会话 header；
   - Goal 卡 → Goal 详情；
   - 文件树 → 文件预览；
   - 340–380ms，`cubic-bezier(.32,.72,0,1)`，距离远时缩短；不支持时降级为 fade。
2. **列表 stagger**
   - 只用于首次加载，20–40ms，最多 8 项；不要每次滚动都触发。
3. **Skeleton**
   - 超过 200ms 的加载才显示 shimmer，避免闪烁；shimmer 1.2s。
4. **Progress indicator**
   - 24 个 keyframes 收敛为 1 个 keyframe + `animation-delay: calc(var(--i) * -100ms)`。
5. **细节**
   - 统一图标尺寸/线宽；去掉彩色图标底板；
   - 自定义窗口 chrome 与 scrollbar 的 hover/active 过渡；
   - 可选：全局极低对比噪点/光晕（只做氛围，不进卡片），需先确认不违反现有“反装饰渐变”测试。

---

## 7. 动效规格表

| Token / 场景 | 时长 | 曲线 | 属性 | 用法 |
|---|---:|---|---|---|
| press | 80ms | `cubic-bezier(.2,.8,.2,1)` | transform: scale(.985) | 按钮、卡片、列表行按下 |
| hover | 120ms | `cubic-bezier(.2,.8,.2,1)` | background / color / translateY(-1px) | 非高频 hover |
| focus | 120ms | `cubic-bezier(.2,.8,.2,1)` | box-shadow / outline-color | 键盘 focus ring |
| select | 180ms | `cubic-bezier(.16,1,.3,1)` | background / indicator position | tab、segmented、列表选中 |
| enter | 220ms | `cubic-bezier(.16,1,.3,1)` | opacity + translateY(6px) | 新消息、页面内容 |
| exit | 140ms | `cubic-bezier(.4,0,1,1)` | opacity + scale(.99) | toast、popover、关闭 |
| surface / panel | 240ms | `cubic-bezier(.16,1,.3,1)` | grid/clip + 内容 stagger 20ms | 侧栏、抽屉、面板 |
| shared element | 340–380ms | `cubic-bezier(.32,.72,0,1)` | position/size morph | tab→会话、卡→详情 |
| progress | 320ms | `cubic-bezier(.2,.8,.2,1)` | width/opacity | 进度、骨架 |
| spring snappy | — | stiffness 500 / damping 30 / mass .8 | transform only | 开关、拖拽释放、重排 |
| spring gentle | — | stiffness 260 / damping 26 / mass 1 | transform only | 面板、drawer |

纪律：

- **高频交互（滚动、输入、tab 切换）不超过 220ms**；
- **exit 永远比 enter 快**；
- 不在 dense data table 上用 back.out / overshoot；
- 颜色/透明度不用 spring；
- 所有动画必须可在 `prefers-reduced-motion` 下退化为终态；
- 不使用逐帧 JS 驱动长列表。

---

## 8. 视觉规格表（建议）

### 表面

- `--bg-base: #111315`（保留）
- `--bg-raised: #181B1E`（保留）
- `--bg-overlay: #202428`（保留）
- 同时可见表面不超过 3 层；嵌套卡片优先用 `raised` vs `inset` 色差，不再加 border。

### 边框

- `--border-hairline: #262B30`（建议新增，比当前 `#30363C` 更退后）
- `--border-subtle: #30363C`（保留给结构线）
- `--border-strong: #4B555F`（只给输入框/可交互边界）
- 每屏结构线预算：1–2 层；超过时先删线。

### 半径

- `--r-sm: 6px`（列表行、chip）
- `--r-md: 10px`（卡片、popover）
- `--r-lg: 14px`（panel、modal）
- `--r-xl: 18px`（大浮层）
- 同心圆角：外层 radius = 内层 radius + padding，避免“内外不平行”。

### 字体

- UI：12 / 13 / 14px；正文 14px；聊天 16px / 1.6；
- 页面标题：24–28px，`letter-spacing: -0.02em`；
- 空状态标题：28–32px；
- 分组标签：11–12px uppercase，`letter-spacing: .06em`，只用于少量 section；
- 数字继续 tabular-nums；代码继续 JetBrains Mono。

### 颜色

- accent 只用于：focus、selection、primary action、active indicator；
- 状态色只用于：dot、icon、2px 左轨、少量文字；
- 大面积失败/成功提示改中性底；
- 语法色保留，但不进入 chrome。

### 阴影 / 材质

- 页面卡片：无 shadow，靠表面色差；
- popover/menu：`--elev-soft`；
- modal：`--elev-panel` + 52% scrim + 8–12px blur；
- 只有 floating 层允许 shadow；
- 不引入全局 glass / gradient border。

---

## 9. 验收标准

1. **眯眼测试**：截图眯眼后，第一眼看到的是当前任务，而不是 tabs / rail / 红色卡片。
2. **边框预算**：任一主界面结构线 ≤ 2 层；Goal 详情内层不再有“卡片套卡片套卡片”。
3. **半径一致性**：新增 CSS 不出现裸 px 半径；`r-md != r-lg`；同类组件半径一致。
4. **动效预算**：高频交互 ≤ 220ms；exit ≤ enter；dense list 无 overshoot；reduced-motion 全绿。
5. **连续性**：至少 3 条主路径有 shared element / 方向性过渡（tab→会话、Goal→详情、文件→预览）。
6. **性能**：1440/1728 宽度下 60fps；长会话滚动无 layout thrash；无未取消的 timer。
7. **可访问性**：focus ring、对比度、reduced motion 均保持现有测试通过。

---

## 10. 风险与不做

- 不做全屏 glassmorphism：高密度文本 + blur 会降低可读性，也容易显得“AI 味”。
- 不做紫蓝渐变 / 泛光 / 发光边框：与当前暖中性 palette 冲突，且是廉价感的高发区。
- 不给所有卡片加阴影/悬浮：结构应该靠空间，不靠阴影。
- 不在高频交互上加动画：Apple HIG 明确建议避免。
- 不对表格/密集列表用 spring overshoot：会显得轻浮。
- 不一次性重写 8,733 行 CSS：按 P0 → P1 → P2 增量做，每步有截图与测试。
- 不绕过现有 `motion-tokens.test.ts` / `visual-language-css.test.ts`：它们是在保护我们不再回到“随机特效”；改动要同步更新契约。

---

## 11. 参考来源

### 一手产品 / 官方

1. Hermes Desktop 官方文档 — <https://hermes-agent.nousresearch.com/docs/user-guide/desktop>
2. Hermes Desktop 产品页 — <https://hermes-agent.nousresearch.com/desktop>
3. Hermes Desktop Microsoft Store 截图 — <https://apps.microsoft.com/detail/9PMXK8CZC7KR>
4. OpenCode Desktop — <https://opencode.ai/desktop>
5. OpenCode Desktop OG 图 — <https://opencode.ai/files/site/og/desktop-f98d91d47d.png>
6. OpenCode 产品页源码（View Transition 时长/曲线）— <https://opencode.ai/desktop>
7. Linear, *A calmer interface for a product in motion*（2026-03-12）— <https://linear.app/now/behind-the-latest-design-refresh>
8. Vercel Geist, *Materials* — <https://vercel.com/geist/materials>
9. IBM Carbon, *Motion* — <https://carbondesignsystem.com/building-blocks/foundations/motion>
10. Material Design 3, *Motion physics / Spring tokens* — <https://m3.material.io/styles/motion/overview/specs>
11. Apple HIG, *Motion* — <https://developer.apple.com/design/human-interface-guidelines/motion>
12. Emil Kowalski, *animations.dev* — <https://animations.dev/>

### 本仓库

13. `packages/desktop/src/renderer/mafw/mafw.css`
14. `packages/desktop/src/renderer/mafw/motion-tokens.test.ts`
15. `packages/desktop/src/renderer/mafw/visual-language-css.test.ts`
16. `packages/session-ui/src/v2/components/session-progress-indicator-v2.css`
17. `packages/desktop/AGENTS.md`
