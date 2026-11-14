# Phase 6B Worker Host 交付记录

- 日期：2026-11-14
- 版本：5.3.0（未 bump、未发布）
- 范围：untrusted 包的 worker / child host、JSON RPC、能力代理、崩溃隔离
- 设计：`docs/superpowers/specs/2026-11-14-phase6-trust-hardening-design.md`
- 计划：`docs/superpowers/plans/2026-11-14-phase6-trust-hardening.md`

## 交付内容

### 进程隔离

- `gateway/src/plugins/worker/worker-host.ts`：`child_process.fork` 启动 worker；gateway 主进程从不 `require` untrusted 入口。
- `gateway/src/plugins/worker/worker-bootstrap.cjs`：CommonJS bootstrap，可在 Jest 与编译后的 `dist` 直接运行。
- `gateway/src/plugins/worker/node-flags.ts`：探测 `--permission` / `--experimental-permission`；两者都不可用则拒绝启动。
- 启动参数：只读包根目录与 bootstrap 目录；无写、无 child-process、无 addon、无 WASI；`--max-old-space-size=256`。
- env 只保留 `NODE_ENV` / `LANG` / `TZ`；不传 token、API key、代理变量。

### 能力面

- v1 允许：`actions`、`events`、`config.read`、`config.write`。
- 拒绝：`tools`、`observers`、`ui.web`、`terminal`、`http`、`files`、`net`、runtime 所有权。
- `ctx` 只暴露 logger / config / emit / effect；`ctx.files`、`ctx.terminal`、`ctx.http` 不存在。
- `Module._load` 拦截 `http/https/net/tls/dns/dgram/http2/child_process/worker_threads/cluster`；`fetch`/`WebSocket`/`EventSource` 抛错。

### RPC 与资源限制

- JSON-only；单条消息上限 1 MiB；未知 message / 非法结构直接丢弃。
- 并发上限 4，队列上限 64；超限返回 `worker_busy`。
- action 超时默认 10s、上限 30s；超时 SIGKILL child 并重启。
- 超大结果由 bootstrap 转为 `message_too_large`，不杀 worker。

### 生命周期

- 崩溃后按 0.5s / 1s / 2s 退避重启；5 分钟内 3 次由 `PluginSafety` quarantine。
- `PluginHost` 按 `kind` 分流：trusted / legacy 继续 in-process，untrusted 只走 worker。
- untrusted 文件 fingerprint 漂移 → `onUntrustedDrift` + quarantine，不热更新。
- worker 启动失败 / permission flag 不可用 → 拒绝 untrusted，绝不 in-process fallback。
- kill switch / deactivate 通过 RegistrationBag 的 `worker.stop()` 关闭 child。

### 构建

- `gateway/package.json` 的 build copy 增加 `src/plugins/worker → dist/plugins/worker`。
- worker bootstrap 不进入主进程 bundle。

## 验证

- gateway 全量：**7405 passed / 2 skipped / 7407 total**（940 suites，`--testTimeout=20000`）。
- gateway typecheck：`npx tsc --noEmit -p tsconfig.json` → 0。
- desktop 全量：**3868 / 3868 pass**。
- SDK：**226 / 226 pass**。
- `@mafw/plugin-contract`：**44 / 44 pass**。
- 6B 定向：
  - worker protocol 4
  - worker host 4
  - worker sandbox 4
  - worker resilience 3
  - host worker 4
  - untrusted install 1
  - worker security integration 1
  - kernel-v2 boundaries 通过（worker-host 不再 import kernel-v2）
- 备注：全量首轮出现 `kernel-v2-boundaries`（真实违规，已修）与 `discovery-heartbeat-timer`（Windows ENOTEMPTY flake，单跑通过）；修复后第二轮全量干净。

## 明确未做

- OS 级 hermetic 网络隔离（Node permission model 不覆盖 net；当前是 defense-in-depth）。
- untrusted tools / observers / files / terminal / http / web surfaces。
- 6C 的 last-known-good / 健康窗口 / 回滚演练。

## Rollback

- 删除 `PluginHostOptions.workerHostFactory` / `workerAvailable` → untrusted 回到 fail-closed 拒绝。
- `workerAvailable: false` 时安装 untrusted 返回 409。
- trusted / legacy 包完全不受影响。
- 无数据迁移；worker 是进程内生命周期，不写持久状态。

## 关键 commit

- `14a7d543` feat(plugins): add worker protocol and bootstrap
- `1776ce7d` feat(plugins): add worker host lifecycle
- `eea9e462` feat(plugins): restrict untrusted worker capabilities
- `b86e4ba1` feat(plugins): isolate worker crashes and timeouts
- `bc7bf2cc` feat(plugins): run untrusted packages in workers

## Next

6C：apiVersion / host range 兼容门、last-known-good、健康窗口、回滚演练。
