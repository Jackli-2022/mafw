# 桌面 AI 编码产品美学对标调研（2026-09-28）

> 目的：为 MAFW Desktop 美学/逻辑重构提供对标。调研对象：Kimi Code Desktop、OpenAI Codex、OpenCode Desktop、Claude（Desktop/Code）、Zed（用户所写 "zcode"，按 Zed 调研）、DeepSeek Harness Desktop。
> 方法：三路并行子代理网络调研（官网/文档/官方截图取色）；与 2026-09-21 desktop-aesthetic-v5 的上一轮调研（ChatGPT/Linear/Raycast/Cursor/Warp 等）互补。
> 注意：v5 spec 已于 9-21 落地暖纸感 token v5/双字体契约/bento，本调研在其基础上找**新增**信号。

## 各产品速览

### Kimi Code Desktop（code.kimi.com）
- **布局**：四区——workspace 树状 session 侧栏 / 中央对话+Composer / 右侧 tab 化辅助面板（Changes/Thinking/子代理/Side chat/内置浏览器）/ 底部可开终端
- **色彩**：浅色为主，近纯白 `#FEFEFF` + 冷灰蓝辅助；科技蓝 accent，克制
- **状态语言**：thinking/上下文压缩收进右侧 tab；审批卡片 + 权限三档显示在 Composer 左下；后台任务聚合为 Composer 上方 **work bar**
- **签名**：输入框边缘探出的蓝色吉祥物；workspace 树把 IDE 项目心智搬进聊天
- **缺陷**：近纯白大留白长时间刺眼；信息密度偏低

### OpenAI Codex（openai.com/codex）
- **布局**：两种形态——单栏居中卡片流（任务执行）/ sidebar 任务收件箱（多 agent command center）；起始页极简只剩 "Let's build"
- **色彩**：浅色 + 蓝紫渐变（`#BCC6F7` 系）+ 磨砂白玻璃浮层；发送按钮纯黑
- **状态语言**：**无进度条**——进度=流式文本；"Thought for 8s" / "Explored 3 files" 轻量元数据行；任务完成后底部浮起 **Review 操作条**（Changed 8 files +23 −16 → Review），把审查收敛为一个动作
- **签名**：玻璃拟态+蓝紫渐变（偏营销）；底部浮动 Review 条
- **缺陷**：App 与 CLI 两套视觉语言一致性弱；单栏流审查大改依赖单一入口

### OpenCode Desktop（opencode.ai）
- **布局**：两栏——左会话流 + 右 **Review 面板**（Session changes，Unified/Split diff）一等公民；顶部细 header 带状态点；输入框内嵌 Build/Plan + 模型 + 变体三选择器
- **色彩**：默认深色**暖黑**（`#181515` 主底），暖灰单色体系**几乎无 accent**；三级背景 token（background/backgroundPanel/backgroundElement）+ 三级边框（border/borderActive/borderSubtle）+ 独立 `diff*`/`markdown*`/`syntax*` 语义 token 组
- **签名**：像素终端美学（pixel logo、ASCII 边框、等宽字贯穿）；Review 面板独立右栏
- **缺陷**：无品牌 accent 视觉记忆点弱；暖黑 muted 对比偏低；动效语言近乎没有

### Claude（Desktop + Code）
- **布局**：左侧导航（Home/Code/New session… + Pinned/Scheduled/Recents 会话列表）；底部控制条三选择器（模式/模型/effort）；diff/Artifact 侧拉
- **色彩**：**浅色暖奶油底 `~#FAF9F5` 是默认签名**（MAFW v5 亮色正是 `#FAF9F5`——撞车，见下文风险）；深色模式为暖深灰 `#171717`；珊瑚橙 accent（深色下实测偏灰棕）；成功绿 `~#77C894`
- **字体**：**衬线字做品牌标题**；无衬线 UI + 等宽代码三层分工
- **状态语言**：`✳ Pondering…` 珊瑚星号 spinner + **拟人化动词**（最有名）；工具调用 = 绿点+加粗动词+等宽参数，完成折叠为一行摘要
- **签名**：奶油底+衬线的"书房感"；⏺/✳ 跨端符号系统；拟人状态微文案
- **缺陷**：浅色长时间盯代码易疲劳；左栏三段列表密度低

### Zed（zed.dev）
- **布局**：经典 IDE 坞站——Agent Panel 默认 dock 右侧（640px），Threads Sidebar（按项目分组）；Command Palette 是入口；一切可隐藏
- **色彩**：默认 One Dark；品牌蓝 `#1348DC` 仅用于营销，产品内 accent 由主题定
- **字体**：内置 Zed Sans（IBM Plex 衍生）+ Zed Mono（Lilex，默认连字）；**行高 1.618 黄金比例**；人机消息用字区分（回复=UI 字体 15px，用户消息/代码=buffer 12px）
- **状态语言**："**Out-of-your-face AI**"——subtle 模式按需唤出；Restore Checkpoint 按钮；Review Changes 多 buffer diff 逐 hunk accept/reject；context 将满出 banner
- **签名**：速度即美学（Rust+GPUI 120fps）；Multibuffer（diff review 即编辑）
- **缺陷**：功能发现性差（藏命令面板）；产品内品牌不可见

### DeepSeek Harness Desktop（deepseek.com/harness，dsh）
- **布局**：三栏——左侧导航+插件管理 / 中央会话 / **右侧 tab 式扩展坞**（文档预览/沙箱浏览器/文件树/终端）；Web/Desktop 共享同一套客户端（UI 全是 Cordis 插件）
- **色彩**：light/dark/system；`--dsw-*` 两层 token（静态 scale + 语义 alias），"feature 组件禁写字面色值"lint 级强制；中性偏蓝冷灰；focus ring 亮 `#4176E6` / 暗 `#7AAAFF`
- **字体**：系统字体栈打底 + Montserrat 仅品牌文案；内容字号用户可调 12–17px（默认 14），**次级文本固定比正文小一档**的明确阶梯规则
- **状态语言**：**Trajectory 视图**——全部模型输入输出/工具调用/子代理调度 append-only 日志，可查看/回放/分叉；工具调用嵌套 call tree；thinking 紧凑 Markdown 三级色
- **签名**：一切皆插件的 UI；**可回放性即设计**；superellipse 圆角 + 0.5px 发丝线 + 发丝线/投影互斥的三级 elevation
- **缺陷**：视觉个性弱（系统字体+中性蓝灰）；工程文档化

## 跨产品收敛的新信号（v5 调研之后的增量）

1. **元数据行取代进度/折叠条**："Thought for 8s"、"Show steps · 4m, 19s"、"Read 3 files" —— 三家共识，过程信息压缩成一行小字
2. **Review/Changes 是一等公民但形态分裂**：OpenCode/Zed 做常驻右栏工作台；Codex 做完成后浮动条；Kimi 做右侧 tab。MAFW 的 DiffReviewPanel 需明确选边
3. **权限/模式三档已产品化**（Kimi Always Ask/Ask When Needed/Never Ask；Claude Ask before editing chip；MAFW 已有三档——对齐到位）
4. **人机消息字体分层**（Zed 明确决策）：回复用 UI 字体、用户输入/代码用 mono
5. **发丝线 + 三级 elevation**（DeepSeek）：0.5px hairline，浮层走"发丝线+柔和投影"而非真边框，lint 强制禁字面色值
6. **品牌字体只做点睛**（DeepSeek Montserrat / Zed Sans / Claude serif）：系统字体栈打底 + 一款品牌字体仅用于标题/欢迎页
7. **暖色温不再是无人区**：OpenCode 暖黑、Claude 暖奶油都在用——MAFW v5 的"品牌绿×暖纸底"差异化依然成立，但亮色 `#FAF9F5` 与 Claude 奶油底**正面撞车**，辨识度要靠暗色墨纸底 + 信号绿撑
8. **AI 状态人格化是 Claude 独占**：拟人动词（Pondering…）无人跟进，是可借的差异化点（但需克制）
9. **Trajectory/可回放性**（DeepSeek）与 **Out-of-your-face**（Zed）是两个对立哲学：过程全显形 vs 过程全收起——Codex/Claude/Kimi 的"元数据行"是中间路线，也是主流收敛点
10. **Web/Desktop 一套 UI 是工程共识**（OpenCode、DeepSeek Harness 均如此）——MAFW 现状已符合

## 对 MAFW v5 之后的候选方向

- **A. 微交互精化**（低风险）：元数据行化（thinking/steps 摘要）、工具调用完成态一行摘要、streaming 元数据（耗时/token 实时）
- **B. Review 形态选边**（中风险）：DiffReviewPanel 升级为常驻右栏工作台（OpenCode/Zed 式）vs 完成后浮动条（Codex 式）
- **C. 品牌点睛**（低风险）：选一款开源品牌字体仅用于 WelcomeHome/页面标题；人机消息字体分层落地
- **D. 暖色差异化坚守**（已做）：v5 墨纸底+信号绿继续，不追 OpenCode 暖黑
- **E. Trajectory 视图强化**（高风险高收益）：MAFW 已有 trajectory dock，可对齐 DeepSeek 的 call tree + 回放语义

（本文件为调研蒸馏，非设计方案；设计决策见后续 spec。）
