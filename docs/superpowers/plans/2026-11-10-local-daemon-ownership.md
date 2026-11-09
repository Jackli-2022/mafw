# 本地 gateway 所有权：一个数据目录，一个实例

- 日期：2026-11-10（按「desktop-dev 不单独开数据目录」重写）
- 背景：desktop `npm run dev`（`electron-vite dev`）启动后，与已运行的全局 gateway 争
  3000；现有 `devAdopt` 静默采纳、跳过握手；并发启动无仲裁。
- 调研：`docs/research/2026-11-10-local-daemon-ownership-research.md`

## 进度（2026-11-10，分支 `feat/gateway-kernel-scheduler`）

| 任务 | 状态 | commit | 验证 |
|---|---|---|---|
| T0 attach 握手 / attached 状态 / `/health` pid | done | `58ef6471` | desktop 3158/3158，gateway 5223/5223 |
| T1 `instance-lock` 锁原语 | done | `2036e700` | 10 个锁测试；gateway `tsc -p` rc=0 |
| T2 discovery + 自登记 + defer | done | `83bb8f6c` | gateway 5250/5250；temp-home 冒烟：首实例 port/pid 一致，kill 后第二实例接管 |
| T3 Desktop 读 discovery / 不再写登记 | done | `eaae6699` | desktop 3171/3171；pid/instanceId 对账；并发 loser attach |
| T4 用当前构建重启 | done | `ace7b89d` | desktop 3177/3177；仅允许 discovery + /health 身份匹配的实例 |
| T5 协议版本协商 | pending | — | — |
| T6 CI 集成门禁 | pending | — | — |

T0–T4 的 `tsgo -p` / `tsc -p` 均 rc=0。未推送远端。

## 0. 一句话模型

**`~/.mafw` 是单写者资源：一个数据目录同时只能有一个 gateway。**
Desktop 不是要再起一个，而是先发现这个 gateway：能连就连接，不能连就明确告诉用户
该怎么重启；只有不存在时才启动。

## 1. 三个角色

| 角色 | 职责 |
|---|---|
| **Gateway** | 唯一所有者。`bind` 前拿锁，`listen` 后写 `gateway.json`，心跳，退出释放 |
| **Desktop** | 客户端 / 监督者。读发现文件 → 握手 → attach；没有 → spawn；不写所有权记录 |
| **全局 daemon** | 只是「已经存在的那个 gateway」，没有特殊地位；`mafw daemon` 启动的普通实例 |

## 1.1 OpenCode V2 对照（已验证）

OpenCode V2 是同一模型的现成实现。本机实际注册文件：

```json
// ~/.local/state/opencode/service.json
{ "id": "2846d269-…", "version": "2.2.5",
  "url": "http://127.0.0.1:28894", "pid": 21544, "password": "…" }
```

| 维度 | OpenCode V2 | 我们的计划 |
|---|---|---|
| 架构 | TUI/Desktop 是 client，background service 是 server | Desktop 是 client/supervisor，gateway 是 server |
| 发现 | `service.json`（`id/version/url/pid/password`） | `gateway.json`（`instanceId/version/port/pid/…`） |
| 启动 | `Service.discover()` 找不到 → `Service.ensure()` 启动 | Desktop 先读发现 → 没有就 spawn |
| 单例 | 一个 state dir 一个 service；并发 client 收敛到一个 | 一个 `~/.mafw` 一个 gateway；锁 |
| 端口 | 平台默认（Win 28894 / Unix 49374），实际 URL 写文件 | 默认 3000，实际端口写文件 |
| 身份 | `GET /api/info` 校验 `pid` + `version`，不是任意 200 | `/health` 校验 `pid`/`instanceId` + version |
| 版本 | 兼容 predicate；需要时可替换旧 service | 握手；默认 conflict + 显式重启 |
| 生命周期 | `service status/start/stop/restart`；`--standalone` | 锁 + 重启动作；standalone 后补 |
| 认证 | 注册文件带随机 password，HTTP Basic | 目前 loopback 信任 + 可选 apiToken |

### 必须抄的三条

1. **健康检查绑定 identity**：`/health` 返回的 `pid`/`instanceId` 必须与发现文件一致；
   只看 HTTP 200 会被任意本机服务骗过。404 / 缺字段 = 协议不兼容，不是「端口被占」。
2. **端口从发现文件读**：3000 只是默认值；Desktop/TUI/CLI 必须读 `gateway.json.port`，
   读不到才回落 3000。手机/Tailscale 仍用固定入口。
3. **发现路径常量共享**：OpenCode 曾因 CLI 写 `service-prod.json`、Desktop 读
   `service.json` 而永远找不到服务（issue #60676）。`gateway.json` 的路径必须由
   gateway 与 client 共用同一个模块/常量，并有测试锁住。

### 另外两个可抄的细节

- **`discover` / `ensure` 分层**：`discover()` 只读 + 探测，不启动；`ensure()` 才启动。
- **restart 只重启自己注册的实例**：没有 `gateway.json` 或 pid/启动时间对不上，
  不杀进程，只给 `mafw stop` / `mafw restart` 提示。

## 2. 之前为什么乱

把三件事混成了一个「端口 + 健康检查」的判断：

1. **所有权**：谁在服务？
2. **版本**：服务的是不是我期望的构建？
3. **生命周期**：谁启动、谁停止、退出时杀不杀？

于是 `devAdopt` 用一个布尔同时表达三件事：跳过版本检查、借用别人的进程、退出不杀。
再叠加「给 dev 开独立数据目录」，等于用数据隔离绕开所有权问题——但 `~/.mafw` 本来就是
单写者，dev 不需要也不应该再开一份。

## 3. 硬约束（决定了不能做什么）

1. **一个 `~/.mafw` 只能有一个 gateway。** SQLite、记忆管线、Goal 状态、后台任务都是单写者。
   两个 gateway 同时写同一个 `gateway.db` 会以「莫名丢会话/丢记忆」的形式出现，不可接受。
2. **端口不是所有权。** 端口只是 gateway `bind` 成功后的事实；用「端口被占」判断谁拥有数据目录，
   正是当前所有竞态的根源。
3. **版本不同不能靠「再起一个」解决。** 数据目录只有一个，所以只能：连接兼容的旧实例，
   或者停掉它、用新构建重启。没有「dev 版本与 prod 版本并存」这种合法状态。
4. **Desktop 不拥有 gateway。** 全局 daemon 可能先于 Desktop 存在；Desktop 退出时不应该
   杀死不是自己启动的进程。

## 4. 目标行为

### desktop-dev

| 现状 | 行为 |
|---|---|
| 有 gateway，握手通过 | **attach**；版本不同只警告，状态显示「已连接 gateway vX」 |
| 有 gateway，但比仓库期望旧 | **conflict**：`running 5.1.0, expected 5.2.0`；提供「用当前构建重启 gateway」动作 |
| 有 gateway，schema / experience 不兼容 | **conflict**：明确字段与重启动作，绝不静默连接 |
| 没有 gateway | **spawn** 仓库 `gateway/dist`；子进程拿锁、bind、写 `gateway.json` |
| 两个 desktop-dev 同时启动 | 一个拿锁并 bind；另一个 `deferred` → 读赢家的 `gateway.json` → attach |
| gateway 崩溃 | pid / 启动时间 / 心跳失效 → 下次启动接管 |

### desktop-packaged

保持现有产品约束：**只信任与安装包同一发布单元的 managed gateway**。
如果 3000 上是未登记的全局 daemon：

- 兼容也不自动 attach（避免信任任意本机进程）；
- 报 `conflict`，文案给出 pid / port / version，以及两条出路：
  「停止全局 gateway」或「显式切换 external」。

### 想跑仓库最新 gateway 代码

不是「再起一个」，而是**替换唯一实例**：

```bash
# 方式一：停掉当前 gateway，再启动 desktop dev（Desktop 会 spawn 仓库构建）
mafw stop
npm run dev

# 方式二：更新全局安装后重启（当前 t1 工作流）
npm run build
npm pack
npm i -g ./jack200714-mafw-*.tgz
mafw restart
```

Desktop 提供等价按钮：「Restart gateway with this build」——只在能读到
`gateway.json` 且 pid / 启动时间校验通过时可用；legacy 实例只显示 CLI 命令。

## 5. 机制

### 5.1 锁：`~/.mafw/runtime/gateway.lock`

Gateway 自己持有，Desktop 不写。

1. `mkdir -p ~/.mafw/runtime`，以 `wx`（O_EXCL）创建 `gateway.lock`。
2. 写入 `{pid, processStartTime, startedAt, heartbeatAt, nonce}`。
   `processStartTime = Date.now() - process.uptime() * 1000`，判定容差 ±2s。
3. 创建失败 → 读现有锁：
   - pid 不存在 → 陈旧，删除后重试（最多 3 次，随机退避）；
   - pid 存在但启动时间不匹配 → pid 复用，视为陈旧；
   - 匹配且心跳未过期 → 有活着的持有者。
4. 持有者每 10s 更新 `heartbeatAt`；30s 未更新视为过期。
5. 优雅退出删除锁与 `gateway.json`；崩溃靠 pid / 启动时间 / 心跳判定。

**锁竞争失败不再 `exit 0` 了事**：输出一行
`{"mafw":"deferred","instance":{pid,port,version,...}}`，退出 0；
Desktop 据此决定 attach 还是 conflict。

### 5.2 发现：`~/.mafw/runtime/gateway.json`

Gateway 在 `listen` 成功之后原子写入（临时文件 + rename）：

```json
{
  "instanceId": "…",
  "pid": 12345,
  "port": 3000,
  "gatewayVersion": "5.1.0",
  "experienceVersion": "2026.11.1",
  "minimumClientExperienceVersion": "2026.11.0",
  "schemaEpoch": 1,
  "channel": "dev",
  "distribution": "desktop-managed",
  "origin": "desktop-dev",
  "startedAt": "…",
  "heartbeatAt": "…"
}
```

- `origin` 只用于诊断（`standalone` / `desktop-packaged` / `desktop-dev`），**不参与分区**。
- 退出删除；崩溃后由下一个实例覆盖。
- 旧版本 gateway 没有这个文件 → Desktop 回落到 `127.0.0.1:3000` + `/health` 身份探测，
  只给 warning，不阻断（迁移期）。

### 5.3 Desktop 启动决策

```
1. 读 gateway.json
   ├─ 心跳新鲜 → candidate
   └─ 过期/损坏 → 忽略
2. 没有 candidate → probe 127.0.0.1:3000
   ├─ /health + 必需字段像 MAFW → candidate（legacy，warning）
   ├─ 端口被非 MAFW 进程占用 → conflict(port-conflict)
   └─ 无 → spawn
3. 有 candidate → negotiateGateway({ mode: "external" })
   ├─ ok → attach（版本不同 → warning）
   ├─ older-than-required → conflict(gateway-outdated) + restart 动作
   ├─ schema-mismatch / experience-incompatible → conflict + restart 动作
   └─ legacy-unversioned → 现有 legacy 覆盖逻辑（dev 可显式放行）
4. spawn → 子进程拿锁
   ├─ 拿到 → bind → 写 gateway.json → ready
   └─ 拿不到 → 读赢家 gateway.json → deferred → 回到第 3 步
```

**关键点**：所有权判断只发生在 gateway 侧（锁 + 自登记）；Desktop 只消费事实，
不再单方面写 `gateway-instance-registry`。

### 5.4 迁移期（当前全局 daemon 还是旧版）

旧 daemon 不拿锁、不写 `gateway.json`，所以：

- Desktop 通过 `probe(3000)` 仍能发现它 → attach；
- 如果此时又 spawn 了一个新 gateway，新 gateway 会先拿到锁，但 bind 失败；
  它必须 `probe(3000)` 确认是 MAFW → 写 `deferred`、释放锁、退出 0；
  Desktop 回到 attach。**不能**因为「锁在我手里」就认为端口也归我。
- 旧 daemon 被升级/重启后，锁与发现文件自动接管。

## 6. 任务

### T0 修正 attach 语义（先做，不动锁）

- 删除 `devAdoptRunningGateway` 的「跳过握手直接 ready」分支。
- dev 发现已有 gateway 时统一走 `negotiateGateway({ mode: "external" })`：
  - 兼容 → attach；
  - 旧于期望 / schema 不符 → `conflict`，detail 带 `running/expected` 与重启建议。
- `/health` 增加 `pid`（与 `instanceId` 同级）；缺 `gatewayVersion` / `schemaEpoch`
  视为 legacy，dev 不允许静默 attach。完整 `pid` / `instanceId` 对账在 T3 有
  `gateway.json` 后做。
- `GatewayStatus` 增加 `attached: boolean`、`attachedOrigin: string | null`；
  Config 页显示「已连接外部 gateway（vX，origin）」。
- `MAFW_DEV_ADOPT=0` 先保留为「不要 attach，报 conflict 并提示先停止现有 gateway」，
  下一轮再决定是否删除（不做隐式 takeover）。
- 测试：attach 兼容、旧版本被拒、schema 不符被拒、legacy 被拒、状态字段正确。

验收：全局 daemon 在跑时，desktop dev 不再静默连接不兼容实例；
兼容时 ready 且明确显示「attached」。

### T1 锁原语

- 新增 `gateway/src/runtime/instance-lock.ts`：
  `acquireInstanceLock({dir, pid, startTime, now})` / `heartbeat()` / `release()` /
  `readLock()` / `isStale()`。
- 注入时钟 / pid 探测器，纯函数可单测。
- 测试：并发 acquire、陈旧 pid、pid 复用（启动时间不符）、心跳过期、崩溃接管。

验收：同一目录两个并发 acquire 只有一个成功；另一个返回 `{deferred, holder}`。

### T2 gateway 自登记 + 发现

- 新增 `gateway/src/runtime/gateway-discovery.ts`：原子写 / 读 / 过期判定。
- 发现文件字段对齐 OpenCode：`instanceId`、`pid`、`port`、`gatewayVersion`、
  `experienceVersion`、`minimumClientExperienceVersion`、`schemaEpoch`、`channel`、
  `distribution`、`origin`、`startedAt`、`heartbeatAt`、`nonce`。
- **路径常量共享**：`gateway.json` / `gateway.lock` 的路径由一个模块导出，
  gateway 与 Desktop 共用；测试锁住路径，避免 OpenCode `service-prod.json` 那类漂移。
- `start()` 最前面：`acquireInstanceLock(~/.mafw/runtime)`。
- 拿不到锁：
  - 读 `gateway.json` → 输出 `deferred` JSON → 退出 0；
  - 没有发现文件但锁活着 → 等待最多 5s（对方可能正在 bind），仍无 → 退出码 3。
- 拿到锁：`listen` 成功后写 `gateway.json`，每 10s 心跳；
  `SIGINT` / `SIGTERM` / 正常 stop 释放。
- 删除当前「`isPortHealthy` 即 `exit 0`」的隐式互斥；bind 失败时按 5.4 处理。
- 测试：写/读/过期、原子性、退出清理、bind 失败 deferred。

验收：`~/.mafw/runtime/gateway.json` 的 `port` 与真实监听端口一致；
kill -9 后 15s 内锁可被接管。

### T3 Desktop 读发现 + 不再写登记

- 拆成 `discoverGateway()`（只读 + 探测，不启动）与 `ensureGateway()`（没有才 spawn）。
- `discoverGateway` 先读 `gateway.json`，再回落 `probe(3000)`（迁移期）；
  读到后校验 `pid` / `instanceId` 与 `/health` 一致。
- `spawnManagedGateway` 不再写 `gateway-instance-registry`；
  `gateway-instance-registry.ts` 降级为只读（或删除）。
- `planGatewayStart` 去掉 `devAdopt` 特例，统一为：
  `attach` / `spawn` / `conflict`（含 `gateway-outdated`）。
- **端口从发现文件读**：3000 只作 fallback；Desktop 的 `GATEWAY_URL` 不再写死。
- 测试：发现文件优先、pid/instanceId 不符被拒、legacy 回落、spawn 后 attach、
  两个 desktop 并发时第二个 attach。

验收：删除 `~/.mafw/runtime/desktop-gateway` 后功能不受影响；
`gateway.json` 是唯一事实源。

### T4 重启动作（显式替换）

- `GatewayStatus` 增加 `canRestartWithLocalBuild` 与 `restartHint`。
- 新增 `restartGatewayWithLocalBuild()`：
  - 读 `gateway.json`，校验 pid + 启动时间 + MAFW identity；
  - `SIGTERM` → 等端口释放（最多 8s）→ spawn 本地构建；
  - 失败则回退到 `restartHint`（`mafw stop` / `mafw restart`）。
- **只重启自己注册的实例**：没有 `gateway.json`、pid 不符或启动时间不符 → 拒绝，
  文案 “this gateway wasn't started by MAFW”（对齐 OpenCode `service restart`）。
- 不实现「自动杀未登记进程」；legacy 实例只给命令。
- 测试：可重启判定、pid 不符拒绝、SIGTERM 后重新 spawn。

验收：仓库版本高于运行中 gateway 时，Desktop 能一键「用当前构建重启」并 ready。

### T5 协议版本协商

- `/health` 与 `gateway.json` 增加 `apiVersion` / `minApiVersion` / `capabilities`。
- `negotiateGateway` 改为区间协商；`schemaEpoch` 不等才硬拒。
- 旧 desktop 只认 `gatewayVersion` 时仍可工作（缺失字段 → legacy warning）。

验收：旧 desktop 连新 gateway 不报错，只少显示新能力。

### T6 门禁

- 单测：锁、发现、attach 决策、restart 判定。
- 集成：并发启动、崩溃接管、legacy 回落、版本不符 conflict。
- CI：`npm test` + `npm run test:desktop`。

## 7. 验收矩阵

| 场景 | 期望 |
|---|---|
| 无 gateway，desktop dev 启动 | spawn 仓库构建；`gateway.json` 出现；ready |
| 全局 daemon 在跑，desktop dev 启动 | attach；状态显示「已连接 vX」；不 spawn、不冲突 |
| 全局 daemon 旧于仓库期望 | conflict 带 `running/expected`；可一键重启；不静默连接 |
| 两个 desktop dev 同时启动 | 一个 spawn；另一个 deferred → attach |
| gateway 被 kill -9 | 下次启动接管锁；发现文件被覆盖 |
| 全局 daemon 在跑，desktop packaged 启动 | conflict；文案给 pid/port/version 与两条出路 |
| 删除 `~/.mafw/runtime/desktop-gateway` | 功能不受影响 |
| 旧 desktop + 新 gateway | 可连接，仅警告版本偏差 |

## 8. 明确不做

- **不给 desktop-dev 独立数据目录**；它和全局 daemon 共用 `~/.mafw`。
- **不做多命名空间 / 多实例并存**；数据是单写者。
- **不做动态端口**；唯一实例默认 3000，端口冲突就是真实冲突。
- **不让 Desktop 写所有权记录**；锁与发现文件只由 gateway 自己写。
- **不在未握手的情况下 attach**；也不自动杀未登记进程。

## 9. 顺序

T0 → T1 → T2 → T3 → T4 → T5 → T6。

- T0 先消除「静默采纳」；即使还没有锁，行为也先变正确。
- T1/T2 是 gateway 侧原语，可独立测试、独立合并。
- T3 让 Desktop 只读事实；T4 才提供显式替换。
- T5/T6 是协议与门禁。

T0 不做的话，T1/T2 做完后 Desktop 仍可能在版本不符时静默连接——这是最危险的中间状态。
