# Gateway / Desktop 运维指南

> 迁移自根 `AGENTS.md`（2026-11-10），原文搬迁（未改写）；章节号沿用迁移前编号，
> 交叉引用以标题为准。后续变更记录写 `docs/releases/`，不再回填本文件。

## Gateway 运维

### CLI 命令

Gateway 唯一运维入口是 `mafw` CLI，用 `npm install -g` 全局安装或 `npx mafw` 使用：

```bash
# 进程管理
mafw status            # 查看运行状态
mafw start             # 前台启动
mafw daemon            # 后台启动
mafw stop              # 停止
mafw restart           # 重启前台（stop + 1s + start）
mafw restart-agent     # 重启 agent serve sidecar（POST /api/runtime/restart-agent；external/进程内 runtime 返回 503）

# 日志和诊断
mafw logs              # 看最后 50 行
mafw health            # HTTP 健康检查
mafw stats             # gateway 统计

# 凭据
mafw rotate-human-token  # 轮换 human token（保留旧凭据作废，见下）

# 项目/Goal 管理
mafw projects          # 已注册项目
mafw goals             # 活跃 Goal
mafw register <dir>    # 注册项目

# 其他
mafw config            # 当前配置
mafw dashboard         # 打开 Web Dashboard
mafw version           # 版本号
```

### 手机远程配对（2026-11-18 / P0）

没有域名 / Tailscale 时，用 Cloudflare Quick Tunnel 让手机扫码接入：

```bash
mafw pair --remote     # 起隧道 + 打印一次性 QR（~/.mafw/pair-qr.png）
mafw pair --status     # 查看隧道 URL / 状态
mafw pair --stop       # 关闭隧道，配对链接恢复 LAN/Tailscale
mafw pair              # 仅生成当前 LAN/Tailscale URL 的配对码
```

- 需要 `cloudflared` 在 PATH（或 `MAFW_CLOUDFLARED_PATH`）；首次 `pair --remote` 需 10–30s 等 URL。
- cloudflared 只连 loopback terminator `127.0.0.1:3001`（`MAFW_TUNNEL_TERMINATOR_PORT` 可覆盖）；
  **不要**把 3001 暴露到公网，也不要把 cloudflared 指回 3000。
- start/stop/status 是 human-only；CLI 读取 `~/.mafw/human.token`（或 `MAFW_HUMAN_TOKEN`）。
- 隧道 URL 不是认证：匿名隧道请求只允许 `/health` 与 `POST /api/mobile/pairing/verify`；
  其余 API 需要设备 token，且只能访问 mobile allowlist。
- Quick Tunnel 是临时验证路径（随机 URL、无 SSE、200 in-flight、无 uptime 保证）；生产换 named tunnel + Cloudflare Access 或自建 relay。

### 轮换 human token（`mafw rotate-human-token`，2026-11-13 / E11-1）

human token 是 human-only 动作（验收、计划批准、triage 决策、permission 应答…）的唯一凭据，固定放在
`~/.mafw/human.token`（32 字节 hex）。需要换发时：

```bash
mafw rotate-human-token
# Human token rotated at 2026-11-13T12:00:00.000Z.
```

- **只打印时间戳**：新 token 直接落盘（原子写：`.tmp` + fsync + rename + 0600），不打印、不写日志
  （gateway 侧日志是常量 `[Auth] human token rotated`）。
- **旧 token 立即失效**：gateway 写盘后 live rebind，当前进程内无需重启；不需要停 gateway。
- **只认 human-token 凭据**：CLI 读 `~/.mafw/human.token`（`MAFW_HUMAN_TOKEN_FILE` 可覆盖，供测试 /
  隔离 dev 根）并带 `X-MAFW-Human-Token` POST 到 `/api/human-token/rotate`。device token（手机）、
  service apiToken、loopback 无凭据调用一律 403 `human_principal_required`——手机端不能作废桌面凭据。
- **失败语义**：文件缺失 / 格式非法 / 非 200 → 提示 + exit 1；gateway 写盘失败 → `500`，**旧 token 仍然可用**
  （赋值在写成功之后），可直接重试。
- **对客户端的影响**：
  - **桌面自动跟上**：`mafw-invoke` 捕获 403 `human_principal_required` 后重读 token 文件、重建 SDK client、
    原方法重试一次（只一次，避免凭据坏了变成请求风暴）——外部轮换后无需重启桌面。
  - **TUI 需重启**：TUI 没有集中重试入口（已知限制，见 `docs/architecture/tui.md`），轮换后 human-only 动作
    会显示 gateway 403，重启 `mafw tui` 即可。
  - **手机**：走自己的 device token，不受影响。

### 日志路径

Gateway 的 console.log/warn/error 自动写入文件：
- `~/.mafw/logs/mafw.log` — 文件日志（daemon 模式下也用这个）
- 5MB 自动轮转，格式 `[ISO时间] [LEVEL] 消息`
- Error 对象在日志中需要用 `err.message` 而非 `err`（JSON.stringify Error → {}）

### 重启注意事项

- Restart 前会自动 kill 旧进程（基于 PID 文件）
- 如果旧进程是非 CLI 启动的，先 `mafw stop` 再 `mafw start`

### 构建、安装与发布

```bash
npm run build                 # 构建 plugin + gateway + @mafw/sdk + tui（sdk 必须先于 tui——tui esbuild 依赖 @mafw/sdk/dist）
npm pack                      # 打包为 .tgz（jack200714-mafw-<version>.tgz）
npm install -g @jack200714/mafw    # 全局安装（bin 命令为 mafw）
mafw version                  # 验证安装
```

发布后用户只需 `npm install -g @jack200714/mafw` 即可使用 `mafw` CLI（包名变迁：`opencode-plugin-mafw` → `mafw`（2026-09-15）→ `@jack200714/mafw`（2026-09-15，因 npm typosquatting 相似度规则拦截无 scope 短名，scoped 包豁免；bin 命令始终为 `mafw`）。旧名均从未发布到 npm，零迁移）。

**完整重装流程（清旧 + 构建 + 安装）：**
```bash
npm run build
npm pack
npm install -g jack200714-mafw-*.tgz     # 覆盖旧版本（Windows cmd 下通配符不展开，需显式文件名）
```

**注意事项：**
- `prepare` 有 fail-open 守卫（2026-09-14）：gateway devDeps（gateway/node_modules/typescript）缺席时跳过 build——干净 `npm ci` 时 postinstall 只装 gateway prod deps，若此时强行 build 会静默借用 root 的 TS 5.6.3 编 gateway（module:nodenext 的 ESM 导入全报 TS1479；TS 5.8+ 才有 require(esm) 宽容）。CI/publish 流程的 build 由显式步骤在 gateway `npm ci` 之后执行
- 全局安装路径可通过 `npm config get prefix` 查看
- 安装后 `mafw` 命令在 PATH 中，如果 shell 找不到请刷新 PATH（新开终端或重启 shell）
- `.npm-global` 路径下的文件名为 `mafw`（无后缀）、`mafw.cmd`、`mafw.ps1`，对应不同 shell

Desktop 构建：根 `npm install` 后 `cd packages/desktop && npx electron-vite build`（`@mafw/sdk` 经 workspaces 解析到 `packages/gateway-sdk/`）。

### HTTP 路由注意事项

Gateway API 路由使用正则匹配，query string 会导致 `$` 锚定不匹配：
- 正确：`req.url?.match(/^\/api\/sessions\/([^/]+)\/messages(?:\?|$)/)`
- 错误：`req.url?.match(/^\/api\/sessions\/([^/]+)\/messages$/)`（不匹配 `?limit=100`）

### GitHub Actions CI（2026-09-14）

三个独立 workflow（`.github/workflows/`）：
- `ci.yml`：push(main)/PR → 双 OS（ubuntu/windows）× Node 22 验证——root+gateway 两段 `npm ci`、root build、gateway jest、TUI node --test、gateway-sdk / session-ui / ui / desktop 四包 node --test（2026-10-21 起，经 `@mafw/test-shim`）；concurrency 按 ref 取消旧跑
- `desktop-release.yml`：tag `v*` → Win(nsis)+Linux(AppImage/deb/rpm) 打包（node stage-gateway + electron-builder `--publish never`，`OPENCODE_CHANNEL=prod` 走 env 块）→ release job 汇总挂 **draft release**（softprops）；workflow_dispatch = 构建-only 干跑；electron 缓存按 OS 分路径
- `npm-publish.yml`：仅手动 dispatch；`NPM_TOKEN` 缺失时绿 skip，配置后 `npm publish --provenance`

注意：desktop `electron-builder.config.ts` 的 `native/` extraResource 有 `existsSync` 守卫（仓库不携带该目录）；desktop `npm test` = node --test + `@mafw/test-shim`（2026-10-21 自 bun 迁移），已入 CI（root `npm run test:desktop`）；已知坏的 legacy launcher 用例已随迁移移除。
