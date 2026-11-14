# Phase 6C 兼容门、last-known-good 与演练交付记录

- 日期：2026-11-14
- 版本：5.4.0（未 bump、未发布）
- 范围：apiVersion / host range / deprecation、last-known-good、健康窗口、boot 回滚、手动 rollback、10 场景 drill
- 设计：`docs/superpowers/specs/2026-11-14-phase6-trust-hardening-design.md`
- 计划：`docs/superpowers/plans/2026-11-14-phase6-trust-hardening.md`

## 交付内容

### 兼容门

- `PluginHostOptions.hostVersion`；默认 `MAFW_HOST_VERSION` / 5.1.0。
- 宿主只接受 apiVersion 1/2；3+ 只跳过该包，不进入 safe mode。
- manifest `host` range 与产品版本比较；不兼容只跳过该包。
- `deprecated` 只产生 doctor warn，不阻止加载。
- doctor 的 `contract-skew` 比较 `@mafw/plugin-contract` 版本。

### Last-known-good

- `gateway/src/plugins/package-last-good.ts`：
  - `<pluginRoot>/.last-good/<name>/` + `<name>.json`
  - 覆盖安装前快照当前健康版本
  - 默认 50 MiB 上限
  - restore 复制快照回包目录（保留快照供重复恢复）
- `PackageManager`：
  - install overwrite 前 `snapshot`
  - remove 时清理快照
  - `rollback(name)` 恢复 + reload + audit

### 健康窗口 / boot 回滚

- `PluginSafety.beginHealthCheck` 写 `pendingHealthCheck`；默认 5 分钟窗口。
- `confirmHealthCheck` 把当前版本提升为 `lastKnownGood`。
- `reconcilePendingHealthChecks` 在 boot / host.init 前运行：
  - 有 pending → restore last-good；
  - 恢复成功 → `degraded` + 清 pending；
  - 恢复失败 → quarantine。
- install / apply 成功后启动窗口；pending 包在 apply 成功后才启动。

### API / CLI

- `GET /api/plugins/:name/last-good`
- `POST /api/plugins/:name/rollback`（human / device）
- `mafw plugins rollback <name>`
- `TOTAL_OPS` 325 → 327；OpenAPI / SDK 契约重建。
- SDK `NON_SDK_EXEMPT` 增加插件管理 op，避免“无死契约”测试误判。

### 演练

- `gateway/tests/integration/plugin-trust-drill.test.ts`
- `npm run drill:plugin-trust`
- 10 场景：before-commit / in-window / boot-loop / integrity / safe-mode / auto-quarantine / corrupt-state / unsupported-api / worker-crash-loop / version-skew。
- 报告：`artifacts/plugin-trust-drill.json`。
- 指南：`docs/guides/plugin-trust-drills.md`。

## 验证

- gateway 全量：**7416 passed / 2 skipped / 7418 total**（944 suites，`--testTimeout=20000`）。
- gateway typecheck：0。
- desktop：**3868 / 3868**。
- SDK：**226 / 226**。
- plugin-contract：**44 / 44**。
- drill：10/10。
- 说明：最终全量首轮因 `plugins.lastGood` / `plugins.rollback` 未 attach handler 失败（api-contract 可达性守卫）；补 attach 后第二轮全量 944/944 干净通过。

## 明确未做

- OS 级 hermetic 网络隔离。
- 自动把 last-good 提升到远端/镜像。
- marketplace / 签名。

## Rollback

- 删除 `PackageLastGoodStore` 接线 → 手动 rollback 返回 503；install 仍可覆盖但无磁盘回退。
- `pendingHealthCheck` 是状态字段；旧版本忽略。
- 降级到 5.2 之前需 resume + 清 quarantine。

## 关键 commit

- `7a4da3fe` feat(plugins): add compatibility gate
- `f93d1f44` feat(plugins): keep last-known-good snapshots
- `2b2be2b1` feat(plugins): roll back unconfirmed updates on boot
- `a39a0a3e` feat(plugins): add rollback and trust drills
- `f9293327` style: keep root package.json on LF
