# 插件中心全量清单（builtin inventory）设计

日期：2026-09-15
状态：已批准（用户确认三问：media/runtime 卡全部并入 hub；usage 内置件只读+克隆；example 停生成+删存量）

## 1. 背景与问题

插件中心（Plugin Hub，2026-09-11 落地）只扫描四个用户目录（`~/.mafw/{runtime,media,usage,ui}-plugins/`），导致：

1. hub 里只显示三个 loader 首启自动生成的 `example.js.disabled` 示例文件——用户装没装插件都"都是 example"，观感如同占位符垃圾。
2. 内置插件全部缺席：runtime 内置 opencode/pi、media 内置引擎 pi、usage 内置适配器 9 个（deepseek/kimi/openrouter/siliconflow-cn/opencode-go/zhipuai-coding-plan/kimi-for-coding/commandcode/gateway）在 hub 中不可见。
3. Config Plugins 页下方还留着独立的「Runtime & Media」卡（runtime 下拉 + media 每模态下拉），与 hub 的插件语义重复——切换 runtime 本质就是激活一个 runtime 插件。

目标：hub 成为**全量插件清单**的唯一权威界面；移除示例生成；「Runtime & Media」卡删除，其能力并入 hub 行内。

## 2. 决策记录

| 问题 | 决策 |
|---|---|
| media 每模态引擎下拉放哪 | 全部并入插件中心，删除「Runtime & Media」卡 |
| usage 内置适配器交互 | 只读 + 「克隆为自定义副本」按钮（复用 clone-builtin 模板端点）；禁用仍走 Usage 配置页 `usage.disabledPlugins` |
| example.js.disabled | 删除三个 loader 的生成代码；启动时幂等清理磁盘存量 |
| 安装时类型判定 | **接口自动推导**（业界一致模式：opencode/VS Code/Grafana/Obsidian/Chrome/Raycast 安装器均不让用户选类型）；类型下拉仅作歧义兜底 |

### 2.1 业界调研依据（2026-09-15）

- opencode 官方文档（已核实）：插件 = JS/TS 模块，导出函数返回 hooks、导出 `tool` 即自定义工具，无类型概念，目录即安装。
- VS Code：`contributes` 声明；Grafana：`plugin.json` type 开发者声明、CLI 读 manifest；Obsidian：onload 内 API 调用即能力；Chrome/Raycast/Claude Code：manifest 或目录结构自描述。
- 共同点：**类型由声明或接口决定，安装流程零选择**。

## 3. 数据模型

`HubEntry`（gateway `gateway/src/plugins/hub.ts` 与 renderer `packages/desktop/src/renderer/mafw/pages/plugin-hub.ts` 同步扩展）：

```ts
interface HubEntry {
  type: 'runtime' | 'media' | 'usage' | 'ui';
  name: string;
  file: string;          // 内置条目为 '(builtin)'
  status: 'enabled' | 'disabled' | 'error' | 'config-disabled';
  error?: string;
  size: number;          // 内置条目为 0
  mtime: string;         // 内置条目为 ''（渲染为「内置」徽标）
  builtin?: boolean;     // 内置条目 true
  overridden?: boolean;  // 同名用户文件已覆盖该内置件（runtime/media/usage 均适用；ui 无内置件）
  pluginType?: string;   // 仅 usage：'api' | 'token-plan'
}
```

SDK（`packages/gateway-sdk/src/client.ts` `plugins.list` 返回类型 + `types.ts`）同步补齐可选字段。

## 4. Gateway hub 组装

`pluginHubDeps`（`gateway/src/index.ts` ~L3947）新增三个注入源：

```ts
builtinRuntimes: () => HubEntry[]   // 恒等返回 opencode + pi（status:'enabled', file:'(builtin)'）
builtinMedia:    () => HubEntry[]   // 恒等返回 pi
usageBuiltinEntries: () => HubEntry[]  // usage loader getState() 过滤 builtin:true 映射
```

`listPlugins` 修改：

- 按 type 前置插入内置条目（顺序：内置在前，用户文件在后）。
- **同名覆盖**：用户目录存在与内置件同名的 `.js` 时，内置条目标记 `overridden: true`；用户条目照常显示（usage 的覆盖语义与 `usage/plugin-loader.ts` 现有 `overridden` 一致）。
- usage 内置条目 status：命中 `config.usage.disabledPlugins` → `config-disabled`，否则 `enabled`（复用现有 `configDisabledUsage()`）。
- usage loader 不可用时 `usageBuiltinEntries()` 返回 `[]`（fail-open，不阻塞其它类型）。

`RuntimePluginLoader` 补 `getBuiltinNames(): string[]`（返回 `['pi']`；opencode 是恒等默认，由 index.ts 恒等注入，不进 loader）。

## 5. 安装类型自动判定（接口推导）

`installPlugin` 流程修订（`gateway/src/plugins/hub.ts`）：

1. base64 解码、重名检查、原子写入照旧（现有 install 流程不变）。
2. **类型判定**（在写入前）：
   - 请求体 `type` 显式提供 → 直接采用（跳过判定，向后兼容 TUI/脚本调用）。
   - 未提供 → 落盘到 `<dir>.tmp` 后 **require 并检查 `module.exports` 形状**（清 require.cache 后加载）：
     - `createRuntime` 函数 → `runtime`
     - `createPrompt` 函数 / `engine` 字符串 / `fixPayload` 函数 / `modalities` 数组 → `media`
     - `fetch` 函数（且 `type: 'api'|'token-plan'`）→ `usage`
     - `tools` 对象（含 render 函数或纯静态字段）→ `ui`
   - 恰一个命中 → 以该类型定目录、原子 rename 完成。零命中 → 400 `unrecognized plugin interface`；多命中 → 400 `ambiguous plugin interface: <candidates>`（响应带候选列表，前端展示兜底下拉让用户选定后带 type 重试）。
   - 判定失败时删除 `.tmp`（不留垃圾文件）。
3. **信任模型不变**：install 时的 require 与 loader 扫描时的 require 同权（每个装好的文件本来就会被 loader require；`/api/runtime/reload` 本就清缓存重加载）。不引入新执行面。
4. 四目录布局**不变**（loader 扫描根是既定契约；业界对照也支持 manifest/接口而非目录学分类）。

## 6. 示例清理

- 删除 `runtime/loader.ts`、`media/media-plugin-loader.ts`、`usage/plugin-loader.ts` 三处 `example.js.disabled` 写入代码与 `EXAMPLE_CONTENT` 常量。
- 启动清理：hub deps 挂 `cleanupExamples()`，对 `runtime/media/usage/ui` 四目录幂等删除 `example.js.disabled`（`fs.existsSync` 守卫，目录缺失跳过，失败仅 warn 不阻塞启动）。runtime 目录的 `README.md` 保留。
- 调用时机：`startApiServer()` 内构造 `pluginHubDeps` 后立即执行一次（fire-and-forget）。

## 7. 前端（Config Plugins 页）

### 7.1 安装面板

- 移除默认显示的类型 `SelectV2`——选文件后直接安装（类型由 gateway 接口推导）。
- 收到 400 `ambiguous plugin interface` 时，面板内动态出现类型下拉（选项 = 响应候选列表），用户选定后带 `type` 重试。
- 风险提示文案保留。

### 7.2 行渲染分支（`e.builtin` 为 true 时）

- 「内置」徽标（替代 `{size} B · {mtime}`）+ usage 行附加 `pluginType` 与「被覆盖」标记（`overridden` 时）。
- **无** SwitchV2、**无**删除按钮。
- runtime 行保留「激活」按钮（复用 `runtimeActivatable(entry, rtInfo()?.active?.name)` + `switchRuntime(e.name)`；当前激活的内置行不显示按钮——现有逻辑已按 name 判断，天然成立）。
- usage 行加「克隆」按钮 → `window.api.mafw.usagePluginsCreate({ template: 'clone-builtin', values: { sourceName: e.name } })`，成功 toast + `loadPluginHub()` 刷新；失败 toast 报错。`overridden` 的内置行隐藏克隆按钮（已有副本）。

### 7.3 media 区内嵌引擎切换

media 条目列表下方渲染 image/video/audio 三个 `SelectV2`（现「Runtime & Media」卡的 `mediaOptions`/`switchMediaEngine` 逻辑平移，数据仍来自 `window.api.mafw.media.get()`）。

### 7.4 runtime 区

- hub runtime 条目即运行时切换面；`envOverride` 警告条从旧卡移至插件中心顶部（`MAFW_RUNTIME_PLUGIN` 激活时显示）。
- **删除「Runtime & Media」整卡**（含旧 runtime 下拉 `switchRuntime`+`SelectV2` 那份 UI；`runtimeOptions()` 等仅供下拉使用的辅助代码一并清理）。

## 8. 错误处理

- 克隆失败 / 刷新失败 → toast，列表保持上次状态。
- install 到与内置件同名 → 现有 409（`plugin already exists`）照旧，不新增分支。
- install 接口判定失败（unrecognized/ambiguous）→ 400，`.tmp` 已清理；前端 ambiguous 时出兜底下拉（§7.1）。
- 内置条目永不参与 enable/disable 文件改名（`setPluginEnabled` 对 `(builtin)` file 名直接 404，前端根本不渲染开关，双保险）。
- `cleanupExamples()` 失败仅 warn。

## 9. 测试

| 层 | 用例 |
|---|---|
| `gateway/tests/unit/plugins-hub.test.ts`（现有 hub 测试扩展） | builtin 前置插入（runtime/media/usage）；usage config-disabled 映射；同名用户副本 → `overridden:true`；`cleanupExamples` 幂等（无目录/无文件/有文件） |
| 接口判定（hub sniff） | 四类样板模块各命中一次；显式 `type` 跳过判定；零命中 400 unrecognized + 无 `.tmp` 残留；多命中 400 ambiguous 带候选列表 |
| runtime loader 测试 | `getBuiltinNames()` 返回 `['pi']`；建目录不再生成 `example.js.disabled` |
| media/usage loader 测试 | 不再生成 example |
| `packages/desktop/.../plugin-hub.test.ts`（renderer） | 内置行徽标/无开关无删除；runtime 激活按钮条件；usage 克隆按钮条件（overridden 隐藏）；`statusLabel` 对内置条目 |
| SDK | `plugins.list` 类型含新可选字段；`plugins.install` 的 `type` 参数改为可选（types 测试断言函数存在即可，沿用现有 stub-fetch 模式） |

用户偏好：TDD 先行；交付时汇报新增测试数与全量通过数。

## 10. 非目标

- usage 内置件的启用/禁用开关（仍走 Usage 配置页 `disabledPlugins`）。
- TUI plugins tab 与 URL/catalog 在线安装（原 hub spec 已划为 v2）。
- 内置件的元信息页/文档链接。
- pi runtime 每模态 media 细分展示（media 区仍按模态下拉选引擎，pi 为默认值之一）。

## 11. 影响面

- gateway：`plugins/hub.ts`（builtin 合成 + cleanup + install 接口判定）、`routes/plugins.ts`（install 的 type 改可选，透传）、`index.ts`（pluginHubDeps + cleanup 调用）、`runtime/loader.ts`、`media/media-plugin-loader.ts`、`usage/plugin-loader.ts`
- desktop：`pages/Config.tsx`（Plugins 区重构）、`pages/plugin-hub.ts`（类型+helper）
- SDK：`client.ts` plugins.list 类型、`types.ts`
- AGENTS.md：§插件中心相关描述更新（hub 显示内置件、示例不再生成）
