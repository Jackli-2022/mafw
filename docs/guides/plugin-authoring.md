# 统一插件包编写指南（Plugin Package Authoring）

> 面向第一阶段（声明式 UI + Host action/event）的插件包作者。
> 参考实现：`docs/examples/plugins/service-monitor/`
> 共享契约：`packages/plugin-contract/`（`validateClientDescriptor` / `normalizePluginView` / `validateConfigFormSchema` / `PLUGIN_UI_LIMITS`）
> 设计文档：`docs/superpowers/specs/2026-11-03-unified-declarative-plugin-packages-design.md`

## 0. 先明确边界

统一插件包由 **gateway 进程执行 Host 代码**，向 Desktop 只发送**可序列化的声明式 UI**：

- 包可以做：注册 action（Host 闭包）、注册 `plugin:<package>:*` 事件、声明 panel / config page / tool card / message window。
- 包不能做：把 Solid/React 组件、任意 HTML/CSS/JS、事件 handler 或函数传到 Desktop；跨包调用 action；发射 canonical runtime 事件；读写任意配置文件。
- 这不是安全沙箱：安装包等于在本机 gateway 进程里执行代码。只安装你信任的目录。

第一阶段没有 Creator / Agent 自动生成插件。包安装、热重载与管理都在现有 Plugins 页完成。

## 1. 包布局

目录包：

```text
~/.mafw/plugins/service-monitor/
  plugin.json          # 元数据
  index.js             # 入口（默认 main = index.js）
  lib/…                # 可选：包内 Host 模块
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

中性错误码（REST/Desktop 可安全展示）：

| code | HTTP | 场景 |
|---|---|---|
| `unknown-package` / `unknown-action` | 404 | 未安装、已删除、名字错误 |
| `invalid-input` / `payload-too-large` | 400 | input 不符合 schema 或超过 256 KiB |
| `invalid-output` / `handler-error` | 502 | output 不符合 schema、handler 抛错 |
| `timeout` | 408 | 超过 `timeoutMs` |
| `aborted` / `unloaded` / `stale-revision` | 409 | 调用被取消、包被卸载、revision 已替换 |

## 6. UI slots

`ui` 只接受四个 slot（未知 slot 直接失败）：

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
    viewAction: 'toolCard',
    // override: true 才能替换内置/legacy 卡
  }],
}
```

- Desktop 把中性 ToolCardModel（tool / input / output / metadata / status）作为 action input 发给 gateway。
- running 阶段保持默认卡；completed / error 才请求插件视图，避免流式 O(n²) 请求。
- input/output 有统一字节上限与显式 truncated 标记，Desktop 不依赖 runtime 私有历史存储。
- 只有 `override: true` 才允许替换同名内置卡。

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
- 中性事件 payload / sessionID 作为 action input 调用 `viewAction`。
- **`viewAction` 不得发射 `triggerEvent`**：小窗取视图会再次触发事件，形成无限刷新。事件应由其他用户 action 发射。
- `modal:false` 是不阻断聊天的浮动小窗，不主动抢焦点；`modal:true` 是居中模态层并管理焦点。
- `dismissible:true` 支持关闭按钮与 Esc。
- 小窗内按钮仍是 action widget，经本包 action 回调 gateway；action 需要开小窗时，在 action 中发射相应注册事件，不要新增脚本化 UI 命令。

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
- **不是脚本化 UI 通道**：面板要开小窗时发注册事件，不新增“执行某 UI 命令”的接口。

## 11. 本地开发与验证

1. 从示例复制目录：

   ```bash
   cp -r docs/examples/plugins/service-monitor /tmp/my-plugin
   ```

2. 跑包自测（示例自带，零依赖）：

   ```bash
   node --test docs/examples/plugins/service-monitor/index.test.js
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

## 14. 示例走读

`docs/examples/plugins/service-monitor/`：

- `plugin.json` — 包元数据。
- `index.js` — 一次 `activate(ctx)` 返回：
  - `ui.panels`：`Service Monitor` 面板，`viewAction:'refresh'`，`refreshOn` 绑定 `plugin:service-monitor:changed`。
  - `ui.configPages`：endpoint / intervalSeconds / verbose 三字段的受限 schema，`loadConfig` / `saveConfig`。
  - `ui.toolCards`：`bash` / `shell` 中性工具卡，`viewAction:'toolCard'`。
  - `ui.messageWindows`：`changed` 事件触发的单例小窗，`viewAction:'messageView'`。
  - `actions`：`refresh`、`loadConfig`、`saveConfig`、`toolCard`、`messageView`。
  - `events`：`plugin:service-monitor:changed`（带 payload schema）。
- `index.test.js` — 零依赖自测：fake ctx 下逐项验证 slot/action/event、配置往返、事件发射与 widget 可序列化。

端到端回归：`gateway/tests/integration/plugin-package-e2e.test.ts` 用真实 PackageManager/PluginHost 覆盖 check → install → descriptor → action → event → canonical 伪造 → 热重载 → disable/delete，以及打包后的 contract 解析。
