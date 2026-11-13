# 2026-11-13 · Ctrl+P 只开取景器，命令面板改用 Ctrl+Shift+P

- **版本**：`v5.1.0`
- **范围**：Desktop 全局快捷键

## 根因

同一次按键被两个互不知情的全局 `keydown` 处理器同时消费：

| 处理器 | 行为 |
|---|---|
| `MafwShell.tsx` 取景器 `onMount` | 硬编码 `(metaKey \|\| ctrlKey) && key === "p"` → `openSubjectPicker()` |
| `MafwShell.tsx` 命令面板 | `matchesCombo(e, keybindingFor("command-palette"))`，默认 `ctrl+p` → `setPaletteOpen()` |

于是 Ctrl+P 同时弹出「取景器」和「命令面板」两个浮层。

取景器是 2026-11-12 新增的（focus stack / SubjectPicker），走的是硬编码快捷键，绕过了 C3
快捷键注册表，因此 `findConflicts` 也看不到这次冲突；命令面板的 `ctrl+p` 默认值是 2026-09-15
留下的。

产品语义以现有文档与 UI 提示为准：`Ctrl+P` = 取景器（`FrameBar` 提示、编辑器空态
「按 Ctrl+P 选择文件」、`docs/architecture/desktop.md`）。命令面板按 VS Code 惯例退到
`Ctrl+Shift+P`。

## 交付

- `keybindings.ts`：新增动作 `open-picker`（标签「打开取景器」，默认 `ctrl+p`）；
  `command-palette` 默认改为 `ctrl+shift+p`。
- `MafwShell.tsx`：取景器快捷键改走 `matchesCombo(event, keybindingFor("open-picker"))`，
  不再硬编码 `p`；未来可被用户重绑，也纳入冲突检测。
- 单浮层防御：打开命令面板时关闭取景器，打开取景器时关闭命令面板——即使两者被重绑到同一
  组合键，也只显示一个。
- 注释与 `docs/architecture/desktop.md` 同步更新。

## 验证

- desktop 全量：**3763 / 3763**（727 suites）
- 本轮测试变动：新增 **1**（`keybindings.test.ts` 默认值断言），更新 **2**（冲突用例改用新默认、
  `focus-stack-wiring.test.ts` 改为断言走注册表）
- `tsgo --noEmit -p tsconfig.json`：rc=0

## 边界

- 用户若曾在设置里把「命令面板」显式改成 `Ctrl+P`，本地存储覆盖仍会生效；设置页会显示冲突警告，
  点「默认」即可恢复。
- 取景器原有行为（打字时也拦截 Ctrl+P）保持不变；本次只解决重复打开。
