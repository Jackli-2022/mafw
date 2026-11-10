# 本地常驻服务的所有权、版本与端口：业界做法调研

- 日期：2026-11-10
- 触发问题：`npm run dev` 与已运行的全局 gateway 抢 3000；受管模式对未登记进程一律 conflict；
  版本精确相等导致 dev 反复冲突。

## 1. 我们的问题拆成五个子问题

| # | 子问题 | 我们当前的做法 | 失败表现 |
|---|---|---|---|
| Q1 | 客户端发现服务 | 固定 TCP `127.0.0.1:3000` + `GET /health` | 任何进程占用 3000 就 conflict；无法多实例 |
| Q2 | 谁启动/谁停止 | 打包版 managed 自己 spawn，退出时杀；dev 采纳 | 全局 daemon 在跑时 dev 抢端口，被采纳前 child 先 `exit 1` |
| Q3 | 版本不匹配 | `gatewayVersion` **精确相等**（managed）+ `schemaEpoch` | 仓库 dist 与全局 daemon 不同版就 conflict；dev 每次改网关都要重启全局 daemon |
| Q4 | 并发启动 | 无锁，靠"端口已被占用"隐式互斥 | 两个 Desktop 同时启动时竞态（后到者 1.5s 后退出） |
| Q5 | 多客户端共享 | 无状态 HTTP + SSE 多路复用 | 这点是对的，业界同样做法 |

## 2. 结论摘要（先给答案）

1. **固定端口不是主流做法**。长期来看，本地服务用 **UDS / 命名管道 + 发现文件** 是标准解；
   固定端口只在"必须被浏览器访问"时才保留。
2. **"版本不等就冲突"是少数派**。主流是三种：版本化并存（Gradle / VS Code）、
   协商降级（Docker）、杀掉重起（Bazel）。只有我们选择了拒绝服务。
3. **单例靠锁文件 + pid 存活校验**，不靠端口占用（Chrome 是教科书实现）。
4. **开发版与安装版并存靠命名空间隔离**（VS Code 按 commit 分目录、Electron 按 userData 分锁），
   不是靠"检测到冲突就报错"。
5. **版本偏差只警告不阻断**（Tailscale），因为本地 IPC 的双端本来就常常不同步。

## 3. 案例事实

### 3.1 Chrome / Chromium —— 锁文件 + pid 校验 + 转发

- `SingletonLock` 是一个符号链接，内容是 `hostname-pid`；它在**绑定 socket 之前**创建，
  保证只有一个实例能持有 socket。
- 第二个实例 `readlink` 得到 host+pid：pid 已死 → 判定孤儿锁，删除后自己接管；
  pid 存活但不是 Chrome → 同样接管；是 Chrome → 通过 socket 发送
  `START\0cwd\0argv...\0`，等 `ACK`；超时无响应则杀进程再接管。
- socket 放在 0700 权限的临时目录，锁 + socket + cookie 三件套。
- 源码：`chrome/browser/process_singleton_posix.cc`（chromium.googlesource.com）

**要点**：单例的正确判据是「锁文件里的 pid 是否真是同类进程且存活」，而不是「端口是否被占」。

### 3.2 Electron —— 单例按 userData 目录隔离

- `app.requestSingleInstanceLock()` 的锁落在 userData 目录里；不同 userData 就是不同实例。
- `--user-data-dir=...` 因此被广泛用于"同一 app 跑多个独立实例"（Slack/Discord/Teams 多账号）。
- 第二个实例把 argv 转发给第一个（`second-instance` 事件）后退出。

**要点**：隔离维度是**数据目录**，不是端口；给了我们"dev 与安装版并存"的直接模板。

### 3.3 Gradle Daemon —— 版本/JVM 参数完全一致才复用

- 客户端只复用 **Java home + JVM args + Gradle 版本都相同**的 daemon，否则新起一个。
- 因此同一台机器可以同时存在多个版本的 daemon；`gradle --status` 只列同版本，
  `gradle --stop` 只停同版本。
- 空闲 3 小时自动退出（`org.gradle.daemon.idletimeout`）。

**要点**：多版本共存是被显式接受的，而不是被当作错误。

### 3.4 Bazel —— 每 workspace 一个 server，版本不符就杀

- output base（默认由 workspace 路径 + uid 决定）里放 `lock` 文件，客户端持有**独占文件锁**
  （fcntl / LockFileEx），并发命令默认阻塞等待（`--block_for_lock`）。
- 客户端连上已有 server 后**先校验版本**：版本或启动参数不符 → `KillRunningServer()`
  再起新的（`EnsureCorrectRunningVersion`）。
- `--batch` 是逃生舱：不常驻，跑完即退。
- 空闲 3 小时退出（`--max_idle_secs`）。

**要点**：版本不匹配的默认动作是"替换"，不是"报错让用户处理"。

### 3.5 Docker Engine —— 协议版本协商

- 客户端与 daemon 版本可以不同；`/_ping` 返回 `ApiVersion` / `MinAPIVersion`，
  客户端取双方支持的最高共同版本，必要时降级。
- API 版本与产品版本解耦（Engine 28.x 可以服务 API 1.48）。
- 版本前缀在 URL（`/v1.47/containers/...`），`DOCKER_API_VERSION` 可强制钉住。

**要点**：如果协议本身向后兼容，就不需要产品版本相等。

### 3.6 Tailscale —— UDS + 版本头 + 只警告

- 控制面走 `local-tailscaled.sock`（UDS），不占 TCP 端口。
- 每个响应带 `Tailscale-Version` 头；客户端注册 `SetVersionMismatchHandler`，
  只在首次不匹配时打一条 warning，**不阻断**。
- 另带 `Tailscale-Cap`（能力版本号），用于能力判定。

**要点**：版本偏差是常态，处理方式是"告知 + 能力门控"，不是拒绝连接。

### 3.7 Jupyter —— 发现文件（端口 + token + pid）

- 服务端启动时把 `{url, port, token, pid, root_dir, version}` 写进
  `JUPYTER_RUNTIME_DIR/jpserver-<pid>.json`（权限仅当前用户）。
- 客户端扫描目录、校验 pid 存活、拿 token 连接；端口可以随机，不要求固定。
- 支持 `ServerApp.info_file` 自定义路径供编排系统消费。

**要点**：**端口是运行时事实，不是约定**；发现文件承载端口 + 凭据 + 版本。

### 3.8 VS Code Server —— 按构建号分目录，多版本并存

- 远端安装到 `~/.vscode-server/bin/<commit>/`（新版 `cli/servers/Stable-<commit>/server`）。
- 每个客户端版本对应一个目录，因此同一台机器上旧版/新版 server 可以共存，
  客户端只连自己 commit 的那个。
- 客户端与服务端要求版本一致（commit 级），但通过"各装各的"实现，而不是互斥。

**要点**：**版本进路径**是解决 dev/多版本共存最省事的办法。

### 3.9 Ollama —— 反面教材

- 固定 `127.0.0.1:11434`，无协商；桌面 app 内嵌 server，CLI `ollama serve` 再启一个就
  `bind: address already in use` 直接退出。
- 多实例只能靠 `OLLAMA_HOST=127.0.0.1:11435` 手动换端口，且所有客户端都要跟着改。
- 社区因此长期存在"为什么我起不来"的困惑。

**要点**：这正是我们当前形态；固定端口 + 无发现文件 + 无锁 = 用户自己排查端口。

## 4. 模式归纳

| 模式 | 代表 | 适用前提 | 代价 |
|---|---|---|---|
| **锁文件 + pid 校验 + 转发**（单例） | Chrome, Electron | 同一份数据只允许一个写者 | 需要可靠的 pid 存活判定 |
| **版本化并存**（多实例） | Gradle, VS Code | 各版本资源可独立安装 | 磁盘/内存随版本数增长 |
| **协商降级** | Docker, Tailscale | 协议向后兼容，有 min/max 版本 | 需要维护协议版本与能力位 |
| **版本不符即替换** | Bazel | 服务可随时重启且状态可恢复 | 重启会打断在跑的客户端 |
| **发现文件**（端口/token/pid） | Jupyter, 本仓库 `instances/*.json` | 服务端可写用户目录 | 需要清理陈旧文件 |
| **本地 IPC 优先**（UDS/命名管道） | Tailscale, snapd, 1Password | 只服务本机进程 | Windows/macOS/Linux 三套实现 |
| **OS 凭据鉴权** | snapd, MariaDB | 同机跨用户隔离 | 平台 API 差异（SO_PEERCRED / LOCAL_PEERCRED / 命名管道 ACL） |

## 5. 对照我们的实现

| 维度 | 我们 | 业界主流 | 差距 |
|---|---|---|---|
| 发现 | 固定 3000 + `/health` | 发现文件 / UDS | 端口冲突即不可用；无随机端口能力 |
| 单例 | 端口占用隐式互斥 | 锁文件 + pid + 转发 | 无锁；并发启动靠"谁先 bind" |
| 版本 | managed 精确相等 | 协商 / 并存 / 替换 | dev 场景过严（已用 `MAFW_DEV_ADOPT` 缓解，但仍是布尔级） |
| 多版本 | 一份 `gateway/dist` | 版本进路径 | 切分支跑 dev 会和全局 daemon 打架 |
| 版本偏差反馈 | conflict 状态 + 文案 | 警告 + 能力门 | 我们更"硬"，用户被迫决策 |
| 鉴权 | loopback 信任 + apiToken | OS 凭据 | 本机跨用户场景无隔离 |
| 多客户端 | HTTP + SSE 广播 | 同 | 一致，无需改 |
| 空闲退出 | 无 | 3h（Gradle/Bazel） | 常驻合理（我们是产品的一部分），可不做 |

## 6. 可选方案

### 方案 A：锁 + 自登记（小改动，推荐先做）

前提：**`~/.mafw` 是单写者资源，一个数据目录只能有一个 gateway；desktop-dev 不单独开数据目录。**
因此不做多命名空间、不做动态端口、不做多版本并存。

1. **启动锁**：`~/.mafw/runtime/gateway.lock`
   （`{pid, processStartTime, startedAt, heartbeatAt, nonce}`），bind 前 `wx` 创建；
   持有者退出时删除；按 pid 存活 + 进程启动时间 + 心跳判定，陈旧则接管。
2. **gateway 自登记**：`listen` 成功后由 gateway 自己写 `gateway.json`（实际 port + identity），
   每 10s 心跳；Desktop 只读，不再单方面写实例记录。
3. **attach 优先**：已有 gateway 时 Desktop 先握手；兼容则连接，版本偏差只警告。
4. **版本不符显式替换**：不自动杀进程；提供「用当前构建重启 gateway」动作，
   或让用户执行 `mafw stop` / 更新全局安装后 `mafw restart`。

### 方案 B：发现文件（随 A 一起做，不再等中期）

1. gateway 启动后写 `~/.mafw/runtime/gateway.json`：`{port, pid, gatewayVersion,
   schemaEpoch, experienceVersion, instanceId, channel, origin, heartbeatAt}`。
2. Desktop/TUI/CLI 一律先读发现文件，读不到再退回 3000（兼容旧实例）。
3. `MAFW_SERVER_API_PORT` 仍可覆盖（CI/测试），但不再是唯一事实。
4. 需要同步改：`@mafw/sdk` 的 URL 解析、mobile 配对、`mafw health`。

风险：移动端/Tailscale 场景必须能访问固定端口，发现文件只解决本机；因此 **TCP 不能删**，
只能是"本机客户端优先发现文件，远端仍用固定端口"。

### 方案 C：本地 IPC 主通道 + 协议版本协商（长期）

- Windows 命名管道 `\\.\pipe\mafw-<user>` / Unix `$XDG_RUNTIME_DIR/mafw.sock`（0700），
  用 OS 凭据鉴权，替代 loopback 信任 + apiToken。
- 引入 `apiVersion` + `minApiVersion`（Docker 模式），响应头带 `Mafw-Version`、`Mafw-Cap`
  （Tailscale 模式），客户端只警告不阻断。
- 成本高（三平台 IPC + 全部客户端改造），只有在"本机多用户/不可信进程"成为真实威胁时才值得。

## 7. 建议

- **立刻做 A + B**：锁、自登记、发现文件一起做。它们解决的是
  「dev 与全局 daemon 抢 3000 + 并发启动 + 版本不符时静默连错实例」三个真实痛点，
  改动集中在 `mafw-sidecar.ts` / `mafw-gateway-plan.ts` / gateway 启动路径，不动协议。
- **不做多命名空间 / 动态端口 / dev 独立数据目录**：`~/.mafw` 是单写者资源，
  两个 gateway 同时写同一个 SQLite 会以「莫名丢会话」的形式出现；dev 与 prod 只能共用
  同一个 gateway，靠 attach 或显式重启来切换版本。
- **C 暂不做**：当前威胁模型是"本机可信"，收益不足以覆盖三平台 IPC 的复杂度。

## 8. 待决问题

1. **数据目录：已决定共享 `~/.mafw`。** desktop-dev 与全局 daemon 是同一个单例的候选，
   不引入 `channel` 级数据目录；版本切换靠重启唯一实例。
2. 空闲退出是否要做？如果 Desktop 关闭后 gateway 继续跑，锁文件必须能在崩溃后自愈。
3. 发现文件里的 token 是否要引入？现在是 loopback 信任 + 可选 apiToken；
   发现文件至少应限制为当前用户可读（0600）。
