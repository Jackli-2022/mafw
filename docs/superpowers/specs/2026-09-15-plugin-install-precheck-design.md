# 插件中心安装预检设计（语法/接口/名称统一/预激活）

日期：2026-09-15
状态：已批准（对话中用户确认：语法+接口预检 / type ∈ 命中集合 / 名称统一 / 预激活检验）

## 背景与问题

`installPlugin`（`gateway/src/plugins/hub.ts`）现状缺口：

1. **显式指定 type 时完全跳过接口嗅探**——语法错误或接口不匹配的文件直接落盘，等 loader 加载时才标 `error` 状态，安装界面无从拦截。
2. **名称不统一**——hub 按文件名 stem 寻址（`statEntry` 的 `baseName`），loader 按 `module.exports.name` 寻址；两者不一致时 runtime loader 靠 filename-stem alias 机制兜底（`runtime/loader.ts` loadFile 尾部），其余 loader 直接以 name 注册，hub 行激活存在映射隐患。
3. **会激活失败的插件能安装成功**——loader 的激活校验（name 缺失、modalities 非法、createPrompt/engine 互斥、createPrompt 不返回函数等）只在落盘后的加载阶段才暴露。

## 目标

安装时统一执行以下检查，任一失败即 400 拒绝、文件不落盘：

1. **加载检查**：tmp-require 加载失败（语法错误 / 顶层运行时 throw）→ 400。
2. **名称统一（全类型强制）**：`module.exports.name` 为非空字符串且 === 文件名 stem（`qwen-vl.js` 必须导出 `name: 'qwen-vl'`）。
3. **接口命中**：
   - 自动嗅探路径行为不变（0 命中 400 / 多命中 400 ambiguous）。
   - 显式 type 路径：type 必须 ∈ 实际命中集合。文件没导出任何已知接口 → 400 unrecognized；选了文件没有的接口 → 400 mismatch 并列出实际导出。
   - 歧义文件（命中多个接口）+ 显式 type ∈ 命中 → 放行（保留前端兜底下拉逃生口）。
4. **预激活检验（镜像各 loader 的 loadFile 激活条件）**：

| type | 预激活规则 |
|---|---|
| runtime | name + `createRuntime` 函数（接口检查已覆盖） |
| media | name + `modalities` 非空且值 ∈ VALID_MODALITIES + `createPrompt` 与 `engine:'pi'` 互斥 + 实际调用 `createPrompt(stubCtx)` 必须返回函数（stub ctx 在 hub.ts 内本地构造：apiKey/pluginConfig/log/fetch 形状同 `media/plugin-context.ts` 的 createMediaPluginContext，credentials 缺省） |
| usage | name + `fetch` 函数（与 `usage/plugin-loader.ts` 的加载校验对齐，type/plan 不做深层校验） |
| ui | name + `tools` 非空对象（desktop 侧深度校验不变） |

## 非目标

- 不改 loader 侧行为：runtime loader 的 stem-alias 保留（兼容手动丢进目录的存量文件），hub 安装的插件从此天然 stem === name，alias 不再被触发。
- 不做安全内容扫描 / 沙箱（require 执行插件顶层代码是嗅探路径既有行为，本设计扩展到显式 type 路径；本机可信场景）。
- 无 SDK / 桌面改动：400 响应 `{ error }` 格式不变，前端 toast 现有机制直接显示。

## 实现

改造收敛在 `gateway/src/plugins/hub.ts`：

- `sniffPluginType` 泛化为 `inspectPlugin(filename, bytes)`：tmp-require（`os.tmpdir()` 临时目录，finally 清理），返回 `{ matches: PluginType[]; mod: Record<string, unknown> }`；require 抛错 → `HubError(400, 'plugin failed to load: <message>')`。
- `validateName(mod, stem)`：name 缺失/非字符串 → `missing plugin name`；name !== stem → `plugin name mismatch: exports '<name>', filename '<file>' (must match)`。
- `validateMediaActivation(mod)`：镜像 `media-plugin-loader.ts` 校验与错误消息逐字对齐——`invalid modalities` / `createPrompt and engine:"pi" are mutually exclusive` / `createPrompt did not return a function`。
- `installPlugin` 检查顺序：文件名/大小/空内容（既有）→ inspect（加载 + 计算命中集合）→ validateName → 显式 type ∈ 命中集合 → 预激活（media 深检）→ 类型嗅探回退（type 缺省时取 matches 唯一值）→ 重复检查（既有）→ 写盘。

**错误消息表**（英文，与既有风格一致）：

| 场景 | 消息 |
|---|---|
| 语法错误 / 顶层 throw | `plugin failed to load: <err.message>` |
| name 缺失 | `missing plugin name` |
| name ≠ stem | `plugin name mismatch: exports '<n>', filename '<f>' (must match)` |
| 无已知接口 | `unrecognized plugin interface: export createRuntime / createPrompt / fetch / tools`（不变） |
| 多命中未选型 | `ambiguous plugin interface: media/usage`（不变） |
| 显式 type 不在命中集合 | `plugin interface mismatch: selected usage, exports media (createPrompt)`（列出实际命中） |
| media modalities 非法 | `invalid modalities` |
| media createPrompt/engine 互斥 | `createPrompt and engine:"pi" are mutually exclusive` |
| media createPrompt 不返回函数 | `createPrompt did not return a function` |

## 测试（TDD，`gateway/tests/unit/plugins/hub.test.ts` 新增约 14 例）

1. 语法错误 → 400 `plugin failed to load`
2. 顶层 throw → 400 `plugin failed to load`
3. 显式 type 不在命中集合 → 400 mismatch 且消息含实际导出
4. 歧义文件 + 显式 type ∈ 命中集合 → 安装成功
5. 显式 type + 语法错误 → 400
6. name 缺失 → 400
7. name ≠ 文件名 stem → 400 mismatch
8. media `modalities` 空数组 → 400 `invalid modalities`
9. media modalities 含非法值 → 400
10. media `createPrompt` + `engine:'pi'` 并存 → 400 互斥
11. media `createPrompt` 返回非函数 → 400
12. media 合法插件（createPrompt 返回函数）→ 安装成功
13. runtime 合法（name === stem）→ 安装成功
14. usage 合法 → 安装成功

**回归保护**：usage clone-builtin 模板流程（`usage/templates.ts`）经过同一安装门时 filename=name 天然一致，不破——补断言验证。

## 交付汇报

按用户偏好：TDD 先行、汇报新增测试数与全量通过数、显式记录版本号与 commit 哈希。
