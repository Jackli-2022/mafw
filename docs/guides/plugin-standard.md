# 插件包标准（Plugin Standard v1）

> **读者**：一个没有本仓库上下文的 agent。目标是一件事——写出一个包 → `mafw plugin check --strict` 通过 → 把安装命令交给人类。
> **两个参考包**（形状的真相，均在 `examples/plugins/`）：`hello-plugin/`（最小：action + event）与 `kitchen-sink/`（五个 gateway plane + UI panel 全覆盖）。
> **机器可读契约**：`mafw plugin schema`（`plugin.json` 的 JSON Schema，永不比解析器更严）。
> **细节参考**（本仓库视角、历史背景）：`docs/guides/plugin-authoring.md`；本文是规范正文。

---

## 0. 60 秒路径

```bash
# 1) 生成骨架：三个文件，默认落在 <cwd>/.mafw/plugin-drafts/<name>/
mafw plugin init my-plugin

# 2) 编辑（只做一件事：让 activate() 注册的东西都出现在 contributes.gateway 里）
#    <cwd>/.mafw/plugin-drafts/my-plugin/plugin.json
#    <cwd>/.mafw/plugin-drafts/my-plugin/index.js

# 3) 自检（必须绝对路径；网关不需要运行，也不需要 human token、不联网）
mafw plugin check --strict "C:/abs/path/.mafw/plugin-drafts/my-plugin"

# 4) 把第 3 步打印出的这一行原样交给人类（不要自己执行）
#    install: mafw plugins install "C:/abs/path/.mafw/plugin-drafts/my-plugin" --trust trusted --permission actions --permission events
```

**完成标准**：`mafw plugin check --strict "<abs path>"` 退出码 `0`（首行 `ok <name> ...`），**并且**你已经把 `install:` 行交给人类。agent 的终点不是安装，是「check 通过 + 交出安装命令」；安装**由人执行**（§9）。

四条会立刻决定成败的规则：

1. **先声明、后注册。** `plugin.json` 的 `contributes.gateway` 是注册面的上界；`activate()` 注册了未声明的 action / event / tool / observer，整包激活失败（§6）。
2. **路径一律绝对。** `check` 拒绝相对路径：`path must be absolute: <path>`。
3. **observer 只看 canonical 事件。** 包自己的 `plugin:*` 事件永远到不了 observer（§4.4）。
4. **`untrusted` 只有 actions / events / config。** 需要 tools / observers / http，必须是 `trusted`（§7）。

其它两个子命令：`mafw plugin schema` 打印 JSON Schema（`--json` 对它是无变化的对称参数）；`mafw plugin init <name> [--dir <parent>] [--force] [--json]` 生成骨架，成功后打印 `created <path>` 与 `next: mafw plugin check "<path>"`。

---

## 1. 包形态与目录布局

两种形态，**判据是 manifest 是否存在**，不是文件形态本身：

| 形态 | 磁盘样子 | 能贡献 |
|---|---|---|
| 目录包（标准形态） | `~/.mafw/plugins/<name>/plugin.json` + 入口（默认 `index.js`）+ 可选 `lib/`、`web/` | 全部：ui / actions / events / tools / observers / http / legacy |
| 单文件包 | `~/.mafw/plugins/<name>.js`（包名 = 文件名） | 只有 ui / actions / events / legacy；`tools` / `observers` / `http` 会拒绝（§7） |

缺 `plugin.json` 的目录包与单文件包**同罪**：没有 `contributes`、没有声明式权限、没有安装时授权，所以同样不能贡献那三个面。

目录包布局：

```text
~/.mafw/plugins/my-plugin/
  plugin.json          # 元数据 + contributes（唯一必填文件）
  index.js             # main，默认 index.js；必须在包目录内
  lib/…                # 可选：包内模块，只在 gateway 进程执行
  web/…                # 可选：只有声明 ui.webSurfaces 时才有意义，入口文件必须存在
```

安装目标是 `~/.mafw/plugins/<name>/`（`MAFW_PLUGINS_DIR` 可覆盖根目录；数据根固定 `~/.mafw`）。安装**只走 CLI**（§9）：手工拷贝会绕过安装时同意、指纹基线与审计。

身份规则（逐字）：

- 包名：`^[A-Za-z0-9](?:[A-Za-z0-9._-]*[A-Za-z0-9_-])?$`，不能以 `.` 或空格结尾；违规报 `invalid package name: <name>`，缺名报 `name is required`。
- manifest `name` 与模块导出 `name` 必须一致：模块缺 `name` 报 `missing name`，不一致报 `name mismatch: exports '<x>', package '<y>'`。安装目录由 CLI 按包名创建（`~/.mafw/plugins/<name>/`），手工布局时也保持一致，免得人和工具对不上号。
- `main` 默认 `index.js`，必须是包内相对路径：绝对路径、Windows 盘符、含 `..` 段报 `main must be a relative path inside the package`。
- `mafw plugin init` 在 manifest 规则之上再限 ≤100 字符（它生成的 `plugin:<name>:ping` 要留在 128 字符标识符上限内）；手写的包可以更长。

最小可运行包（与 `mafw plugin init` 生成物同形）：

```json
{
  "name": "my-plugin",
  "version": "0.1.0",
  "main": "index.js",
  "apiVersion": 2,
  "kind": "trusted",
  "permissions": ["actions", "events"],
  "contributes": {
    "gateway": {
      "actions": ["ping"],
      "events": ["plugin:my-plugin:ping"],
      "tools": [],
      "observers": [],
      "http": false
    }
  }
}
```

```js
module.exports = {
  name: 'my-plugin',
  async activate(ctx) {
    return {
      actions: {
        ping: { title: 'Ping', handler: () => ({ pong: true }) },
      },
      events: [
        { type: 'plugin:my-plugin:ping', title: 'Ping', schema: { type: 'object' } },
      ],
    };
  },
};
```

> 骨架刻意写 `"tools": []` / `"observers": []` / `"http": false`：显式零上界，逼你先改声明再改代码。**省略**一个 plane 等于「不设上界」（§6），新包不该是这个意思。

---

## 2. `plugin.json` 字段表

解析器只读它认识的键；额外顶层元数据允许存在（发布 schema 因此没有 `additionalProperties: false`）。

| 字段 | 类型 | 必填 | 默认 | 说明 |
|---|---|---|---|---|
| `name` | string | ✅ | — | 包名 + 事件命名空间。规则见 §1。 |
| `version` | string | — | — | 非空字符串，自由格式；在 `check` / `plugins list` 展示。 |
| `main` | string | — | `index.js` | 包内相对入口，见 §1。 |
| `apiVersion` | `1` \| `2` | — | `1` | manifest 代际。2 才有 `kind` / `permissions` 同意语义、严格 `contributes`。 |
| `kind` | `"trusted"` \| `"untrusted"` | — | `"trusted"` | 只有 `untrusted` 走 worker 进程；`untrusted` 必须 `apiVersion: 2`。 |
| `permissions` | string[] | — | `[]` | 安装时同意的 token 清单（token 见下）。`apiVersion: 2` 缺省会得到 warning `legacy-permissions`。 |
| `host` | string | — | 无限制 | 宿主版本范围，语法见 §11。 |
| `integrity` | `{ algorithm: "sha256", files: { "<relpath>": "<hash>" } }` | — | — | 声明后安装前逐文件校验；不匹配 422 `integrity mismatch: …`。 |
| `deprecated` | string | — | — | 非空的替换提示；doctor 报 warn，不影响激活。 |
| `standardVersion` | integer ≥ 1 | — | — | 写这个包时对照的规范版本（本文 = `1`）。宿主只校验并记录，不用它决定激活（§11）。 |
| `contributes` | object | — | 无（不上界） | 静态面上界，见 §6。apiVersion 2 下非法 → 激活失败；apiVersion 1 下非法 → warning `legacy-contributes: …` 并丢弃该块。 |

`permissions` 的全部合法 token：

- 基础 token（逐字）：`actions`、`events`、`config.read`、`config.write`、`terminal`、`http`、`tools`、`observers`、`ui.web`
- 带前缀（`:` 之后必须还有内容）：`files.read:<path>`、`files.write:<path>`、`net.fetch:<host>`
- 其它一律 `unknown permission: <token>`；非数组报 `permissions must be an array of strings`，空元素报 `permissions[<i>] must be a non-empty string`。

**`permissions` 是安装时同意清单，不是运行时开关。** 对 `trusted` 包，`activate()` 注册任何面都不按 `permissions` 放行或拒绝；只有 `untrusted` worker 会按 token 检查 `actions` / `events` / `config.read` / `config.write`（§7）。但安装仍然要求 `--permission` 集合与 `permissions` **完全一致**（§9），所以把用到的面都写上。

字段级错误文案（`check` 的 `error:` 行 / 安装 400）：`invalid plugin.json: …` → `plugin.json must be an object`、`version must be a non-empty string`、`invalid kind: <v>`、`untrusted requires apiVersion 2`、`host must be a string`、`invalid host range: <v>`、`integrity must be an object`、`integrity.algorithm must be "sha256"`、`integrity.files must be an object`、`integrity.files["<path>"] must be a non-empty string`、`deprecated must be a non-empty string`、`standardVersion must be a positive integer`。

---

## 3. `activate()` 与生命周期

两种模块形状，二选一：

```js
// A) 统一包（本文的全部内容都走这条）
module.exports = { name: 'my-plugin', async activate(ctx) { return { /* contributions */ }; } };

// B) legacy：直接导出贡献对象（usage / media / runtime / tts / uiTools），无 activate()
module.exports = { name: 'my-plugin', usage: { /* … */ } };
```

生命周期要点：

- `activate()` 在安装提交、启用、以及**内容指纹变化**（热重载）时执行。一次激活 = 一个 revision；handler 闭包里的状态随该 revision 生死，不要往模块级全局塞状态。
- 你打开的 timer / listener / watcher / socket **必须**经 `ctx.effect(dispose)` 释放（LIFO 执行）。否则替换 revision 后旧副作用继续跑。
- `ctx.http` 只在 `activate()` 运行期间可用：激活返回后 recorder 被 seal，再注册抛 `ctx.http is only available during activate() (package "<name>")`。
- 激活失败 = **整包不生效**（错误留在 pending / failure 记录里，`check`、`plugins list`、Desktop 可见）；已提交的旧 revision 不会被失败的新候选替换。
- 零贡献会被拒绝：`no contributions (usage/media/runtime/tts/uiTools/ui/actions/events/tools/observers)`。`contributes.gateway.http: true` 本身不算贡献——只注册路由的包也过不了这一关。

`trusted` 包的 `ctx`（全部能力）：

| 能力 | 签名 / 说明 |
|---|---|
| `ctx.log` | `debug` / `info` / `warn` / `error` |
| `ctx.fetch(url, opts)` | 默认 60 s 超时（`AbortSignal.timeout(60_000)`）；传 `opts.signal` 可覆盖 |
| `ctx.apiKey(provider)` | 返回 key 或 `null` |
| `ctx.pluginConfig()` | 读 `plugins.<name>.config`（回退 legacy 三段 `pluginConfig`）；每次都重读，热更新立即可见 |
| `ctx.config.update(patch)` | 浅合并写回 `plugins.<name>.config`；只接受 JSON 可序列化值，拒绝 `__proto__` / `prototype` / `constructor` |
| `ctx.projectDir` / `ctx.gatewayPort` | 当前项目目录 / 网关端口 |
| `ctx.usage.modelStats({ sinceMs?, provider? })` | 用量统计 |
| `ctx.emit({ type, properties?, sessionID? })` | 只能发本包**已注册**的事件；未注册/越界被丢弃并记诊断，不抛异常 |
| `ctx.http.route(...)` / `ctx.http.ws(...)` | 仅 `activate()` 期间（§4.5） |
| `ctx.files.list/stat/read(projectDir, rel, { maxBytes? })` | 只读项目文件；越界、点文件、符号链接逃逸一律拒绝 |
| `ctx.terminal.create/bridge/resize/kill` | 与桌面终端同一 PTY；包被替换/停用/删除时自动关闭 |
| `ctx.effect(dispose)` | 注册清理回调 |

`untrusted` 包的 ctx 是精简版（worker 内）：`log`、`config.get()`、`config.update(patch)`、`emit(type, payload)`、`effect(dispose)`；没有 http / files / terminal / fetch / usage / apiKey（§7）。

---

## 4. 五个 plane（actions / events / tools / observers / http）

Handler 永远来自 `activate()` 的返回值；`plugin.json` 只声明**名字**（`tools` 是半个例外：声明项本身必须是一个合法描述符，但与本包注册项的匹配只按 `name`）。

四个声明式 plane（actions / events / tools / observers）的越界诊断形式是：

```text
error: invalid contributions: <diagnostic>[; <diagnostic>…]
```

即 `package-host` 把校验器给出的每条诊断用 `"; "` 连接后加前缀 `invalid contributions: `。**`http` 是例外**：它在派生贡献构建之前单独检查，错误串不带这个前缀（§4.5）。

### 4.1 actions

形状：

```ts
actions: Record<string, {
  title?: string;
  description?: string;
  inputSchema?: JsonSchema;   // JSON Schema 2020-12，自包含（无远程 $ref）
  outputSchema?: JsonSchema;
  timeoutMs?: number;         // 正整数，1..60000，缺省 15000
  handler(input: unknown, call: { sessionID?: string; signal: AbortSignal }): unknown;
}>
```

可复制片段（`examples/plugins/hello-plugin/index.js`）：

```js
return {
  actions: {
    now: {
      title: 'Current time',
      handler: () => ({ now: new Date().toISOString() }),
    },
  },
  events: [
    {
      type: 'plugin:hello-plugin:tick',
      title: 'Tick',
      schema: { type: 'object', properties: { at: { type: 'number' } } },
    },
  ],
};
```

逐字诊断（标签里的 `action "<name>"` 用你注册的 action 名替换）：

- `action "<name>" is not declared in plugin.json contributes.gateway.actions`
- `action "<name>" name must not contain ":" or whitespace`（名字 ≤128 字符，`^[A-Za-z0-9][A-Za-z0-9._-]*$`）
- `action "<name>" handler must be a function`
- `action "<name>" has unknown field "<key>"`（只允许 `title` / `description` / `inputSchema` / `outputSchema` / `timeoutMs` / `handler`）
- `action "<name>" timeoutMs must be a positive integer`
- `action "<name>" timeoutMs exceeds the maximum of 60000ms`
- schema 问题：`action "<name>" inputSchema must be a JSON Schema object` / `… exceeds 262144 bytes` / `… remote $ref "…" is not allowed (…/$ref)` / `… $schema "…" is not supported; plugin schemas must use JSON Schema 2020-12 (…/$schema)`

上限：`timeoutMs` 缺省 **15000 ms**，硬顶 **60000 ms**；input / output payload 各 **262144 字节**（256 KiB）；input 在调用前按 `inputSchema` 校验，output 在返回后按 `outputSchema` 校验（失败是调用错误，不是激活错误）。超时报 `plugin action "<package>:<name>" exceeded <ms>ms`。

**声明必须出现在 `contributes.gateway.actions` 里**（平面存在即约束；显式 `[]` 表示一个也不许），否则整包激活失败。

### 4.2 events

形状：

```ts
events: Array<{
  type: string;              // 必须 plugin:<package>:<event>
  title?: string;
  description?: string;
  schema?: JsonSchema;       // 校验 event.properties
  scope?: 'global' | 'session';  // 缺省 global；session 作用域要求 sessionID
}>
```

可复制片段（`examples/plugins/kitchen-sink/index.js`）：

```js
// (2) events — must live in this package's namespace and be declared.
return {
  events: [
    {
      type: 'plugin:kitchen-sink:ping',
      title: 'Ping',
      schema: { type: 'object', properties: { at: { type: 'number' } } },
    },
  ],
};
```

逐字诊断（标签里的 `<type>` 用完整事件类型替换）：

- `event "<type>" is not declared in plugin.json contributes.gateway.events`
- `event type "<type>" is a canonical runtime event and cannot be registered by a plugin package`
- `event type "<type>" must use the plugin:<package>: namespace (expected "plugin:<package>:")`
- `event type "<type>" belongs to another package (expected prefix "plugin:<package>:")`
- `event type "<type>" must end with a non-empty event name`
- `duplicate event type "<type>"`
- `event "<type>" declares both schema and payloadSchema; use schema only`
- `event "<type>" scope must be "global" or "session"`
- `events[<i>].type must be a non-empty string` / `events[<i>].type exceeds 128 characters`

上限：事件类型总长 **128 字符**（`events[<i>].type exceeds 128 characters`），命名空间后缀要匹配 `^[A-Za-z0-9][A-Za-z0-9._-]*$`；`properties` 必须是 plain object、JSON 可序列化、且 ≤ **262144 字节**。发射未注册类型不会抛错：被丢弃并记 `unregistered-event` 诊断。`payloadSchema` 是历史拼写，等价于 `schema`，两者不能同时写。

**声明必须出现在 `contributes.gateway.events` 里**（写完整类型，不写短名），否则整包激活失败。声明了但没发射是合法的。

### 4.3 tools

形状：

```ts
tools: Array<{
  name: string;              // 包内名；宿主暴露为 plugin:<package>:<name>
  title?: string;
  description: string;       // agent 只看到 description + schema
  inputSchema: JsonSchema;   // 必填
  outputSchema?: JsonSchema;
  timeoutMs?: number;        // 1..60000
  scope?: 'global';          // 只支持 global
  handler(input: unknown, call: { sessionID?: string; signal: AbortSignal }): unknown;
}>
```

可复制片段（`examples/plugins/kitchen-sink/index.js`）：

```js
// (3) tools — agent-side tools; the host prefixes the name with
// `plugin:kitchen-sink:` so it can never collide with gateway tools.
return {
  tools: [
    {
      name: 'lookup',
      description: 'Return a fixed value: the reference shape of an agent tool.',
      inputSchema: { type: 'object' },
      handler: () => ({ value: 'lookup-ok' }),
    },
  ],
};
```

逐字诊断（标签里的 `<name>` 用注册名替换）：

- `tool "<name>" is not declared in plugin.json contributes.gateway.tools`
- `tools[<i>].name "<name>" must match /^[A-Za-z0-9][A-Za-z0-9._-]*$/`
- `duplicate tool name "<name>"`
- `tools[<i>].description must be a non-empty string`
- `tools[<i>].inputSchema must be an object`
- `tools[<i>].handler must be a function`
- `tools[<i>].scope: package tools do not support session scope yet` / `tools[<i>].scope must be "global"`
- `tools[<i>].timeoutMs must be a positive integer` / `tools[<i>].timeoutMs exceeds the maximum of 60000ms`

上限：`description` 在 `contributes.gateway.tools` 里 **1..512 字符**，注册时非空；tool 名在 **manifest 声明里 ≤64 字符**（注册本身允许到 128，但 64 以上的名字无法合法声明，等于不可用）；`inputSchema` 必填、`outputSchema` 可选、每个 schema ≤ **262144 字节**；`timeoutMs` 1..60000。

**声明必须出现在 `contributes.gateway.tools` 里**，否则整包激活失败。声明项必须是**完整描述符**（`name` + `description` + `inputSchema` 都合法），但匹配只按 `name`；`activate()` 里的 description / schema 才是 agent 实际看到的内容。

### 4.4 observers

形状：

```ts
observers: Array<{
  id: string;                 // ≤128，^[A-Za-z0-9][A-Za-z0-9._-]*$
  title?: string;
  description?: string;
  filter?: {
    sessionID?: string;
    projectId?: string;
    types?: string[];         // 1..32 项；精确名或以 * 结尾的前缀（如 "part.*"）
  };
  timeoutMs?: number;         // 1..60000；缺省 1000
  onEvent(event: {
    type: string; sessionID?: string; projectId?: string; at: number;
    properties?: Record<string, unknown>;
  }): void | Promise<void>;
}>
```

可复制片段（`examples/plugins/kitchen-sink/index.js`）：

```js
return {
  observers: [
    {
      id: 'audit',
      title: 'Audit counter',
      description: 'Counts canonical part.updated events; never mutates them.',
      filter: { types: ['part.updated'] },
      onEvent: () => {
        auditCount += 1;
      },
    },
  ],
};
```

**observer 只接收 canonical 运行时事件**——由 runtime 事件翻译层产出的 canonical 名，如 `session.created`、`message.updated`、`part.updated`、`turn.started`、`turn.completed`、`permission.asked`、`task.updated`。它在事件管线的 `canonicalObserverTap` 段被喂入（位于 `internalFilter` 之前、`finalBroadcast` 之前），看到的是与 conformance 相同的 pre-drop canonical 面；它**收不到**任何 `plugin:*` 事件——自己的、别人的都收不到。`plugin:*` 只走广播 / 自动化消费者。想观察自己的事件：用 `events` 广播 + 外部消费者（例如 SSE 客户端），不要在 observer 里等它。

（片段里的 `auditCount` 是示例 `activate()` 内的局部计数器。）

observer 是只读的：不能改事件、不能否决、不能重写；投递是 post-hoc、fail-open、有界队列（**1000** 对，溢出丢最新并计数），单 handler 超时 **1000 ms**（可用 `timeoutMs` 覆盖），错误与超时按 observer 隔离。

逐字诊断：

- `observer "<id>" is not declared in plugin.json contributes.gateway.observers`
- `observers[<i>].id "<id>" must match /^[A-Za-z0-9][A-Za-z0-9._-]*$/`
- `duplicate observer id "<id>"`
- `observers[<i>].onEvent must be a function`
- `observers[<i>].filter.types must be an array of 1-32 non-empty strings`
- `observers[<i>].filter.sessionID must be a non-empty string` / `observers[<i>].filter.projectId must be a non-empty string`
- `observers[<i>].filter has unknown field "<key>"`（filter 只允许 `sessionID` / `projectId` / `types`）
- `observers[<i>].timeoutMs must be a positive integer` / `observers[<i>].timeoutMs exceeds the maximum of 60000ms`

**声明必须出现在 `contributes.gateway.observers` 里**，否则整包激活失败。声明只写 **id**：`onEvent` / `filter` / `timeoutMs` 永远来自 `activate()`，manifest 里写不了回调。

### 4.5 http

形状（只在 `activate()` 期间可调用）：

```ts
ctx.http.route(
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE',
  path: string,                       // '' 或 '/'（包根），或 / 开头且不含 .. : ? # \\ NUL
  handler(req: {
    method: string; path: string; query: URLSearchParams; headers: IncomingHttpHeaders;
    sessionID?: string; projectDir: string; body: AsyncIterable<Buffer>;
  }): { status?: number; headers?: Record<string, string>; body?: string | Buffer | AsyncIterable<Uint8Array> } | void,
  opts?: { maxBodyBytes?: number },
): void;

ctx.http.ws(path: string, handler(ws, ctx: { sessionID?: string; projectDir: string }): void): void;
```

可复制片段（`examples/plugins/kitchen-sink/index.js`）：

```js
module.exports = {
  name: 'kitchen-sink',
  async activate(ctx) {
    // (5) http — served at /api/plugins/kitchen-sink/api/ping. Routes can only
    // be registered while activate() runs; they are retired with this revision.
    ctx.http.route('GET', '/ping', () => ({ body: 'pong' }));

    return { /* … */ };
  },
};
```

公开路径由宿主加前缀，包永远够不到别的包或网关自己的路由：

- HTTP：`/api/plugins/<package>/api<path>`（上例 `GET /api/plugins/kitchen-sink/api/ping`）
- WebSocket：`/api/plugins/<package>/ws<path>`

逐字诊断：

- `http routes are not declared (contributes.gateway.http is false)`
- `ctx.http is only available during activate() (package "<name>")`
- `unsupported route method "<method>" (allowed: GET, POST, PUT, PATCH, DELETE)`
- `route path "<path>" must be '' or start with '/'` / `route path "<path>" must not contain ".."` / `route path "<path>" must not contain ":" (path params are not supported)` / `route path "<path>" must not contain a query or fragment`
- `duplicate http route <METHOD> <path> in package "<name>"` / `duplicate ws route <path> in package "<name>"`

上限：请求体默认 **32 MiB**（`33554432` 字节，`opts.maxBodyBytes` 可按路由改写该上限，正整数），超限 413 `request body too large`；handler 抛错 500 `plugin handler failed`；handler 返回 `undefined` body → **204**，返回字符串默认 `content-type: text/plain; charset=utf-8`；只支持精确路径匹配（无路径参数）。

**`contributes.gateway.http: true` 必须写在 `plugin.json` 里**：`false` 时任何一次 `ctx.http.route()` / `ctx.http.ws()` 都让激活失败（即使 `activate()` 正常返回）；反之 `true` 也必须伴随至少一个非 http 的贡献，否则零贡献拒绝（§3）。

---

## 5. ui 与 web surface（简表）

**权威来源是 `activate()` 返回的 `ui`**；`plugin.json` 的 `contributes.desktop` 只是声明，宿主校验形状但**不**用它作上界（doctor 会提示 `desktop contributions are declared but not enforced by this host`）。UI 是可序列化数据，不能注入组件/HTML/CSS/JS。

| slot | 必填 | 作用 | 上限 / 约束 |
|---|---|---|---|
| `panels` | `id`、`title`、`viewAction` | 右侧工作台 L2 tab | `viewAction` 必须是本包 action；`rail.icon` 必须是已注册图标（顶层 `icon` 不校验）；≤256 项 |
| `toolCards` | `id`、`tools`、`viewAction` | 替换/增强工具卡 | `override: true` 才可覆盖内建卡；≤256 项 |
| `configPages` | `id`、`title`、`schema`、`loadAction`、`saveAction` | 配置表单页 | schema 根是 `object`，字段 `type` 只允许 string/number/integer/boolean（关键字白名单见契约）；≤256 项 |
| `messageWindows` | `id`、`title`、`triggerEvent`、`viewAction` | 由本包事件触发的气泡 | `triggerEvent` 必须是本包已注册事件；≤256 项 |
| `menuItems` | `id`、`surface`、`label`、`action` | 上下文菜单项 | `surface` ∈ `editor.tab` / `file.tree` / `file.path` / `message` / `session.row`；`label` ≤80；`shortcut` ≤32 可打印字符；全包 ≤20 项 |
| `composerActions` | `id`、`label`、`action` | 输入框按钮 | `label` ≤40；全包 ≤3 项 |
| `webSurfaces` | `id`、`title` | 沙箱 Web 页（右工作台 surface） | `entry` 默认 `index.html`，必须在包 `web/` 内真实存在，否则整包激活失败；`scope` ∈ `session`/`project`/`global`（默认 `session`）；`reloadOnSessionChange` 默认 `true`；≤32 项 |

- 所有 `id` 与 action 名共用命名空间规则：`^[A-Za-z0-9][A-Za-z0-9._-]*$`，≤128 字符，不能含 `:` 或空白；`viewAction` / `action` 只能引用**同包** action（跨包引用报 `cross-package action reference "…"`）。
- 需要图标的字段（`panels[].rail.icon`、`webSurfaces[].icon`、`webSurfaces[].rail.icon`）只能取注册过的名字（`packages/plugin-contract/src/icons.ts` 的 14 个：`bubble-5`、`magnifying-glass`、`sticky-note`、`team-three`、`checklist`、`layout-grid`、`square-arrow-top-right`、`refresh`、`plus`、`file`、`folder`、`terminal`、`branch`、`globe`）；`panels[].icon` 是自由字符串（契约不做图标注册校验）。
- Web 页的 URL 由宿主投影为 `/api/plugins/<package>/ui/<entry>`；资产扩展名不在白名单内一律 404；入口缺失/逃逸让整包激活失败（`invalid web surfaces: web surface "<id>" entry "<entry>" does not resolve to a readable file under …`）。
- `viewAction` 返回的 `PluginView` 由契约的 `normalizePluginView` 归一化，上限是**256** 个 widget 节点、嵌套深度 **12**、任一文本字段 **64 KiB**、image data URL **2 MiB**、action input **256 KiB**；超限返回 `null`（不是截断），未知 widget 类型降级为 `text`。
- 例子：`examples/plugins/kitchen-sink/index.js` 的 `ui.panels`（面板）；Web surface 的完整写法见 `docs/guides/plugin-authoring.md` §6.5（`examples/plugins/` 里没有 web surface 参考包）。

---

## 6. 声明即上界

`contributes.gateway` 只约束一个方向：**registered ⊆ declared**。

- **plane 缺失 = 不设上界**（老包照常激活）；**显式 `[]` = 零上界**（一个也不许）。渲染与判断都必须区分这两者。
- **声明多于注册是合法的**：包可以按能力/配置/host 版本条件注册。`check` 只会打印 `note: declared but not registered: action "x", …`，**永不**因此失败。
- 被强制的是四个名字集合（`actions` / `events` / `tools` / `observers`）与一个布尔（`http`）。`contributes.desktop` 不参与上界。
- 诊断顺序：先形状/身份校验；有形状错误时只报那些错误，修好之后才报越界（判决都是激活失败）。`http: false` 的检查在派生贡献构建之前，不受这个顺序影响。
- `contributes` 本身非法时：`apiVersion: 2` → 激活失败（`contributes: <detail>`）；`apiVersion: 1` → warning `legacy-contributes: <detail>`，块被丢弃且**不构成约束**（合法的 v1 块则和 v2 一样构成约束）。
- 每条越界消息都在 §4 逐字列出；它们都以 `invalid contributions: ` 前缀出现在 `check` 的 `error:` 行。

---

## 7. 能力与信任（trusted / untrusted 的硬限制）

| | `trusted`（默认） | `untrusted` |
|---|---|---|
| 执行位置 | gateway 主进程 `require` | 独立 child process（worker） |
| manifest 要求 | 无（缺 `plugin.json` 也可加载） | `apiVersion: 2` + `kind: "untrusted"` |
| 可贡献面 | 全部 | **只有 `actions` / `events`**（外加 `config.read` / `config.write` 能力） |
| 不得贡献 | — | `tools` / `observers` / `http`（以及 ui / legacy） |
| ctx | 全量（§3） | `log`、`config.get()`、`config.update(patch)`、`emit(type, payload)`、`effect(dispose)` |
| 生效方式 | 文件内容指纹变化即热重载 | 安装时记录指纹；磁盘变化 → `untrusted package changed on disk; reinstall or unquarantine explicitly` |

`untrusted` 的硬限制（都是代码里的硬检查，不是建议）：

- 返回 `actions` / `events` 之外的键 → `not allowed in untrusted worker: <keys>`（逗号连接，按包上报的键顺序）。
- 没有对应 token 就注册/使用 → `permission denied: actions`、`permission denied: events`、`permission denied: config.read`、`permission denied: config.write`。
- worker 里没有 `fetch` / `WebSocket` / `EventSource`，`http`/`https`/`net`/`tls`/`dns`/`dgram`/`http2`/`child_process`/`worker_threads`/`cluster` 被拦（`not available in untrusted worker: <name>`）；Node 权限模型只给包目录（与 worker bootstrap 目录）**只读**，无写、无子进程、无 addon；单条 IPC 消息 ≤ **1 MiB**。
- action 超时更短：缺省 **10 s**、硬顶 **30 s**（trusted 是 15 s / 60 s）；超时直接杀 child。
- child 崩溃按 **0.5 s / 1 s / 2 s** 退避重启，连续 3 次后由 safety 机制 quarantine。
- 安装时 worker 不可用 → `untrusted packages require a worker host`；**`mafw plugin check` 无法本地校验 untrusted 包**（本地 check host 没有 worker host factory），会返回 `worker_unavailable: no worker host factory`。这类包的自检只能做到「声明与形状正确」，最终验证交给人类的安装 + `mafw plugins doctor`。
- `ctx.emit` 在 worker 里是**位置参数** `emit(type, payload)`（trusted 是对象 `emit({ type, properties })`）；类型必须是 `plugin:` 开头。

**没有 `plugin.json` 的包**（单文件 `.js` 或缺少 manifest 的目录）继续以 `trusted` 加载，但**不能**贡献 `tools` / `observers` / `http`：

```text
packages without plugin.json cannot contribute <planes>; ship a directory package with plugin.json
```

`<planes>` 按 `tools`、`observers`、`http` 顺序用 `, ` 连接（如 `tools, observers, http`）；`ui` / `actions` / `events` / legacy 不受影响。修法只有一个：做成带 `plugin.json` 的目录包。

---

## 8. 自检：`mafw plugin check --strict --json`

```bash
mafw plugin check <absolute-path> [--json] [--strict]
```

- **必须绝对路径**（相对路径直接拒绝：`path must be absolute: <path>`）。它在本进程内跑一次**真实激活的 dry-run**（`PluginHost.checkPackage`）：不起网关、不读 human token、不联网、不注册任何东西。所以网关停着也能用。
- 人读输出：首行 `ok <name> (<path>)` 或 `not ok …`，随后 `version:` / `apiVersion N, kind K` / `permissions:` / `contributions:` / `declared:` / `registered:` / `note: declared but not registered: …`（合法）/ `warning: …` / `error: …`，最后在判决通过时打印 `install: <可粘贴命令>`。
- `--json`：**一行**可解析 JSON。`ok` 是**命令判决**（不是原始 check 结果），另有 `verdict`（`"ok"` / `"fail"`）、`strictFailed`，以及 `name` / `version` / `contributions` / `apiVersion` / `kind` / `permissions` / `declared` / `registered` / `warnings` / `error` / `webSurfaces`（存在时）。退出码 `0` = 通过，`1` = 不通过。
- `declared` 缺失 = 没有 `contributes.gateway`（无上界）；`declared.actions` 缺失 = 该 plane 无上界；`"actions": []` 会原样出现（零上界）。`registered` 永远存在，且是**尝试注册**的内容——失败时也能看到差集。
- `--strict` 只把 **manifest warning** 变成失败（`not ok: --strict turned the manifest warnings above into failures`）。warning 来自 `plugin.json` 归一化：`legacy-permissions`（apiVersion 2 未声明 `permissions`）、`legacy-contributes: …`（apiVersion 1 的非法 `contributes` 块）。**`--strict` 不会因「声明了没注册」失败**。
- `check` 也接受单文件包路径（`…/foo.js`），但单文件包不能有 tools/observers/http（§7）。
- 失败时 `next:` 行会指名下一步（未声明 → 去补 `contributes.gateway`；缺 permission → 去补 `permissions`），然后让你重跑 check。

示例（`--json --strict`，一个 apiVersion 2 但未声明 `permissions` 的包）：

```json
{"ok":false,"name":"v2noperm","version":"0.0.1","contributions":["actions"],"apiVersion":2,"registered":{"actions":["ping"],"events":[],"tools":[],"observers":[],"http":0},"warnings":["legacy-permissions"],"verdict":"fail","strictFailed":true}
```

`mafw plugin schema` 打印同一份契约的人类可读形式（带缩进的 JSON，无外层信封）；编辑器/agent 拿它当字段真源，比任何文档都准。

---

## 9. 安装：由人执行

**安装是人类的动作，不是 agent 的动作。** 服务端安装路由只接受 human principal（human token 或 device token）；service / API token 会得到 `403 human principal required`（`human_principal_required`）。

`apiVersion: 2`（推荐形态）——`--trust` 必须等于 `plugin.json` 的 `kind`，`--permission` 必须**逐项列全**且与 `permissions` 集合完全一致：

```bash
mafw plugins install "C:/abs/path/to/my-plugin" \
  --trust trusted \
  --permission actions --permission events
```

`apiVersion: 1`（legacy）——不接受也不要求同意参数：

```bash
mafw plugins install "C:/abs/path/to/my-plugin"
```

规则：

- 集合必须**完全一致**（顺序无关，重复的 `--permission` 无意义）；不一致或缺 `--trust` → `400` `permission consent required: <按字母排序的声明集合>`（code `permission_consent_required`）。
- 同名已安装 → `409 package already installed: <name>`；人类确认要替换时加 `--overwrite`（网关会先把旧版本快照进 last-good）。
- human token 来源：环境变量 `MAFW_HUMAN_TOKEN`，或文件 `~/.mafw/human.token`（路径可用 `MAFW_HUMAN_TOKEN_FILE` 覆盖）；文件不存在时先 `mafw start` 让网关生成一次。**不要把 token 交给 agent，也不要打印它**；agent 交付的是 §0 打印出的 `install:` 行。
- 装完人类可以自查：`mafw plugins list`、`mafw plugins doctor <name>`。
- 包落盘到 `~/.mafw/plugins/<name>/`；被禁用/隔离的包不会因为文件存在而自动生效。

---

## 10. 常见失败与修法

| 症状（逐字或接近逐字） | 原因 | 修法 |
|---|---|---|
| `error: invalid contributions: action "ping" is not declared in plugin.json contributes.gateway.actions` | `activate()` 注册了声明集合之外的 action（events / tools / observers 同构） | 把名字加进 `contributes.gateway.<plane>`，或停止注册；显式 `[]` 时一个也不许 |
| `error: http routes are not declared (contributes.gateway.http is false)` | 声明了 `http: false`（骨架默认）却调用了 `ctx.http.route/ws` | 改成 `"http": true` 并把 `http` 加进 `permissions`，或删掉路由 |
| observer 收不到自己的事件 | observer 只吃 **canonical** 运行时事件；`plugin:*` 走广播/自动化，永远不进 observer | 用 `events` 广播 + 外部消费者；不要用 observer 观察本包事件 |
| `path must be absolute: .`（CLI 直接拒绝，不带 `error:` 前缀） | `check` 收到相对路径 | 传绝对路径（`plugin init` 打印的 `next:` 行就是绝对路径） |
| `409 package already installed: <name>` | 同名包已安装 | 人类确认后加 `--overwrite` |
| `error: packages without plugin.json cannot contribute tools; ship a directory package with plugin.json` | 单文件包或缺 manifest 的目录包注册了 tools/observers/http | 做成带 `plugin.json` 的目录包，或去掉该 plane |
| `error: no contributions (usage/media/runtime/tts/uiTools/ui/actions/events/tools/observers)` | `activate()` 什么也没返回；`http: true` 不算贡献 | 至少返回一个真实贡献 |
| 第一次只报形状错误，修完才出现 `is not declared in plugin.json contributes.gateway.…` | 诊断顺序：形状/身份错误优先，越界在有形状错误时被压住（`enforceDeclared` 直接返回） | 两轮都要修；越界不是「新错误」，是先前被遮蔽的那条 |
| `action "x" has unknown field "foo"` | 声明里多了字段 | 只允许 `title` / `description` / `inputSchema` / `outputSchema` / `timeoutMs` / `handler` |
| `error: action "x" timeoutMs exceeds the maximum of 60000ms` | 声明超时超过硬顶 | 降到 ≤60000（untrusted 有效顶更短：30 s） |
| `event type "part.updated" …` / `event type "x" must use the plugin:<package>: namespace …` | 事件类型不是 `plugin:<package>:<event>`，或撞了 canonical 名 | 用完整命名空间；canonical 名不是包的命名空间 |
| `event "…" declares both schema and payloadSchema; use schema only` | 两个拼写都写了 | 只写 `schema` |
| `error: host range >=6.0.0 does not include 5.1.0` | `host` 范围排除了当前宿主 | 放宽范围或删掉 `host` |
| `error: name mismatch: exports 'a', package 'b'` / `missing name` | manifest 名与模块导出名不一致 / 模块没导出 name | 三者对齐（manifest、exports、目录名） |
| `error: plugin.json not found` | 把 `check` 指向了没有 manifest 的目录 | 改成包目录（含 `plugin.json`），或补上 manifest |
| `error: worker_unavailable: no worker host factory` | 本地 `check` 无法 dry-run untrusted 包（没有 worker host） | 交给人类安装后用 `mafw plugins doctor` 验证；本地只能查声明与形状 |
| `warning: legacy-permissions` 且 `--strict` 失败 | `apiVersion: 2` 却没声明 `permissions` | 声明用到的 token，或去掉 `--strict` |
| `warning: legacy-contributes: …`（v1） | `apiVersion: 1` 的 `contributes` 形状非法，块被丢弃 | 修形状（或升到 apiVersion 2，让它变成硬错误） |
| `error: main must be a relative path inside the package` | `main` 是绝对路径/盘符/含 `..` 段 | 写成包内相对路径（默认 `index.js`） |

---

## 11. 版本与兼容（`apiVersion` / `host` / `standardVersion`）

三个「版本」管三件不同的事，不要混用：

| 字段 | 回答的问题 | 取值 | 违反时 |
|---|---|---|---|
| `apiVersion` | manifest 的**代际**：这个包用哪一套信任/同意语义？ | `1`（缺省，legacy）或 `2` | 其它整数 → `unsupported apiVersion: <n>`（非整数 → `invalid apiVersion: <value>`），该包不激活 |
| `host` | 这个包要求**哪个产品版本范围**的网关？ | `*`、空串，或空格分隔的比较器，如 `>=5.1.0 <6.0.0` | 不满足 → `host range <range> does not include <version>`，该包不激活 |
| `standardVersion` | 写这个包时对照的是**哪一版规范文本**（本文 = `1`） | 正整数（≥1） | 非正整数 → `standardVersion must be a positive integer` |

`host` 语法细节（逐字对照解析器）：

- `*` 或空串 = 任意版本；缺省字段 = 任意版本。
- 比较器：`>=`、`<=`、`>`、`<`、`=`（缺省 `=`），紧跟 `x.y.z`（可带 `-`/`+` 后缀），多个比较器用空白分隔、全部满足才算兼容。
- 操作符与版本之间**不能有空格**：`>= 5.1.0` 会被拆成两个 token 而判为非法（`invalid host range: >= 5.1.0`）。
- 参与比较的宿主版本取 `MAFW_HOST_VERSION`，无该环境变量时回退 `5.1.0`。

`apiVersion` 的语义差别：

- `1`：`kind` / `permissions` 只是信息；`contributes` 形状非法只 warning 并丢弃（合法块仍然构成上界）。
- `2`：安装必须显式 `--trust` + 逐项 `--permission`；`contributes` 形状非法是硬错误；`untrusted` 只能出现在这里。
- 未来代际：解析器只接受 `1` / `2`，更大整数按 `unsupported apiVersion` 处理（不会静默降级成 1）。

`standardVersion` 目前**不被宿主用来放行或拒绝任何东西**——它只是作者声明「我按标准 v1 写的」，供人/工具判断。写新包时填 `1`，不要指望它触发任何兼容行为。
