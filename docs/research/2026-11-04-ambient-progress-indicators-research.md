# 常驻进度指示器：业界做法调研

日期：2026-11-04
问题：人在电脑前做别的事，但要一直知道「有个 Goal 在跑」「它什么时候跑完」。这个指示器业界怎么做的？
范围：桌面 OS 惯例 + 主流 IDE/同步工具 + Apple Live Activities + HCI 的 ambient display 研究。

---

## 0. 结论

业界没有单一「神奇控件」。成熟产品一致采用**三层连续体**（calm technology 的核心主张：信息应在 periphery 与 center 之间自由移动）：

| 层 | 内容 | 抢注意力 |
|---|---|---|
| L1 图标态 | 托盘/菜单栏图标本身的形状或颜色 | 几乎为零 |
| L2 一行摘要 | 悬停 tooltip / 状态栏文字 / 任务栏进度 | 低，主动瞥 |
| L3 展开面 | 点击弹出的面板 / 悬浮卡 / 长按展开 | 高，主动看 |

**完成时不做第四层，做一次性的「状态归位 + 一次提示」。**

---

## 1. 四个可对照的母版

### A. 菜单栏/托盘「图标态」（Dropbox、iCloud、Docker、Time Machine）

Dropbox 的做法最完整，值得直接抄：

| 状态 | 图标 |
|---|---|
| 已同步 | 纯图标，无附加 |
| 同步中 | 图标 + 旋转双箭头（**动画**） |
| 暂停 | 图标 + 暂停符 |
| 离线 | 灰色图标 |
| 有未读 | 红色圆 + 数字 |

要点：
- **图标本身就是状态**，不需要文字。
- 详情在「点开」之后（面板底部一行 "Your files are up to date" / "Syncing 12 files"）。
- 变化用**动画**而不是换字，余光可感知。

### B. 状态栏进度（VS Code / Visual Studio / JetBrains）

VS Code UX Guidelines 的原话：

> When needing to show discreet progress (progress happening in the background), it's recommended to show a Status Bar item with the loading icon… **If progress needs to be elevated for user attention, we recommend moving to a progress notification.**

Visual Studio 扩展指南：

> The status bar has its own progress indicator and it's the easiest place to show progress to the user. **It's visible, but doesn't demand attention from the user or block their current task.**

JetBrains：多个后台任务进 **Background Tasks manager**（一个列表），状态栏只显示栈顶/汇总——**多任务时不能互相踩**。

### C. 任务栏 overlay + 进度（Windows 原生惯例）

- `SetProgressValue`：任务栏按钮上一条填充进度（安装器、Teams、Slack 都用）。
- `SetOverlayIcon`：右下角一个小角标（GitHub Desktop 的未读、Teams 的红点）。
- 优点：**不新增任何 UI 元素**；缺点：只有「有/多少」一个维度，读不出是哪个任务；全屏/任务栏自动隐藏时不可见。

### D. iOS Live Activities（compact → expanded → alert）

Apple HIG 的三档呈现，正好对应上面的三层：

| 档 | 位置 | 何时 |
|---|---|---|
| compact | Dynamic Island 两侧 | 默认，一眼 |
| expanded | 长按 / 提醒更新时 | 想看细节 |
| alert | 亮屏 + 提示音 | **只用于不可错过的更新** |

HIG 的三条硬约束：
- 只显示与该活动相关的信息，不夹带推广；
- **不要加引导用户注意它的元素**（不主动晃）；
- **不要和 push 通知同时用于同一事件**；alert 要克制，否则失效。

结束即移除（不是留在那儿等人关）。

---

## 2. 三条跨产品一致的规则

1. **后台进度默认不抢焦点**；只有「需要提升注意力」时才升级成 notification（VS Code / VS / JetBrains 都是这个分级）。
2. **完成 ≠ 打扰**：完成是「状态归位（跑 → 完成）+ 一次提示」，不是持续闪烁。
3. **多任务不能互相踩**：JetBrains 的解法是状态栏报汇总、列表进 manager；单任务产品（Dropbox）才敢用一个图标表意。

---

## 3. 两个已知的坑

### 3.1 Windows 托盘图标默认被折叠

Windows 把托盘图标收进 `^` 溢出区是默认行为。Dropbox 官方帮助中心专门有一节教用户「把图标拖到菜单栏常驻」，说明这不是个别问题。**托盘不能当成唯一信道。**

### 3.2 Change blindness：突变看不见

peripheral display 研究（Matthews et al., UIST '04 PTK）指出：ambient 显示如果用**突变**（数字跳变、颜色瞬切），用户会看不见变化；必须用**缓慢渐变/动画**。这也解释了为什么 Dropbox 用旋转箭头而不是改文字。

---

## 4. MAFW 现状（真实代码）

| 已有 | 位置 | 说明 |
|---|---|---|
| 托盘 + 菜单 | `packages/desktop/src/main/tray.ts` | 已有 Open / Close to tray / Quit，菜单第一行是状态行 |
| 托盘状态轮询 | `packages/desktop/src/main/tray-status.ts` | 30s 轮询 `/api/approvals` + `/api/permissions`，tooltip 显示 pending 数 |
| rail 结果点 | `IconRail` + `MafwShell.podResultDot` | 应用内，窗口不在前台就看不见 |
| OS 通知 | `MafwShell.handlePodResultEvent` → `Notification` | **仅窗口隐藏时** |

缺的：`win.setProgressBar()` / `win.setOverlayIcon()` 完全没用（grep 零命中）；托盘图标没有状态变体；没有「点击托盘看当前 Goal」的入口。

---

## 5. 推荐组合（供决策）

按业界三层连续体，落到 MAFW：

- **L1 图标态**：托盘图标按状态换形（跑 / 完成 / 需要你），完成时用一次缓慢的颜色过渡而非突变。
- **L2 一行摘要**：复用现有 30s 轮询，tooltip 加一行 `冒烟·入口验证 · plan 1/3 · 8m`；同时挂 `win.setProgressBar()` 到任务栏按钮。
- **L3 展开面**：点托盘 → 菜单顶部状态行变成可点项（打开工作台「工作」）；
- **完成**：`setOverlayIcon` 打一个 ✓ 角标 + 一次 OS 通知（窗口在前台时也不静默），点开后角标消失。

理由：不加窗口、不加常驻浮层；托盘 + 任务栏是 Windows 用户已有的「后台任务」心智；三层里任何一层失效（托盘被折叠）都还有另两层兜底。

---

## 参考

- Dropbox Help：sync icons（macOS / Windows）——图标态最完整的产品化
- Apple HIG：Live Activities / WWDC26 Live Activities essentials
- VS Code UX Guidelines：Status Bar / Progress
- Visual Studio Extensibility：types of progress bars（status bar / TWD / Task Status Center）
- JetBrains：Progress Bar SDK 文档、Background Tasks manager
- Matthews et al., *A toolkit for managing user attention in peripheral displays*, UIST '04
- Weiser & Brown, *Designing Calm Technology*（1995/1996）；Amber Case, calmtech.com 八原则
