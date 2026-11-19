# 2026-11-19 · Mobile Relay M2（gateway client）

- **分支**：`main`
- **提交**：`70cdf62bf`（identity）、`d961d6b13`（pairing）、`01c7076b5`（TLS terminator）、
  `e272a0e2c`（tunnel client）、`57dc0aa10`（service + kernel 接线）
- **设计**：`docs/superpowers/specs/2026-11-18-mobile-relay-design.md` §7–§9
- **计划**：`docs/superpowers/plans/2026-11-19-mobile-relay-m2.md`

## 交付

- **Relay identity**：`~/.mafw/mobile/relay/room.json` + `tls.key` / `tls.crt`（0600）；
  roomId/routeSecret 为 26 字符 base32；自签证书 SAN = Room host；损坏的 room.json 不会重新生成。
- **Pairing**：`PairingService.setRelayEndpoint({url,fingerprint})` 在链接中追加 `relayUrl` + `fp`；
  未配置时链接与旧版完全一致。
- **TLS terminator**：`createTunnelTerminator({tls})` 使用 `https.createServer`，仍注入 M0 marker。
- **Relay tunnel client**：出站 WSS hello/hello-ok；`open` 接本地 terminator；DATA/CLOSE 双向桥；
  断线指数退避重连；stop 清理本地 socket。
- **Relay service**：identity + TLS terminator + client 组合；`status()` 返回 connected/roomUrl/fingerprint。
- **Kernel**：`mobile.relay.{enabled,url,roomDomain,localPort}`，默认关闭；启用时把 room 写进 pairing
  endpoint；shutdown 停止 client/terminator。

## 验证

- 定向：identity 2、pairing 8、TLS terminator 8、tunnel client 1、relay service 2 → **21/21 pass**。
- 宽口径：`tests/unit/mobile` + `http` + `routes` → **926/926 pass（111 suites）**。
- `npx tsc --noEmit -p tsconfig.json` rc=0。
- 未做：完整的 M1 relay + M2 真链路 TLS e2e（当前用 fake relay + 直连 terminator 验证）；
  手机端消费 `relayUrl/fp` 是 M3；腾讯云部署/持久化是 M4。

## 配置示例

```yaml
mobile:
  relay:
    enabled: true
    url: wss://relay.example.com:8444
    roomDomain: relay.example.com
    localPort: 3002
```

启用后 `mafw pair` 的链接会带 `relayUrl` 与 `fp`；当前手机 App 会忽略这两个新参数。
