# Runtime 中立 Agent 身份（IdentityRegistry）设计

> 日期：2026-10-08 · 状态：已与用户逐节确认（四节全部 ok）；§3.2 已按身份注入调研修订
> 前序调研：`docs/research/2026-10-08-agent-identity-injection-survey.md`（身份注入机制，本次设计主依据）、`docs/research/2026-10-08-node-execution-runtime-survey.md`（install / at-prompt / config 三策略结论）
> 姊妹篇：`2026-10-08-event-mapping-registration-design.md`（事件面）、HostAdapter 认知面契约（AGENTS.md §5.19）

## 1. 背景与问题

MAFW 即将接入多个 agent runtime（claude、codex、pi、dsh、kimi、zcode）。今天的 agent 身份（manager、memory-curator）依赖 `agents.install()`（`agentConfigApi` 能力）安装进 runtime 的原生 agent 机制：

- opencode：`~/.config/opencode/agent/manager.md`（frontmatter markdown + permissions）
- pi：`~/.pi/agent/`（prompts + 权限 extension + metadata）

能力矩阵（node-execution 调研实证）：

| runtime | agent 定义 | 语义 |
|---|---|---|
| opencode v1 | ✓ `agents.install` | 常驻注册 |
| pi | ✓ `agentConfigApi` | 常驻注册（MAFW 自建翻译器） |
| Claude Agent SDK | ✓ 最丰富 | **per-query 注入**（`options.agents`，不注册常驻 server） |
| Codex SDK | config 指令键（`developer_instructions` 等） | 无 install API；身份 = config 层 + per-identity 实例（调研修正：main 分支已出现 agent-roles crate，语义未验证） |
| dsh | persona patch / SDK | YAML patch 进 Cordis 配置树（"kits"术语已废弃） |
| kimi | **身份机制最全** | agents/*.md（body=system）+ SYSTEM.md + `--agent` 绑定；ACP 面无身份位 |
| zcode（智谱 Z.ai） | 仅 subagent | `~/.zcode/agents/*.md`（主 Agent 不可自定义 system）；驱动契约未公开 |

（Zed 经查证是 ACP **客户端**，不是可被驱动的 runtime，不在目标列表。）

逐家写翻译器不可持续，且 `AgentDefinition` 的权限词汇表本身是 opencode 形状。**install 语义不能作为通用抽象，身份的源必须收到 gateway。**

**现状缺陷（本次一并修复）**：gateway 驱动的 manager 会话创建时未绑 agent（`index.ts` `createManagerSession` 只传 directory），身份靠一条 `[SYSTEM]` 消息注入（`injectManagerIdentity`）——原生权限护栏没有罩住被驱动的会话，且身份消息会被 compaction 逐渐稀释。

## 2. 目标与非目标

**已确认的四项决策**：

1. **成功标准 = 编排功能等价**：manager session 在任何 runtime 上可跑（身份 system prompt + mafw_* 工具 + 网关统一护栏）；不要求各 CLI 原生 UI 可选。
2. **范围 = 全部 MAFW 身份**：manager + memory-curator + 未来内置身份零成本接入。
3. **工具通道 = 各 runtime 插件自己接 MCP**：gateway 只提供 MCP server（44 工具）+ 文档 + 验证探针。
4. **护栏 = 网关策略层统一执行（源）+ 原生翻译优化**：opencode/pi 现有 install 路径保留为优化通道。

**非目标（YAGNI）**：
- 用户自定义身份文件（`~/.mafw/identities/`）——registry 接口天然支持，本期只内置
- goal 节点 plan/execute/review 的实现——属 goal-loop 线，届时注册进 registry 即零成本
- MCP server 改动
- 跨 runtime 身份状态同步——身份无状态，绑定是 gateway 私有
- **车道 2/3 的宿主侧消费本期不实现**——现有及可预见的可驱动 runtime（opencode/pi/claude/codex/kimi/dsh）均支持物化（车道 1）；spec 保留车道 2/3 为前瞻策略，待首个无法物化的 runtime 出现再实现

## 3. 设计

### 3.1 IdentityRegistry（单一事实源）

```typescript
// gateway/src/runtime/identity-registry.ts
interface IdentitySpec {
  name: string;                    // 'manager' | 'memory-curator' | ...
  description: string;
  scope: 'primary' | 'worker';     // primary=用户可选；worker=管线驱动
  systemPrompt: string;            // 身份提示词（manager-identity.ts 迁入）
  model?: { providerID: string; modelID: string };
  policy: IdentityPolicy;
}

interface IdentityPolicy {
  deny: string[];        // 绝对拒绝的类别标签/工具名（支持前缀通配 mafw_*）
  allowlist?: string[];  // 白名单存在时，未列出即拒
}
```

- **类别标签**（MAFW 中立词汇，非 opencode 形状）：`file-edit`（写文件）/ `shell`（命令执行）/ `subagent`（委派派发）/ `web`（网络获取）/ `readonly`（只读探查）。类别解析表 v1 内置 opencode + pi 两份（`identity-registry.ts`：opencode `edit|write|apply_patch→file-edit`、`task→subagent`、`bash→shell`、`webfetch→web`、`read|grep|glob|ls|list→readonly`；pi 同构）；未来 runtime 插件经 loader extras 声明 `toolCategories` 映射（registerBuiltin extras 已有先例）。
- **内置身份**：`manager`（迁自 `manager-agent-config.ts`）、`memory-curator`（迁自 `memory-curator-agent.ts`）。
- **派生单向**：`toAgentDefinition(spec)` 从注册表派出现有 `AgentDefinition` 喂原生优化通道——install 永远从源派生，无漂移。
- 内置身份的 policy：
  - manager：`deny=[file-edit, subagent]`，`allowlist=[mafw_*（38 个）+ question + plan_exit + shell + read/grep/glob/ls]`
  - memory-curator：`deny=[file-edit, shell, web]`，`allowlist=[记忆三工具 + read/grep/glob/ls]`（对齐现有 HARD_BOUNDARIES）

### 3.2 身份注入——物化为主的三车道（调研实证修订）

调研结论（identity-injection survey）：身份注入的业界事实标准 = **物化（materialization）+ 创建时绑定**，无一例外用消息位做持久身份；compaction 免疫普遍由 runtime 自己保证（Codex strip+重建 / Kimi 每次构建重渲染 / dsh 每步组装重派生 / Claude 旗标重建）。

```
              ┌─ 车道1（默认·主通道）：物化 + 绑定
              │   registry → runtime 插件的 materializer 渲染成原生格式（落盘/进 config）
session→identity ─┼─ 车道2（兜底）：宿主扩展 injectSystem（认知面动词，per-turn 重组）
              └─ 车道3（最弱兜底）：消息位追加（hooks additionalContext / ACP prompt 前缀）
```

**车道 1 的物化目标与绑定机制**（形态 A：md + frontmatter，body = system prompt；形态 B：config 指令键/补丁）：

| runtime | 物化目标 | 绑定机制 |
|---|---|---|
| opencode | `~/.config/opencode/agent/<name>.md`（现役 `installAgentFile` 即物化器） | per-prompt `agent` 参数 |
| pi | `~/.pi/agent/prompts/<name>.md`（现役 `pi-agent-config`） | per-prompt `agent` 参数 |
| claude | Agent SDK `options.agents`（per-query 程序化，动态工厂官方推荐）或 `.claude/agents/*.md` | `options.agent` / agent 参数 |
| codex | config 层 `developer_instructions`（追加 developer 位，比 `instructions` 整替安全）；TS SDK **每身份一个 Codex 实例**，或 app-server v2 per-thread 指令 | per-identity 实例 / thread 参数 |
| kimi | `agents/*.md`（作用域目录）+（可选）`SYSTEM.md` | `--agent`；Server API 会话（**身份必须落盘**——API 的 `system_prompt` 是占位不生效） |
| dsh | personaPrefix/Suffix patch（YAML）或 Python SDK `DSH_SYSTEM_PROMPT` | acp profile + patch / SDK |
| zcode | `~/.zcode/agents/<name>.md`（**仅 subagent**；主 Agent 不可自定义 → primary 身份走车道 2/3） | 新会话生效 |

**选道规则（确定性）**：

```
if (runtime 插件能为身份 X 物化)  → 车道1（物化+绑定；prompt 带 agent 选择器，不再传 system 防双重注入）
else if (runtime 有宿主扩展)      → 车道2（injectSystem 每轮组装身份块，与 memory-guide 同拍）
else                              → 车道3（消息位追加，声明式）
```

**关键性质**：
- **单一源无漂移**：物化永远从 `toAgentDefinition(spec)` 派生。
- **compaction 免疫责任分界**：车道 1 = runtime 承担（逐家实证）；车道 2 = MAFW per-turn 重组（天然免疫）；车道 3 = 不免疫（仅声明）。
- **绑定记录**：gateway 驱动的会话在创建时登记 `session→identity`（泛化现有 `registerInternalSession` 的 role 标记）；用户经桌面/TUI 选身份则为回合级绑定——gateway 在翻译选身份的 prompt 时登记（策略层需要绑定才能评估该回合的工具调用），回合结束不持久。
- **职责分界**：编排面运身份物化与绑定，认知面运记忆（memory-guide/pinned 继续走 HostAdapter injectSystem）——车道 2 复用认知面通道但身份仍由注册表派生，不重复装记忆块。
- **`injectManagerIdentity`（一次性 `[SYSTEM]` 消息）被车道 1/2 替换**——修复身份消息被 compaction 稀释的现状缺陷。
- **opencode per-prompt `system` 参数车道撤销**（append/replace 语义未验证且不再需要——物化+agent 参数已覆盖）。

### 3.3 网关策略层——IdentityPolicy 评估

扩展 `ApprovalPolicyService.evaluate()`。**身份绑定必须先于 internal blanket-deny**——manager 会话本身就是内部会话（`registerInternalSession(sid, 'manager')`），若 internal 先评估会把它全部拒掉。评估顺序：

```
evaluate(sessionID, tool):
  1. 身份绑定存在 → 身份策略（优先于一切）：
     - ∈ policy.deny 或（白名单存在且 ∉ allowlist）→ auto-DENY（绝对）
     - ∈ allowlist 且会话是 gateway 驱动（internal）→ auto-APPROVE（无人值守，不落三档）
     - ∈ allowlist 且会话是用户驱动（回合级绑定）  → 落三档评估（用户在场，档位决定问/不问）
  2. 内部会话无身份绑定 → auto-deny（现有 fail-safe，不变）
  3. 其余 → 现有三档模式评估（read-only/auto/full-access，语义不变）
```

- 身份策略是**硬天花板**：对用户驱动会话，白名单内的工具仍由用户会话档位决定问/不问——身份只能砍掉可能性，永远不能越过用户设的 read-only 放行 shell。
- `IdentityPolicy` 形状：`{ deny: string[]; allowlist?: string[] }`；条目支持**类别标签**（file-edit/shell/subagent/web/readonly）与**工具名**（前缀通配 `mafw_*`）。
- 内置身份的 policy：manager `deny=[file-edit, subagent]`、`allowlist=[mafw_* + question + plan_exit + shell + readonly]`；memory-curator `deny=[file-edit, shell, web]`、`allowlist=[mafw_add_memory + mafw_search_hybrid + mafw_supersede_memory + readonly]`（对齐 MEMORY_CURATOR_TOOLS）。
- **自动应答器已存在**：`applyApprovalPolicy`（`core/approval/hook.ts`）在 approval facet 上同步评估 → 富化 `props.mafwPolicy` → fire-and-forget `permissionReply`。identity 维度接入 evaluate 后双 runtime 自动生效，零新接线。
- deny 决策 reason 带 `identity policy (<name>)` 前缀——desktop 审批卡/日志可区分"身份策略拒" vs "用户模式拒"。
- **最底层软护栏**：identity systemPrompt 内嵌边界声明（memory-curator HARD_BOUNDARIES 模式，manager 身份提示词已含边界段）——无桥 runtime 的诚实降级。

**桥接通道**：

| runtime | 挂钩 | 工作量 |
|---|---|---|
| pi | mafw-host 的 `evaluatePermission` 桥已存在（tool_call → gateway 同步直评） | 只加 identity 查询 |
| opencode | 车道 1 原生 agent 权限 + **applyApprovalPolicy 自动应答器（已存在）** | 只加 identity 维度 |
| claude / codex / kimi… | 各 runtime 插件的 tool 拦截桥（claude 可走 per-query `tools`/`permissionMode` 即车道 1） | 未来各插件 |
| 无桥 runtime | prompt 声明降级 + `GET /api/runtime` 能力明示 | 诚实降级，日志可见 |

### 3.4 原生通道收编、客户端合并、迁移兼容

**物化通道统一收编**：
- `agents.install` 契约动词保留，语义扩展为**物化**——各 runtime 插件实现各自格式（opencode 写 agent md / pi 写 prompts / 未来 claude/codex/kimi/dsh 各自渲染）。opencode/pi 现役实现即物化器，零重写。
- index.ts 启动时两处 install 改为遍历注册表派生：`for identity of registry: if runtime.agentConfigApi → agents.install(name, toAgentDefinition(spec))`。
- 物化成功与否按 `(runtime, identity)` 记录 → 驱动车道选择。runtime 热切换时随 createRuntime 包装器重跑物化。
- `agentConfigApi` 缺失 = 该 runtime 插件未实现物化 → 落车道 2/3；warn 降为 info（"无物化通道，走 injectSystem/消息位兜底"）。

**桌面/TUI agent 列表合并**：
- `GET /api/agents` 合并输出：注册表身份（`source: 'mafw'`）+ runtime 原生 agents（`source: 'runtime'`），注册表在前。任何 runtime 上 manager 都出现在列表（今天 pi 下列表恒空）。
- prompt 路由身份感知：所选身份 ∈ 注册表且该 runtime 无原生安装 → gateway 把 `agent` 参数翻译成 system 组装（车道 2）+ 登记绑定；有原生安装 → 照传 agent（车道 1）。
- plan/build 能力门不受影响（runtime 原生 agents 走 runtime 侧列表）。

**迁移与兼容（零迁移步骤）**：
- manager session 的 kv per-runtime slot 不动；`injectManagerIdentity`（一次性 `[SYSTEM]` 消息）被车道 1/2 替换——存量 manager 会话下次 prompt 自动获得新式注入，旧消息留在历史无害。
- memory-curator 管线：`worker.prompt(…, 'memory-curator')` 的 agent 参数改为会话创建时登记 identity 绑定，prompt 组装按车道决定传 agent 还是 system。
- 用户机器上已装的 opencode `manager.md` 被注册表派生物幂等覆盖。
- workers 的 prompt 声明护栏保留为最底层软护栏。

## 4. 测试与验证

- **单元**：identity-registry（条目/派生/遍历）、物化器（`toAgentDefinition` 派生、(runtime, identity) 成功记录、车道选择规则）、IdentityPolicy 评估（deny-first 顺序、白名单语义、类别解析两表）、prompt 路由身份感知。
- **conformance 新场景 S5 `identity-roundtrip`**：起 manager 会话 → 断言身份经车道 1（agent 定义）或车道 2（injectSystem）到达模型 + 白名单内工具放行、`file-edit` 被拒。
- **回归基线**：240 suites / 1628 tests 全绿（当前 v4.20.0）。
- **线上探针**：opencode 与 pi 双 runtime 验证车道 1 生效（manager prompt 落在 agent 定义上）；dry-run 车道 2（模拟无 agentConfigApi runtime）。

## 5. 部署

- 版本：v4.21.0（加法式架构变更，无破坏面）。
- 交付物：registry + 策略扩展 + prompt 路由 + 客户端合并 + S5 场景；AGENTS.md §5.18/§5.19 增补 IdentityRegistry 段。
