# Capability Kernel Phase 4 / S4 交付记录

- 日期：2026-11-13
- 版本：5.1.0（未 bump、未发布）
- 范围：Desktop UI 槽位第一步 `ui.menuItems`
- Spec：`docs/superpowers/specs/2026-11-12-fixed-core-capability-architecture-design.md`
- 路线图：`docs/superpowers/plans/2026-11-12-fixed-core-capability-roadmap.md`
- 详细 plan：`docs/superpowers/plans/2026-11-13-kernel-v2-phase4-desktop-ui-slots.md`

## 交付范围

- `packages/plugin-contract`：
  - 新增 `PLUGIN_MENU_SURFACES` / `PluginMenuSurface` / `PluginMenuItemDescriptor`。
  - `PluginUiContribution.menuItems`。
  - 校验：surface 白名单、同包 action 引用、icon 白名单、shortcut 长度、order 整数、id 唯一、数量上限 20。
  - `PLUGIN_UI_LIMITS.maxMenuItems = 20`。
- gateway：
  - `validateClientDescriptor` 校验 `ui.menuItems`；`buildClientDescriptor` 自动投影。
  - `buildActivatedContributions` / `PluginHost` 无需额外改动（复用 `ui` 投影）。
- desktop：
  - `context-menu/contributions.ts`：`MenuContribution` / `MenuContributionRegistry` / `menuContributions`；重复 id、空 label、danger、每 surface 上限 7 全部拒绝。
  - `context-menu/controller.ts`：可注入 contributions；默认使用 `menuContributions`；贡献 id 优先于内置 run。
  - `plugins/plugin-menu-contributions.ts`：descriptor → contribution 映射；未知 surface / 未声明 action / register 失败均跳过；`invoke` 失败只 `onError`。
  - `plugins/PluginMenuWiring.tsx`：监听 committed descriptors，revision 变化先 dispose 旧贡献；action 走 `window.api.mafw.plugins.invoke`，带当前 `sessionID`。
  - `MafwShell.tsx` 挂载 `<PluginMenuWiring sessionID={activeSessionId()} />`。
- 文档：
  - `docs/architecture/desktop.md` 增加统一插件包菜单槽位。
  - `docs/guides/plugin-authoring.md` 增加 `ui.menuItems` 写法、surface 列表和限制。

## 行为说明

- 支持的 surface：`editor.tab` / `file.tree` / `file.path` / `message` / `session.row`。
- 贡献项追加为「扩展」group；merge 后仍过 `validateMenu()`，失败回退原菜单。
- `danger` 暂不开放；`shortcut` 只是展示提示，不注册全局键位。
- 包 reload/disable/remove 时旧贡献自动退订。
- 仍由宿主渲染，不注入 Solid 组件，不改变 preload/webview sandbox。
- 默认行为：没有 `ui.menuItems` 的包与之前完全一致。

## 验证

- plugin-contract：**42 / 42 pass**（40 → 42，新增 2）。
- gateway 定向（package-validator + client-descriptor）：**45 / 45 pass**。
- gateway 全量：**7006 passed / 1 skipped / 7007 total**。
  - run 2、run 3 连续 clean。
  - run 1 出现 `checkpoint/restore-git`、`runtime/instance-lock-heartbeat` 的 5s timeout；单文件重跑 11/11 通过，与 S4 改动无关。
- desktop 全量：**3625 / 3625 pass**。
  - S4 新增 16 个测试：context-menu contributions 11、plugin menu sync 4、shell wiring 1。
- `npx tsc --noEmit -p tsconfig.json`（gateway）：通过。
- desktop typecheck：`tsgo` 依赖 `@typescript/native-preview` 当前未安装；用仓库 `typescript` 执行 `tsc --noEmit -p packages/desktop/tsconfig.json` 通过。正式 gate 仍需在有 tsgo 的环境重跑。

## 明确未做

- composer action（下一槽位）。
- panel rail entry。
- chat part renderer 评估。
- menu 的 `danger` 插入策略、子菜单、真实快捷键注册、disabled 动态状态。
- 静态 `plugin.json` 的 `ui.menuItems` 与 `activate()` 返回的 UI 仍未做交叉校验；当前以 `activate()` 投影为准。

## Rollback

- 包移除 `ui.menuItems` → 下次 revision 后贡献消失。
- 删除 `PluginMenuWiring` 挂载 → 菜单回到原有内置项。
- 回退本 phase 提交 → contract 不再接受 `menuItems`，desktop 不注册贡献。
- 不需要回滚数据；本 phase 不写 live DB。

## 关键 commit

- `9e793fca` feat(plugin-contract): add declarative menu items
- `2471ed43` feat(desktop): add context menu contribution slot
- `98018dc8` feat(desktop): sync plugin menu items into the shell
- `e4de369a` test(plugins): cover menu item projection

## Next

Phase 4 下一槽位：composer action。复用同一模式：data-only descriptor → gateway 校验/投影 → desktop host 渲染 → package action；之后再做 panel rail entry。
