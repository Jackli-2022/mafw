# Capability Kernel Phase 3.6 交付记录

- 日期：2026-11-13
- 版本：5.1.0（未 bump、未发布）
- 路线：B（kernel-v2 + 默认关闭的 live bridge）
- Spec：`docs/superpowers/specs/2026-11-12-fixed-core-capability-architecture-design.md`
- 路线图：`docs/superpowers/plans/2026-11-12-fixed-core-capability-roadmap.md`
- 详细 plan：`docs/superpowers/plans/2026-11-13-kernel-v2-plugin-host-auto-registration.md`

## 交付范围

- `gateway/src/plugins/package-types.ts`：新增 `PluginToolDeclaration`、`PluginObserverDeclaration`、`PluginToolEntry`、`PluginObserverEntry`；`UnifiedPluginContributions` 增加 `tools` / `observers`；`ActivatedContributions` 增加校验后的 tools/observers。
- `gateway/src/plugins/package-validator.ts`：tools/observers 校验与投影；拒绝坏 name、重复、session scope package tool、缺失 handler/onEvent、非法 filter/timeout；从 `legacy` 中剥离 tools/observers。
- `gateway/src/plugins/package-host.ts`：`bindKernelV2(cb)`；commit 后发布 entries（含 revision）；remove/disable/stop 发布空数组；`kinds` 记录 `tools` / `observers`。
- `gateway/src/runtime/v2-live.ts`：`syncPluginContributions(tools, observers)`；按 `package:name` / `package:id` diff；revision 变化替换 handler；消失条目退订；dispose 先退订再关闭 registry。
- `gateway/src/kernel.ts`：`bindKernelV2` 接线到 `kernelV2Live.syncPluginContributions`。
- `docs/guides/plugin-authoring.md`：新增 §5.1 Agent tools、§5.2 Canonical event observers。

## 行为说明

- 包 `activate()` 现在可以返回：
  ```js
  { tools: [...], observers: [...] }
  ```
- Tool 命名空间：`plugin:<package>:<tool>`；observer id：`plugin:<package>:<observer>`。
- 包 tool 本阶段只允许 `scope: 'global'`；`scope: 'session'` 在 candidate 校验阶段失败。需要会话区分时，handler 读 `call.sessionID`。
- 默认 flag 关闭：包仍可安装/校验，但 tools/observers 不执行。
- `MAFW_KERNEL_V2_TOOLS=1` / `MAFW_KERNEL_V2_OBSERVERS=1` 打开后，commit 即注册；reload 按新 revision 替换；remove/disable 退订。
- Handler 永远留在 gateway；client descriptor 不包含 handler 源码。
- Observer 仍是只读、post-hoc、fail-open；工具三原语在 observer 之前已被丢弃，工具事件观察 `part.updated` 的 tool part。

## 验证

- Phase 3.6 定向（plugins + live bridge + event-dispatch + mafw-tools + kernel-v2 + boundaries + G2/G3/plugin-host integration）：**531 / 531 pass**。
  - 新增测试：package-validator +2、package-host +1、v2-live +1、plugin-host integration +1 = **5**。
- gateway 全量：**7005 passed / 1 skipped / 7006 total**。
  - run 4、run 5 连续 clean。
  - run 1/3 出现 worktree/pod worktree 的 5s timeout（`goal-worktree-manager` / `pod-worktree-service`），单文件重跑均通过；与本次改动无关，属于负载下的既存时序 flake。
- `npx tsc --noEmit -p tsconfig.json`：通过。

## 明确未做

- 没有把 `plugin.json` 的静态 `contributes.gateway.tools` 与 `activate()` 返回的 tools 做交叉校验；静态声明目前只用于未来 client 诊断。
- 不支持 package 的 session-scoped tool（包在会话之前激活）。
- 没有 interceptor / veto / rewrite。
- 没有 worker 隔离；同步阻塞 observer/handler 仍可能占住事件循环（Phase 6）。
- 没有 desktop UI 槽位（Phase 4）。

## Rollback

- 禁用/删除包 → PackageHost 发布空 entries，v2-live 退订。
- 关闭 `MAFW_KERNEL_V2_TOOLS` / `MAFW_KERNEL_V2_OBSERVERS` → bridge 不执行任何注册。
- 回退本 phase 提交 → 包 tools/observers 只被校验，不进入 live 路径。
- 不需要回滚数据；本 phase 不写 live DB。

## 关键 commit

- `671701e5` docs: plan plugin host auto-registration
- `eccf829c` feat(plugins): validate tool and observer contributions
- `31c09fe4` feat(plugins): publish tool and observer entries
- `da323f15` feat(runtime): sync plugin tools and observers into live bridge
- `48bfeec2` test(plugins): prove package tools and observers auto-register

## Next

Phase 4：S4 menu item end-to-end → `desktop.ui.menuItems` → composer action → panel rail。Phase 3.6 的静态 manifest 交叉校验可在 Phase 4 之前补，但不是 UI 槽位的前置。
