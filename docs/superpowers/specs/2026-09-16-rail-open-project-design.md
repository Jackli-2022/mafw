# Rail 打开新项目设计（项目切换器内建"打开文件夹"）

日期：2026-09-16
状态：已批准（对话中用户指定入口位置：切换 project 的地方；业界调研：Chrome/Slack/JetBrains/VS Code 均在切换器列表末尾固定"添加/打开"入口 + 原生目录选择器）

## 背景与问题

桌面端 Rail 项目区可切换已注册项目（点击 → `projects.setCurrent(worktree)`），但**没有打开新项目文件夹的入口**——新项目只能靠 CLI `mafw register <dir>` 或恰好有会话跑在那个目录。

关键事实：`setCurrent(path)` 本身就是"注册+切换"（SDK → `POST /api/projects/register {projectDir, mafwDir}` → `persistRegistry` → 广播 `project_registered` → Rail 经 `projectsRev` 自动刷新）。缺的只是"选择文件夹"的 UI 入口。

## 业界调研结论

Chrome profile 切换器（末尾 Add profile）、Slack 侧栏底部 +、JetBrains 项目下拉（末尾 Open…）、VS Code Remote Explorer（列表底部 +）——共同约定：**添加入口长在切换器列表末尾、永不隐藏；点击打开原生系统目录选择器；选中后走既有切换链路**。

## 设计

**入口**：Rail 项目列表末尾固定一项 `＋ 打开项目文件夹…`（ghost 样式，当前项目照常高亮）。

**流程**：

1. 点击 → 新 IPC `projects.openDirectory()`：main 执行 `dialog.showOpenDialog(win, { properties: ['openDirectory'] })`（对齐 `mafw-ipc.ts:125` 保存对话框的动态 import electron 模式），返回 `{ canceled, filePaths }`；取消 → 返回 null，renderer 静默结束
2. 选中 → renderer 调 `window.api.mafw.projects.setCurrent(path)`（**现有方法零改动**：注册 + 切换 + 广播）
3. 广播 `project_registered` → `projectsRev++` → Rail 项目列表刷新、新项目高亮、会话列表按新项目过滤（全部既有逻辑）

## 边界

- 选择 home/用户数据目录 → gateway 400 拒绝（`isUserDataDir` 防线）→ renderer toast 显示错误信息
- 重复打开已注册项目 → 幂等（registeredProjects.set 覆盖 + setCurrent 切换语义）
- 目录不存在/无权限等 → IPC 错误 → toast
- SDK / gateway / TUI 零改动

## 改动面

| 文件 | 改动 |
|---|---|
| `packages/desktop/src/main/mafw-ipc.ts` | 新增 `ipcMain.handle("mafw-open-directory", ...)`：`dialog.showOpenDialog(win, { properties: ['openDirectory'] })`，返回 `{ ok, canceled?, path?, error? }` 信封 + writeLog（对齐 :123 `mafw-export-session` 先例） |
| `packages/desktop/src/preload/mafw-api.ts` | `projects:` 命名空间加 `openDirectory: () => invoke("mafw-open-directory")` |
| `packages/desktop/src/preload/mafw-types.ts` | 同步类型声明 |
| `packages/desktop/src/renderer/mafw/components/Rail.tsx` | 项目列表末尾加按钮项；点击 → openDirectory → `projects.setCurrent(path)`；错误 toast |

（注册/切换/广播链路复用 SDK `project.setCurrent` → `POST /api/projects/register`，gateway 零改动。）

## 验证

- desktop 无测试框架：`npx electron-vite build`（workdir `packages/desktop`）门禁
- 人工验证：①Rail 末尾出现入口；②点击打开系统目录选择器；③选中新目录 → 项目列表刷新并高亮、会话列表切换；④选 home 目录 → toast 报错不注册；⑤取消 → 无操作
