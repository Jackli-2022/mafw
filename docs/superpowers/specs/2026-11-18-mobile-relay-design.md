# 2026-11-18 · Mobile 自建 Relay 设计（官方托管默认 + 可自建）

- **状态**：设计稿，待评审
- **前置**：`docs/architecture/mobile.md` §7.15（Quick Tunnel P0）
- **调研**：`docs/research/2026-11-18-mobile-remote-access-industry.md` §10
- **部署目标**：腾讯云 bf1（2 核 4GiB / 5Mbps，大陆），域名 ICP 备案进行中
- **原则**：零账号、gateway 无入站端口、relay 不见明文、地址跨重启稳定、可暂停/撤销

## 1. 目标

1. 手机不在同一网络时，仍能连回自己的 gateway；地址跨 gateway/relay 重启不变，不需要重新扫码。
2. 默认零账号：用户只扫一次二维码，之后靠设备 token；不引入 MAFW 账号体系。
3. Relay 只转发密文，不能读取会话、工具输出、文件内容。
4. Gateway 和手机都只发出站连接；gateway 的 `:3000` 永不暴露公网。
5. 官方 relay 开箱即用；高级用户可用同一套程序自建，二维码里带自己的 `relayUrl`。
6. 暂停远程只断开 relay、不解除设备配对；撤销设备立即断开其连接。

## 2. 非目标（v1）

- 不做账号/组织/多租户计费。
- 不做 P2P / WebRTC / TURN；relay 是唯一远程路径。
- 不保证媒体/语音/视频的远程体验；5Mbps 下只保证文本、审批、WS 事件。
- 不做多地域容灾；官方实例单地域、单实例起步。
- 不替代 LAN 直连；同 Wi-Fi 仍走 mDNS + 局域网地址。

## 3. 决策摘要

已由用户决定：

- 自建 relay，而不是依赖 Cloudflare Quick Tunnel / 第三方隧道。
- 官方托管默认 + 可选自建。
- 官方实例部署在自有腾讯云服务器 + 自有域名。
- 大陆地域，域名备案进行中；备案完成前不切生产 443。

Builder calls（本设计的选择，评审可推翻）：

- **传输采用 blind TLS（OpenTunnel 模型）**，而不是 WSS relay + Noise/应用层加密。
- Relay 用 **TypeScript** 实现（`packages/relay`），与 gateway 共享类型；2C4G/5Mbps 下性能足够。
- 房间身份 = 持久化 `roomId` + `roomToken`；官方 relay 不做账号，靠配额/限流控制滥用。
- 证书 = gateway 自签，二维码携带 SHA-256 指纹；App 做证书 pinning。
- v1 远程只保证 HTTP + WS + 文本/审批；媒体/语音远程默认关闭。

### 3.1 M0 安全前置（必须先修）

Builder check 发现：任何经 relay/Quick Tunnel 转发到 `127.0.0.1:3000` 的请求，
都会被 `core/auth.ts` 的 `fallbackPrincipal` 判成 `local`（loopback），
从而**不需要任何 token** 就能访问普通路由；`pairing-code` 的 loopback 限流豁免、
terminal WS 的 `isLoopback` 检查、A2A/media/python/tools/cognition 等 loopback-only 面
也会一并放开。这是现有 Quick Tunnel P0 就已存在的漏洞，relay 只是放大它。

M0 必须在 relay M1 之前完成：

- 新增 principal `relay`（或 `tunnel`），与 `local` 严格区分。
- Tunnel terminator 为每个转发请求注入**进程内随机** `X-MAFW-Tunnel: <secret>`；
  该 secret 只在 gateway 内存中，不落盘；terminator 先剥离客户端自带的同名头。
- HTTP/WS 入口：marker 匹配或 `cf-connecting-ip` → 请求标记 `tunneled`；
  无凭证 → `relay` principal；无 marker 的真 loopback → `local`；公网/非 loopback → 现有 token/anonymous 路径。
- **`tunneled` 是传输标记，不是信任级别**：带 device token 的隧道请求仍是 `human`，但同样受 allowlist 限制，
  不能借 token 访问 terminal/python/tools。
- `relay` principal 走**路由 allowlist**（mobile 需要的会话/聊天/审批/事件/媒体代理等），
  默认拒绝 terminal WS、python、tools、cognition、A2A、file-history、admin、pairing-code 限流豁免等。
- 匿名隧道请求只允许 `GET /health` 与 `POST /api/mobile/pairing/verify`；其余 API 需要 device token。
- 所有 `isLoopbackAddr` 的特权判断改为 `principal.kind === 'local'`；pairing verify 的匿名豁免保持不变。
- Quick Tunnel 与 relay 共用同一个 terminator marker；两套 provider 都受 M0 保护。
- 测试：伪造/缺失 marker、tunneled human 的路由矩阵、匿名 relay 401、terminal WS 拒绝、限流豁免不生效、Quick Tunnel 回归。

## 4. 术语

| 术语 | 含义 |
|---|---|
| Host | 用户的 gateway 进程 |
| Client | Orcalore Mobile |
| Relay | 公网 relay 服务，按 room 转发字节 |
| Room | 一台 gateway 的稳定身份，`roomId` 持久化 |
| Room URL | `https://<roomId>.<relay-domain>`，手机实际访问的地址 |
| Fingerprint | gateway 自签证书的 SHA-256，二维码携带，App pinning |

## 5. 拓扑

```
Phone ── TLS(443) ──> Relay ── WSS(control) ──> Gateway
  │                     │                        │
  │  TLS 由 gateway 终止 │  只按 SNI 转发字节      │ 127.0.0.1:3000
  └── 标准 HTTPS/WSS ───┘                        └── 不监听公网
```

- Relay 有两个 listener：
  - `:443` 裸 TLS 路由：读 ClientHello 的 SNI，取 `<roomId>.<relay-domain>`，把原始字节桥接到该 room 的 host WSS。
  - `:8443` host control WSS（Caddy/自签 TLS）：gateway 出站连接、注册 room、接收 stream。
- 管理/健康检查只监听 `127.0.0.1`。
- 手机只访问 `:443`，不需要知道 control 端口。

## 6. 为什么是 blind TLS

对比三种方案：

| 方案 | App 改动 | Relay 可见内容 | 复杂度 | 结论 |
|---|---|---|---|---|
| **Blind TLS（本设计）** | 只加证书 pinning | 仅 TLS 密文/SNI | 中（SNI 解析 + 字节桥接） | ✅ |
| WSS relay + Noise/AEAD | 自定义 HTTP/WS 传输 + Noise | 仅密文 | 高（Dart/Node 双端密码学） | 备选 |
| 本地代理 + 内层 TLS | 本地代理 + TLS-over-stream | 仅密文 | 高（Dart 无现成 TLS-over-stream） | ❌ |

Blind TLS 的关键收益：手机仍然用标准 `https://` / `wss://`，现有 `GatewayClient`、媒体、WS 重连逻辑基本不动；relay 不终止 TLS，无法读明文；证书指纹在二维码里，relay 也无法冒充 gateway。

## 7. 组件

### 7.1 Relay（`packages/relay`）

- `room-registry`：roomId → host 连接、roomToken hash、创建时间、最后在线。
- `sni-router`：解析 TLS ClientHello，提取 SNI，校验 roomId 格式，查找 host。
- `stream-mux`：host WSS 上的二进制帧复用，支持多 stream（HTTP keep-alive、WS、媒体）。
- `quota`：按 IP/room 的 room 创建速率、并发 stream、带宽 token bucket。
- `admin`：`/health`、`/metrics`（loopback）。
- 持久化：SQLite 存 room claim（roomId、token hash、创建时间、最后在线），重启后 room 不丢；连接状态在内存。

### 7.2 Gateway tunnel client

- 配置启用后，gateway 启动时出站连 `wss://<relay-domain>:8443/host`。
- 注册：`roomId + roomToken + protocolVersion`；重连指数退避。
- 收到 `OPEN(streamId)` 后，连接本地 TLS terminator `127.0.0.1:3001`，双向 pipe；TLS terminator 把明文转发到 `127.0.0.1:3000`。
- TLS terminator 使用持久化的自签证书（SAN = `<roomId>.<relay-domain>`），私钥 `0600`。
- Terminator 为每个转发请求注入 M0 的 `X-MAFW-Tunnel` marker；gateway 据此判 `relay` principal，绝不把转发流量当 `local`。
- 暂停：断开 host WSS，保留 room/设备；恢复：重连同一 room。

### 7.3 Mobile

- 配对二维码同时携带 LAN 地址与 relay 地址：`url=<LAN URL>&relayUrl=<RoomURL>&fp=<sha256>`；只有 relay 时 `url=RoomURL`。
- **LAN 优先**：App 启动先 probe LAN（短超时），可达则走 LAN；不可达再走 relay。
  媒体/语音只在 LAN 路径启用；relay 路径关闭（5Mbps + 原生播放器不认自签证书）。
- `GatewayClient` 的 `HttpClient.badCertificateCallback` 校验 `fp`；WS 用同一个 `HttpClient`。
- 已配对设备保存 `lanUrl + roomUrl + fp + deviceToken`；启动时按 LAN → relay 顺序探测，再走现有 health/WS。
- 指纹不匹配 → 明确报错并引导重新扫码，不静默降级。
- 远程模式媒体/语音默认关闭（5Mbps + 原生播放器不认自签证书）。

## 8. 身份、Room 与证书

### 8.1 Room 创建

- Gateway 首次启用远程时生成：
  - `roomId`：16 字节随机，base32 小写无填充（26 字符），可作 DNS label。
  - `roomToken`：32 字节随机，只存 gateway 与 relay 的 hash。
  - `routeSecret`：16 字节随机；Room URL 的 host 里带它，作为 SNI 层的弱能力，防止 Room URL 公开后任意人占满 stream 槽位。
  - 自签证书 + 私钥（X.509，SAN = Room URL host）。
- 持久化到 `~/.mafw/mobile/relay/`（`room.json`、`tls.key`、`tls.crt`），权限 `0600`。
- Room URL = `https://<roomId>-<routeSecret>.<relay-domain>`；relay 只存 `hash(routeSecret)`。

### 8.2 Relay 注册

- Host 首连：`REGISTER {roomId, roomToken, routeSecret, protocolVersion}`。
- Relay 若无该 room：创建 claim，存 `sha256(roomToken)` 与 `sha256(routeSecret)`；若有：校验 hash，失败 401。
- 同一 room 新 host 连接替换旧连接，旧连接收到 `REPLACED`；避免双开混乱。
- SNI 必须同时匹配 `roomId` 与 `routeSecret`，否则在 TLS 握手前直接关闭 TCP。
- Room claim 持久化，不因空闲删除；`idleRetentionDays` 只影响“离线”展示。只有显式 release 才删除 claim。
- Relay SQLite 丢失/迁移时，gateway 可用原 `roomToken` 重新 claim 同一 room；若 room 已被他人占用则拒绝并提示重新配对。

### 8.3 设备配对

1. Gateway 生成 5 分钟一次性 nonce，二维码：
   `orcalore://pair?url=<LANURL>&relayUrl=<RoomURL>&v=2&exp=<ms>&nonce=<32hex>&fp=<sha256>`
   没有 LAN 地址时 `url=<RoomURL>`。
2. 手机优先连 LAN；不可达时连 Room URL，TLS 握手校验 `fp`。
3. `POST /api/mobile/pairing/verify {nonce, deviceId, platform, deviceName}` → 现有 pairing v2 逻辑签发设备 token。
4. 手机保存 `lanUrl + roomUrl + fp + deviceToken`；后续请求带 Bearer token。
5. 撤销：gateway 删除设备记录，并主动关闭该设备的 WS；已建立的 HTTP keep-alive 在下一次请求收到 401，已 in-flight 的请求允许完成。v1 的“立即”定义是“不再有新请求成功”，不是强制中断所有已建立连接。

## 9. Relay 协议

### 9.1 Host control WSS

- URL：`wss://<relay-domain>:8443/host`
- 文本帧 JSON 控制：
  - `hello {protocolVersion, roomId, roomToken}`
  - `hello-ok {roomId, heartbeatSec}`
  - `error {code, message}`
  - `open {streamId}` / `close {streamId, reason}`
  - `ping` / `pong`
- 二进制帧：`[type:1][streamId:4][flags:1][len:4][payload]`
  - `type=1 DATA`、`2 WINDOW`、`3 CLOSE`
  - `flags` 保留。
- 流控：每 stream 初始窗口 256KB；接收方发 `WINDOW` 增量；host/relay 超过窗口暂停读取 socket。

### 9.2 手机侧

- 手机不实现 mux；它看到的是普通 TCP/TLS。
- Relay 对每个手机 TCP 连接分配 `streamId`，通过 host WSS 发 `open`，然后把 TCP 字节转成 DATA 帧；反向同理。
- 一个手机可以开多条 TCP（HTTP keep-alive、WS、媒体），每条一个 stream。

### 9.3 SNI 解析

- 只解析第一个 TLS record 的 ClientHello；支持跨 TCP 分片（上限 16KB，5s 超时）。
- SNI 必须匹配 `^[a-z2-7]{26}-[a-z2-7]{26}\.<relay-domain>$`（roomId-routeSecret）。
- 无 SNI / 未知 room / routeSecret 不匹配 / room 离线：直接关闭 TCP；不返回 HTTP 错误页（避免被当成通用代理）。
- 解析失败计数入 metrics；不记录 SNI 之外的载荷。

### 9.4 重连

- Host WSS 断开：relay 标记 room offline，手机新连接快速失败；gateway 指数退避重连（1s → 30s，抖动）。
- 手机 HTTP：现有客户端重试；WS：现有 SmartReconnect。
- Relay 重启：SQLite 恢复 room claim；host 重连后恢复；已建立的 TCP 全部断开。

## 10. 配额与滥用控制（官方实例）

- 每 IP 每天最多创建 5 个 room；超过 429。
- 每 room 最多 32 条并发 stream（HTTP keep-alive、WS、媒体各占一条）；每 IP 最多 8 条，防单点占满。
- 每 room 带宽 2Mbps，全局 4Mbps（留 1Mbps 余量）；token bucket，超限降速/断开。
- SNI 里的 `routeSecret` 是弱能力：Room URL 公开后仍可能被占槽，但随机 16 字节使暴力枚举不可行；真正的鉴权仍是设备 token。
- Room 创建需要 `roomToken`（随机 32B），但任何人都能生成；配额是主要防线。
- 可选 `MAFW_RELAY_INVITE`：封闭 beta 时要求邀请码，正式开放后关闭。
- 日志只记 roomId 哈希前缀、字节数、时长、错误码；不记 URL path/内容。
- 5Mbps 下媒体默认关闭；后续可加“媒体走 LAN/直连”的提示。

## 11. 配置

### Gateway

```yaml
mobile:
  relay:
    enabled: false          # 首次开启需显式确认；确认后持久化
    provider: relay         # relay | quick
    url: wss://relay.example.com:8443
    roomDomain: relay.example.com
    # 自建时覆盖；官方默认内置
```

- 默认 `enabled: false`：首次 `mafw pair --remote` 或桌面开关会提示“会把本机暴露到公网”，确认后写入配置并创建 room。
- 已开启时，gateway 启动自动重连 relay；`enabled: false` 表示暂停（断开 host、保留 room/设备）。
- `mafw relay status|enable|disable` 管理；`mafw pair --remote` 在 relay enabled 时不再启动 cloudflared。
- 现有 `RemoteAccessProvider` 增加 `'relay'`；`GET/POST /api/mobile/remote-access` 的 `provider/url/startedAt` 语义扩展到 relay，`enabled:false` 即暂停。

### Relay

```yaml
listen:
  tlsRouter: 0.0.0.0:443
  hostControl: 127.0.0.1:8444   # Caddy 8443 终止 TLS 后反代到这里
  admin: 127.0.0.1:8080
room:
  domain: relay.example.com
  idleRetentionDays: 30
limits:
  roomsPerIpPerDay: 5
  streamsPerRoom: 32
  streamsPerIp: 8
  roomMbps: 2
  globalMbps: 4
```

## 12. 部署（腾讯云）

### 12.1 备案完成前（开发/测试）

- 本地 relay：`127.0.0.1:9443`（TLS router）+ `:9444`（control），域名用 `*.relay.localhost` 或 `sslip.io`。
- 本地 Caddy/自签 CA：gateway 需要信任该 CA（`NODE_EXTRA_CA_CERTS`）；**禁止**在生产关闭证书校验。
- Android 模拟器通过 `10.0.2.2` 访问宿主 relay；用 `adb reverse` 或 `10.0.2.2.sslip.io`。
- 腾讯云机器只开 8443 做 control 测试，**不切 443**；或完全不部署，等备案。

### 12.2 备案完成后（生产）

- DNS：`*.relay.<domain>` → 腾讯云公网 IP（blind TLS 必需 wildcard）；`relay.<domain>` 指向同一 IP。
- 安全组：80（ACME）、443（TLS router）、8443（host control）；SSH 仅管理 IP。
- 进程：Caddy 监听 8443 终止 TLS（公共 CA），反代到 relay `127.0.0.1:8444`；relay 监听 443 裸 TCP、8444、8080；SQLite。
- Room URL 的 443 不经过 Caddy（Caddy 不能终止，否则破坏 relay-blind）；Caddy 只服务 control 面。
- Docker Compose 或 systemd；日志轮转；`/health` 监控。
- 先灰度：官方默认地址只对 beta 用户开启，观察带宽/滥用，再全量。

## 13. 自建

- 发布 relay 二进制/Docker 镜像 + Compose 示例。
- 用户需要：**wildcard DNS**（`*.relay.<domain>`）、公网 IP、443/8443；没有 wildcard 就不能用 blind TLS 寻址。
- 配置自己的 `roomDomain`；gateway 改 `mobile.relay.url/roomDomain`；二维码自动带自建 Room URL。
- 自建实例不需要官方账号，也不需要连官方 relay；control 证书用公共 CA 或用户自己的 CA（gateway 侧显式配置信任）。
- 不提供账号体系；滥用控制靠配额，重负载用户应自建或提高配额。

## 14. 安全边界

- **M0 信任边界**：relay/Quick Tunnel 的请求必须是 `relay` principal，不能因 loopback 被当成 `local`；`relay` 只走 mobile allowlist，terminal WS / python / tools / A2A / admin 等一律拒绝。
- Relay 可见：SNI/roomId、连接时间、字节数、时序、源 IP；不可见：HTTP path、header、body、WS 内容。
- 证书 pinning 防止 relay MITM；指纹只从二维码/本机保存读取，不从网络更新。
- Room token 防止 room 被顶替；`routeSecret` 防止 Room URL 公开后任意占槽；设备 token 防止未配对访问；human-only 配对/开关不变。
- Gateway 仍只监听 loopback；TLS terminator 也在 loopback；terminator 注入的 marker 不落盘，并剥离客户端伪造头。
- 5Mbps 下 DoS 风险：单 room 2Mbps + 全局 4Mbps + 每 IP stream 上限；relay 不缓存请求。
- 撤销设备：关闭该设备 WS，后续请求 401；已 in-flight 请求允许完成。
- 已知限制：relay 能看到流量特征；证书轮换需要重新扫码；自建若用私有 CA，gateway 必须显式信任该 CA。

## 15. 与 Quick Tunnel 的关系

- Quick Tunnel 保留为 `MAFW_REMOTE_PROVIDER=quick` 的 dev/应急路径。
- **Quick Tunnel 同样接入 M0 的 relay principal**：现有实现把 tunnel 流量当 loopback/local，这是必须先修的漏洞。
- 正式默认切 relay；`mafw pair --remote` 在 relay enabled 时不再启动 cloudflared。
- 旧二维码/设备 token 不受影响；切 relay 后需要重新扫一次（url/fp 变了）。
- M0 落地后，Quick Tunnel 的 P0 行为（配对/WS）应保持兼容，只是权限收紧到 mobile allowlist。

## 16. 测试与验收

- 单元：SNI 解析（分片/无 SNI/非法 label）、帧编解码、窗口、room registry、配额。
- 集成：本地 relay + 真 gateway + Node 客户端；TLS pinning；配对 v2；HTTP/WS；断线重连；relay 重启；host 顶替。
- 安全：M0 marker 伪造/缺失、`relay` principal 路由矩阵（terminal WS/python/tools/A2A/admin 必须拒绝）、Quick Tunnel 回归；relay 抓包断言无明文；错误指纹拒绝；未注册 room 拒绝；token 重放拒绝。
- Android 模拟器：扫码/粘贴配对 → WS 已连接 → 杀 relay → 自动重连 → 撤销设备 → 401；LAN/relay 双端点切换。
- 真机：蜂窝网络 + 家用宽带；5Mbps 下文本/审批延迟；媒体关闭提示。
- 验收标准：gateway/relay 重启后手机无需重新扫码；relay 侧抓不到明文；暂停后手机显示离线、恢复后自动连回；relay 流量无法访问 desktop-only 路由。

## 17. 里程碑

1. **M0**：gateway 信任边界修复（`relay` principal + marker + allowlist），同时覆盖 Quick Tunnel。
2. **M1**：relay 核心 + 本地集成测试（SNI/帧/room/配额）。
3. **M2**：gateway tunnel client + 自签证书 + 配对指纹 + room 生命周期。
4. **M3**：Mobile 双端点（LAN→relay）+ pinning + 远程开关/状态。
5. **M4**：腾讯云部署（备案后 443）、beta 灰度、监控。
6. **M5**（可选）：媒体/语音限流、P2P/TURN、多地域。

## 18. 开放问题

- 官方域名具体名称与 DNS 托管商（腾讯 DNSPod / Cloudflare）；wildcard `*.relay.<domain>` 必须可配。
- Beta 规模与是否先开邀请码；5Mbps 下建议先小范围。
- Relay 是否需要在 8443 之外提供 443 control fallback（部分企业网封 8443）。
- 证书轮换策略：自动续期 vs 仅重装时轮换（轮换需重新扫码）。
- 是否把 relay 纳入 `npm run build` 与发布流水线，还是独立仓库/镜像。
- M0 是否先于 relay 单独发一个安全补丁（建议是，Quick Tunnel 现已受影响）。
