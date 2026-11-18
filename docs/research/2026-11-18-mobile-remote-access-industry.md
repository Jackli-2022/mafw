# Mobile 远程访问：业界做法与 Orcalore 的选择（2026-11-18）

> 背景：2026-11-05 的 `2026-11-05-mobile-tailscale-pod-research.md` 以“用户已有 Tailscale”为前提，
> 只比较了 direct tailnet / serve / Funnel 三条路径。本文重新回答一个更前置的问题：
> **为什么同类产品大多不需要用户启动 Tailscale？Orcalore 应该跟哪条路？**

## 1. 先分类：同类产品其实分三类

| 类别 | 代表 | 手机怎么到“电脑上的 agent” | 用户要装 VPN 吗 |
|---|---|---|---|
| 云端 AI | ChatGPT、Claude 云会话、Grok | 手机 → 厂商云 → 云沙箱/云模型 | 不需要，因为根本没有“自己的电脑” |
| 本地 agent + 手机控制 | Happy、Omnara、Claude Code Remote Control、CodeMote、Orca | 手机 ↔ 中继/隧道 ↔ 本地 daemon | **大多数不需要** |
| 自托管/极客 | Home Assistant、Hermes、OpenClaw 系 | LAN / Tailscale / Cloudflare / 自建 relay | 可选，Tailscale 只是其中一种 |

所以“业界没看到起 Tailscale”不是错觉：**Tailscale 是自托管/极客路径，不是消费级默认路径**。

## 2. 同类产品具体怎么做

### Happy（原 Happy Coder）

- 三件套：本地 CLI + relay server + 手机 App。
- CLI 和手机都**出站**连 relay；relay 只转发加密 blob，不能读内容。
- 配对：电脑显示一次性公钥 QR，手机扫码，双方建立 E2E 密钥；每个 session 单独密钥。
- relay 开源、可自建；手机和 CLI 都能改 server URL。
- 结论：**QR + 托管 relay + E2E，不要求 VPN**。

### Omnara

- 本地装一个小 daemon（`omnarad`），daemon 维持到云端的**出站 WebSocket**；
- 手机/网页连云端，云端把消息转给 daemon；
- 不需要开入站端口、SSH、Tailscale；
- 笔记本离线时可迁到云 sandbox（可选）。
- 结论：**outbound WSS relay + 本地执行**，和 Happy 同构。

### Claude Code Remote Control

- 本地 session 只发**出站 HTTPS**，不开入站端口、不需要 VPN；
- 手机 Claude App 扫码/选 session 接入；
- transcript 在连接期间同步到 Anthropic 云端（官方明确说明）。
- 结论：**厂商托管 relay + 账号体系**，用户零网络配置。

### VS Code Remote Tunnels / CodeMote

- 远端机器跑 `code tunnel` / `devtunnel`，出站连 Microsoft Azure；
- 两端用同一 GitHub/Microsoft 账号认证；
- 不开防火墙端口、不装 VPN；
- CodeMote 的文章标题就是 “without SSH or Tailscale”。
- 结论：**通用反向隧道**，把 HTTP/WS 服务暴露成一个 HTTPS URL。

### Orca / Hermes / OpenClaw / mobile-claw

- 通常同时支持 LAN、Tailscale、Cloudflare Tunnel、自建 relay；
- 消费级 onboarding 默认 Relay 或 LAN；Tailscale 被标成 “advanced / private network”；
- 有的产品文档直接写“同一 Wi-Fi 或 Tailscale 均可”，但不会把 Tailscale 当唯一路径。

### Home Assistant

- 官方最推荐 Nabu Casa Cloud：出站 relay，手机不装 VPN，一个开关；
- Tailscale 是 “VPN” 选项，适合只给自己设备、愿意装客户端的用户；
- Cloudflare Tunnel 适合想用自己的域名/公网 URL 的用户。
- 结论：**厂商 relay 是默认，VPN 是高级选项**。

### 2.7 连接模式总表

| 模式 | 代表产品 | 手机装 VPN | 需要账号 | 典型实现 |
|---|---|---|---|---|
| 云端执行 | ChatGPT、Claude 云会话、Cursor cloud、Codex cloud、Cosyra | 否 | 是 | 手机连厂商云，代码在云容器 |
| 托管 relay + E2E | Happy、Omnara、RemoteCode、Moshi、mobile-claw | 否 | 通常是 | 两端出站连 relay，QR 换密钥，relay 只转发 |
| 厂商反向隧道 | VS Code Remote Tunnels、CodeMote（devtunnel）、Claude Remote Control | 否 | 是 | daemon 出站连 Azure/厂商，客户端拿 HTTPS |
| 第三方/自建隧道 | Cloudflare Tunnel、ngrok、Tailscale Funnel、VibeTunnel | 否 | 视方案 | 出站隧道换一个公网 HTTPS URL |
| LAN + mDNS/QR | Orca LAN、AO Connect Mobile、LocalSend、KDE Connect | 否 | 否 | 同 Wi-Fi 发现 + 配对码 |
| WebRTC P2P + TURN | Herdr（WebRTC 选项）、远程桌面类 | 否 | 信令服务 | STUN 打洞，失败回 TURN |
| 嵌入式 VPN | Tailscale（libtailscale）、ZeroTier（libzt） | 否（在 App 内） | 是 | 用户态网络栈 + 原生桥接 |
| SSH/tmux over VPN | 开发者 DIY、VibeTunnel（Tailscale/ngrok） | 是 | 是 | Tailscale + SSH + tmux |

可以清楚看到：**消费级/产品化路径集中在 relay 和反向隧道；“装 VPN”基本只出现在开发者 DIY 和自托管工具里。**

### 2.8 内嵌 Tailscale 的业界证据

**服务端/daemon 侧：tsnet 是官方且成熟的嵌入方式。**

- `tsnet` 是 Go 库，把完整 Tailscale 节点放进进程，用户态 TCP/IP 栈；
  不需要 root、TUN、`tailscaled`、系统级配置。
- 官方自己用它：内部短链 `golink`、支持工具、`caddy-tailscale` 模块、
  Tailscale Kubernetes Operator 的部分能力。
- 支持 `Listen` / `ListenTLS` / `ListenFunnel`；Funnel 可把服务暴露到公网，
  手机不装 Tailscale 也能访问。
- 仍然需要 tailnet 账号：`AuthKey`、OAuth client，或首次交互登录。

**手机侧：官方是 VPN 服务 + C 库，第三方有嵌入式方案，但不是主流。**

- 官方 Tailscale Android 客户端：`VpnService` + `libtailscale`（C 库），
  `IPNService`、`VPNServiceBuilder` 都是原生代码。
- iOS：`NetworkExtension` / Packet Tunnel + App Store entitlement，普通 App 不能直接抓流量。
- `libtailscale` 官方 C 库可以在进程内跑 Tailscale；社区有 Android fork
  （`tailscale_mobile`）和 Flutter 包（pub.dev `libtailscale`），声称不需要系统 VPN，
  但属于第三方原生二进制，iOS 支持、许可证、升级、审核都要自己承担。
- ZeroTier 也提供 `libzt` / SDK：用户态网络栈、可静态链接进 App、无需特殊权限；
  说明“嵌入式 VPN”在技术上是可行的，但同样需要控制平面账号和原生维护。
- 没有看到主流消费级 AI/agent 产品把完整 VPN 塞进 App 作为默认路径；
  它们更愿意用 relay/tunnel 把网络问题留在服务端。

### 2.9 业界共识与反模式

共识：

- 手机端默认 **零网络配置**：扫码/登录即可，不要求装 VPN。
- 两端尽量 **出站连接**，不开入站端口、不做端口映射。
- 配对用一次性 QR / device code，设备可撤销。
- 隐私敏感产品做 **E2E**（Happy/Omnara），或明确说明云端可见范围（Claude Remote Control）。
- LAN 直连作为“同 Wi-Fi 快路径”，远程走 relay/tunnel。
- Tailscale/ZeroTier 作为 advanced / self-host 选项，不作为默认 onboarding。

反模式：

- 把“安装并常开 VPN”作为普通用户的前置条件；
- 公网明文 HTTP / 端口映射；
- 公网 URL 没有设备级鉴权；
- 依赖 always-on VPN 做后台推送（Android 会杀）；
- 为了“内置”把完整 VPN 塞进 Flutter v1。

## 3. 为什么我们当初选了 Tailscale

客观优点：

- 不需要公网 IP/端口映射，CGNAT 下也能用；
- 网络层加密 + 设备身份，gateway 可以只监听 tailnet/本机；
- 不需要我们运营 relay，v1 成本最低；
- 对已经用 Tailscale 的开发者，扫码即用。

但对普通用户是三重摩擦：

1. 电脑和手机都要装 Tailscale；
2. 两边登录同一账号，且手机要常开 VPN；
3. 企业设备/借来的设备通常不允许装 VPN；Android 后台还可能杀掉 always-on VPN。

这三条正好解释了“为什么业界不这么做”：**它把网络配置转嫁给了用户**。

## 4. 对 Orcalore 的建议

目标架构：

```
默认（同 Wi-Fi）:  Phone ── LAN/mDNS + QR ── Gateway:3000
远程（默认）:      Phone ──outbound WSS── Relay ──outbound WSS── Gateway
高级（可选）:      Phone ── Tailscale / Cloudflare Tunnel / 自建 relay ── Gateway
```

原则：

- **LAN 直连是默认**：mDNS + QR 已经具备，继续保留；
- **远程默认不要求 VPN**：用托管 relay 或出站隧道；
- **Tailscale 降级为 advanced**：保留代码，不放在 onboarding 主路径；
- **relay 只转发，不碰业务**：优先 E2E，至少 TLS + 设备 token + 房间密钥 + 限流/撤销；
- **HTTP 和 WS 都要通**：手机端是完整 HTTP 客户端，不能只隧道 WS。

## 5. 三条落地路线

### P1 · 第三方隧道（最快，1 周内）

- `mafw tunnel` 启动 Cloudflare Tunnel 或 Microsoft devtunnel；
- 生成 HTTPS URL，写进 pairing QR；
- 手机零安装，`baseUrl` 直接指隧道 URL；
- 代价：依赖第三方；Cloudflare 永久域名要自己的域名，devtunnel 要 GitHub/MS 账号。

适合：先验证“远程不需要 VPN”的产品体验。

### P2 · 自建 relay（体验最好，工作量最大）

- gateway 出站 WSS 到 relay，注册 room；
- 手机扫码拿 `relayUrl + roomId + pairingSecret`，出站连 relay；
- relay 做 HTTP/WS 反向隧道（类似 ngrok/Cloudflare Tunnel），不做业务；
- E2E：手机与 gateway 用 QR 交换的密钥加密 payload；relay 只看到密文；
- 支持自建 relay；后续加离线队列/FCM。

适合：要把“零配置远程”做成产品能力。

### P3 · 云 sandbox（可选，长期）

- 笔记本离线时把 session 迁到云端；
- 参考 Omnara 的 hybrid 模型；
- 不是 v1 必需。

## 6. 结论

- **不要继续把 Tailscale 当默认远程方案**；它是高级选项。
- 最快对齐业界：**P1 第三方出站隧道 + QR**。
- 最符合 Orcalore 本地优先品牌：**P2 自建 relay + E2E + 可自建**。
- 两者都可以保留现有 `GatewayClient` / WS 协议，不需要重写业务 API；关键是新增一层“可替换的 transport/baseUrl”。

## 7. 附：把 Tailscale 内置的可行性

结论先说：**桌面 gateway 侧可以内置；手机侧可以但很重；CLI 可以封装。**
内置只能省掉“装 Tailscale 客户端”，不能省掉“Tailscale 账号/登录”。

### 7.1 桌面 / gateway 侧：可行，推荐 tsnet

Tailscale 官方提供 `tsnet`（Go 库）：把完整 Tailscale 节点嵌入进程，用户态网络栈，
不需要 root、不需要 TUN、不需要单独装 `tailscaled`；支持 `Listen` / `ListenTLS` /
`ListenFunnel`，可用 `AuthKey` 或交互登录。

- 我们的 gateway 是 Node/TypeScript，不能直接 import Go 包；需要一个小 Go sidecar
  （`mafw-tsnet`）随 gateway 一起分发，由 `mafw` 启动/停止。
- sidecar 用 `tsnet.Server{Hostname, AuthKey, Dir}` 加入 tailnet；
  `Listen("tcp", ":3000")` 或反代到 `127.0.0.1:3000`。
- 这是“用户不需要单独装 Tailscale 桌面端”的最干净路径，但**仍然需要一个 tailnet 账号**。
- 认证：`TS_AUTHKEY`（可在 `mafw up` 时粘贴一次），或 OAuth client 自动签发；
  状态存 `Dir`，后续复用。

替代方案：随包 `tailscaled --tun=userspace-networking` + `tailscale up --auth-key=...`
+ `tailscale serve --bg 3000`。不需要 TUN/root，但多一个 daemon 和 CLI，Windows 还要处理
服务/权限；适合快速原型，不如 tsnet 干净。

### 7.2 手机侧：能嵌，但不建议 v1 做

- 官方 Tailscale Android 客户端用 `VpnService` + `libtailscale`（C 库）；要嵌进 Flutter
  意味着原生 VPN 服务、JNI/FFI、权限、前台通知、电量、iOS Network Extension/entitlement。
- 官方 `libtailscale` 是 C 库；社区有 Android fork（`tailscale_mobile`）和 Flutter 包
  `libtailscale`（pub.dev，第三方），声称在 App 进程内跑完整节点、不需要系统 VPN。
  这类方案可以 spike，但要审计：二进制来源/校验、许可证、iOS 支持、状态/auth key 管理、
  App Store 审核、升级与 Tailscale 版本漂移。
- 如果手机不装 Tailscale、也不嵌 VPN，那手机就**不在 tailnet 里**；要让手机访问，
  只能在 gateway 侧把服务公开（Funnel）或走 relay。

### 7.3 Funnel：手机零安装的唯一 Tailscale 路径

`tsnet.Server.ListenFunnel("tcp", ":443")` 可以把本地 gateway 暴露成
`https://<node>.<tailnet>.ts.net` 的公网 HTTPS 端点；手机用普通 HTTPS 访问，不装 Tailscale。

要求/限制：

- Tailscale 账号 + MagicDNS + HTTPS 证书 + tailnet policy 里的 funnel node attribute；
- Funnel 仍是 beta；只能 443/8443/10000 端口；只能用自己的 `*.ts.net` 域名；
- 有非可配置的带宽限制；流量是**公网可达**，安全要靠 gateway 的设备 token / E2E，不是 tailnet ACL。

这条路适合“gateway 内置 Tailscale、手机零安装”的 spike；不适合作为默认隐私方案。

### 7.4 CLI 封装：最快能跑

如果机器上已经有 Tailscale：

```bash
tailscale up --auth-key=tskey-auth-...
tailscale serve --bg 3000        # 仅 tailnet
# 或
tailscale funnel --bg 3000       # 公网 HTTPS，手机不装 Tailscale
```

`mafw up` / `mafw tunnel` 可以检测 `tailscale` 是否存在、执行 `up`/`serve`/`funnel`、
把结果 URL 写进 pairing QR。端口转发不需要 root（官方文档）；文件服务才需要 root。
这只省掉“手动敲命令”，不省掉安装和账号。

### 7.5 建议

| 方案 | 桌面装 Tailscale | 手机装 Tailscale | 账号 | 工作量 | 风险 |
|---|---|---|---|---|---|
| `mafw` 封装 CLI + serve | 需要 | 需要 | 需要 | 1–2 天 | 低 |
| tsnet sidecar + serve | 不需要 | 需要 | 需要 | 3–5 天 | 中 |
| tsnet sidecar + Funnel | 不需要 | **不需要** | 需要 | 3–5 天 | 中高（公网/beta） |
| Flutter 内嵌 libtailscale | 不需要 | 不需要 | 需要 | 2–4 周 | 高（原生/审核/维护） |
| 自建 relay / 第三方隧道 | 不需要 | 不需要 | 不一定 | 1 周–1 月 | 中 |

**推荐**：如果短期要保留 Tailscale，先做 `tsnet sidecar + Funnel` 的 spike（手机零安装），
同时把 relay/tunnel 作为正式产品路径。不要为了“内置”而把 Tailscale 塞进 Flutter v1。

## 9. 如果有公网域名

先纠正一个常见误解：**域名本身不提供可达性**。它只给你稳定的名字和 TLS 证书；
流量最终仍要落到“公网入口”（Cloudflare/VPS/公网 IP）再回到本地 gateway。

### 9.1 域名在 Cloudflare：Cloudflare Tunnel（最快）

```text
Phone ──HTTPS──> Cloudflare edge ──outbound tunnel──> cloudflared ──> gateway:3000
```

- DNS：`app.example.com` CNAME 到 `<tunnel-id>.cfargotunnel.com`，开启代理。
- 本机：`cloudflared tunnel create mafw` → `cloudflared tunnel route dns mafw app.example.com`
  → `cloudflared tunnel run mafw`（或 `cloudflared service install` 常驻）。
- 手机：`baseUrl = https://app.example.com`，QR 直接写这个 URL；不需要 Tailscale。
- 安全：Cloudflare Access（Zero Trust）或 gateway 自己的设备 token；
  不建议只靠一个共享 API token。
- 优点：不开端口、无公网 IP、自动 TLS、WS/SSE 可过；域名已有就直接用。
- 代价：Cloudflare 在链路里；Access 的机器认证要设计（移动端不要塞 service token）。

### 9.2 有 VPS：自建反向隧道（最符合本地优先）

```text
Phone ──HTTPS──> VPS(Caddy/nginx) ──reverse tunnel──> gateway:3000
```

- DNS：`app.example.com` A/AAAA 指向 VPS。
- VPS：Caddy 自动 Let's Encrypt；反代到 `127.0.0.1:PORT`。
- 本机：`ssh -R` / frp / WireGuard / 自建小 relay 把 gateway 的 3000 映射到 VPS 的回环端口。
- 优点：域名、TLS、relay 都是自己的；不依赖 Cloudflare；可做 E2E。
- 代价：要维护 VPS、TLS、隧道进程和监控；比 Cloudflare Tunnel 多运维。

### 9.3 有公网 IP 且没有 CGNAT：直接反代（高级）

- DNS 指向公网 IP，路由器把 443 转到反代，Caddy/nginx 终止 TLS。
- 优点：链路最短、无第三方。
- 代价：暴露公网端口、动态 IP/DDNS、DDoS/扫描、证书续期、家庭网络边界；
  **不建议作为普通用户默认路径**。CGNAT 下根本不可用。

### 9.4 Tailscale Funnel 不支持自定义域名

Funnel 只能用 `*.ts.net` 域名，不能把 `app.example.com` 指过去。
所以“有公网域名”并不能让 Tailscale 路线变得更好；它反而更适合 Cloudflare/VPS。
`tailscale serve` 仍然只在 tailnet 内，手机要装 Tailscale。

### 9.5 对 MAFW 的接入点

现有代码已经能接：

- `gateway/src/mobile/tailscale-url.ts` 优先读 `MAFW_MOBILE_TAILSCALE_URL`；
  把它设为 `https://app.example.com` 即可让 pairing QR 使用公网域名（变量名是历史包袱）。
- `mobile/lib/src/config/connection_config.dart` 对 `https://` 一律放行；
  公网域名天然通过 `checkBaseUrl`。
- `GET /api/mobile/pairing-code` 仍是 human-only；QR 里放公网 URL + 一次性 nonce。
- 需要确认 `/api/ws` 的 upgrade、SSE 不被代理缓冲；Cloudflare Tunnel/Caddy 都支持。
- 设备 token、human-only 动作、限流/撤销逻辑不变；域名只是换了 transport。

### 9.6 建议

| 场景 | 推荐 |
|---|---|
| 域名已在 Cloudflare、想最快上线 | **Cloudflare Tunnel + 设备 token/Access** |
| 想完全自控、有 VPS | **VPS + Caddy + 反向隧道** |
| 有公网 IP、愿意做安全加固 | 直接反代（仅高级/自托管） |
| 只有域名、没有入口 | 域名不够；仍需 Tunnel/VPS/relay |
| 想继续 Tailscale | Funnel 只能用 `*.ts.net`，自定义域名不适用 |

**结论**：有公网域名时，Cloudflare Tunnel 是最像业界的零安装方案；VPS + 反向隧道是最符合
Orcalore 本地优先/可自建的方案。两者都不需要手机装 VPN，也都比“把 Tailscale 塞进 App”简单得多。


## 10. 两个具体样本：OpenCode Mobile 与 DeepSeek Harness

### 10.1 OpenCode Mobile：客户端/服务端 + OpenTunnel

OpenCode v2 是 **client/server** 架构：

- 电脑上跑一个 background service（默认 `127.0.0.1:49374`，Windows `28894`），
  拥有 sessions、workspace、模型、凭据、工具执行；TUI / Desktop / Web / Mobile 都是 client。
- `opencode pair` 生成**一次性链接 + QR**，5 分钟过期；打开后写入 30 天 session cookie；
  修改服务密码会让所有 session 失效。
- 同 Wi-Fi：`opencode service set hostname 0.0.0.0`，手机直接连 LAN 地址。
- SSH：服务保持 loopback，`ssh -L 49374:127.0.0.1:49374`。
- 远程：`opencode pair --remote` 通过 **OpenTunnel** 暴露一个随机 `*.opentunnel.xyz` 地址；
  首次会明确提示“会把 server 暴露到公网”，并要求确认；仍需要 server password。
- Desktop 的 Settings → Pairing 现在只有一个 **Pair device**，默认走 OpenTunnel；
  旧的 LAN/VPN/custom address 选项已从配对页移除。

OpenTunnel 的实现（`anomalyco/opentunnel`）：

- Rust 写的 **blind TLS tunnel**；公网 443 只读 TLS ClientHello，按 SNI 把连接桥接到本机 client。
- 本机 client 持有证书私钥，**在本机终止 TLS**，再把明文转发给本地 app；
  所以 relay 不持有私钥、看不到 HTTP 明文。
- 每个 route 是随机 16 字符主机名；随机名不出现在证书透明日志里，但**URL 不是认证**，
  任何人拿到 URL 都能访问；app 必须自己校验密码/设备。
- 没有域名也能用；不是 Cloudflare/Tailscale 依赖。

安全边界：

- OpenCode 文档说“end-to-end encrypted”，但严格说是 **relay-blind TLS**：
  本机 client 终止 TLS 后把明文交给 app；信任边界是“本机 + OpenCode server”。
- 真正兜底的是 server password + 一次性 pair link + 30 天 session；链接泄露/过期即失效。
- 公网暴露后，特权 API（settings/credentials/host.*）仍按本机信任 fence 限制；
  OpenCode 的远程模式只给已认证 client 访问 server API。

### 10.2 DeepSeek Harness：官方只到 Web UI，社区补 Relay/Mobile

官方 DSH（`dsh`）是 Node/Cordis 的插件化 agent runtime：

- `npx @deepseek-ai/dsh web` 在 `127.0.0.1:3080` 起 Web UI；
  默认只监听 loopback，且有 Host/Origin fence；`settings.*`、`credentials.*`、
  `host.listDirectory` 等特权 API 只允许 localhost。
- 官方远程方案是**反代**：`dsh --profile web --public-url app.example/ui/ --trusted-host app.example`；
  反代必须保留 Host、剥掉 mount prefix；没有内建 pair/relay/QR。
- 官方没有 OpenTunnel 等价物，也没有官方手机 App；但社区已经有成熟手机端 **DSH Go**。

**DSH Go（`ccch1mneyyy/dsh-Go`）** 是目前最完整的社区 Android 客户端
（Flutter/Dart + Kotlin，AGPL-3.0，Android 8+）：

- **本机模式**：App 内解压 Ubuntu + Node.js + DSH（PRoot，免 root、免 Termux），
  引擎跑在手机上；模型请求仍发给你配置的 provider。
- **远程模式**：SSH 直连，或 **DSH Remote**（电脑装 `ds-harness-remote` 插件，同账号登录，
  走 Relay；Noise_IK 端到端加密，无公网 IP、无端口映射）。
- 手机只负责 UI / 审批 / 插件卡片；代码与工具留在主机。
- DSH Remote 限制：附件仅图片、App 内不能开网页版、插件仅开关、无 DS Bot / 日志导出。
- **不需要 Tailscale，也不需要域名**；远程靠 Relay，账号登录。

其他社区方案：

| 项目 | 做法 | 是否需要域名/账号 | 安全模型 |
|---|---|---|---|
| **DSH Go（ccch1mneyyy）** | Flutter Android App；本机 Ubuntu+Node+DSH，或 SSH / DSH Remote Relay | 不要域名；DSH Remote 要账号 | 本机/SSH；DSH Remote Noise_IK E2E |
| DSH Mobile（PWA `:8030`） | Vite 代理 `/api`+WS 到 Host `:3080`；桌面 QR + 6 位短码；LAN 或穿透 | 不要账号；穿透可不要域名 | 可选连接密码 / 桌面确认 |
| DSH Mobile Suite（april-jk） | 插件 + outbound-only Relay + E2E 配对 QR；手机 WebView 打开真实 DSH UI | 不要域名；Relay 可自建 | 设备 token + E2E；Relay 只转发 |
| yukiykchen/deepseek-harness-mobile | Kotlin/Kuikly App；扫码 Relay 或 SSH；另可手机本地跑 DSH | 不要域名 | Relay sealed tunnel / SSH |
| zexadev/dsh-tether | **iroh P2P 打洞**，失败回 ciphertext relay；无需自建服务器 | 不要域名/服务器 | P2P + 密文 relay |
| dsh-remote / dsh-lan-access / dsh-phone-remote | 插件内反向代理，暴露 LAN `:3082` 之类 | 不要域名 | 有的**无认证**，有的 token/Basic；需谨慎 |
| dsh-full-remote | 反代 + token/设备会话/审批/审计，重写 Host/Origin 为 loopback | 可配 Cloudflare quick tunnel | 自带访问控制层 |

命名注意：`ccch1mneyyy/dsh-Go` 是**手机 App**；`JopenChen/dsh-go` 是**纯 Go 的 Agent kernel
参考实现**（event sourcing / fold projection / Goal 状态机 / 工具瀑布），不是移动端；
它本身没有 server、mobile client 或 relay/transport 层。

### 10.3 对比

| 维度 | OpenCode Mobile | DeepSeek Harness (DSH Go) |
|---|---|---|
| 手机 App | 官方（TestFlight / Play） | DSH Go（社区，非官方，Android） |
| 远程 tunnel | **OpenTunnel**（`pair --remote`） | **DSH Remote Relay**（插件 + 账号）或 SSH |
| 本机运行 | 不跑 agent；只做 remote client | **可以**：手机内 Ubuntu+Node+DSH |
| 无域名 | 可以，随机 `*.opentunnel.xyz` | 可以，Relay/SSH 都不需要域名 |
| 无账号 | 可以（server password + pair link） | SSH 可以；DSH Remote 要账号 |
| 配对 | 一次性 QR/链接，5 分钟，30 天 session | DSH Remote 登录/配对；SSH 手动主机 |
| 安全 | 本机终止 TLS + server password + pair link | DSH Remote Noise_IK E2E；SSH 主机指纹 |
| Tailscale | 可选路径（serve），不是默认 | 不需要；社区另有 Tailscale 方案 |

### 10.4 对 MAFW 的直接启示

1. **没有域名不是问题**：OpenCode 用随机 tunnel 域名 + 一次性 QR，完全不需要用户有域名。
2. **手机端不需要 VPN**：OpenCode 的默认路径是 OpenTunnel，不是 Tailscale。
3. **配对 UX 比网络技术更关键**：一次性链接 + QR + 5 分钟过期 + 30 天 session，
   这套体验比“让用户填 IP/装 VPN”高一个档次。
4. **官方第一方 tunnel 比社区反代更可控**：OpenTunnel 是 blind TLS，本机终止 TLS；
   DSH 官方只给反代，社区则出现“无认证 LAN 代理”这种危险实现。
5. **MAFW 应该抄 OpenCode，而不是抄 DSH 的社区插件**：
   - `mafw pair`：本地一次性 QR/链接；
   - `mafw pair --remote`：出站 tunnel + 随机地址 + 首次确认 + server password；
   - `mafw service set hostname 0.0.0.0`：同 Wi-Fi 快路径；
   - `--url`：自定义域名/反代；
   - SSH 转发：企业/高级兜底；
   - 远程地址不是认证，必须叠加设备 token / 密码 / 限流 / 撤销。

## 11. 参考

- Happy: https://happy.engineering/docs/how-it-works/
- Omnara: https://docs.omnara.com/how-it-works
- Claude Code Remote Control: https://code.claude.com/docs/en/mobile
- VS Code Remote Tunnels: https://code.visualstudio.com/docs/remote/tunnels/
- CodeMote: https://codemote.caste.work/blog/control-claude-code-from-phone-without-ssh-or-tailscale
- Home Assistant remote access: https://www.home-assistant.io/docs/configuration/remote
- Orca Mobile: https://www.onorca.dev/docs/mobile
