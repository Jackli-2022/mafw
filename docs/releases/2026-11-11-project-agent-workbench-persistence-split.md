# Project Agent Workbench Plan D3d — 内容状态持久化、分屏对照与 Goal 最近项（2026-11-11）

## 范围

- 本地 `main`，未 push
- Spec：`docs/superpowers/specs/2026-11-11-project-agent-workbench-experience-design.md` §5.3、§6.1、§7.4、§8.2、§11.4/§11.13
- 前置：`docs/releases/2026-11-11-project-agent-workbench-goal-attention.md`

## 提交

| commit | 内容 |
|---|---|
| `f796787e` | 内容 scope 状态/草稿跨重启持久化；活动文档恢复；文件树偏好；显式分屏对照；Goal revision 最近项 |

## 行为变化

### 跨重启的内容状态

- `content-scope-state` 按 `mafw-content-state:<scopeKey>` 持久化：
  - 树展开目录、选中文件；
  - 打开文件列表、活动文件；
  - 阅读位置、选区；
  - 窄容器文件树抽屉偏好。
- `editor-drafts` 按 `mafw-editor-drafts:<root>` 持久化草稿、mtime、EOL。
- 两者 300ms 去抖、存储失败 fail-open。
- 重启后进入同一 scope：
  - 树展开/选中恢复；
  - 活动文档自动重新打开（不再只恢复 scope 身份）；
  - 有草稿的文件恢复后标记 dirty 并转持久 Tab，避免被下一次阅读预览替换。
- 选区/滚动位置由现有 `content-scope-state` 恢复路径消费。

### 显式分屏对照

- 文档 surface 的内容头新增 `分屏对照` 按钮（`aria-pressed`）。
- 开启后：
  - 文件树点击进入第二只读文档面板（`SplitDocumentPane`），主文档不变；
  - 第二面板显示文件名、正文/图片，可关闭；
  - 关闭分屏不影响主文档、编辑 Tab 或草稿。
- 宽容器左右并排（42% 副栏），窄容器上下堆叠。
- 分屏是瞬态显式动作，不持久化。

### Goal revision 最近项

- 最近内容条目新增 `goalId / revision / worktreeDir`。
- 项目首页最近内容包含 Goal revision 条目，并显示 scope badge。
- 点击 Goal 条目：
  - 校验 worktree 是否仍存在；
  - 成功：恢复该 Goal revision scope 并打开文件；
  - 失败：toast「该 Goal 版本的文件已不可用」，不影响当前 scope。
- 项目主目录条目仍直接打开项目文件。

## 验证

- desktop 全量 **3371 / 3371**，691 suites
- `npx tsgo --noEmit -p tsconfig.json` rc=0
- `electron-vite build` rc=0
- 实机 dev 冒烟（`.mafw/qa/plan-d3d-split.png`）：
  - 打开 `AGENTS.md`，点击分屏按钮；
  - 文件树点击 `CONTEXT.md`：主文档保持 `AGENTS.md`，副栏标题 `CONTEXT.md`，正文可读；
  - 分屏按钮 `aria-pressed=true`；
  - 关闭分屏后副栏消失，按钮恢复 `false`。

## 状态

D3 的内容域清单已收口：内容意图、文档直开、viewer 工具化、Goal 详情注意力顺序、内容状态持久化、显式分屏、Goal revision 最近项均已完成。Goal 选中态仍按 D1 设计为瞬态，不跨重启恢复。
