# E15 plugin check 收口（4 条遗留）Implementation Plan

**Goal:** 让 `mafw plugin check` 的失败对 agent 与 CI 可编程（稳定 code）、对人有可读 delta，并让「没评估」与「没注册」不再混淆；同时把新字段补进 HTTP 契约与 SDK 类型。

**Architecture:** 失败分类在 host 单点（stage 变量 + 两个已知前缀），不逐条改 throw；CLI 只做渲染；契约/SDK 加可选字段。

**Spec:** `docs/releases/2026-11-17-plugin-standard-v1.md` §已知边界 4-7

## Global Constraints

- 新字段全部**可选**；旧调用方不受影响。
- `code` 只允许固定枚举，不允许把原始错误文本塞进去。
- 不改 `contributes` 语义、不改安装策略。
- 只 ADD/修改各 task 列出的文件；共享 main，禁止 `git add -A`。

## Review Focus

- **code 不得靠错误文案的长尾匹配**：只允许「阶段变量」与两个契约前缀（`invalid contributions:`、`worker_unavailable:`）。
- **`evaluated:false` 必须只在 `activate()` 没返回时出现**，不能让「注册了空集合」被误标。
- **delta 不得把未声明的 plane 标成差异**（未声明 = 不设上界）。

---

### Task 1: host 侧 `code` + `evaluated`

**Files:** `gateway/src/plugins/package-host.ts`；Test: `gateway/tests/unit/plugins/package-check-inventory.test.ts`

**Interfaces:**
- `PluginCheckResult.code?: 'manifest_invalid' | 'entry_missing' | 'identity_mismatch' | 'contribution_bound' | 'activation_failed' | 'worker_unavailable'`
- `PluginCheckResult.evaluated?: boolean`（成功时恒 true；失败时为 `activate()` 是否返回过）

- [ ] 测试先行：5 个失败样例各断言 code（缺 `plugin.json` → `manifest_invalid`；`main` 不存在 → `entry_missing`；导出名不符 → `identity_mismatch`；声明 `ping` 注册 `pong` → `contribution_bound`；`activate()` 抛错 → `activation_failed` 且 `evaluated:false`），外加成功样例 `evaluated:true`。
- [ ] 实现：`runCheckPackage` 里维护 `let stage`（manifest → entry → activation），catch 按 `stage` 与两个前缀映射 code；`inventory.evaluated` 在 `activate()` 返回后置 true。
- [ ] 跑测试 + `tsc -p`；提交 `feat(plugin): classify check failures and report whether activation was evaluated`。

### Task 2: CLI delta + code

**Files:** `gateway/src/cli/plugin-standard-command.ts`；Test: `gateway/tests/unit/cli/plugin-standard-command.test.ts`

**Interfaces:** 人类输出新增 `error[<code>]: …`；`declared:`/`registered:` 行内用 `+name`（注册但未声明）/ `-name`（声明但未注册）标记差集，**仅对已声明的 plane**。

- [ ] 测试先行：越界样例的 `actions [ping +pong]` 与 `error[contribution_bound]: …`；声明未注册样例的 `-ghost`；未声明 plane 不出现任何 `+`/`-`。
- [ ] 实现：渲染层比较两组集合；`--json` 原样带 `code`/`evaluated`。
- [ ] 跑测试 + `tsc -p`；提交 `feat(plugin): mark declared-vs-registered deltas and surface the failure code`。

### Task 3: 契约与 SDK

**Files:** `gateway/src/routes/plugin-write-responses.ts`（check 响应 schema）、`packages/gateway-sdk/src/types.ts`、`packages/gateway-sdk/src/client.ts`（若手写返回类型）；Test: 既有 `gateway/tests/unit/api-contract.test.ts` 不新增断言，另加 SDK 侧类型测试（若已有同类）。

- [ ] 测试先行：按该仓库既有做法断言 schema 接受带 `code`/`evaluated` 的响应。
- [ ] 实现：三个可选字段；必要时重跑 `npm run build -w @mafw/sdk` 与 openapi 生成脚本（以仓库脚本为准）。
- [ ] 跑定向测试 + `tsc -p`；提交 `feat(plugin): document check code and evaluated in the HTTP contract`。

## 收尾

- 全量门禁 + 记录新增用例数；把 E15 一段追加到 `docs/releases/2026-11-17-plugin-standard-v1.md`。
