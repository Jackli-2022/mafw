# Capability Kernel Phase 4 / Composer Action 交付记录

- 日期：2026-11-13
- 版本：5.1.0（未 bump、未发布）
- 范围：Desktop UI 槽位第二步 composer action
- Spec：`docs/superpowers/specs/2026-11-12-fixed-core-capability-architecture-design.md`
- 路线图：`docs/superpowers/plans/2026-11-12-fixed-core-capability-roadmap.md`
- 详细 plan：`docs/superpowers/plans/2026-11-13-kernel-v2-phase4-desktop-ui-slots.md`

## 交付范围

- `packages/plugin-contract`：
  - 新增 `PluginComposerActionDescriptor`；`PluginUiContribution.composerActions`。
  - 校验：`action` 必须引用同包 action、icon 白名单、label ≤40、id 唯一、order 整数、每包最多 3 个。
  - `PLUGIN_UI_LIMITS.maxComposerActions = 3`。
- gateway：
  - `validateClientDescriptor` 校验 `ui.composerActions`；`buildClientDescriptor` 自动投影。
  - `buildActivatedContributions` / PluginHost 复用现有 `ui` 投影。
- desktop：
  - `plugins/plugin-composer-actions.ts`：descriptor → 纯数据 action；未知 action 跳过；未知 icon 回退 `plus`；按 order/label/id 排序。
  - `plugins/PluginComposerActions.tsx`：宿主渲染 `ButtonV2 + Icon`；点击调用 `window.api.mafw.plugins.invoke(pkg, action, {}, sessionID)`。
  - action 返回 `{ insertText: string }` → `pushComposerInsert` 写入当前会话草稿，**不自动发送**。
  - action 失败 → toast；无活动会话 → 按钮 disabled。
  - `ChatPane.tsx` 在 composer 左侧工具条挂载 `<PluginComposerActions sessionID={sidProp()} />`。
- 文档：
  - `docs/architecture/desktop.md` 增加 composer action。
  - `docs/guides/plugin-authoring.md` 增加 `ui.composerActions` 示例。

## 行为说明

- composer action 只传 `{}` 作为 action input；需要上下文的 action 自己从 `sessionID` / gateway 读。
- `insertText` 只追加到草稿，不发送；避免插件直接替用户发消息。
- 最多 3 个按钮，避免挤占 composer 工具条。
- 仍由宿主渲染，不注入 Solid 组件，不改变 preload/webview sandbox。

## 验证

- plugin-contract：**43 / 43 pass**（42 → 43，新增 1）。
- gateway 定向（package-validator）：**38 / 38 pass**。
- gateway 全量：**7008 passed / 1 skipped / 7009 total**，连续两次 clean。
- desktop 全量：**3754 / 3754 pass**。
  - composer action 新增 5 个测试：pure projection 3、宿主接线 2。
- gateway typecheck：通过。
- desktop typecheck：`tsgo` 依赖当前未安装；用仓库 `typescript` 执行 `tsc --noEmit -p packages/desktop/tsconfig.json` 通过。正式 gate 仍需在有 tsgo 的环境重跑。

## G4 状态

G4 达成：一个插件包可以贡献 **menu item + composer action**，端到端可用；desktop 全量绿；无原生组件注入。

剩余 Phase 4 槽位：
- panel rail entry
- chat part renderer 评估（只评估，不默认实现）

## 明确未做

- composer action 的 input 参数/表单（当前只传 `{}`）。
- action 结果的富交互（只识别 `insertText`）。
- 动态 disabled/权限态。
- 静态 `plugin.json` 的 `ui.composerActions` 与 `activate()` 返回交叉校验；当前以 activate 投影为准。

## Rollback

- 包移除 `ui.composerActions` → 下次 revision 后按钮消失。
- 删除 `ChatPane` 的 `<PluginComposerActions>` 挂载 → composer 回到原工具条。
- 回退本 phase 提交 → contract 不再接受 `composerActions`。
- 不需要回滚数据；本 phase 不写 live DB。

## 关键 commit

- `86e11bcb` feat(plugin-contract): add composer action declarations
- `f944591d` feat(desktop): add declarative composer actions

## Next

Phase 4 剩余：panel rail entry → chat part renderer 评估。之后进入 Phase 5（有状态能力）。
