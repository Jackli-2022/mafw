# Session 目录契约统一（`opts.directory` 权威）设计

2026-10-20 · 状态：已批准（brainstorming 三轮决策：Q1=A / Q2=1 / Q3=X + sdk-session 纳入）

## 1. 背景（为什么统一）

同一语义"这次会话在哪个项目跑"存在 **4 个来源**，且权威缺失：

| 来源 | 现状 | 问题 |
|---|---|---|
| `opts.directory`（`SessionCreateOpts.directory`） | 大多数调用点传（注册项目绝对路径 / worktree 目录）；**两处漏传**：`media-runtime-executor.ts:74` 传 `{directory: undefined}`、`index.ts:1645` conformance 传 `{}` | 可选字段 → 漏传静默 |
| `ctx.projectDir`（`RuntimePluginContext.projectDir`，`loader.ts:23-25`，装配 `:259`） | 插件路径注入 Scheduler 的 `'.'`（`index.ts:1316-1318` + `new MafwScheduler('.')` `:7562`）；**内置路径完全没传**（`index.ts:1356`） | 相对值 `'.'` / undefined，不可信 |
| `config.raw.paths.projectDir` | 绝对（`config.ts:690-692` resolve） | 只在内置/进程内 runtime 可达，外部插件拿不到 |
| `this.projectDir` | 常量 `'.'`（仅构造器赋值 `index.ts:416`） | 被当作 session 目录传递（7 处）→ `?directory=.` |

插件作者侧更糟：`.opencode/skills/runtime-plugin-authoring/SKILL.md` 只写了 `directory?: string`，**从未提及 `ctx.projectDir`**；pi 的兜底链 `opts?.directory ?? ctx.projectDir ?? config.raw.paths.projectDir`（`pi-runtime.ts:170`）在 `ctx.projectDir='.'` 时会落到**插件进程 cwd**。

## 2. 决策

- **Q1 = A**：`opts.directory` 权威；`ctx.projectDir` 降级为"启动期项目信息（绝对路径、仅兜底/初始化）"
- **Q2 = 1**：契约层 `SessionCreateOpts.directory` 改**必填**，`tsc` 强制暴露漏传
- **Q3 = X**：`ctx.projectDir` 保留但**绝对化**（三个注入点全部传绝对路径）
- **补充**：`resources/sdk-session.ts` 的 `directory || '.'` 默认一并收紧（gateway 内部簿记，非插件面）

## 3. 规则（一句话契约，写进文档）

> 建会话用 `opts.directory`（**必填、绝对路径、由 gateway 每次显式提供**）；需要项目根做初始化用 `ctx.projectDir`（绝对路径、runtime 实例创建时的当前项目快照、仅兜底用途）。

## 4. 契约变更

| 文件 | 变更 |
|---|---|
| `gateway/src/runtime/contract.ts:101-102` | `directory` 由 `directory?: string` 改 `directory: string`；注释：绝对路径，gateway 每次显式提供；`ctx.projectDir` 语义注释同步 |
| `gateway/src/runtime/loader.ts:25` | `RuntimePluginContext.projectDir` 注释：绝对路径、启动期快照、不用于 session cwd |
| `gateway/src/runtime/plugins/pi-runtime.ts:170` | 删兜底链，改 `if (!opts.directory) throw new Error('session.create: directory is required')`，注释说明 fail-loud 与契约一致性 |
| `gateway/src/runtime/opencode-runtime.ts` / `opencode-adapter.ts:103` | 仅类型收紧（已直传） |
| `gateway/src/resources/sdk-session.ts:64` | 去 `|| '.'` 默认，缺目录抛错（调用方均显式传） |

## 5. gateway 侧改动清单

> 取证澄清（写作时复核）：`directory: this.projectDir` 的 7 处出现**不是同一通道**——
> 3 处是 `sdkConfig.directory`（**死字段**：`opencode-adapter.ts` 对 `config.directory` 0 处读取，`opencode-runtime.ts:253` 同）；4 处才是会话创建。

1. **新增助手**（`index.ts`，`MafwScheduler` 私有方法）：
   ```ts
   /** 会话 cwd 与插件 ctx 默认值的唯一来源：UI 当前项目优先，否则 config 项目根（绝对）。 */
   private resolvedProjectDir(): string {
     return this.currentProjectDir ?? config.raw.paths.projectDir;
   }
   ```
2. **`ctx.projectDir` 三处注入**改传 `resolvedProjectDir()`：插件路径 `index.ts:1316-1318`、内置路径 `:1356`（新增传参）、最终兜底直连（`:1359` 附近，同样新增）。
3. **会话创建点（4 处，`. ` → 绝对）**：
   - `index.ts:1441`（`SessionWorkerPool.directory`）
   - `index.ts:4621`（eval handler `directory`）
   - `index.ts:7066`（compress 会话）
   - `index.ts:7499`（btw 会话）
4. **下游 `'.'` 默认一并收掉**：`eval-endpoint.ts:158`（`opts.directory || '.'`）、`resources/sdk-session.ts:64`（`directory || '.'`）→ 必填/抛错。
5. **死通道清理**（服务"来源收敛"目标）：删 `OpencodeRuntimeConfig.directory`（`opencode-runtime.ts:253`）、`createOpencodeAdapter` 的 `config.directory`（`opencode-adapter.ts:61`）、以及 3 个 `sdkConfig.directory` 站点（`index.ts:533 / 892 / 1690`）——均为 0 读取的死配置。
6. **修复漏传**：`media-runtime-executor.ts:74`（deps 增 `projectDir`，gateway 侧以 `resolvedProjectDir()` 注入）、`index.ts:1645` conformance deps（默认传 `resolvedProjectDir()`）。
7. **不改**：`this.projectDir` 的其它用途（trajectory `projectID` 数据键、`isUserDataDir`、registry 相关）保持 `'.'`，避免数据键迁移。

## 6. 非目标

- 多项目 / worktree 语义不变（`worktreeDir` 仍显式传、`session-worktree` kv 不动）
- 不新增 API（不做 `ctx.resolveSessionDir()`）
- 不改谐波记忆存储（`~/.mafw` 固定，与 session 目录解耦——既有已知边界）
- 不改 trajectory 行键 / kv `manager-session` 分键语义

## 7. 测试

| 层 | 用例 |
|---|---|
| 编译期（主护栏） | `tsc --noEmit`：漏传 directory 的调用点编译失败（media/conformance 是首批被暴露的） |
| 单元 | pi：`session.create` 缺 `directory` → 抛 `directory is required` |
| 单元 | media-runtime-executor：会话创建收到绝对目录（注入 deps.projectDir） |
| 单元 | memory worker 池：`create` 收到的 directory 为绝对路径（非 `.`） |
| 单元 | 死通道清理后：`tsc` 无引用残留（`OpencodeRuntimeConfig.directory` / adapter `config.directory` 删除即证） |
| 回归 | gateway 全量 jest（基线 2136）+ desktop/TUI 不涉及 |

## 8. 风险 / 回滚

- **风险**：把内部会话（btw/shrink/summary/worker）的 cwd 从 `.` 改成绝对项目路径，行为改变——但方向是修复（curator 只读探测此前跑在 gateway cwd）。若 opencode serve 对 `directory` 有 workspace 语义差异，回归测试是兜底。
- **风险**：`ctx.projectDir` 从 `'.'` 变绝对 → 依赖旧相对语义的插件（仓库内仅 pi 兜底路径）行为改变；pi 已改为 fail-loud，无静默路径。
- **回滚**：改动集中在契约 2 处 + gateway 调用点若干；revert 单提交即可（无数据迁移、无 schema 变更）。
