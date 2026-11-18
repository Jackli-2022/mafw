# 2026-11-18 · Mobile Relay M1（core）

- **分支**：`main`
- **提交**：`8be6bcbfb`（SNI）、`e4aa33e8f`（room registry）、`8b011b14a`（frames/flow）、
  `76e47a3a9`（host hub）、`661a95e06`（TLS router）、`455837b2d`（quota/server/e2e）
- **设计**：`docs/superpowers/specs/2026-11-18-mobile-relay-design.md` §7–§10
- **计划**：`docs/superpowers/plans/2026-11-18-mobile-relay-m1.md`

## 交付

新增 `packages/relay`（`@mafw/relay`），本地可运行的 relay core：

- **SNI parser**：从真实 TLS ClientHello 提取 `server_name`，支持 TCP 分片；无 SNI / 截断 / 非法握手返回 null。
- **Room registry**：`<roomId>-<routeSecret>.<domain>` 严格解析；room token / route secret 双 hash；
  host 重连替换旧连接；显式 release 才删除 claim。
- **Frames / flow**：10 字节帧头（DATA/WINDOW/CLOSE）、256KB payload 上限、stream window。
- **Host hub**：`hello` → `hello-ok`；stream open/data/close；host 替换关闭旧连接（4001）。
- **TLS router**：解析 SNI → registry/routeSecret/online 校验 → 打开 host stream → 双向 pipe；
  未知 room/错误 secret 直接关闭；ClientHello 5s/16KB 上限。
- **Server**：TLS router + control WSS + `GET /health`，支持 ephemeral ports（本地测试）。
- **Quota**：每 IP 每日 room、每 room/IP stream、每 room 每秒字节。
- **E2E**：启动本地 relay → host hello → 真实 ClientHello → host DATA → client 收到字节。

## 验证

- `npm run test -w @mafw/relay` → **25/25 pass**（9 个测试文件）。
- `npm run build -w @mafw/relay` → rc=0。
- M1 不涉及 gateway/mobile 代码；gateway 宽口径仍 **1191 passed / 2 skipped（147 suites）**。

## 限制 / 下一步

- Room claim 仅内存，重启丢失；SQLite 持久化随部署里程碑。
- 尚未接 gateway tunnel client（M2）、手机证书 pinning（M3）、腾讯云 443 部署（M4）。
- 公网使用前还需要：真实 TLS 终止端、带宽/流控接入 router、管理面认证、部署脚本。
