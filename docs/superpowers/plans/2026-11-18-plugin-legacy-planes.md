# E16 legacy plane 声明 Implementation Plan

**Goal:** 让 `runtime` / `media` / `tts` / `usage` 四个 legacy 面也能在 `plugin.json` 里声明，并由 host 按名字/模态对齐，在 `check` 的 inventory 里可见。

**Architecture:** 契约加四个可选对象 → 归一化与 manifest 校验 → host 在 legacy 组装处比对（此处才有实际名字/模态）→ CLI 渲染 → 文档。数组面规则不变。

**Spec:** `docs/superpowers/specs/2026-11-18-plugin-legacy-planes-design.md`

## Global Constraints

- 未声明即不受约束；声明了但没注册合法。
- 名字默认值 = 包名（与 host 现状一致）。
- untrusted 包声明这四个面 → manifest 校验阶段直接拒绝（它永远无法满足）。
- 不改 legacy 贡献的运行时行为、loader 与清理。
- 只 ADD/修改各 task 列出的文件；共享 main，禁止 `git add -A`。

## Review Focus

- **未声明不得产生任何约束**（存量包零影响）。→ Task 1 + Task 2 各一例。
- **默认名字**：声明 `runtime: {}` 时，实际 `spec.name ?? packageName` 必须参与比对。→ Task 2。
- **untrusted 拒绝发生在 manifest 阶段**，不是激活期（错误要指向 `kind`）。→ Task 1。
- **CLI 不得把未声明面渲染成差异**。→ Task 2。

---

### Task 1: 契约 + manifest 校验 + schema parity

**Files:** `packages/plugin-contract/src/types.ts`、`packages/plugin-contract/src/validate.ts`、`packages/plugin-contract/src/validate.test.ts`、`gateway/src/plugins/manifest-schema.ts`、`gateway/src/plugins/package-manifest.ts`、`gateway/tests/unit/plugins/package-manifest.test.ts`、`gateway/tests/unit/plugins/manifest-schema-parity.test.ts`

**Interfaces:**
- `PluginGatewayContributes` 增加 `runtime?: { name?: string }`、`media?: { name?: string; modalities?: string[] }`、`tts?: { name?: string }`、`usage?: { name?: string }`
- `GATEWAY_CONTRIBUTES_KEYS` 增加四个键
- manifest 解析：`kind: 'untrusted'` 且声明了任一面 → `errors.push('untrusted packages cannot declare contributes.gateway.<plane>')`（逐字，plane 用实际键名）

- [ ] 测试：契约接受四键、拒绝错误形状（`runtime: "x"`、`media.modalities: "image"`）；untrusted + 任一声明 → parse 失败；schema parity 矩阵补四组（v2 合法/非法；v1 非法仍是 warning）；两个示例包不受影响。
- [ ] 实现契约 + schema + manifest 规则。
- [ ] 跑 `npm run test:plugin-contract`、`npx jest .../package-manifest.test.ts .../manifest-schema-parity.test.ts`、`tsc -p`；提交 `feat(plugin): let manifests declare the legacy contribution planes`。

### Task 2: host 对齐 + CLI inventory

**Files:** `gateway/src/plugins/package-host.ts`、`gateway/src/cli/plugin-standard-command.ts`、`gateway/tests/unit/plugins/package-check-inventory.test.ts`、`gateway/tests/unit/cli/plugin-standard-command.test.ts`

**Interfaces:**
- `PluginCheckDeclared` / `PluginCheckRegistered` 增加 `runtime?` / `tts?` / `usage?: string` 与 `media?: { name?: string; modalities: string[] }`
- 逐字错误：见 spec §2

- [ ] 测试：声明 `runtime: { name: 'r1' }` 实际 `r2` → `contribution_bound` + 逐字文案；声明 `runtime: {}` 且实际名为包名 → 通过；`media.modalities` 子集/超集各一例；未声明面 → 不产生任何错误且 CLI 不显示差异；四个面都出现在 `declared`/`registered`。
- [ ] 实现：legacy 组装处（`contribs.runtime/media/tts/usage` 分支）比对，失败抛带逐字前缀的错误，使 `classifyCheckFailure` 归入 `contribution_bound`（把新前缀加入既有的闭集）。
- [ ] CLI 渲染四个面（名字/模态），沿用现有标记规则。
- [ ] 跑定向 + `tsc -p`；提交 `feat(plugin): enforce legacy plane declarations and show them in check`。

### Task 3: 文档 + 收尾

**Files:** `docs/guides/plugin-standard.md`、`docs/architecture/plugin.md`、`docs/releases/2026-11-18-plugin-legacy-planes.md`（新）、`gateway/package.json`（`4.18.0` → `4.19.0`）

- [ ] 规范 §2 字段表补四个面；新增「§4.6 legacy plane 声明」小节，给 JSON 片段、默认名规则、逐字错误、untrusted 不可声明；§8 的 inventory 字段表补四项。
- [ ] 架构现状段补一句。
- [ ] 发布记录：commit、语义表、新增用例数、全量门禁数字、已知边界（弱约束：只查名字/模态）。
- [ ] 全量门禁 + 记录。
