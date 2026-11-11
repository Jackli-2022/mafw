# Project Agent Workbench Plan D3b — Viewer 工具化（2026-11-11）

## 范围

- 本地 `main`，未 push
- Spec：`docs/superpowers/specs/2026-11-11-project-agent-workbench-experience-design.md` §7.2/§7.3、§11.4
- 前置：`docs/releases/2026-11-11-project-agent-workbench-content-intent.md`

## 提交

| commit | 内容 |
|---|---|
| `ecec9792` | 内置浏览器/终端移出内容 L2；内容头加入浏览器、终端与 `返回文档`；顶部上下文标签显示当前文档名 |

## 行为变化

- 文档是内容的默认面。打开文件后：
  - 顶部上下文标签直接显示文档名（如 `AGENTS.md`）；
  - 阅读态且只有一个文档时不显示编辑器标签条；
  - 不再先落到泛化的 `文件` tab。
- `浏览器 / 终端` 不再是和文档平级的 L2 tab：
  - 内容头右侧提供浏览器（globe）与终端图标按钮；
  - 切到浏览器/终端后出现 `返回文档`；
  - 顶部上下文标签显示 `浏览器` / `终端`；
  - HTML/网页仍自动进入浏览器；Ctrl+` 仍可切终端。
- 只有用户显式安装的插件 surface 继续作为 L2 tab（`plugin:<pkg>:<panel>`）；没有插件时 L2 条不渲染，内容区更干净。
- 插件 surface 的键盘左右/Home/End 导航只作用于插件 tab，不再路过内置 viewers。

## 验证

- desktop 全量 **3356 / 3356**，691 suites
- `npx tsgo --noEmit -p tsconfig.json` rc=0
- `electron-vite build` rc=0
- 实机 dev 冒烟（`.mafw/qa/plan-d3b-document.png`）：
  - 打开 `AGENTS.md`：顶部标签 `AGENTS.md`，无 L2 条，无编辑器标签条；
  - 内容头工具：浏览器 / 终端 / 返回；`项目文件 · 阅读 / 修改`；
  - 点浏览器：顶部标签 `浏览器`，出现 `返回文档`，浏览器按钮 `aria-pressed=true`；
  - 点 `返回文档`：回到 `AGENTS.md`；
  - 点终端：顶部标签 `终端`，终端按钮 `aria-pressed=true`，`返回文档` 可用。

## 后续（D3c）

- 显式分屏 / 并行工作区。
- Goal 详情按 §8.2 重排注意力：目标 → 需要我做什么 → 方向/进度/结果 → 证据与评审 → 历史/诊断。
- 跨重启的文件树展开、滚动位置、草稿持久化。
- Goal revision 最近项。
