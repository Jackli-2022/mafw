# Phase 6：信任与运维硬化设计（6A / 6B / 6C）

- 日期：2026-11-14
- 状态：draft（待评审）
- 范围：fixed-core capability roadmap 的 Phase 6 全部三个阶段
- 前置文档：
  - `docs/superpowers/plans/2026-11-12-fixed-core-capability-roadmap.md`（Phase 6 / Gate G6）
  - `docs/superpowers/specs/2026-11-12-fixed-core-capability-architecture-design.md`（§2 威胁模型、§4 信任层级、§6.3 回滚演练）
  - `docs/architecture/plugin.md`
- 本文只定义设计与验收，不包含任务拆解；任务顺序、TDD 步骤和提交粒度在后续 plan 中给出。

---

## 0. 一句话

把“可替换”从“功能正确”推进到“故障与对抗下仍然可控”：**可安装、可体检、可熔断、可隔离、可回退、可审计**；不可信代码永不进入 gateway 主进程。

---

## 1. 背景与现状

### 1.1 两个插件世界

| 世界 | 代码位置 | 是否 live | 当前信任模型 |
|---|---|---|---|
| 统一插件包 | `gateway/src/plugins/*`、`~/.mafw/plugins/*` | ✅ 是 | 全部在 gateway 主进程内，等价 trusted |
| kernel-v2 capability provider | `gateway/src/kernel-v2/*` | ❌ 否，并行 shadow | manifest 有 `kind/permissions/integrity`，`untrusted` fail-closed 拒绝 |
| Desktop web surface | `packages/desktop/src/main/plugin-web-session.ts` | ✅ 是 | sandboxed `<webview>` + 独立 partition + ticket，不拿 apiToken |

Phase 6 的**主战场是 live 的统一插件包**；kernel-v2 的 trust 契约作为共享模型，worker host 设计为两者可复用，但 v2 在 Phase 1.5 cutover 前不接 live。

### 1.2 已经存在的积木

| 能力 | 文件 | 现状 / 缺口 |
|---|---|---|
| trust tier 契约 | `gateway/src/kernel-v2/manifest.ts` | `core/trusted/untrusted`、`permissions`、`integrity`、`apiVersion`、`planes` 有 shape 校验；**未接入 live 插件包** |
| 版本兼容 | `gateway/src/kernel-v2/capability-version.ts` | `isCapabilityCompatible` / `allowsCapabilityCoexistence`；**未接入安装/激活** |
| 生命周期 | `gateway/src/kernel-v2/provider-lifecycle.ts` | timeout、fail-soft、LIFO dispose、untrusted 拒绝、`safeMode` 计算结果；**live boot 未使用** |
| 诊断 | `gateway/src/kernel-v2/diagnostics.ts` | 有 `lastKnownGood` 字段；**只是数据形状，无回退逻辑** |
| 子进程账本 | `gateway/src/kernel-v2/subprocess-ledger.ts` | `provider` / `external` 所有权、LIFO stop；Phase 2 ASR 在用 |
| 包指纹 | `gateway/src/plugins/package-fingerprint.ts` | 内容 hash，仅用于“是否需要重新激活”；**不是完整性校验** |
| 包管理 | `gateway/src/plugins/package-manager.ts` | install / enable / disable / remove / reload / checkPath；**无 consent、无审计、无 last-good** |
| 包状态 | `gateway/src/plugins/package-state-store.ts` | 只有 `disabled[]`；**无 safeMode / quarantine** |
| 包宿主 | `gateway/src/plugins/package-host.ts` | 候选失败保留上一个 committed revision（内存级）；**不是磁盘版本回退** |
| runtime 插件体检 | `gateway/src/runtime/plugin-check.ts`、`gateway/src/runtime/plugin-audit.ts` | 事件映射 / capability / preset / sample events；**不是统一插件包 doctor** |
| web 沙箱 | `packages/desktop/src/main/browser-session.ts`、`plugin-web-session.ts`、`gateway/src/plugins/plugin-web-ticket.ts` | 已具备，不在本 Phase 重做 |

### 1.3 当前包 manifest 的真实形状

`gateway/src/plugins/package-host.ts` 只读取：

```ts
interface PackageManifest {
  name: string;
  version?: string;
  main?: string;
}
```

也就是说：**没有 `kind`、没有 `permissions`、没有 `apiVersion`、没有 `integrity`**。  
`installFromPath` 只做“绝对路径 → 读 name/version → 复制 → 激活”，没有权限展示、完整性校验和安装审计。

### 1.4 本文必须保持不变的不变量

- 人类验收、审批 / 权限 / 审计的 human-only 边界。
- memory soft supersede / T1 / 100ms recall / pinned / sticky。
- runtime 四条不变量（flat history、未知事件 fail-closed、缺失能力中性 503、`SessionCreateOpts.directory` 必填绝对路径）。
- Goal / Pod 状态机、`planHash` / `evalHash`、review 逐 task + 逐条件。
- Desktop 右主工作台 + chat 指挥列；插件 UI 仍走声明式槽位或 sandboxed web surface。
- 数据根固定 `~/.mafw`；统一数据层 `~/.mafw/memory/gateway.db`。

---

## 2. 目标 / 非目标 / 反目标

### 2.1 目标

1. 每个已安装包都有明确的 trust tier、声明的权限、内容指纹和安装审计。
2. 安装是**知情同意**：权限可见、显式接受、完整性可校验。
3. 运维可以立即停掉全部非核心扩展（kill switch）、持久保持 safe mode、隔离单个包，并看到原因。
4. 一次失败的更新永远不比更新前更糟：自动回退到 last-known-good。
5. 不可信代码只在 worker 中执行；默认无 fs / net / terminal / http / tools / observers；崩溃不拖垮 gateway，永不静默回退到 in-process。
6. doctor 用人能看懂的 pass/warn/fail 说明问题和修复方式；兼容门处理 `apiVersion` / host range / deprecation。
7. 以上全部不改变 1.4 的不变量。

### 2.2 非目标

- 不做 marketplace、签名 / PKI / supply-chain attestation。
- 不做 OS 级沙箱（container / VM / AppContainer / seccomp）。
- 不整体重写 v1 `MafwScheduler`，不引入 Cordis。
- 不替换 SolidJS / Electron / SQLite / Monaco。
- 不把 memory 做成 provider，不改 memory 逻辑或分区。
- 不在本 Phase 做 kernel-v2 的 live cutover（Phase 1.5 仍是独立门）。
- 6B v1 不支持 untrusted 的 tools / observers / terminal / files / http / web surface。
- 不代理人类验收、review 解决、风险接受。

### 2.3 反目标（即使“能跑”也算失败）

- worker 启动失败时把 untrusted 包悄悄放回主进程。
- kill switch 需要重启才生效，或重启后自动失效。
- doctor 为了体检而激活 quarantine / safe mode 中的包，或激活 untrusted 包。
- 回滚覆盖用户数据、包配置或 memory schema。
- 审计里出现 token、API key、环境变量或文件内容。
- safe mode 下核心 gateway / memory / Goal / Pod 被一起关掉。

---

## 3. 信任模型

### 3.1 层级

| tier | 执行位置 | 强制手段 | 本 Phase 结论 |
|---|---|---|---|
| `core` | gateway 主进程 | 第一方 allowlist + 构建期检查 | 不变 |
| `trusted` | gateway 主进程 | 显式安装同意 + manifest 权限声明 + fingerprint + 审计 + kill switch | **不是沙箱**；用户必须知道这是本机代码执行 |
| `untrusted` | worker / child process | 进程隔离 + Node permission model + RPC 能力代理 + 资源上限 + 崩溃隔离 | 6B 才允许安装；6A 继续 fail-closed |

### 3.2 威胁模型（在 §2 威胁表上的落地）

| 场景 | Phase 6 处理 | 明确不做 |
|---|---|---|
| buggy trusted plugin | 激活失败隔离；连续失败自动 quarantine；diagnostics | 不保证它不写坏文件 |
| malicious installed package | 知情安装 + 权限展示 + fingerprint/integrity + 审计 + kill switch | **不沙箱 trusted**；本机用户装了什么就是信任了什么 |
| supply-chain compromise | 内容指纹 + manifest 声明 integrity；不匹配即拒绝 / quarantine | 不验签、不查证书、不做来源证明 |
| remote unauthenticated | 沿用现有 auth；webview 仍拿不到 apiToken | 不改 auth 模型 |
| untrusted third-party | 只在 worker；无 fs/net/terminal/http/tools/observers；崩溃隔离 | 不做 OS 级 hermetic 隔离 |

### 3.3 安装同意

- `trusted` 安装 = 接受“该包可在 gateway 主进程内执行任意 Node 代码”。UI/CLI 必须原样展示这句话。
- `untrusted` 安装 = 接受“该包在受限 worker 中执行，能力仅限声明的 actions/events/config”。
- 6A 阶段 `untrusted` 安装返回 `409 untrusted_requires_worker`，不复制、不落盘。
- 重新安装 / 覆盖安装同样需要同意，不因为“已装过”而跳过。

---

## 4. Phase 6A：信任面硬化

### 4.1 统一包 manifest v2

`plugin.json` 增加**增量字段**，不改变现有 `name/version/main` 的解析：

```json
{
  "name": "example",
  "version": "1.2.0",
  "main": "index.js",
  "apiVersion": 2,
  "kind": "trusted",
  "permissions": ["actions", "events", "config.read"],
  "host": ">=5.1.0 <6.0.0",
  "integrity": {
    "algorithm": "sha256",
    "files": { "index.js": "sha256-..." }
  },
  "deprecated": "Use example-next; this package will be removed in 8.0."
}
```

规则：

1. **缺省 `apiVersion` = 1**：按 legacy 处理，`kind` 视为 `trusted`，仍可 in-process；不做权限强制，doctor 给 warn。
2. `apiVersion: 2`：启用 `kind` / `permissions` / `host` / `integrity`。
3. 宿主支持 `apiVersion` 集合为 `[1, 2]`；`3+` 的包**只跳过该包**，记录 `unsupported_api_version`，不进入 safe mode。
4. `kind` 缺省 `trusted`；`untrusted` 必须 `apiVersion >= 2`，且 6A 拒绝安装、6B 仅 worker。
5. `permissions` 是字符串数组；v2 未知 token 直接判 manifest 错误（该包跳过），不做“忽略未知权限”。
6. `host` 是受限 semver 范围；缺省 `*`。语法只支持比较符组合：`>= > <= < =` + 空格连接，例如 `>=5.1.0 <6.0.0`。非法范围 = manifest 错误。
7. `integrity` 可选；存在时必须覆盖 `main` 和所有被 `require` 的包内文件（实现上以包根目录文件清单为准）。算法只支持 `sha256`。
8. `deprecated` 可选；只产生 doctor warn + 审计，不阻止加载。
9. `main` 必须位于包根目录内（保留现有 `assertContained` 语义）。
10. 所有新增字段对 v1 包透明：现有 `docs/examples/plugins/*`、`.mafw/plugin-drafts/*` 不改也能装、能跑。

**共享解析器**：新增 `gateway/src/plugins/package-manifest.ts`，提供 `parsePackageManifest(raw)` → `{ ok, manifest, errors, warnings }`。`package-manager`、`package-host`、doctor 共用同一份解析，禁止三处各写一套。

### 4.2 权限 token

6A 定义 token 词表；6B 才执行 untrusted 的能力裁剪：

| token | 含义 | trusted | untrusted 6B |
|---|---|---|---|
| `actions` | 声明 / 调用包 action | ✅ | ✅ |
| `events` | 声明 / 发送 `plugin:<pkg>:*` 事件 | ✅ | ✅ |
| `config.read` | `ctx.config.get` | ✅ | ✅ |
| `config.write` | `ctx.config.update` | ✅ | ✅ |
| `files.read:<glob>` | `ctx.files` 读 | ✅ | ❌ 6B v1 |
| `files.write:<glob>` | `ctx.files` 写 | ✅ | ❌ 6B v1 |
| `net.fetch:<origin>` | `ctx` 网络出口 | ✅ | ❌ 6B v1 |
| `terminal` | `ctx.terminal` | ✅ | ❌ 6B v1 |
| `http` | `ctx.http.route` / `ws` | ✅ | ❌ 6B v1 |
| `tools` | 注册 agent tool | ✅ | ❌ 6B v1 |
| `observers` | 注册 event observer | ✅ | ❌ 6B v1 |
| `ui.web` | 声明 web surface | ✅ | ❌ 6B v1 |

v1 包没有 `permissions` 字段时：视为 `["*legacy*"]`，doctor 标 warn，不阻止运行。

### 4.3 状态存储 v2

文件仍是 `~/.mafw/plugin-package-state.json`，版本从 1 升到 2：

```json
{
  "version": 2,
  "disabled": ["pkg-a"],
  "safeMode": false,
  "quarantined": [
    {
      "name": "pkg-b",
      "reason": "integrity mismatch: index.js",
      "at": "2026-11-14T08:00:00.000Z",
      "version": "1.0.0",
      "fingerprint": "sha256:..."
    }
  ],
  "installed": {
    "pkg-a": {
      "version": "1.0.0",
      "fingerprint": "sha256:...",
      "files": { "index.js": "sha256-..." },
      "installedAt": "2026-11-14T07:30:00.000Z",
      "consecutiveFailures": 0,
      "lastFailureAt": null,
      "degraded": null,
      "lastKnownGood": {
        "version": "0.9.0",
        "fingerprint": "sha256:...",
        "savedAt": "2026-11-14T07:00:00.000Z"
      },
      "pendingHealthCheck": null
    }
  }
}
```

规则：

1. 读 v1 文件：`disabled` 保留，`safeMode=false`，`quarantined=[]`，`installed` 从磁盘重新计算；写回 v2。
2. 文件缺失 = 全新安装，`safeMode=false`。
3. 文件存在但损坏 / 不可解析 = **安全优先**：`safeMode=true`，`quarantined=[]`，`disabled=[]`，写日志并（在 DB 可用时）记审计。  
   这与当前“损坏就 fail-open 空文档”的行为不同；safe mode 是安全关键状态，不能因为坏文件被清掉。
4. `disabled` 与 `quarantined` 独立：disable 是用户意图，quarantine 是系统保护；解除 quarantine 不自动 enable。
5. `installed` 是完整性基线：
   - **trusted**：磁盘内容变化视为开发热更新，fingerprint 漂移只记 warn + 审计，不阻断；成功激活后更新基线。
   - **untrusted**：任何 fingerprint 漂移都视为篡改，直接 quarantine，不激活。
   - manifest 显式声明 `integrity` 时：所有 tier 都严格校验，不匹配即拒绝激活。
6. **失败计数**：`consecutiveFailures` 只由真实激活 / apply / worker 崩溃累加；成功激活、重新安装、版本变化（fingerprint 变化）都重置为 0。doctor 的 dry-run 使用 `probe: true`，**不读也不写**该计数。
7. **健康检查标记**：成功提交新版本时写 `pendingHealthCheck = { version, fingerprint, startedAt }`；健康窗口通过后清空并把该版本提升为 `lastKnownGood`。进程在窗口内退出时标记仍在，**下次 boot 在激活该包前先按 §6.2 回滚**，避免坏版本造成 boot loop。
8. **degraded**：自动回滚后写 `degraded = { reason, at, version }`；下一次成功激活或重新安装时清空。`degraded` 不阻止启动，但 `plugins.list` / doctor 必须显示原因。
9. **legacy 单文件包**（`~/.mafw/plugins/<name>.js`）：没有 `plugin.json`，用合成 manifest `{ name: <basename>, version: '0.0.0', main: <file> }` 作为 v1/trusted 处理；doctor 给 `legacy-single-file` warn；不支持 last-good 与 untrusted。kill switch / disable / quarantine 仍对它们生效。
10. 并发写：沿用现有“串行化 + 临时文件 + rename”原子写；新增字段不改变写入方式。
11. 降级说明：旧版本读 v2 文件只会取 `disabled`，不会理解 `safeMode/quarantined`；发布说明必须写明“降级到 5.2 之前需要先 `plugins resume` 并删除 quarantine 项，或接受隔离失效的风险”。

### 4.4 安装同意与完整性

`POST /api/plugins/packages/install` 请求体增量字段：

```json
{
  "path": "C:/work/my-plugin",
  "overwrite": false,
  "accept": {
    "trust": "trusted",
    "permissions": ["actions", "events", "config.read"]
  }
}
```

行为：

1. **同意权**：`apiVersion: 2` 的安装 / 覆盖必须由 human / device principal 发起；service / local / agent 返回 `403 human_principal_required`，不复制、不落盘。v1 包沿用现有 auth（MCP / plugin-creator 不受影响）。
2. 解析 manifest；v2 包必须提供 `accept.trust`，且与 manifest `kind` 一致。
3. `accept.permissions` 必须与 manifest `permissions` **逐项相等**（排序后比较）；缺失 / 多 / 少都返回 `400 permission_consent_required`，响应体回显声明的权限清单。
4. v1 包（无 `apiVersion` / 无 `permissions`）允许省略 `accept`，保持现有 MCP / plugin-creator 工作流可用。
5. `kind: untrusted` 在 6A 一律 `409 untrusted_requires_worker`，不复制、不写状态。
6. 复制完成后：
   - 计算指纹与文件 hash 清单；
   - 若 manifest 声明 `integrity`，逐文件校验；失败 = 删除刚复制的目录、写审计、返回 `422 integrity_mismatch`；
   - 成功后把 `installed` 基线和 `fingerprint` 写入状态 v2。
7. 覆盖安装：
   - 6A 只要求同意；
   - 6C 在覆盖前把当前健康版本快照到 `.last-good/<name>/`。
8. 安装 / 覆盖失败必须回滚文件系统：不留下半装状态，不改变旧的已安装版本。
9. **quarantined 包的重装**：
   - `trusted` / `v1` 包：允许带 consent 覆盖安装；新副本通过 manifest / integrity 校验后**清除 quarantine**，再走正常激活；激活失败会重新 quarantine。
   - `untrusted` 包：不允许用安装绕过隔离；必须先由 human principal 调用 `POST /api/plugins/:name/unquarantine`，再安装。
10. **safe mode 下的安装**：允许复制和校验，但不激活；`plugins.list` 显示 `safe-mode`。resume 后按正常流程激活。
11. **API 守卫**：quarantined 包上的 `enable` / `apply` / `reload` / `rollback` 返回 `409 plugin_quarantined`；safe mode 下的 `enable` / `apply` 返回 `409 safe_mode_active`；`doctor` 始终可读，但不在 quarantine / safe mode 下执行 dry-run 激活。

### 4.5 审计

新增表（`gateway/src/memory/gateway-db.ts` 初始化，增量 migration）：

```sql
CREATE TABLE IF NOT EXISTS plugin_audit_events (
  id TEXT PRIMARY KEY,
  at TEXT NOT NULL,
  action TEXT NOT NULL,
  package TEXT,
  version TEXT,
  fingerprint TEXT,
  principal_kind TEXT,
  principal_method TEXT,
  session_id TEXT,
  result TEXT NOT NULL,
  detail_json TEXT
);
CREATE INDEX IF NOT EXISTS idx_plugin_audit_package_at
  ON plugin_audit_events(package, at);
```

动作枚举：

`install`、`install.rejected`、`enable`、`disable`、`remove`、`reload`、`apply`、`activate.failed`、`quarantine`、`unquarantine`、`safe-mode.on`、`safe-mode.off`、`rollback`、`doctor`。

字段规则：

- `principal_kind/method`：来自当前请求的 `Principal`；CLI / MCP / 桌面都记录。
- `detail_json` 只允许白名单键：`reason`、`permissions`、`consent`、`apiVersion`、`kind`、`host`、`previousVersion`、`restoredVersion`、`doctorSummary`。
- **禁止**写入 token、API key、环境变量、文件内容、完整路径中的用户目录（可存包名 / 相对路径）。
- 写失败：fail-soft，写 `mawf.log`；doctor 报告 `audit: degraded`；安装本身不回滚（可用性优先），但响应带 `audit: 'degraded'`。
- 读接口：`GET /api/plugins/audit?package=<name>&limit=<n>`，默认 100，最大 500。
- 保留：按 `at` 保留最近 90 天且最多 5000 条，追加时批量清理。

新增 `gateway/src/plugins/plugin-audit-store.ts`，只依赖 `GatewayDb`，不反向依赖 `PackageManager`。

### 4.6 Plugin doctor

新增 `gateway/src/plugins/plugin-doctor.ts`，输出：

```ts
interface PluginDoctorCheck {
  id: string;
  status: 'pass' | 'warn' | 'fail';
  message: string;
  fix?: string;
}

interface PluginDoctorReport {
  name: string;
  version?: string;
  apiVersion: number;
  kind: 'trusted' | 'untrusted' | 'unknown';
  fingerprint?: string;
  ok: boolean;
  checks: PluginDoctorCheck[];
  generatedAt: string;
}
```

检查项（顺序固定）：

1. `manifest`：`plugin.json` 存在、JSON 合法、`name/version/main` 完整。
2. `api-version`：`apiVersion` 在宿主支持集合内。
3. `host-range`：`host` 范围与当前 gateway 版本兼容。
4. `entry`：`main` 存在且位于包根目录内。
5. `permissions`：token 可解析；tier 允许；v1 包给 `legacy-permissions` warn。
6. `integrity`：manifest 声明校验；trusted 漂移 warn；untrusted 漂移 fail。
7. `state`：disabled / quarantined / safeMode。
8. `collision`：同名包、runtime 所有权冲突、重复事件类型。
9. `activation`：dry-run `checkPath`（激活后立即 dispose）；仅在前面没有 fail、且不是 quarantined / safeMode / untrusted-without-worker 时执行。
10. `last-error`：上一次激活错误 / pending revision。
11. `deprecation`：`deprecated` 字段。
12. `contract-skew`：`@mafw/plugin-contract` 版本与 gateway 期望版本不一致时 warn。

接口：

- `POST /api/plugins/:name/doctor` → 单包报告。
- `POST /api/plugins/doctor` → 全部已安装包（数组）。
- 两个接口都不修改状态；不激活 quarantined / safeMode 包。
- 写审计 `doctor`，`detail_json.doctorSummary` 只记 `{ ok, failures, warnings }`。

CLI：

- `mafw plugins doctor [name] [--json]`
- 无 `name` 时输出表格；`--json` 输出原始报告数组。

### 4.7 Kill switch / quarantine / safe mode

#### safe mode

- 语义：**所有非 core 的统一插件包都不激活**；gateway、memory、runtime、Goal/Pod、认证、HTTP 正常。
- 持久化：`plugin-package-state.json.safeMode`。
- 启动：`PackageHost` 扫描元数据但不激活；`plugins.list` 显示 `state: 'safe-mode'`；doctor 可只读检查，不 dry-run 激活。
- 一次性覆盖：`mafw start --safe-mode` / `MAFW_SAFE_MODE=1` 只对本次 boot 生效，不写状态文件。
- 清除：`POST /api/plugins/resume`。

#### kill switch

- `POST /api/plugins/kill`：
  - 设置 `safeMode=true` 并持久化；
  - 立即 dispose 所有已激活包（含 worker）；
  - 写审计 `safe-mode.on`；
  - 返回 `{ safeMode: true, stopped: [...] }`。
- `POST /api/plugins/resume`：
  - 设置 `safeMode=false`；
  - 重新扫描并激活未被 disabled / quarantined 的包；
  - 写审计 `safe-mode.off`；
  - quarantined 包保持隔离。
- 权限不对称：
  - **kill / quarantine 允许任何已认证 principal**（安全方向，fail-closed；CLI / agent 也能紧急止损）。
  - **resume / unquarantine 必须 human / device principal**（`human_principal_required`），防止 agent 自行恢复不可信代码。
- 持久性：kill 后重启仍为 safe mode，必须显式 resume。
- **范围**：只停统一插件包（gateway plane，含 worker）。不停 MCP server、runtime adapter、automation engine、Goal/Pod、memory、HTTP。
- **runtime 所有权**：如果被停的包拥有当前 active runtime，gateway 回退到配置的默认 runtime（沿用现有 runtime switch 编排）；没有可用 runtime 时保持运行，相关能力返回中性 503，不崩溃。
- **已发出的连接**：停止包时撤销该包的 web ticket、关闭其 SSE / WebSocket / HTTP 路由；已进入队列的 action 直接失败为 `plugin_stopped`，不重试。

#### quarantine

- 触发：
  1. untrusted 包 fingerprint 漂移；
  2. manifest 声明 integrity 校验失败；
  3. 同一版本连续 3 次激活失败；
  4. worker 在 5 分钟内崩溃 3 次（6B）；
  5. 手动 `POST /api/plugins/:name/quarantine`，body `{ reason }`。
- 效果：dispose、禁止激活、doctor 只读检查、`plugins.list` 显示 `quarantined` + reason + at。
- 自动 quarantine 写审计 `quarantine`，`detail_json.reason` 必填。
- 解除：`POST /api/plugins/:name/unquarantine`（human-only），清状态、写审计、重新扫描。
- quarantine 不删除包文件，不修改包配置。

#### 状态优先级与 DTO

优先级：`safeMode > quarantined > disabled > degraded > enabled`

`GET /api/plugins` 的每项增加一个明确的 `state`（与现有 `status` / `enabled` 并存，不替换）：

```ts
type PluginLifecycleState =
  | 'active'
  | 'pending'
  | 'error'
  | 'disabled'
  | 'quarantined'
  | 'safe-mode'
  | 'degraded';
```

- `safe-mode` 时所有包都显示 `safe-mode`，同时保留 `quarantined` / `disabled` 布尔字段和 reason，避免信息丢失。
- `degraded` 是“已回滚、仍可用、但需要人看”的状态；不阻止启动，成功激活 / 重装后清除。
- `error` 是激活失败但未达 quarantine 的状态；连续失败计数到 3 才转 `quarantined`。
- safe mode 下手动 enable 不生效，返回 `409 safe_mode_active`。
- quarantined 下 enable 不生效，返回 `409 plugin_quarantined` + reason。

### 4.8 API / DTO 增量

| 路由 | 方法 | 权限 | 说明 |
|---|---|---|---|
| `/api/plugins` | GET | 现有 auth | 每项增加 `apiVersion`、`kind`、`trust`、`transport`、`permissions`、`state`、`quarantinedReason` |
| `/api/plugins/packages/install` | POST | v1: 现有 auth；v2: human / device | 增加 `accept`；v2 由 service/agent 调用返回 403 |
| `/api/plugins/:name/doctor` | POST | 现有 auth | 单包报告 |
| `/api/plugins/doctor` | POST | 现有 auth | 全部报告 |
| `/api/plugins/kill` | POST | 任意已认证 | 进 safe mode |
| `/api/plugins/resume` | POST | human / device | 退出 safe mode |
| `/api/plugins/:name/quarantine` | POST | 任意已认证 | 手动隔离 |
| `/api/plugins/:name/unquarantine` | POST | human / device | 解除隔离 |
| `/api/plugins/audit` | GET | 现有 auth | 审计查询 |

所有响应保持中性：不出现 runtime 名、capability flag 名以外的内部实现细节；错误码稳定：

- `permission_consent_required`
- `untrusted_requires_worker`
- `integrity_mismatch`
- `unsupported_api_version`
- `host_range_incompatible`
- `plugin_quarantined`
- `safe_mode_active`
- `human_principal_required`
- `worker_unavailable`
- `plugin_stopped`

**CLI 凭据**：`mafw plugins install`（v2）、`resume`、`unquarantine`、`rollback` 读取 `MAFW_HUMAN_TOKEN` 或 `~/.mafw/human.token`；缺失时打印明确提示并以非零退出，不回退到 `server.apiToken`。

### 4.9 6A 验收

- `plugin.json` v1 包全部照常安装 / 启动 / 热更新；现有 gateway 全量测试不回归。
- v2 trusted 包安装必须由 human / device principal 发起，且带 consent；service/agent 返回 403；缺 consent 返回 400；permissions 不一致返回 400。
- `untrusted` 在 6A 返回 409，且不落盘。
- integrity 不匹配的安装被拒绝，旧版本不受影响。
- 磁盘上篡改 trusted 包只产生 warn + 审计，不阻断（开发热更新）。
- 审计表可查，字段不含 secret；DB 写失败不阻断安装。
- doctor 对 12 项检查给出 pass/warn/fail；quarantined / safeMode 下不 dry-run 激活。
- kill switch 立即停止所有包，重启后仍 safe mode；resume 需要 human principal。
- 连续 3 次激活失败自动 quarantine；手动解除需要 human principal。
- state 文件损坏 → safe mode（fail-closed），gateway 正常启动。
- `mafw plugins` CLI 可用；`--json` 输出稳定。
- gateway / desktop / SDK 全量测试通过，gateway typecheck 0。

---

## 5. Phase 6B：worker / child host

### 5.1 范围

- 执行 `kind: untrusted` 的 **gateway-plane** 统一插件包。
- v1 允许的贡献：`actions`、`events`、`config.read`、`config.write`。
- v1 拒绝的贡献：`tools`、`observers`、`ui.web`、`terminal`、`http`、`files`、`net`、runtime 所有权、`process` 级能力。
- trusted 包继续 in-process，不迁移、不改变行为。
- kernel-v2 的 `untrusted` provider 在 Phase 1.5 之前继续 fail-closed；worker host 的接口设计为可复用，但不在本 Phase 接 v2 live。

### 5.2 进程模型

- `child_process.fork` 启动 `gateway/src/plugins/worker/worker-bootstrap.cjs`。
- `stdio: ['ignore', 'pipe', 'pipe', 'ipc']`；stdout/stderr 以 `[plugin:<name>]` 前缀限速写入 `mawf.log`。
- `env` 只保留 `NODE_ENV`、`LANG`、`TZ`；不传 `MAFW_*`、token、API key、代理变量。
- `cwd` = 包根目录。
- Node 权限参数（启动时探测）：
  - 优先 `--permission`，回退 `--experimental-permission`；
  - `--allow-fs-read=<packageRoot>`（bootstrap 自身通过 `NODE_OPTIONS` 或绝对路径预加载，单独放行）；
  - 不传 `--allow-fs-write`、`--allow-child-process`、`--allow-worker`、`--allow-addons`、`--allow-wasi`；
  - 两个 flag 都不可用 → **拒绝启动 untrusted 包**（quarantine / `worker_unavailable`），绝不降级为 in-process。
- `--max-old-space-size=256`；worker 内禁止 `process.exit` 以外的主动退出（主动退出按崩溃处理）。
- 复用 `SubprocessLedger` 记录 `ownership: 'provider'`，kill switch / dispose 统一 stop。

### 5.3 RPC 协议

JSON-only，禁止 advanced serialization；单条消息上限 1 MiB。

```ts
// host -> child
{ t: 'invoke', id: string, action: string, input: unknown, timeoutMs: number }
{ t: 'shutdown' }

// child -> host
{ t: 'ready', name: string, version: string, apiVersion: number, contributions: {...} }
{ t: 'result', id: string, ok: true, output: unknown }
{ t: 'result', id: string, ok: false, error: { message: string, code?: string } }
{ t: 'emit', type: string, payload: unknown }
{ t: 'log', level: 'debug'|'info'|'warn'|'error', message: string }
{ t: 'config.get', id: string }
{ t: 'config.update', id: string, patch: unknown }
```

规则：

- host 只接受已知 `t`；未知消息直接丢弃并记 warn，不崩溃。
- `invoke` 的 `action` 必须在 worker `ready` 时声明的 action 集合内；未声明 = 拒绝。
- `emit` 的 `type` 必须是 `plugin:<pkg>:<event>` 且在该包声明的 event 集合内；host 侧 `PluginEventRegistry` 仍做二次校验。
- `config.update` 只允许 `config.write` 权限；patch 走现有 `assertSafePatch`。
- 请求 / 响应 ID 必须匹配；超时 / 未知 ID 丢弃。
- 并发上限 4；超过排队；队列上限 64，满则拒绝新调用（`worker_busy`）。
- 单次 action 超时：manifest `timeoutMs`，缺省 10s，上限 30s；超时 = kill child + 记失败。
- 消息大小超限 = 拒绝该条 + 记失败；多次超限 → quarantine。

### 5.4 Worker ctx（能力代理）

worker 内的 `activate(ctx)` 收到一个**只有白名单方法**的 ctx：

| 方法 | 行为 |
|---|---|
| `ctx.logger.debug/info/warn/error` | RPC `log`，限速 |
| `ctx.config.get()` | RPC `config.get` |
| `ctx.config.update(patch)` | RPC `config.update`（需 `config.write`） |
| `ctx.emit(type, payload)` | RPC `emit`（需 `events` + 已声明类型） |
| `ctx.effect(fn)` | 本地执行；child 退出时统一清理 |
| `ctx.name` / `ctx.version` | 来自 manifest |

其余方法（`files`、`terminal`、`http`、`getApiKey`、`usageStats`、任何 runtime 句柄）**不存在**，访问即 `TypeError: not available in untrusted worker`。

worker 启动前：

- 拦截 `Module._load`：`http`、`https`、`net`、`tls`、`dns`、`dgram`、`http2`、`child_process`、`worker_threads`、`cluster` 直接抛错。
- `globalThis.fetch`、`WebSocket`、`EventSource` 替换为抛错 stub。
- `process.env` 已被 host 清空；`process.exit` 保留（按崩溃处理）。
- 禁止 native addon（permission model 的 `--allow-addons` 不开启）。

> 这些是 **defense-in-depth**，不是 hermetic sandbox。Node permission model 不覆盖网络；确定的攻击者仍可能通过 Node/V8 漏洞逃逸。6B 的 G6 验收见 §7。

### 5.5 生命周期与故障

- `activate`：
  1. host 校验 manifest / tier / permissions；
  2. 启动 child；
  3. 等 `ready`（5s 超时）；
  4. host 侧用 `buildActivatedContributions` 校验 worker 返回的声明；
  5. 注册 action / event 到现有 registry；
  6. 返回 `transport: 'worker'`、`pid`、`restarts`。
- 失败：杀掉 child、`activate.failed` 审计、抛给现有 pending 逻辑；**不**回退 in-process。
- 崩溃：
  - 非主动 `shutdown` 的 exit / `error` = crash；
  - 以 0.5s / 1s / 2s 退避重启；
  - 5 分钟内 3 次 → quarantine + 审计；
  - 崩溃期间的 action 调用返回 `worker_crashed`，不挂起。
- 停止：
  - `shutdown` → 等 2s → `SIGTERM` → 等 2s → `SIGKILL`；
  - 从 `SubprocessLedger` 移除，记录停止原因。
- 热更新：untrusted 不允许文件变化热更新；fingerprint 变化即 quarantine，等待人工 unquarantine / 重装。
- safe mode / kill switch：立即 stop 所有 worker；重启后不自动拉起。

### 5.6 6B 验收

- untrusted 包成功安装（6A 的 409 解除）并在 worker 中激活；gateway 主进程无该包模块。
- `require('fs')` 读取包外文件失败（permission model）。
- `require('child_process')`、`require('net')`、`fetch`、`WebSocket` 失败。
- 未声明的 action / event 被拒绝。
- tools / observers / ui.web 声明被 validation 拒绝，包进入 error / quarantine。
- 无限循环 / CPU 占用触发 action 超时，child 被杀，gateway 存活。
- OOM 触发 child 崩溃，gateway 存活；3 次后 quarantine。
- worker 启动失败 / flag 不可用 → 拒绝 untrusted，绝不 in-process。
- kill switch 停止 worker；重启后不拉起。
- 现有 trusted 包行为与测试零回归。

---

## 6. Phase 6C：兼容门、last-known-good 与演练

### 6.1 兼容门

- 宿主常量：`SUPPORTED_PLUGIN_API_VERSIONS = [1, 2]`，定义在 `gateway/src/plugins/package-manifest.ts`。
- `apiVersion` 不在集合内：跳过该包，`plugins.list` 显示 `unsupported-api-version`，审计 `install.rejected` / `activate.failed`；**不**进 safe mode。
- `host` 范围：
  - 用内置的受限 semver 解析器（不新增依赖），支持 `>= > <= < =` 与空格 AND；
  - 与 **MAFW 产品版本**（仓库根 `package.json.version`，当前 5.1.0）比较；`gateway/package.json.version` 是内部子包版本，不参与兼容判断；
  - 宿主通过 `MAFW_HOST_VERSION` 暴露该值，doctor / 测试都读同一个常量；
  - 不兼容 = 跳过该包 + doctor fail + 审计 `host_range_incompatible`。
- `deprecated`：doctor warn + 每次 boot 首次激活时写一条审计 `deprecation`（或并入 `activate` 的 detail），不阻断。
- 未知 permission token（v2）：manifest 错误，跳过该包。
- contract skew：
  - `@mafw/plugin-contract` 的 npm 版本与 gateway 期望范围不一致时 doctor warn；
  - `apiVersion` 仍是唯一契约版本，npm 版本只用于诊断。
- 版本 skew 的包降级：
  - 安装低 `apiVersion` 包到高宿主：允许；
  - 安装高 `apiVersion` 包到低宿主：拒绝并给出 `unsupported_api_version`。

### 6.2 Last-known-good

#### 磁盘布局

```text
~/.mafw/plugins/
  <name>/                      # 当前版本
  .last-good/
    <name>/                    # 上一个健康版本快照
    <name>.json                # { version, fingerprint, savedAt }
```

#### 生命周期与状态机

定义两个不同的“旧版本”：

- **内存旧 revision**：`PluginHost` 当前已 committed 的 revision。候选激活失败时它继续服务（现有行为）。
- **磁盘 last-good**：上一个通过健康窗口的版本快照。它用于进程重启 / boot loop / 窗口内崩溃。

1. **安装 / 覆盖前**：如果 `<name>` 已存在且当前版本健康（已 committed、非 quarantined），把它快照到 `.last-good/<name>`（临时目录 + rename，原子替换旧快照）。此时磁盘上的 `<name>` 仍是旧版本。
2. **复制新版本**：覆盖安装把新版本写入 `<name>`；内存旧 revision 继续服务。
3. **激活失败（commit 之前）**：
   - 不发生新 revision 提交，旧 revision 继续服务；
   - **立即用 `.last-good/<name>` 恢复磁盘**，保证下次启动不会加载坏版本；
   - 写审计 `rollback`，包状态 `degraded`（reason: update failed before commit）；
   - 首次安装没有 last-good：保留包目录、标记 `error`，连续 3 次转 `quarantine`。
4. **激活成功（commit）**：写 `pendingHealthCheck = { version, fingerprint, startedAt }`，启动健康窗口（默认 5 分钟，测试可注入 `50ms`）。runtime-owning 包 / pending 包在 `applyPending` 成功时才开始窗口。
5. **健康窗口内失败**（worker 崩溃 / integrity 失败 / 运行时自检失败）：
   - 停止当前 revision；
   - 从 `.last-good/<name>` 原子恢复磁盘；
   - 重新加载旧版本，写审计 `rollback`；
   - 包状态 `degraded`，清空 `pendingHealthCheck`；
   - 恢复失败 → `quarantine`（不无限重试）。
6. **健康窗口通过**：清空 `pendingHealthCheck`，把当前版本提升为 last-good（更新快照与 metadata）。
7. **进程在窗口内退出**：`pendingHealthCheck` 仍在。**下次 boot 在激活该包之前**先检查标记：
   - 有标记 = 上次提交未被确认 → 直接恢复 `.last-good/<name>`，写审计 `rollback`，再按正常流程激活；
   - 恢复失败 → `quarantine`；
   - 这样坏版本不会造成 boot loop。
8. **pending / runtime-owning 包**：候选在 `applyPending` 之前不进入健康窗口；`applyPending` 失败沿用第 3 条（旧 revision + 磁盘恢复）。
9. **手动回退**：`POST /api/plugins/:name/rollback`（human-only）恢复到 `.last-good/<name>`，写审计 `rollback`，不改变包配置。
10. **删除包**：同时删除 `.last-good/<name>` 与 metadata。
11. 回滚**不触碰**：
    - `plugins.<name>.config`；
    - `~/.mafw/memory/gateway.db`；
    - Goal / Pod / session 数据；
    - 其他包。

#### 状态字段

`installed.<name>.lastKnownGood = { version, fingerprint, savedAt }` 与 `.last-good/<name>.json` 保持一致；doctor 检查两者是否漂移。

### 6.3 演练（drill）

新增 `scripts/plugin-trust-drill.mjs`，在临时目录中构造包 / manager / host，不写真实 `~/.mafw`，不启动完整 gateway。CI 命令：

```bash
npm run drill:plugin-trust
```

输出 `artifacts/plugin-trust-drill.json`（CI artifact），字段：

```json
{
  "startedAt": "...",
  "commit": "...",
  "node": "v24.x",
  "scenarios": [
    { "id": "update-rollback", "ok": true, "durationMs": 123, "detail": "..." }
  ],
  "ok": true
}
```

场景：

1. `update-rollback-before-commit`：装 good v1 → 覆盖为 bad v2 → 激活失败（commit 前）→ 磁盘恢复 v1、v1 继续服务、审计有 `rollback`。
2. `update-rollback-in-window`：装 good v1 → 覆盖为 v2 并 commit → 健康窗口内 worker / 自检失败 → 停止 v2、恢复 v1、状态 `degraded`。
3. `boot-loop-rollback`：v2 commit 后未确认健康窗口时模拟进程退出 → 新 manager 启动 → 先恢复 v1 再激活 → 不进入 boot loop。
4. `integrity-mismatch`：manifest 声明错误 hash → 安装拒绝 / 激活 quarantine。
5. `safe-mode-persist`：kill → 新建 manager 实例（模拟重启）→ 无包激活 → resume（human）→ 恢复。
6. `auto-quarantine`：连续 3 次激活失败 → quarantine → 不再重试；doctor dry-run 不增加计数。
7. `corrupt-state`：写入坏 JSON → 新 manager 启动 → safe mode、gateway 可用、无包激活。
8. `unsupported-api`：`apiVersion: 3` → 跳过该包、不 safe mode、审计。
9. `worker-crash-loop`（6B）：untrusted worker 崩溃 3 次 → quarantine。
10. `version-skew`：host range 不匹配 → 跳过 + doctor fail。

文档：`docs/guides/plugin-trust-drills.md`，说明如何运行、如何读报告、如何恢复 quarantine / safe mode。

### 6.4 6C 验收

- `apiVersion` / host range 不兼容只影响该包；gateway 正常启动。
- deprecated 包可加载，doctor warn。
- 更新失败自动回滚到 last-good，包配置不变，审计可查。
- 首次安装失败不自动删除包目录，进入 quarantine。
- 手动 rollback 需要 human principal。
- 10 个 drill 场景全部通过，报告落盘。
- 降级 / 重启 / 状态迁移失败都有明确行为和文档。

---

## 7. Gate G6 的验收边界

路线图 G6 原文：不可信插件无法越权访问 fs/net；崩溃爆炸半径不超过一个 worker；重启后收敛。

本设计的达成情况：

| G6 子项 | 6B 后 | 说明 |
|---|---|---|
| 不可信代码不进主进程 | ✅ | worker-only；worker 不可用则拒绝 |
| fs 越权 | ✅（有 Node permission model 时） | 只读包根目录；无写、无 addons、无 child process；flag 不可用则拒绝 |
| net 越权 | ⚠️ defense-in-depth（已确认接受） | Node permission model 不覆盖网络；通过 Module._load / global stub 拦截，非内核级；OS 级 hermetic 隔离另立专项 |
| 崩溃爆炸半径 | ✅ | child 崩溃 / OOM / 超时只影响该包；5 分钟 3 次 quarantine |
| 重启收敛 | ✅ | safe mode / quarantine / last-good 持久化；不自动拉起隔离包 |

**结论（2026-11-14 已确认）**：Phase 6 满足 G6 的进程隔离与故障隔离部分；**hermetic 网络隔离不在本 Phase**，接受 defense-in-depth。若未来把“net 完全不可越权”升级为硬条件，需要另立 OS 级沙箱（Windows AppContainer / Linux netns / macOS sandbox），单列安全专项。

---

## 8. 失败语义总表

| 情况 | 行为 | 审计 | 恢复 |
|---|---|---|---|
| manifest 非法 | 跳过该包，gateway 启动 | `activate.failed` / `install.rejected` | 修 manifest / 重装 |
| `apiVersion` 不支持 | 跳过该包 | `unsupported_api_version` | 升级包 / 降级宿主 |
| `host` 不兼容 | 跳过该包 | `host_range_incompatible` | 升级包 / 宿主 |
| v2 安装由 service / agent 发起 | 403，不复制 | `install.rejected` | 由 human / device 重新发起 |
| consent 缺失 / 不一致 | 400，不复制 | `install.rejected` | 带正确 consent 重试 |
| integrity 不匹配（安装） | 422，删除临时副本 | `install.rejected` | 修 hash / 重打包 |
| integrity 不匹配（untrusted 加载） | quarantine | `quarantine` | 重装 / unquarantine |
| 6A 安装 untrusted | 409，不落盘 | `install.rejected` | 等 6B |
| worker 不可用 | quarantine / 拒绝激活 | `quarantine` / `activate.failed` | 修 Node flag / 升级宿主 |
| worker 崩溃 | 退避重启，3 次后 quarantine | `activate.failed` / `quarantine` | 修包 / unquarantine |
| 更新激活失败 | 自动恢复 last-good | `rollback` | 修包后重装 |
| 更新回滚失败 | quarantine | `quarantine` | 手动恢复 / 重装 |
| safe mode | 所有包不激活 | `safe-mode.on` | human resume |
| 状态文件损坏 | safe mode，gateway 正常 | 无（DB 可能不可用）/ log | human resume |
| 审计 DB 写失败 | 安装继续，doctor `degraded` | log | 修 DB |
| kill switch | 立即 stop，持久化 | `safe-mode.on` | human resume |

---

## 9. 测试策略

- 每个 task 先写失败测试，再实现；禁止先实现后补测试。
- 单元测试放 `gateway/tests/unit/plugins/*`；集成测试放 `gateway/tests/integration/plugin-trust-*`。
- 所有测试使用临时目录，不写真实 `~/.mafw`；不依赖网络。
- fixture 包：
  - `good-v1`、`good-v2-trusted`、`untrusted-actions-only`；
  - `bad-manifest`、`unsupported-api`、`host-mismatch`；
  - `integrity-mismatch`、`tampered-untrusted`；
  - `crash-on-activate`、`crash-loop`、`cpu-hog`、`oom`；
  - `declares-tools`、`declares-observers`、`declares-web`。
- 安全断言必须包含“没有 in-process fallback”：测试检查 gateway 进程内 `require.cache` / 模块名 / worker pid。
- 手工冒烟：
  - 桌面插件页安装 / disable / kill / resume；
  - 重启后 safe mode 仍在；
  - doctor 报告可读；
  - quarantine 包不出现在 action / event 注册表。
- 门禁：gateway 全量、desktop 全量、SDK 全量、gateway `tsc --noEmit -p tsconfig.json`。
- 性能：worker 启动 P95 < 2s；action 调用 P95 < 50ms（空 action，本地）；kill switch < 1s 停止全部 worker。

---

## 10. 迁移、兼容与回滚

### 10.1 迁移

- 现有 v1 包无需修改：无 `apiVersion` = v1，trusted，in-process。
- `plugin-package-state.json` v1 → v2 自动读兼容；首次写入升为 v2。
- 审计表是新增表，无数据迁移。
- `.last-good/` 是新增目录，旧版本忽略。
- worker bootstrap 需要构建时复制到 `dist`（`gateway/package.json` 的 build copy 步骤增加一条）；测试直接使用 `src` 下的 `.cjs`。

### 10.2 兼容

- 路由全部增量；`GET /api/plugins` 只加字段，不改已有字段名。
- SDK / 客户端不强制升级；新字段可忽略。
- MCP `mafw_plugin_manager` 保持现有操作；6A 的 human-only 安装 / consent 只对 v2 包强制，v1 包不受影响。
- plugin-creator 草稿（无 `apiVersion`）继续可 install / check / test；如果草稿显式声明 `apiVersion: 2`，agent 只能生成 / check，最终安装需要人类在桌面或 CLI 完成。

### 10.3 回滚

- 6A / 6C 功能可通过移除调用 / 配置关闭，不涉及数据迁移。
- 6B worker 可整体禁用：untrusted 回到 fail-closed；trusted 不受影响。
- last-good 回滚失败时保留现场，不删除包目录。
- 安全状态降级风险见 §4.3 第 11 条，必须写进 release notes。

---

## 11. 实施顺序与出口条件

| 阶段 | 内容 | 出口条件 |
|---|---|---|
| 6A | manifest v2、consent、integrity、审计、doctor、kill/quarantine/safe mode | 本文 §4.9 全部通过；无安全状态时现有包零回归 |
| 6B | worker host、RPC、能力代理、崩溃隔离 | §5.6 全部通过；G6 进程隔离部分达成；v2 untrusted 仍 fail-closed |
| 6C | 兼容门、last-good、drill | §6.4 全部通过；drill 报告进 CI artifact |

每个阶段独立提交、独立写 `docs/releases/`，不一次性合入。

---

## 12. 设计取舍（已确认）

1. **信任边界优先放在 live 统一插件包**，而不是 kernel-v2 provider。  
   理由：v2 还没 cutover，先硬化 live 系统才有真实收益；worker host 接口保持可复用。
2. **Node permission model + RPC 能力代理**，不引入 OS 沙箱；接受 net 的 defense-in-depth（§7）。  
   理由：跨平台、无原生依赖；OS 级 hermetic 网络隔离另立专项。
3. **untrusted v1 只支持 actions / events / config**。  
   理由：files / terminal / http / tools / observers 的代理面太大，先验证最小闭环；后续按权限逐步开放。
4. **kill / quarantine 允许 service，resume / unquarantine 必须 human**；v2 安装本身也必须是 human / device。  
   理由：停机是安全方向；安装 / 恢复不可信代码必须人类确认。
5. **审计写 gateway.db**，不写 JSONL。  
   理由：统一数据层、可查询、可和 doctor/列表联动；失败 fail-soft。
6. **trusted 的磁盘漂移只 warn，不阻断**。  
   理由：保留插件热更新和 plugin-creator 开发体验；untrusted 严格拦截。
7. **host range 用内置受限 semver 解析器**，不新增 `semver` 依赖。  
   理由：语法面小、行为可测；避免为一个范围检查引入依赖。
8. **host range 比较 MAFW 产品版本**（根 `package.json.version`，当前 5.1.0），不比较 `gateway/package.json.version`（4.16.1，内部子包版本）。  
   理由：包作者面向的是产品发布版本；规范必须只有一个“宿主版本”。
9. **失败计数与健康检查标记持久化**（`consecutiveFailures` / `pendingHealthCheck`），doctor dry-run 不计数。  
   理由：否则重启后计数清零、坏版本 boot loop、doctor 误触发 quarantine。
10. **quarantined 包的重装规则分级**：trusted / v1 允许通过重新安装修复；untrusted 必须先 human unquarantine。  
    理由：保留 plugin-creator 开发闭环，同时不让 service 绕过不可信代码隔离。
11. **kill switch 只停统一插件包**，不停 MCP / runtime adapter / automation / 核心服务；被停包的 web ticket / SSE / WS 一并撤销。  
    理由：紧急止损必须边界清晰，不能把 gateway 核心一起停掉。
12. **legacy 单文件包按 v1/trusted 合成 manifest 处理**，doctor warn，不支持 last-good。  
    理由：不让现有安装永久 doctor fail，也不假装单文件包有目录级回滚能力。

---

## 13. 已确认决策（2026-11-14）

用户确认按推荐项执行，以下四项锁定，后续 plan 不再重新讨论：

1. **G6 net 隔离**：接受 `Node permission model + JS 级 net 拦截` 作为 defense-in-depth；OS 级 hermetic 网络隔离另立专项，不进 Phase 6。
2. **v2 安装同意权**：`apiVersion: 2` 安装 / 覆盖必须 human / device principal；v1 包、plugin-creator 草稿、MCP 现有安装流程保持现有 auth。
3. **untrusted v1 能力面**：只支持 actions / events / config；files / net / terminal / http / tools / observers / ui.web 在 6B v1 全部拒绝。
4. **kill switch 范围**：只停统一插件包（gateway plane，含 worker），不停 MCP server / runtime adapter / automation engine / 核心服务。

### 13.1 对 plan 的直接影响

- 6A 的安装路由必须区分 v1 / v2 权限；v2 的 403 不能误伤 plugin-creator（它继续产出 v1）。
- 6B 的 worker ctx 只需要实现 logger / config / emit / effect 四项；files / net broker 不排期。
- 6B 的 G6 验收按 §7 的 defense-in-depth 口径写，不把 OS 沙箱列为出口条件。
- 6A 的 kill switch 只做 `PackageManager` / `PluginHost` / `SubprocessLedger` 范围，不碰 MCP / runtime 生命周期。
