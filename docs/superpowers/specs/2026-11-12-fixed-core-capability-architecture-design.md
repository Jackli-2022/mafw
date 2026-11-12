# 固定核心 + 可调整点：计算机底层架构对齐设计

- 日期：2026-11-12
- 状态：Draft（已按 GLM-5.3 审查修订；待 tech lead / 用户评审）
- 目标：MAFW gateway / desktop 采用“固定核心 + 可调整点”，主要参考计算机底层架构（ISA / 内核 / 驱动 / 总线 / 保护环 / 用户态）；除核心不变量外，能力实现、事件观察点和 UI 槽位均可调整
- 相关调研：
  - `docs/research/2026-11-12-microkernel-capability-research.md`
  - `docs/research/2026-11-12-desktop-menu-slot-spike.md`
  - `docs/research/2026-11-12-glm53-architecture-spec-review.md`
- 相关 spike：
  - gateway：`spike/capability-registry-tts` @ `5a248271`
  - desktop：`spike/desktop-menu-slot` @ `a2357b71`

## 0. 计算机底层架构映射

主要参考计算机底层架构，而不是“插件市场”模型。**固定核心 = 固件/内核/ISA；可调整点 = 驱动、设备树、总线上的设备、用户态程序。**

| 计算机底层 | MAFW | 固定 / 可调整 | 说明 |
|---|---|---|---|
| 硬件 | OS / Node / Electron / SQLite / 网络 | 固定 | 不重写基础技术 |
| BIOS / UEFI | boot / config / migration / health / self-update | 固定（可配置） | 上电自检，不参与业务 |
| CPU / ISA | canonical events / View DTO / capability interface / manifest schema | **固定** | 所有 provider / consumer 的共同 ABI |
| 内核 | lifecycle / scheduler / event bus / capability registry / policy / persistence primitives | **固定** | 只做调度、隔离、策略、资源 |
| MMU / 保护环 | trust tiers / project-session scope | 固定机制 | 逻辑隔离，不是硬件隔离 |
| cgroup / 调度器 | budgets / quotas / concurrency limits | 固定机制 | 资源控制，不是内存保护 |
| 系统总线 | **capability registry** + event bus | 固定 | provider 发现与通信 |
| 系统调用 | capability interface | 固定 | driver 只通过接口被调用 |
| 设备树 / ACPI | provider manifest | 可调整 | 声明依赖、资源、配置、版本、平面 |
| 设备驱动 | provider | **可调整** | runtime adapter / memory / tools / models / media / TTS / ASR / usage / automation |
| 中断 | canonical event dispatch | 固定机制 | observer 可挂载；interceptor 另立 fail-closed 类 |
| 热插拔 | provider replace | 分级 | 安装时 / 作用域 / 无状态 re-registration |
| 用户态程序 | desktop shell + UI 插件 | **可调整** | 面板 / 工具卡 / 菜单 / composer / web surface |

三条设计规则：

1. **内核只依赖 ISA，不 import 任何 driver。**
2. **driver 只能通过系统调用（capability interface）被消费，不能反向 import 内核。**
3. **保护环 / 策略由内核强制，driver 不能绕过**（验收、审批、审计、记忆不变量）。

### 0.1 四类可调整点

| 类型 | 调整什么 | 例子 | 接入方式 |
|---|---|---|---|
| **Driver point** | 能力实现 | TTS / usage / media / ASR / runtime adapter / memory provider / tools | manifest + provider registry |
| **Observer point** | 只读观察事件 | canonical event observer、telemetry | 订阅 + fail-open + 超时预算 |
| **Interceptor point** | 前置拦截/改写 | tool before gate / rewrite | 订阅 + **fail-closed**；v1 不开放 |
| **User-space point** | 界面槽位 | menu / composer / panel / tool card / web surface | 声明式 descriptor + host renderer |
| **Firmware / config point** | 配置与装配 | config、manifest、profile、主题 token | 配置/安装，不改内核代码 |

“可调整”不等于“全部热插拔”：driver 可以安装时替换或按作用域选择；有状态核心只允许重启生效。

**hook 分型（重要）：**

- **Observer**：post-hoc、只读、fail-open；超时或异常只丢观察结果，不影响主链。
- **Interceptor**：pre-hook、fail-closed；超时/异常 = deny 或 veto，绝不跳过。
- 审批、权限、审计、人类验收**永远不能**是 fail-open observer；v1 只做 observer，interceptor 另立设计。

## 1. 意图

今天的 gateway / desktop 不是“没有扩展点”，而是：

- 扩展点偏科：展示型 / provider 型多，agent 工具、事件观察、交互型 UI 少。
- 核心与实现耦合：`MafwScheduler` 仍是 6,906 行组合根，很多能力直接 import 实现。
- 两套扩展体系并存：统一插件包、runtime adapter、legacy 目录、desktop legacy UI cards。

本设计要把架构改成：

> 核心只保留不可替换的职责；其他能力通过可调整点接入：接口 + 默认实现 + 可替换 provider / observer / UI 槽位。

这不是“把所有东西都做成插件”，而是“把实现从核心里拿出来，接口和生命周期留在核心里”。内核像芯片，driver 像设备驱动，UI 槽位像用户态程序；换 driver 不改 ISA，换 UI 不改内核。

## 2. 目标 / 非目标 / 反目标

### 目标

- gateway / desktop 的核心边界清晰、可审计、可测试。
- 叶子能力（TTS、usage、media、ASR、commands、notifications）先可调整。
- 插件可以给 agent 加工具、观察 canonical 事件、贡献更多 UI 槽位。
- provider 可以按安装时、项目/会话作用域替换；无状态 provider 可选 re-registration。
- 所有替换都有 fallback、诊断、回滚路径。
- 迁移过程中产品一直可运行，不搞 big-bang rewrite。
- 每个 Service Definition 有 conformance kit；每个 gate 有 clean baseline。

### 非目标

- 不把 gateway 拆成多进程微服务。
- 不引入 Cordis 作为新内核依赖。
- 不替换 SolidJS / Electron / Monaco / SQLite 等基础技术。
- 不把 session log、memory schema、Goal/Pod 状态机、authz 做成热插拔。
- 不做 marketplace；先有稳定契约和信任模型。
- 不为了“可替换”而替换所有内置实现。
- 不在 v1 引入 interceptor/gate 钩子。

### 反目标（即使技术可行也算失败）

- 核心变成一个新的“能力注册表大一统”，所有逻辑都堆进 registry。
- 插件失败可以拖垮 boot、SSE、100ms recall 或人类验收。
- 为了 UI 扩展把原生 Solid 组件注入 renderer，破坏 preload / sandbox 边界。
- provider 替换改变 HTTP/DTO/事件语义，客户端无感知地坏掉。
- 迁移后测试基线长期不稳定，靠“环境问题”解释红灯。
- shadow compare 从未落地，cutover 退化成 flag-day。
- 并行重写期间 v1 继续加功能，v2 靠 cherry-pick 追平。

### 2.1 威胁模型

| 角色 | 能力 | 信任决策 |
|---|---|---|
| **buggy trusted plugin** | 已安装、可运行、可能抛错/泄漏 timer | fail-soft、dispose 隔离、diagnostics |
| **malicious installed package** | 用户显式安装，进程内可读 fs/net | 安装同意 + 权限声明 + audit + kill switch；**不是沙箱** |
| **supply-chain compromise** | 包内容被替换 | integrity/fingerprint + 签名（可行时）+ 安装预览 |
| **remote unauthenticated user** | 只能经 loopback/token 面 | 现有 auth；webview 永远不拿 apiToken |
| **untrusted third-party provider** | 不可信代码 | 只允许 worker/sandbox；worker 未实现前 **fail-closed 拒绝** |

“trusted install”是可信安装，不是安全沙箱。需要真正隔离时，升级到 worker/child，而不是继续加权限检查。

## 3. 固定核心

核心不是功能清单，而是**不变量 + 宿主**。以下职责必须留在核心：

### Gateway

1. 启动 / 生命周期 / 数据根 / 迁移 / 健康 / 退出。
2. HTTP / WS / SSE / MCP 传输 + 鉴权。
3. canonical 事件内核：顺序、重放、会话注册表、广播。
4. 安全与策略：身份、审批、权限、审计、人类验收。
5. 持久化原语：DB 连接、迁移、原子写、备份。
6. 能力 / 插件宿主：manifest、加载、激活、dispose、revision、依赖、fallback。
7. 契约：RuntimeDefinition、PluginPackage、Event/DTO。
8. 并发原语：队列、锁、singleflight、定时器。

### Desktop

1. Electron 生命周期 / 窗口 / IPC / preload 安全。
2. gateway 连接、托管、自更新。
3. renderer 壳：布局、路由、focus、session store、SSE。
4. 插件槽宿主：声明式渲染、webview 沙箱策略、revision guard。
5. 主题 / token 引擎。
6. 快捷键 / 命令分发。

### 永不替换的不变量

- 人类验收（Goal accept 只允许人类）。
- 审批 / 权限 / 身份 / 审计。
- 记忆 soft supersede、pinned/sticky、T1 不回流、100ms recall。
- canonical 事件顺序和 fail-closed 语义。
- DB migration / 数据根 / 原子写。
- 计划批准绑定 `planHash` / `evalHash`。
- Desktop preload allowlist、webview sandbox、renderer 不执行 Host 代码。
- **Runtime 契约四条**：
  - 历史出口只有 flat：`{ data: MafwMessage[], nextCursor }`。
  - 未知/非法 runtime 事件 fail-closed。
  - 缺失能力返回中性 503，文案不含 runtime 名与 capability flag 名。
  - `SessionCreateOpts.directory` 必填绝对路径；不静默兜底。
- **webview 永远不接收 gateway apiToken**；只走 per-surface ticket / bridge。
- **memory / goal 边界**：memory schema、soft supersede、T1 隔离、recall 预算，以及 Goal/Pod NodeDriver 状态机、人类验收、hash 绑定是核心；provider 只是实现。

## 4. 可调整点模型

第 0 节把可调整点分成 driver / observer / interceptor / user-space / firmware 类型。每个 driver point 必须同时设计三个角色：

1. **Service Definition**：接口、版本、语义、错误模型、超时 / 取消。
2. **Provider**：默认实现 + 可替换实现；声明依赖、资源、健康、配置 schema。
3. **Consumer**：只依赖接口，不 import 实现。

一个包可以承担多个角色，但单一角色不构成 seam。observer / user-space 点不要求 provider，但要求**稳定的 descriptor + host 渲染/路由**；firmware 点只改配置/manifest，不改内核代码。

### 4.1 Manifest

Provider manifest 至少包含：

- `id` / `version` / `apiVersion`
- `kind`: `core` / `trusted` / `untrusted`（**声明是 claim，不是授权**）
- `requires` / `wants`
- `provides`: capability id + version
- `activation`: `startup` / `lazy` / `on-demand`
- `permissions`
- `configSchema`
- `integrity`: `{ algorithm: "sha256", files: Record<string, string> }`，安装与加载时由宿主校验；未实现前从 v1 manifest 草案移除
- `planes`: `gateway` / `desktop-ui` / `desktop-web` / `desktop-main`

**kind 校验：**

- `core` 只允许第一方包（内置 allowlist / fingerprint）；声明 core 但不在 allowlist = hard validation failure。
- `trusted` 需要用户显式安装同意与权限声明。
- `untrusted` 在 worker host 实现前 **fail-closed 拒绝**，不得降级为 in-process。

### 4.2 生命周期

```text
load → validate → resolve → activate → active/degraded → drain → dispose
```

- `load` 失败（throw）fail-soft；`load` 挂起只有 untrusted worker 能防，因此 untrusted 继续拒绝。
- 激活失败不拖垮 boot（fail-soft；必需 provider 失败进入 safe mode）。
- 注册必须是可逆副作用；LIFO dispose。
- 替换时先 prepare 新 provider，再 switch，再 drain 旧 provider。
- 每个 provider 有 health / last-known-good / 诊断。

### 4.3 作用域

- `global`：默认实现。
- `workspace` / `project`：项目级覆盖。
- `session`：会话级覆盖。
- `agent`：未来 agent preset / isolate。

解析顺序：agent → session → project → global；同层按 priority，priority 相同按 **registration order → provider id** 确定性排序。

### 4.4 替换分级

| 级别 | 语义 | 适用 |
|---|---|---|
| L1 安装时替换 | 改配置/装包，重启生效 | 大多数 provider |
| L2 作用域选择 | 项目/会话解析不同 provider | memory/model/tool 策略 |
| L3 re-registration | prepare → health → switch → drain → dispose | **无状态** provider |
| 不换 | session log、memory schema、Goal/Pod 状态机、authz/acceptance、scheduler | 核心不变量 |

**L3 的“无状态”是契约，不是形容词：**

- 无 module-level mutable state；
- 无 process listener / signal handler / 全局 timer；
- 无 require-time side effect；
- 可通过 conformance kit 检查。

**L3 不等于 unload**：旧模块仍在 `require.cache`，模块身份保留到进程重启；共享依赖多版本共存不在 L3 范围。有状态 provider 只能 restart。

### 4.5 信任分级

| 级别 | 执行 | 强制 |
|---|---|---|
| core | gateway 进程内 | 第一方 allowlist + 代码评审 + 不变量 |
| trusted | gateway 进程内 | 安装同意 + manifest 权限 + audit + kill switch |
| untrusted | worker/child 或 sandboxed renderer | 白名单 RPC + 显式授权；worker 未实现前拒绝 |

Desktop UI 扩展保持：声明式数据优先；需要交互时用 sandboxed web surface；不注入原生 Solid 组件。

### 4.6 插件平面：desktop 插件还是 gateway 插件？

**插件包是分发单位，不是执行单位。** 一个包可以同时有 gateway 和 desktop 贡献；区分靠 manifest 的 `contributes` 键，不靠目录名、包名或“插件类型”。

先区分两类“平面”，不要把数据和执行混在一起：

- **执行平面**：代码真正运行的地方。
  - `gateway`：gateway 进程（Node），相当于内核模块 / 驱动。
  - `desktop-main`：Electron main，相当于特权用户态服务（display server / device manager）。
  - `desktop-renderer`：sandboxed `<webview>`，相当于沙箱用户进程。
- **数据平面**：宿主消费的声明式数据，不是程序。
  - `declarative-ui`：panel / tool card / config page / message window / menu / composer 的 descriptor，相当于显示列表 / 协议数据。

| 平面 | 类型 | 执行位置 | 能做什么 | 信任 |
|---|---|---|---|---|
| `gateway` | 执行 | gateway 进程（Node） | runtime / memory / tools / media / TTS / ASR / usage / actions / events / HTTP | 可信进程内代码 |
| `desktop-main` | 执行 | Electron main | 旧式 `~/.mafw/ui-plugins/*.js` 工具卡；**legacy，默认关闭/显式同意** | 可信进程内代码 |
| `declarative-ui` | 数据 | desktop renderer（宿主渲染） | panel / tool card / config page / message window / menu / composer | 纯数据，宿主校验 |
| `desktop-renderer` | 执行 | sandboxed `<webview>` | 自带 HTML/JS 的 web surface | 沙箱 + bridge allowlist |

**manifest 平面拆分：**

- `contributes.gateway`：gateway 执行面。
- `contributes.desktop.ui`：声明式数据（panels/toolCards/configPages/messageWindows/menuItems/composerActions）。
- `contributes.desktop.web`：webSurfaces（沙箱执行面）。
- `contributes.desktop.main`：legacy `~/.mafw/ui-plugins` 兼容面，默认关闭/显式同意，给移除日期。

**manifest ↔ activate ↔ client descriptor 映射：**

| manifest 键 | activate() 返回 | client descriptor | 规则 |
|---|---|---|---|
| `gateway.actions` | `actions` | `actions` | manifest 只声明元数据；handler 仍由 activate 提供 |
| `gateway.events` | `events` | `events` | 同上；type 必须同包命名空间 |
| `desktop.ui.panels` | `ui.panels` | `ui.panels` | 同 id 必须一致；冲突 = validation error |
| `desktop.ui.menuItems` | `ui.menuItems` | `ui.menuItems` | 同上 |
| `desktop.web.webSurfaces` | `ui.webSurfaces` | `ui.webSurfaces` | 资源由 gateway 校验 |
| `desktop.main` | — | — | legacy，不走统一 descriptor |

- `contributes` 在 `apiVersion: 1` 是 **additive/optional**；现有包继续通过校验。
- 只有 desktop declarative 贡献的包可以省略 `activate()`；只有 gateway 贡献的包不渲染 UI。
- manifest 与 activate 同时声明同一 id 时，静态元数据必须一致；不一致 = 校验失败，不静默择一。
- 现有 `DESCRIPTOR_KEYS` allowlist 只做 additive 扩展；旧包不需要改。

**路由与 bridge：**

- `contributes.gateway` 由 gateway `PluginHost` 读取并激活；desktop 永远不执行这部分代码。
- `contributes.desktop.ui` 由 desktop host 读取为 descriptor；gateway 只校验/投影。
- `contributes.desktop.web` 由 gateway 提供资源，desktop 在 sandboxed webview 加载；webview 走 per-surface ticket，**永不接收 apiToken**。
- 跨平面只走 action/event bridge；action 引用保持包内，跨包调用留给 Host-mediated 未来能力。
- `plugin.json` 必须显式声明平面；未知平面 = 校验失败。

示例：

```json
{
  "name": "service-monitor",
  "version": "1.0.0",
  "apiVersion": 1,
  "contributes": {
    "gateway": {
      "actions": ["refresh", "check"],
      "events": ["plugin:service-monitor:changed"],
      "http": true
    },
    "desktop": {
      "ui": {
        "panels": [
          { "id": "main", "title": "Service Monitor", "viewAction": "refresh" }
        ],
        "menuItems": [
          { "id": "check", "surface": "message", "label": "Check service", "action": "check", "order": 10 }
        ]
      },
      "web": {
        "webSurfaces": [
          { "id": "explorer", "title": "Explorer", "entry": "web/index.html" }
        ]
      }
    }
  }
}
```

**安装与发现：**

- 安装器读取 manifest，按 `contributes` 把包登记到对应 host；两者都有时只安装一次，两个 host 各自加载自己的平面。
- Plugin Hub 显示平面徽标：`Gateway` / `Desktop UI` / `Web` / `Runtime`。
- 旧路径（`~/.mafw/ui-plugins`、`~/.mafw/{usage,media,runtime}-plugins`）标记 legacy；`ui-plugins` 默认关闭/显式同意，给移除日期。

**为什么不做“按目录分”**：目录分法会把“一个包多贡献”拆成两个包，导致 action/event/descriptor 无法原子 revision；manifest 平面声明能保持一个 revision、一个安装单元。

### 4.7 与计算机底层架构的精确对应

| 计算机底层 | MAFW | 精确说法 |
|---|---|---|
| 内核 | gateway core | gateway 是用户态服务，但在 MAFW 里扮演内核角色：生命周期、调度、事件、策略、持久化原语 |
| 内核模块 / 驱动 | `gateway` 平面插件 | 进程内可信代码；Node 没有 MMU/classloader，隔离是逻辑的 |
| 特权用户态服务 | `desktop-main` | 不是第二个内核；是 display server / device manager 类服务，拥有较宽的主进程能力 |
| 沙箱用户进程 | `desktop-renderer` / web surface | webview sandbox + bridge allowlist，接近 seccomp/能力白名单 |
| 显示列表 / 协议数据 | `declarative-ui` | 不是执行平面；宿主渲染，插件不提供组件 |
| 系统调用 | gateway capability interface | 只用于 gateway 内部 driver 被消费；跨进程是 IPC |
| 中断 / 总线 | canonical events / action-event bridge | 协作式、fail-open（observer）；没有硬件抢占 |
| 设备树 / ACPI | plugin manifest / capability manifest | 声明依赖、资源、版本、平面 |
| MMU / 保护环 | trust tiers / scopes | 逻辑保护环，不是硬件隔离 |
| 热插拔 | provider replace | 无状态 re-registration；有状态要 drain/restart |

**类比不成立的地方（必须明确）：**

1. Gateway 不是 OS 内核，只是 MAFW 的控制面进程；不要把它当 ring 0 安全边界。
2. Node 没有可靠的内存保护和模块卸载；进程内插件可以 `require('fs')`，信任模型必须按“可信安装”设计。
3. Desktop-main 不是内核态，但也不是沙箱；它是有特权的用户态服务，第三方代码不应默认进入。
4. `declarative-ui` 是数据，不是程序；把它叫“平面”只是为了分类，不能当成执行环境。
5. 跨 gateway/desktop 的 action/event 是 IPC/总线，不是系统调用；真正的 capability interface 只在 gateway 内部。
6. 事件不是硬件中断，不能被抢占；observer 必须 fail-open，不能阻塞主链；interceptor 必须 fail-closed。
7. 有状态 driver 不能像 USB 一样随插随用；必须 quiesce/drain/migrate 或重启。
8. L3 不是 unload；旧模块留在 `require.cache`，共享依赖多版本共存不在范围。

### 4.8 Conformance kits

每个 Service Definition 必须附带 conformance test kit；非内置 provider 激活前必须通过。

- runtime kit：flat history、非法事件 fail-closed、中性 503、绝对 directory。
- memory kit：soft supersede、T1 不回流、100ms recall、scope 不泄漏。
- tools kit：schema、权限、错误隔离、session scope。
- TTS kit：default/override/fallback/dispose/stream/abort。
- usage kit：provider 解析、fallback、record/replay。
- UI kit：descriptor 校验、排序/上限/去重、action 路由、卸载。

Task 0.1 的“不变量 → 测试/守卫”必须产出这份 inventory；没有 kit 的 Service Definition 不算完成。

### 4.9 Capability interface versioning

- 每个 capability family 有 `apiVersion`；同一 major 内 additive，breaking 必须新 major。
- provider 声明 `provides: { id, version }`；host 只激活满足 `apiVersion` 的 provider。
- 多版本共存只允许显式 provider set；默认不并行加载两个 major。
- 弃用窗口至少一个发布周期；diagnostics 标 `deprecated`。
- 现有 runtime/plugin 契约的版本门禁继续沿用；不得用“兼容层”静默改语义。

### 4.10 Performance contract

- registry 解析必须缓存；100ms recall 路径上不允许 registry 查找/激活/JSON parse。
- provider activate 不在 hot path；activate 失败不得阻塞事件循环。
- in-process capability call 的 p95 开销目标 < 1ms；事件 observer 总预算独立，超时 fail-open。
- 每个 kit 包含一个 perf smoke；CI 不在热路径做 live network。

### 4.11 Diagnostics contract

诊断记录至少包含：

```ts
type CapabilityDiagnostic = {
  providerId: string
  capability: string
  version: string
  plane: "gateway" | "desktop-ui" | "desktop-web" | "desktop-main"
  state: "loaded" | "active" | "degraded" | "failed" | "disposed"
  reason?: string
  revision: string
  lastKnownGood?: string
  at: string
}
```

出口：

- `GET /api/kernel/diagnostics`（或现有 `/api/kernel/stats` 的 additive 字段）。
- Plugin Hub 的 provider/plane 状态。
- 结构化日志；不把 Host 代码或 secret 写进诊断。

Phase 0 冻结字段；Phase 1 先实现内存态，不落盘。

## 5. 分层

```text
用户态    desktop shell + UI 插件（panels/tool cards/menu/composer/web surfaces）
  ↑
driver    可替换 provider（runtime/memory/tools/models/media/tts/asr/usage/automation）
  ↑
内核      lifecycle / registry / event bus / policy / persistence primitives / scopes
  ↑
ISA       canonical events / DTO / capability interfaces / manifest / versioning
```

借计算机底层的分层，但做**逻辑微内核**：热路径同进程调用，只有不可信插件才考虑进程隔离。

## 6. 迁移策略

### 6.1 路线 B：并行 kernel-v2（已选）

**拓扑（两级隔离）：**

- **Phase 0/1：进程内并行模块。** v2 代码在 `gateway/src/kernel-v2/`，只被测试和 v2 入口引用；不接 live gateway，不改 `kernel.ts`/`boot.ts`/`http/transport.ts`。
- **Phase 1.5+：独立 v2 进程。** `gateway/src/kernel-v2/main.ts` 独立启动，使用 `MAFW_KERNEL_V2_PORT` 与独立数据副本；v1 继续服务，v2 做只读 shadow。
- v1 默认/fallback；只有 cutover 通过后才切换 ingress。

**v1 模块复用政策：**

- v2 可以 import 契约、纯 domain 逻辑、无副作用的工具函数。
- v2 不得 import v1 组合根（`kernel.ts`、`boot.ts`、`http/transport.ts`）或直接复用 v1 的单例。
- Phase 1 只包装 TTS/usage 的接口；memory/goal/pod/runtime 的 domain 逻辑在 Phase 2/5 通过接口 port，不在 Phase 1 重写。

### 6.2 Shadow compare

- **HTTP**：status + selected headers + normalized JSON；忽略 timestamp/ID/随机数；每子系统定义 golden fixtures。
- **TTS**：固定文本/voice/style 的 PCM/WAV byte compare；sample rate/header 必须一致；流式分块允许边界差异，但拼接后 byte 一致。
- **Events**：canonical event golden files，比较 type/sequence/关键字段；不比较时间戳。
- **Usage**：record/replay fixture，CI 不 live fetch；provider 输出归一化后比较。
- **Writes**：只在数据副本上跑；双写要等 schema 前后兼容证明后才允许。

Shadow compare 基础设施是 Phase 1 的 gate deliverable，不是“以后再说”。

### 6.3 Cutover runbook

1. v1 进入 **fixes-only** 迁移期；新功能只进 v2，或明确双维护预算。
2. 在 turn 边界 drain 会话；快照 DB + event cursor。
3. 在数据副本上跑 v2 迁移；验证 schema **向前/向后**兼容。
4. v2 在副本上 shadow compare；通过后对 live 数据只读运行。
5. 按项目/功能切 ingress；监控错误率、p95、事件连续性；保留 v1 read-only fallback。
6. 回滚：停 v2，v1 在原数据上恢复；schema 必须能回退。
7. v1 `MafwScheduler` 退役标准：所有路由/子系统由 v2 服务；rollback drill 通过；v1 只读观察 N 天；无未迁移的 write path。

**Rollback drill 是每个 cutover 的 gate deliverable**，不是 Phase 6 的补丁。

### 6.4 Desktop cutover

- Phase 1 不在 desktop 切主入口；先做 plugin host / slot 的并行实现。
- Desktop 使用**并行窗口**验证，不直接替换默认窗口；v1 窗口保留到 v2 槽位通过全量测试。
- Solid 视图保留；不重写 Monaco/终端/浏览器。

### 6.5 禁止

- 在现役 `main` 上 flag-day 替换整个内核。
- 先做 marketplace / 第三方不可信插件。
- 先做有状态核心热插拔。
- 把 registry 做成新的上帝对象。
- 把 memory schema、Goal/Pod 状态机、session log 一起重写。
- shadow compare 未落地就 cutover。

## 7. 成功标准

- 新增一个叶子 provider 不需要改 gateway 核心文件。
- 一个坏 provider 不会拖垮 boot；fallback 可观测。
- 插件可以声明并调用 agent tool；失败不影响核心闭环。
- 插件可以观察 canonical 事件；observer 超时/异常 fail-open；interceptor 未开放。
- desktop 插件可以贡献 menu / composer / panel rail；不注入原生组件。
- 每次替换有诊断、last-known-good、回滚路径。
- 每个 Service Definition 有 conformance kit；非内置 provider 通过才激活。
- 全量测试基线稳定：每个 gate 前在 canonical build 上连续 2 次 clean full-suite。
- **kernel change budget**：每新增一个 provider，核心文件改动 0 行（manifest/registry 除外）。
- webview 无 apiToken；runtime/plugin 契约四条不变量有守卫。
- shadow compare 有 golden fixtures；cutover 有 rollback drill 记录。

## 8. 开放决策

1. 路线：**已选 B（并行 kernel-v2，2026-11-12）**；A/C 保留备选。
2. 第三方 gateway provider：先 trusted install，后 worker。
3. Desktop UI：保持声明式 + sandboxed web surface；不注入原生组件。
4. 可调整点边界：memory schema / Goal 状态机 / session log 不在范围。
5. 热插拔：只限无状态 re-registration；有状态 restart。
6. 第一个生产化 seam：TTS/usage 先落地，ASR 紧随。
7. legacy 目录：一个发布周期；`ui-plugins` 默认关闭/显式同意；写移除日期。
8. 威胁模型：以 §2.1 为准；是否加签名/allowlist 由 installer 政策决定。
9. Capability versioning：是否允许多 major 共存？默认不允许，除非显式 provider set。
10. Desktop cutover：并行窗口（已定）；不替换默认窗口直到 gate 通过。

## 9. 关联计划

实施路线图见：

`docs/superpowers/plans/2026-11-12-fixed-core-capability-roadmap.md`
