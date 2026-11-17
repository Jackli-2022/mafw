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

# 3) 自检（必须绝对路径；网关不需要运行，也不需要 human token；ctx 差异见 §8）
mafw plugin check --strict "C:/abs/path/.mafw/plugin-drafts/my-plugin"

# 4) 把第 3 步打印出的这一行原样交给人类（不要自己执行）
#    install: mafw plugins install "C:/abs/path/.mafw/plugin-drafts/my-plugin" --trust trusted --permission actions --permission events
```

**完成标准**：`mafw plugin check --strict "<abs path>"` 退出码 `0`（首行 `ok <name> ...`），**并且**你已经把 `install:` 行交给人类。agent 的终点不是安装，是「check 通过 + 交出安装命令」；安装**由人执行**（§9）。

**`untrusted` 包不适用上面的第 3 步**：本地 check host 没有 worker，`kind: "untrusted"` 的包无法完成 dry-run，会返回 `worker_unavailable: no worker host factory`。按 §7 的 restricted 形状写（只有 actions / events / config），把包与 §9 的安装命令交给人在真实 host 上安装验证。

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
  README.md            # 可选：init 会生成一份；check 不要求
  lib/…                # 可选：包内模块，只在 gateway 进程执行
  web/…                # 可选：只有声明 ui.webSurfaces 时才有意义，入口文件必须存在
```

安装目标是 `~/.mafw/plugins/<name>/`（`MAFW_PLUGINS_DIR` 可覆盖根目录；数据根固定 `~/.mafw`）。安装**只走 CLI**（§9）：手工拷贝会绕过安装时同意、指纹基线与审计。

**包目录可以放在磁盘任意位置**：`<cwd>/.mafw/plugin-drafts/` 只是 `mafw plugin init` 的便利默认值，不是 `check` / `install` 的约束。`init --dir <parent>` 生成 `<parent>/<name>`（相对路径按 cwd 解析，缺失的父目录会被递归创建）。`check` **不**比对目录 basename 与 manifest `name`；只有 `install` 会按 manifest `name` 创建安装目录 `~/.mafw/plugins/<name>/`，所以源目录叫什么都可以。

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

`plugin.json` 必须是 **UTF-8 无 BOM**：解析器直接 `JSON.parse(readFileSync(path, 'utf-8'))`，BOM 会让 `check` / 安装报 JSON token 错误（形如 `Unexpected token` 后跟不可见字符），Windows 编辑器可能自动加 BOM。

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

字段级错误文案：真实激活 / `check` 的 `error:` 行**直接是解析器消息本身**（多条以 `; ` 连接；`check` 没有 `invalid plugin.json:` 前缀），**安装**（400）才在外层包 `invalid plugin.json: `。消息逐字：`plugin.json must be an object`、`version must be a non-empty string`、`invalid kind: <v>`、`untrusted requires apiVersion 2`、`host must be a string`、`invalid host range: <v>`、`integrity must be an object`、`integrity.algorithm must be "sha256"`、`integrity.files must be an object`、`integrity.files["<path>"] must be a non-empty string`、`deprecated must be a non-empty string`、`standardVersion must be a positive integer`。（`check` 对目录包还有一个更早的短路：manifest 是对象但缺 `name` 时报 `plugin.json is missing "name"`，此时还没进解析器。）

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
- **同一次 `activate()` 返回的所有 handler 共享这一次激活的闭包**：actions 的 `handler`、tools 的 `handler`、observers 的 `onEvent` 与 events 的注册都是同一个 revision 的一部分；宿主按 revision 注册、按 revision 撤销，revision 被替换 / 停用 / 删除后旧闭包不再被调用。把状态放在 `activate()` 的局部变量里（如 `kitchen-sink` 的 `auditCount`）是正确的；模块级全局会在 revision 之间泄漏。
- 你打开的 timer / listener / watcher / socket **必须**经 `ctx.effect(dispose)` 释放（LIFO 执行）。否则替换 revision 后旧副作用继续跑。只是不想让 timer 撑住网关进程时，可以额外 `timer.unref()`——**`unref()` 不能代替 `ctx.effect`**，被替换的 revision 的 unref timer 仍然会跑。
- `ctx.emit` 在 `activate()` **返回之前发不出去**：事件只在 revision commit 时才进 registry，所以激活期间的 `ctx.emit` 会被丢弃并记诊断（首次激活是 `unloaded`「not active」，替换旧 revision 时是 `stale-emitter`），不会抛错。**在 commit 之后发**：在 `activate()` 里起 timer，回调触发时本 revision 已经生效（`hello-plugin` 就是这种写法）。
- `ctx.http` 只在 `activate()` 运行期间可用：激活返回后 recorder 被 seal，再注册抛 `ctx.http is only available during activate() (package "<name>")`。
- 激活失败 = **整包不生效**（错误留在 pending / failure 记录里，`check`、`plugins list`、Desktop 可见）；已提交的旧 revision 不会被失败的新候选替换。
- 零贡献会被拒绝：`no contributions (usage/media/runtime/tts/uiTools/ui/actions/events/tools/observers)`。`contributes.gateway.http: true` 本身不算贡献——只注册路由的包也过不了这一关。

`trusted` 包的 `ctx`（真实 gateway host 的全部能力；`mafw plugin check` 的 ctx 是它的子集，差异见 §8）：

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

以下片段都取自 `examples/plugins/`，**里面的包名/命名空间是示例的**：复制时把 `hello-plugin` / `kitchen-sink` / `plugin:<package>:*` 换成你自己的包名，否则事件命名空间与 `contributes` 的声明比对都会失败。

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
- `action "<name>" name is not allowed`（`__proto__` / `prototype` / `constructor`）
- `action "<name>" declaration must be an object`
- `action "<name>" handler must be a function`
- `action "<name>" has unknown field "<key>"`（只允许 `title` / `description` / `inputSchema` / `outputSchema` / `timeoutMs` / `handler`）
- `action "<name>" timeoutMs must be a positive integer`
- `action "<name>" timeoutMs exceeds the maximum of 60000ms`
- schema 问题：`action "<name>" inputSchema must be a JSON Schema object` / `… exceeds 262144 bytes` / `… remote $ref "…" is not allowed (…/$ref)` / `… $schema "…" is not supported; plugin schemas must use JSON Schema 2020-12 (…/$schema)`

上限：`timeoutMs` 缺省 **15000 ms**，硬顶 **60000 ms**；input / output payload 各 **262144 字节**（256 KiB）；input 在调用前按 `inputSchema` 校验，output 在返回后按 `outputSchema` 校验（失败是调用错误，不是激活错误）。超时报 `plugin action "<package>:<name>" exceeded <ms>ms`。

**handler 约定**：handler 可以是同步函数，也可以 `async`（返回值是 Promise 时宿主 await 它）；返回值必须 **JSON 可序列化**，否则调用错误 `output of plugin action "<package>:<name>" must be JSON-serializable`；`outputSchema` 在 handler 返回**之后**才校验，不匹配是调用错误 `invalid output from plugin action "<package>:<name>"`（`invalid-output`，502），不是激活错误。`call.signal` 是宿主给的 `AbortSignal`：超时（`timeout`，408）、调用方取消（`aborted`）、或本 revision 被替换 / 卸载（`stale-revision` / `unloaded`，均 409）时被 abort，handler 应尽快停下。

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

**发射信封只有 `{ type, properties?, sessionID? }`**：包决定的就是这三样，负载只能放 `properties`（并且必须写进 `schema` 才会被校验；旧的扁平写法 `ctx.emit({ type, ...payload })` 仍被兼容，新包不要用）。**`at` 不是信封字段**——宿主在把 canonical 事件交给 observer 时才盖自己的 `at`（epoch ms，见 §4.4）。想在广播里带时间戳，就自己放进 `properties`（如 `{ at: Date.now() }`）并声明在 `schema` 里。

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

**宿主不校验 `input`。** `inputSchema` 只是广告给 runtime / agent 的（`gateway/src/runtime/v2-live.ts` 把它作为工具的 `parameters` 注册），插件宿主的 tool registry 把调用方给的 `input` 原样传进 `handler`（`gateway/src/kernel-v2/tools.ts` 的 `invoke()` → `contribution.execute(input, …)`）：没有 schema 校验，也没有默认值。**别假设形状**——无参数调用时 `input` 可能是 `undefined` 或 `{}`；在 handler 里自己校验 / 归一化，非法输入自己返回错误（handler 抛出的异常会被宿主包成 `tool failed: <message>`）。

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

`filter` 的三个字段都可省略：**整个 `filter` 省略 = 匹配所有 canonical 事件**；给了 `types` 就只匹配其中列出的类型——精确名，或以 `*` 结尾的前缀（`part.*` 命中 `part.updated`、`part.delta`、`part.complete`）；`types` 必须是 1..32 个非空字符串（显式 `[]` 非法）。`sessionID` / `projectId` 是对应字段的精确匹配。

注意 `onEvent` 参数里的 `at: number` 是**宿主**构造 canonical 事件时盖的（`toCanonicalEvent` 的 `Date.now()`），与包自己的 `ctx.emit` 没有关系；包在 `properties` 里带不带 `at` 由你自己决定（§4.2）。

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

**observer 只接收 canonical 运行时事件**——由 runtime 事件翻译层产出的 canonical 名，如 `session.created`、`message.updated`、`part.updated`、`turn.started`、`turn.completed`、`permission.asked`、`task.updated`。这份清单只是举例，**权威列表**是 `packages/runtime-contract/src/vocabulary.ts` 的 `MAFW`（全集为 `MAFW_RUNTIME_EVENT_NAMES`）。`check` **不能**校验 canonical 名：本地 check host 没有 canonical vocabulary，`filter.types` 也只校验形状（1..32 个非空字符串），所以名字写错不会让 `check` 失败——observer 只是永远不触发。它在事件管线的 `canonicalObserverTap` 段被喂入（位于 `internalFilter` 之前、`finalBroadcast` 之前），看到的是与 conformance 相同的 pre-drop canonical 面；它**收不到**任何 `plugin:*` 事件——自己的、别人的都收不到。`plugin:*` 只走广播 / 自动化消费者。想观察自己的事件：用 `events` 广播 + 外部消费者（例如 SSE 客户端），不要在 observer 里等它。

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
  }): { status?: number; headers?: Record<string, string>; body?: string | Buffer | NodeJS.ReadableStream | AsyncIterable<Uint8Array> } | void,
  opts?: { maxBodyBytes?: number },
): void;

ctx.http.ws(path: string, handler(ws, ctx: { sessionID?: string; projectDir: string }): void): void;
```

可复制片段（`examples/plugins/kitchen-sink/index.js` 的 http 片段；返回值里补了一个最小 action，否则只注册路由会被零贡献检查拒绝。复制进你自己的包时，把 `ping` 加进 `contributes.gateway.actions`、并声明 `"http": true`）：

```js
module.exports = {
  name: 'kitchen-sink',
  async activate(ctx) {
    // (5) http — served at /api/plugins/kitchen-sink/api/ping. Routes can only
    // be registered while activate() runs; they are retired with this revision.
    ctx.http.route('GET', '/ping', () => ({ body: 'pong' }));

    return {
      // 一个真实贡献：只有 http 路由不算贡献（§3）。
      actions: {
        ping: { title: 'Ping', handler: () => ({ pong: true }) },
      },
    };
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
- `route path "<path>" must be '' or start with '/'` / `route path "<path>" must not contain ".."` / `route path "<path>" must not contain ":" (path params are not supported)` / `route path "<path>" must not contain a query or fragment` / `route path "<path>" contains an invalid character`
- `maxBodyBytes must be a positive integer`
- `duplicate http route <METHOD> <path> in package "<name>"` / `duplicate ws route <path> in package "<name>"`

上限：请求体默认 **32 MiB**（`33554432` 字节，`opts.maxBodyBytes` 可按路由改写该上限，正整数），超限 413 `request body too large`；handler 抛错 500 `plugin handler failed`；handler 返回 `undefined` body → **204**，返回字符串默认 `content-type: text/plain; charset=utf-8`；只支持精确路径匹配（无路径参数）。

**`body` 只能是字节或字节流**（`string` / `Buffer` / `NodeJS.ReadableStream` / `AsyncIterable<Uint8Array>`）——宿主**不做序列化**，也没有 JSON 编码器。要返回 JSON 就自己 `JSON.stringify(...)`（或 `Buffer.from(...)`）并显式给 `headers: { 'content-type': 'application/json' }`；只返回字符串且没写 content-type 时，宿主只会补 `text/plain; charset=utf-8`（`gateway/src/plugins/plugin-http.ts:572-573`）。

**只有显式的 `http: false` 会禁止路由**：此时任何一次 `ctx.http.route()` / `ctx.http.ws()` 都让激活失败（即使 `activate()` 正常返回）。**省略 `http` 键 = 该 plane 不受上界约束**（与 §6 一致，`check` 会打印 `http (unbounded)`）；**建议显式写 `http: true`**，让声明面在 `check` 的 inventory 里可见（安装同意看的是 `permissions`——要路由就同时声明 `http` 权限 token，两者不是一回事）。无论声明与否，`http` 本身都不算贡献：仍必须至少返回一个非 http 贡献，否则零贡献拒绝（§3）。

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
- 需要图标的字段（`panels[].rail.icon`、`webSurfaces[].icon`、`webSurfaces[].rail.icon`、`menuItems[].icon`、`composerActions[].icon`）只能取注册过的名字（`packages/plugin-contract/src/icons.ts` 的 14 个：`bubble-5`、`magnifying-glass`、`sticky-note`、`team-three`、`checklist`、`layout-grid`、`square-arrow-top-right`、`refresh`、`plus`、`file`、`folder`、`terminal`、`branch`、`globe`）；`panels[].icon` 是自由字符串（契约不做图标注册校验）。
- Web 页的 URL 由宿主投影为 `/api/plugins/<package>/ui/<entry>`；资产扩展名不在白名单内一律 404；入口缺失/逃逸让整包激活失败（`invalid web surfaces: web surface "<id>" entry "<entry>" does not resolve to a readable file under …`）。
- `viewAction` 返回的 `PluginView` 由契约的 `normalizePluginView` 归一化，上限是**256** 个 widget 节点、嵌套深度 **12**、任一文本字段 **64 KiB**、image data URL **2 MiB**、action input **256 KiB**；超限返回 `null`（不是截断），未知 widget 类型降级为 `text`。
- 例子：`examples/plugins/kitchen-sink/index.js` 的 `ui.panels`（面板）；Web surface 的完整写法见 `docs/guides/plugin-authoring.md` §6.5（`examples/plugins/` 里没有 web surface 参考包）。

---

## 6. 声明即上界

`contributes.gateway` 只约束一个方向：**registered ⊆ declared**。

- **plane 缺失 = 不设上界**（老包照常激活）；**显式 `[]` = 零上界**（一个也不许）。渲染与判断都必须区分这两者。
- **声明多于注册是合法的**：包可以按能力/配置/host 版本条件注册。`check` 只会打印 `note: declared but not registered: action "x", …`，**永不**因此失败。
- 被强制的是四个名字集合（`actions` / `events` / `tools` / `observers`）与一个布尔开关（`http`，**只有显式 `false` 生效**；缺省或 `true` 都不设上界）。`contributes.desktop` 不参与上界。
- 诊断顺序：先形状/身份校验；有形状错误时只报那些错误，修好之后才报越界（判决都是激活失败）。`http: false` 的检查在派生贡献构建之前，不受这个顺序影响。
- `contributes` 本身非法时：`apiVersion: 2` → 激活失败（`contributes: <detail>`）；`apiVersion: 1` → warning `legacy-contributes: <detail>`，块被丢弃且**不构成约束**（合法的 v1 块则和 v2 一样构成约束）。
- 每条越界消息都在 §4 逐字列出；四个声明式 plane 的消息以 `invalid contributions: ` 前缀出现在 `check` 的 `error:` 行，**`http` 那条是裸的**（§4.5，在派生贡献构建之前单独抛出）。

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

- **必须绝对路径**（相对路径直接拒绝：`path must be absolute: <path>`）。它在本进程内用**同一个判定函数**跑一次真实激活的 dry-run（`PluginHost.checkPackage`）：不起网关、不读 human token、不注册任何东西，网关停着也能用。但**它不是沙箱、也不是 §3 的 ctx**——见本节末尾「check 的 ctx 与真实 host 的差异」。
- 人读输出：首行 `ok <name> (<path>)` 或 `not ok …`，随后 `version:` / `apiVersion N, kind K` / `permissions:` / `contributions:` / `declared:` / `registered:` / `note: check is not a sandbox: …`（每次运行都打印，见下）/ `note: declared but not registered: …`（合法）/ `warning: …` / `error: …`，最后在判决通过时打印 `install: <可粘贴命令>`。`ok: false` 时同样打印 `apiVersion` / `kind` / `permissions`（结果里没有时回退读 `plugin.json`，读不到就不打印）；`contributions` 只有激活确实产出了贡献才有。
- `--json`：**一行**可解析 JSON。`ok` 是**命令判决**（不是原始 check 结果），另有 `verdict`（`"ok"` / `"fail"`）、`strictFailed`，以及 `name` / `version` / `contributions` / `apiVersion` / `kind` / `permissions` / `declared` / `registered` / `warnings` / `error` / `webSurfaces`（存在时）。退出码 `0` = 通过，`1` = 不通过。
- `declared` 缺失 = 没有可用的 `contributes.gateway`（未声明，或 manifest 解析失败——后者同时给出 `error:`）；`declared.actions` 缺失 = 该 plane 无上界；`"actions": []` 会原样出现（零上界）。`registered` 永远存在，且是**尝试注册**的内容——失败时也能看到差集。两行的 `http` 用同一套写法：`declared` 是布尔开关（`http true` / `http false` / 缺省 `http (unbounded)`），`registered` 是路由计数（`http 0 route(s)` / `http 2 route(s)`）。
- `--strict` 只把 **manifest warning** 变成失败（`not ok: --strict turned the manifest warnings above into failures`）。warning 来自 `plugin.json` 归一化：`legacy-permissions`（apiVersion 2 未声明 `permissions`）、`legacy-contributes: …`（apiVersion 1 的非法 `contributes` 块）。**`--strict` 不会因「声明了没注册」失败**。
- `check` 也接受单文件包路径（`…/foo.js`），但单文件包不能有 tools/observers/http（§7）。
- 失败时 `next:` 行按错误给出下一步：`is not declared in …` → 把名字补进 `contributes.gateway`；`permission denied`（只可能来自 `untrusted` worker）→ 补 `permissions`；其余 → 先修错误再按提示重跑 check。

**`ok: true` 覆盖哪些判定**（别把它读成「包一定对」）：

1. `plugin.json` 解析成功并归一化：字段形状、`apiVersion`、`host` 范围、`permissions` token；
2. 模块身份：`main` 文件存在、`require` 成功、导出 `name` 存在且与 manifest 一致；
3. 一次真实 `activate()` dry-run：贡献形状与跨包引用、零贡献、web surface 落盘、`http: false` 越界；
4. 四个声明式 plane 的 registered ⊆ declared（§6）；
5. `--strict` 时 manifest warning 变成失败。

**`ok` 不覆盖什么**：`permissions` 与注册面之间**没有任何交叉校验**——`trusted` 包声明 `permissions: ["events"]` 却注册 action，`check` 仍然 `ok`。`permissions` 与 `--permission` 的一致性只在 install 时检查（§9）；token 只在 `untrusted` worker 里当运行时开关（§7）。

示例（`--json --strict`，一个 apiVersion 2 但未声明 `permissions` 的包）：

```json
{"ok":false,"name":"v2noperm","version":"0.0.1","contributions":["actions"],"apiVersion":2,"registered":{"actions":["ping"],"events":[],"tools":[],"observers":[],"http":0},"warnings":["legacy-permissions"],"verdict":"fail","strictFailed":true}
```

`mafw plugin schema` 打印同一份契约的人类可读形式（带缩进的 JSON，无外层信封）；编辑器/agent 拿它当字段真源，比任何文档都准。

**check 的 ctx 与真实 host 的差异**：本地 check host 给的是 §3 能力的一个子集，**不是沙箱**。

真实可用（`gateway/src/cli/plugin-check-local.ts` 只注入 `projectDir` / `gatewayPort` / registration bag，其余能力由 `createPluginPackageContext` 的默认实现提供）：

- `ctx.log`；`ctx.fetch`（真实网络，默认 60 s 超时）；
- `ctx.files.list/stat/read`（真实文件系统，只读，作用域按传入的 `projectDir`）；
- `ctx.effect(dispose)`（挂到本次 candidate 的 bag；`check` 结束时会随 candidate 一起 dispose，回调真的会跑）；
- `ctx.http.route/ws`（写进本次 candidate 的 recorder；`check` 结束后丢弃，路由**从未被服务**——`registered` 里的 `http <n> route(s)` 就来自这里）；
- `ctx.emit`（走本进程的事件注册表；`check` 没有已提交的 revision，事件被丢弃并记诊断，不抛错）；
- `ctx.pluginConfig()`（读当前 CLI 进程的 config，通常为空）；
- `ctx.projectDir`（= check 进程的 cwd）、`ctx.gatewayPort`（占位 `3000`）；
- `ctx.usage`（空统计，`modelStats()` 返回 `[]`）；`ctx.apiKey()` 返回 `null`。

缺失或直接拒绝：

- `ctx.config.update()` 抛 `ctx.config.update is not available in this host`；
- `ctx.terminal.create/bridge/resize` 抛 `ctx.terminal is not available: this host did not provide a terminal service`（`kill` 对未拥有的 id 静默返回）。

**check 不是沙箱**：`activate()` 真的执行了，`fetch` / `files` / timer / listener / watcher 等副作用已经发生（`ctx.effect` 只保证在 check 收尾时清理，不保证「没有发生」）；`ctx.http` 注册的路由也不会被服务。别把「check 通过」当成隔离证明。

### 验证行为（安装后）

`check` 只证明包能激活；真正的行为要装上之后自己验（本机 loopback 直连网关，不需要 token）：

```bash
# 调 action（body 可省略；返回 { package, action, revision, output }）
curl -s -X POST http://127.0.0.1:3000/api/plugins/hello-plugin/actions/now \
  -H 'content-type: application/json' -d '{"input":{}}'

# 看事件（SSE）：每帧 data: <JSON>，顶层 type 就是 plugin:<package>:<event>
curl -N http://127.0.0.1:3000/api/events
```

事件帧形如 `{"type":"plugin:hello-plugin:tick","properties":{"at":…},"timestamp":…}`。action 失败时响应是 `{ error, code }`：`unknown-action`（404）/ `invalid-input`（400）/ `timeout`（408）/ `aborted`（409）/ `invalid-output`（502）等。

---

## 9. 安装：由人执行

**安装是人类的动作，不是 agent 的动作。** 服务端安装路由只接受 human principal（human token 或 device token）；service / API token 会得到 `403 human principal required`（`human_principal_required`）。

`apiVersion: 2`（推荐形态）——`--trust` 必须等于 `plugin.json` 的 `kind`，`--permission` 必须**逐项列全**且与 `permissions` 集合完全一致：

```bash
mafw plugins install "C:/abs/path/to/my-plugin" \
  --trust trusted \
  --permission actions --permission events
```

（上面为了可读性折行；`check` / `init` 打印的 `install:` 是**单行**，整行原样粘贴即可。）

`apiVersion: 1`（legacy）——不要求同意参数；`--trust` / `--permission` 会被 CLI 接受但**被忽略**（v1 的 consent 检查直接放行），写上既不生效也不报错：

```bash
mafw plugins install "C:/abs/path/to/my-plugin"
```

规则：

- （v2）集合必须**完全一致**（顺序无关，重复的 `--permission` 无意义）；不一致或缺 `--trust` → `400` `permission consent required: <按字母排序的声明集合>`（code `permission_consent_required`）。
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
| `host` | 这个包要求**哪个产品版本范围**的网关？ | `*`，或空格分隔的比较器，如 `>=5.1.0 <6.0.0`；**省略该字段**表示不限制 | 不满足 → `host range <range> does not include <version>`，该包不激活；显式空串 `""` 也是非法值 → `invalid host range: ` |
| `standardVersion` | 写这个包时对照的是**哪一版规范文本**（本文 = `1`） | 正整数（≥1）；**可省略**（省略 = 未声明） | 非正整数 → `standardVersion must be a positive integer` |

`host` 语法细节（逐字对照解析器）：

- `*` = 任意版本；**省略该字段** = 任意版本。**不要写空串**：`host: ""` 会被解析器拒绝（`invalid host range: `），省略才是「不限制」。
- 比较器：`>=`、`<=`、`>`、`<`、`=`（缺省 `=`），紧跟 `x.y.z`（可带 `-`/`+` 后缀），多个比较器用空白分隔、全部满足才算兼容。
- 操作符与版本之间**不能有空格**：`>= 5.1.0` 会被拆成两个 token 而判为非法（`invalid host range: >= 5.1.0`）。
- 参与比较的宿主版本取 `MAFW_HOST_VERSION`，无该环境变量时回退 `5.1.0`。

`apiVersion` 的语义差别：

- `1`：`kind` / `permissions` 只是信息；`contributes` 形状非法只 warning 并丢弃（合法块仍然构成上界）。
- `2`：安装必须显式 `--trust` + 逐项 `--permission`；`contributes` 形状非法是硬错误；`untrusted` 只能出现在这里。
- 未来代际：解析器只接受 `1` / `2`，更大整数按 `unsupported apiVersion` 处理（不会静默降级成 1）。

`standardVersion` 目前**不被宿主用来放行或拒绝任何东西**——它只是作者声明「我按标准 v1 写的」，供人/工具判断。它是**可选的**：省略没有任何后果（`check` / 安装 / 激活都不会因此变化），要写就写 `1`，但别指望它触发任何兼容行为；本文的最小示例与两个参考包都省略它。
