# 2026-11-18 · Mobile 远程配对 P0：Cloudflare Quick Tunnel

- **分支**：`main`
- **提交**：`c89190ffe`（gateway / CLI / 契约 / 研究稿；本文档紧随其后提交）
- **研究**：`docs/research/2026-11-18-mobile-remote-access-industry.md`
- **架构现状**：`docs/architecture/mobile.md` §7.15
- **前置**：`5852b7e5` / `49a90e60`（Mobile F/U + Editorial Ink）

## 目标

手机接入本地 gateway 不应要求用户装 Tailscale、买域名或开入站端口。
P0 用**出站隧道 + 一次性二维码**把「扫码即连」做成默认路径，Tailscale 退为可选高级项。

## 方案

- gateway 内新增 `RemoteAccessService`：spawn `cloudflared tunnel --url http://127.0.0.1:3000`，
  从日志解析随机 `https://*.trycloudflare.com`；无入站端口、无域名、无 VPN。
- `PairingService` 增加临时 base URL override：隧道起来后配对链接指向隧道，
  停止/异常退出即回落到 `MAFW_MOBILE_TAILSCALE_URL` / `mobile.tailscaleUrl` / LAN 探测。
- 新增 `GET/POST /api/mobile/remote-access`（status / start / stop），**全部 human-only**；
  与 `pairing-code` 同样禁止 service/local 调用，避免把「暴露到公网」开放给内部会话。
- `mafw pair --remote` 起隧道并打印 `orcalore://pair?...`；`mafw pair` 生成 QR PNG
  （`~/.mafw/pair-qr.png`，Windows 代码页下终端二维码会乱码，故用图片）；`--status` / `--stop` 管理。
- 配对协议保持 v2：隧道 URL 不是认证，仍靠 5 分钟单次 nonce 换设备 token。
- Mobile 文案从「仅 Tailscale/私网」改为「安全隧道/反向代理」；HTTPS 公网 URL 本来就放行，
  策略不放宽明文 http。

## 变更文件

- gateway：`src/mobile/remote-access.ts`（新）、`src/mobile/pairing.ts`、`src/routes/devices-mobile.ts`、
  `src/routes/route-catalog.ts`、`src/routes/schemas/devices.ts`、`src/subsystems/api-routes.ts`、
  `src/kernel.ts`
- CLI：`bin/mafw.js`（`pair` 命令、human token 头、QR PNG）
- 契约：`packages/gateway-sdk/{contract/gateway-paths.json,contract/openapi.json,src/api-schema.gen.ts}`
  （300 paths / 335 operations）
- mobile：`lib/src/pages/{pairing_page,connection_settings_page}.dart`、`test/pairing_link_test.dart`
- 文档：`docs/architecture/mobile.md`、`docs/guides/operations.md`、本文件、研究稿
- 依赖：新增 `qrcode@^1.5.4`；移除未落地的 `qrcode-terminal`

## 验证

- gateway 定向：`remote-access` + `pairing-v2` + `devices-mobile-wiring` **25/25**。
- gateway `npx tsc --noEmit -p tsconfig.json` 无错误；SDK `tsc --noEmit` 无错误。
- mobile：`pairing_page_test` **45/45**、`pairing_link_test` **13/13**（含 Quick Tunnel HTTPS 用例）、
  `flutter analyze` **0**。
- 真机链路 smoke（隧道已停止，URL/nonce 失效）：
  - `mafw pair --remote` → `https://email-wesley-dylan-leu.trycloudflare.com`
  - `GET /health` **200**
  - `POST /api/mobile/pairing/verify` → `dev_...` 设备 token
  - `GET /api/mobile/devices`（Bearer 设备 token）**200**
  - `mafw pair --stop` → 隧道关闭（Cloudflare 返回 **530**），`--status` 回到 disabled
- gateway 宽口径：`tests/unit/mobile` + `tests/unit/routes` + `tests/unit/architecture` **894/894（104 suites）**。`npm test` 全量含 1041 个测试文件，本轮未整跑。

## 限制与后续

- Quick Tunnel 为 P0 验证路径：随机 URL、重启即变、无 SSE、200 in-flight 上限、无 uptime 保证；
  MAFW mobile 走 WS，不受 SSE 限制。
- 生产路径：named tunnel + Cloudflare Access，或自建 relay；服务接口已按 provider 形状隔离，
  替换时不动 pairing v2 / 路由契约。
- 后续可加 Desktop/App 内「远程访问」开关与剩余时间提示；当前以 CLI 为主入口。
