# Workbench 合并设计（右 dock 文件/编辑器/浏览器/终端 → 单一工作台面）

日期：2026-10-26 · 状态：**定稿（四屏逐题拍板：比例频谱 → 拖动档位 → 内部布局 → 轨形态/截屏范围）**
调研依据：`docs/research/2026-10-26-right-dock-workbench-consistency-survey.md`（割裂源清单）、`docs/research/2026-10-22-chat-workbench-proportions.md` §六（业界配比实测）
过程：brainstorming 会话 + 视觉伴侣三屏（比例频谱 → 拖动档位交互 demo → 内部布局），用户逐屏拍板。

## 意图与为什么

右 dock 的 files/editor/browser/terminal 四个 tab 各自生长出四种面板骨架（五种头部范式、四种空态、三种错误出口、三套图标语言），用户观感「割裂」。同时 11 个 pill 折两行超出业界容器舒适区（VS Code 明文 3-5）。与其逐个修 tab，不如把「工作台四件套」合并成一个有一致骨架的宽面板——割裂感与比例问题一次解决。

## 已确认决策（用户拍板，视觉伴侣三屏逐题选择）

1. **合并**：files / editor / browser / terminal 从右 dock 四个平级 tab 合并为**单一工作台面**（占据原右 dock 区域，成为常驻列）。
2. **内部布局 = IDE 骨架（A 案）**：文件树固定左侧；主区 tab 在「编辑器 / 浏览器」间切换；终端固定底部、可收起。
3. **留 C 案口子**：浏览器后续可从主区 tab「弹出」为编辑器右边的并排栏（对标 Codex #33301 tiled 诉求）——**后续增量**，首期不做，但骨架不得堵死。
4. **默认配比 40 : 60**（对话 : 工作台；从 38.2% 黄金比取整，站工作台派，对标 opencode 600 固定列）。
5. **拖动三档吸附**：档位 **30 / 40 / 50**（沉浸编码 / 默认 / 对等协作，每档有业界对标）；拖动连续跟手、松手吸附最近档（±5% 带）、**双击分隔条回默认档**；选择持久化（localStorage）；对话列 cap **520 → 760**（取 Codex 内容限宽 768 经验）。
6. **会话数据面板收图标轨**：tasks / trajectory / usage / notes / changes / subagents / background 七个会话面板收为工作台右侧细图标轨（badge 保留），点击展开。
7. **面板骨架统一**（治割裂的根，与合并同批交付）：
   - 共享 `DockPanelHeader`（标题 + 右对齐动作位，统一 padding / border-bottom）
   - 共享 `DockEmpty` / `DockBanner`（泛化 TerminalDock 的 banner 卡片——四件套中最好的空/错态）
   - 错误统一为**常驻内联 + 恢复动作**（废弃 toast-only 模式）
   - 工作台内图标统一为一套带 tooltip 的图标（**禁 emoji**，VS Code 明文）
   - 浏览器空态主题化（去掉硬编码 `background:#fff`）
8. **结构性清理**（调研发现的毛边，同批修）：browser webview 懒挂载（首次打开才建）；自动加宽对称化（browser/terminal 与 files/editor 同待遇）；删除死代码 `.mafw-right-dock-resizer`；修 files 双重滚动。

## 约束

- SolidJS + `@mafw/ui/v2` 组件（ButtonV2/TooltipV2/LoaderV2/ToastV2 约定，禁裸元素）
- 动效走既有 token（`--dur-fast` / `--dur-surface`），不引入 spring
- 主题遵守 token 单块选择器列表结构（2026-10-12 收敛），禁字面色值
- **行为不得回退**：per-turn diff store（`session-turn-diffs.ts`）、terminal bridge（目录归属/持久 PTY/两步结束）、browser session 加固（权限全拒/window.open 拦截）全部原样保留
- 契约测试先行（TDD）：比例/档位/clamp 是纯函数，先测后码（对齐 `workbench-defaults.test.ts` 既有模式）

## 非目标 / 反目标

- **非目标**：T1 共享终端（仍 HOLD，等 serve 模式 wire 实证）；Claude 式自由 pane 拖拽/弹出窗口系统（v6 单 pane 是刻意取舍，本设计不翻案）；会话轨「钉住」常驻列（留口子不做）；G3 steer（独立立项）
- **反目标**：假共享终端（agent 命令混入用户终端）；任何面板骨架的自由发挥（新面板必须走共享骨架）；emoji 图标回潮

## 已定稿项（原待定项清零，2026-10-26 第四屏拍板 + 主持者裁量）

- **会话轨展开形态 = 浮层面板**：点击图标 → 面板浮于工作台上方（JetBrains 头部浮层 / Linear 快速预览式）；Escape / 点击外部关闭；「钉住变常驻列」为后续口子（同浏览器并排的处理），首期不做。
- **G1 截屏范围 = 全屏框选**（Kimi 对标）：composer 📷 按钮 → 屏幕变暗 → 拖框选任意区域（**app 外内容可截**）→ 框内加评注 → 图片+评注进 composer 待发。工程：main 进程 `desktopCapturer` + 全屏选区遮罩窗。
- **G2 交互 = Kimi 模式**：浏览器面板「点选」模式 → 悬停高亮元素 → 点击捕获（元素信息 + 区域截图）→ 附评注 → 进 composer 待发队列。与 G1 共用「批注→待发」管线，图片走既有媒体管道。
- **图标 = 现有 `@mafw/ui/icon`**（lucide 基座，v1 `Icon` / v2 `IconV2` 均已在用）：换装范围 = 工作台 + 会话轨，零新依赖。
- **工作台折叠语义**：沿用 topstrip 右端开关；关闭 → 对话列满宽（现 RightDock 语义平移）。
- **与既有 UI 约定的关系**（AGENTS §5.10）：`DockPanelHeader` / `DockEmpty` / `DockBanner` 为 **desktop renderer 本地组件**（建在 `@mafw/ui/v2` 原语之上），不进 ui 包——不为一个 dock 的需求扩公共组件面。
- **留给 plan 的裁量**：键位默认值；`mafw-right-dock-width` / `mafw-chat-width` 等旧 localStorage 键的一次性迁移或废弃。

## 程序结构（四阶段，一 spec 一 plan 分任务交付）

| 阶段 | 内容 | 依赖 |
|---|---|---|
| ① 面板骨架统一 | `DockPanelHeader` / `DockEmpty` / `DockBanner` + lucide 换装 + 内联错误规范 + browser 主题化空态 + webview 懒挂载 + 加宽对称化 + 死 CSS 清理 | 无（纯地基，无布局变动） |
| ② 工作台合并 | 40:60 默认 + 三档吸附拖动（30/40/50，双击回默认）+ IDE 骨架（树左 / 主区 tab / 底部终端可收起）+ 会话图标轨（浮层）+ 旧宽度键迁移 | ① 的新骨架 |
| ③ G1 截屏批注 | 全屏框选遮罩窗 + 批注 + 「批注→待发」管线 | ② 的 composer |
| ④ G2 元素点选 | 浏览器点选模式 + 元素捕获 + 评注 + 待发 | ② 的浏览器面（骨架已在 ① 换好） |

**范围裁定**：G3（steer 进行中注入）**独立立项**——在 gateway/事件词汇表层（词汇表→gateway→runtime→desktop/TUI 四面），与本程序零代码面重叠。

## Builder check 裁定（2026-10-26，独立审阅后收口）

- **档位精确语义**：拖动域 = 档位全域 [25%, 55%]（占**可用宽**：window.innerWidth − 图标轨 − 推挤左栏，同 `defaultChatWidth` 现式），全程吸附、带外无自由区；**持久化 = 档位枚举**（30/40/50，非自由 px）；px 墙（320 下限 / 760 上限）优先于比例——1920 窗下 50 档落 760px（频谱屏已示 `760*`）。`ResizeHandle` 无 release/dblclick 钩子：desktop 侧包装（默认）或 fork 内最小扩展，留 plan。
- **窄视口（<1200px）**：沿用现 dock overlay 机制平移（工作台=浮层盖对话），骨架紧凑化（树自动收起）细节留 plan。
- **图标缺口**（icon map 无 globe/browser 等）：直接**补进 `@mafw/ui` icon map 条目**——是内容补齐，不违反「dock 组件不进 ui 包」裁定（那条针对组件 API 面）。
- **「批注→待发」管线形态**：新增 pending 项类型 **capture**（图+评注成对，composer 上方与 `PendingAnnotations` 并列渲染，`use-send-message` 统一打包）；图走既有媒体管道成指针，评注作引用文本块——③④ 共用，一次建成。
- **多显示器**：全屏框选遮罩覆盖**全部显示器**（每屏一窗，Snipaste/ShareX 惯例，DPI 各屏坐标）；Linux Wayland 抓取失败 → toast 提示改用系统截图工具 + 粘贴（fail-open，对齐 terminal 外部出口先例）。
- **G2 元素信息字段**：标签名 + 截短 CSS 选择器路径 + 截短 outerHTML + 可见文本（cap）+ bounding rect + 关键属性（href/value/src/title/placeholder/aria-label）；载荷封顶值留 plan。
- **G1 批注形态**：见「待用户终裁」。

## 待用户终裁（builder check 唯一遗留）

**G1 首刀的「标注」做到什么程度**：
- **轻（Kimi 实际形态）**：框选即标注（裁剪区域本身指位）+ 侧车文字评注——Kimi 官方文案「框选屏幕区域，写句评论发给 Agent」即此；工程量小，复用附件管道近乎零新增。
- **重（Claude 涂画形态）**：框选后进入画布标注编辑器（矩形/箭头/文字工具）——③ 变整个程序最大单件；可作为后续增量（轻版先上，画布后补）。

## 参考

- 视觉伴侣四屏 mockup：`.superpowers/brainstorm/1712-1792996402/content/`（workbench-ratio / -detents / -internal / -final-two）
- 缺口调研：`docs/research/2026-10-26-six-way-frontend-gap-resurvey.md`（G1/G2 为 P0 的依据）
- 业界配比：opencode 600 固定 / Zed 640 / Codex 内容限宽 768 / Kimi·Claude 50:50（详见 proportions 调研 §六）
- 档位交互先例：iPad Split View / Windows Snap 吸附档位
