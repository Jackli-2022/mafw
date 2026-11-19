# 2026-11-19 · Mobile Relay M3（手机端双端点 + pinning）

- **分支**：`main`
- **提交**：`5b0b4ec86`（pairing link）、`e8ce53c3b`（config/store）、`c0f77c181`（pinned transport）
- **设计**：`docs/superpowers/specs/2026-11-18-mobile-relay-design.md` §7.3 / §8.3
- **前置**：M1 relay core、M2 gateway client

## 交付

- **配对链接**：可选 `relayUrl` + `fp`；只出现一个或 fingerprint 非 64 hex / relay URL 非 https
  即 malformed；无 relay 字段的旧链接保持原行为。
- **配置持久化**：`ConnectionConfig` 增加 `relayUrl` / `fingerprint` / `hasRelay` / `usingRelay` /
  `copyWith`；`SecureConfigStore` 用 SharedPreferences 存 URL/relay/fp（token 仍走 secure storage）。
- **LAN 优先**：`resolveActiveConnection` 启动时 probe LAN `/health`（1.5s）；200 保持 LAN，
  否则切到 relay。每次 `_applyConfig` 重新解析。
- **证书 pinning**：relay 路径的 HTTP 用 `HttpClient.badCertificateCallback` 校验
  `SHA-256(cert.der) == fp`；WS 用同一个 raw `HttpClient` 通过 `IOWebSocketChannel.connect(customClient:)`。
- **配对回退**：LAN redeem 传输失败且链接带 relay 时，用 relay + pinning 再试一次；
  gateway 已响应（PairingException）不重试。
- **Pairing page/flow**：`redeemPairing` 接收 relay 字段并写入 config；页面从 link 透传。

## 验证

- mobile 定向：pairing_link **16/16**、connection_relay **2/2**、secure_config **7/7**、
  gateway_transport **3/3**、pairing_page **45/45** → **73/73**。
- `flutter analyze` **0**。
- 未做：真机 relay TLS pinning 冒烟（需手机 + 实际 relay 域名）；媒体/语音远程路径仍不保证；
  LAN 恢复后不会自动从 relay 切回（下次 `_applyConfig` 才重新 probe）。

## 下一步

M4：腾讯云 443（备案后）、SQLite room claim、部署/监控；或真机验收 M3。
