# 2026-11-18 · Mobile 隧道信任边界（M0）

- **分支**：`main`
- **提交**：`7d0c6b2d2`（relay principal）、`f2ca4ef11`（terminator）、`be7b3c7e6`（allowlist）、
  `b9905fd0a`（transport）、`618ba5a31`（WS gating）、`f712a25ec`（pairing 限流）、
  `b9304a72e`（kernel 接线）、`6aaeaa27a`（tunneled 修正）、`94cb495e9`（review 修复）
- **设计**：`docs/superpowers/specs/2026-11-18-mobile-relay-design.md` §3.1
- **计划**：`docs/superpowers/plans/2026-11-18-mobile-tunnel-trust-m0.md`

## 问题

Quick Tunnel 之前把 cloudflared 直接指向 `127.0.0.1:3000`。gateway 的
`fallbackPrincipal` 看到 loopback 就判成 `local`，于是任何拿到隧道 URL 的人都能无 token
访问普通路由；terminal WS、A2A、media、python、tools、cognition 等 loopback-only 面
也会一并放开。隧道 URL 是随机地址，但**不是认证**。

## 修复

- 新增 loopback **tunnel terminator**（默认 `127.0.0.1:3001`，`MAFW_TUNNEL_TERMINATOR_PORT` 可覆盖）。
  cloudflared 只连它；它剥离客户端伪造的 `x-mafw-tunnel`，注入进程内随机 secret。
- `resolvePrincipal` 把 marker 或 `cf-connecting-ip` 请求标记为 `tunneled`；无凭证时是 `relay`。
- `tunneled` 是传输标记，不是新的信任级别：带 device token 的隧道请求仍是 `human`，
  但同样受 method+path mobile allowlist 限制，不能访问 terminal/python/tools/A2A/media upload/cognition/admin。
- allowlist 拒绝 `.` / `..` / `%2e` / `%2f` / 反斜杠；未匹配的 tunneled 请求不会落到 runtime
  反代（封掉 `/api/mobile/../../api/pty` 这类规范化绕过）。设备列表/删除、approvals 规则、
  `goals/control`、session permission-mode/data/revert 均拒绝。
- 匿名隧道请求只允许 `GET /health` 与 `POST /api/mobile/pairing/verify`；其余 API 401。
  匿名 `/health` 只返回 `{status:"ok"}`。
- `/api/ws` 在隧道上必须带 device token；terminal/voice/plugin WS 一律 403。
  v1 共享 apiToken 的 WS 远程连接不支持（LAN/Tailscale 可用）；v2 device token 不受影响。
- `pairing-code` 的限流豁免改为 loopback 传输判断（本机 CLI 仍豁免，隧道调用受 rate limit 约束）。
- 真正的本机 loopback 请求仍然是 `local`，桌面/TUI 行为不变。
- 审查修复：raw-path allowlist 与反代规范化不一致（Critical）、过宽 prefix 授权、route 级
  `isLoopbackAddr` 残留、匿名 health 泄露项目路径、terminator 端口冲突无回退，均已修。

## 验证

- gateway 宽口径：`tests/unit/core` + `http` + `mobile` + `routes` **1179 passed / 2 skipped（145 suites）**。
- `npx tsc --noEmit -p tsconfig.json` rc=0；`npm run build` 成功。
- Quick Tunnel 真链路 smoke（隧道已停止）：
  - `GET /health` → **200**，body `{"status":"ok"}`（无项目路径）
  - `GET /api/presence`（无 token）→ **401**
  - `GET /api/terminal/sessions`（无 token）→ **403**
  - `POST /a2a`（无 token）→ **403**
  - `POST /api/mobile/../../api/pty`（device token）→ **403**
  - pairing verify → 设备 token
  - `GET /api/presence` / `GET /api/sessions` / `GET /api/sessions/s1/messages`（device token）→ **200**
  - `GET /api/terminal/sessions`（device token）→ **403**
  - `POST /api/python/execute`（device token）→ **403**
  - `GET /api/mobile/devices`（device token）→ **403**
  - `POST /api/goals/control`（device token）→ **403**
  - `POST /api/sessions/s1/permission-mode`（device token）→ **403**
  - `wss://<tunnel>/api/ws`（device token）→ `connected` 帧；无 token → **401**
- gateway 已重启，terminator 日志：`mobile tunnel terminator on 127.0.0.1:3001`。

## 范围与后续

- 这是 M0 安全前置；relay 本体（M1–M4）尚未实现。
- 文档：`docs/architecture/mobile.md` §7.16、`docs/guides/operations.md`。
- 未做：全量 `npm test`（1041 个测试文件）；真机扫码（模拟器已验 pairing/WS）。
