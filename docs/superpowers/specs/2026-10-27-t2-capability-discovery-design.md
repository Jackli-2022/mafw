# T2-5 能力发现契约（commands / skills / AGENTS.md）Design

> 日期：2026-10-27 · 状态：已交付 v4.41.0（review 待跑） · 来源：`docs/superpowers/specs/2026-10-22-contract-gap-research/06-gap-synthesis.md` #35

## 1. 意图

把「当前会话能看见哪些命令、技能、AGENTS.md 来源」从各客户端各自拼接的私有知识，收敛成 gateway 的一份可查询、可缓存、可广播的契约：

- 客户端不用再分别调用 `command.list`、`skill.list`、`mafwCommands.list` 再自行去重。
- AGENTS.md 的来源（不是正文）可被发现，支持 UI 展示「本会话受哪些规则文件影响」。
- 技能正文按需加载，不在列表/事件里搬运几十 KB。
- 命令变化以 `session.commands` 事件广播，客户端不必轮询。
- 修复一个现存断链：SDK/桌面走的 `GET /command`、`GET /skill` 当前落到 dashboard HTML，命令/技能面板实际是静默空列表。

本批只做**发现契约与兼容端点**，不做新的命令系统、不做技能编辑器、不改变 runtime 自己的命令/技能加载语义。

## 2. 侦察结论（2026-10-27 本机实证）

### 2.1 已可用的原生面

opencode 2.1 serve 的 v2 发现端点已经工作（经 gateway 反代）：

```
GET /api/command   -> { location: { directory }, data: CommandV2Info[] }
GET /api/skill     -> { location: { directory }, data: SkillV2Info[] }
```

本机实测（gateway :3000，serve :4096）：

- `/api/command`：8 条；包含 opencode 原生 `init` / `review` 与 MAFW 插件注册的 `goal` / `status` / `merge-memory` / `new-topic` / `btw` / `waitwhat`。
- `/api/skill`：41 条；包含 `mafw-plan` / `mafw-execute` / `mafw-review` / `opencode` / `brainstorming` 等；`SkillV2Info` 自带 `location` 与完整 `content`。
- `?location[directory]=<abs>` 能按目录过滤；`x-opencode-directory` 头同样是 serve 的 location 选择器（实测带该头可从另一目录返回不同技能集：gateway 仓库 41 条 / work-loop 19 条）。
- **live 2.1.0 的 payload 比生成类型窄**：`/api/command` 项实测只有 `{ name, description }`，没有 `template` / `agent` / `model` / `subtask`；`/api/skill` 项实测是 `{ id, name, description, path, content }`，没有 `location` / `slash`。生成类型 `CommandV2Info` / `SkillV2Info` 是超集，adapter 必须按「字段存在才映射」处理，不能假设这些字段一定存在。
- 因此：技能位置用 `path ?? location`，`slash` 缺省 false；命令的 `template/agent/model/subtask` 全部可选，legacy `/command` 不得依赖 template 缓存。

### 2.2 当前断链

- SDK `command.list()` / `skill.list()` 请求的是 `/command`、`/skill`（v1 形状）。
- gateway 没有这两个 handler；请求落到 SPA fallback，返回 `text/html`。
- SDK 的 `request()` 检测到 HTML 后抛错；桌面 `ChatPane` 用 `.catch(() => [])` 吞掉，因此面板静默为空。
- `route-catalog.ts` 已登记 `/command`、`/skill`，但 `api-contract.test.ts` 把它们当作「反代兜底路径」放行——登记是影子，不是真端点。

### 2.3 当前拼装链

- 桌面 `ChatPane.loadCustomCommands()` 并行拉：
  - `window.api.mafw.command.list(dir)`（断链）
  - `window.api.mafw.skill.list(dir)`（断链）
  - `window.api.mafw.mafwCommands.list()`（正常）
- TUI 只拉 gateway 的 `mafwCommands`，不展示 runtime 命令/技能。
- MAFW 自定义命令热重载只广播全局扁平 `mafw_commands_changed`；桌面自行重新拉取。
- AGENTS.md 由 opencode 自己加载，gateway 没有任何发现面。
- pi 的 `AgentSession`/ExtensionAPI 有 `getCommands()`（extension / prompt / skill，带 `sourceInfo.path/scope/source`），但 gateway 未接线。

### 2.4 结论

T2-5 不是「从零做命令发现」，而是「把已经存在的 runtime 发现面收成 gateway 契约，并补 AGENTS.md / 事件 / 兼容端点」。

## 3. 目标 / 非目标

### 目标

1. 新增 `GET /api/sessions/:id/discovery`：返回当前会话目录下的统一发现快照（命令、技能元数据、AGENTS.md 来源、revision、degraded/warnings）。
2. 新增 `GET /api/sessions/:id/discovery/skills/:key`：按技能 id/name 加载正文（唯一允许读技能正文的入口）。
3. 新增 `POST /api/sessions/:id/discovery/refresh`：强制重建并广播 `session.commands`。
4. 新增 canonical 事件 `session.commands`：广播**命令**快照（ACP `available_commands_update` 语义）；skills/AGENTS 走发现动词，不塞进事件。
5. 新增 runtime 能力位 `discoveryApi` + `RuntimeClient.discovery.{list,loadSkill}`；opencode 2.1 实现，pi 声明 false。
6. 实现 legacy `GET /command`、`GET /skill`，返回 SDK/桌面可消费的形状；桌面现有命令/技能面板无需改 UI 即恢复。
7. SDK 增加 `discovery` 命名空间与类型；`session.commands` 进入 canonical event union。
8. 全部行为 TDD；真机 smoke 覆盖快照、技能加载、事件、legacy 端点。

### 非目标

- 不做技能安装/编辑/删除 UI；不替代 W2 skill 物化通道。
- 不做 AGENTS.md 正文读取/编辑；只暴露来源元数据（理由见 §4.11）。
- 不做 AGENTS.md / skills 的文件 watcher 与实时事件；本批靠 TTL、显式 refresh 与命令变更事件。
- 不把 skills/AGENTS 塞进 `session.commands` 事件；它们是 pull-only 的发现动词。
- 不接 pi 的 `getCommands()`；pi 本批降级为「MAFW 命令 + AGENTS 来源」，`discoveryApi=false`。
- 不改桌面/TUI 的 UI 结构；桌面仅因 legacy 端点修复而恢复现有面板。
- 不实现 `session.command`（POST 命令执行）的悬空登记；该债务独立记录。
- 不改变 opencode/pi 自身的命令、技能、AGENTS 加载优先级与注入语义。

## 4. 设计

### 4.1 总览

```
                 ┌────────────────────────────────────────────┐
GET /api/sessions/:id/discovery                          │
  └─ DiscoveryService                                    │
       ├─ MAFW registry.list()        -> mafw/custom     │
       ├─ runtime.discovery.list(dir) -> runtime commands│
       │                                  + skill meta   │
       ├─ discoverAgentsFiles(dir)    -> AGENTS sources  │
       └─ merge + revision + cache                       │
                 │                                       │
                 ├─ GET /command  (legacy, SDK)           │
                 ├─ GET /skill    (legacy, SDK)           │
                 └─ session.commands event (commands only)│
                                                          │
GET /api/sessions/:id/discovery/skills/:key ── runtime.discovery.loadSkill
```

数据分层：

- **MAFW 命令**：gateway 的 `MafwCommandRegistry`（builtin + custom），gateway 进程内直接读，不依赖 runtime。
- **runtime 命令/技能元数据**：`RuntimeClient.discovery.list(directory)`；opencode 走 `/api/command`、`/api/skill`；pi 无能力。
- **AGENTS.md 来源**：gateway 文件系统扫描（只 `stat`，不读正文）。
- **技能正文**：只在 `loadSkill` 时从 runtime 取；快照与事件都不含正文。

### 4.2 API 形状

#### `GET /api/sessions/:id/discovery`

Query：

- `directory?`：绝对路径；缺省由 runtime session 记录解析。
- `force=1?`：绕过缓存。

200：

```ts
interface DiscoverySnapshot {
  sessionID: string;
  directory: string;              // 绝对路径
  revision: string;               // sha256(commands + skills + instructions)
  commandsRevision: string;       // sha256(commands)；事件用
  generatedAt: string;            // ISO
  commands: DiscoveryCommand[];
  skills: DiscoverySkill[];
  instructions: DiscoveryInstruction[];
  degraded: boolean;
  degradedReason?: 'capability_absent' | 'runtime_error' | 'partial' | 'instructions_error';
  warnings: DiscoveryWarning[];
}

interface DiscoveryCommand {
  name: string;
  aliases?: string[];
  description: string;
  argumentHint?: string;
  category?: 'goals' | 'session' | 'memory' | 'custom' | 'runtime';
  destructive?: boolean;
  source: 'mafw' | 'custom' | 'runtime';
  /** gateway builtin / user custom / project custom / runtime */
  scope: 'gateway' | 'user' | 'project' | 'runtime';
  /** true = runtime 也注册了同名命令，字段已合并 */
  runtime?: boolean;
  agent?: string;
  model?: { id: string; providerID: string; variant?: string };
  subtask?: boolean;
}

interface DiscoverySkill {
  id: string;                     // runtime id，缺省 name
  name: string;
  description?: string;
  slash: boolean;                 // live 2.1.0 无此字段 → false
  scope: 'user' | 'project' | 'path';
  location?: string;              // path ?? location，绝对路径或 runtime 原样
  contentLength: number;
}

interface DiscoveryInstruction {
  id: string;                     // sha1(path) 前 12 位
  path: string;                   // 绝对路径
  scope: 'global' | 'project' | 'nested';
  kind: 'agents-md';
  bytes: number;
  mtime: string;                  // ISO
}

interface DiscoveryWarning {
  source: 'commands' | 'skills' | 'instructions';
  message: string;                // 截断到 300 字符
}
```

错误：

- `404` session 不存在 / 目录无法解析。
- `400` `directory` 不是绝对路径或不存在。
- 其他内部错误 `500`，JSON `{ error }`。
- runtime 发现失败**不是** 500：`degraded=true`，保留 MAFW 命令与 AGENTS 来源，`skills=[]`，warnings 说明。

#### `GET /api/sessions/:id/discovery/skills/:key`

- `key` 先按技能 `id` 精确匹配，再按 `name` 匹配。
- 同名多技能 → `409` `{ error: 'ambiguous skill name; use id' }`。
- 不存在 → `404`。
- runtime 无 `discoveryApi` / 列表失败 → `503` `{ error: 'skill catalog unavailable' }`。
- 正文 > 512KB → `413` `{ error: 'skill content too large' }`。

200：

```ts
interface DiscoverySkillContent extends DiscoverySkill {
  content: string;
}
```

#### `POST /api/sessions/:id/discovery/refresh`

- 强制绕过缓存重建，成功后广播 `session.commands`。
- Query 同样支持 `directory?`。
- 200 返回 `DiscoverySnapshot`；失败语义同 GET。

#### `GET /command`（legacy）

Query：`directory?`（缺省 gateway 当前项目）。

200：

```ts
{
  commands: Array<{
    name: string;
    description?: string;
    agent?: string;
    model?: string | { id: string; providerID: string; variant?: string };
    source?: 'command' | 'mcp' | 'skill' | 'builtin';
    template?: string;
    subtask?: boolean;
    hints?: Record<string, unknown>;
  }>;
  location: { directory: string };
  warnings?: DiscoveryWarning[];
}
```

- 包含 MAFW builtin/custom + runtime 命令，按 §4.3 去重。
- MAFW builtin → `source:'builtin'`；MAFW custom / runtime → `source:'command'`。
- runtime 命令保留 `template`（legacy 语义；快照会剥掉）；MAFW 命令没有 template。
- runtime 失败时仍 200，返回 MAFW 命令 + warnings。

#### `GET /skill`（legacy）

200：

```ts
{
  skills: Array<{
    id: string;
    name: string;
    description?: string;
    slash?: boolean;
    location?: string;
    contentLength: number;
  }>;
  location: { directory: string };
  warnings?: DiscoveryWarning[];
}
```

- 只返回元数据，不返回正文；正文走新 load 端点。
- runtime 失败时 200，`skills: []` + warnings。

### 4.3 合并、去重、排序

**命令**

1. 先放 MAFW registry：`name`、`aliases`、`description`、`argumentHint`、`category`、`destructive`、`source = kind === 'builtin' ? 'mafw' : 'custom'`。
2. **MAFW 自定义命令按目录过滤**（registry 是 gateway 进程级，不能直接全量暴露给任意项目）：
   - builtin：始终包含，`scope:'gateway'`。
   - custom 且 `def.source` 位于 `~/.mafw/commands`：包含，`scope:'user'`。
   - custom 且 `def.source` 位于 `<gatewayProjectDir>/.mafw/commands` 且会话 `directory` realpath === gatewayProjectDir realpath：包含，`scope:'project'`。
   - 其余 custom：不包含，并加 warning `project-scoped MAFW commands are not discovered for <directory>`。
   - 这意味着 **worktree / 其他项目自身的 `.mafw/commands` 本批不发现**（registry 未扫描、执行面也仍指向 gateway 项目）；作为明确边界记录，后续做目录级命令注册时再解。
3. 再遍历 runtime 命令：
   - 若 `name`（小写）命中 MAFW 的 name 或 alias：把 runtime 的 `agent/model/subtask` 合并进 MAFW 条目，置 `runtime:true`；不新增条目。
   - 否则新增 `source:'runtime'`、`category:'runtime'`、`scope:'runtime'` 的条目。
   - runtime 内部同名只保留第一条。
4. 排序：按 `name` 字典序（稳定大小写不敏感）；同 name 不应存在。
5. `description` 缺省：MAFW 必有；runtime 缺省用 `''`，不伪造。

**技能**

- 以 runtime `id` 为去重键；缺 `id` 用 `name`。
- `scope` 推断（按 `location`）：
  - 位于会话 `directory` 之下 → `project`。
  - 位于 `~/.config/opencode` 或 `~/.claude` 之下 → `user`。
  - 其他 → `path`。
- 排序：`scope`（user → project → path）→ `name`。
- `contentLength` 来自 runtime 列表（opencode 自带 content；只取长度，不保留正文）。

**AGENTS.md**

见 §4.4；排序为 global → 最近祖先 → … → 项目根。去重按 realpath。

**MAFW 命令来源**

`MafwCommandRegistry.list()` 已含 custom；调用方只传 registry，不重复扫描目录。registry 不可用/抛错时命令列表为空 + warning，不阻塞技能/AGENTS。

### 4.4 AGENTS.md 发现（只读元数据）

新增 `discoverAgentsFiles(directory, opts)`：

输入：`directory`（绝对）、`homeDir`、`globalConfigDir`（默认 `~/.config/opencode`）。

规则严格对齐 opencode v2 docs（2026-10-24 版）：

1. 全局：`<globalConfigDir>/AGENTS.md`，scope=`global`。
2. 从 `directory` 向上遍历：
   - **`directory` 在 home 之下**：一直走到 home（含 home），**不因 `.git` 提前停止**（docs：global 后从 workspace 向 home 逐级加载）。
   - **`directory` 在 home 之外**：走到最近含 `.git` 的祖先（含），到此停止；没有 `.git` 则只发现 `directory` 自身。
   - `.git` 可能是目录，也可能是 worktree 的 **文件**；两种都算项目根。
3. 每个目录只看 `AGENTS.md`；V2 不读 `CLAUDE.md`，本批也不读。
4. 只 `stat`：`bytes`、`mtime`；**不读正文**。
5. realpath 去重；`id = sha1(path).slice(0,12)`。
6. scope：
   - global 文件 = `global`。
   - 找到 `.git` 根时，该目录 = `project`，其余（包括 git 根之上到 home 的） = `nested`。
   - 没有 `.git` 时，最顶层被访问目录 = `project`，其余 = `nested`。
7. 排序：global，然后从 `directory` 到根/home（最近优先）。
8. 文件 stat 失败 → 跳过该文件并加 warning；不抛。
9. 不对 workspace 之下的 nested AGENTS.md 做递归扫描；opencode 在 agent 读取目录时惰性加载，gateway 不复制该行为。

不做：

- 不展开 `opencode.json` 的 `instructions` 数组（本地 glob/URL）——协议边界，后续可加。
- 不做 workspace 之下 nested AGENTS.md 的递归扫描；opencode 在 agent 读取目录时惰性加载，gateway 不复制该行为。
- 不暴露正文（§4.11）。

### 4.5 技能加载

`GET /api/sessions/:id/discovery/skills/:key`：

1. 取/建该目录的发现缓存，得到技能元数据。
2. 解析 key：
   - 精确 `id`；否则 `name`。
   - name 多命中 → 409。
3. 调 `runtime.discovery.loadSkill({directory, key})`：
   - opencode：重新 `GET /api/skill`，按 id/name 找 `content`。
   - 返回 `null` → 404。
4. 正文长度 > 512KB → 413；否则返回 `DiscoverySkillContent`。

为什么不缓存正文：技能正文是低频按需读取；列表/事件只保留 `contentLength`，避免每会话缓存几十 KB × N。

### 4.6 Runtime 契约与 adapter

`RuntimeCapabilities` 新增：

```ts
/** runtime 提供 command/skill 目录发现（opencode 2.1；pi false） */
discoveryApi?: boolean;
```

`RuntimeClient` 新增：

```ts
discovery?: {
  list(opts: { directory: string }): Promise<{
    commands: RuntimeCommandInfo[];
    skills: RuntimeSkillInfo[];
  }>;
  loadSkill(opts: { directory: string; key: string }): Promise<RuntimeSkillContent | null>;
};
```

类型：

```ts
interface RuntimeCommandInfo {
  name: string;
  description?: string;
  agent?: string;
  model?: { id: string; providerID: string; variant?: string };
  subtask?: boolean;
  template?: string;
}

interface RuntimeSkillInfo {
  id: string;
  name: string;
  description?: string;
  slash?: boolean;                // live 2.1.0 缺省 false
  location?: string;              // path ?? location
  contentLength: number;
}

interface RuntimeSkillContent extends RuntimeSkillInfo { content: string }

interface RuntimeDiscoveryWarning {
  source: 'commands' | 'skills';
  message: string;
}

interface RuntimeDiscoveryResult {
  commands: RuntimeCommandInfo[];
  skills: RuntimeSkillInfo[];
  warnings: RuntimeDiscoveryWarning[];
}
```

opencode adapter：

- `list`：用 `Promise.allSettled` 分别直连 `/api/command`、`/api/skill`（`directNative` 已带 `directory` query + `x-opencode-directory` 头）；`unwrapNative` 解 `{location,data}`。
  - 单边失败保留另一边：commands 成功/skills 失败 → 返回 commands + skills warning；反之亦然。
  - 两边都失败 → 空数组 + 两条 warning，不抛；DiscoveryService 置 degraded。
  - 命令字段按「存在才映射」；live 只有 `name/description` 时其余字段省略。
  - 技能 `location = path ?? location`，`slash = !!slash`，`contentLength = content.length`；不保留 content。
- `loadSkill`：再拉 `/api/skill`，按 key 匹配；只返回一条；正文不截断（路由层做 512KB 检查）。列表失败/端点失败 → 抛错，路由 503。
- 失败不阻塞快照；只有 loadSkill 抛错。

pi：

- `capabilities.discoveryApi = false`，无 `discovery` 对象。
- DiscoveryService 对 pi 只返回 MAFW 命令 + AGENTS 来源；`skills=[]`，`degraded=true`，`degradedReason='capability_absent'`，warning `{source:'skills', message:'runtime does not expose discoveryApi'}`。
- **pi 目录解析小修**：`PiSessionRegistry` 新增 `directories: Map<sessionID, cwd>`，`create()` 记录、`get()/list()` 返回、dispose/delete 清理。这样 live pi 会话在未带 `directory` query 时也能解析 AGENTS/MAFW；非 live 会话返回 404（或由客户端显式传 directory）。此修复同时让 pi 的 session 列表不再返回空 directory。
- 不调用 pi `getCommands()`；后续批次可加。

`validate.ts`：

- `discoveryApi=true` 时要求 `discovery.list` 与 `discovery.loadSkill` 都是函数；缺失 → 校验降级该能力位（与 `instructionsApi` 同档，`CAPABILITY_REQUIREMENTS`）。
- `fullCapabilities` 增 `discoveryApi:true`；legacy caps 显式 false；pi false。

### 4.7 `session.commands` 事件

canonical runtime event（`mafw_event` 信封）：

```ts
interface SessionCommandsEvent {
  sessionID: string;
  directory: string;
  revision: string;        // = commandsRevision
  generatedAt: string;
  reason: 'commands_changed' | 'runtime_switched' | 'manual_refresh';
  commands: DiscoveryCommand[];
  degraded: boolean;
  warnings: DiscoveryWarning[];
}
```

广播时机：

- `POST .../discovery/refresh` 成功后：reason=`manual_refresh`。
- MAFW 自定义命令 watcher 重载后：清空缓存，向**已知会话**广播 reason=`commands_changed`。
- runtime 热切换完成后：清空缓存，向已知会话广播 reason=`runtime_switched`。
- 不在 `session.created` 自动广播：初值由客户端打开会话时 GET；避免为 worker/子会话触发 runtime catalog 读取。已知会话 = 至少调用过一次 discovery/legacy 端点的会话；命令变更时它们会收到事件。
- 事件不包含 skills/AGENTS；它们的变化靠 TTL/显式 refresh。

词汇接线：

- `packages/gateway-sdk/src/events.ts` 的 `RUNTIME_EVENT_TYPES` 增 `"session.commands"`。
- `gateway/src/runtime/mafw-vocabulary.ts` 增 `sessionCommands: 'session.commands'`。
- `event-flow-matrix.ts` 增行：`normalizeFacet: []`，modeA `passthrough`，desktop `ignore`，tui `ignore`，note 说明本批只提供契约，UI 采用后续。
- `session.commands` 与 `session.created/updated/deleted` 同属会话生命周期，但它是 gateway 自发事件，不经 runtime 翻译层。

### 4.8 Legacy `/command`、`/skill`

目的：修复 SDK/桌面断链，并让 route catalog 的影子登记变成真端点。

- 两者都是 GET，读取 `directory` query；缺省用 gateway 当前项目；无目录或目录非法 → 400。
- 它们**不要求 sessionID**；目录就是作用域。
- **`/command` 只返回 runtime 命令，不返回 MAFW 命令**：
  - 桌面已经单独拉 `mafwCommands` 并把 `mafw` 组与 `custom` 组合并；若 `/command` 再返回 MAFW，面板会出现重复项。
  - 排除规则：runtime 命令的 `name`（小写）命中 MAFW registry 的 name 或 alias 时不返回。
  - `source` 固定 `'command'`（若 runtime 未来返回 source，可保留 `mcp`/`skill`）。
  - live 2.1.0 只有 `name/description` 时，其余字段省略；不保留/不缓存 template。
- `/skill` 只出口元数据（id/name/description/location/contentLength），不返回正文。
- runtime 失败：200 + warnings，`commands`/`skills` 为空，不 500；桌面仍显示 MAFW 组。
- `api-contract.test.ts` 从 `REVERSE_PROXY_PATHS` 移除 `/command`、`/skill`（它们现在有真实 handler）。
- route-catalog 已有两条，不改 operationId。

### 4.9 缓存、revision、降级

- 缓存键：`directory`（绝对路径）；不是 sessionID。命令/技能/AGENTS 都是目录作用域。
- TTL：
  - 正常 30s。
  - `degradedReason='runtime_error'|'partial'` → 5s（快速重试，避免打爆）。
  - `degradedReason='capability_absent'`（pi）→ 30s，不做无意义 5s 重扫。
  - `degradedReason='instructions_error'` → 30s。
- 单飞：同目录并发 GET 只触发一次 runtime list。
- `force=1` / refresh：删除缓存并重建。
- 缓存内容：公开快照（不含技能正文、不含命令 template）；不再保留 `runtimeCommandsRaw`（legacy `/command` 也不需要 template）。
- revision：
  - `commandsRevision = sha256(stableJson(commands))`。
  - `revision = sha256(stableJson({ commands, skills, instructions }))`。
  - 排序稳定；`generatedAt`/warnings/degraded 不参与 hash。
- 已知会话表：`Map<sessionID, directory>`；只有 discovery GET/refresh 调用时记录（legacy `/command`/`/skill` 没有 sessionID，不登记）；`broadcastKnown(reason)` 逐会话取缓存快照并广播；单会话失败只 warning，不影响其他。
- 降级：
  - runtime list 抛错/单边失败 → `degraded=true`，`degradedReason='runtime_error'|'partial'`，warning（source `commands`/`skills`），MAFW 命令保留，技能按成功侧保留。
  - AGENTS 扫描抛错 → `degraded=true`，`degradedReason='instructions_error'`，warning（source `instructions`），其他照常。
  - MAFW registry 抛错 → warning（source `commands`），runtime 命令/技能仍返回。
  - 单会话 refresh/广播失败 → 日志 warn，不 500。

### 4.10 SDK / 客户端

`packages/gateway-sdk/src/types.ts`：

```ts
interface DiscoveryNamespace {
  get(sessionID: string, params?: { directory?: string; force?: boolean }): Promise<DiscoverySnapshot>;
  refresh(sessionID: string, params?: { directory?: string }): Promise<DiscoverySnapshot>;
  skill(sessionID: string, key: string, params?: { directory?: string; force?: boolean }): Promise<DiscoverySkillContent>;
}
```

- `MafwClient`/`IMafwClient` 增 `discovery`。
- `CommandInfo.model` 放宽为 `string | { id; providerID; variant? }`（opencode v2 类型形状；live 可缺省）。
- `SkillInfo` 增加可选 `id`、`contentLength`、`path`（additive；`location` 保留兼容）。
- `events.ts` 增 `session.commands`。
- 客户端方法路径：
  - `/api/sessions/${id}/discovery`
  - `/api/sessions/${id}/discovery/refresh`
  - `/api/sessions/${id}/discovery/skills/${encodeURIComponent(key)}`
- 生成链：route-catalog 增 3 条 → `gateway npm run emit:openapi` → `packages/gateway-sdk npm run gen:api`。
- 桌面/TUI 本批不改：桌面现有 `command.list`/`skill.list` 因 legacy 端点恢复而自动可用；新 discovery/SDK 方法留给后续 UI 采用。
- preload 不新增（本批无 UI 调用）；SDK 可独立被其他客户端使用。

### 4.11 安全 / 隐私

- AGENTS.md 正文属于 privileged instruction，**不通过任何 endpoint/event 暴露**；只暴露路径/scope/bytes/mtime。对齐 opencode v2 docs：「Clients can see which sources changed, but not their contents.」
- 技能正文只通过 `discovery/skills/:key` 按 runtime catalog 读取；不接受任意路径。上限 512KB。
- 命令快照不包含 `template`；legacy `/command` 保留 template 以兼容现有 opencode v1 契约（raw `/api/command` 本来就可读）。
- 路径只返回本机绝对路径；gateway 既有 API 已在本机/鉴权边界内。
- `directory` 必须 absolute 且存在；不做 `..` 归一化后的越界读取（AGENTS 只 stat 已解析路径，技能只读 runtime 返回位置）。

### 4.12 不做的事（明确边界）

- 不做 AGENTS.md 正文/编辑/远程 URL/`instructions` 配置展开。
- 不做技能安装、删除、启用/禁用、远程 catalog。
- 不做 pi 的 `getCommands()`。
- 不做桌面/TUI 的新面板或事件消费。
- 不做 `session.command` 执行端点。
- 不做 skills/AGENTS 变更 watcher；只有命令变更、runtime 切换、显式 refresh 会广播。
- 不改 MAFW 自定义命令的现有热重载语义。

## 5. 测试与验收

### 5.1 单元 / 集成测试

新增（gateway）：

1. `core/discovery/merge.test.ts`
   - MAFW + runtime 合并；同名去重；alias 命中；runtime 字段合并；稳定排序。
   - MAFW custom 目录过滤：user 级保留、gateway project 仅同目录保留、foreign 目录省略 + warning。
   - 技能 id/name 去重、scope 推断（path/location）、slash 缺省 false、排序。
   - revision 稳定；字段顺序无关；内容变化 revision 变化。
2. `core/discovery/agents-files.test.ts`
   - 全局 + 项目根 + nested 顺序；home 内不因 `.git` 提前停止；home 外 `.git`（目录/file 两种）截断；无 `.git` 外目录；dedupe；stat 失败 warning；只返回元数据（无 content）。
3. `core/discovery/discovery-service.test.ts`
   - 缓存命中/force；并发单飞；runtime 单边失败保留另一边；两边失败 degraded；pi capability_absent TTL 30s；AGENTS 失败；已知会话广播；reason。
4. `runtime/opencode-discovery.test.ts`（或 adapter 现有测试内）
   - `/command`、`/skill` 信封解包；directory query + `x-opencode-directory` 传递；live 窄 payload（仅 name/description、path/content）映射；技能不保留正文；loadSkill 命中/未命中；单边失败 warnings。
5. `routes/session-discovery.test.ts`
   - GET 200 形状；session 404；非法目录 400；force；refresh 广播；skill 200/404/409/413/503。
   - `/command`/`/skill` 200 形状、warnings、非 HTML；`/command` 不返回 MAFW 命令（防桌面重复）。
6. `runtime/validate.test.ts`（或现有）
   - `discoveryApi=true` 缺方法 hard fail；pi false 通过。
7. `runtime/pi/pi-session.test.ts`（或现有）
   - create 后 get/list 返回 cwd；dispose 清理。
8. 事件守卫：`event-flow-matrix.test.ts` / `vocabulary-sync.test.ts` 自动覆盖 `session.commands`。

SDK：

8. `client.test.ts`
   - `discovery.get/refresh/skill` 路径、query、返回类型。
   - `command.list`/`skill.list` 仍走 `/command`、`/skill` 并解析 `{commands}`/`{skills}`。
   - `CommandInfo.model` 对象形状可用。

桌面/TUI：本批不改，不加测试；现有类型检查确保 `session.commands` 新增后穷尽守卫通过（若需要，matrix 已标 ignore）。

### 5.2 真机冒烟（本机 gateway + opencode 2.1）

新增 `gateway/scripts/smoke-discovery.mjs`，可复跑，输出 PASS 行；覆盖：

1. 创建临时 session（项目根目录），删除会话清理。
2. `GET discovery` 200；`commands` 含 `goal` 与 `init`；`skills` 含 `mafw-plan` 与 `opencode`；`instructions` 含项目根 `AGENTS.md`；`revision` 为 64 hex。
3. 第二次 GET `revision` 不变。
4. `GET discovery/skills/mafw-plan` 200，`content` 含 `mafw-plan`；未知 key 404。
5. `GET /command` 与 `/skill` 返回 `application/json`，不是 HTML；命令 ≥ 1、技能 ≥ 1；`/command` 不含 `goal`（MAFW 由桌面单独拉取，防重复）。
6. 用另一个已存在目录（如 `C:\work\work-loop`）再查一次 `/skill`，确认 location 随 directory 变化（防「总是默认项目」）。
7. SSE 订阅 `/api/events`，`POST refresh` 后收到 `session.commands`，`sessionID` 匹配、`commands` 非空、`reason='manual_refresh'`。
8. 清理临时 session。
9. 输出 `PASS n/n`；任何失败非零退出。

pi 降级不做 live 切换（会打断当前 runtime）；用单元测试覆盖 `discoveryApi=false`。

### 5.3 全量门禁

- gateway：全量 jest，`--runInBand --forceExit`。
- root plugin：全量 jest。
- SDK：`npm test`。
- desktop / TUI / session-ui：本批未改，若时间允许跑现有全量；至少 `tsc`/build。
- `npm run build`（root）rc=0；gateway `npx tsc --noEmit` rc=0。
- 记录新增测试数与全量通过数（用户交付偏好）。

## 6. 风险与开放问题

1. **AGENTS.md 只给来源不给正文**：对齐 opencode privilege 边界；若用户需要正文，是安全决策变更，另批。
2. **pi 降级**：本批 pi 没有 runtime 命令/技能目录；若用户要求 pi 对等，需要接 ExtensionAPI `getCommands()`，另批。
3. **`/command`/`/skill` 形状**：SDK 现有类型是 opencode v1 形状；本批保持向后兼容，不改成 v2 信封。`/command` 只返回 runtime 命令，MAFW 由桌面单独拉取，避免重复。
4. **runtime 目录选择**：opencode `/api/command` 与 `/api/skill` 依赖 location（query/header）；adapter 用 `directNative` 已有的双写，smoke 覆盖不同目录以防「总是返回默认项目」。
5. **事件初值**：本批只在变更/refresh 时广播，不在 session.created 广播；客户端打开会话时 GET。若要求 ACP 式 initial update，后续加。
6. **缓存 TTL 30s**：技能/AGENTS 变化最多滞后 30s；显式 refresh 可立即刷新。
7. **MAFW custom 作用域**：本批只发现 user 级 + gateway 当前项目的 project 级 custom；worktree/其他项目的 `.mafw/commands` 不发现（执行面也仍是 gateway 项目），作为边界记录。
8. **live payload 比类型窄**：adapter 必须按可选字段映射；不要把生成的 `CommandV2Info` / `SkillV2Info` 当成 live 保证。
9. **pi 目录**：本批给 `PiSessionRegistry` 补 cwd map；非 live pi 会话仍需客户端显式传 directory，否则 404。

### Builder check 7 问的裁决（本 spec 的最终选择）

1. **AGENTS 遍历边界**：以 opencode v2 docs 为准——workspace 在 home 内走到 home 且不因 `.git` 提前停；在 home 外走到最近 `.git`（文件或目录，worktree 的 `.git` 是文件）。scope 按 §4.4 标注。
2. **MAFW custom 项目作用域**：不做目录级命令注册；只发现 builtin + user 级 + gateway 当前项目的 project 级 custom；foreign 目录省略 project custom 并 warning。worktree 自身 `.mafw/commands` 作为边界记录。
3. **pi 目录解析**：给 `PiSessionRegistry` 补 cwd map；live 会话可无 query 解析，非 live 会话 404 或由客户端传 directory。
4. **legacy `/command` 是否含 MAFW**：不含；桌面已单独拉 `mafwCommands`，含了会重复。新 discovery 快照才是统一清单。
5. **单边失败**：`Promise.allSettled`；commands/skills 各自保留成功侧 + warning；两边都失败才空数组，仍 200。
6. **live payload 窄**：按字段存在才映射；`path ?? location`、`slash` 缺省 false；不缓存 template；`/command` 不依赖 template。
7. **degraded TTL**：`capability_absent` 30s；`runtime_error`/`partial` 5s；`instructions_error` 30s。pi 不会每 5s 重扫。

以上均为文档/代码可裁决项，不需要用户再回答。

## 7. 实施拆分（供 plan）

1. **契约与 adapter**：`discoveryApi`、RuntimeClient 类型、opencode adapter list/loadSkill（allSettled、窄 payload）、pi/legacy 能力位、validate。
2. **pi 目录修复**：PiSessionRegistry cwd map + get/list/dispose + 测试。
3. **纯合并层**：MAFW 目录过滤、commands/skills 合并、scope 推断、revision、稳定排序 + 单测。
4. **AGENTS 发现**：按 opencode v2 边界遍历（home 内/外、`.git` file/dir）、去重/元数据 + 单测。
5. **DiscoveryService**：目录缓存、单飞、分区降级 TTL、已知会话、广播 + 单测。
6. **路由与接线**：discovery 三端点、legacy `/command`/`/skill`（runtime-only）、index 注册、目录解析、命令 watcher/runtime switch 广播 + 路由测试。
7. **事件词汇**：SDK union、gateway vocabulary、event matrix、穷尽守卫。
8. **SDK/OpenAPI**：类型、client、route-catalog、emit:openapi、gen:api、SDK 测试。
9. **冒烟与门禁**：smoke 脚本、全量测试、build/typecheck、docs/AGENTS 记录。

## 8. 附：侦察命令与证据（可复跑）

```powershell
# gateway 的 v2 发现面已可用
Invoke-RestMethod http://localhost:3000/api/command
Invoke-RestMethod http://localhost:3000/api/skill

# SDK 走的 v1 路径当前是 HTML
(Invoke-WebRequest http://localhost:3000/command -UseBasicParsing).Headers['Content-Type']  # text/html
(Invoke-WebRequest http://localhost:3000/skill   -UseBasicParsing).Headers['Content-Type']  # text/html

# 按目录过滤
Invoke-RestMethod 'http://localhost:3000/api/command?location%5Bdirectory%5D=C%3A%5Cwork%5Cwork-loop'
```

## 9. 交付记录（v4.41.0）

### 提交

- `74275555` feat(discovery): add runtime discovery capability contract
- `f20fd54b` feat(discovery): add opencode command/skill discovery adapter
- `59408ea9` fix(pi): retain session directory for discovery
- `e0ce6f39` feat(discovery): merge commands, skills and revisions
- `a3310ef0` feat(discovery): discover AGENTS.md sources without contents
- `c78e724f` feat(discovery): add cached discovery service with degraded modes
- `18e8ab54` feat(discovery): expose discovery and legacy command endpoints
- `3be6435d` feat(discovery): broadcast session.commands on catalog changes
- `e04662a5` feat(sdk): add discovery namespace and types

### 测试与构建

- gateway：**403 suites / 2908 tests passed**（`--runInBand --forceExit` rc=0）
- root plugin：**29 passed**
- SDK client：**117 passed**；SDK `contract.test.ts` 仍有 1 个非本批失败——并行 goal-plan-review 的 `GET /api/goals/:id/plan` / `POST /api/goals/:id/plan-approval` 未登记进 openapi（已记入 ledger，交由并行 owner）
- desktop targeted：`session-events.test.ts` **24 passed**
- build / gateway `tsc --noEmit` / SDK `tsc --noEmit`：rc=0
- 真机 smoke：**21/21 PASS**（snapshot、revision、skill load、legacy endpoints、directory scoping、`session.commands` SSE）

### 已知边界

- AGENTS.md 只暴露来源元数据，不暴露正文（对齐 opencode v2 privilege 边界）。
- pi 本批无 runtime command/skill catalog，`discoveryApi=false`；返回 MAFW 命令 + AGENTS 来源。
- MAFW custom 命令只发现 user 级 + gateway 当前项目 project 级；worktree/其他项目 `.mafw/commands` 不发现（warning）。
- skills/AGENTS 无文件 watcher；TTL 30s，显式 refresh 可立即更新。
- legacy `/command` 只返回 runtime 命令，MAFW 由桌面单独拉取，避免重复。
- `session.commands` 只在 refresh / 命令热重载 / runtime 热切换广播；初值由 GET 拉取。
- review 待 gateway/glm-5.3；完成后补 review 结论与修复 commits。

