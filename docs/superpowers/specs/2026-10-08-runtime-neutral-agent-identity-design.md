# Runtime 中立 Agent 身份（IdentityRegistry）设计

> 日期：2026-10-08 · 状态：已与用户逐节确认（四节全部 ok）
> 前序调研：`docs/research/2026-10-08-node-execution-runtime-survey.md`（install / at-prompt / config 三策略结论）
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
| Codex SDK | ✗ | 只有 config 覆盖 + AGENTS.md |
| dsh | ✗（developer preview） | 插件 kits 即一切 |
| kimi / zcode | 未查证 | — |

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

- **类别标签**（MAFW 中立词汇，非 opencode 形状）：`file-edit`（写文件）/ `shell`（命令执行）/ `subagent`（委派派发）/ `web`（网络获取）。类别解析表 v1 内置 opencode + pi 两份（`identity-policy.ts`：opencode `edit|write|apply_patch→file-edit`、`task→subagent`、`bash→shell`、`webfetch→web`；pi 同构）；未来 runtime 插件经 loader extras 声明 `toolCategories` 映射（registerBuiltin extras 已有先例）。
- **内置身份**：`manager`（迁自 `manager-agent-config.ts`）、`memory-curator`（迁自 `memory-curator-agent.ts`）。
- **派生单向**：`toAgentDefinition(spec)` 从注册表派出现有 `AgentDefinition` 喂原生优化通道——install 永远从源派生，无漂移。
- 内置身份的 policy：
  - manager：`deny=[file-edit, subagent]`，`allowlist=[mafw_*（38 个）+ question + plan_exit + shell + read/grep/glob/ls]`
  - memory-curator：`deny=[file-edit, shell, web]`，`allowlist=[记忆三工具 + read/grep/glob/ls]`（对齐现有 HARD_BOUNDARIES）

### 3.2 身份注入——三条车道

```
                    ┌─ 车道1：原生策略 ──── promptAsync({agent:'X'}) ──→ runtime 原生 agent 定义
                    │   （install 派生物：原生 system + 原生硬护栏）
session→identity 绑定 ─┼─ 车道2：system 策略 ── promptAsync({system}) ──→ gateway 组装身份提示词
                    │   （网关策略层护栏；compaction 免疫——每次重组）
                    └─ 车道3：prepend 策略 ── 身份块前置进消息首部 ──→ 最弱兜底
                        （连 per-prompt system 都没有的 runtime；网关策略层护栏）
```

**选道规则（确定性）**：

```
if (该 runtime 已成功原生安装身份 X)   → 车道1（promptAsync 带 agent: 'X'，不再传 system 防双重注入）
else if (适配器支持 per-prompt system) → 车道2
else                                   → 车道3
```

**关键性质**：
- **单一源无漂移**：车道 1 的原生定义本就是 `toAgentDefinition(spec)` 派生物——同一份 systemPrompt。
- **compaction 免疫**：车道 1 的 system 在 agent 定义里、车道 2 每次 prompt 重组——修复现状 `[SYSTEM]` 消息被 compaction 稀释的缺陷。
- **已验证地基**：opencode 适配器（`opencode-adapter.ts:94-105`）与 pi（`pi-session.ts:98`）均支持 per-prompt `system` + `agent`——车道 1/2 当天可用；codex 类落车道 2/3。
- **绑定记录**：gateway 驱动的会话在创建时登记 `session→identity`（泛化现有 `registerInternalSession` 的 role 标记）；用户经桌面/TUI 选身份则为回合级绑定——gateway 在翻译选身份的 prompt 时登记（策略层需要绑定才能评估该回合的工具调用），回合结束不持久。
- **职责分界**：编排面运身份（system 参数），认知面运记忆（memory-guide/pinned 继续走 HostAdapter injectSystem）——车道 2 的 system 参数只装身份提示词，不重复装记忆块。

### 3.3 网关策略层——IdentityPolicy 评估

扩展 `ApprovalPolicyService.evaluate()`，评估顺序（**deny-first，身份只收窄不放宽**）：

```
evaluate(sessionID, tool):
  1. 内部会话 → auto-deny          （现有，最高优先）
  2. 身份策略（若 session→identity 有绑定）：
     - tool/类别 ∈ policy.deny        → DENY（绝对，任何会话档位下都拒）
     - 白名单存在且 tool ∉ allowlist  → DENY（未列出即拒绝）
  3. 其余 → 现有三档模式评估（read-only/auto/full-access，语义不变）
```

- 身份策略是**硬天花板**：白名单内的工具仍由用户会话档位决定问/不问——身份只能砍掉可能性，永远不能越过用户设的 read-only 放行 shell。
- **最底层软护栏**：identity systemPrompt 内嵌边界声明（推广 memory-curator HARD_BOUNDARIES 模式到 manager）——无桥 runtime 的诚实降级。

**桥接通道**：

| runtime | 挂钩 | 工作量 |
|---|---|---|
| pi | mafw-host 的 `evaluatePermission` 桥已存在（tool_call → gateway 同步直评） | 只加 identity 查询 |
| opencode | 车道 1 时原生 agent 权限已覆盖；另新增 **permission.asked 自动应答器**（identity 绑定会话的审批请求按策略自动回复，复用 approvals-respond 路由） | 新接线 |
| claude / codex / kimi… | 各 runtime 插件的 tool 拦截桥（claude 可走 per-query `tools`/`permissionMode` 即车道 1） | 未来各插件 |
| 无桥 runtime | prompt 声明降级 + `GET /api/runtime` 能力明示 | 诚实降级，日志可见 |

**观测**：deny 决策带 `identity` 来源标记（desktop 审批卡/日志可区分"身份策略拒" vs "用户模式拒"）。

### 3.4 原生通道收编、客户端合并、迁移兼容

**原生优化通道统一收编**：
- index.ts 启动时两处 install 改为遍历注册表派生：`for identity of registry: if runtime.agentConfigApi → agents.install(name, toAgentDefinition(spec))`。
- install 成功与否按 `(runtime, identity)` 记录 → 驱动车道选择。runtime 热切换时随 createRuntime 包装器重跑 install。
- `agentConfigApi` 语义不变但降级为优化通道：缺失时 warn 降为 info（"无原生优化，走网关策略层"）。

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

- **单元**：identity-registry（条目/派生/遍历）、IdentityPolicy 评估（deny-first 顺序、白名单语义、类别解析两表）、prompt 路由身份感知（车道翻译）。
- **conformance 新场景 S5 `identity-roundtrip`**：起 manager 会话 → 断言 system 含身份块 + 白名单内工具放行、`file-edit` 被拒。
- **回归基线**：240 suites / 1628 tests 全绿（当前 v4.20.0）。
- **线上探针**：opencode 与 pi 双 runtime 验证车道 1 生效（manager prompt 落在 agent 定义上）；dry-run 车道 2（模拟无 agentConfigApi runtime）。

## 5. 部署

- 版本：v4.21.0（加法式架构变更，无破坏面）。
- 交付物：registry + 策略扩展 + prompt 路由 + 客户端合并 + S5 场景；AGENTS.md §5.18/§5.19 增补 IdentityRegistry 段。
