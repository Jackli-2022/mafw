# Capability Kernel Phase 4 收口记录

- 日期：2026-11-13
- 版本：5.1.0（未 bump、未发布）
- 范围：Desktop UI 槽位整个 Phase 4（menu / composer / panel rail / chat part 评估）
- Spec：`docs/superpowers/specs/2026-11-12-fixed-core-capability-architecture-design.md`
- 路线图：`docs/superpowers/plans/2026-11-12-fixed-core-capability-roadmap.md`
- 详细 plan：`docs/superpowers/plans/2026-11-13-kernel-v2-phase4-desktop-ui-slots.md`

## 交付总览

Phase 4 的四个槽位全部有结论：

| 槽位 | 状态 | 交付 |
|---|---|---|
| `ui.menuItems` | 已交付 | contract 校验 → gateway 投影 → desktop `MenuContributionRegistry` → context-menu 扩展组 → 同包 action |
| `ui.composerActions` | 已交付 | contract 校验 → desktop `PluginComposerActions` → 同包 action → `{ insertText }` 写入草稿 |
| `panel.rail` | 已交付 | contract 校验 → `railItemsFromPanels()` → IconRail 合并排序 → 复用 `openPluginFocus` |
| chat part renderer | 评估完成，暂不实现 | 宿主独占；`data-*` 走 `DataPartCard`；未来唯一推荐形状 `ui.dataPartCards` |

G4 达成：一个插件包可以贡献 menu item + composer action，端到端可用；panel rail 复用同一套 descriptor/revision 模式；desktop 全量绿；无原生组件注入。

## 各槽位行为

### menuItems

- descriptor：`{ id, surface, label, action, icon?, shortcut?, order? }`
- surface：`editor.tab` / `file.tree` / `file.path` / `message` / `session.row`
- 每个 surface 最多 7 项；合并后仍过 `validateMenu()`，失败 fail-open 回原菜单。
- 点击调用 `window.api.mafw.plugins.invoke(pkg, action, {}, sessionID)`；失败只记录，不影响菜单。
- revision 变化 / 包卸载先 dispose 旧贡献再注册新快照。
- `danger` 暂不开放；`shortcut` 只是展示提示，未注册全局键位。

### composerActions

- descriptor：`{ id, label, action, icon?, order? }`；每包最多 3 个。
- action 返回 `{ insertText: string }` 时写入当前会话草稿，**不自动发送**；其他返回值忽略。
- action 失败弹 toast；无活动会话时按钮 disabled。
- action input 目前固定 `{}`。

### panel.rail

- descriptor：`panel.rail = { icon, order?, badge? }`。
- `icon` 必须已注册；`order` 整数；`badge` boolean。
- surface id 与工作台 tab 相同：`plugin:<package>:<panel>`。
- 与 web surface rail 合并排序，共用 `applyPluginRailState` 与现有样式。

### chat part renderer（评估结论）

- 工具 part 已经由 `ui.toolCards` + `PluginToolCard` + `PluginViewRenderer` 覆盖：settled 后调 `viewAction`，失败/过期/空结果回退原卡。
- 非工具 `data-<name>` 由 `DataPartCard` 显示名称 + JSON；gateway 已校验名字、≤64KB、可序列化，并持久化 overlay。
- `PART_MAPPING` / `registerPartComponent` 只服务宿主内部；插件模块边界由 `plugin-chat-part-boundary.test.ts` 守卫。
- 不实现原因：没有真实消费者；data part 没有 settle 语义；工具卡已覆盖主要结构化需求；提前开槽会引入流式调用与全局名字冲突。
- 未来实现形状与触发条件：`docs/research/2026-11-13-chat-part-renderer-evaluation.md`。

## 不变量

- 插件 UI 仍是 data-only descriptor；renderer 不执行插件代码。
- 没有新增 preload 方法，没有改变 webview sandbox；webview 仍永不拿 gateway apiToken。
- 默认行为不变：没有声明对应 `ui.*` 的包与之前完全一致。
- Phase 4 不写 live `~/.mafw`；没有数据迁移。

## 验证

- plugin-contract：**44 / 44 pass**。
- gateway 全量：**7008 passed / 1 skipped / 7009 total**。
- desktop 全量：
  - panel rail 基线 **3757 / 3757 pass**；
  - chat part 边界守卫新增 1 个测试 → Phase 4 可归因 **3758 / 3758 pass**；
  - 当前 worktree 全量 **3761 / 3761 pass**，其中 3 个测试来自另一会话未提交的 document 工作，不计入本 phase。
- session-ui 定向 `data-part.test.ts` + `parts-rules.test.ts`：**12 / 12 pass**。
- gateway typecheck：通过。
- desktop typecheck：`tsgo` 依赖当前未安装；用仓库 `typescript` 执行 `tsc --noEmit -p packages/desktop/tsconfig.json` 通过。
- 既存问题（不归因本 phase）：session-ui 全量 architecture guard 在 `runtime-literal` 规则上命中 `OpenCode` 主题名 / `opencode-find` 等 10 个文件（引入于 `5a171559`），需要独立收窄规则或改名。

## 关键 commit

- menu：
  - `9e793fca` feat(plugin-contract): add declarative menu items
  - `2471ed43` feat(desktop): add context menu contribution slot
  - `98018dc8` feat(desktop): sync plugin menu items into the shell
  - `e4de369a` test(plugins): cover menu item projection
  - `99e0bf97` docs: record phase 4 s4 menu slot
- composer：
  - `86e11bcb` feat(plugin-contract): add composer action declarations
  - `f944591d` feat(desktop): add declarative composer actions
  - `890206b6` docs: record phase 4 composer action
- panel rail：
  - `918ca4e7` feat(desktop): add panel rail entries
  - `0147b5f1` docs: record phase 4 panel rail entry
- chat part 评估：
  - 文档提交见 `git log -- docs/research/2026-11-13-chat-part-renderer-evaluation.md`、`git log -- packages/desktop/src/renderer/mafw/plugins/plugin-chat-part-boundary.test.ts`

## 明确未做

- `ui.dataPartCards` 实现（评估完成，暂不实现）。
- menu `danger` 项策略、真实快捷键绑定。
- composer action 的 input 参数/表单、动态 disabled/权限态、`insertText` 之外的富交互。
- panel rail 的拖拽排序 / 用户自定义顺序。
- 静态 `plugin.json` 与 `activate()` 返回的 UI 贡献交叉校验；当前以 activate 投影为准。

## Rollback

- 包移除对应 `ui.*` 声明 → 下次 revision 后槽位消失，不残留。
- 删除 desktop 接线（`PluginMenuWiring` / `PluginComposerActions` / `railItemsFromPanels` 合并）→ 回到各自基线。
- 回退 Phase 4 提交 → contract 不再接受对应 slot。
- 不需要回滚数据；本 phase 不写 live DB。

## Phase 4 退出与下一步

Phase 4 退出条件已满足：四个槽位都有结论，G4 达成，门禁绿（除已记录的 session-ui 既存守卫问题）。

下一阶段：**Phase 5（有状态能力）**。顺序：memory store/retrieval → embedding/reranker → automation trigger/action → goal node/eval → storage backend。Phase 5 开始前先写 memory store/retrieval 的详细 plan，并按 TDD 实施。
