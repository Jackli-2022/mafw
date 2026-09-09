# UI 工具卡用户插件系统（ui-plugins）设计

- 日期：2026-09-09
- 状态：已批准（设计），待实现计划
- 目标：让开发者用户在不重新编译桌面的前提下，用 CJS 插件自定义桌面 ChatView 中工具执行卡的渲染。

## 背景与约束

桌面 ChatView 的工具卡渲染有两级：session-ui 内置卡（bash/read 等）+ 编译期注册的 MafwToolCards（`desktop/src/renderer/mafw/components/MafwToolCards.tsx`，经 `ToolRegistry.register`）。用户无法在运行时新增/覆盖。

关键约束：renderer 是 Electron sandbox（`windows.ts:197-201`，`contextIsolation: true, nodeIntegration: false, sandbox: true`），用户插件代码**不能**在 renderer 执行；renderer 与外界唯一通道是 preload 的 `window.api`。

## 架构（方案 A：main 执行插件 → 声明式 Widget 树 → renderer 解释渲染）

```
~/.mafw/ui-plugins/<name>.js (CJS, 本机可信代码)
  └─ main 进程 require（启动扫描 + fs.watch 热重载）
       └─ render(ctx)（completed/error 时按请求执行，返回纯 JSON Widget 树）
            └─ IPC → renderer WidgetInterpreter（Solid，内置词汇表解释器）
                 └─ 渲染进 BasicTool 折叠卡外壳
```

渲染时机：**pending/running 走默认链（零延迟），completed/error 才请求用户卡**——bash 类工具 output 流式增长，若每次 delta 都跑插件 + IPC 传树是 O(n²) 传输；完成态渲染一次即可。

信任模型：插件 = 本机可信代码（同 gateway `~/.mafw/media-plugins/`、`~/.mafw/usage-plugins/` 惯例），跑在 main 进程有 Node 全能力。

## 1. 插件契约

`~/.mafw/ui-plugins/<name>.js`，CJS `module.exports`：

```js
module.exports = {
  name: "my-cards",                    // 必填，插件唯一标识
  tools: {
    my_custom_tool: {                  // key = opencode 工具名
      icon: "terminal",                // 可选；title/subtitle 静态快捷
      render(ctx) {                    // ctx = { tool, input, output, metadata, status, json(), pretty() }
        const d = ctx.json(ctx.output)
        return {
          title: "My Tool",            // 卡头标题（默认 tool 名去前缀）
          subtitle: d?.summary,        // 卡头副标题
          defaultOpen: false,
          body: [ /* Widget 树，见 §2 */ ],
        }
      },
    },
    bash: { override: true, render(ctx) { /* 覆盖已注册卡必须显式 override: true */ } },
  },
}
```

- `ctx.json(str)`：宽容 JSON 解析（失败返回 null）；`ctx.pretty(obj)`：格式化字符串。
- `render` 返回非法（缺 body 且缺 title）视为失败 → fail-open。

## 2. Widget 词汇表（v1 固定 8 种）

| type | 字段 | 对应现有卡元素 |
|---|---|---|
| `text` | `text` | 单行/段落文本 |
| `code` | `text, language?` | `<pre>` 代码块（stdout/json/traceback） |
| `kv` | `rows: [[label, value], ...]` | MafwAddMemoryCard 的 meta-grid |
| `tags` | `items: string[]` | chips（anchors/severity） |
| `list` | `items: (string \| Widget)[]` | 检索结果行 |
| `row` | `children: Widget[]` | 水平排布 |
| `image` | `dataUrl` | 点击放大（对齐 PythonCard 图片） |
| `link` | `text, href` | 外链 |

非法 type → 降级为 `text`（序列化其输入）。

## 3. 优先级与 override（renderer 本地判定）

`window.api.mafw.uiPlugins.list()` 返回 `[{ tool, override }]`。renderer 渲染 tool part 时：

1. 工具在用户插件清单 &&（该工具无注册卡 || 插件声明 `override: true`）→ completed/error 后走用户卡
2. 否则原链：`ToolRegistry.render(tool)`（MafwToolCards → session-ui 内置）→ 默认卡
3. 用户卡渲染失败（main 返回 `{ok:false}`）→ fail-open 回退原链 + warn once

即：默认只补空白，内置卡与 MafwToolCards 需显式 override 才被覆盖（用户已确认此语义）。

## 4. 加载与热重载（main 进程，新文件 `desktop/src/main/ui-plugins.ts`）

- 启动扫描 `~/.mafw/ui-plugins/*.js`：require → 校验（name 非空且唯一、tools 为对象、每项 render 为函数或纯静态字段）→ fail-open（坏文件跳过、状态记 error、warn once）
- `fs.watch` 目录：变更 → 清对应 require.cache → 重载 → 经 IPC 广播 `ui-plugins-changed` → renderer 重新 `list()` 并清渲染缓存；重载失败保留旧版本
- 目录不存在 → 空清单，不报错

## 5. IPC 通道

- main：`src/main/ipc.ts` 注册 `ui-plugins:list` / `ui-plugins:render` handler + `ui-plugins-changed` 广播
- preload：`window.api.mafw.uiPlugins = { list(), render(req), onChange(cb) }`（req = `{tool, input, output, metadata, status}`；res = `{ok, card?: {title?, subtitle?, icon?, defaultOpen?, body: Widget[]}}`）
- renderer 只经 `window.api` 访问（desktop AGENTS.md 分层约定）；拦截点在 tool part 渲染入口，包一个 `withUserCard()` 分支

## 6. 错误处理汇总

- require 失败/校验失败 → 跳过 + 状态 error + warn once
- `render` 抛错或返回非法 → main 返回 `{ok:false, reason}` → renderer fail-open 回退原链
- Widget 非法 type → 降级 text
- 热重载失败 → 保留旧版本插件
- 渲染超时不做：render 是 main 内同步纯函数，抛错已覆盖

## 7. 测试策略

- main 侧 loader 单测（desktop 包，bun test）：扫描/校验/坏插件 fail-open/热重载（cache 清除 + 重载）/override 清单生成
- Widget 校验纯函数单测：非法 type 降级、非法树结构拒绝
- renderer 拦截逻辑单测：优先级三态（无注册卡 / 有注册卡无 override / override）
- 手动验证：示例插件给 `mafw_search_hybrid` 做替代卡 + `override: true` 覆盖一个内置卡
- 回归门槛：desktop 包现有测试与 typecheck（`bun typecheck`）保持绿

## v1 明确不做（YAGI，之后要做）

①桌面 Config 页插件管理卡（列表/状态/手动重载）；②插件间依赖；③流式渲染（running 期间增量更新用户卡）；④Widget 词汇表扩展机制。已记录备忘（#mem-fqqfdw）。
