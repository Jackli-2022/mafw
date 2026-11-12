# Desktop context-menu extension point：spike 记录

- 日期：2026-11-12
- 目标：验证“固定 shell + 声明式 UI 槽位”在 desktop 侧的最小闭环
- 结论：宿主侧槽位成立；下一步再把 `plugin.ui.menuItems` 投影到这个 registry

## 1. 设计

新增 `packages/desktop/src/renderer/mafw/context-menu/contributions.ts`：

- `MenuContribution`：`id / surface / label / run / icon? / shortcut? / order? / disabled? / disabledReason?`
- `MenuContributionRegistry`：
  - `register()` 返回 disposer；重复 id / 非法 id / 空 label / 超量 / `danger` 直接拒绝
  - `list(surface?)` 按 `order → label → id` 排序
  - `merge(model, context)` 把匹配项追加为一个 `扩展` group；合并结果先过现有 `validateMenu()`，不合法则 fail-open 回原菜单
  - `run(id)` 只处理 `contrib:<id>`，命中后调用 contribution；未知 id 返回 false
- `menuContributions`：默认单例

`controller.ts`：

- `createMenuController({ contributions? })` 增加可选注入；`null` 可关闭。
- `request()` 在 build 之后 merge，并把 contribution id 路由放在内置 `run` 之前。
- 默认 `menuController` 使用 `menuContributions`。
- 不改 `MenuHost`、不改任何菜单 builder、不改 `plugin-contract`。

## 2. 为什么先做宿主侧

- 菜单是固定 shell 的中心组件，已有 grammar（`validateMenu`）、focus/键盘/portal 逻辑；宿主侧槽位能先证明“数据贡献 + 宿主渲染 + action 路由”。
- 不把 Solid 组件注入 renderer，不改变现在的信任边界。
- `danger` 暂时保留：危险项必须落在最后一个 separator 之后，直接追加会破坏现有 grammar；等确定插入策略再开放。

## 3. 验证

新增 11 个测试：

- `contributions.test.ts`：10 个（注册/释放、重复 id、非法 id、空 label、surface 上限、danger 拒绝、无匹配 fail-open、排序/group、run 上下文、未知 id）
- `controller-contributions.test.ts`：1 个（merge + contrib id 优先于内置 run）

结果：

- context-menu 全套：**37 tests / 37 pass**
- desktop 全量：**3543 tests / 3543 pass**
- `npx tsgo --noEmit -p tsconfig.json`：通过

环境说明：worktree 里为了让 `mafw-gateway-resolver.test.ts` 的 dev 路径成立，临时把 `gateway/dist` junction 到主 checkout；这是未跟踪的构建产物，不是代码改动。

## 4. 没证明什么

- 没有接 `plugin-contract`，所以还没有 `plugin.json` 的声明式 `ui.menuItems`。
- 没有真实菜单项生产者；目前只有 registry + controller 的测试路径。
- 没有 `danger` 项、子菜单、图标白名单校验、跨包 action 调用。
- 没有把 `run` 换成 gateway action；当前是 host callback（spike 形态）。
- 没有处理菜单打开期间 contribution 被卸载的 UI 刷新。

## 5. 下一步

1. 在 `plugin-contract` 增加 `ui.menuItems`（data-only：`surface/id/label/action/order/icon?/shortcut?`），由 gateway 校验并投影。
2. 在 desktop 的 plugin store 收到 descriptor 后，把 `menuItems` 注册到 `menuContributions`，`run` 走 `window.api.mafw.plugins.invoke(pkg, action, ...)`。
3. 定义 danger 插入策略：贡献项放在最后一个 danger block 之前，或禁止 danger。
4. 用同样的模式做 composer action / panel rail entry。
