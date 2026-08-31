# Agent 运行时重启能力（agentProcessApi）设计

日期：2026-08-31
状态：已批准

## 背景与问题

opencode serve sidecar（4096）目前**没有手动重启手段**，只有三条被动路径：

| 路径 | 机制 | 限制 |
|---|---|---|
| 崩溃退避重启 | `handleServeExit`（index.ts:1630）| 仅 owned serve；SDK `createOpencodeServer` 不暴露子进程/退出回调，静默死亡走不出这条路 |
| 健康看门狗 | `startServeWatchdog`（index.ts:1682）30s×3 连败 | owned → kill+respawn；external → 只重连事件流 |
| `mafw restart` / 桌面 Restart Gateway | 整个 gateway 重启 | 杀鸡用牛刀：SSE/自动化/manager session 全部重来 |

HTTP / MCP / SDK 均无 restart-serve 端点或工具（已 grep 确认）。

### 职责错位

1. **动作硬编码在 gateway**：`recoverServe()`（index.ts:1647）把「kill 4096 + respawn」与「编排」（重订事件流、watchdog 重启、退避计数）混在一起。`killProcessOnPort(4096)` 只对"本机 opencode serve"这一种 runtime 形态成立 —— pi runtime 是进程内 SDK（无进程可杀），未来 runtime 形态各不相同。
2. **`external` 不是能力声明**：`MAFW_SERVER_SERVE_URL` 环境变量直读（opencode-runtime.ts:247）绕过 §5.19 能力契约；watchdog 里 `this.opencodeClient?.external` 分支本应是能力查询。

### 分工原则（本设计核心）

**动作归 runtime，编排归 gateway**：runtime 提供进程重启原语（只有 runtime 自己知道如何重启自己的进程）；gateway 编排恢复序列（事件流重订对任何 runtime 通用）。

## 方案选择

- **A（选定）**：能力契约新增 `agentProcessApi` + `AgentRuntime.agentProcess` 可选接口；gateway `recoverServe()` 优先分发 runtime 原语（回退内建路径向后兼容）；四入口暴露（HTTP/SDK/桌面/MCP）。
- B（否决）：仅 gateway 侧加 `POST /api/serve/restart` 薄端点（不动契约）—— 最小改动但把错误的所有权固化了，pi/外部 runtime 下语义崩坏。
- C（否决）：runtime 全包恢复（含事件流重订）—— 事件流订阅是 gateway 基础设施，runtime 不应触碰；且旧插件无迁移路径。

## §1 能力契约（gateway/src/runtime/contract.ts）

```typescript
RuntimeCapabilities {
  ...,                      // 现有 8 项不变
  agentProcessApi: boolean  // runtime 拥有 agent 进程生命周期（Tier 1+）
}

AgentRuntime {
  ...,                      // 现有成员不变
  agentProcess?: {
    restart(): Promise<void>      // 原语：杀 + 重新拉起 agent 进程（不负责事件流）
    health(): Promise<boolean>
  }
}
```

- `fullCapabilities()` 增加 `agentProcessApi: true`（内置 opencode runtime 全能力）
- **external 语义升级**：`external=true` 时 `capabilities.agentProcessApi=false`（声明依据仍是
  `MAFW_SERVER_SERVE_URL` 环境变量，但表达方式从环境变量直读升级为契约声明）

## §2 职责拆分

- **动作（runtime 拥有）**：opencode 内置 runtime 实现 `agentProcess.restart()` =
  现 `recoverServe()` 的动作段下沉（kill 4096 + respawn serve + 就绪等待）；
  `health()` = 现 `isServeHealthy()`
- **编排（gateway 拥有）**：`recoverServe()` 重构为：
  1. `runtime.agentProcess?.restart()`（能力缺失 → 回退现有内建 kill+respawn 代码，向后兼容旧插件）
  2. 统一 `await this.subscribeToEvents()`
  3. `startServeWatchdog()` + 退避计数（现有逻辑不变）
- 看门狗 owned 分支与手动触发共用同一编排路径；`serveRecovering` 互斥门保留
- 两条"不可用"路径的区分：**能力位为 false**（external/pi）→ HTTP 503 拒绝；
  **能力位为 true 但 `agentProcess` 对象缺失**（旧插件未实现新接口）→ 编排回退内建 kill+respawn，不拒绝

## §3 四个触发入口

| 入口 | 形状 |
|---|---|
| HTTP | `POST /api/runtime/restart-agent`：无 `agentProcessApi` 能力 → `503 { error }`（复用 capGuard）；成功 `200 { success: true, mode: 'owned-respawn' }`；external runtime → 503（与 watchdog"不碰外部进程"语义一致） |
| SDK | `runtime.restartAgent(): Promise<{ success: boolean; mode: string }>`（gateway-sdk types + client + 测试） |
| 桌面 | Config 页"Gateway 运维"卡新增"重启 Agent 运行时"按钮（Restart Gateway 旁的轻量档），toast 反馈；preload `runtime.restartAgent` 桥接 |
| MCP | `mafw_restart_agent` 工具（tool-registry 注册；manager 白名单 36 个；工具描述注明会中断 in-flight prompts） |

## §4 各 runtime 声明矩阵

| runtime | agentProcessApi | 说明 |
|---|---|---|
| opencode（owned） | true | `agentProcess.restart()` 内建实现 |
| opencode（external） | false | 不碰外部进程；restart-agent → 503 |
| pi | false | 进程内 SDK，无进程可重启（将来需要"清会话注册表"式重启再议，YAGNI） |

## §5 边界与非目标

- restart 会中断 in-flight prompts（与 watchdog 行为一致；MCP 工具描述注明）
- restart-agent 与 runtime 热切换互斥：编排期 `serveRecovering` 门已有；runtime-switch 期间到达的请求走同一互斥
- 非目标：external 进程的优雅停止（用户管理的进程用户自己管）；pi 的会话注册表清理式重启；`mafw restart-agent` CLI 子命令（HTTP 已覆盖，后续需要再加）

## §6 改动文件

| 文件 | 动作 |
|---|---|
| gateway/src/runtime/contract.ts | 能力位 + `agentProcess` 接口 + fullCapabilities |
| gateway/src/runtime/opencode-runtime.ts | `agentProcess` 实现（动作段下沉） |
| gateway/src/index.ts | recoverServe 拆分编排/动作 + `POST /api/runtime/restart-agent` 接线 |
| gateway/src/mcp/tool-registry.ts | `mafw_restart_agent` 工具 |
| gateway/tests/unit/runtime/ | 契约/路由单测（仿 runtime-switch.test.ts 风格） |
| opencode-dev/packages/gateway-sdk/src/{types,client}.ts + 测试 | `restartAgent` |
| opencode-dev/packages/desktop/src/{preload,renderer/mafw/pages/Config.tsx} | 桥接 + 按钮 |
| AGENTS.md | §5.15（自更新补充手动重启）、§5.18（白名单 36）、§5.19（能力矩阵）更新 |

## §7 测试与验证

- gateway jest：能力矩阵断言（opencode owned true / external false）；路由测试（能力缺席 503、external 503、owned 200 且编排序列被调用 —— mock runtime 断言 `agentProcess.restart` → `subscribeToEvents` 调用序）；recoverServe 回退路径（旧插件无 agentProcess 仍走内建）
- gateway-sdk：bun test 路由断言
- desktop：typecheck
- 手动：owned 模式 kill 4096 端口进程 → `POST /api/runtime/restart-agent` → serve 恢复且事件流重订；`mafw_restart_agent` MCP 调用同效；external 模式（设 MAFW_SERVER_SERVE_URL）→ 503
