# Desktop 受管 Gateway 与联动发布设计

- 日期：2026-11-09
- 状态：待批准
- 取代：`2026-09-17-desktop-installer-gateway-update-design.md` 中“NSIS 安装时更新全局 npm gateway”的产品决策
- 范围：Desktop 安装/升级、Desktop 默认使用的 gateway、二者的版本协商与发布产物
- 技术方向（用户已同意）：保留 Electron 与现有 TypeScript gateway，采用受管 sidecar；本轮不追求单文件原生重写

## 1. 意图

用户在安装或升级 Desktop 后，应当默认运行与该 Desktop 同发布单元交付的 gateway，而不是继续无感知地使用旧全局 npm 包或旧运行进程。

成功的定义：

1. 全新安装后，无系统 Node、无 npm、无网络时，Desktop 能启动安装包自带的 gateway。
2. 从旧 Desktop 升级后，旧全局 CLI 或旧运行进程不会静默压过新内置 gateway。
3. Desktop 更新下载完成后，用户可立即重启安装，也可在退出应用时自动安装；更新不会在一次会话中途无提示强杀。
4. gateway 文件以版本目录安装、校验、切换；启动失败有明确的恢复路径。
5. Desktop 与 gateway 的版本、Experience 兼容状态和实际运行来源可见、可诊断。

这不只是补一个安装器钩子，而是把 gateway 的版本所有权收敛到 Desktop。

## 2. 当前事实与根因

### 2.1 已有能力

- `packages/desktop/scripts/stage-gateway.ts` 已把 `gateway/dist`、生产 `node_modules`、voice sidecars 和 Electron ABI 的 `better-sqlite3` 放入安装资源。
- packaged app 通过 `ELECTRON_RUN_AS_NODE=1` 启动内置 gateway；仅就 gateway 本身而言，无需系统 Node。
- `electron-updater` 已有检查、下载、状态持久化与 `quitAndInstall` 控制器。

### 2.2 根因

1. `mafw-gateway-plan.ts` 的顺序是 adopt → global CLI → bundle，且不比较版本。
2. `stopGateway()` 只停止 bundled child；CLI/adopted 的“重启”通常重新收养旧进程。
3. Windows NSIS 只尝试更新已存在且更旧的全局 npm 包；fresh install 跳过，macOS/Linux 无等价物，且依赖 Node/npm/网络/registry。
4. Desktop updater 当前 `autoInstallOnAppQuit=false`，Windows/Linux 没有清晰的更新安装入口。
5. gateway 的 `update` 对全局/内置安装只是重启现有 `dist`，不会取得新制品。
6. `/health` 不提供发布版本；现有 Experience 协商不是启动时的版本准入控制。
7. Desktop staging 与 npm/deploy-local 的资产清单不同，且 bundle 使用 `npm install` 而不是锁文件安装。

## 3. 目标、非目标与反目标

### 3.1 本轮目标

- Desktop 受管 gateway 成为默认且优先的运行来源。
- 安装包离线携带同发布单元的 gateway，不再依靠 NSIS 调 npm 更新。
- 启动时进行发布版本与 Experience 握手。
- Desktop 更新在全平台提供“重启以更新”，并允许退出时自动安装已下载更新。
- gateway 在用户数据目录按版本安装，原子切换并保留上一版用于受控恢复。
- 打包资产、锁文件、签名与 packaged smoke 纳入发布门禁。

### 3.2 非目标

- 不重写 Desktop 为 Tauri/Rust，不把 gateway 重写为 Go/Rust。
- 不承诺真正单文件的 `gateway.exe`；Node SEA/Bun 仅保留后续 spike。
- 不自动升级、停止或卸载用户独立维护的全局 npm `mafw`。
- 不在本轮捆绑 `opencode`、Python、git、llama-server 或模型文件；因此“gateway 可启动”不宣称“完整 agent 栈零外部依赖”。
- 不建立独立于 Desktop 的 gateway 在线 hotfix 通道；版本目录为未来该能力打底。
- 不在本轮承诺 macOS 签名/公证凭据与 macOS CI job 的运维落地；设计行为跨平台一致，凭据配置是发布运维前置条件。

### 3.3 反目标（即使看似方便也避免）

- 旧进程只要健康就无条件优先。
- 为升级 Desktop 而静默杀掉用户的外部 gateway。
- 安装过程必须联网下载同一版本 npm 包。
- 未校验签名或 payload 就自动执行更新。
- 把“重启当前 dist”称为“下载并安装更新”。
- 数据格式已迁移后，仍宣称可以无条件回滚到旧代码。

## 4. 核心决策：一套发布，一个默认属主

### 4.1 来源模式

Desktop 配置增加：

```ts
type GatewaySourcePreference = "managed" | "external"
```

默认是 `managed`。只有用户显式选择 external 后，才允许连接或启动外部 CLI gateway。

| 场景 | 行为 |
|---|---|
| 默认、无现有进程 | 安装/恢复并启动受管 gateway |
| 已是本 Desktop 启动且登记过的受管进程 | 版本匹配才 adopt；旧版本则停止并换新版 |
| 未登记的外部进程占用 3000 | 不静默 adopt、不擅自杀；显示来源冲突，提供“检查并使用外部 gateway”或“关闭外部进程后重试” |
| external 模式 | 通过同一握手检查版本与 Experience；不兼容则明确报错，不启动 bundled 顶替 |
| 全局 `mafw` 存在但未运行 | managed 模式完全忽略；不再以“CLI 可用”压过 bundle |

“本 Desktop 启动且登记过”由两项共同确认：spawn 时写入受管实例记录，并通过受管环境变量让 gateway 在握手中报告匹配的 `instanceId`。不能只凭可执行文件名或端口推断所有权；Electron 与 gateway child 在 Windows 上甚至共享同一个 `MAFW.exe` 镜像名。

实例登记放在共享的 `~/.mafw/runtime/desktop-gateway/<channel>/<instanceId>.json`，包含 pid、channel、gatewayVersion、schemaEpoch、启动时间和受管 nonce；payload 仍按 Desktop channel 放在各自 `userData` 下。这样应用崩溃后的下一次启动能找到原实例，也能识别 dev/beta/prod 的冲突。受管 gateway 不写全局 CLI 的 `~/.config/mafw/gateway.pid`，避免 `mafw stop` 绕过 Desktop 监管杀进程。

### 4.2 外部来源兼容规则

managed 模式要求运行版本等于当前发布单元的 gatewayVersion。

external 模式不强求完全相等，但必须同时满足：

- `gatewayVersion >= desktopMinimumGatewayVersion`；
- Experience 状态为 `ready`，不是 `incompatible` 或 `unavailable`；
- 健康检查可达。

外部来源的版本与路径只用于诊断展示，不作为 Desktop 的更新目标。

### 4.3 端口与 channel

- packaged managed gateway 固定 `MAFW_SERVER_API_PORT=3000`，覆盖用户 config 中的 `server.apiPort`；现有 MCP、自接线和插件默认值都依赖这个端口。external 模式可配置其他 URL。
- 3000 被非 gateway 程序占用时属于 `port_conflict`，不是可收养的 external gateway；显示占用错误，不尝试杀死对方。
- dev/beta/prod 不共享 managed 实例。另一个 channel 已占用 3000 时显示 channel 冲突；本轮不承诺多个 channel 同时运行。
- `autoUpdater.allowDowngrade=false`。运行中的受管实例若比安装资源更新，也拒绝静默替换为旧版，进入版本冲突恢复界面。握手同时比较 `schemaEpoch`。

## 5. 发布单元与握手

### 5.1 Release manifest

每次 Desktop 构建生成一份 `release-manifest.json`，随 gateway payload 和 Desktop 资源交付：

```json
{
  "schemaVersion": 1,
  "productVersion": "5.2.0",
  "gatewayVersion": "5.2.0",
  "desktopMinimumGatewayVersion": "5.2.0",
  "experienceVersion": "2026.11.1",
  "minimumClientExperienceVersion": "2026.11.0",
  "schemaEpoch": 1,
  "payloadManifestSha256": "<hex>"
}
```

- `productVersion` 继续以 root `package.json` 为单一发布版本源。
- `gatewayVersion` 是发布单元中的 gateway 代码版本，不再信任长期滞后的 `gateway/package.json.version`。
- `schemaEpoch` 在持久化数据出现**旧版无法读取的格式变化**时人工递增；普通 bugfix/feature 不递增。
- payload 内另有逐文件 `path + sha256` 清单，用于安装校验。

本轮 `gatewayVersion === productVersion`，不维护第二条独立版本线。构建时从 root package 与 Experience 常量生成 `gateway/dist/release.json`，并做交叉校验；gateway 运行时读取该文件，dev 可用 root package 派生，绝不读取滞后的 `gateway/package.json.version` 充当发布版本。

P0 就需要最小 `release.json`、共享实例登记和版本握手，先直接从安装资源启动；P1 再引入用户数据目录的版本化复制与逐文件 payload hash。这样 P0 可独立修复抢版问题，P1 不改变版本语义，只改变受管 payload 的落盘与恢复能力。

### 5.2 Gateway 握手

现有 `/health` 保持原字段，additive 增加：

```json
{
  "status": "ok",
  "gatewayVersion": "5.2.0",
  "experienceVersion": "2026.11.1",
  "minimumClientExperienceVersion": "2026.11.0",
  "schemaEpoch": 1,
  "channel": "prod",
  "instanceId": "<process-uuid>",
  "distribution": "desktop-managed"
}
```

`distribution` 只表示启动时由受管环境声明，不包含文件系统路径、密钥或用户目录。Desktop 还要与本地实例记录匹配，不能把该字段当成唯一所有权证明。

Desktop 启动与 Config 诊断页展示：当前来源、期望版本、实际版本、instanceId 和 Experience 状态。

## 6. 受管版本目录与安装流程

### 6.1 目录

Windows 示例（其他平台使用 Electron `app.getPath("userData")` 的等价位置）：

```text
<userData>/gateway/
  versions/<gatewayVersion>-<payloadDigest前12位>/
    dist/
    node_modules/
    voice_sidecars/
    skills/
    scripts/
    payload-manifest.json
    release-manifest.json
    .install-complete.json
  staging/<random>/
  current.json
  previous.json
  quarantine.json
  instances/<instanceId>.json
```

目录键包含 payload 摘要短码，避免同一版本号的两次构建原地覆盖正在运行的目录。`current.json` 只保存版本、payload 摘要、payload 根和选择时间；指针原子写入。旧版本目录永不原地改写。

### 6.2 首次安装与升级

1. 从安装资源读取 release 与逐文件 manifest。
2. 若当前版本目录存在且 `.install-complete.json`、release、逐文件 hash 全部匹配，直接复用。
3. 否则在 staging 解压/复制；逐文件验证大小与 SHA-256。
4. 写入 `.install-complete.json` 后，原子 rename 到版本目录；半成品目录不参与启动。
5. 若需替换正在运行的旧受管实例，先按实例记录停止它并等待端口退出。
6. 原子切换 `current.json`，保留 `previous.json`，然后启动新 payload。
7. 健康检查、版本握手和关键 native module 自检全部通过后才报告 ready。

整个安装与升级过程不需要 npm 或网络。

### 6.3 失败、隔离与恢复

- staging 失败：删除 staging，当前版本不变。
- 新版启动失败：写入 `quarantined.json`（version、payloadHash、错误、时间）。若 `schemaEpoch` 未变化，恢复到最后已知良好的 current 并重启旧 payload；失败版本不得写入 previous，避免 good/bad 来回翻转。
- 同一 version + payloadHash 被隔离后，后续启动不得自动重试。只有新的 payloadHash 或用户显式点击“重试此版本”才清除隔离；不是每次启动都清。
- `schemaEpoch` 已变化：旧代码可能对持久化数据不安全，**不做自动数据回滚，也不以新版 degraded 继续跑**。Desktop 进入无 gateway 的阻塞恢复页，展示迁移/备份指引；发布计划必须另列数据备份与迁移验收。
- 连续失败：进入明确的 failed 状态，不循环杀进程；保留日志和“打开诊断”入口。
- 清理仅保留 current/previous，且不得在对应进程仍运行时删除。

`schemaEpoch` 相等的自动回滚只承诺代码与选择指针恢复，不宣称回滚整个 `~/.mafw` 用户状态。

## 7. Desktop 更新体验

### 7.1 行为

- 保留后台检查与下载。
- 下载完成后，Windows 与 AppImage 的 renderer 都可见非模态“重启以更新”入口；Config 中也可触发。
- **不直接打开 electron-updater 自带的 `autoInstallOnAppQuit`**。Desktop 自己协调退出：收到正常退出或“退出并安装”后，先阻止立即退出，await 停止受管 gateway、确认 child exit 且 3000 不再应答，再调用 `quitAndInstall()`。这样退出时自动安装仍然成立，但不会留下持有文件锁的 child。
- 用户手工再次运行 NSIS 时，安装器在替换文件前也必须确认同 channel 的 Desktop/gateway 已退出；若仍在运行则提示关闭并重试，不依赖 fire-and-forget 的 `will-quit`，不根据同名 exe 批量强杀。
- channel 跟随实际 prod/beta 构建，不再硬编码 `latest`；`allowDowngrade=false`。
- Linux 本轮只有 **AppImage** 承诺应用内自动更新；deb/rpm 继续作为包管理器/手工安装制品，更新 UI 引导使用对应包，不伪装成可无权限自更新。
- draft GitHub Release 不视为已发布；发布流程必须发布后 updater 才能发现它。

### 7.2 安全前置

- Windows 不再使用 `verifyUpdateCodeSignature: false` 作为发布默认。
- Desktop 安装包按平台签名；macOS 自动更新遵循签名/公证要求。
- gateway payload 还必须通过逐文件 SHA-256 与 release manifest 校验。
- 签名凭据、GitHub Release 权限和 secret 是发布运维前置；缺少有效签名时不得把自动安装宣称为生产就绪。
- 用户决策（2026-11-09）：Windows 签名证书状态不确定，按“暂无”处理。P0 可以实现签名验证配置与更新状态机，但生产自动安装保持 gated；证书和 CI secret 到位后单独验收并开启。

## 8. 打包与发布门禁

### 8.1 单一资产清单

把 gateway 发布资产清单抽成共享模块，供 Desktop `stage-gateway.ts` 与 `deploy-local.mjs` 共同消费，至少覆盖：

- `dist/`（含 dashboard 与内置 usage plugins）；
- `voice_sidecars/`；
- root `skills/`；
- Office setup/helper；
- `@mafw/plugin-contract`；
- release/payload manifests。

本轮保留 `gateway/package.json` 声明的全部 `optionalDependencies`，避免 kokoro 等能力在 Desktop 包中无意消失；未来若改为按需下载，必须单独设计 manifest 与离线降级。

bundle 原样复制 `gateway/package.json` 与 `gateway/package-lock.json`，执行 `npm ci --omit=dev`；发布版本由独立 `release.json` 表示，不再通过重写合成 manifest 制造 lock 不一致。这样不会以浮动的 `npm install` 决定发布依赖图。root 的 Node 开发/安装基线统一为 Node 22+；Electron ABI 的 native addon 仍按 Desktop Electron 版本构建。

版本目录安装时做逐文件完整 hash；日常启动只校验 completion marker、release/payload manifest hash 和入口及关键 native 文件，不在窗口创建前对整棵 `node_modules` 反复全量 hash。用户可显式触发完整校验/修复。复制必须保留 Unix 可执行位与 `.bin` 链接语义，并有 Windows/Linux 两类测试。

### 8.2 Packaged smoke

CI 在打包后执行：

1. 以 packaged Electron + `ELECTRON_RUN_AS_NODE` 启动 staged gateway。
2. 等待 `/health`，断言发布版本与 Experience。
3. 验证 `better-sqlite3` 可打开临时 DB、ZeroMQ 可加载；对当包包含的 ONNX/sharp 做最小加载检查。
4. 检查 root skills、Office helper、voice sidecars 的解析路径。
5. 停止进程并确认无残留。

发布人工验收矩阵：

- fresh Windows / fresh Linux；
- 旧 Desktop + 旧全局 CLI + 旧运行进程同时存在；
- 无 Node/npm/断网；
- 已下载更新后立即重启与退出安装两条路径；
- 新 payload 损坏、健康失败、schemaEpoch 不变时的回滚；
- schemaEpoch 变化时不自动回滚；
- external 模式的兼容/不兼容与端口冲突。

## 9. 现有功能的迁移与清理

- 删除 NSIS `customInstall` 的全局 npm 更新调用和 `gateway-update` 资源，不再让安装器依赖外部 Node。
- `mafw-gateway-plan.ts` 改为 managed/external 两源决策，旧 adopt→CLI→bundle 测试按新契约重写。
- CLI `mafw update`：source checkout 仍可 build + takeover；全局安装明确显示“重启当前已安装版本”，不得暗示取得新制品。
- Desktop Config 的“拉取当前代码构建”按来源改为“重启受管 gateway”或真实的“检查 Desktop 更新”。
- `deploy-local.mjs` 保留为开发者工具，不参与 Desktop 默认更新；使用共享资产清单并同步版本元数据。
- 旧全局 npm 包、配置、`~/.mafw` 数据均保留，不卸载、不删除。

### 9.1 受管 gateway 的 restart/update 令牌

desktop-managed 进程**禁止执行现有 detached takeover**。当 `MAFW_DESKTOP_MANAGED=1` 时：

- `action:"restart"` 或无 src 的 `action:"update"`：完成必要清理后以专用退出码退出，由 Desktop child-exit supervisor 从当前受管 payload 重新拉起；不得脱离 Desktop 再 spawn。
- source checkout 的非受管 gateway 保持现有 build + takeover，不影响仓库内自更新工作流。
- Desktop Config 的重启直接走 Desktop supervisor，不再依赖 pending token。
- `mafw-gateway-restart` skill 与相关文档必须标明 managed/dev 两条路径；重启后由 Desktop 验证 instanceId 已更换、版本一致，避免假成功。

### 9.2 Dev 与旧 external 的迁移

- packaged 默认 managed。unpackaged/dev 若显式提供 `MAFW_GATEWAY_ENTRY`，可用 repo `gateway/dist` 走 managed supervisor；否则保留 adopt → CLI 的 external 开发回退，不复制 payload。
- 当前已安装的旧 gateway 没有版本字段，不能被静默收养。用户选择 external 时，版本齐全且兼容才可保存为持久 preference。
- 对旧的无版本 external，提供明确的“无法验证版本，仅本次使用”警告入口；该 override 只存内存，Desktop 更新或重启后回到 managed，不形成永久旧版本粘连。

## 10. 测试策略

TDD，先写失败测试再实现。重点覆盖：

- 来源选择：managed 默认、登记实例 adopt、旧受管实例替换、external 显式选择、端口冲突不杀外部进程。
- 握手：相同/较旧/较新版本、Experience incompatible/unavailable、instanceId 不匹配。
- 安装器：完整复用、损坏重装、hash 失败、原子切换、进程占用、current/previous 保留。
- 回滚：schemaEpoch 相同可回滚，变化时禁止自动回滚。
- updater：全平台 ready 入口、退出安装设置、channel、stop-then-install、签名配置契约。
- staging：共享资产清单、锁文件、optional 策略、native module 与 packaged smoke。
- 文案：不再把 restart-installed-dist 称为下载更新。

最终必须报告各包新增测试数与全量通过数，以及 gateway `tsc`、desktop `tsgo -p`、root build、`electron-vite build`、packaged smoke 的真实结果。

## 11. 分阶段交付

### P0：版本所有权与更新正确性

- 最小 `release.json`、共享实例登记、managed/external 决策、握手、端口/channel/降级冲突处理；
- managed restart 改为 supervisor 拉起，禁止 detached takeover；
- 移除 NSIS npm 更新；
- Windows/AppImage 更新安装入口，以及“先等待进程退出，再安装”的退出协调；
- 准确的更新/重启文案；
- 签名验证配置与单元/集成测试。若发布证书尚未具备，代码可完成但生产自动安装必须保持 gated，不能假报签名验收。

### P1：受管版本目录与发布一致性

- 用户数据目录的版本化安装、逐文件 payload hash、原子切换、失败隔离与受控回滚；
- 共享资产清单、锁文件与 optional 策略；
- packaged smoke 与真实升级验收。

P0 可以先独立交付并显著解决“旧 gateway 压过新包”；P1 完成离线恢复、可诊断安装和后续独立 hotfix 的基础。

## 12. 后续可选实验（不在本轮承诺）

若仍需要独立 `mafw-gateway.exe`，允许做一次 Node SEA spike，但验收形状必须是“启动器 + 外部资源目录”，并单独构建目标 Node ABI 的 native addons。动态插件、Office/voice 资源、外部 runtime 与自更新语义全部通过后才考虑替换 Electron Node 路线。Bun、Tauri/Rust 重写不作为解决发包问题的前置。
