# 右键菜单的行业逻辑：对象 × 动词组（2026-10-28）

> 这份文档回答一个问题：**业界到底有没有一套「右键该有什么」的标准逻辑？**
> 结论：有。它不是「每个区域列一堆功能」，而是 **对象类型决定动词集合、动词按固定顺序分组**。本文先给语法，再给五家（Claude / Codex / Kimi / dsh / opencode）与平台惯例的证据，最后把我们 14 个区域逐一映射成可落地的菜单表。
> 姊妹文档：`2026-10-28-desktop-context-menu-research.md`（我们的现状盘点与缺陷清单）。
> 证据等级：**源码**（可验证实现）/ **快照**（产品自身的菜单渲染快照测试）/ **文档**（官方文档逐字）/ **公开记录**（issue / changelog）/ **平台惯例**（OS 与通用桌面软件收敛做法，标注为推断）。

## 0. 一句话

右键菜单不是「第二套工具栏」，而是**光标下那个对象的生命周期动词表**：打开它、组织它、定位它、取出它、销毁它。业界五家在这些动词的**取舍**上各有不同，但在**分组与顺序**上高度一致。

这也解释了为什么「Electron 自带的」会显得空：`electron-context-menu` 只知道「剪贴板 + 网页元素」这一层（copy/paste/检查元素/图片另存为），它**不知道你的对象是什么**——不知道这是一条会话、一个文件、一个 tab、一条消息，所以给不出对象动词。

## 1. 语法：四段式 + 六条硬约束

### 1.1 四段式

| 段 | 名称 | 动词 | 例子 |
|---|---|---|---|
| A | 主动词 | 这个对象最自然的下一个动作 | Open / Preview / Attach as context / Reply / Run |
| B | 组织 | 改变对象的归属、状态、身份 | Rename / Pin / Archive / Fork / Duplicate / Move to group |
| C | 定位与打开方式 | 把对象交给外部世界 | Reveal in Finder｜Explorer / Open in ▸（VS Code/Cursor/Zed）/ Open in terminal |
| D | 取出 | 把对象变成可带走的文本 | Copy / Copy path ▸ / Copy session ID / Export… |
| E | 破坏 | 不可逆或需确认 | Delete… / Close / Terminate |

**顺序证据（不是我们编的）**

- Claude 文件路径菜单：`Attach as context`（A）→ `Open in ▸`（C）→ `Show in Finder/Explorer`（C）→ `Copy ▸`（D）。**没有 E**——文件菜单不提供删除。
- dsh 会话行：`Pin / Rename / Fork / Archive`（B）→ `Copy Session ID`（D）。**没有 E**——归档即软删除。
- opencode 会话行：`Rename`（B）→ `Export…`（D）→ `—` → `Delete…`（E）。**E 前一定有分隔线**。
- opencode 项目行：`New session`（A）→ `Import / Edit`（B）→ `Reveal`（C）→ `Clear notifications`（B）→ `—` → `Close`（E）。
- dsh 合并菜单：三种策略（A 的变体枚举）→ `—` → `确认合并`（执行）。

### 1.2 六条硬约束

1. **一表两入口**：右键与行内 `⋯` 必须渲染同一份 items。dsh 把两者直接实现成同一个有序 slot list；opencode 的会话行与标题 `⋯` 共用同一组 `Menu.Item`。反例是我们：LeftDock 的 `⋯` 靠伪造 `contextmenu` 事件，SessionStrip 的 `⋯` 是另一套「全部会话」列表。
2. **输入区与选区不夺原生**：`input/textarea/contenteditable` 与消息文本选区保持系统菜单（剪切/复制/粘贴/拼写/Look Up）。opencode 在重命名态显式 `if (editor()) return`，注释写明「保留原生菜单以便粘贴与拼写检查」；Codex 直到 2026-10 才补上「右键复制 transcript 与 composer 选区」（changelog #46895），此前一直用系统菜单。
3. **分组 ≤ 3、单项 ≤ 7、深度 ≤ 2**：超过 2 个变体就收子菜单——Claude 的 `Copy ▸（绝对路径/相对路径/文件名）`、`Open in ▸（VS Code/Cursor/Zed）` 是标准做法。
4. **省略号 = 会弹确认/对话框**：`Export…`、`Delete…`、`Rename`（行内改名，不弹窗，所以不加）。dsh/opencode/Claude 都遵守。
5. **破坏性最后、分隔、可辨识**：颜色/图标必须区分，且要二次确认（`Archive anyway` / `Delete…`）。我们的 `danger` 字段目前只写 DOM 属性、没有 CSS——等于没做。
6. **菜单是快捷键的发现面**：能配快捷键的动作在右侧显示 accelerator。dsh 原生菜单快照、opencode 的桌面菜单、Claude 的 `Cmd+Shift+D` 都这么做。菜单不是「藏起来的唯一入口」，可见按钮与右键应互为补充。

### 1.3 「应有」的判定法：先问对象类型

| 对象类型 | 必然有的动词 | 通常没有的动词 |
|---|---|---|
| 列表项（会话/项目/Goal/记忆） | Open、Rename、Copy ID、Delete/Archive | Open with、Reveal |
| 文件对象（路径/树行/tab） | Attach、Open、Open with ▸、Reveal、Copy path ▸ | Pin、Fork |
| 容器对象（页签/面板） | Close、Close others、Close to the right、Copy path | Rename（页签改名是双击的活） |
| 内容对象（消息/代码块） | Copy、Copy as Markdown、Quote、Edit/Regenerate | Reveal、Open with |
| 运行时对象（终端/后台/子代理） | Focus、Copy、Stop、Open external | Rename、Attach |
| 页面对象（浏览器） | Back/Forward/Reload、Copy link、Open external、Pick element | Export |

## 2. 五家证据表（按区域）

### 2.1 会话列表 / 项目列表

| 产品 | 右键项 | 证据 |
|---|---|---|
| **dsh** | Pin session / Rename / Fork session / Archive session / Copy Session ID | 快照 `apps/web/tests/expected/menu-material/session-menu.expected.md` |
| **opencode** | 会话行：Rename / Export… / — / Delete…；项目行：New session / Import session / Edit project / Reveal in Finder｜Explorer / Clear notifications（无未读时 disabled）/ — / Close | 源码 `home/sessions/view.tsx:806-813`、`home/projects/view.tsx:634-665` |
| **Claude** | 会话行右键：Open in ▸（Split view / New window）；hover 菜单：Archive | 文档 `desktop`「Work in parallel with sessions」「Archive a session」 |
| **Kimi** | 会话标题「更多」菜单（会话操作，含 `/reload`）；置顶/批量管理在列表层 | 文档「界面导览」+ 发布说明 |
| **Codex** | 无公开证据（列表操作走 hover 按钮与原生菜单栏） | 公开记录 |

**收敛**：`Open` → `Rename` → `组织（Pin/Archive/Fork）` → `Copy ID` → `—` → `Delete`。项目行多一段 `New session` 在最前、`Reveal` 在中间。

### 2.2 页签（tab）

| 产品 | 右键项 | 证据 |
|---|---|---|
| **dsh** | Close | 快照 `shortcuts-panels/tab-menu.expected.md` |
| **opencode** | 无右键；另有「最近关闭的页签」下拉（带搜索） | 源码 `shell/titlebar/tab-strip.tsx`、`recently-closed-tabs-menu.tsx` |
| **Chrome（平台惯例）** | New Tab to the Right / Reload / Duplicate / Pin / Mute / — / Close / Close Other Tabs / Close Tabs to the Right / Add Tab to Group / Move to New Window | 平台惯例 |
| **VS Code（平台惯例）** | Close / Close Others / Close to the Right / Close Saved / Close All / — / Copy Path / Copy Relative Path / Split / Move into New Window / Reveal in Explorer / Pin | 平台惯例 |

**收敛**：页签右键 = **关闭家族 + 复制路径 + 定位**；「关闭其他/关闭右侧」是桌面端的肌肉记忆，缺了会显得不像桌面应用。

### 2.3 聊天消息 / 代码块

| 产品 | 右键项 | 证据 |
|---|---|---|
| **opencode** | 无消息菜单；已知缺口 issue #12208（右键 prompt 弹的是内嵌浏览器菜单，用户请求「编辑并重发」） | 公开记录 |
| **Claude** | 无消息菜单；选区浮层做引用，文件路径另有菜单 | 文档 |
| **Codex** | 仅系统原生菜单 + 新增「右键复制 transcript/composer 选区」 | changelog #46895、issue #31281 |
| **Slack（平台惯例）** | Reply / Forward / Copy text / Copy link / Save for later / Mark unread / Remind me / — / Edit / Delete | 平台惯例 |
| **ChatGPT（平台惯例）** | Copy / Edit / Regenerate / Read aloud / Share / Branch in new chat | 平台惯例 |

**收敛**：消息右键是**内容对象**菜单：`Copy` → `Copy as Markdown` → `Quote` → `Edit & resend`（仅 user）→ `Branch from here`（可选）→ `Read aloud`（可选）。五家 AI 桌面里做全的很少，但这是「内容对象」的标准动词，属于可差异化项。

### 2.4 文件路径 / 文件树

| 产品 | 右键项 | 证据 |
|---|---|---|
| **Claude** | Attach as context / Open in ▸（VS Code / Cursor / Zed）/ Show in Finder｜Explorer / Copy ▸（Absolute path / Relative path / Filename）；聊天里的文件夹另有 Open in terminal | 文档「Open files in other apps」「Run commands in the terminal」 |
| **Kimi** | 复制路径 / 在文件夹中显示（会话中的文件名）；顶栏「外部应用」另有 VS Code/Cursor/Zed/Xcode/系统终端/Finder/复制当前路径 | changelog 1.0.3 + 文档「界面导览」 |
| **VS Code（平台惯例）** | Open to the Side / Open With… / Cut / Copy / Paste / Copy Path / Copy Relative Path / Reveal in Explorer / Find in Folder / Rename / Delete | 平台惯例 |
| **opencode / dsh / Codex** | 无公开的路径右键证据 | — |

**收敛**：文件对象四件套 **Attach → Open in ▸ → Reveal → Copy path ▸**，几乎逐字一致。这是目前五家里唯一「两家给出完整同一套」的区域，也是我们最该抄的一张。

### 2.5 终端 / 浏览器 / 面板

| 产品 | 区域 | 右键项 | 证据 |
|---|---|---|---|
| **Claude** | 终端 | 聊天中的文件夹右键 → Open in terminal；终端面板 `+` 新建标签 | 文档 |
| **dsh** | 终端 | 新建 shell：bash / sh | 快照 `sidebar-terminal/shell-menu.expected.md` |
| **Kimi** | 右侧面板 | 标签切换/关闭/`+` 新建（改动/浏览器/终端/侧边聊天） | 文档 |
| **Chrome（平台惯例）** | 浏览器 | Back / Forward / Reload / Copy link / Open in new tab / Inspect | 平台惯例 |
| **Windows Terminal（平台惯例）** | 终端 | Copy / Paste / Select All / Find / Clear / Split / Close pane | 平台惯例 |

**收敛**：终端菜单是 `Copy / Paste / Select All / Find / Clear / — / Close`；浏览器是 `Back / Forward / Reload / — / Copy link / Open external / Pick element`。

## 3. 我们 14 个区域的映射与 v1 菜单表

> 说明：「现状」= 代码实读；「后端」= 是否需要新增 gateway/IPC 才可做。
> 我们的桌面是渲染层自绘（Kobalte），文本输入区仍用 Electron 原生，这是正确分工。

### 3.1 会话对象（左 dock 行 + 顶部页签共用）

现状：LeftDock `Open/Rename/Delete/Copy session ID`；SessionStrip `Close/导出 Markdown…/Copy session ID`——同一对象两张表。

| 序 | 项 | 段 | 状态 | 后端 |
|---|---|---|---|---|
| 1 | 打开 | A | 已有 | 无 |
| 2 | 重命名 | B | 已有（双击） | 无 |
| 3 | 分叉会话 | B | 新 | `sessions.fork` 已有 |
| 4 | 导出 Markdown… | D | 已有 | 无 |
| 5 | 复制会话 ID | D | 已有 | 无 |
| — | — | — | — | — |
| 6 | 关闭页签（仅页签） | E | 已有 | 无 |
| 7 | 删除会话… | E | 已有（需确认） | 无 |

会话行与页签的差异只在「关闭页签」一项，其余共用一份 items。`Pin/Archive` 暂缺后端（G7 缺口），不放进 v1。

### 3.2 项目对象（左 dock 项目 switcher）

现状：只有左键下拉，无右键。

| 序 | 项 | 段 | 后端 |
|---|---|---|---|
| 1 | 新建会话 | A | 无 |
| 2 | 在文件管理器中显示 | C | `revealPath` 已有 |
| 3 | 复制项目路径 | D | 无 |
| — | — | — | — |
| 4 | 关闭项目 | E | 需确认（注册表移除） |

`OpenCode` 的 `Import session/Edit project/Hide project` 依赖项目元数据，我们暂不承诺。

### 3.3 聊天消息

现状：无菜单，落 Electron 原生。

| 序 | 项 | 段 | 后端 |
|---|---|---|---|
| 1 | 复制文本 | D | 无 |
| 2 | 复制为 Markdown | D | 无 |
| 3 | 引用到输入框 | A | `formatQuote` 已有 |
| 4 | 编辑并重发（仅 user） | B | 需 revert + 回填 composer |
| 5 | 从此处分叉（仅 user） | B | `sessions.fork` 已有 |
| 6 | 朗读（仅 assistant） | A | VoiceSession 已有（可选） |
| — | — | — | — |
| 7 | 删除这条消息… | E | 暂缓（先不做，避免与 revert 语义打架） |

**关键约束**：消息文本的**选区右键**仍然走原生；自绘菜单挂在消息容器上（非选区时），或只对「消息级按钮/⋯」开放。否则会抢走复制/查词。

### 3.4 文件路径（聊天里出现的文件链接）

现状：无。**这是 ROI 最高的一张。**

| 序 | 项 | 段 | 后端 |
|---|---|---|---|
| 1 | 附加到输入框 | A | `composer-insert` 已有 |
| 2 | 在编辑器中打开 | A | `requestOpenEditor` 已有 |
| 3 | 用…打开 ▸（系统默认 / VS Code / Cursor / Zed） | C | `openPath(path, app)` 已有；应用探测待做 |
| 4 | 在文件管理器中显示 | C | `revealPath` 已有 |
| 5 | 复制 ▸（绝对路径 / 相对路径 / 文件名） | D | 无 |
| — | — | — | — |

### 3.5 文件树行

现状：单击打开；无菜单。

| 序 | 项 | 段 | 后端 |
|---|---|---|---|
| 1 | 打开 | A | 已有 |
| 2 | 预览（图片/SVG/MD/JSON/CSV/Office/PDF） | A | 已有 fileOpenPlan |
| 3 | 附加到输入框 | A | 已有 |
| 4 | 在文件夹中显示 | C | `revealPath` |
| 5 | 复制 ▸（相对路径 / 绝对路径 / 文件名） | D | 无 |
| — | — | — | — |
| 6 | 重命名 / 删除到回收站 | E | **不做**：无 fs 写 API |

### 3.6 编辑器 / 预览页签

现状：只有行尾 `✕`。

| 序 | 项 | 段 | 后端 |
|---|---|---|---|
| 1 | 关闭 | E | 已有 |
| 2 | 关闭其他 | E | 无 |
| 3 | 关闭右侧 | E | 无 |
| 4 | 复制路径 | D | 无 |
| 5 | 在文件夹中显示 | C | `revealPath` |

### 3.7 终端

现状：无。

| 序 | 项 | 段 | 后端 |
|---|---|---|---|
| 1 | 复制（有选区时） | D | xterm selection |
| 2 | 粘贴 | A | PTY 输入 |
| 3 | 全选 | D | xterm |
| 4 | 清屏 | A | ANSI |
| 5 | 在外部终端打开 | C | 已有 external |
| — | — | — | — |
| 6 | 关闭终端 | E | 已有 |

### 3.8 浏览器

现状：无（webview 平台默认）。

| 序 | 项 | 段 | 后端 |
|---|---|---|---|
| 1 | 后退 / 前进 / 刷新 | A | 已有 |
| 2 | 复制链接 | D | `getURL()` |
| 3 | 在系统浏览器打开 | C | 已有 |
| 4 | 点选页面元素 | A | G2 已有 |
| — | — | — | — |

注意：webview 内的右键默认是 Chromium 菜单，需要 `webview` 的 `context-menu` 事件接管，否则会出现「双层菜单」。

### 3.9 执行 / 审阅面板行（任务 / 子代理 / 后台 / 轨迹）

| 序 | 项 | 段 | 后端 |
|---|---|---|---|
| 1 | 打开会话 | A | 已有 |
| 2 | 复制 ID | D | 无 |
| 3 | 终止（后台/子代理） | E | 已有 |

### 3.10 卡片类（Goal / Memory / Notes / Approvals / Triage / Automations）

现状已有菜单，按四段式重排并补缺：

- **Goal**：查看详情（A）→ 在时间线打开（A）→ 复制 Goal ID（D）→ — → 暂停/恢复（B）→ 取消…（E）。现有 `Pause/Resume` 与 `Cancel` 顺序正确，缺「复制 ID」。
- **Goal 泳道格**：打开会话（A）→ 重跑此节点…（A，confirm=true）→ 复制产物路径（D）。
- **Memory**：复制摘要 / 复制全文（D）→ 固定/取消固定（B，`pin` API 已有）→ 设为便签/续期/下架（B，sticky API 已有）→ — → 删除…（E，已有）。
- **Notes**：续期 / 下架 / 删除（现有按钮化）。
- **Approvals**：批准（A）/ 拒绝（A，danger 语义但非删除）→ 复制问题（D）→ — → 记此前缀 / 记此工具（B，rules API 已有）。
- **Triage**：确认（A）/ 建议确认（A）/ 建议拒绝（A）→ 查看 Goal（C）→ — → 忽略…（E，danger）。
- **Automations**：立即运行（A）→ 启用/停用（B）→ 复制规则 ID（D）→ — → 删除…（E）；删掉重复的 Disable。

## 4. 为什么「Electron 自带」不够（诊断）

`electron-context-menu` 在主进程统一注入，能力边界是：

- 能给：剪切/复制/粘贴/全选、复制图片、图片另存为、检查元素、拼写与查词（平台相关）。
- 给不了：**对象身份**。它不知道光标下是会话、文件、页签还是消息，因此给不出 Open/Rename/Fork/Reveal/Copy path 这些动词。
- 也给不了：i18n、危险项样式、快捷键提示、禁用原因、与 `⋯` 共用一张表。

正确架构是**双轨**：

```
输入框 / 选区 / 可编辑区  → Electron 原生菜单（不接管）
对象容器（行/卡/tab/tree/message 容器） → 渲染层 Kobalte 菜单（我们的 spec）
webview → 接管 context-menu 事件，按页面对象给菜单
```

## 5. 落地顺序（建议）

| 阶段 | 内容 | 理由 |
|---|---|---|
| **P0 框架** | `context-menu/types.ts` + `buildMenu(surface, target)` 纯函数 + 统一渲染器（icon/shortcut/danger/submenu/group/checkbox）+ danger CSS + i18n key | 不做框架就会得到 14 张风格各异的表 |
| **P1 五张高 ROI** | 文件路径、文件树行、编辑器页签、聊天消息、终端 | 全是「现在右键等于没有」的区域；文件路径两家给出逐字一致的范本 |
| **P2 卡片收口** | 现有 5 张迁移 + Goal/Memory/Approvals/Triage/Automations 补缺 | 修 defect 与一致性 |
| **P3 面板与浏览器** | 执行/审阅面板、浏览器 webview 接管、Goal 泳道格 | 依赖 P1 的 webview/IPC 细节 |
| **P4 扩展性** | surface 注册表 + 插件 slot（对齐 dsh） | 未来 |

## 6. 来源

- **opencode**（源码，`dev` @ 2026-10-28）：`packages/app/src/home/projects/view.tsx`、`home/sessions/view.tsx`、`session/timeline/message-timeline.tsx`、`shell/titlebar/tab-strip.tsx`、`shell/titlebar/recently-closed-tabs-menu.tsx`、`servers/registry/row-menu.tsx`；issue #12208。
- **dsh**（快照/源码，`master`）：`apps/web/tests/expected/menu-material/session-menu.expected.md`、`shortcuts-panels/tab-menu.expected.md`、`sidebar-terminal/shell-menu.expected.md`、`forge-panel/merge-menu.expected.md`；`.agents/notes/archived/architecture/2026-09-17-session-row-menu-actions-slot.md`。
- **Claude Code Desktop**（文档）：<https://code.claude.com/docs/en/desktop> ——「Open files in other apps」「Run commands in the terminal」「Work in parallel with sessions」「Switch view modes」「Archive a session」「Arrange your workspace」。
- **Kimi Code Desktop**（文档/changelog）：<https://www.kimi.com/code/docs/kimi-code-desktop/changelog.html>（1.0.3 文件名右键）、<https://www.kimi.com/code/docs/kimi-code-desktop/interface-and-sessions.html>（顶部栏/右侧面板/外部应用）。
- **Codex**（公开记录）：openai/codex issue #31281（原生 Look Up）；ChatGPT/Codex changelog #46895（右键复制 transcript/composer 选区）。
- **平台惯例**（推断，非单一文档）：Chrome 页签菜单、VS Code Explorer/tab 菜单、Windows 11 Explorer、macOS Finder、Slack 消息菜单、ChatGPT 消息操作、Windows Terminal。
