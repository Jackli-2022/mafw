# E13 插入点补完 + 单文件边界

> 状态：设计已定，待实施
> 前置：E12（`docs/releases/2026-11-16-plugin-insertion-points.md`）已交付并上线。
> 范围：三个面收口，不改启动装配、不引入 DI/profile。

## 1. 为什么还有这一波

E12 让 `contributes` 成为 4 个 gateway 面的注册上界，并让 tools / observers 默认生效。剩下三处不一致：

### 1.1 observers 是唯一「生效但不可声明」的面

`packages/plugin-contract/src/types.ts` 的 `PluginGatewayContributes` 只有
`actions` / `events` / `tools` / `http`。而 E12 之后 observers 默认就在跑
（`createKernelV2Live` 默认启用），安装审查时却没有任何声明可核对。

一个默认生效、却无法在安装时声明与被审查的能力面，恰好是「声明即权限」的反例。

### 1.2 诊断噪声与不可见声明

- `enforceDeclared` 在包已经有 schema 错误时仍会追加「未声明」错误，
  同一个条目被报两次；噪声会掩盖真正的首因。
- `contributes.desktop.*` 有形状校验但没有任何执行点，声明了也不会有人看——
  至少在 doctor 里应可见。

### 1.3 单文件 `.js` 包可以注册 tools / observers / http

`package-host.ts#scanDescriptors` 允许 `~/.mafw/plugins/*.js` 直接作为包（无 `plugin.json`），
按 trusted 在主进程 `require`。这类包没有 manifest，于是：

- 没有 `contributes`，因此没有任何注册上界；
- 没有 `permissions`，因此没有安装时的授权；
- 却可以注册 agent tools（进入每个 session 的工具表）、canonical observers（读全量事件）、
  http 路由（对 `/api/plugins/<pkg>/api/*` 暴露端点）。

这是当前最大的信任边界旁路。

## 2. 目标

### D1 `contributes.gateway.observers`

新增 `observers?: string[]`（observer id 列表），与 `actions` 同构：

| 声明 | 实际 | 结果 |
|---|---|---|
| `observers: ['audit']` | 注册 `audit` + `metrics` | error：`observer "metrics" is not declared in plugin.json contributes.gateway.observers` |
| `observers: ['audit']` | 未注册 | 允许（条件注册） |
| 未声明 | 任意 | 允许（兼容） |

类型用 `string[]` 而不是完整 descriptor：observer 的可执行部分（`onEvent`、`filter`）
只能来自 `activate()`，声明的作用是「安装时可审」，不是复制实现。tools 用 descriptor
是因为要校验 schema 形状；observer 没有 schema，id 足够。

### D2 诊断去噪 + desktop 声明可见

- `enforceDeclared` 在 `errors.length > 0` 时直接返回：包已经因形状/标识错误失败，
  不再追加派生的「未声明」错误。语义不变（失败仍然是失败），只是首因更清楚。
- `plugin-doctor` 新增 `contributes-desktop` 检查：`contributes.desktop` 非空时给
  `warn`，文案说明「本 host 只校验形状，桌面侧尚未执行」。这是让不可强制的声明可见，
  而不是假装它被强制了。

### D3 无 manifest 的包收回三个能力面（非破坏性选择）

**不做**「拒绝加载单文件包」。理由：

1. 单文件加载是既有的一等路径，`package-host` 测试大量依赖它（38 处 `.js` 夹具）；
2. 当前 `~/.mafw/plugins` 无安装包，硬拒绝换不来迁移收益，却会打碎所有本地草稿用法；
3. 真正的风险不是「它能跑」，而是「它能悄悄扩展 agent 能力」。

判据**不是文件形态**，而是「没有 manifest」：`parsedManifest?.manifest === undefined`。
单文件 `.js` 与**缺 `plugin.json` 的目录包**都满足它——两者同样没有 `contributes`、
没有声明权限、没有安装时授权。（终审发现原判据 `desc.pkgDir === undefined` 漏掉目录形态，
已修正；这是本波唯一一处 spec 与实现不同步，记录在此。）

因此：**无 manifest 的包继续加载，但不得贡献 tools / observers / http**。
它仍可贡献 ui / actions / events / legacy（usage/media/tts/runtime），
这些要么是声明式数据，要么是既有 legacy 通道，且不扩大 agent 的工具面。

失败信息（逐字）：
`packages without plugin.json cannot contribute ${planes.join(', ')}; ship a directory package with plugin.json`

`planes` 按固定顺序取实际命中的：`tools`、`observers`、`http`。

未修的更深问题（写入 release 记录，不在本波）：单文件包仍是「无授权的主进程代码」。
彻底收口需要 install-time consent + 签名，属于 P3/P4，不在本次范围。

## 3. 非目标

- 不改 `boot.ts` 装配顺序；不引入 ServiceToken / DI / profile / bundle。
- 不给 observers 加 `filter` / `timeoutMs` 的声明校验（可执行部分仍以 `activate()` 为准）。
- 不实现桌面侧 `contributes.desktop.*` 强制（本 host 无执行点）。
- 不引入发布者签名，不改 `~/.mafw/plugins` 目录结构。
- 不动单文件包的加载方式与信任级别（仍是 trusted、主进程 `require`）。

## 4. 故障语义

| 场景 | 行为 |
|---|---|
| v2 包声明 `observers: ['a']` 却注册 `b` | 激活失败，候选随 bag 丢弃，旧 revision 保持在线 |
| v1 包声明合法 `observers` | 与 v2 同权，构成约束 |
| v1 包 `observers` 形状非法 | 沿用 E12：`legacy-contributes` warning，不构成约束 |
| 包已有 schema 错误 + 越界注册 | 只报 schema 错误（不再追加未声明） |
| 无 manifest 的包（`.js` 文件或缺 `plugin.json` 的目录）返回 `tools` / `observers` / 设 `ctx.http` | 激活失败，错误列出实际命中的面 |
| 无 manifest 的包只返回 ui / actions / events / legacy | 正常激活（回归） |
| 包声明 `contributes.desktop.ui` | 激活正常；doctor 给 `contributes-desktop: warn` |

## 5. 验证

- `packages/plugin-contract`：`observers` 接受数组、拒绝非数组、未知键仍拒绝。
- gateway：D1/D3 各至少 2 条（越界拒绝 + 合法/回归），D2 各 1 条（去噪、doctor 检查）。
- 门禁：`npx tsc --noEmit -p tsconfig.json`（gateway）、`npm run test:plugin-contract`、
  gateway 定向 6 个 suite、gateway 全量（记录新增数与全量通过数）。

## 6. 风险

- **无 manifest 包的能力收缩**是本波唯一的破行为：若有现存 `.js` 文件或缺 `plugin.json` 的目录包
  依赖 tools/observers/http，会在下次 reload 时失败。当前安装目录为空，实际影响为零；错误信息直接给出修复路径。
- `observers` 用 `string[]` 而非 descriptor，未来若要校验 filter 需要 apiVersion 升级，
  届时用新键（如 `observerSpecs`）而非改语义。
