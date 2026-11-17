# E14 插件标准 v1（agent 可消费）

> 状态：设计草稿，待人类批准
> 上游：E12（contributes 成为注册上界）、E13（observers 声明 + 无 manifest 边界）已交付

## 1. 意图与验收

用户的原话是验收条件：**「拿到我们的东西，丢给 agent 可以开发出来标准的」**，以及判断方式是**「装上」**。

翻译成可执行的验收：

> 开一个全新会话（无本仓库上下文），只给交付物，让 agent 写一个指定用途的插件；
> agent 交付的包**一次 `install` 成功**并跑出预期行为，不需要人读代码、不需要来回修。

这条验收决定了什么值得做、什么不值得：

| 决定 | 理由 |
|---|---|
| 标准必须**可执行校验**，不能只有散文 | 「装上前自查」是 agent 唯一的自我纠错机会 |
| 文档必须**按 plane 逐项写死**（字段、类型、必填、上限、错误文案） | agent 不会「按惯例推断」 |
| 必须有**可复制的参考实现** | 复制比从 zero 生成更稳 |
| **不重构运行时注册 API** | 现有 `activate()` 返回对象 + `ctx.http` 记账的形式，对 agent 反而更好写：不需要懂清理与生命周期；把它改成 effect 句柄只会换来更多可在错误位置出错的 API |
| **不做 DI / profile / bundle** | 它们解决的是「组合与替换」，与「agent 能写出合规包」无关；风险高（要动 boot 装配） |

## 2. 目标 / 非目标 / 反面目标

**目标**

1. 一份 agent 入口规范：`docs/guides/plugin-standard.md`，读完就能写，不需要读源码。
2. `plugin.json` 的**机器可读 schema**，与 runtime 校验同源、由测试钉住一致。
3. `mafw plugin check <path>`：安装前自查，输出「声明 vs 实际」差异与可执行的下一步。
4. `mafw plugin init <name>`：生成骨架，默认就是合规的。
5. 两个参考包：最小包、全 plane 包。
6. 标准本身有版本号与兼容矩阵（`standardVersion` / `apiVersion` / host range）。

**非目标**

- 不把 sessions/memory/goals/media/tts/usage 改成插件（bundle 化留待以后）。
- 不做 `inject` / ServiceToken / profile / patch。
- 不做发布者签名、插件市场。
- 不改 `~/.mafw/plugins` 目录结构与既有安装语义。
- 不强制 `contributes.desktop.*`（本 host 无执行点）。

## 2.1 安装权归属（已决策：方案 A）

业界调研见 `docs/research/2026-11-17-plugin-install-trust.md`。结论：**没有一家允许 agent 自主安装可执行代码的插件**；
Claude Code 甚至在模型会话内执行 `plugin install -y` 时直接忽略 `-y` 并拒绝。

因此 E14 采用 **A：人安装，agent 自查**。

- agent 的交付物 = 包目录 + `check --strict` 通过的结果 + 一份 inventory + 一条可直接粘贴的安装命令。
- 安装沿用现有 human principal 与 v2 consent；**不新增面向 agent 的安装通道，也不把 human token 交给 agent**
  （那会顺带解锁验收 / 审批 / quota / rollback 这些人类专属动作）。
- 若将来需要「agent 自动装到本地开发作用域」，那是**第二条受限通道**（只能装 dev 作用域、只能启用、
  不能改安全设置），独立一轮，不在 E14。

这条决策改变了验收脚本的形态：agent 的「完成」是 `check --strict` 通过并交出安装命令，
而不是自己装完。

**反面目标**（技术上做到了也算失败）

- 文档读完仍要读源码才能写对。
- `check` 通过但 `install` 失败（两者判据不一致）。
- 只有文档、没有可复制示例：agent 每次从零生成，形状漂移。
- 新增一套并行写法，旧包被迫迁移。

## 3. 标准 v1 的范围（写进规范正文）

### 3.1 包形态

| 形态 | 是否标准 | 说明 |
|---|---|---|
| 目录 + `plugin.json` | ✅ 唯一推荐 | 所有 plane 可用 |
| 目录无 `plugin.json` | ⚠️ 兼容 | 仅 ui/actions/events/legacy；tools/observers/http 被拒（E13） |
| 单文件 `.js` | ⚠️ 兼容 | 同上 |

标准只承诺目录形态。

### 3.2 导出与生命周期

- 入口 `main`（默认 `index.js`）导出 `{ name, version?, activate(ctx) }`。
- `name` 必须与 manifest 一致（不一致 → 激活失败）。
- `activate()` 可返回 `{ actions, events, tools, observers, ui, usage, media, tts, runtime, uiTools }` 的任意子集。
- `activate()` 期间可调用 `ctx.http.route/ws`；`activate()` 返回后调用会抛错（seal）。
- 清理：`ctx.effect(fn)`；包内自建的 timer/listener 必须走它。

### 3.3 五个 plane 的精确形状

规范里每个 plane 给：字段表（名/类型/必填/默认/上限）+ 一段可复制代码 + 一条「声明与注册必须一致」的说明 + 逐字错误文案。

- `actions`：`Record<name, { handler, inputSchema?, outputSchema?, timeoutMs?, title?, description? }>`；上限 `PLUGIN_UI_LIMITS.maxActionTimeoutMs`。
- `events`：`Array<{ type: 'plugin:<pkg>:<event>', schema?, title?, description?, scope? }>`；canonical 名禁止。
- `tools`：`Array<{ name, description, inputSchema, outputSchema?, timeoutMs?, handler }>`；宿主命名为 `plugin:<pkg>:<name>`。
- `observers`：`Array<{ id, title?, description?, filter?, timeoutMs?, onEvent }>`；只读。
- `http`：`ctx.http.route(method, path, handler, opts?)` / `ctx.http.ws(path, handler)`。
- `ui`：`panels / toolCards / configPages / messageWindows / menuItems / composerActions / webSurfaces`（引用契约 DTO，不复制字段定义，给出指向 `packages/plugin-contract/src/types.ts` 的锚点 + 一份最小可用示例）。

### 3.4 声明即上界（E12/E13 已实现，需要写进标准）

`contributes.gateway` 的五个键是注册上界：注册集合 ⊆ 声明集合；未声明的面不受约束；声明多于注册合法；`http: false` 时任何路由注册失败。

### 3.5 能力与信任

- `apiVersion 1/2`、`kind: trusted/untrusted`、`permissions` 白名单、`host` 范围、`integrity`。
- untrusted worker 当前只支持 `actions` / `events` / `config.*`——**这是标准的硬限制**，规范里必须写明「要 tools/observers/http 就必须 trusted」。

## 4. 交付物与实现落点

| # | 交付物 | 落点 | 判据 |
|---|---|---|---|
| D1 | agent 入口规范 | `docs/guides/plugin-standard.md`（新） | 按 §6 验收脚本，agent 只读它就能写出装得上的包 |
| D2 | manifest JSON Schema | `packages/plugin-contract/schema/plugin.schema.json`（新，随包发布） | 与 `parsePackageManifest` 行为一致；差异由 `packages/plugin-contract/src/schema-parity.test.ts` 钉住（必填/枚举/正则/上限逐项对表） |
| D3 | `mafw plugin check <path> [--strict] [--json]` | `gateway/src/cli/`（新增子命令）+ 复用既有 `checkPackage` | 输出两部分：① 逐条问题（`--json` 时结构化）② **inventory**：声明了哪些面、实际注册了哪些面、差集；末尾给 `next:` 与一条可直接粘贴的安装命令。与 `install` 判据同源（同一个 `checkPackage`），但不覆盖安装策略（consent / 配额 / 重名） |
| D4 | `mafw plugin init <name>` | 同上 CLI；模板放 `gateway/src/cli/templates/plugin-basic/` | 生成后立即 `check` 通过、`install` 通过 |
| D5 | 参考包 ×2 | `examples/plugins/hello-plugin/`（最小：1 action + 1 event）、`examples/plugins/kitchen-sink/`（五面齐全 + ui panel） | `check` 与 `install` 双通过；作为规范里的「照这个抄」 |
| D6 | 标准版本 | `plugin.json.standardVersion?: 1`（可选，缺省视为 1）；`docs/guides/plugin-standard.md` 头部写版本与变更规则 | 契约校验接受该键；未来 v2 可并存 |

D2 的关键设计：**schema 不手写第二份真相**。从 `validate.ts` 里已有的常量（`GATEWAY_CONTRIBUTES_KEYS`、`BASE_PERMISSIONS`、`NAME_PATTERN`、`SUPPORTED_PLUGIN_API_VERSIONS`）导出，schema 由脚本生成；parity 测试断言「schema 接受 ⇔ parser 接受」覆盖样例矩阵（每类合法/非法各若干）。

D3 的关键设计：**check 与 install 共用同一个判定函数**，避免「check 过了装不上」。当前 `checkPackage(probe)` 已经做 dry-run 激活，CLI 只做 IO 与排版。

## 5. 风险与取舍

| 风险 | 处理 |
|---|---|
| 文档写成第二份实现，随代码漂移 | 规范里只写「形状 + 上限 + 错误文案」，字段级真相仍由 contract types + JSON Schema 承载；漂移由 D2 parity 测试与 §6 验收脚本兜住 |
| `check` 与 `install` 判据分叉 | 同源函数；加一条「check 通过 ⇒ install 通过」的集成测试（临时目录、真实安装） |
| 模板与示例腐烂 | 两者都进 CI：`check` + 短暂安装-卸载冒烟 |
| init 生成的骨架过度复杂（agent 反而迷糊） | `plugin-basic` 只含 1 action + 1 event，其余 plane 以注释块给出 |
| 新增 `standardVersion` 造成第三套版本概念 | 明确分工：`apiVersion` = 运行时兼容、`host` = 宿主范围、`standardVersion` = 文档与工具链规范；三者关系写进规范一张表 |

## 6. 验收（交付后自证）

三个脚本化场景，全部在无本仓库上下文的子代理里跑。按 §2.1，**agent 的终点是 `check --strict` 通过并交出安装命令**；安装与行为观察由人完成。

1. **场景 A（最小包）**：给 `plugin-standard.md` + 「写一个包，提供一个 action 返回当前时间，和一个 `plugin:demo:tick` 事件」。判据：`check --strict` 通过；人执行它给出的安装命令后 `invoke` 返回时间、事件可广播。
2. **场景 B（全 plane）**：参考 `kitchen-sink` 写一个含 tools + observers + http 的包。判据：`check --strict` 通过；安装后工具在 session 工具表可见、observer 收到一次 canonical 事件、路由返回 200。
3. **场景 C（反例）**：故意让声明与注册不一致。判据：`check --strict` 在安装前拒绝，输出逐字错误文案 + `next:` 修法 + 差集 inventory。

三个场景都通过，才认为「标准」成立。

另外两条非功能判据：

- 场景里 agent **从未被要求读取或持有 human token**；它只跑 `check`。
- 同一个包重复 `install` 时，错误必须说清「已安装」与 `--overwrite`，而不是让 agent 反复重试。

## 7. 给 builder 的留白

- 规范文档的语言风格（中文/英文/双语）与长度上限。
- `mafw plugin check` 的输出格式（人读 / `--json` 两态是否需要）。
- `examples/` 目录是否随 npm 包发布。
- `standardVersion` 是否真的需要，还是用 `apiVersion` 足够。
