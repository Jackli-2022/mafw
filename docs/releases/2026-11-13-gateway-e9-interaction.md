# Gateway E9 交互补齐交付记录（2026-11-13）

- 版本：gateway 4.16.1 / desktop 5.1.0 / SDK 5.1.0（无版本号变更；mobile 1.1.0+2 不变）

## 波次

- 分支：`feat/gateway-e9-interaction-completion`（worktree `.superpowers/e9-worktree`），基线 `510a4801`
  （main，E9 spec/plan 落库时点）
- 范围：E9-1 mobile 工作 tab 事件保真 + E9-2 attention decision 投影
  + E9-3 `pod.updated` 记录级 payload（**won't do**）+ E9-4 收口
- spec：`docs/superpowers/specs/2026-11-13-gateway-e9-interaction-completion-design.md`
- plan：`docs/superpowers/plans/2026-11-13-gateway-e9-interaction.md`
- 架构现状：`docs/architecture/gateway.md` §「E9 交互补齐」、
  `docs/architecture/desktop.md` §「Attention decision 投影与决定板去重（E9-2）」、
  `docs/architecture/mobile.md` §7.10
- TDD：每项先写失败测试 → 最小实现 → 一个 commit；批证据见
  `.superpowers/sdd/2026-11-13-gateway-e9-interaction/{progress.md,batch1-report.md,batch2-report.md}`

## 提交

| commit | 任务 | 一句话 |
|---|---|---|
| `54dc2d0c` | E9-1 | `pod.updated` / `pod.event` / `run.updated` 按 dual-shape 解析并进入 work-refresh 表；`goalId` / `podId` 同时读 `properties` 与 `data` |
| `23401274` | E9-2 | `AttentionKind` 加 `decision`（priority 85）；draft decision 投影进 `/api/attention`（仅带 `goalId`）；SDK/契约同步，桌面映射 record action + 决定板去重 |
| E9-3 | E9-3 | **won't do**：不引入 `pod.updated` 记录级实体 payload（无 commit；决策与理由见下） |
| E9-4（本记录） | E9-4 | 架构现状 + 本记录 + 全量门禁 + ledger（docs-only） |

## 交付项

- **E9-1 mobile 工作 tab 事件保真**：`pod.updated` / `pod.event` / `run.updated` 是 gateway 顶层
  flat 广播（名字同时是 canonical 词汇），mobile 此前按未知帧丢弃（`data` 置空、`shouldRefreshWork`
  不命中）。
  - `mobile/lib/src/models/mafw_models.dart` 新增 `kMafwDualShapeEventTypes`（恰好这三个名字）并
    spread 进 `kMafwFlatEventTypes`：flat 帧保留 `properties` 到 `data`，canonical 信封仍解内层；
  - `event_effects.dart` 的 `kWorkRefreshFlatEventTypes` 纳入同三项 → flat 帧触发 work overview 刷新；
  - `MafwEvent.goalId` / `podId` 改走 `_payloadString`：先 `properties.*`，回退 flat 顶层 `data.*`；
    `pod.updated {properties.goalId}` 因此命中 `WorkRefreshBus` 的按 Goal 局部 patch（只改该 Goal 卡，
    不发布不相关的新 Goal），无 `goalId` 时保持整页快照；
  - `WorkTab` / `WorkRefreshBus` 零代码改动；`vocabulary_parity_test.dart` 钉住「`events.ts` 有序
    前缀 + 恰好这三个 dual-shape 尾巴」，TS 契约零改动。
- **E9-2 attention decision 投影**：
  - `gateway/src/core/lead/attention.ts`：`AttentionKind` 新增 `'decision'`（`PRIORITY.decision = 85`，
    介于 `direction_review` 90 与 `answer` 80）；`DecisionAttentionInput` /
    `decisionAttentionInput(record)`（仅 `status === 'draft'` **且** `goalId` 非空；title =
    `record.question`，detail = `rationale ?? consequences`）/ `appendDecisionAttention(items, records)`
    （id 与 coalesceKey = `decision:<recordId>`，action `{type:'open_decision', goalId, itemId}`）；
    排序抽成共享 `sortAttention`，Goal-stage 输出逐字不变；
  - `routes/attention.ts`：`AttentionRouteDeps.decisions?(projectDir)` 在 reviews 之后追加；
    `subsystems/api-routes.ts` 注入 `decisionRecords.list(projectDir)` 且 **fail-open**（读失败 →
    `[]`，decision 是侧信道，不能拖垮 attention）；
  - `read-models.ts#AttentionKindSchema` + SDK `AttentionKind` + 生成契约
    （`gateway-paths.json` / `openapi.json` / `api-schema.gen.ts`）同步，`contract-compat.checks.ts`
    的编译期等值断言继续成立；
  - 桌面 `focus/decision-model.ts`：`decision` → `kind:'other'`（不按 action 反推 record kind）、
    `decisionActionForAttention` → `{kind:'record', recordId:item.action.itemId}`（缺 itemId →
    `{kind:'none'}`）、`buildDecisionBoard` 按 attention 的 `open_decision.itemId` 去重 records。
  - **goal-less draft 有意不进 attention**：`AttentionItem.goalId` 是 string，无法表达无 Goal 的记录；
    它们仍只在桌面决定板出现。已 `decided` / `shelved` 的 record 属已结算，永不投影。
- **E9-3 `pod.updated` 记录级 payload（won't do）**：维持 `{podId, kind}` 级刷新。不引入完整
  PodDetail / 实体 payload 的理由：
  1. **事件体积**：`pod.updated` 在 member / task / message 高频路径广播，整实体 payload 会让每条
     事件从几十字节膨胀到 Pod 全量视图；
  2. **一致性**：事件快照与 REST 权威读之间需要额外版本/合并语义，kind 级刷新直接回 REST 拿权威值，
     没有「旧事件覆盖新状态」风险；
  3. **已足够**：`kind:'review'` 已 bump `reviewRevision`，`goalId` 在 goal/revision/result 事件上已有，
     消费侧需要时可按 Goal 收敛；E9-1 修复后 mobile 也能消费这些 flat 帧。未来若要增量 payload，
     应从「按 kind 的窄 payload」出发，而不是整实体。

## 行为变化 / Breaking

1. **`/api/attention` 新增 `kind:'decision'` item（additive）**：只带 `goalId` 的 draft decision 会
   出现在 person-first 列表（`action.type:'open_decision'`，`itemId` = record id）。对 `AttentionKind`
   做穷尽 switch 的客户端需处理新值（SDK 类型已加）；桌面映射到 `other`。goal-less draft 行为不变。
2. **`attention.list` OpenAPI schema 的 kind 枚举扩展**：`AttentionKindSchema` 加 `'decision'`，
   生成产物（`gateway-paths.json` / `openapi.json` / `api-schema.gen.ts`）有 diff；wire 只新增合法值。
3. **mobile 工作 tab 多一点刷新**：flat `pod.updated` / `pod.event` / `run.updated` 现在会触发
   debounce 的 work overview 拉取（有 `goalId` 时只 patch 对应 Goal）。纯消费侧，无协议变化。
4. **无 `pod.updated` wire 变化**：E9-3 won't do，`{podId, kind}` 维持原样。

## 验证（worktree @ E9-4）

| 门 | 命令 | 结果 |
|---|---|---|
| gateway 类型 | `node node_modules/typescript/bin/tsc --noEmit -p tsconfig.json`（`gateway/`，gateway-local TS 5.9.3） | **1 error**：`src/boot.ts(446,10) TS2339 Property 'bindPluginAutomation' does not exist on type 'BootKernel'`——基线 `510a4801` 即存在（`1ff02a82` 给 `kernel.ts` 实现加了方法但没同步 `boot.ts` 的 `BootKernel` 接口；E9 两个 commit 未触碰这两个文件，`git diff 510a4801..HEAD -- gateway/src` 只有 attention 四个文件） |
| gateway 全量 | `node ../node_modules/jest/bin/jest.js --runInBand --forceExit --no-coverage`（`gateway/`） | **7133 tests：7122 passed / 9 failed / 2 skipped**；**909 suites：905 passed / 3 failed / 1 skipped**。9 条 = 恰好 3 个基线 env-red suite（`plugin-package-e2e` 4、`claude-adapter-acceptance` 4、`claude-adapter-coverage` 1），**零 E9 红** |
| SDK 类型 | `node ../../node_modules/typescript/bin/tsc --noEmit -p tsconfig.json`（`packages/gateway-sdk`） | **0 errors** |
| SDK 全量 | `node --import tsx --require ../../packages/test-shim/require-hook.cjs --test "src/*.test.ts"` | **224 / 224 passed** |
| SDK contract | 同上 `--test src/contract.test.ts` | **4 / 4 passed，0 dead ops，0 exemptions** |
| desktop 全量 | `npm run test:desktop`（worktree root） | **3800 tests：3799 passed / 1 failed**；**728 suites**。唯一红 = `src/main/mafw-gateway-resolver.test.ts` dev-path（worktree 未构建 `gateway/dist`，与 E5b/E6/E7/E8 同红） |
| desktop 类型 | `node ../../node_modules/@typescript/native-preview/bin/tsgo.js --noEmit -p tsconfig.json` | 既有 `node:tls` 噪声 2 条；另 2 条 `decision-model.ts` 的 `'decision'` 不可比较——**worktree 的 `node_modules` 是 main 的 junction，`@mafw/sdk` 解析到 main 的旧 `dist`（无 `decision`）**。用临时 `paths: { "@mafw/sdk": ["../../packages/gateway-sdk/src/index.ts"] }` 复跑：**只剩 `node:tls` 2 条**，E9 无类型红（临时 tsconfig 已删除，未入库） |
| mobile 定向（E9） | `flutter test test/event_envelope_test.dart test/event_effects_test.dart test/vocabulary_parity_test.dart test/work_tab_test.dart` | **71 / 71 passed**（64 → 71） |
| mobile analyzer | `dart analyze lib test` | **No issues found**（0） |
| mobile 全量 | `flutter test --concurrency=1` | **563 passed + 4 `did not complete`**（`tab_shell_test.dart` 的 widget worker 在 00:48 崩掉，`Connection closed before test suite loaded` 同类 flake，合计 567 = 基线全量）；`tab_shell_test.dart` 单跑 **7 / 7**。首跑更早 flake 在 `theme_tokens_test.dart`（479 passed 后中断），同一台机器并发/负载问题，与 E9 无关 |
| TUI | `npm run test:tui` | **env-red**：`@earendil-works/pi-tui` 未安装（`ERR_MODULE_NOT_FOUND`，主 checkout 同）；本波零 TUI 改动 |
| kernel-split 守卫 | jest `tests/unit/architecture/kernel-split-guards.test.ts` | **7 / 7 passed** |
| 契约产物新鲜度 | `npm run emit:openapi`（316 routes → 282 paths / 316 operations）+ `node scripts/merge-contract.mjs`（SDK 目录；overrides 命中 18） | **内容无 diff**（工作区仅 docs 变更） |

## 新增测试（对基线 `510a4801` 的增量）

| 面 | 新增 | 依据 |
|---|---|---|
| gateway | **+10** | `tests/unit/attention.test.ts` 8（draft 投影 / decided·shelved 排除 / 同 id coalesce 去重 / 既有 attention 不动 / priority 落在 direction_review 与 answer 之间 / detail 回退链 / goal-less 排除 / `decisionAttentionInput` 映射与拒绝）+ `tests/unit/routes/attention-route.test.ts` 2（reviews 之后追加、goal-less 不投影） |
| desktop | **+5** | `focus/decision-model.test.ts`：decision → record action、缺 `itemId` → none、draft 不重复、decided 仍在、goal 过滤 |
| mobile | **+7** | `event_envelope_test.dart`（flat 三类型保 payload、goalId properties→data 回退链、dual-shape 必须 canonical）+ `event_effects_test.dart`（flat 三类型刷新）+ `work_tab_test.dart`（flat `pod.updated` 局部 patch、无 goalId 整页快照、flat `run.updated` refetch）+ `vocabulary_parity_test.dart` 尾巴断言 |
| SDK | 0（编译期） | `contract-compat.checks.ts` 的 `Resp<attention.list> ≡ AttentionList` 继续钉住新 kind；无新增运行时 case（仍 224） |

> 计数口径：可执行 test case 数，不是断言数。

## 已知红（非本波代码问题）

1. **gateway 类型 1 条基线红**：`boot.ts` 的 `BootKernel` 接口缺 `bindPluginAutomation`
   （`1ff02a82` 只改了 `kernel.ts` 实现）。基线 `510a4801` 同错，E9 未触碰；按「E9 不修产品代码」
   留给后续波次。
2. **gateway env-red**：`integration/plugin-package-e2e`（4）、`claude-adapter-acceptance`（4）、
   `claude-adapter-coverage`（1）——esbuild 解析不到 `@anthropic-ai/claude-agent-sdk` /
   `@mafw/plugin-contract` staging 在未预构建 checkout 下失败；与基线同集合。
3. **desktop 1 条环境红**：worktree 未构建 `gateway/dist` → `mafw-gateway-resolver` dev-path 拿到
   `null`；`gateway npm run build` 后即全绿。
4. **desktop 类型**：`node:tls` 2 条既有噪声；stale-SDK-dist 2 条已用 source-path 复跑证明为环境
   （见上表）。
5. **TUI env-red**：`@earendil-works/pi-tui` 未安装，主 checkout 同；本波零 TUI 改动。
6. **mobile 全量 flake**：Windows `flutter test --concurrency=1` 仍可能在加载/运行某个 widget 套件时
   报 `Connection closed before test suite loaded`，随后 runner 把该文件剩余用例标
   `did not complete`。本次两跑分别命中 `theme_tokens_test.dart`（479 passed 后）与
   `tab_shell_test.dart`（563 passed + 4 did not complete；单跑 7/7）；与 E9 无关。

## Deferred（E9 后仍保留）

- 剩余约 296 个 op 的 response schema 覆盖（316 operations 中 20 个已带 200 schema）。
- OS keychain / 进程签名、MCP human 工具。
- 强制版本协商 / SDK 全量 schema 类型化。
- 插件 / manager 会话的配额副作用（内部会话失败只 log）。
- `session.get` 对不存在会话仍返回 **200 + error body**（kernel registry 的 200-not-404 miss 语义）。
- **won't do**：`pod.updated` 记录级实体 payload；mobile 工作 tab 的其余增量渲染（E9-1 后 flat 帧
  已能触发 `goalId` 局部 patch）。
- gateway 基线类型红：`boot.ts#BootKernel` 缺 `bindPluginAutomation`。
