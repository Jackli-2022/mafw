# Kernel v2 Phase 4 Desktop UI Slots Implementation Plan (S4 first)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 先完成 S4：`plugin-contract.ui.menuItems` → gateway 校验/投影 → desktop 固定 shell 的声明式菜单槽位 → package action 调用，形成端到端闭环；不注入原生组件，不改变 preload/webview sandbox。

**Architecture:** `plugin-contract` 只定义 data-only descriptor；gateway 复用现有 `validateClientDescriptor` 校验并投影；desktop 用宿主侧 `MenuContributionRegistry` 合并到现有 context-menu，action 通过 `window.api.mafw.plugins.invoke` 调用。S4 完成后，composer action / panel rail entry 复用同一套 descriptor + revision 模式。

**Tech Stack:** TypeScript / Node、`@mafw/plugin-contract`、gateway Jest、desktop `node --test` + `@mafw/test-shim`、SolidJS（宿主渲染）。

**Spec:** `docs/superpowers/specs/2026-11-12-fixed-core-capability-architecture-design.md`

**Roadmap:** `docs/superpowers/plans/2026-11-12-fixed-core-capability-roadmap.md`

## Progress（2026-11-13）

- S4（Task 4.1–4.4）完成。
- composer action 完成（contract + desktop 宿主按钮 + `insertText` 草稿插入）。
- panel rail entry 完成（contract + `railItemsFromPanels` + IconRail 合并）。
- chat part renderer（Task 4.7）完成评估：**决定暂不实现**，写出 `ui.dataPartCards` 未来方案与触发条件。
- plugin-contract：**44 / 44 pass**。
- gateway 全量：**7008 passed / 1 skipped / 7009 total**；composer 阶段连续两次 clean。
- desktop 全量：panel rail 基线 **3757 / 3757 pass**；chat part 评估新增 1 个边界守卫 → 本阶段可归因 **3758 / 3758 pass**（当前 worktree 全量 3761，含另一会话未提交的 3 个 document 测试）。
- gateway / desktop typecheck 通过（desktop 用 `tsc`；`tsgo` 依赖当前未安装）。
- 交付记录：`docs/releases/2026-11-13-capability-kernel-phase4-s4.md`、`docs/releases/2026-11-13-capability-kernel-phase4-composer.md`、`docs/releases/2026-11-13-capability-kernel-phase4-panel-rail.md`、`docs/releases/2026-11-13-capability-kernel-phase4-closeout.md`。
- 评估文档：`docs/research/2026-11-13-chat-part-renderer-evaluation.md`。
- G4 达成（menu + composer）；panel rail 已交付；chat part 槽位以评估关闭。
- 明确未做：`ui.dataPartCards` 实现、danger/shortcut 键位、composer action input 参数。

## Global Constraints

- 插件 UI 只做声明式数据；禁止把 Solid/原生组件注入 renderer。
- 不改变 preload / webview sandbox；webview 永不拿 gateway apiToken。
- menu item 的 `action` 必须是同包已声明 action；跨包引用在 contract 校验阶段失败。
- `danger` 项暂不开放（保留字段/策略另定）；宿主 registry 直接拒绝。
- 每个 surface 最多 7 个贡献；merge 后必须过现有 `validateMenu()`，失败 fail-open 回原菜单。
- revision 变化/包卸载必须退订，菜单打开期间不崩溃。
- 默认行为不变：没有 `ui.menuItems` 的包与之前完全一致。
- 所有生产代码先写失败测试；每个 task 结束提交。

## Review Focus

- **菜单 grammar**：贡献项合并后仍满足 `validateMenu()`；danger/空 label/重复 id/超量被拒绝。
- **action 路由**：点击贡献项调用同包 action，带当前 `sessionID`；失败只提示/记录，不关闭或污染菜单。
- **revision / unload**：包 reload 或 remove 后旧贡献项不再出现；菜单打开期间被卸载不崩溃。
- **surface 限制**：contract 只允许 desktop 已支持的 surface；未知 surface 在 gateway 校验阶段失败。
- **无原生注入**：desktop 只接收 descriptor 数据；不接收 handler/源码/函数。

---

## Task 4.1：plugin-contract menuItems

**Files:**
- Modify: `packages/plugin-contract/src/types.ts`
- Modify: `packages/plugin-contract/src/limits.ts`
- Modify: `packages/plugin-contract/src/validate.ts`
- Modify: `packages/plugin-contract/src/validate.test.ts`

**Interfaces:**
```ts
export const PLUGIN_MENU_SURFACES = [
  "editor.tab",
  "file.tree",
  "file.path",
  "message",
  "session.row",
] as const
export type PluginMenuSurface = (typeof PLUGIN_MENU_SURFACES)[number]

export interface PluginMenuItemDescriptor {
  id: string
  surface: PluginMenuSurface
  label: string
  /** Must reference an action declared by the same package. */
  action: string
  icon?: string
  shortcut?: string
  order?: number
}
```

`PluginUiContribution` 增加 `menuItems?: PluginMenuItemDescriptor[]`。

校验：

- `menuItems` 数组，最多 `PLUGIN_UI_LIMITS.maxMenuItems`（新增，20）。
- 每项 object；未知字段拒绝。
- `id` / `label` / `surface` / `action` 必填；id 唯一；surface 在 `PLUGIN_MENU_SURFACES`。
- `action` 必须在同包 `actions` 中声明。
- `icon` 必须 `isPluginIconName`。
- `shortcut` 可选，非空、≤32 字符。
- `order` 可选整数。

- [ ] **Step 1: 写失败测试**

```ts
test("menuItems: accepts a valid menu declaration", () => {
  const result = validateClientDescriptor({
    ...validDescriptor(),
    ui: {
      panels: [{ id: "main", title: "Main", viewAction: "getPanel" }],
      menuItems: [{
        id: "copy-md",
        surface: "message",
        label: "Copy markdown",
        action: "getPanel",
        icon: "file",
        order: 10,
      }],
    },
  })
  assert.equal(result.ok, true)
})

test("menuItems: rejects unknown surface, cross-package action and bad icon", () => {
  for (const item of [
    { id: "x", surface: "unknown", label: "X", action: "getPanel" },
    { id: "x", surface: "message", label: "X", action: "other:action" },
    { id: "x", surface: "message", label: "X", action: "getPanel", icon: "nope" },
  ]) {
    const r = validateClientDescriptor({ ...validDescriptor(), ui: { menuItems: [item] } })
    assert.equal(r.ok, false)
  }
})
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npm run test:plugin-contract`
Expected: FAIL — `ui.menuItems` unknown slot

- [ ] **Step 3: 实现类型、limit、校验**

- [ ] **Step 4: 跑测试确认通过**

Run: `npm run test:plugin-contract`
Expected: PASS（42 tests）

- [ ] **Step 5: 提交**

```bash
git add packages/plugin-contract/src/types.ts packages/plugin-contract/src/limits.ts packages/plugin-contract/src/validate.ts packages/plugin-contract/src/validate.test.ts
git commit -m "feat(plugin-contract): add declarative menu items"
```

---

## Task 4.2：Desktop menu contribution registry

**Files:**
- Create: `packages/desktop/src/renderer/mafw/context-menu/contributions.ts`
- Create: `packages/desktop/src/renderer/mafw/context-menu/contributions.test.ts`
- Modify: `packages/desktop/src/renderer/mafw/context-menu/controller.ts`
- Create: `packages/desktop/src/renderer/mafw/context-menu/controller-contributions.test.ts`
- Modify: `packages/desktop/src/renderer/mafw/context-menu/types.ts`

Port S2 spike（commit `a2357b71`）：

- `MenuContribution` / `MenuContributionRegistry` / `menuContributions`
- `register()` 校验 id/label/danger/重复/每 surface 上限
- `merge()` 追加 `扩展` group，过 `validateMenu()`，fail-open
- `run()` 只处理 `contrib:<id>`
- `controller.ts` 支持注入 contributions，默认使用 `menuContributions`
- `types.ts` 导出 `MENU_SURFACES` 常量供 cross-pin

- [ ] **Step 1: 复制/实现失败测试**

直接使用 spike 的 `contributions.test.ts` 与 `controller-contributions.test.ts`；把 import 从 `bun:test` 改为现有 desktop 测试风格（当前仓库已验证 `bun:test` shim 可用，保持即可）。

- [ ] **Step 2: 跑测试确认失败**

Run: `cd packages/desktop && node --conditions=browser --import tsx --import ../../packages/test-shim/register.mjs --test src/renderer/mafw/context-menu/contributions.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: 实现 registry + controller 注入**

- [ ] **Step 4: 跑测试确认通过**

Run: 同上 + `controller-contributions.test.ts`
Expected: PASS（11 tests）

- [ ] **Step 5: 提交**

```bash
git add packages/desktop/src/renderer/mafw/context-menu/contributions.ts packages/desktop/src/renderer/mafw/context-menu/contributions.test.ts packages/desktop/src/renderer/mafw/context-menu/controller.ts packages/desktop/src/renderer/mafw/context-menu/controller-contributions.test.ts packages/desktop/src/renderer/mafw/context-menu/types.ts
git commit -m "feat(desktop): add context menu contribution slot"
```

---

## Task 4.3：plugin descriptor → menu contributions sync

**Files:**
- Create: `packages/desktop/src/renderer/mafw/plugins/plugin-menu-contributions.ts`
- Create: `packages/desktop/src/renderer/mafw/plugins/plugin-menu-contributions.test.ts`
- Create: `packages/desktop/src/renderer/mafw/plugins/PluginMenuWiring.tsx`
- Modify: `packages/desktop/src/renderer/mafw/MafwShell.tsx`

**Interfaces:**
```ts
export interface PluginMenuSyncDeps {
  descriptors: readonly PluginClientDescriptor[]
  register: (contribution: MenuContribution) => () => void
  invoke: (pkg: string, action: string, input?: unknown, sessionID?: string) => Promise<unknown>
  sessionID?: () => string | null
  onError?: (message: string) => void
}

export function applyPluginMenuDescriptors(deps: PluginMenuSyncDeps): () => void
export function PluginMenuWiring(props: { sessionID: string | null }): JSX.Element
```

语义：

- 每个 descriptor 的 `ui.menuItems` → `MenuContribution`：
  - id = `plugin:${packageName}:${item.id}`
  - surface / label / icon / shortcut / order 直接映射
  - `run` = `invoke(packageName, item.action, {}, sessionID)`；异常只 `onError`
- 只接受 `MENU_SURFACES` 中的 surface；未知 surface / 未声明 action 跳过并 `onError`。
- register 抛错（重复/超量/非法）跳过该项，不阻断其他项。
- 返回 disposer，逆序退订。
- `PluginMenuWiring` 用 `createEffect` 监听 `pluginDescriptors()`，`onCleanup` 退订；返回 `null` 或空 fragment。

- [ ] **Step 1: 写失败测试**

```ts
test("maps descriptor menu items to contributions and invokes the package action", async () => {
  const calls: unknown[][] = [];
  const registrations: MenuContribution[] = [];
  const disposers: Array<() => void> = [];
  const sync = applyPluginMenuDescriptors({
    descriptors: [descriptor({
      ui: { menuItems: [{ id: "copy", surface: "message", label: "Copy", action: "getPanel" }] },
    })],
    register: (contribution) => {
      registrations.push(contribution);
      return () => disposers.push(() => {});
    },
    invoke: async (...args) => { calls.push(args); return null; },
    sessionID: () => "s1",
  });
  expect(registrations).toHaveLength(1);
  await registrations[0].run({ surface: "message", target: {} });
  expect(calls).toEqual([["sample", "getPanel", {}, "s1"]]);
  sync();
  expect(disposers).toHaveLength(1);
});

test("skips unknown surfaces/actions and survives register errors", () => {
  const errors: string[] = [];
  const registrations: MenuContribution[] = [];
  applyPluginMenuDescriptors({
    descriptors: [descriptor({
      ui: { menuItems: [
        { id: "unknown", surface: "unknown", label: "X", action: "getPanel" },
        { id: "missing", surface: "message", label: "X", action: "missing" },
        { id: "ok", surface: "message", label: "OK", action: "getPanel" },
      ] },
    })],
    register: (contribution) => { registrations.push(contribution); return () => {}; },
    invoke: async () => null,
    onError: (message) => errors.push(message),
  });
  expect(registrations.map((item) => item.id)).toEqual(["plugin:sample:ok"]);
  expect(errors.length).toBeGreaterThanOrEqual(2);
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd packages/desktop && node --conditions=browser --import tsx --import ../../packages/test-shim/register.mjs --test src/renderer/mafw/plugins/plugin-menu-contributions.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: 实现 sync + wiring**

- [ ] **Step 4: 跑测试确认通过**

Run: 同上
Expected: PASS

- [ ] **Step 5: 提交**

```bash
git add packages/desktop/src/renderer/mafw/plugins/plugin-menu-contributions.ts packages/desktop/src/renderer/mafw/plugins/plugin-menu-contributions.test.ts packages/desktop/src/renderer/mafw/plugins/PluginMenuWiring.tsx packages/desktop/src/renderer/mafw/MafwShell.tsx
git commit -m "feat(desktop): sync plugin menu items into the shell"
```

---

## Task 4.4：S4 end-to-end proof + docs

**Files:**
- Create: `packages/desktop/src/renderer/mafw/plugins/plugin-menu-e2e.test.ts`（可选，纯逻辑）
- Modify: `docs/architecture/desktop.md`
- Modify: `docs/guides/plugin-authoring.md`
- Modify: `docs/superpowers/plans/2026-11-12-fixed-core-capability-roadmap.md`
- Create: `docs/releases/2026-11-13-capability-kernel-phase4-s4.md`

- [ ] **Step 1: 交叉 pin 测试**

```ts
import { PLUGIN_MENU_SURFACES } from "@mafw/plugin-contract"
import { MENU_SURFACES } from "../context-menu/types"
test("plugin menu surfaces are supported by desktop", () => {
  for (const surface of PLUGIN_MENU_SURFACES) {
    expect(MENU_SURFACES as readonly string[]).toContain(surface)
  }
})
```

- [ ] **Step 2: 门禁**

```bash
npm run test:plugin-contract
npm run test:desktop
cd packages/desktop && npx tsgo --noEmit -p tsconfig.json
```

Expected: plugin-contract 42/42；desktop 全量绿；typecheck 通过。

- [ ] **Step 3: 文档与交付记录**

- 更新 `docs/architecture/desktop.md`：菜单贡献槽位、action 路由、danger 暂不开放。
- 更新 `docs/guides/plugin-authoring.md`：`ui.menuItems` 示例、surface 列表、action 引用规则。
- 更新路线图 Phase 4 状态：S4 完成；composer/panel rail 仍待做。
- 交付记录包含：commit、测试数、typecheck、未做（composer、panel rail、chat part、danger、shortcut 实际键位绑定）。

- [ ] **Step 4: 提交**

```bash
git add packages/desktop/src/renderer/mafw/plugins/plugin-menu-e2e.test.ts docs/architecture/desktop.md docs/guides/plugin-authoring.md docs/superpowers/plans/2026-11-12-fixed-core-capability-roadmap.md docs/releases/2026-11-13-capability-kernel-phase4-s4.md
git commit -m "docs: record phase 4 s4 menu slot"
```

**Gate G4-S4：** 一个插件包可以贡献 menu item；点击调用同包 action；reload/remove 退订；desktop 全量绿；无原生组件注入。

---

## Task 4.5：composer action（已交付 2026-11-13）

- `plugin-contract`：`ui.composerActions`，每包最多 3 个；action 必须引用同包 action。
- desktop：`PluginComposerActions` 宿主渲染 `ButtonV2 + Icon`，点击调用同包 action；返回 `{ insertText }` 写入草稿，不自动发送。
- 交付记录：`docs/releases/2026-11-13-capability-kernel-phase4-composer.md`。

## Task 4.6：panel rail entry（已交付 2026-11-13）

- `PluginPanelDescriptor.rail = { icon, order?, badge? }`；desktop `railItemsFromPanels()` 投影到 IconRail。
- 点击复用 `openPluginFocus`，不新增打开路径。
- 交付记录：`docs/releases/2026-11-13-capability-kernel-phase4-panel-rail.md`。

## Task 4.7：chat part renderer（评估完成 2026-11-13，不实现）

**结论：** 插件包不为 chat transcript 贡献自定义 part 渲染器；保持宿主独占。

**现状：**

- 工具 part：`ui.toolCards` + `PluginToolCard` + `PluginViewRenderer` 已提供声明式卡片，pending/running 用原卡，settled 调 `viewAction`，失败回退。
- 非工具 part：`data-<name>` 由 `DataPartCard` 显示名称 + JSON；gateway 已校验名字、≤64KB、可序列化，并持久化 overlay。
- `PART_MAPPING` / `registerPartComponent` 是 renderer 内部 API；插件包不能访问，也不能注入 Solid 组件。

**未来若开槽，唯一推荐形状：** `ui.dataPartCards`（`id` + `name` + `viewAction`），desktop 用独立 controller + data-part registry 调用同包 action，复用 `PluginViewRenderer`，失败/过期/冲突回退 `DataPartCard`；不覆盖 `text`/`reasoning`/`tool`/`file`/`compaction`，不做每 part webview。

**触发条件：** 至少两个真实包（或一个第一方功能）被 JSON 视图阻塞；需要展示非工具产生的连续状态；现有 toolCards/panel/messageWindow 无法承载。

**证据与测试清单：** `docs/research/2026-11-13-chat-part-renderer-evaluation.md`。

**边界守卫：** `packages/desktop/src/renderer/mafw/plugins/plugin-chat-part-boundary.test.ts` 禁止插件模块引用 `PART_MAPPING` / `registerPartComponent`。

## Self-Review

- **Spec coverage:** contract、gateway 校验、desktop registry、action 路由、unload/revision、文档均有 task。
- **Step scan:** 每个 task 先失败测试再实现。
- **Type consistency:** `PluginMenuItemDescriptor` / `MenuContribution` / `applyPluginMenuDescriptors` 命名跨 task 一致。
- **Review Focus:** grammar、action、unload、surface、无原生注入均有测试/约束。
- **Proportion:** 计划只写接口、语义和测试断言。

## Execution Handoff

Phase 4 已收口：Task 4.1–4.4（menu）、4.5（composer）、4.6（panel rail）交付，4.7（chat part）以评估关闭。执行方式沿用 native（不使用 worktree）。下一阶段是 Phase 5（有状态能力），先写 memory store/retrieval 的详细 plan。
