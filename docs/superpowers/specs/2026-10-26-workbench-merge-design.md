# Workbench 合并设计（右 dock 文件/编辑器/浏览器/终端 → 单一工作台面）

日期：2026-10-26 · 状态：**设计已逐题确认，待增补缺口调研结果后定稿**
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

- **非目标**：T1 共享终端（仍 HOLD，等 runtime 侧）；Claude 式自由 pane 拖拽/弹出窗口系统（v6 单 pane 是刻意取舍，本设计不翻案）
- **反目标**：假共享终端（agent 命令混入用户终端）；任何面板骨架的自由发挥（新 tab 必须走共享骨架）

## 待定项（下一轮 brainstorm，缺口调研后一起定）

- 图标库选型（lucide / 自绘 / 其他）与全 app 范围（本次只工作台还是连带左轨/会话轨）
- 会话图标轨的展开形态（peek / 推挤列 / overlay）
- 工作台折叠语义（关闭后对话列 100%？toggle 按钮放哪）
- 工作台内 tab 切换与终端收起的键位
- `mafw-right-dock-width` 等 localStorage 键的迁移
- 缺口调研（六方前端 2026-10-26 增订版）可能带进来的新交互项是否并入本设计

## 参考

- 视觉伴侣三屏 mockup：`.superpowers/brainstorm/1712-1792996402/content/`（workbench-ratio / workbench-detents / workbench-internal）
- 业界配比：opencode 600 固定 / Zed 640 / Codex 内容限宽 768 / Kimi·Claude 50:50（详见 proportions 调研 §六）
- 档位交互先例：iPad Split View / Windows Snap 吸附档位
