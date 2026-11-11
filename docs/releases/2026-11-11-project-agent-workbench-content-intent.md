# Project Agent Workbench Plan D3a — 内容意图（2026-11-11）

## 范围

- 本地 `main`，未 push
- Spec：`docs/superpowers/specs/2026-11-11-project-agent-workbench-experience-design.md` §7.1/§7.2/§7.4
- 架构现状：`docs/architecture/desktop.md` §「内容意图：阅读 / 修改」

## 提交

| commit | 内容 |
|---|---|
| `01b6c7a1` | `content-intent.ts` + `editor-state.ts`：阅读/修改意图、预览 Tab、dirty/显式修改转持久 |
| `22b7400f` | 内容头意图控件、EditorDock 阅读预览、项目入口默认阅读、Goal scope「验收」入口、CSS |

## 行为变化

- 内容头作用域标签后新增 `阅读 / 修改`。项目首页打开文件默认 `阅读`；内容树内点击保持当前意图。
- 打开文档后，内容二级条第一项直接显示文档名（如 `AGENTS.md`），阅读态且只有一个文档时不显示编辑器标签条；正文直接占据内容区。不再先落到泛化的 `文件` tab。
- `阅读` 使用临时预览 Tab：
  - 新的干净预览替换上一个干净预览；
  - 持久 Tab、dirty Tab、只读预览不会被替换；
  - 预览 Tab 名称以斜体显示。
- `修改` 会把当前预览钉成持久 Tab；首次在编辑器输入也会自动切到 `修改` 并转持久。
- `修改` 意图下新打开的文件直接进入持久 Tab。
- Goal revision scope 额外显示 `验收`，点击回到该 Goal 的结果上下文；项目 scope 不显示。
- 保存、冲突、草稿、批注、图片/Office 只读预览、SVG/Markdown/JSON/表格预览切换语义不变。
- Goal 详情没有阶段页面 Tab，时间线只是只读投影；文档中此前“阶段 Tab 清理”的描述已纠正。

## 验证

- desktop 全量 **3353 / 3353**，691 suites
- `npx tsgo --noEmit -p tsconfig.json` rc=0
- `electron-vite build` rc=0
- 实机 dev 冒烟（DOM + `.mafw/qa/plan-d3-document.png`）：
  - 点项目文件 `AGENTS.md` 后内容二级条直接显示 `AGENTS.md`，不再是泛化的 `文件`；阅读态单文档无编辑器标签条；
  - 内容头显示 `项目文件 · 阅读 / 修改`，无 `验收`；
  - 阅读态打开 `CONTEXT.md` 生成 1 个预览 Tab，再打开 `config.json` 仍只有 1 个预览 Tab；
  - 点击 `修改` 后预览转持久（`previewTabs=0`），再打开文件追加持久 Tab；
  - 预览 Tab 斜体样式生效。

## 后续（D3b）

- 显式分屏 / 并行工作区。
- Goal 详情按 §8.2 重排注意力：目标 → 需要我做什么 → 方向/进度/结果 → 证据与评审 → 历史/诊断。
- 跨重启的文件树展开、滚动位置、草稿持久化。
- Goal revision 最近项。
