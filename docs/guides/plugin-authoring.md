# 统一插件包编写指南（Plugin Package Authoring）

> 面向第一阶段（声明式 UI + Host action/event）的插件包作者。
> 参考实现：`docs/examples/plugins/service-monitor/`
> 共享契约：`packages/plugin-contract/`（`validateClientDescriptor` / `normalizePluginView` / `validateConfigFormSchema` / `PLUGIN_UI_LIMITS`）
> 设计文档：`docs/superpowers/specs/2026-11-03-unified-declarative-plugin-packages-design.md`
>
> **也可以让 Agent 代写**：Desktop `Config → Plugins → 让 Agent 创建插件` 会打开一个带 `mafw-create`
> 的普通会话，由 Agent 在 `<project>/.mafw/plugin-drafts/<name>/` 生成、检查、测试并请求安装。
> 入口条件、草稿规则、逐次审批、固定测试命令、pending 与限制见
> [插件 Creator 指南](./plugin-creator.md)。本指南其余部分仍是**手动 Phase 1 流程**与包契约的权威参考。

## 0. 先明确边界

统一插件包由 **gateway 进程执行 Host 代码**，向 Desktop 只发送**可序列化的声明式 UI**：

- 包可以做：注册 action（Host 闭包）、注册 `plugin:<package>:*` 事件、声明 panel / config page / tool card / message window，或用 `ui.webSurfaces[]` 提供**自己的沙箱页面**（`web/` 目录 + 自带 HTTP/WS 路由，见 §6.5）。
- 包不能做：把 Solid/React 组件注入宿主 DOM、把任意 HTML/CSS/JS 塞进声明式 slot、把事件 handler 或函数传到 Desktop；跨包调用 action；发射 canonical runtime 事件；读写任意配置文件。
- 这不是安全沙箱：安装包等于在本机 gateway 进程里执行代码。只安装你信任的目录。（Web 页面的沙箱防的是宿主 UI 被污染，不是防插件作者——见 §6.5。）

第一阶段没有专用 Creator 会话或第二套安装通道；Agent 创建功能只是在普通空白 Session 里用受限的
`mafw-create` 身份写项目草稿，检查/测试/安装仍走本文档描述的同一套包契约与 `PackageManager`。
入口与限制见 [插件 Creator 指南](./plugin-creator.md)。

## 1. 包布局

目录包：

```text
~/.mafw/plugins/service-monitor/
  plugin.json          # 元数据
  index.js             # 入口（默认 main = index.js）
  lib/…                # 可选：包内 Host 模块
  web/…                # 可选：Web 页面（声明 ui.webSurfaces 时必须存在）
```

```json
{
  "name": "service-monitor",
  "version": "1.0.0",
  "main": "index.js"
}
```

规则：

- `plugin.json` 只承载包元数据，没有单独的 UI manifest；UI 从 `activate()` 返回。
- manifest 的 `name`、模块导出 `name`、安装目录名必须一致，否则 activation 失败。
- 包名必须是单个路径段（`^[A-Za-z0-9][A-Za-z0-9._-]*$`），不能含 `:` 或空白。
- `main` 必须位于包目录内；manifest 不能把 Host 指向任意本地模块。
- 单文件包 `~/.mafw/plugins/example.js` 仍受支持，等价于单入口包，名字取自文件名。
- 包内可以 `require` 自己的模块；它们只在 gateway 执行，不会进入 Desktop。
- `web/` 只在声明了 `ui.webSurfaces` 时被服务；入口文件缺失/逃逸会让**整包激活失败**（fail-closed）。单文件包没有 `web/` 目录，不能声明 Web 页面。

### 1.1 `contributes`：声明的上界

`plugin.json` 的 `contributes` 是对注册面的**静态上界，不是运行清单**：声明了某个面，`activate()` 注册的条目就必须落在声明集合内；没有声明的面完全不受约束；声明了却没有注册也合法（包可以按能力、配置或 host 版本条件注册）。违反上界会让**整包激活失败**。

`contributes.gateway` 支持：

| 字段 | 含义 | 违反时的错误 |
|---|---|---|
| `actions` | 允许注册的 action 名数组 | `action "<name>" is not declared in plugin.json contributes.gateway.actions` |
| `events` | 允许发射的事件类型数组 | `event "<type>" is not declared in plugin.json contributes.gateway.events` |
| `tools` | 允许注册的 tool 描述符数组 | `tool "<name>" is not declared in plugin.json contributes.gateway.tools` |
| `observers` | 允许订阅的 observer id 数组 | `observer "<id>" is not declared in plugin.json contributes.gateway.observers` |
| `http` | 是否允许使用 `ctx.http`（`false` 即禁用 http 面） | `http routes are not declared (contributes.gateway.http is false)` |

- `contributes.gateway.http: false` 时，`ctx.http.route()` / `ctx.http.ws()` 一旦被调用，激活失败（即使 `activate()` 本身正常返回）。
- 声明的 `events` 必须写**完整命名空间** `plugin:<package>:<event>`；只写短名会被判为未声明。
- 声明的 `tools` 必须重复 `name` / `description` / `inputSchema`（`name` 与 `activate()` 里的声明一致即可，`description` 与 schema 自由填写）；比对只按 `name`。
- 声明的 `observers` 只写 observer **id**：`onEvent` / `filter` / `timeoutMs` 仍然只能来自 `activate()`，`contributes` 里写不了回调；声明 id 是为了让订阅面在安装时就可审查。
- `apiVersion: 1` 的包：`contributes` **校验失败**只产生 `legacy-contributes` warning，不影响激活，也不构成任何约束；**合法**的 v1 块会照常存储并像 v2 一样构成约束。未声明 `contributes` 的包行为与旧版完全一致。

两条容易踩的边界：

- 只注册 http 路由、没有任何其它贡献的包仍会被 host 的「零贡献」检查拒绝（`http` 不计入 contributions 类别）：`contributes.gateway.http: true` 不等于「可以只做路由」。零贡献判据是 `usage/media/runtime/tts/uiTools/ui/actions/events/tools/observers`，至少要命中其中一项。
- `contributes.desktop.*`（`ui` / `web` / `main`）目前只做契约形状校验，**尚未强制**：声明了什么并不约束 `activate()` 的返回，Desktop 侧也不因声明而放宽/收紧。本节列出的全部注册约束只覆盖 `contributes.gateway`。

## 2. 最小可运行包

```js
module.exports = {
  name: 'example',
  async activate(ctx) {
    let count = 0;
    const view = () => ({
      title: 'Example',
      body: [
        { type: 'text', text: `count=${count}` },
        { type: 'action', label: 'Increment', action: 'bump' },
      ],
    });
    return {
      events: [
        {
          type: 'plugin:example:changed',
          title: 'Example changed',
          scope: 'global',
          schema: {
            type: 'object',
            properties: { count: { type: 'integer' } },
            required: ['count'],
            additionalProperties: false,
          },
        },
      ],
      actions: {
        // viewAction: read-only. It must NOT emit plugin:example:changed.
        refresh: {
          title: 'Refresh',
          inputSchema: { type: 'object', properties: {}, additionalProperties: false },
          handler() {
            return view();
          },
        },
        // User action: safe place to emit the event the panel refreshes on.
        bump: {
          title: 'Increment',
          inputSchema: { type: 'object', properties: {}, additionalProperties: false },
          handler() {
            count += 1;
            ctx.emit({
              type: 'plugin:example:changed',
              properties: { count },
            });
            return { count };
          },
        },
      },
      ui: {
        panels: [
          {
            id: 'main',
            title: 'Example',
            viewAction: 'refresh',
            refreshOn: ['plugin:example:changed'],
          },
        ],
      },
    };
  },
};
```

> **反馈环警告**：一个 panel 的 `viewAction` 不得发射该 panel `refreshOn` 中的事件；同理，message window 的 `viewAction` 不得发射它的 `triggerEvent`。Desktop 在收到匹配事件后会重新调用 `viewAction`，如果取视图本身又发同一事件，就会无限重载。通知型事件应由用户操作、config 保存等**非 viewAction** 的 action 发射；`viewAction` 只读渲染。

一次 `activate()` 的返回值共享同一个 candidate context、RegistrationBag 和 revision。`ui` / `actions` / `events` 也可以和 legacy 贡献（`usage` / `media` / `runtime` / `tts`）同时出现。

## 3. `ctx` 能力

`ctx` 是三个 legacy context 的超集，只暴露 Host 能力：

| 字段 | 说明 |
|---|---|
| `ctx.log` | gateway logger（`info` / `warn` / `error`） |
| `ctx.fetch(url, opts?)` | 默认 60s 超时；网络失败由包自行处理 |
| `ctx.apiKey(provider)` | 通过 runtime credentials 链读 opencode `auth.json` 的 provider key；没有返回 `null` |
| `ctx.pluginConfig()` | 每次调用现读 `plugins.<package>.config`（回退 legacy `usage/media/runtime.pluginConfig`），缺省 `{}` |
| `ctx.config.update(patch)` | 浅合并写入**本包命名空间**的配置，经 `config.persistOverrides` 原子落盘 |
| `ctx.projectDir` | 当前项目目录 |
| `ctx.gatewayPort` | gateway HTTP 端口 |
| `ctx.usage.modelStats({sinceMs?, provider?})` | 本地 trajectory 分模型统计 |
| `ctx.emit(event)` | 只发射本包已注册的 `plugin:<package>:*` 事件（见 §4） |
| `ctx.effect(dispose)` | 注册本包副作用清理函数（见下） |
| `ctx.http.route(method, path, handler, opts?)` / `ctx.http.ws(path, handler)` | 本包作用域的 HTTP/WS 路由（`/api/plugins/<pkg>/api<path>`、`/ws<path>`），只能在 `activate()` 内注册，随 revision 退役（见 §6.5） |
| `ctx.files.list(projectDir, rel)` / `stat` / `read` | 只读项目文件；第一个参数始终是**票据绑定的 projectDir**（不是 `ctx.projectDir`），`read` 默认 8 MiB 上限、超限报错不截断 |
| `ctx.terminal.create({ projectDir, cols?, rows? })` / `bridge` / `resize` / `kill` | 与桌面终端同一个 `TerminalService` 的 PTY；只能操作本包创建的 id，PTY 随 revision 的 RegistrationBag 关闭 |

`ctx.files` / `ctx.terminal` 是**宿主基础服务**：它们只给 Host 半（`index.js`），页面永远拿不到直接文件/PTY 权限，只能通过本包自己注册的路由/WS 间接使用（§6.5 的 demo 就是文件树 + 终端）。

`ctx.effect` 是 `activate()` 中创建的 timer / listener / watcher 等副作用的**唯一受支持清理路径**。包必须在创建副作用时立即登记：

```js
async activate(ctx) {
  const timer = setInterval(() => { /* … */ }, 60_000);
  ctx.effect(() => clearInterval(timer));
  return { /* contributions */ };
}
```

- 清理在包被重新加载、替换、禁用、删除（以及离线 `check` 的临时 candidate 释放）时执行；同一包的多个 effect 按注册逆序（LIFO）执行，单个清理抛错只记 diagnostic，不影响其余清理。
- `activate()` 之外创建的全局副作用不会被 Host 追踪；不要在模块顶层创建长生命周期资源，否则卸载后会泄漏。
- 释放是幂等的：Host 对同一 candidate 重复调用 `dispose()`（失败重试、手动 `check` 等）是安全的，disposer 只会执行一次，不会重复清理。

`ctx.config.update` 的边界：

- 传入 `{ intervalSeconds: 30 }` 只会写到 `plugins.<package>.config.intervalSeconds`，不可能改顶层配置。
- 补丁必须是纯对象、可 JSON 序列化、无循环引用、无 `__proto__` / `prototype` / `constructor`。
- 宿主未提供持久化能力时抛错，不会静默丢弃。

## 4. 事件

`events` 是数组，每项：

```ts
type PluginEventDeclaration = {
  type: `plugin:${string}`       // 必须是 plugin:<package>:<event>
  title?: string
  description?: string
  schema?: JsonSchema            // 校验 event.properties（2020-12，禁止远程 $ref）
  scope?: 'global' | 'session'   // 缺省 global
}
```

发射：

```js
ctx.emit({
  type: 'plugin:service-monitor:changed',
  properties: { checked: 1, at: new Date().toISOString(), source: 'refresh' },
  // sessionID: 'ses_…'   // scope:'session' 必需
})
```

规则与丢弃行为：

- 只能注册/发射本包命名空间。canonical 名（如 `turn.completed`）、别包命名空间、空事件名都在注册或发射时拒绝。
- `schema` 存在时，广播前校验 `properties`；失败丢弃并记 contract diagnostic，不进入 `event_log`。
- `scope:'session'` 需要显式 `sessionID`，或 `properties.sessionID`；缺失丢弃。
- 只有已提交的 revision 能发射；包被禁用/删除/替换后，迟到的 emit 变成 no-op。
- `properties` 必须是普通对象，序列化后不超过 256 KiB。
- 插件事件进入 Desktop 的插件事件路由，不会被当成 runtime canonical 事件，也不会进入 runtime 的 event-mapper → tool assembly → RuntimeFacade 链。
- 不要用 `POST /api/events` 绕过注册；它不是统一插件的发射 API。

## 5. Action

`actions` 是对象：action 名 → 声明。

```js
actions: {
  saveConfig: {
    title: 'Save settings',
    description: 'Persist plugins.<package>.config',
    inputSchema: { /* 标准 JSON Schema 2020-12 */ },
    outputSchema: { /* 可选 */ },
    timeoutMs: 5000, // 缺省 15_000，上限 60_000
    handler(input, call) {
      // call.sessionID?: 触发调用的会话
      // call.signal:    取消/卸载/超时会 abort
      return { saved: true };
    },
  },
}
```

调用契约：

- 调用前校验 `input`（缺省按 `{}`），返回后校验 `output`。
- `input` / `output` JSON 序列化后各不超过 256 KiB。
- 每次调用都有 AbortSignal 与超时；包卸载或 revision 被替换时，在途调用被 abort。
- action 结果带有 revision 代际：旧 revision 的 handler 不能给新 revision 的界面作答。
- UI 只能按本包 action 名引用；跨包 action 引用在 candidate 校验阶段就失败。
- action 不是任意 shell/API 转发器；包内的特权操作仍受现有审批与信任模型约束（本阶段不做细粒度 per-action 审批）。
- **action 不带票据上下文**：`call.sessionID` 只是会话提示，`input` 完全来自页面/调用方。需要项目目录的特权读（`ctx.files` / `ctx.terminal`）必须使用包自己 route 观察到的票据绑定目录（见 §6.5.1），**绝不**把 `input.projectDir` 直接传给 host service。

中性错误码（REST/Desktop 可安全展示）：

| code | HTTP | 场景 |
|---|---|---|
| `unknown-package` / `unknown-action` | 404 | 未安装、已删除、名字错误 |
| `invalid-input` / `payload-too-large` | 400 | input 不符合 schema 或超过 256 KiB |
| `invalid-output` / `handler-error` | 502 | output 不符合 schema、handler 抛错 |
| `timeout` | 408 | 超过 `timeoutMs` |
| `aborted` / `unloaded` / `stale-revision` | 409 | 调用被取消、包被卸载、revision 已替换 |

## 5.1 Agent tools

`tools` 是数组；每个 tool 由 Host 命名空间化为 `plugin:<package>:<name>`：

```js
tools: [{
  name: 'echo',
  title: 'Echo',
  description: 'Echo the input text',
  inputSchema: { type: 'object', properties: { text: { type: 'string' } }, required: ['text'] },
  outputSchema: { type: 'object' },
  timeoutMs: 5000, // 缺省 60_000，上限 60_000
  handler(input, call) {
    // call.sessionID?: 会话提示
    // call.signal:    超时/卸载时 abort
    return { text: `echo:${input.text}` }; // string / { text, isError? } / 其他 JSON
  },
}]
```

- tool 只会注册进 gateway 的 `RuntimeTools.registerTools`；handler 永远不进入 Desktop。
- handler 抛错、超时、health failed 都只返回 `isError: true` 的 tool 结果，不拖垮 turn。
- 本阶段包 tool 只支持 `scope: 'global'`；`scope: 'session'` 会在 candidate 校验阶段失败。需要按会话区分时，在 handler 内读 `call.sessionID`。
- tool 默认生效；需要关闭时设 `MAFW_KERNEL_V2_TOOLS=0`，关闭后包仍可安装/校验，但 tool 不执行。
- 包 reload/disable/remove 时按 revision 自动退订；旧 handler 不会继续被调用。

## 5.2 Canonical event observers

`observers` 是只读、post-hoc 的 canonical 事件订阅，不是 interceptor：

```js
observers: [{
  id: 'watch-tools',
  filter: { types: ['part.updated'], sessionID: 'optional-session' },
  timeoutMs: 1000,
  onEvent(event) {
    // event: { type, sessionID?, projectId?, at, properties? }（已脱敏）
  },
}]
```

- Host 把 id 命名空间化为 `plugin:<package>:<observer>`。
- `types` 支持精确名或尾部 `*` 前缀；不写 filter = 全收。
- observer 失败/超时只丢该次观察，不影响 SSE、recall、turn；不能 veto/rewrite。
- 工具三原语（`tool.call` / `tool.delta` / `tool.result`）在 observer 之前已被丢弃；工具事件请观察 `part.updated` 的 tool part。
- observer 默认生效；需要关闭时设 `MAFW_KERNEL_V2_OBSERVERS=0`，关闭后只校验声明，不投递事件。

## 5.3 Context menu items

`ui.menuItems` 贡献固定 shell 的 context-menu 项（data-only）：

```js
ui: {
  menuItems: [{
    id: 'copy-markdown',
    surface: 'message',
    label: '复制为 Markdown',
    action: 'copyMarkdown', // 必须是本包 actions 里声明的 action
    icon: 'file',           // 必须是已注册的插件图标
    order: 10,
    // shortcut: 'Ctrl+Shift+C', // 仅展示提示，不注册全局键位
  }],
}
```

- 支持的 `surface`：`editor.tab` / `file.tree` / `file.path` / `message` / `session.row`。
- 每个 surface 最多 7 个贡献；merge 后仍过宿主菜单 grammar，失败回退原菜单。
- `danger` 暂不开放；需要确认/危险操作请用 action 内部确认。
- 点击调用 `plugins.invoke(package, action, {}, sessionID)`；action 失败只记录，不影响菜单。
- 包 reload/disable/remove 时贡献随 revision 自动退订。
- 不注入原生组件；菜单项只渲染 label/icon/shortcut 文本。

## 5.4 Composer actions

`ui.composerActions` 在 chat composer 左侧工具条贡献按钮（最多 3 个）：

```js
ui: {
  composerActions: [{
    id: 'draft-reply',
    label: 'Draft reply',
    action: 'draftReply', // 必须是本包 actions 里的 action
    icon: 'bubble-5',
    order: 10,
  }],
}
```

- 点击调用 `plugins.invoke(package, action, {}, sessionID)`。
- action 返回 `{ insertText: '...' }` 时追加到当前会话草稿，**不会自动发送**；其他返回值忽略。
- action 失败只弹 toast，不影响 composer；没有活动会话时按钮不可用。
- 图标必须是已注册的插件图标；未知图标回退为 `plus`。
- 不注入原生组件；按钮由宿主渲染。

## 5.5 Panel rail entry

声明式 panel 默认只在工作台 L2 tab 出现；加 `rail` 可同时进入左侧 IconRail：

```js
ui: {
  panels: [{
    id: 'stats',
    title: 'Stats',
    viewAction: 'getStats',
    rail: { icon: 'layout-grid', order: 100, badge: true },
  }],
}
```

- `rail.icon` 必须是已注册的插件图标；`order` 越小越靠前；`badge` 只申请角标能力，实际数字由页面 bridge 提供。
- 点击 rail 项打开同一个 `plugin:<package>:<panel>` surface，不新建第二条渲染路径。
- 与 web surface 的 rail 项合并排序；capacities/样式由宿主 IconRail 统一处理。
- 不注入原生组件。

## 6. UI slots

`ui` 只接受白名单 slot（未知 slot 直接失败）：`panels`（含 `rail`）/ `configPages` / `toolCards` / `messageWindows` / `menuItems` / `composerActions` 是**声明式数据**（Desktop 用内置组件渲染）；`webSurfaces` 是**沙箱 Web 页面**（插件自己写 HTML/JS）。两类可以并存于同一个包。chat part 渲染器目前不开放（§6.6）。

### 6.1 panels

```js
ui: {
  panels: [{
    id: 'overview',
    title: 'Service Monitor',
    icon: 'activity',
    order: 40,
    viewAction: 'refresh',
    refreshOn: ['plugin:service-monitor:changed'],
  }],
}
```

- 一个 panel 是右工作台「工作台」里的动态 L2 tab；客户端全局 key 为 `<package>:<id>`。
- 按 `order`、title、包名稳定排序；删除当前 surface 后回退到内置 `code`。
- 挂载时调用 `viewAction` 取 `PluginView`；`refreshOn` 中的本包事件到达后重取。
- **`viewAction` 不得发射本 panel 的 `refreshOn` 事件**：每次取视图都触发重取，会形成无限重载。事件应从 config 保存/用户操作等非 viewAction 的 action 发射。
- `refreshOn` / `viewAction` 必须在同一包内可解析。

### 6.2 configPages

```js
ui: {
  configPages: [{
    id: 'settings',
    title: 'Service Monitor settings',
    schema: {
      type: 'object',
      properties: {
        endpoint: { type: 'string', title: 'Endpoint', minLength: 1, maxLength: 2048 },
        intervalSeconds: { type: 'integer', title: 'Interval (s)', minimum: 5, maximum: 3600, default: 60 },
        verbose: { type: 'boolean', title: 'Verbose', default: false },
      },
      required: ['endpoint', 'intervalSeconds', 'verbose'],
      additionalProperties: false,
    },
    loadAction: 'loadConfig',
    saveAction: 'saveConfig',
    reloadOnSave: false,
  }],
}
```

- Desktop 从**受限 JSON Schema 子集**生成表单；load/save 只走声明的 action。
- 根必须是 `type:"object"`；`properties` 的值只能是 `string` / `number` / `integer` / `boolean`。
- 字段允许：`type` / `title` / `description` / `default` / `enum` / `minimum` / `maximum` / `minLength` / `maxLength` / `pattern` / `multipleOf` / `examples`。
- 不支持：嵌套 object/array、`$ref`、远程 schema、`format`/secret 字段、secret 回显。
- 保存默认不重载包；`reloadOnSave:true` 时保存成功后走同一 candidate/reload 流程（仍受 active-runtime pending 规则约束）。

### 6.3 toolCards

```js
ui: {
  toolCards: [{
    id: 'service-tool',
    tools: ['bash', 'shell'],   // 逻辑工具名，Desktop 负责 alias/canonical 解析
    override: true,             // 必需：bash 已有内置卡
    viewAction: 'toolCard',
  }],
}
```

- Desktop 把中性 ToolCardModel（`tool` / `canonicalTool` / `input` / `output` / `metadata` / `status` / `error` / `truncated`）作为 action input 发给 gateway。`status` 为 `error` 时 `error` 是归一化后的错误文本；失败部件同样会进入插件卡。
- running 阶段保持默认卡；completed / error 才请求插件视图，避免流式 O(n²) 请求。
- input/output/error 共享统一 256 KiB 字节上限，超限被结构化截断并置 `truncated:true`，不会抛错。Desktop 不依赖 runtime 私有历史存储。
- **alias 组是全有或全无**：一个逻辑工具名展开为 `bash` + `mafw_bash` + `shell` + `mafw_shell`（canonical/`mafw_` 前缀/裸名）。组内任一 key 已被内置或 legacy 卡占用，且声明没有 `override:true`，整组都会被跳过（不会出现半绑定的别名）。
- `bash`、`read`、`grep` 等常用工具**已有内置 session-ui 卡**，想替换必须写 `override:true`。只声明 slot 而不 override，在真实 Desktop 里永远不会渲染插件卡。示例包 `service-monitor` 就依赖这一点。
- 若包视图不可用、action 失败或 revision 已过期，Desktop 回退到原卡，并在原卡上方显示 `error` 文本（不会静默丢掉失败原因）。

### 6.4 messageWindows

```js
ui: {
  messageWindows: [{
    id: 'status-change',
    title: 'Service status changed',
    triggerEvent: 'plugin:service-monitor:changed',
    viewAction: 'messageView',
    modal: false,
    dismissible: true,   // 缺省 true
  }],
}
```

- `triggerEvent` 必须引用本包已注册事件。
- 事件到达时在 MAFW 主窗口打开 `<package>:<id>` 的单例小窗；同 id 后续事件只刷新，不重复堆窗。
- **`viewAction` 的 input 是规范嵌套形状**：

  ```ts
  {
    event: {
      type: string,        // 触发事件类型（= triggerEvent）
      properties: object,  // 注册事件 schema 校验后的 payload
    },
    sessionID?: string,    // 事件携带会话时才有
  }
  ```

  不要把 `checked` / `at` / `source` 等 payload 字段声明为顶层 input——Desktop 不会发送平铺形状。对应的 `inputSchema` 写成：

  ```js
  actions: {
    messageView: {
      title: 'Render a message window',
      inputSchema: {
        type: 'object',
        properties: {
          event: {
            type: 'object',
            properties: {
              type: { type: 'string' },
              properties: { type: 'object' },
            },
            required: ['type', 'properties'],
          },
          sessionID: { type: 'string' },
        },
        additionalProperties: true,
      },
      handler(input) {
        const { checked, at, source } = input.event.properties;
        return { body: [{ type: 'text', text: `${checked} @ ${at} (${source})` }] };
      },
    },
  },
  ```
- **`viewAction` 不得发射 `triggerEvent`**：小窗取视图会再次触发事件，形成无限刷新。事件应由其他用户 action 发射。
- `modal:false` 是不阻断聊天的浮动小窗，不主动抢焦点；`modal:true` 是居中模态层并管理焦点。
- `dismissible:true` 支持关闭按钮与 Esc。
- 小窗内按钮仍是 action widget，经本包 action 回调 gateway；action 需要开小窗时，在 action 中发射相应注册事件，不要新增脚本化 UI 命令。

### 6.5 webSurfaces（沙箱 Web 页面）

`panels` 用宿主组件渲染数据；`webSurfaces` 让插件交付**自己写的页面**，由 Desktop 在沙箱 `<webview>` 里加载。适合文件树、编辑器、终端、分栏、图表等声明式 widget 表达不了的交互。

```js
ui: {
  webSurfaces: [{
    id: 'explorer',
    title: 'Web Surface Demo',
    icon: 'folder',
    entry: 'index.html',                 // 缺省 index.html，必须落在 web/ 内
    scope: 'project',                    // session（默认）| project | global
    reloadOnSessionChange: true,         // 缺省 true
    rail: { icon: 'folder', order: 10, badge: true }, // 可选左栏入口
  }],
}
```

- 一个 surface 是右工作台「工作台」里的一个 L2 tab，客户端 key 仍是 `plugin:<package>:<id>`；与 `panels` 共享 id 命名空间（同包 id 冲突 = validation error）。
- `entry` 必须是 `web/` 下的相对路径：拒绝 `..`、绝对路径、scheme、点文件；入口缺失/不可读时**整包激活失败**，不会发布一个打开就 404 的页面。
- `rail` 可选：声明后左栏出现入口；`icon` 必须命中宿主字形白名单（未知图标是 validation error，不是静默画 `plus`）。`order` 缺省 100，`badge` 缺省 false（角标计数由页面经 bridge `setBadge` 提供）。
- `scope`：`session`（默认，绑定 `projectDir + 打开时的 sessionID`，切会话默认整页重载）、`project`（只绑 `projectDir`）、`global`（不绑）。页面通过 bridge 看到的上下文按 scope 收窄：`session` = `{projectDir, sessionID}`、`project` = `{projectDir}`、`global` = `{}`（tab 仍属当前项目，但页面不被授予项目上下文）。tab 身份始终是项目级。
- 页面地址由宿主构造：`GET /api/plugins/<pkg>/ui/<entry>?revision=<rev>`。响应固定带 CSP（`script-src 'self'`）与 `Cache-Control: no-store`；**inline script 会被 CSP 拒绝**，脚本必须是 `web/` 下的独立文件。
- revision 变化 → 页面重载；包被移除/禁用 → tab 与左栏入口立即消失。

#### 6.5.1 插件自带 host 半（`ctx.http`）

页面只调本包命名空间，不碰 gateway 全局 API：

```js
async activate(ctx) {
  ctx.http.route('GET', '/files', async (req) => {
    // req.projectDir 来自 Web 页面票据，绝不是 ctx.projectDir
    const entries = await ctx.files.list(req.projectDir, '.');
    return {
      status: 200,
      headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
      body: JSON.stringify({ projectDir: req.projectDir, entries }),
    };
  });

  ctx.http.ws('/term', async (socket, reqCtx) => {
    let session;
    try {
      session = await ctx.terminal.create({ projectDir: reqCtx.projectDir, cols: 100, rows: 24 });
    } catch (err) {
      socket.send(JSON.stringify({ type: 'error', message: err.message }));
      socket.close(1011, 'terminal unavailable');
      return;
    }
    socket.on('close', () => ctx.terminal.kill(session.id));
    await ctx.terminal.bridge(session.id, socket);
  });
}
```

- HTTP 实际 URL 是 `/api/plugins/<pkg>/api<path>`，WS 是 `/api/plugins/<pkg>/ws<path>`；只支持**精确路径**（没有 `:param`、没有通配），重复注册直接抛错。
- handler 收到 `{ method, path, query, headers, sessionID?, projectDir, body: AsyncIterable<Buffer> }`，返回 `{ status?, headers?, body? }`（`string` / `Buffer` / `Readable` / `AsyncIterable`）。请求体默认上限 32 MiB（`opts.maxBodyBytes` 可调）。
- 路由只在 **commit 之后**生效；reload / disable / remove / revision 替换时全部退役，WS 以 1001 关闭。离线 `check` 时 `ctx.http` 只是记录器，只校验不监听。
- `ctx.files` 是只读的，`ctx.terminal` 只能操作本包创建的 PTY；两者都只给 Host 半，页面通过上面的路由间接使用。
- WS 用 MAFW 终端帧协议：客户端发 `{"v":1,"type":"input","data":"ls\n"}`、`{"v":1,"type":"resize","cols":100,"rows":24}`；宿主回 `{"v":1,"type":"output","data":"…"}` / `meta` / `close`。

#### 6.5.2 Bridge（`window.mafwPlugin`）

Desktop 在沙箱页面里注入只读 bridge（v1）：

| 方法 | 用途 |
|---|---|
| `context()` | `{ projectDir?, sessionID?, surface, theme }`；按 scope 收窄（`global` 无 `projectDir`），页面自己展示/裁剪 |
| `invoke(action, input?)` | 只能调用**本包**已声明的 action（action 不带票据上下文，见 §5） |
| `onEvent(type, cb)` | 订阅本包 `plugin:<package>:*` 事件，返回取消函数 |
| `setBadge(count)` / `setTitle(title)` | 左栏/标签角标与页面标题（空标题 = 清除，退回声明的 title） |
| `onThemeChange(cb)` / `onContextChange(cb)` | 订阅时会先推一次当前值；之后跟随宿主亮暗与活动会话/项目变化 |
| `openExternal(url)` | 外链走系统浏览器；页面不能自行导航出去 |

bridge 是**可选**的：页面应能在缺少 `window.mafwPlugin` 时隐藏依赖它的按钮。但**页面本身离不开票据**——`api/*`、`ws/*`、`events` 即使在 loopback 也要求有效票据，只有 `ui/*` 资产允许无票据打开。因此不要假设「在普通浏览器标签里直接打开页面 URL 就能工作」；本地调试请由 Desktop 打开页面，或手动 `POST /api/plugins/<pkg>/web-ticket` 取票后带上 `mafw_plugin_ticket` cookie / `x-mafw-plugin-ticket` 头。

#### 6.5.3 票据、隔离与失败面

- Desktop 打开页面前由主进程取票：`POST /api/plugins/<pkg>/web-ticket { projectDir, sessionID? }`（loopback）。`projectDir` 必须是 canonical 化后落在**已注册项目、其子目录、或已知 `session-worktree` 目录**内（worktree 与 monorepo 子目录会话都能开页面）；其它目录 400。gateway 设置路径限定 cookie（`Path=/api/plugins/<pkg>/`、`HttpOnly`、`SameSite=Strict`，TTL 8 小时）。
- **执行面必须带票**：`/api/plugins/<pkg>/api/*`、`/events`、`/ws/*` 一律要求有效票据——**即使请求来自 loopback**（任何网页都能访问本机端口，票据才是上下文权威）。handler 的 `{ projectDir, sessionID? }` 只来自票据，gateway 不会退回「当前项目」。`ui/*` 资产仍允许无票据 loopback 打开（不执行包代码）。
- 票据绑定包名，**跨包重放一律 403**。`web-ticket` 只接受 gateway 自己的 `Origin`（缺 `Origin` 的非浏览器客户端可以），并且该响应**不发** `Access-Control-Allow-Origin`——票据不可被外部页面读取。
- WS 升级同时校验 `Origin` / `Sec-Fetch-Site`：桌面页面 origin 即 gateway origin；外部 Origin 403（非浏览器客户端无 `Origin` 时仍需有效票据）。
- 事件订阅可直接用页面侧 `EventSource('/api/plugins/<pkg>/events')`（只转发本包 `plugin:<pkg>:*`，带 `?sessionID=` 时只转发该会话），也可走 bridge `onEvent`。
- 页面加载失败/404/5xx 时宿主显示错误面与重试按钮，不留白屏；页面自己的每个 fetch 都要处理非 2xx。
- 旧 gateway 会**拒绝**声明 `webSurfaces` 的包（descriptor 校验是封闭的）——这是有意的 fail-closed，安装前确认 gateway 版本。

#### 6.5.4 与 `panels` 怎么选

| 想要 | 用 |
|---|---|
| 键值表、列表、进度条、按钮等纯数据视图 | `panels` + widget |
| 文件树 / 编辑器 / 终端 / 分栏 / 图表等真实交互 | `webSurfaces` + `ctx.http` |
| 需要项目文件或 PTY | `webSurfaces`（action 里也能调 `ctx.files`，但把文件内容塞进 256 KiB 的 action payload 不是正确用法） |

完整可运行示例：`docs/examples/plugins/web-surface-demo/`（文件树 + 终端 + action/event 刷新）。

### 6.6 chat part（目前不开放）

统一插件包**不能**注册 chat transcript 的 part 渲染器；这是 Phase 4 的明确边界（评估见 `docs/research/2026-11-13-chat-part-renderer-evaluation.md`）。

- 工具 part 用 `ui.toolCards`（§6.3）；这是当前唯一受支持的「自定义 chat 卡片」。
- 非工具 `data-<name>` part 由宿主 `DataPartCard` 显示名称 + JSON；gateway 已校验名字、≤64KB、可序列化。
- 不要尝试从包代码引用 `PART_MAPPING` / `registerPartComponent`，也不要通过 IPC 传组件/源码；renderer 不执行插件代码。
- 需要富交互时，用 action 打开 panel / message window / web surface，不要把页面塞进 transcript。

未来若出现真实需求，唯一候选形状是 `ui.dataPartCards`（`data-<name>` → 同包 `viewAction` → 声明式 Widget，失败回退 JSON 卡），但当前 contract 不接受该 slot。

## 7. View 与 Widget

`viewAction` 返回：

```ts
type PluginView = {
  title?: string
  subtitle?: string
  icon?: string
  body: Widget[]
}
```

支持的 Widget：

| type | 必要字段 | 说明 |
|---|---|---|
| `text` | `text` | 纯文本 |
| `code` | `text`，可选 `language` | 代码块，不着色执行 |
| `kv` | `rows: [label, value][]` | 键值表 |
| `tags` | `items: string[]` | 标签组 |
| `list` | `items: (string \| Widget)[]` | 列表 |
| `row` | `children: Widget[]` | 横向布局 |
| `image` | `dataUrl`（`data:image/...`） | 最大 2 MiB data URL |
| `link` | `text`、`href` | 走 Desktop browser-policy |
| `markdown` | `text` | 先转义原始 HTML |
| `progress` | `value`（0–100），可选 `label` | 进度条 |
| `action` | `label`、`action`，可选 `input` / `style` | 按钮，回调本包 action |

限制（`PLUGIN_UI_LIMITS`）：

| 限制 | 值 |
|---|---|
| Widget 节点数 | 256 |
| 嵌套深度 | 12 |
| 单段文本 | 64 KiB |
| image data URL | 2 MiB |
| action / event payload | 256 KiB |
| action 超时 | 默认 15s，上限 60s |

未知 widget 类型会降级成 `text`，不会变成可执行标记；超限或畸形视图返回 `null`，Host/Desktop 不清空最后一次可用视图。

ActionWidget 的返回语义：action 返回合法 `PluginView` 时直接替换发起它的当前视图；返回普通 JSON/`undefined` 时在原视图显示结果摘要并重取当前 `viewAction`；失败显示中性错误。原因不明的返回值不会被当作脚本执行。

`ui` 中所有 `viewAction` / `loadAction` / `saveAction` / `triggerEvent` / `refreshOn` 都必须在同一包内有定义，否则整个 candidate 校验失败。

## 8. 生命周期：revision、staging、热重载

```text
安装 / 文件变化 / reload / enable
  → 扫描候选包
  → 内容指纹（manifest + 包内源码，忽略 node_modules/.git/logs/临时文件）
  → 指纹未变：复用旧实例、旧 RegistrationBag、旧 revision（不重新 activate）
  → 指纹变化：完整 activate + 校验（私有 RegistrationBag）
  → 全部候选暂存完毕后一次性提交
  → 发布新的 <gatewayBootId>:<counter> revision
```

- 客户端（Desktop）只比较 revision，不依赖数组顺序。
- 失败 candidate 不会打断已提交的旧 revision，Hub 显示错误并保留 active revision。
- **active runtime pending**：若变更包拥有 gateway 当前使用的 runtime，整包进入 pending；旧 revision 继续服务，等显式 `applyPending`。新安装/启用 runtime 包同样不会静默抢占。
- 优先级（同名）：统一包 > legacy 目录文件（`usage-plugins/` / `media-plugins/` / `runtime-plugins/` / `tts-plugins/`）> 内置。
- 禁用 = 写独立状态文件，包留在磁盘但不贡献任何东西；删除 = 先 dispose（action/event/timer/watcher），再删除经 realpath/containment 验证的包目录。
- 包内模块缓存按包目录失效；同包嵌套 `lib/` 也会重新加载。

## 9. 安装、检查与管理

REST（Desktop 的 Plugins 页使用同一组接口）：

| 接口 | 说明 |
|---|---|
| `POST /api/plugins/check` `{path}` | 激活一次临时 candidate、校验全部贡献、立即 dispose；**不安装、不发布 revision** |
| `POST /api/plugins/packages/install` `{path, overwrite?}` | 从本机绝对目录原子复制到 `~/.mafw/plugins/<name>` 并激活 |
| `POST /api/plugins/:name/reload` | 显式重扫单个包；仍走 staging/commit 与 pending 规则 |
| `POST /api/plugins/:name/apply` | 提交 pending revision；失败时保留旧 revision |
| `GET /api/plugins/client` | 已提交的 client snapshot（只含可序列化 DTO） |
| `POST /api/plugins/:name/actions/:action` `{input, sessionID?}` | 调用已提交 action |
| `GET /api/plugins` | Hub 清单（含 disabled / pending / error / 来源路径 / 贡献类型） |
| `POST /api/plugins/:name/web-ticket` `{projectDir, sessionID?}` | 为 Web 页面签发包绑定的作用域票据（仅 loopback；Desktop 主进程调用） |
| `GET /api/plugins/:name/ui/<entry…>` | 服务已提交包的 `web/` 静态资源（CSP + `no-store`，失败一律 404；loopback 可无票据） |
| `GET /api/plugins/:name/events` | 只转发本包 `plugin:<name>:*` 事件的 SSE（需票据；可带 `?sessionID=`） |
| `/api/plugins/:name/api/*`、`/api/plugins/:name/ws/*` | 本包 `ctx.http` 注册的 HTTP/WS 路由（需票据 + 同源校验后分发） |

- `path` 必须是绝对路径；安装不会移动或删除源目录。
- 同名安装必须显式 `overwrite:true`；Desktop 在覆盖前展示贡献 diff 并要求确认。
- 已有单文件包同名时，安装目录包会被拒绝（先删除旧包）。
- `check` 成功只代表 candidate 能激活，不代表已安装；状态区分 draft/check/installed/activated/pending。

## 10. 安全模型

- **Host 代码是受信本地代码**：安装包 = 在 gateway 进程执行；没有 VM/进程隔离。来源必须是可信目录。
- **Client 不执行插件代码**：Desktop 只收到数据 DTO；声明中的函数在 JSON 投影时被丢弃。
- **声明校验先于发布**：未知字段/slot、跨包 action/event 引用、非法命名空间、不可编译 schema、超限 payload 都会让 candidate 失败。
- **事件隔离**：包事件不能冒用 canonical 名或别包命名空间；schema 失败、未注册、无 session 的 session 事件、超限 payload 全部丢弃并记 diagnostic。
- **Action 隔离**：input/output 校验、超时、AbortSignal、payload 上限、revision 代际、卸载 abort。
- **配置隔离**：`ctx.config.update` 只能写 `plugins.<package>.config`，并通过原型污染/循环引用检查。
- **UI 数据化**：没有函数、表达式、事件 handler、任意 HTML/CSS/JS；markdown 转义 raw HTML；link 走 browser-policy；image 只接受受限 `data:image/*`。
- **Web 页面隔离**：页面在沙箱 `<webview>` 里跑（`contextIsolation`、`sandbox`、无 Node、CSP 禁 inline script），只能访问本包命名空间；票据绑定包名，跨包重放 403；静态资源做 realpath 包含与 MIME 白名单。注意：这防的是宿主 UI 被污染，**不是**防插件作者——Host 半仍是受信代码。
- **文件/终端服务**：`ctx.files` 只读且限制在调用方传入的项目根内（realpath 包含，拒绝 `..`/绝对路径/点文件/符号链接逃逸）；`ctx.terminal` 只能 bridge/resize/kill 本包创建的 PTY。
- **不是脚本化 UI 通道**：面板要开小窗时发注册事件，不新增“执行某 UI 命令”的接口。

## 11. 本地开发与验证

1. 从示例复制目录：

   ```bash
   cp -r docs/examples/plugins/service-monitor /tmp/my-plugin
   ```

   Web 页面示例（文件树 + 终端）：

   ```bash
   cp -r docs/examples/plugins/web-surface-demo /tmp/my-web-plugin
   ```

2. 跑包自测（示例自带，零依赖）：

   ```bash
   node --test docs/examples/plugins/service-monitor/index.test.js
   node --test docs/examples/plugins/web-surface-demo/index.test.js
   ```

3. 起 gateway，在 Desktop → Config → Plugins → 安装本地目录选择源目录。安装前会先 `check` 并展示：
   - 包名 / 版本 / 贡献类型
   - 覆盖时的 added / removed / unchanged 贡献 diff
   - 失败 candidate 的诊断文本

4. 修改包文件后：
   - 正常情况下 watcher 300ms 防抖后自动重载；
   - 也可以在 Plugins 行点「重新加载」；
   - 如果包拥有当前 runtime，会显示 pending，需要点「应用」。

5. 调试事件/action 时看 gateway 日志的 `[PluginHost]` diagnostic；事件丢弃会带 code（`canonical-event` / `unregistered-event` / `schema-invalid` / …）。

## 12. 打包与部署

仓库内构建顺序（根 `npm run build`）：

```text
@mafw/plugin-contract → root tsc → gateway → @mafw/sdk → @mafw/tui
```

`@mafw/plugin-contract` 是**私有 workspace 包**，不从 npm registry 安装；gateway 的编译产物按名字 `require('@mafw/plugin-contract')`。四种布局各自解析：

| 布局 | 解析路径 | 谁负责 |
|---|---|---|
| 仓库开发 | `node_modules/@mafw/plugin-contract`（workspace symlink） | `npm install` |
| `npm pack` + 全局安装 | `<包根>/node_modules/@mafw/plugin-contract` | 根 `postinstall` → `scripts/stage-plugin-contract.mjs` |
| `mafw deploy-local` | `<gateway 目标>/node_modules/@mafw/plugin-contract` | `gateway/scripts/deploy-local.mjs` |
| Desktop 自带 gateway | `gateway-bundle/node_modules/@mafw/plugin-contract` | `packages/desktop/scripts/stage-gateway.ts` |

根 `package.json` 的 `files` 已包含 `packages/plugin-contract/{package.json,dist}` 与 `scripts/stage-plugin-contract.mjs`。gateway `package.json` 的 `mafw.bundledPackages` 声明源目录（`../packages/plugin-contract`），供部署脚本定位。

验证命令：

```bash
# 临时构造 desktop bundle 与 packed global install 两种布局，子进程 require 验证
npm run verify:plugin-contract

# 手工验证任意布局中的入口文件
node scripts/stage-plugin-contract.mjs --verify <entry-file>
```

`stage-plugin-contract.mjs` 只复制 `package.json` + `dist/`；遇到 workspace symlink 会保留而不是替换；`--allow-missing` 供 postinstall 在首次构建前跳过。

## 13. 常见错误

| 现象 | 原因 / 处理 |
|---|---|
| `name mismatch: exports 'x', package 'y'` | manifest `name`、模块 `name`、安装目录不一致 |
| `missing name` | 模块没有导出 `name` |
| `no contributions` | `activate()` 返回空对象；至少要有 ui/actions/events 或 legacy 贡献之一 |
| `invalid contributions: … unknown action reference` | slot 引用了不存在的 action |
| `event type "…" must use the plugin:<package>:<namespace>` | 事件名不在本包命名空间 |
| 事件发了但 Desktop 没反应 | 未注册、schema 不匹配、session 事件缺 sessionID、包已禁用/替换 |
| `timeoutMs exceeds the maximum` | 超过 60_000 |
| action 返回 502 `invalid-output` | `outputSchema` 与实际返回不一致 |
| config 页不渲染某字段 | 用了嵌套 object/array、`format`、secret 或未知关键字 |
| 安装后显示 pending | 包拥有当前 active runtime；确认后点「应用」 |
| 编辑文件后仍是旧界面 | watcher 未触发或实例未变；点「重新加载」；检查是否命中 active-runtime pending |
| `source must not be the installed package or inside it` | 直接对 `~/.mafw/plugins/<name>` 原地覆盖；改源目录再安装 |
| `invalid web surfaces: web surface "x" entry "y" does not resolve…` | `web/` 下缺 entry、entry 拼错或路径逃逸；补齐文件后重新 check |
| Web 页面白屏 / 404 | 包未提交、entry 拼错、旧 gateway 不支持 `webSurfaces`（会整包拒绝）；看 `[PluginHost]` diagnostic |
| 页面 API 403 `invalid plugin ticket` | 票据过期或属于别的包；重新打开 surface（Desktop 会重新取票），不要跨包复用 cookie |
| 页面脚本不执行 | CSP 拒绝 inline script；把脚本移到 `web/app.js` 并用 `<script src>` 引入 |
| 页面读不到项目文件 | 路由用了 `ctx.projectDir` 而不是 `req.projectDir`（票据绑定目录）；或 action 把 `input.projectDir` 当票据目录（action 不带票据，必须用自己 route 观察到的目录） |
| 页面在浏览器里直接打开是 403 | `api/events/ws` 即使在 loopback 也要求票据（只有 `ui/*` 资产可匿名打开）；用 Desktop 打开或先 `POST /api/plugins/<pkg>/web-ticket` 取票 |

## 14. 示例走读

`docs/examples/plugins/service-monitor/`：

- `plugin.json` — 包元数据。
- `index.js` — 一次 `activate(ctx)` 返回：
  - `ui.panels`：`Service Monitor` 面板，`viewAction:'refresh'`，`refreshOn` 绑定 `plugin:service-monitor:changed`。
  - `ui.configPages`：endpoint / intervalSeconds / verbose 三字段的受限 schema，`loadConfig` / `saveConfig`。
  - `ui.toolCards`：`bash` / `shell` 中性工具卡，`override:true`（`bash` 已有内置卡，不 override 会被整组跳过），`viewAction:'toolCard'`。
  - `ui.messageWindows`：`changed` 事件触发的单例小窗，`viewAction:'messageView'`；action input 使用 `{ event: { type, properties }, sessionID? }` 嵌套形状。
  - `actions`：`refresh`、`loadConfig`、`saveConfig`、`toolCard`、`messageView`。
  - `events`：`plugin:service-monitor:changed`（带 payload schema）。
- `index.test.js` — 零依赖自测：fake ctx 下逐项验证 slot/action/event、tool card override、配置往返、事件发射、嵌套 message window payload 与 widget 可序列化。

端到端回归：`gateway/tests/integration/plugin-package-e2e.test.ts` 用真实 PackageManager/PluginHost 覆盖 check → install → descriptor → action → event → canonical 伪造 → 热重载 → disable/delete，以及打包后的 contract 解析。

`docs/examples/plugins/web-surface-demo/`（沙箱 Web 页面）：

- `plugin.json` — 包元数据。
- `index.js` — 一次 `activate(ctx)` 返回：
  - `ui.webSurfaces`：一个 `explorer` 页面（`entry:'index.html'`、`scope:'project'`、左栏 `folder` 入口，`order:10`、`badge:true`）。
  - `ctx.http.route('GET', '/files')`：用 `ctx.files.list(req.projectDir, '.')` 返回项目文件树（`/api/plugins/web-surface-demo/api/files`）。
  - `ctx.http.ws('/term')`：为票据项目 `ctx.terminal.create` 一个 PTY 并 `bridge` 到页面（`/api/plugins/web-surface-demo/ws/term`），socket 关闭时 `kill`。
  - `actions.listFiles`：同一 host-service 路径的 bridge 动作——**action 不带票据**，所以它只用 `GET /files` 最近观察到的票据绑定项目，页面传 `projectDir` 会被拒绝；`actions.emitChanged`：发射 `plugin:web-surface-demo:changed`。
  - `events`：`plugin:web-surface-demo:changed`（带 payload schema），驱动页面刷新。
- `web/index.html` + `web/app.js` — 页面：文件树、刷新、终端 `<pre>` + 行输入、bridge 上下文/主题跟随与事件订阅；零依赖、CSP 安全（无 inline script）。
- `index.test.js` — 零依赖自测：surface 声明、精确路由集合、`req.projectDir` 绑定、400/错误路径、action 往返、PTY 桥接与无 PTY 降级、页面 CSP 契约。

端到端回归：`gateway/tests/integration/plugin-web-surface.test.ts` 用真实 PackageManager/PluginHost 覆盖 check → install → descriptor（含 `url`）→ asset/ticket/`/files` 分发 → 跨包票据 403 → 路由清单与事件 → entry 缺失 fail-closed。

---

## AGENTS.md 归档：统一插件包（2026-11-10 迁移）

> 原文搬迁（未改写），保留当时的决策与验证记录。

##### 统一插件包（Unified Plugin Packages，2026-09-16）

`~/.mafw/plugins/` 一个插件包可同时贡献多种能力（usage 配额 / media 引擎 / runtime；uiTools v1 仅登记展示，桌面侧加载仍走 `~/.mafw/ui-plugins/`）：

- 单文件包 `name.js` 或目录包 `name/plugin.json`（`{name, version?, main?}`，main 缺省 index.js）
- 模块形状：声明式 `{ name, usage?, media?, runtime?, uiTools? }` 或 `async activate(ctx) → contributions`
- 统一 ctx = 三个 legacy ctx 超集：apiKey/fetch(60s)/log/pluginConfig（读 `plugins.<name>.config`，回退 legacy 三段）/projectDir/gatewayPort/usage.modelStats（`gateway/src/plugins/package-context.ts`）/emit（`POST /api/events` 发布自定义事件到全 UI 通道；type 建议 `plugin:<name>:<event>` 命名空间，消费方对未知 type 忽略——SSE 通知语义，无注册制）
- **优先级（同名）：包 > legacy 目录文件 > 内置**；legacy 四目录行为不变
- PluginHost（`gateway/src/plugins/package-host.ts`）：扫描/激活/跨面原子 reload（先全部激活再一次性推各 loader 的 `setPackageEntries`）+ 顶层与每包子目录双 watcher
- 内置件与用户插件同一接口（dogfood）：opencode 经 `registerBuiltinDefinition('opencode', …)` 注册（index.ts，可被同名文件/包覆盖）；media `pi` 经 `registerBuiltinEngine('pi', …)` 注册，`resolveMediaPrompt`（`media/resolve-prompt.ts`）先查 engines map，非 builtin 同名直接生效
- hub：`GET /api/plugins` 响应含 `packages` 键（PackageState[]）
- 环境变量 `MAFW_PLUGINS_DIR` 覆盖包目录（测试用）
- 限制：reload 只清主文件 require.cache（改包内 lib/ 需 `mafw restart`）

**两种插件形态**（CJS `module.exports`）：

```js
// 形态 A：完全自定义引擎（不经 pi，直接 HTTP 调用）
module.exports = {
  name: "gemini-vision",
  modalities: ["image", "video"],
  async createPrompt(ctx) {
    return async (parts, opts) => { /* 返回分析文本 */ };
  },
};

// 形态 B：复用 pi 运行时，只换 wire 格式修复器
module.exports = {
  name: "qwen-vl",
  modalities: ["image", "video"],
  engine: "pi",
  fixPayload(payload) { /* 自定义改写，返回 undefined 表示不修改 */ },
};
```

**ctx**（`gateway/src/media/plugin-context.ts`）：`apiKey(name)` / `fetch(url, opts)`（60s timeout）/
`pluginConfig(name)`（读 `config.media.pluginConfig`）/ `log`。

**config 路由**（per-modality 覆盖全局）：
```yaml
media:
  engine: pi              # 默认引擎
  video:
    engine: qwen-vl       # video 模态走插件
  pluginConfig: {}        # 插件自定义配置
```

**HTTP API**：`GET /api/media/plugins`（状态列表）、`POST /api/media/plugins/reload`（手动重载）。
校验失败 fail-open（状态记 error，不影响其他插件与默认 pi）。
`pi-adapter` 的 `fixPayload` 现为可选 dep（默认 `fixMediaPayload` 小米格式），插件可覆盖。
缓存 key 含 engineName 防同模型不同引擎串缓存。
测试：`tests/unit/gateway/media-plugin-loader.test.ts`（11 例）、`media-service.test.ts` resolvePrompt 路由（4 例）。

