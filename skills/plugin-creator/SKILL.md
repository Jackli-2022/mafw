---
name: plugin-creator
description: Create and iterate MAFW unified plugin packages (plugin.json + index.js with declarative panel/config page/tool card/message window) inside <project>/.mafw/plugin-drafts/, then check, test, install and verify them in the real Desktop. Use when the user asks to build, modify, or debug a MAFW plugin, its panel/config page/tool card/message window, its actions or its plugin:<name>:* events.
argument-hint: "[packageName] [requirement]"
metadata:
  author: mafw
  version: "1.0.0"
---

# Plugin Creator（统一插件包）

本技能是**唯一**的详细教程来源：包布局、四个 UI slot、Widget/action/event 限制、模板、
工作顺序、审批语义、验证与恢复都写在这里。Creator 身份的系统提示只有铁律，不复制细节——
两者冲突时以本技能为准。

## 0. 铁律（先读）

1. **先 inspect，再生成。** `mafw_plugin_inspect` 返回真实宿主契约；不要凭记忆猜 slot、
   widget 字段或 schema 关键字。
2. **草稿只在项目内。** 源目录固定为 `<project>/.mafw/plugin-drafts/<packageName>/`，
   会话 cwd 不变；不要写 `~/.mafw/plugins`（那是安装副本），也不要用 `..` 或符号链接逃出草稿根。
3. **变更只经工具。** `check` / `test` / `install` / `enable` / `disable` / `remove` / `reload`
   只能通过 `mafw_plugin_manager`；不要用 shell、HTTP 或手写目录绕过审批。
4. **`applyPending` 是用户动作。** 模型工具没有它；active runtime 包的新 revision 只进
   pending，你必须请求用户在 Plugins 页点「应用」。
5. **状态词不混称**：`saved`（草稿已保存）/ `tested`（测试通过）/ `installed`（已安装副本）/
   `active`（已生效 revision）/ `pending`（等待用户应用）。
6. **包代码是本机受信代码。** 安装 = 在 gateway 进程里执行 `index.js`；`check`/`test` 不是沙箱，
   只处理你信任的草稿。
7. **看不见渲染结果。** 没有截图或 renderer 回传通道；视觉正确性以用户反馈为准。

## 1. 工作顺序（不要跳步）

```text
1. inspect        mafw_plugin_inspect（slots / widgetSchema / package / clientDescriptors / actions / events）
2. 最小实现        <project>/.mafw/plugin-drafts/<packageName>/plugin.json + index.js
3. 测试先行        index.test.js（node --test，零依赖、fake ctx）
4. check          mafw_plugin_manager.check({ draft })        ← 逐次代码执行审批
5. test           mafw_plugin_manager.test({ draft })         ← 逐次代码执行审批
6. 展示 + 安装     mafw_plugin_manager.install({ draft, overwrite?, requestId })
7. 真实 UI 验证    用户看 panel/config/toolCard/messageWindow；有问题回到第 2 步
8. 迭代           改草稿 → 新的 requestId 重新 install（不要复用旧 id）
```

先写最小可运行包（一个 panel + 一个 action），再加 config/toolCard/messageWindow。
一次 `activate()` 返回的全部贡献共享同一个 candidate、RegistrationBag 与 revision。

## 2. 包布局

```text
<project>/.mafw/plugin-drafts/<packageName>/
  plugin.json      # 元数据（唯一 manifest）
  index.js         # 入口（默认 main = index.js）
  index.test.js    # 零依赖自测（node --test）
  lib/…            # 可选：包内 Host 模块，只在 gateway 执行
```

```json
{ "name": "acme", "version": "1.0.0", "main": "index.js" }
```

- `plugin.json` 只承载元数据；**没有单独的 UI manifest**——UI 从 `activate()` 返回值来。
- `manifest.name`、`module.exports.name`、草稿目录名三者必须完全一致。
- 包名必须是单个路径段：`^[A-Za-z0-9][A-Za-z0-9._-]*$`，不能含 `:`、空格或 `..`。
- `main` 必须在包目录内。

## 3. 最小可运行模板

```js
'use strict';

module.exports = {
  name: 'acme',
  async activate(ctx) {
    let count = 0;
    const view = () => ({
      title: 'Acme',
      body: [
        { type: 'text', text: `count=${count}` },
        { type: 'action', label: 'Increment', action: 'bump' },
      ],
    });
    return {
      events: [{
        type: 'plugin:acme:changed',
        title: 'Acme changed',
        scope: 'global',
        schema: {
          type: 'object',
          properties: { count: { type: 'integer' } },
          required: ['count'],
          additionalProperties: false,
        },
      }],
      actions: {
        // viewAction：只读渲染，绝不能发射 refreshOn 中的事件
        refresh: {
          title: 'Refresh',
          inputSchema: { type: 'object', properties: {}, additionalProperties: false },
          handler() { return view(); },
        },
        // 用户动作：发射事件的安全位置
        bump: {
          title: 'Increment',
          inputSchema: { type: 'object', properties: {}, additionalProperties: false },
          handler() {
            count += 1;
            ctx.emit({ type: 'plugin:acme:changed', properties: { count } });
            return { count };
          },
        },
      },
      ui: {
        panels: [{
          id: 'main',
          title: 'Acme',
          viewAction: 'refresh',
          refreshOn: ['plugin:acme:changed'],
        }],
      },
    };
  },
};
```

> **反馈环警告**：panel 的 `viewAction` 不得发射它的 `refreshOn` 事件；
> messageWindow 的 `viewAction` 不得发射它的 `triggerEvent`。Desktop 收到匹配事件会重取视图，
> 取视图又发同一事件就是无限重载。通知事件由用户 action、config 保存等非 viewAction 位置发射。

## 4. `ctx`（Host 能力）

| 字段 | 说明 |
|---|---|
| `ctx.log` | gateway logger（`info` / `warn` / `error`） |
| `ctx.fetch(url, opts?)` | 默认 60s 超时；网络错误自行处理 |
| `ctx.apiKey(provider)` | 读 opencode `auth.json` 的 provider key；没有返回 `null` |
| `ctx.pluginConfig()` | 现读 `plugins.<package>.config`，缺省 `{}` |
| `ctx.config.update(patch)` | 浅合并写入本包命名空间，原子落盘 |
| `ctx.projectDir` / `ctx.gatewayPort` | 项目目录 / gateway 端口 |
| `ctx.usage.modelStats({sinceMs?, provider?})` | 本地 trajectory 分模型统计 |
| `ctx.emit(event)` | 只发本包已注册的 `plugin:<package>:*` 事件 |
| `ctx.effect(dispose)` | 登记副作用清理（timer/listener/watcher 的唯一受支持清理路径） |

- 有副作用就必须 `ctx.effect(() => clearInterval(timer))`；不要在模块顶层创建长生命周期资源。
- 清理在 reload/replace/disable/delete/check 释放时执行，同包多 effect 逆序（LIFO），单个清理抛错
  只记 diagnostic。
- `ctx.config.update` 只写 `plugins.<package>.config`；补丁必须是可 JSON 序列化的纯对象，
  不能有 `__proto__` / `prototype` / `constructor`。

## 5. 事件

```ts
type PluginEventDeclaration = {
  type: `plugin:${string}`   // 必须 plugin:<package>:<event>
  title?: string
  description?: string
  schema?: JsonSchema        // 校验 properties；2020-12，禁远程 $ref
  scope?: 'global' | 'session'  // 缺省 global
}
```

- 只能注册/发射本包命名空间；canonical 名（`turn.completed` 等）、别包命名空间、空名都被拒。
- `schema` 存在时广播前校验 `properties`；失败丢弃并记 contract diagnostic，不进 `event_log`。
- `scope:'session'` 需要显式 `sessionID` 或 `properties.sessionID`，缺失丢弃。
- 只有已提交 revision 能发射；包被禁用/删除/替换后迟到的 emit 是 no-op。
- `properties` 序列化后 ≤ 256 KiB。
- 不要用 `POST /api/events` 绕过注册。

## 6. Action

```js
actions: {
  saveConfig: {
    title: 'Save settings',
    inputSchema: { /* JSON Schema 2020-12 */ },
    outputSchema: { /* 可选 */ },
    timeoutMs: 5000,           // 缺省 15_000，上限 60_000
    handler(input, call) {
      // call.sessionID?: 触发调用的会话
      // call.signal:    取消/卸载/超时会 abort
      return { saved: true };
    },
  },
}
```

- 调用前校验 input（缺省 `{}`），返回后校验 output；两者各 ≤ 256 KiB。
- 每次调用有 AbortSignal 与超时；包卸载或 revision 替换会 abort 在途调用。
- action 结果带 revision 代际：旧 revision 不能给新 revision 的界面作答。
- 跨包 action 引用在 candidate 校验阶段就失败。
- action 不是 shell/API 转发器；特权操作仍受审批与信任模型约束。

中性错误码：`unknown-package`/`unknown-action`（404）、`invalid-input`/`payload-too-large`（400）、
`invalid-output`/`handler-error`（502）、`timeout`（408）、`aborted`/`unloaded`/`stale-revision`（409）。

## 7. 四个 UI slot（未知 slot 直接失败）

### 7.1 panels

```js
ui: { panels: [{
  id: 'overview', title: 'Service Monitor', icon: 'activity', order: 40,
  viewAction: 'refresh', refreshOn: ['plugin:acme:changed'],
}]}
```

- panel = 右工作台「工作台」里的动态 L2 tab，客户端全局 key 为 `<package>:<id>`。
- 按 `order`、title、包名稳定排序；删除当前 surface 回退到内置 `code`。
- 挂载时调用 `viewAction` 取 `PluginView`；`refreshOn` 命中后重取。
- `refreshOn` / `viewAction` 必须在同包内可解析。

### 7.2 configPages

```js
ui: { configPages: [{
  id: 'settings', title: 'Acme settings',
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
  loadAction: 'loadConfig', saveAction: 'saveConfig', reloadOnSave: false,
}]}
```

- Desktop 从**受限 JSON Schema 子集**生成表单；load/save 只走声明的 action。
- 根必须 `type:"object"`；`properties` 值只能是 `string`/`number`/`integer`/`boolean`。
- 字段允许：`type`/`title`/`description`/`default`/`enum`/`minimum`/`maximum`/`minLength`/
  `maxLength`/`pattern`/`multipleOf`/`examples`。
- 不支持：嵌套 object/array、`$ref`、远程 schema、`format`/secret 字段、secret 回显。
- 保存默认不重载包；`reloadOnSave:true` 时成功后走同一 candidate/reload 流程（仍受 pending 规则约束）。

### 7.3 toolCards

```js
ui: { toolCards: [{
  id: 'acme-tool', tools: ['bash', 'shell'], override: true, viewAction: 'toolCard',
}]}
```

- Desktop 把中性 ToolCardModel（`tool`/`canonicalTool`/`input`/`output`/`metadata`/`status`/`error`/`truncated`）
  作为 action input 发给 gateway；`status:'error'` 时 `error` 是归一化文本。
- running 阶段保持默认卡，completed/error 才请求插件视图（避免流式 O(n²)）。
- `bash`/`read`/`grep` 等常用工具**已有内置卡**，想替换必须 `override:true`；否则真实 Desktop 永不渲染。
- alias 组是全有或全无：`bash` 展开为 `bash`+`mafw_bash`+`shell`+`mafw_shell`；组内任一 key 被占用
  且没 override，整组跳过。
- 插件视图不可用/action 失败/revision 过期时回退原卡，并在原卡上方显示 error 文本。

### 7.4 messageWindows

```js
ui: { messageWindows: [{
  id: 'status-change', title: 'Status changed',
  triggerEvent: 'plugin:acme:changed', viewAction: 'messageView',
  modal: false, dismissible: true,
}]}
```

- `triggerEvent` 必须引用本包已注册事件；到达时在 MAFW 主窗口开 `<package>:<id>` 单例小窗，
  同 id 后续事件只刷新、不堆窗。
- `viewAction` 的 input 是**规范嵌套形状**（不要平铺 payload）：

  ```ts
  { event: { type: string, properties: object }, sessionID?: string }
  ```

  对应 `inputSchema` 要声明 `event.type` + `event.properties`（`properties: { type: 'object' }`），
  `additionalProperties: true`。
- `modal:false` = 不阻断、不抢焦点；`modal:true` = 居中模态并管理焦点。
- 小窗里按钮仍是 action widget；要让 action 开小窗，就在 action 里发射相应注册事件。
- `viewAction` 不得发射 `triggerEvent`。
- `ui` 中所有 `viewAction`/`loadAction`/`saveAction`/`triggerEvent`/`refreshOn` 都必须在同包内有定义，
  否则整个 candidate 校验失败。

## 8. View 与 Widget 限制

`viewAction` 返回：

```ts
type PluginView = { title?: string; subtitle?: string; icon?: string; body: Widget[] }
```

| type | 必要字段 | 说明 |
|---|---|---|
| `text` | `text` | 纯文本 |
| `code` | `text`，可选 `language` | 代码块，不着色执行 |
| `kv` | `rows: [label, value][]` | 键值表 |
| `tags` | `items: string[]` | 标签组 |
| `list` | `items: (string \| Widget)[]` | 列表 |
| `row` | `children: Widget[]` | 横向布局 |
| `image` | `dataUrl`（`data:image/...`） | ≤ 2 MiB data URL |
| `link` | `text`、`href` | 走 Desktop browser-policy |
| `markdown` | `text` | 先转义原始 HTML |
| `progress` | `value`（0–100），可选 `label` | 进度条 |
| `action` | `label`、`action`，可选 `input`/`style` | 按钮，回调本包 action |

`PLUGIN_UI_LIMITS`（gateway / SDK / Desktop 共用同一组数字）：

| 限制 | 值 |
|---|---|
| Widget 节点数（单视图） | 256 |
| 嵌套深度（body 根 widget = 1） | 12 |
| 单段文本 UTF-8 | 64 KiB |
| image data URL | 2 MiB |
| tool-card payload | 256 KiB |
| action / event payload | 256 KiB |
| action 超时 | 默认 15s，上限 60s |

- 未知 widget 类型降级成 `text`，不会变成可执行标记；超限/畸形视图返回 `null`，
  Host/Desktop 不清空最后一次可用视图。
- ActionWidget 语义：返回合法 `PluginView` → 直接替换当前视图；返回普通 JSON/`undefined` →
  显示结果摘要并重取当前 `viewAction`；失败显示中性错误。返回值不会被当作脚本执行。

## 9. 测试先行

```js
// index.test.js —— 零依赖，fake ctx
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const plugin = require('./index.js');

test('activates with one panel and one event', async () => {
  const emitted = [];
  const out = await plugin.activate({
    log: console,
    pluginConfig: () => ({}),
    config: { update: () => {} },
    emit: (e) => emitted.push(e),
    effect: () => {},
    projectDir: process.cwd(),
    gatewayPort: 3000,
    usage: { modelStats: () => [] },
    fetch: async () => ({ ok: true }),
    apiKey: () => null,
  });
  assert.equal(plugin.name, 'acme');
  assert.equal(out.ui.panels.length, 1);
  const view = await out.actions.refresh.handler({});
  assert.ok(Array.isArray(view.body));
  await out.actions.bump.handler({});
  assert.equal(emitted[0].type, 'plugin:acme:changed');
});
```

- 测试用 `node --test`（`mafw_plugin_manager.test` 固定跑 `<draft>/*.test.js`，cwd=草稿，
  60s 超时，清洗环境变量，输出有字节帽）；**不执行 package scripts**，不支持自定义测试命令。
- 覆盖每个 slot、每个 action 的 input/output、每次 emit 的事件名与 schema，以及 widget 可序列化
  （视图里不能有函数）。
- 零依赖：不要装包、不要原生模块、不要构建步骤。
- 测试通过只说明候选契约与测试通过，不等于隔离安全，也不等于已安装。

## 10. 审批、fingerprint 与 requestId

- `check`/`test`/`install`/`enable`/`disable`/`remove`/`reload` 都是**逐次**原生审批
  （`permission: mafw_plugin_manager`，`always: []`——单次批准不会沉淀规则、不提升会话权限）。
- `full-access` 会话按既有策略直接执行；`auto`/`read-only` 仍强制人工确认；审批通道不可用 → 失败关闭。
- 拒绝或取消 → 不执行、不触达安装目录，不要重试到通过为止；把结果告诉用户。
- install/overwrite 的审批 pattern 含包名、草稿名、overwrite 与内容 fingerprint；执行前重新计算
  fingerprint，内容在审批期间变化 → 拒绝并要求重新审批（所以不要在 `ask` 期间改文件）。
- `requestId` 表示**一次真实操作意图**：网络重试沿用一个随机 id，新迭代必须用新 id。
  不要用 `(operation, draft, overwrite)` 的确定性哈希代替，否则会重放旧安装结果。
- 读操作（`list`/`status`/`descriptor`/inspect）不审批；但它们也不执行包方法。
- `applyPending` 不暴露给模型：工具返回 `nextStep` 时，请用户在 Plugins 页执行。

## 11. 验证与状态

- `check` 成功 = candidate 能激活；`test` 通过 = 包自测通过。两者都不安装、不发布 revision。
- `install` 成功 → 旧 revision 被新 revision 替换（首次安装则为第一个 active）。
- `install` 输出里的 `activeRevision` / `pendingRevision` 是唯一权威；不要自己推断。
- 若变更包拥有当前 active runtime：整包进 pending，旧 revision 继续服务；
  必须请用户点「应用」，不要声称已生效。
- UI 验证只能靠用户在真实 Desktop 里看 panel/config/toolCard/messageWindow；
  失败时读 descriptor 与 Host diagnostic 定位，不要假装看见了渲染。
- 状态词只按实际观察使用：draft 保存 ≠ tested；tested ≠ installed；installed ≠ active（pending 时）。

## 12. 恢复

| 情况 | 处理 |
|---|---|
| candidate 激活失败 | 旧 active revision 继续可用；读 diagnostic 修草稿后重新 check |
| 首次安装失败 | 没有 active 残留；修草稿，用新 requestId 重装 |
| 审批被拒/取消 | 什么都没发生；说明原因，等用户决定 |
| 内容在审批期间变化 | 报 `draft changed during approval`；停止改文件后重新审批 |
| 包显示 pending | active runtime 被占用；请用户在 Plugins 页「应用」 |
| 用户 disable/remove | 草稿保留；不要自动重新启用，除非用户明确要求 |
| 草稿与安装副本不一致 | 永远从草稿重建：改草稿 → check/test → install（overwrite） |
| 事件发了 Desktop 没反应 | 检查是否注册、schema 是否匹配、session 事件是否缺 sessionID、包是否被禁用/替换 |
| 旧界面不更新 | watcher 可能未触发 → `reload`；检查是否命中 active-runtime pending |
| 不知当前真实契约 | 重新 `mafw_plugin_inspect`，不要凭记忆猜 |

## 13. 常见失败

| 现象 | 原因 / 处理 |
|---|---|
| `name mismatch: exports 'x', package 'y'` | manifest name、模块 name、目录名不一致 |
| `missing name` | 模块没导出 `name` |
| `no contributions` | `activate()` 返回空对象；至少要有 ui/actions/events 或 legacy 贡献之一 |
| `unknown action reference` | slot 引用了不存在的 action |
| `event type "…" must use the plugin:<package>:<namespace>` | 事件名不在本包命名空间 |
| `timeoutMs exceeds the maximum` | 超过 60_000 |
| action 返回 502 `invalid-output` | `outputSchema` 与实际返回不一致 |
| config 页不渲染某字段 | 用了嵌套 object/array、`format`、secret 或未知关键字 |
| `invalid draft` | 草稿名含 `..`/分隔符/绝对路径，或 realpath 逃出草稿根 |
| `plugin.json name must equal draft directory` | 草稿目录名与 manifest name 不一致 |
| `source must not be the installed package or inside it` | 直接覆盖 `~/.mafw/plugins/<name>`；改草稿再安装 |
| `native approval unavailable` | 运行时没有原生审批通道；不要用 MCP question 冒充 |

## 14. 记忆

长期记忆只记**指针**：草稿路径 + 一句话 gist（做了什么、装到哪、还差什么）。
包内容以文件为真相源，不要把 `index.js` 或 schema 全文写进记忆。
