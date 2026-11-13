# 2026-11-13 · Chat 技能调用（runtime-owned invocation）

- **版本**：desktop `5.1.0` / gateway `4.16.1`（未 bump）
- **范围**：runtime contract / opencode adapter / gateway discovery / desktop chat `/`
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
- **Gateway**：`DiscoveryService.invokeSkill`（404 / 409 / 503）+ `DiscoverySnapshot.skillInvokeSupported`
  + `POST /api/sessions/:id/discovery/skills/:key/invoke`；SDK / openapi / runtime-contract 产物已重生成。
- **Desktop**：`/` 技能分组由 `skillInvokeSupported` 门控；`/skill-id` 调用统一的
  `discovery.invokeSkill`，不再把 skill id 传给 `session.command`；`@` 只保留文件/agent。
- **优先级**：MAFW 命令 > runtime 命令 > skill。
- **命令元数据**：runtime command 的 `agent` / `model` 透传给 `session.command`。

## 验证

- gateway 全量：**7170 / 7171**（1 skipped；修复后复核无失败套件）
- desktop 全量：**3831 / 3831**（729 suites）
- gateway-sdk 全量：**226 / 226**
- gateway `tsc --noEmit -p tsconfig.json`：rc=0
- desktop `tsgo --noEmit -p tsconfig.json`：rc=0
- desktop `electron-vite build`：rc=0
- 本轮新增测试：**19**
  - contract surface：1
  - opencode adapter：2
  - gateway service / route / SDK：5
  - desktop slash-resolve / 发送路径 / 元数据 / wiring：11

## 明确未做

- **claude / pi adapter 的 discovery + invoke 尚未接线**：harness 本身有 skill 位
  （pi `loadSkills` + `/skill:name`、claude `supportedCommands` + `/name`），后续只需改各自
  adapter，并实现 `discovery.list` / `loadSkill` / `invokeSkill`；gateway/desktop 不需要改。
- 不做 `/skills` 浏览页、启用/禁用、`allowed-tools`。
- 不接 MCP prompts。
- 不在 gateway 或 desktop 里写任何 runtime 方言。
