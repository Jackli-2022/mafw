# 2026-11-18 · Mobile 隧道信任边界（M0）

- **分支**：`main`
- **提交**：`7d0c6b2d2`（relay principal）、`f2ca4ef11`（terminator）、`be7b3c7e6`（allowlist）、
  `b9905fd0a`（transport）、`618ba5a31`（WS gating）、`f712a25ec`（pairing 限流）、
  `b9304a72e`（kernel 接线）、`6aaeaa27a`（tunneled 修正）
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
  但同样受 mobile allowlist 限制，不能访问 terminal/python/tools/A2A/media upload/cognition/admin。
- 匿名隧道请求只允许 `GET /health` 与 `POST /api/mobile/pairing/verify`；其余 API 401。
- `/api/ws` 在隧道上必须带 device token；terminal/voice/plugin WS 一律 403。
- `pairing-code` 的 loopback 限流豁免改为 `local` principal 判断；隧道调用受 rate limit 约束。
- 真正的本机 loopback 请求仍然是 `local`，桌面/TUI 行为不变。

## 验证

- gateway 宽口径：`tests/unit/core` + `http` + `mobile` + `routes` **1174 passed / 2 skipped（145 suites）**。
- `npx tsc --noEmit -p tsconfig.json` rc=0；`npm run build` 成功。
- Quick Tunnel 真链路 smoke（隧道已停止）：
  - `GET /health` → **200**
  - `GET /api/presence`（无 token）→ **401**
  - `GET /api/terminal/sessions`（无 token）→ **403**
  - `POST /a2a`（无 token）→ **403**
  - pairing verify → 设备 token
  - `GET /api/presence`（device token）→ **200**
  - `GET /api/terminal/sessions`（device token）→ **403**
  - `POST /api/python/execute`（device token）→ **403**
  - `wss://<tunnel>/api/ws`（device token）→ `connected` 帧；无 token → **401**
- gateway 已重启，terminator 日志：`mobile tunnel terminator on 127.0.0.1:3001`。

## 范围与后续

- 这是 M0 安全前置；relay 本体（M1–M4）尚未实现。
- 文档：`docs/architecture/mobile.md` §7.16、`docs/guides/operations.md`。
- 未做：全量 `npm test`（1041 个测试文件）；真机扫码（模拟器已验 pairing/WS）。
