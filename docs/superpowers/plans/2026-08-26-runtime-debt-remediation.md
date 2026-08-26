# Runtime 债务清偿（Runtime Debt Remediation）Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 清偿 runtime 契约接缝（commit `6968b3bf`）留下的 5 项 `TODO(runtime-debt)` 债务，使 pi-coding-agent 作为第二个 runtime 接入时无已知阻塞点。

**Architecture:** 在既有 `gateway/src/runtime/` 契约上增量扩展——不加新模块，只扩 `contract.ts` 的可选能力/可选方法，opencode-runtime 吸收各自的私有实现（SQLite 读库、auth.json 读取、agent 配置写入），gateway 各消费点改为"能力存在则用、缺失则回退"。

**Tech Stack:** TypeScript（gateway 编译为 CJS，tsc）、jest + ts-jest（测试根 `tests/` + `gateway/tests/`）。

**债务清单与方案选择：**

| Debt | 位置 | 方案 | 优先级 |
|---|---|---|---|
| 2 | `core/manager/wake-handlers.ts` | 依赖注入共享 runtime | P0 |
| 1 | `index.ts` `opencodeClient: any` | 审计 → 扩接口 → 翻类型 | P1 |
| 3 | `contract.ts` `external` 未接线 | runtime 声明托管模式，sidecar 消费 | P1 |
| 5a | `media/auth-util.ts` 直读 auth.json | `credentials.getApiKey()` 可选接口 | P2 |
| 4 | `resources/opencode-db.ts` 直读 SQLite | `sessionStorageApi` 能力 + `listByDirectory()` | P2 |
| 5b | `skills/manager-agent-config.ts` 直写 manager.md | **路线 B：`runtime.agents.install()` 抽象接口**（用户已选定，非降级路线 A） | P3 |

## Global Constraints

- **行为保持不变**：opencode 是唯一激活 runtime，所有既有测试必须通过；`npm run build`（根目录）为每个任务的门禁。
- 不新增任何 npm 依赖。
- 所有契约扩展均为**可选**（optional 方法/能力字段），opencode 恒等实现全部声明——行为不变；其他 runtime 缺失时走回退路径。
- gateway 源码静态导入**不带** `.js` 后缀；动态 `import()` 保持 `.js` 后缀风格。
- 测试文件放 `tests/unit/gateway/`（导入 `../../../gateway/src/...`）或 `gateway/tests/unit/`（gateway 包内自测）。
- **git commit 步骤默认挂起**：每个任务的 "Commit" 步骤需在执行前向用户确认后才执行。
- 每个任务完成后删除对应的 `TODO(runtime-debt)` 注释。
- 本计划**不含** pi-coding-agent runtime 实现——它在本计划完成后另行立项，用本计划的接缝验证契约设计。

**执行顺序（依赖拓扑）：**

```
Task 1 (Debt 2, wake-handlers DI)   ── 独立，最小
Task 2 (Debt 1, opencodeClient 类型化) ── 类型基础，后续任务建立其上
Task 3 (Debt 3, external 接线)       ── 依赖 Task 2
Task 4 (Debt 5a, credentials 接口)   ── 依赖 Task 2
Task 5 (Debt 4, sessionStorageApi)   ── 依赖 Task 2
Task 6 (Debt 5b, agents.install)     ── 依赖 Task 2，最后做
```

---

### Task 1: wake-handlers 依赖注入（Debt 2, P0）

**Files:**
- Modify: `gateway/src/core/manager/wake-handlers.ts`
- Modify: 调用方（Scheduler / manager 相关，grep `injectWakePrompt` 找全部调用点）
- Test: `tests/unit/gateway/wake-handlers-di.test.ts`

**Interfaces:**
- Consumes: `RuntimeClient`（`gateway/src/runtime/contract.ts`，已存在）
- Produces: `injectWakePrompt(client: RuntimeClient, projectDir: string, sessionId: string, reason: string, countCompleted: number, countFailed: number)` —— client 提为第一个参数

- [ ] **Step 1: Write the failing test**

```ts
// tests/unit/gateway/wake-handlers-di.test.ts
// 注入一个 mock RuntimeClient，断言 promptAsync 被调用且参数正确；
// 断言模块不再动态 import opencode-adapter（用 jest.mock 拦截 import 并断言未触发）
```

- [ ] **Step 2: 改签名 + 删动态 import**
  - `injectWakePrompt` 第一个参数改为 `client: RuntimeClient`
  - 删除函数体内的 `await import('../../opencode-adapter.js')` 与 `createOpencodeAdapter(...)`
  - 删除 `TODO(runtime-debt)` 注释
- [ ] **Step 3: 修全部调用点**
  - `grep -rn "injectWakePrompt" gateway/src` 找调用方
  - 调用方传 `this.runtime ?? this.opencodeClient`（Scheduler 已有这两个字段）
- [ ] **Step 4: Verify** — `npm run build` + 新测试通过 + 既有 manager 相关测试通过
- [ ] **Step 5: Commit（挂起，需用户确认）** — `refactor(runtime): inject shared runtime into wake-handlers (debt 2)`

---

### Task 2: opencodeClient 类型化（Debt 1, P1）

**Files:**
- Modify: `gateway/src/index.ts`（`private opencodeClient: any` → `AgentRuntime | null`）
- Modify: `gateway/src/runtime/contract.ts`（按审计结果扩展 `RuntimeClient` 接口面）
- Test: 无新测试（类型层改动，编译器即验证）；既有全部测试为回归门禁

**Interfaces:**
- Consumes: 全部 `this.opencodeClient.*` 调用点
- Produces: 扩展后的 `RuntimeClient`（只增不改，opencode 形状 DTO 原则不变）

- [ ] **Step 1: 审计调用点**

```powershell
rg -n "this\.opencodeClient\." gateway/src | rg -o "opencodeClient\.\w+(\.\w+)?" | sort | uniq -c | sort -rn
```

  按方法归组统计，产出调用面清单（预期 80%+ 已被现有接口覆盖）。

- [ ] **Step 2: 扩展 RuntimeClient**
  - 审计清单中不在接口内的方法/字段，补入 `contract.ts`（可选或必选按实际使用）
  - SDK 特有、无法归一化的个别字段：调用点局部 `as any` 收口并加行内注释 `// sdk-specific, not in contract`
- [ ] **Step 3: 翻类型**
  - `private opencodeClient: AgentRuntime | null = null;`
  - 删除 `TODO(runtime-debt)` 注释
  - `tsc` 列出的剩余错误逐个修（预期 <10 处，多为 null 检查）
- [ ] **Step 4: Verify** — `npm run build` 零错误 + 全部既有测试通过
- [ ] **Step 5: Commit（挂起，需用户确认）** — `refactor(runtime): type opencodeClient as AgentRuntime (debt 1)`

---

### Task 3: external 字段接入 serve 生命周期（Debt 3, P1）

**Files:**
- Modify: `gateway/src/runtime/contract.ts`（`AgentRuntime` 加 `getBaseUrl(): string`）
- Modify: `gateway/src/runtime/opencode-runtime.ts`（实现 `getBaseUrl`；`external` 判定逻辑保留 `!!process.env.MAFW_SERVER_SERVE_URL`）
- Modify: `gateway/src/index.ts`（`connect()` / `startServe()` / watchdog 分支消费 `runtime.external`）
- Modify: `gateway/src/serve-sidecar.ts`（external 时不 spawn、watchdog 只探测不重启）
- Test: `tests/unit/gateway/runtime-external-mode.test.ts`

**Interfaces:**
- Consumes: `AgentRuntime.external`（已存在，未接线）、新增 `AgentRuntime.getBaseUrl()`
- Produces: connect 路径的 external 分支语义：
  - `external=true` → 不 spawn、不 `killProcessOnPort`、watchdog 仅健康探测 + 事件流重连（**不重启外部进程**）
  - `external=false/undefined` → 现有 spawn + watchdog + recoverServe 全路径

- [ ] **Step 1: Write the failing test**

```ts
// tests/unit/gateway/runtime-external-mode.test.ts
// mock runtime { external: true, getBaseUrl: () => 'http://127.0.0.1:9999' }
// 断言：connect 不调用 spawn；watchdog 失败时不调用 recoverServe 的 kill+spawn，仅重连事件流
```

- [ ] **Step 2: 契约加 `getBaseUrl()`**（必选方法，opencode 返回 `process.env.MAFW_SERVER_SERVE_URL ?? config.serveUrl`）
- [ ] **Step 3: index.ts 分支改造**
  - 现状 `MAFW_SERVER_SERVE_URL` 直读点改为读 `this.runtime.external`
  - 外部进程失败语义对齐：watchdog 连续失败 → 日志 + 事件流重连尝试，**不杀不 spawn**
  - 删除 `contract.ts` 中 `external` 字段上的 `TODO(runtime-debt)` 注释
- [ ] **Step 4: Verify** — build + 新测试 + 既有 serve-sidecar 测试通过
- [ ] **Step 5: Commit（挂起，需用户确认）** — `feat(runtime): wire external flag into serve lifecycle (debt 3)`

---

### Task 4: credentials 可选接口（Debt 5a, P2）

**Files:**
- Modify: `gateway/src/runtime/contract.ts`（`RuntimeClient` 加可选 `credentials?: { getApiKey(provider: string): string | null }`）
- Modify: `gateway/src/runtime/opencode-runtime.ts`（实现 credentials = 现有 auth-util 逻辑移入）
- Modify: `gateway/src/media/auth-util.ts`（改为：优先 `runtime.credentials`，回退直读 auth.json）
- Modify: `gateway/src/media/` 消费点（pi-adapter / media-service 的 key 获取路径）
- Test: `tests/unit/gateway/runtime-credentials.test.ts`

**Interfaces:**
- Consumes: `readOpencodeAuth()` 现有逻辑
- Produces: `RuntimeClient.credentials.getApiKey(provider)` —— 与 plugin ctx 的 `apiKey(name)` 语义对齐

- [ ] **Step 1: Write the failing test**

```ts
// opencode runtime 的 credentials.getApiKey('xiaomi') 从 mock auth.json 读到 key；
// runtime 无 credentials 时 media 回退路径仍工作
```

- [ ] **Step 2: 契约 + opencode 实现**（auth-util 读取逻辑移入 opencode-runtime，auth-util 保留为回退实现）
- [ ] **Step 3: media 消费点改造**——key 获取顺序：`runtime.credentials?.getApiKey(p)` → `readOpencodeAuth()` 回退
- [ ] **Step 4: 删除 auth-util.ts 的 `TODO(runtime-debt)` 注释**（回退路径保留，注释更新为说明回退语义）
- [ ] **Step 5: Verify** — build + 新测试 + 既有 media 测试（`pi-adapter.test.ts` / `media-service.test.ts`）通过
- [ ] **Step 6: Commit（挂起，需用户确认）** — `feat(runtime): add credentials interface, absorb auth.json into opencode runtime (debt 5a)`

---

### Task 5: sessionStorageApi 能力 + listByDirectory（Debt 4, P2）

**Files:**
- Modify: `gateway/src/runtime/contract.ts`（`RuntimeCapabilities` 加 `sessionStorageApi?: boolean`；session surface 加可选 `listByDirectory?(directory: string, limit?: number): Promise<SessionInfo[]>`）
- Move: `gateway/src/resources/opencode-db.ts` → 实现迁入 `gateway/src/runtime/opencode-runtime.ts`（文件保留为 re-export 或删除，按 import 面决定）
- Modify: `gateway/src/runtime/opencode-runtime.ts`（声明 `sessionStorageApi: true`，实现 `listByDirectory`）
- Modify: `gateway/src/resources/sessions.ts`（能力存在走 `listByDirectory`，否则回退 `session.list` + 客户端过滤）
- Test: `tests/unit/gateway/runtime-session-storage.test.ts`

**Interfaces:**
- Consumes: `opencode-db.ts` 的 `listSessionsFromDb(directory, limit)`
- Produces: `SessionInfo`（契约已有，确认 shape 覆盖 `toSessionShape` 输出）

- [ ] **Step 1: Write the failing test**

```ts
// mock runtime 无 sessionStorageApi → sessions 资源回退 session.list + 目录过滤；
// mock runtime 有 listByDirectory → 直接调用，不碰 opencode-db
```

- [ ] **Step 2: 契约扩展**（能力字段 + 可选方法，jSDoc 注明"为什么 opencode 用 SQLite 实现"的知识随实现迁移）
- [ ] **Step 3: SQLite 实现迁入 opencode-runtime**（`opencode-db.ts` 的函数成为 opencode runtime 的私有模块或内联实现；删除文件头 `TODO(runtime-debt)`）
- [ ] **Step 4: sessions 资源回退路径** + 能力门接线
- [ ] **Step 5: Verify** — build + 新测试 + 既有 sessions 资源测试通过 + 桌面 sessions 列表行为不变
- [ ] **Step 6: Commit（挂起，需用户确认）** — `feat(runtime): absorb opencode.db reads behind sessionStorageApi capability (debt 4)`

---

### Task 6: agents.install 抽象接口（Debt 5b, P3 — 路线 B）

**Files:**
- Modify: `gateway/src/runtime/contract.ts`（`RuntimeCapabilities` 加 `agentConfigApi?: boolean`；`RuntimeClient` 加可选 `agents?: { install(name: string, definition: AgentDefinition): Promise<void>; remove?(name: string): Promise<void> }`）
- Create: `gateway/src/runtime/agent-definition.ts`（`AgentDefinition` 运行时中立模型）
- Modify: `gateway/src/runtime/opencode-runtime.ts`（实现 agents.install = 现有 manager-agent-config 逻辑，翻译 AgentDefinition → opencode frontmatter）
- Modify: `gateway/src/skills/manager-agent-config.ts`（改为生产 `AgentDefinition` 而非直接写文件；写文件逻辑移入 opencode-runtime）
- Modify: `gateway/src/index.ts`（启动序列中 `ensureManagerAgentConfig()` 改为能力门调用）
- Test: `tests/unit/gateway/runtime-agents-install.test.ts`

**Interfaces:**

```ts
// AgentDefinition —— 运行时中立的 agent 定义模型
interface AgentDefinition {
  description: string;
  mode?: 'primary' | 'subagent' | 'all';
  model?: string;                    // 'provider/model' 或 undefined
  temperature?: number;
  color?: string;
  systemPrompt: string;              // 正文（现有 MANAGER_IDENTITY_SYSTEM_PROMPT）
  permissions: AgentPermissions;     // 中立权限模型（见下）
}

// 中立权限模型 —— 动作 × 决定
interface AgentPermissions {
  edit?: PermissionRule;             // 文件修改类工具（opencode: edit/write/apply_patch）
  bash?: PermissionRule;             // shell 执行
  task?: Record<string, PermissionRule>;  // 子任务派发，按 subagent 名
  tools?: Record<string, PermissionRule>; // 其余按工具名（含 MCP 工具白名单）
}
type PermissionRule = 'allow' | 'deny' | 'ask';
```

- 翻译职责在**各 runtime 实现侧**：opencode 翻译为 frontmatter permission YAML（`edit`/`bash`/`task`/工具名 key 的映射表收在 opencode-runtime 内）；未来 pi runtime 翻译为 pi 的权限模型（或映射不到的动作记 warn 降级）。
- 消费侧语义：`capabilities.agentConfigApi === false` → 跳过安装 + 一条 warn 日志（"manager agent 权限护栏不可用"），gateway 照常运行（manager 功能降级但不崩）。

- [ ] **Step 1: Write the failing test**

```ts
// opencode agents.install 产出与现有 manager.md 模板字节级一致的 frontmatter（回归）；
// AgentDefinition → frontmatter 翻译表单测（edit deny → edit:{*:deny} 等）；
// agentConfigApi=false 的 mock runtime → 跳过 + warn，不抛错
```

- [ ] **Step 2: `AgentDefinition` 中立模型 + `manager-agent-config.ts` 改造**
  - 现有模板拆为：中立 `AgentDefinition` 数据（identity/permissions）+ opencode 专属序列化器
  - 序列化器（frontmatter 生成）移入 opencode-runtime
- [ ] **Step 3: 契约扩展**（`agentConfigApi` 能力 + `agents.install` 可选方法）
- [ ] **Step 4: opencode 实现 + 启动序列能力门接线**
  - 删除 `manager-agent-config.ts` 的 `TODO(runtime-debt)` 注释
  - 字节级回归：生成的 manager.md 与现状 diff 为空
- [ ] **Step 5: Verify** — build + 新测试 + 既有 manager 相关测试通过 + 启动一次 gateway 确认 manager.md 照常生成
- [ ] **Step 6: Commit（挂起，需用户确认）** — `feat(runtime): abstract agent installation behind agents.install (debt 5b, route B)`

---

### 收尾 Task 7: 债务清零验证 + 文档更新

- [ ] **Step 1:** `rg -n "runtime-debt" gateway/src` 应为零命中
- [ ] **Step 2:** 更新 `AGENTS.md` §5.19——补充新能力字段（`sessionStorageApi` / `agentConfigApi`）、`credentials`、`agents.install`、`getBaseUrl`、external 接线语义
- [ ] **Step 3:** `npm run build` + 全部测试（root + gateway 两个 jest 套件）通过
- [ ] **Step 4:** 全量回归检查单：桌面 sessions 列表 / media 上传追问 / manager wake / serve watchdog / 自更新流程
- [ ] **Step 5: Commit（挂起，需用户确认）** — `docs(runtime): debt remediation complete, update §5.19`

---

**验收标准（整体）：** pi-coding-agent 作为 runtime 插件接入时，仅需实现契约接口，无需修改 gateway 核心代码即可达到其能力分级对应的完整功能；opencode 路径全程行为不变。
