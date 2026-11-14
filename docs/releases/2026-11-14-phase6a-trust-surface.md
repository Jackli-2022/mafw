# Phase 6A Trust Surface 交付记录

- 日期：2026-11-14
- 版本：5.2.0（未 bump、未发布）
- 范围：统一插件包 manifest v2 / 安装同意 / 完整性 / 审计 / doctor / kill switch / safe mode / quarantine
- 设计：`docs/superpowers/specs/2026-11-14-phase6-trust-hardening-design.md`
- 计划：`docs/superpowers/plans/2026-11-14-phase6-trust-hardening.md`

## 交付内容

### Manifest v2

- `gateway/src/plugins/package-manifest.ts`：纯解析器，支持 `apiVersion`、`kind`、`permissions`、`host`、`integrity`、`deprecated`。
- 无 `apiVersion` 的 legacy 包按 `apiVersion: 1` / `trusted` 处理，现有包零修改可运行。
- `untrusted` 必须 `apiVersion >= 2`；6A 仍 fail-closed，等待 6B worker。
- host range 比较 MAFW 产品版本（根 `package.json.version`，5.1.0），不是 `gateway/package.json.version`。

### 安装同意与完整性

- `apiVersion: 2` 安装必须 human / device principal；v1 包、plugin-creator 草稿、MCP 现有流程保持原 auth。
- `accept.permissions` 必须与 manifest 逐项一致，否则 `400 permission_consent_required`。
- 安装后写入 `installed` 内容指纹 + 文件 hash 基线；manifest 声明 `integrity` 时安装前严格校验，失败返回 `422 integrity_mismatch` 且不落盘。
- `untrusted` 在 6A 返回 `409 untrusted_requires_worker`。

### 状态 v2

- `~/.mafw/plugin-package-state.json` 升到 v2：`safeMode`、`quarantined`、`installed`、`consecutiveFailures`、`pendingHealthCheck`。
- 文件缺失 = 新装；文件损坏 = safe mode（fail-closed），不再是空文档。
- v1 文件自动升级，保留 `disabled`。

### 审计

- `gateway.db` 新增 `plugin_audit_events` 表。
- 记录 install / enable / disable / remove / reload / apply / activate.failed / quarantine / unquarantine / safe-mode.on/off / rollback / doctor。
- `detail_json` 只保留 allowlist：reason / permissions / consent / apiVersion / kind / host / previousVersion / restoredVersion / doctorSummary。
- 写失败 fail-soft，不阻断安装。

### Doctor

- `gateway/src/plugins/plugin-doctor.ts`：12 项检查（manifest、api-version、host-range、entry、permissions、integrity、state、collision、activation、last-error、deprecation、contract-skew）。
- quarantined / safe mode 不执行 activation dry-run。
- API：`POST /api/plugins/:name/doctor`、`POST /api/plugins/doctor`。
- CLI：`mafw plugins doctor [name] [--json]`。

### Kill switch / safe mode / quarantine

- `POST /api/plugins/kill`：任意已认证 principal；持久化 safe mode、立即 dispose 全部包、撤销 web ticket。
- `POST /api/plugins/resume`：human / device only；清 safe mode 并 reload。
- `POST /api/plugins/:name/quarantine`：任意已认证；`unquarantine` 必须 human / device。
- 连续 3 次激活失败自动 quarantine。
- kill switch 只停统一插件包，不停 MCP / runtime adapter / automation / 核心服务。

### API / CLI / Desktop

- 新增 7 条路由，`TOTAL_OPS` 318 → 325；OpenAPI / SDK 契约产物已重建。
- `mafw plugins list|doctor|install|kill|resume|quarantine|unquarantine|audit`。
- Desktop 插件页显示 safe mode banner、quarantine / degraded 状态、trust / transport 字段。

## 验证

- gateway 全量：**7384 passed / 2 skipped / 7386 total**（933 suites，`--testTimeout=20000`）。
- gateway typecheck：`npx tsc --noEmit -p tsconfig.json` → 0。
- desktop 全量：**3868 / 3868 pass**。
- SDK：**226 / 226 pass**。
- `@mafw/plugin-contract`：**44 / 44 pass**。
- 6A 集成：`gateway/tests/integration/plugin-trust-6a.test.ts` 4/4。
- 定向：manifest 6、state 10、integrity 4、manager 28、audit 3、safety 7、doctor 6、routes 6、CLI 7、web ticket 6。
- 说明：全量曾出现两次 order-dependent flake（reflection-resilience / opencode-adapter），对应并行修复 `6cd5ccad` / `91846c59` 合并后，第四次全量干净通过。

## 明确未做

- worker / child host 与 untrusted 执行（6B）。
- last-known-good、健康窗口、回滚演练（6C）。
- OS 级 hermetic 网络隔离（单独安全专项）。
- marketplace / 签名 / supply-chain attestation。

## Rollback

- 删除 `bindPluginTrust` 调用 → doctor / kill / audit 路由返回中性 503，包管理回到 6A 之前。
- `safeMode=false` + 清除 quarantine → 恢复正常加载。
- 状态文件 v2 对旧版本只暴露 `disabled`；降级到 5.2 之前需要先 resume 并清理 quarantine，发布说明需注明。
- 审计表是新增表，不参与回滚。

## 关键 commit

- `e717bd16` feat(plugins): add package manifest v2 parser
- `72a18841` feat(plugins): persist Phase 6 safety state
- `bc69c1bf` feat(plugins): add package integrity snapshots
- `4c36db61` feat(plugins): require install consent and verify integrity
- `fc4ea758` feat(plugins): add plugin audit store
- `0cad0bf3` feat(plugins): add kill switch and quarantine policy
- `6ccdc082` feat(plugins): add plugin doctor
- `274b70f6` feat(plugins): expose trust, doctor and kill routes
- `a82b1022` feat(cli): add mafw plugins commands
- `87859f68` feat(desktop): surface plugin trust and safe mode
- `13f6332a` feat(plugins): wire Phase 6A audit and contract

## Next

6B：worker / child host、RPC 能力代理、崩溃隔离与 quarantine。
