# 统一 Gateway 插件包 + 声明式 Desktop UI 设计

日期：2026-11-03
状态：已批准（设计）
实现计划：`docs/superpowers/plans/2026-11-03-unified-declarative-plugin-packages.md`、`docs/superpowers/plans/2026-11-03-agent-create-mode.md`
参考：DeepSeek Harness 的统一 bundle、Plugin Manager、UI slots、HMR 与 Creator 工作流；不引入 Cordis，不执行插件 Client 代码。

## 1. 意图与 Why

MAFW 当前已有 runtime/media/tts/usage 插件、统一插件包雏形，以及 desktop main 进程的工具卡插件，但它们仍有多套目录、入口、生命周期和前端接线：

- `~/.mafw/plugins/` 的 `uiTools` 只登记，Desktop 不消费。
- `~/.mafw/ui-plugins/*.js` 由 Desktop main 单独加载，只能渲染工具卡。
- 插件自定义 `plugin:*` SSE 可以到 Desktop，但没有声明式消费者。
- PluginHost 有 watcher，但缺少统一的注册清理、失败保留旧版本和客户端 revision。
- Agent 尚不能通过同一 Plugin Manager 创建并迭代插件。

本设计先交付 **统一 Gateway Host 插件 + 声明式 Desktop Client + 双端热重载**。后续 Agent Create 只负责生成同一种包并调用同一管理面，不再建立第二套“生成代码插件”生命周期。

## 2. 已确认决策

| 决策 | 内容 | 来源 |
|---|---|---|
| 运行位置 | 插件 Host 代码仍在 gateway 进程内，是本机可信代码 | 用户 |
| Runtime 事件边界 | runtime native 事件必须经过注册映射/翻译才能进入核心；未翻译事件 default-deny | 用户 |
| Desktop UI | 第一阶段只做声明式 UI；renderer 不加载或执行插件 JS | 用户 |
| Agent Create | 第二阶段再做，复用本设计的包格式、检查、安装和 HMR | 用户 |
| 包形式 | 一个包、一个入口、一份 activate 贡献、一个生命周期；不再增加独立 desktop 插件包 | 用户 |
| 参考 DSH | 借统一 bundle、Plugin Manager、slots、HMR、只读能力检查和生命周期语义 | 用户 |
| 面板呈现 | 每个声明式 panel 是工作台一个动态 L2 tab；空间不足进入「⋯」溢出菜单 | 用户（视觉伴侣 A） |
| 安全边界 | Desktop 只接收校验后的 DTO；插件 Host 不获得新的绕过审批或 RuntimeFacade 的通道 | 设计约束 |

## 3. 目标 / 非目标 / 反目标

### 3.1 目标

- G1：统一 `~/.mafw/plugins/` 包可以贡献现有 runtime/media/tts/usage 能力，以及新的 actions、plugin events、declarative UI。
- G2：Desktop 无需重新构建即可显示插件工作台面板、配置页、工具卡和主窗口内消息小窗。
- G3：声明式 UI 可以通过受控 action 调回对应 gateway 插件，并按注册的插件事件刷新。
- G4：包变更可以热重载；成功时双端切换到同一 revision，失败时保留旧 active revision。
- G5：安装、启停、删除、检查、descriptor 获取和 action 调用复用一个 Plugin Manager、REST/SDK/preload 面。
- G6：legacy 目录可继续运行，但新能力只扩展统一包；冲突和优先级可预测。
- G7：契约测试能抓住未注册事件、canonical 伪造、危险 UI、卸载泄漏和旧 revision 回流。

### 3.2 非目标

- N1：第一阶段不实现 Agent Create/Creator preset；第二阶段的产品与契约范围见 §15，不在第一阶段提前实现。
- N2：不支持任意 Solid/React/JS Client bundle，不把插件代码放进 renderer。
- N3：不引入 Cordis、Loader YAML、DSH profile 或 DSH 包格式兼容层。
- N4：不实现插件市场、远程安装源、签名体系或新的 OS/进程沙箱。
- N5：不重写现有 runtime adapter 的 native→canonical 翻译机制。
- N6：不承诺 active runtime 在有工作运行时无中断替换；这类变更显式进入 pending/安全点流程。
- N7：不建立第二套通用 HTTP 路由注册器；插件交互走命名空间化 action。
- N8：消息小窗只存在 MAFW 主窗口文档内，不创建独立 Electron BrowserWindow，不支持系统级置顶、跨桌面悬浮或全局快捷键。

### 3.3 反目标

- `index.js + ui.json + desktop-entry.js` 多入口并存。
- Desktop 再扫描一个统一包专用目录，或再建一套插件管理状态。
- 以“声明式”为名引入任意表达式求值、脚本模板或动态 import。
- 插件通过 `ctx.emit` 伪造 `turn.completed` 等 canonical 核心事件。
- 热重载只更换 UI，却留下旧 action/event/timer/listener。
- Agent Create 日后另走 define/run 临时插件体系。

## 4. 参考 DSH 的映射

| DSH 机制 | MAFW 采用方式 |
|---|---|
| 统一 bundle（Host + Client artifact） | 统一 Plugin Package（gateway Host + 声明式 `ui` 贡献） |
| Plugin Manager | 扩展现有 PluginHost、插件 Hub REST、SDK 和 Desktop Plugins 页 |
| Client slots | Desktop 内置 SlotHost；插件只能注册已支持的 slot |
| HMR | PluginHost 整包 staging/commit + revision；Desktop 按 revision 换 DTO |
| Creator 只读检查 | 后续 Agent Create 读取本设计公开的 action/event/UI/capability descriptor |
| disposer / effect 生命周期 | 每个包的 RegistrationBag，统一 abort/dispose，LIFO 清理 |
| 持久安装后迭代 | 第一阶段人工/脚本改包；第二阶段 Agent 生成同一包并走同一 Manager |

不采用 DSH 的可执行 Client、轮询 UI、Cordis 专有 API 或将 `danger-full-access` 当作默认体验。

## 5. 统一包契约

### 5.1 文件形态

```text
~/.mafw/plugins/example/
  plugin.json
  index.js
  ...包内其他 Host 源码/只读资源
```

`plugin.json`：

```json
{
  "name": "example",
  "version": "0.1.0",
  "main": "index.js"
}
```

- `main` 缺省为 `index.js`。
- `plugin.json` 只承载包元数据；不建立独立 UI manifest。
- 单文件 `~/.mafw/plugins/example.js` 继续支持，视为等价单入口包。
- 目录包内可 import/require 自己的 Host 模块；这些模块仍只在 gateway 执行。

### 5.2 唯一模块形态

新统一包采用：

```js
module.exports = {
  name: "example",
  async activate(ctx) {
    return {
      events: [/* §6 */],
      actions: {/* §7 */},
      ui: {/* §8 */},
      usage: undefined,
      media: undefined,
      tts: undefined,
      runtime: undefined,
    }
  },
}
```

- 所有贡献来自同一次 `activate()`，共享一个 candidate context、RegistrationBag 和 revision。
- 旧的顶层静态贡献导出由 legacy 适配路径读取；新文档、新检查器和新 Agent Create 只生成上述形态。
- manifest 名、module `name`、目录名归一化后的包身份必须一致；冲突拒绝 candidate。
- 纯 UI 包也使用 `activate(ctx) { return { ui: ... } }`，没有第二入口。

## 6. 插件事件契约

### 6.1 注册

`events` 是数组，每项：

```ts
type PluginEventDeclaration = {
  type: `plugin:${string}`       // 必须是 plugin:<package>:<event>
  payloadSchema?: JsonSchema     // 校验 event.properties
  scope?: "global" | "session"
}
```

示例：`plugin:example:changed`。

规则：

- 只能注册属于本包命名空间的 `plugin:<package>:*`。
- canonical 名称、其他包的 `plugin:*` 名称、空名称均拒绝。
- `scope:"session"` 要求 properties/sessionID 符合 MAFW 中性信封约定。
- `payloadSchema` 存在时，gateway 在广播前校验；失败则丢弃、记 translation/contract diagnostic，不进入 event_log。

### 6.2 发射与核心隔离

统一包保留窄 `ctx.emit` 形态，但 PluginHost 包装后只接受本包已注册的完整事件类型：

```js
ctx.emit({ type: "plugin:example:changed", properties: { id: "a" } })
```

- 未注册事件、错误命名空间、schema 失败均不广播。
- 插件事件进入 Desktop 的插件事件路由，不被当作 runtime canonical 核心事件。
- runtime 原生流仍走 `event-mapper → tool assembly → RuntimeFacade`；本设计不增加插件旁路进入该链。
- `POST /api/events` 等既有管理/诊断入口不是统一插件的发射 API；统一插件不得依赖它们绕过注册。

## 7. 插件 Action 契约

`actions` 是本包的动作注册表：

```ts
type PluginActionDeclaration = {
  inputSchema?: JsonSchema
  outputSchema?: JsonSchema
  timeoutMs?: number             // 有默认值与全局上限
  handler(input: unknown, call: {
    sessionID?: string
    signal: AbortSignal
  }): Promise<unknown> | unknown
}
```

- handler 在 `activate(ctx)` 闭包内捕获所需 Host 能力；不把 raw runtime、Electron、gateway 对象暴露给 Desktop。
- 调用前校验 input，返回后校验 output；错误使用中性插件错误码。
- 所有调用有 AbortSignal、超时、输出大小上限和请求代际；包卸载时 abort 在途调用。
- action 不是任意 shell/API 转发器，权限仍由现有审批与插件信任模型约束。
- UI 只能按本包 action 名调用；跨包调用不属于本设计。

## 8. 声明式 Desktop UI

### 8.1 共享契约包

新增一个零 DOM、零 Electron、零 gateway 依赖的共享包（设计定为 `packages/plugin-contract`），承载：

- Plugin Client Descriptor DTO。
- Widget/View、slot、action/event descriptor 类型。
- configPages 使用的 JSON Schema 表单子集与结构验证入口。
- Widget/View 防御性校验与大小/深度限制。

action 的 input/output 使用标准 JSON Schema，由 gateway 使用 Ajv 校验；禁止远程 `$ref`、代码求值和未受限的外部 schema 加载。configPages 单独使用上述 UI 表单子集，不因为 action 支持完整 JSON Schema 就开放任意表单结构。共享包保持无 DOM/Electron/gateway 依赖，Ajv 只作为 gateway 校验依赖。

gateway 用共享契约验证激活产物与响应，SDK 重导出客户端类型，Desktop 用它再次验证输入。现有 `desktop/src/shared/ui-plugins.ts` 的 Widget 词汇迁移/兼容到该契约，避免 gateway/Desktop 各写一份漂移校验。

### 8.2 View DTO

复用并扩展现有 Widget 树：

```ts
type PluginView = {
  title?: string
  subtitle?: string
  icon?: string
  body: Widget[]
}
```

保留 text/code/kv/tags/list/row/image/link/markdown/progress，新增：

```ts
type ActionWidget = {
  type: "action"
  label: string
  action: string                 // 当前包内的 action 名
  input?: unknown                // 静态 JSON，经校验
  style?: "default" | "primary" | "danger"
}
```

- Markdown 继续先转义 raw HTML。
- link 继续走 Desktop browser-policy。
- image 只允许既有安全来源/大小限制。
- Widget 树有最大节点数、深度、文本字节和二进制大小上限。
- 不支持函数、表达式、事件 handler、任意 HTML/CSS/JS。

ActionWidget 的返回语义固定为：action 返回合法 PluginView 时直接替换发起它的当前视图；返回普通 JSON/undefined 时在原视图内显示成功/结果摘要，并重取当前 `viewAction`；失败在原视图内显示中性错误，不清空最后一次可用视图。配置页的 load/save 不套用 ActionWidget 的视图替换语义。

### 8.3 首批 slots

`ui` 只包含以下三类：

```ts
type UiContribution = {
  panels?: Array<{
    id: string
    title: string
    icon?: string
    order?: number
    viewAction: string
    refreshOn?: string[]          // 本包已注册 plugin event type
  }>
  toolCards?: Array<{
    id: string
    tools: string[]
    override?: boolean
    viewAction: string
  }>
  configPages?: Array<{
    id: string
    title: string
    schema: JsonSchema
    loadAction: string
    saveAction: string
    reloadOnSave?: boolean
  }>
  messageWindows?: Array<{
    id: string
    title: string
    triggerEvent: string
    viewAction: string
    modal?: boolean
    dismissible?: boolean        // 缺省 true
  }>
}
```

语义：

- **panels**：每个 panel 是右工作台“工作台”的一个动态 L2 tab，surface id 为 `plugin:<package>:<panel>`；按 `order`、title、包名稳定排序，空间不足进入「⋯」溢出菜单。挂载时调用 `viewAction` 获取 PluginView，`refreshOn` 事件到达后重取。删除当前 surface 后回退到内置 `code`，键盘导航与溢出菜单使用同一排序。
- **toolCards**：插件声明逻辑工具名，Desktop 复用现有 alias/canonical-tool 解析（包括 `mafw_*` 与 MCP 双前缀），不要求作者逐字列 wire 别名。Desktop 将中性 ToolCardModel（tool/input/output/metadata/status）作为 action input 发给 gateway，不依赖 runtime 私有历史存储，因此历史回放缓存也能渲染。input/output 有统一字节上限与显式 truncated 标记；running 阶段保持默认卡，completed/error 才请求插件视图，避免流式 O(n²) 请求。
- **configPages**：Desktop 根据受限 JSON Schema 生成表单；load/save 只走声明的 actions。首版字段限 text/number/boolean/select，不提供 secret 字段或 secret 回显。统一包 ctx 新增只允许写 `plugins.<package>.config` 的 `config.update()`，经 `config.persistOverrides` 原子落盘；`pluginConfig()` 改为每次调用现读。保存默认不重载包，`reloadOnSave:true` 时在保存成功后走同一 candidate/reload 流程。
- **messageWindows**：`triggerEvent` 必须引用本包已注册事件。事件到达时在 MAFW 主窗口内打开 `<package>:<id>` 对应的单例小窗，并把中性事件 payload/sessionID 作为输入调用 `viewAction`；同 id 的后续事件只刷新，不重复堆窗。`modal:false` 为不阻断聊天的浮动小窗且不主动抢焦点，`modal:true` 为主窗口内居中模态层并管理焦点；dismissible 时支持关闭按钮与 Esc。内部按钮仍是 ActionWidget，经本包 action 回调 gateway。面板 action 需要开小窗时，由 Host 在 action 中发射相应注册事件，不新增脚本化 UI 命令。
- slot id、action 名和 event 引用必须在同一包内可解析，否则 candidate 校验失败。
- panel id 在包内唯一；客户端全局 key 为 `<package>:<id>`，避免跨包冲突。

### 8.4 Desktop 数据流

```text
GET Plugin Client Descriptor
  → plugin-store（revision + descriptors）
  → SlotHost
      ├─ Workbench panel → viewAction → PluginView → WidgetRenderer
      ├─ Tool card       → viewAction → PluginView → ToolRegistry 代理
      ├─ Config page     → schema form → load/save actions
      └─ Message window  → viewAction → PluginView → 主窗口内小窗

plugin:* SSE
  → 核心 dispatcher 后的 PluginEventRouter
  → 按 descriptor.refreshOn 失效对应 panel/view
  → 按 descriptor.messageWindows.triggerEvent 打开或刷新对应小窗
  → 未注册事件记录 miss/diagnostic，不执行插件代码
```

- renderer 只调用 preload `window.api`。
- unified UI 不经过 Desktop main 的 CJS `UiPluginManager`；Host 函数只存在 gateway。
- 现有 `UserPluginCards` 的“恢复原卡 + 代理 + 失败回落”模式复用到 unified toolCards。
- Desktop 不消费 runtimeName/runtimeCaps 推导插件能力；只消费本契约 DTO 与 Experience/View 边界。

## 9. Plugin Manager、REST、SDK 与 preload

不新建第二管理器，扩展现有面：

- `GET /api/plugins`：保留 Hub 状态，并补 activeRevision、pendingRevision、lastError、贡献摘要。
- `GET /api/plugins/client`：一次返回 `{revision, plugins: ClientPluginDescriptor[]}`，供 Desktop 启动与重同步；只包含 active contributions，不包含 pending candidate。
- `POST /api/plugins/:name/actions/:action`：调用统一包 action；body 为中性 `{input, sessionID?}`。
- `POST /api/plugins/packages/install`：body 为 `{path, overwrite?}`，从本机绝对目录安装目录包。gateway 验证 source/plugin.json 后以临时目录 + rename 原子复制到 `~/.mafw/plugins/<name>`；Desktop 通过原生目录选择器获得路径，不开放通用文件系统 API。第二阶段 Agent Create 使用同一接口安装草稿目录。现有 raw octet-stream install 继续用于单文件包，不增加 zip 上传面。
- `POST /api/plugins/check`：body 为 `{path}`，加载并激活一个 candidate、校验全部贡献后随即 dispose，不发布任何 registry/revision；它运行的是本机可信 Host 代码，不是安全沙箱。CLI 与后续 Agent Create 复用同一检查实现。
- `POST /api/plugins/:name/apply`：应用该包的 pendingRevision；内部复用既有 runtime switch/安全点编排，不要求 Desktop 构造 runtime 名或调用“切换到同名 runtime”。
- `POST /api/plugins/:name/reload`：显式重新扫描单个包，用于 `reloadOnSave:true` 与插件中心“重新加载”；与文件 watcher 共用同一 staging/commit，不绕过 pending 规则。
- 现有 enable/disable/delete 复用并按**包名**寻址统一包。禁用状态由 Manager 写入独立、原子持久化的 `~/.mafw/plugin-package-state.json`，不改 plugin.json、不重命名目录；delete 先 dispose，再对经 realpath/containment 验证的 `~/.mafw/plugins/<name>` 做递归删除，绝不按调用方任意路径删除。
- 成功应用后更新 client revision。`plugins.changed` 在 active、pending、enabled 或诊断状态变化时发出，携带当前全局 revision；Desktop Plugins/Hub 重拉 `/api/plugins`，Client SlotHost 重拉 `/api/plugins/client`。pending 出现时不要求 active client revision 改变。
- 所有路由进入 route catalog/OpenAPI/SDK contract；preload 增加静态 `plugins.client/invoke/check/installPackage/apply` 方法，renderer 不使用通用字符串 IPC。

返回给 Desktop 的 descriptor 只含序列化数据：包名、版本、revision、ui、event/action 描述与诊断；绝不包含 handler、Host source 或函数。

## 10. 生命周期与热重载

### 10.1 RegistrationBag

每个 candidate package 有独立 RegistrationBag：

- action/event/UI 注册、watcher、timer、listener 和自定义 cleanup 都归属该 bag。
- `ctx.effect(disposer)` 注册插件自己的外部副作用清理。
- dispose 幂等，按 LIFO 执行；先 abort 在途 action，再退订事件/服务，再执行自定义 cleanup。
- 单个 disposer 失败记录并继续其余清理。
- candidate 被丢弃或卸载后，其迟到的异步 emit/action 回调成为 no-op 或 abort error。

### 10.2 staging → commit

```text
fs.watch / 手动 reload / install / enable / disable / delete
  → 300ms 防抖
  → 扫描并校验所有 candidates
  → 激活 candidate，贡献与引用先进入私有 staging
  → 任一包失败：清理该 candidate，旧 active revision 保持
  → commit：清理被替换的旧包 → 一次性发布全部 loader/registry 回调
  → revision +1 → 持久状态/Hub 更新 → plugins.changed
```

- 每次扫描为包计算内容指纹（manifest + 实际包源码/声明文件，排除忽略目录）。指纹与 active 相同的包直接复用现有实例、RegistrationBag 和 activeRevision，**不重新 activate、不清 timer、不清缓存**；只有新增/指纹变化/显式重建的包进入 candidate。
- 不改变无关包的 active revision。
- 包删除时删除其全部贡献；Desktop 卸载对应 slots，并恢复被代理的内置卡。
- 目录包内任何源码/声明文件变化都可触发 reload；忽略 `node_modules`、`.git` 与日志/临时产物。watcher 的具体跨平台实现留给 builder。
- require/import 缓存清理只覆盖变更包实际加载的本地模块子树，不只清 `index.js`，也不清无关包。
- 新 candidate 的 `plugins.changed` 只有在 commit 后才可发出；pending 状态变化由 Manager 自身发出。

### 10.3 active runtime 例外

若变更包拥有当前 active runtime：

- candidate 可以完成离线校验，但不自动打断正在使用的 runtime。
- 整包 candidate 进入 `pendingRevision`，不能出现 UI 已换新而 runtime 仍旧的半提交。
- 用户显式应用后，在既有 runtime switch/安全点流程中完成整包 commit、事件重订阅和 revision 发布。
- 失败保留旧 active runtime 与旧包 revision。

### 10.4 Revision 与 Desktop 切换

- revision 是不透明字符串 `<gatewayBootId>:<counter>`，不是可能跨重启回退的持久整数。每次 gateway 启动生成新 bootId；每次全局可见 client 变化推进 counter。每包 activeRevision 是该包最后 commit 时的全局 token，pendingRevision 同理指向 candidate。
- Desktop 同时比较 bootId 与 counter；gateway 重启后即使计数相同也视为新代际。
- 每个 view/action 请求带发起时的包 revision 与 bootId；旧 revision 的迟到响应丢弃。
- 全局 revision 改变后拉取 descriptor 并按包 diff：只重建新增/变更/删除包的声明式注册，无关包的 panel 状态、滚动位置、小窗和未保存配置草稿保留。变更包的旧草稿标记 stale，不允许静默提交到新 schema。
- 变更包已打开的小窗在新 descriptor 仍兼容时按新 viewAction 重取；declaration 消失或包 disable/delete 时立即关闭并释放其焦点/在途请求。
- 新 descriptor 校验失败时保留该包旧 Client DTO，并显示插件诊断。
- legacy `mafw-ui-plugins-changed` 仅服务 legacy UI 适配；unified 包以 gateway revision 为准。

## 11. Legacy 兼容与冲突

- `runtime-plugins/`、`media-plugins/`、`tts-plugins/`、`usage-plugins/`、`ui-plugins/` 保持现有加载语义，由 Hub 汇总展示。
- 新 actions/events/panels/configPages 只接受统一包，不向 legacy 目录扩散。
- unified toolCard 默认只补空位；覆盖内置卡必须 `override:true`。
- unified 与 legacy 撞同一 tool：unified 仅在 `override:true` 时接管，否则 legacy 保持并产生可诊断冲突。
- 多个 unified 包对同一 tool 的有效接管声明冲突时拒绝后提交的 candidate，不依赖文件遍历顺序静默覆盖。
- 既有统一包顶层 `uiTools` 历史上只登记、没有 Desktop 消费者或已定义渲染形状，因此不虚构兼容映射：继续作为 deprecated 展示字段，文档指向新 `ui.toolCards`；实际 legacy 工具卡兼容只针对有明确契约的 `~/.mafw/ui-plugins/*.js`。

## 12. 错误、安全与恢复

- Host 是本机可信 CJS；本设计不声称提供恶意插件隔离。
- activate 抛错、模块语法错误、schema 失败、非法 slot/action/event 引用均不发布 candidate。
- 启动时坏包进入 error 状态且不激活；Desktop Plugins 页和 CLI 可禁用它。
- action/emit 的输入输出有大小限制；日志脱敏沿用 gateway 现有红线。
- unified Client 不接触文件系统、Node、Electron 任意 IPC、shell 或 pnpm。
- messageWindow 只是主窗口 DOM 内的受控 overlay/floating view，不创建 BrowserWindow、不更改窗口置顶/焦点策略；modal 的焦点陷阱与 Esc 遵循现有 UI 组件约定。
- 本阶段不承诺从 `process.exit()`、同步死循环等恶意/严重 Host 错误中无感恢复；后续可用独立 staging gateway/Host 加强，但不能把它写成已有安全保证。

## 13. 验收场景

至少用一个真实 example 包验证完整闭环：

1. 安装含一个工作台 panel、一个配置页、一个工具卡、一个主窗口内 messageWindow、一个 action、一个注册事件的统一包。
2. Desktop 不重启即可看到 panel；action 能更新 Host 状态并返回新 PluginView。
3. 注册事件到达后仅刷新订阅它的 panel；messageWindow 的 triggerEvent 能打开/刷新单例小窗，内部 action 可调回 Host，Esc/关闭/卸载能正确清理；未注册事件和 canonical 伪造被 gateway 丢弃并留诊断。
4. 修改包内 UI、action 和事件声明后，双端进入同一新 revision；旧请求响应不会覆盖新视图。
5. candidate 校验/activate 失败时旧 active revision 继续可用，Hub 显示新错误。
6. disable/delete 后 action 不可调、事件不再发、panel/config/toolCard 全部撤销，timer/listener 被清理。
7. active runtime 包变更只进入 pending，不静默打断当前工作；显式应用后才整包切换。
8. legacy UI 工具卡和 runtime/media/tts/usage 插件回归通过。

## 14. 测试与门禁

- `packages/plugin-contract`：DTO/schema/Widget/大小深度/危险输入验证。
- gateway：包扫描、唯一 activate、action/event 注册、命名空间、schema、RegistrationBag、staging/commit、失败保留、缓存清理、revision、active-runtime pending、REST 契约。
- SDK：client descriptor/action 方法、事件 union 与契约新鲜度。
- Desktop：plugin-store revision、PluginEventRouter、panel/config/toolCard/messageWindow slots、action widget、消息小窗单例/焦点/Esc/卸载、旧响应丢弃、卸载恢复内置卡、legacy 冲突。
- 架构测试：renderer 不加载 Host 代码；业务 UI 不读取 runtimeName/runtimeCaps；路由均登记 catalog。
- 全量运行 gateway、desktop、SDK、session-ui 及受影响包测试与 typecheck/build；交付时报告新增测试数与全量通过数。
- GUI 冒烟：真实 example 包的安装、panel/config/toolCard/messageWindow、action/event、热重载、失败回退与删除。

## 15. 第二阶段：Agent Create / Creator 模式

> 本节是正式纳入设计的第二阶段范围。实施前提是 §5–§14 的统一包、声明式 UI、Plugin Manager、revision 和热重载已经验收。第二阶段对齐 DSH 当前的“普通 blank Session + workspace 源文件 + 原生审批工具 + Plugin Manager”流程，不建立另一套会话、草稿或插件协议。

### 15.1 目标与非目标

目标：用户从 Desktop 进入 Creator，通过对话让 Agent 创建、验证、安装并持续迭代一个统一插件包；生成的 panel/config/toolCard/messageWindow 在真实 MAFW 主窗口中立即可见。

- 创建入口位于 **Plugins → Add plugin → 让 Agent 创建插件**。
- 入口复用当前项目可接收 preset 的 blank Session；需要新会话时走现有普通 Session 创建流程。只有接收会话切换到 `mafw-create`，它仍是普通会话，不是新的 session 类型。
- 进入入口时不自动发送消息、不丢弃任何会话的 composer 未发送草稿、不改变普通新会话的默认 Agent。
- Agent 只生成 §5 的 `plugin.json + index.js` 统一包，UI 只能生成 §8 的声明式描述。
- 安装、启停、删除、pending 应用和 revision 全部复用第一阶段 Plugin Manager。
- 同一草稿可由任意 Creator 会话反复“修改 → 检查/测试 → 审批 → 安装/覆盖 → 真实 UI 验证”，不绑定来源会话。

第二阶段不做：专用 Creator Session API、全局 DraftStore 或 draft↔session 绑定、任意可执行 Client bundle、Agent preset 编辑器、插件市场、模型直接 define/run 临时代码、绕过 Plugin Manager 写 active 插件目录、无审批的 Host 代码安装。

### 15.2 Creator 身份与开发技能

在 IdentityRegistry 注册 `mafw-create`，其系统提示与随包技能包含：

- 统一包和贡献契约、四类 UI slots、ActionWidget、事件命名空间和 revision 行为。
- 最小依赖/零依赖模板，以及 panel/config/toolCard/messageWindow 的参考骨架。
- “先检查可用 API，再写代码；先形成可验证最小版本，再扩展视觉”的工作顺序。
- 测试先行：为 action 行为、事件 payload、View DTO 和错误路径生成可运行测试；UI 以真实渲染验证为准。
- 明确区分 draft saved、check passed、installed、activated、pending、failed/disabled；不把写文件成功说成插件已运行。
- 插件内容已由工作区文件承载时，Agent 的记忆只记路径和 gist；不把生成全文写入长期记忆。

Creator 不获得 raw runtime、gateway 内部对象或通用插件管理 HTTP 转发。身份 allowlist 只含 readonly/file-edit、question/todo、`mafw_add_memory`/`mafw_search_hybrid`/`mafw_get_memory`、`mafw_plugin_inspect` 与 `mafw_plugin_manager`；拒绝 shell、web、subagent 以及无关的 goal/pod/task/python/media/desktop/automation/restart 能力。`mafw-create` 与 DSH Creator 一样可出现在普通 primary-agent/preset 选择器，不新增 entry-only 身份机制。

本期实现选择是不向 Creator 开放通用 shell；草稿测试由 `mafw_plugin_manager.test` 执行，避免把 shell 当成绕过 Manager 的平行安装通道。通用 file-edit 的路径约束是工作流约定，不宣称它是恶意代码 sandbox；真正的安装边界是 Manager 的来源校验与逐次人工审批。

### 15.3 只读能力检查

新增**插件原生**模型工具 `mafw_plugin_inspect`，只读查询第一阶段已公开的契约：

- `clientDescriptors`：现有包、版本、active/pending revision、UI slots 和诊断。
- `actions` / `events`：descriptor 中的名称、schema、scope 和限制。
- `slots` / `widgetSchema`：当前 Desktop 支持的 slot、Widget 类型、字段和大小限制。
- `package`：指定包的 descriptor 与公开配置 schema。
- `experience`：仅返回 Experience/公开能力描述，不返回 runtimeName、私有对象或原生 SDK 形状。

检查工具只读，不调用业务 action、不执行插件方法。Creator 先检查再生成，避免凭空猜 API。候选包的静态/激活检查由 §15.5 的 `check` 承担，两者不混称。输出必须有明确字节上限与 `truncated` 标记。

### 15.4 项目内草稿与持久状态

- 每个包使用 `<project>/.mafw/plugin-drafts/<packageName>/` 作为源目录；会话 cwd 仍是当前项目，不为 Creator 改写。
- 草稿只按项目路径和包名管理，不生成 draftId，不写 gateway kv，不记录 creatorSessionID。文件系统是草稿真相源。
- 草稿随项目文件天然跨 Desktop/gateway 重启保留；任意 Creator 会话可继续编辑，不承诺恢复某个来源会话。
- 本期不为 worktree 会话提供 Creator 入口；从 Plugins 进入时总是复用/创建主项目中的普通 blank Session，避免草稿随 worktree 清理而消失。
- Agent 通过 `mafw_plugin_manager.check/test/install` 引用草稿时只传相对包目录名；工具根据真实 session 的项目目录解析，并以 realpath 拒绝符号链接或 `..` 逃逸草稿根。
- 安装始终由第一阶段 `PackageManager` 从该草稿目录完成；覆盖已有包必须显式 `overwrite:true` 并逐次审批。
- 草稿是源，active 包是安装副本；迭代始终先改草稿。remove 只清理安装副本和 active 贡献，默认保留项目内源草稿。

### 15.5 原生 Plugin Manager 工具与审批

新增**插件原生**工具 `mafw_plugin_manager`，复用真实工具上下文的 sessionID/callID/abort signal，不使用模型自报 sessionID，不建立无会话的 MCP 旁路：

- 只读：`list`、`status`、`descriptor`。
- 代码执行：`check({draft})`、`test({draft})`。两者都可能运行草稿代码，不属于只读检查。`test` 固定以草稿为 cwd 运行 `node --test` 发现其中的 `*.test.js`，有 60s 超时、清理环境变量和输出字节帽；不执行 package scripts，不是第三个工具。
- 写入：`install({draft, overwrite?, requestId?})`、`enable`、`disable`、`remove`、`reload`。`applyPending` 不暴露给模型，只由用户在 Plugins 页显式执行；Creator 从 `nextStep` 得知应请求用户操作。
- 所有操作返回结构化 `{saved, application, activeRevision?, pendingRevision?, error?, nextStep}`；拒绝、取消或审批不可用不执行操作。
- full-access 可按既有策略直接执行；其他模式下，代码执行和写入逐次通过工具上下文的原生 awaitable `ctx.ask` 审批。即使 session 是 `auto` 档，这些操作也强制 human；`ask` 传 `always: []`，所以即使 UI 出现 always 也不会沉淀可放行后续调用的规则。单次批准不提升会话权限，也不建立 draft/session 级永久授权。
- 工具不是 Creator-only 授权边界：其他会话若获得该原生工具，也走完全相同的 force-human/full-access 规则；`mafw-create` allowlist 只决定 Creator 自己能调用什么。
- 实施前先做一个 wire probe，确认原生工具审批能够等待、拒绝和取消，且取消后不会继续执行。运行时不能提供该通道时 Creator 显示中性不可用原因；不以 MCP question 调用冒充等价审批，也不新增异步审批注册表。
- `requestId` 表示一次真实操作意图：网络重试沿用同一随机 id，新的迭代必须使用新 id；禁止用 operation + draft + overwrite 的确定性哈希代替，否则会重放旧安装结果。进程内缓存不冒充跨重启 exactly-once。
- install/overwrite 的 approval pattern 至少包含 packageName、草稿名、overwrite 和内容 fingerprint；完整贡献摘要来自前一步 check 的对话输出。执行前重新计算 fingerprint，变化则拒绝并要求重新审批。
- 包内依赖安装、构建脚本和原生模块不获得隐式许可；Creator 不修改全局 PATH、registry 或用户包管理配置。

### 15.6 创建与迭代流程

```text
Plugins → 让 Agent 创建插件
  → 复用/创建当前项目的普通 blank Session（不自动发消息）
  → 仅该 Session 通过现有 switchAgent/session-config 选择 mafw-create
  → 用户描述需求
  → mafw_plugin_inspect 检查真实宿主契约
  → 在 <project>/.mafw/plugin-drafts/<packageName>/ 生成统一包 + 测试
  → mafw_plugin_manager.check/test（逐次代码执行审批）
  → 展示包/覆盖差异并请求安装审批
  → 第一阶段 install + candidate activate + HMR commit
  → Desktop 收到 revision，真实 panel/config/toolCard/messageWindow 生效
  → 同一或另一 Creator 会话继续修改该源草稿并重复上述流程
```

验证要求：

- check/test 通过只表示候选契约与测试通过，不等于恶意代码隔离或所有运行时行为正确；草稿 Host 与安装后的 Host 都是本机可信代码。
- UI 验证必须针对已连接的 MAFW 真实页面；mock preview 不能作为“已装进应用”的证据。本期 Creator 能读取 descriptor 与 Host/activation 诊断，但不新增 Desktop renderer→gateway 错误回传或截图通道；视觉问题由用户在对话中反馈，不能声称 Agent 已自动看见渲染结果。
- 失败时保留旧 active revision；首次安装失败则没有 active 插件，Creator 报告实际状态并修复草稿。
- 对 active runtime 包的修改按 §10.3 进入 pending；Creator 不得擅自打断工作，必须请求用户执行 applyPending。
- 用户可随时 disable/remove；Creator 继续编辑草稿不得自动重新启用。

### 15.7 Desktop 接线

- Plugins 页新增入口及 Creator 可用/加载/拒绝状态；不可用时显示中性原因，不静默失败。
- 入口只使用现有 Session 创建、blank Session 复用、`switchAgent` 和 session-config 通道；**不新增 Creator REST/SDK/preload API，不新建 session store**。
- 现有 sticky agent/session-config 负责重开后的 agent 恢复；不为 Creator 增加第二份身份绑定状态。
- 复用现有 `components/session-drafts.ts` 的 per-session 内存文本草稿，入口只需保留并测试该行为；不新增 Desktop 重启后的草稿持久化，也不把附件/quote 纳入本期保证。
- 插件状态继续使用第一阶段 PackageManager/revision 数据；不增加来源会话链接或另一套 Creator 状态面板。
- 插件 revision 到达时无需刷新整个 Desktop，由第一阶段 SlotHost 局部更新。

### 15.8 第二阶段验收

1. 从 Plugins 入口复用/创建普通 blank Session，未发送草稿与普通默认 Agent 均不变，只有目标会话选择 `mafw-create`。
2. 通过对话在项目草稿目录生成包含四类 UI、action 和注册事件的统一包；模型先调用只读 inspect，再写草稿。
3. 未批准 check/install 时不执行草稿代码、不触碰 active 插件目录；批准后同一包经第一阶段流程检查、安装并激活。
4. 不重启 Desktop 即可看到并操作真实 panel/config/toolCard/messageWindow；Agent 能读取 descriptor 与 Host/activation 诊断并修复对应草稿，不声称自动获得渲染截图。
5. 第二次修改同一草稿并以新 requestId 覆盖安装，旧 revision 响应不回流，用户看到同一新 revision。
6. candidate 失败时旧 active 版本保持；首次失败无残留 active 注册；拒绝/取消审批无后续幽灵执行；auto 模式和既有 always 规则均不能绕过人工审批。
7. active runtime candidate 只进入 pending；模型工具没有 applyPending，只有用户在 Plugins 页显式执行现有 HTTP 编排与 runtime 切换。
8. 重启后项目草稿文件和已安装/pending 状态仍在；任意 Creator 会话可继续。remove 后草稿默认保留，active 贡献全部清理。
9. 单元/契约测试使用确定性的原生工具调用 fixture；另做一次真实模型 + 真机 GUI 冒烟，记录 provider/model 与 commit，不把 LLM 结果作为唯一自动化门禁。

### 15.9 DSH 对齐与明确排除的旧路径

DSH 当前 Creator 复用普通 blank Session，仅切换 `cordis` preset；Agent 把持久 bundle 写成 workspace 文件，再通过原生 `plugin_manager` 逐次审批安装。MAFW 对齐这些所有权边界，但不照搬其 Cordis/profile 格式，也不照搬“list 也需审批”等局部策略。

MAFW 不引入 generated-code define/run/stop/undefine，不建立 session-local 临时插件注册表、专用 Creator Session 或全局 draft↔session 元数据，也不让 Agent 绕过统一包持久化、来源校验与审批。持久化对象是项目内源文件和 Manager 状态，不是某个会话与插件的专有绑定。

## 16. 留给 builder 的实现选择

以下为 builder 可自行决定、不改变产品语义的事项：

- plugin-contract 内部文件划分，以及 JSON Schema 校验器的具体复用/实现。
- RegistrationBag、PluginEventRouter、plugin-store 和 SlotHost 的模块拆分。
- 跨平台目录 watcher 的具体实现与去重策略。
- Workbench L2 动态 surface 的具体存储结构与溢出菜单实现；交互语义固定为 §8.3 的每 panel 一个 tab，删除后回退到内置 `code`。
- Widget 的具体视觉样式，沿用 `@mafw/ui/v2` 与现有设计 token。
- 在不破坏既有 API 的前提下安排兼容别名和迁移提交顺序。
