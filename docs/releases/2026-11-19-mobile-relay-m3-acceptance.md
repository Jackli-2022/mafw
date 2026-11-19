# 2026-11-19 · Mobile Relay M3 验收（本机 relay + 模拟器）

- **环境**：LAN `192.168.31.84`，本机 M1 relay（`443`/`8444`/`8080`），
  `relay.192.168.31.84.sslip.io`，gateway M2 relay，Android 模拟器 Pixel 9a（x86_64）
- **代码**：M1+M2+M3 当前 `main`（M3 提交 `5b0b4ec86` / `e8ce53c3b` / `c0f77c181`）
- **路径**：手动粘贴 `orcalore://pair?...`（模拟器相机页会卡住 Flutter 输入，
  撤相机权限后走手动入口；协议与扫码相同）

## 结果

- 配对链接含 `relayUrl` + `fp`；App 保存后 Base URL 显示：
  `https://wlrc43cxa2riz63e4zya5fmxf4-kievyifhpbbsufz4qkvbyuvsiq.relay.192.168.31.84.sslip.io`
- **WS 状态：已连接**，最后帧 `07:44:10`，事件检查器收到 `connected` 帧。
- HTTP 日志：`GET /api/sessions` **200 · 65ms**、**200 · 2034ms**（走 relay）。
- 早先的 `trycloudflare.com` 错误是切换前旧配置的缓存，随后被 relay 200 覆盖。
- relay `/metrics`：`relay_rooms_online 1`、`relay_streams_active 1`。
- Host 侧直接 TLS：`curl -k --resolve <room>:443:192.168.31.84 https://<room>/health`
  → `{"status":"ok"}`，证书指纹与 `fp` 一致。

## 说明 / 限制

- 相机扫二维码这一步没有在模拟器完成（相机页导致输入卡死）；手动粘贴同一条链接，
  验证了 pairing v2、证书 pinning、LAN→relay 回退、HTTP+WS。
- 真机扫码仍需在真实手机上补一次；relay 仍未部署到腾讯云 443（备案中）。
- 验收后已停止本机 relay、回滚 `~/.mafw/config.yaml`、删除测试 identity/DB，
  gateway 当前 `pid 12936`、`remote access disabled`。
