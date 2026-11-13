# 2026-11-13 · Chat 技能调用（runtime-owned invocation）

- **版本**：desktop `5.1.0` / gateway `4.16.1`（未 bump）
- **范围**：runtime contract / opencode + pi + claude adapters / gateway discovery / desktop chat `/`
- **Spec**：`docs/superpowers/specs/2026-11-13-chat-skill-invocation-design.md`
- **Plan**：`docs/superpowers/plans/2026-11-13-chat-skill-invocation.md`
- **架构现状**：`docs/architecture/runtime.md`、`docs/architecture/desktop.md`

## 根因

Desktop 把 skill 当成命令：44 个 skill 全部塞进 `/`，选中后调用
`session.command(skillID)`。opencode 2.2.5 的命令注册表只认 `init` / `review` 等命令，
skill id 不是 command，实测返回 **400**。

同时，技能调用方式在不同 harness 之间不同：

| Harness | 原生 skill 调用 |
|---|---|
| opencode | prompt 里的 `@skill-id` |
| pi | `/skill:name` |
| claude | `/skill-name` |

因此不能在 Desktop 或 gateway 写死某一种语法。

## 交付

- **Runtime contract**：`RuntimeDiscoveryChannel.invokeSkill?` + surface
  `discovery.invokeSkill`（`discoveryApi` + presence 探针；不新增 `RuntimeCapabilities`
  布尔位，避免声明/实现漂移）。
- **opencode adapter**：`invokeSkill` 在 adapter 内发送 `@<id> <args>` prompt；
  `@` 方言只存在于 adapter。
- **pi adapter**：`discovery.list/loadSkill` 走 `pi.loadSkills`；`invokeSkill` 发送
  `/skill:<id> <args>`；`PI_CAPABILITIES.discoveryApi` 打开。
- **claude adapter**：扫描 `.claude/skills/**/SKILL.md` 与 `.claude/commands/`；
  `invokeSkill` 发送 `/<id> <args>`；neutral definition 打开 `discoveryApi`。
- **neutral runtime**：v1 `channels.discovery` 也会接线到 `runtime.discovery`（之前只接 v2）。
- **Gateway**：`DiscoveryService.invokeSkill`（404 / 409 / 503）+ `DiscoverySnapshot.skillInvokeSupported`
  + `POST /api/sessions/:id/discovery/skills/:key/invoke`；SDK / openapi / runtime-contract 产物已重生成。
- **Desktop**：`/` 技能分组由 `skillInvokeSupported` 门控；`/skill-id` 调用统一的
  `discovery.invokeSkill`，不再把 skill id 传给 `session.command`；`@` 只保留文件/agent。
- **优先级**：MAFW 命令 > runtime 命令 > skill。
- **命令元数据**：runtime command 的 `agent` / `model` 透传给 `session.command`。

## 关键 commit

| commit | 内容 |
|---|---|
| `c429a1f4` | runtime contract surface |
| `2287c156` | opencode adapter |
| `0b629e03` | gateway service / route / SDK |
| `be278f94` | desktop `/` + 发送路径 |
| `b2d045be` | pi adapter |
| `9c43611c` | claude adapter |
| `83f43c43` / `654eff7c` | gateway / pi 测试接线更新 |

## 验证

- gateway 全量：**7183 / 7185**（1 skipped；含 pi/claude adapter 用例）
- desktop 全量：**3831 / 3831**（729 suites）
- gateway-sdk 全量：**226 / 226**
- gateway `tsc --noEmit -p tsconfig.json`：rc=0
- desktop `tsgo --noEmit -p tsconfig.json`：rc=0
- desktop `electron-vite build`：rc=0
- 本轮新增测试：**21**
  - contract surface：1
  - opencode adapter：2
  - pi adapter：1
  - claude adapter：1
  - gateway service / route / SDK：5
  - desktop slash-resolve / 发送路径 / 元数据 / wiring：11

## 各 runtime 的调用方式

| Runtime | adapter 内部方言 | 状态 |
|---|---|---|
| opencode | `@<id> <args>` prompt | ✅ |
| pi | `/skill:<id> <args>` | ✅ |
| claude | `/<id> <args>` | ✅ |
| 其他 | 由 adapter 自行实现 `discovery.invokeSkill` | 协议已就绪 |

## 明确未做

- 不做 `/skills` 浏览页、启用/禁用、`allowed-tools`。
- 不接 MCP prompts。
- 不在 gateway 或 desktop 里写任何 runtime 方言。
