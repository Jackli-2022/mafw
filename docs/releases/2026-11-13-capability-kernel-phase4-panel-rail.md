# Capability Kernel Phase 4 / Panel Rail Entry 交付记录

- 日期：2026-11-13
- 版本：5.1.0（未 bump、未发布）
- 范围：Desktop UI 槽位第三步 panel rail entry
- Spec：`docs/superpowers/specs/2026-11-12-fixed-core-capability-architecture-design.md`
- 路线图：`docs/superpowers/plans/2026-11-12-fixed-core-capability-roadmap.md`
- 详细 plan：`docs/superpowers/plans/2026-11-13-kernel-v2-phase4-desktop-ui-slots.md`

## 交付范围

- `packages/plugin-contract`：
  - `PluginPanelDescriptor.rail?: PluginPanelRailDescriptor`。
  - `PluginPanelRailDescriptor = { icon, order?, badge? }`。
  - 校验：icon 必须已注册、order 整数、badge boolean、未知字段拒绝。
- desktop：
  - `plugin-view-model.ts` 新增 `railItemsFromPanels()`：只投影声明 `rail` 的 panel；surface id 复用 `plugin:<package>:<panel>`。
  - `MafwShell.tsx` 合并 panel rail 与 web surface rail，按 order/label/surfaceId 排序后交给 `applyPluginRailState`。
  - 点击复用现有 `openPluginFocus`，不新增第二条打开路径。
  - 仍由宿主 `IconRail` 渲染，不注入组件。

## 行为说明

- panel rail 与 web surface rail 共用同一个 IconRail 数据模型、badge/active 状态与样式。
- `badge: true` 只申请角标能力；实际数字仍由页面 bridge 提供（与 web surface 相同）。
- `rail` 是 opt-in：没有 `rail` 的 panel 仍然只出现在工作台 L2 tab。
- `rail.icon` 必须在 `PLUGIN_ICON_NAMES` 白名单内；否则 candidate 校验失败。
- 不改变 preload/webview sandbox。

## 验证

- plugin-contract：**44 / 44 pass**（43 → 44，新增 1）。
- gateway 全量：**7008 passed / 1 skipped / 7009 total**，一次 clean。
- desktop 全量：**3757 / 3757 pass**。
  - panel rail 新增 1 个纯投影测试；shell 合并接线由既有 source-level 测试覆盖。
- gateway typecheck：通过。
- desktop typecheck：`tsgo` 依赖当前未安装；用仓库 `typescript` 执行 `tsc --noEmit` 通过。

## 明确未做

- chat part renderer 评估（Phase 4 最后一项，只评估）。
- panel rail 的拖拽排序 / 用户自定义顺序。
- 动态 disabled / 权限态。
- 静态 `plugin.json` 的 `ui.panels[].rail` 与 `activate()` 返回的交叉校验；当前以 activate 投影为准。

## Rollback

- 包移除 `panel.rail` → 下次 revision 后 rail 项消失，L2 tab 保留。
- 删除 MafwShell 的 `railItemsFromPanels` 合并 → 回到只显示 web surface rail。
- 回退本 phase 提交 → contract 不再接受 `rail`。
- 不需要回滚数据；本 phase 不写 live DB。

## 关键 commit

- `918ca4e7` feat(desktop): add panel rail entries

## Next

Phase 4 最后一项：chat part renderer 评估（只出结论，不默认实现）。之后进入 Phase 5（有状态能力）。
