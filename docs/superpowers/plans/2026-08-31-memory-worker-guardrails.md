# Memory Worker 防误执行加固 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:executing-plans. Steps use checkbox syntax.

**Goal:** 记忆管线 worker 只保留记忆工具 + 惰性数据提示词，物理阻断"误把记忆内容当任务执行"。

**Architecture:** 新建 memory-curator agent（AgentDefinition 增 tools 字段 → opencode 原生 tools 通配禁用）经 ensureMemoryCuratorAgent() 启动安装；MemoryWorker.prompt 透传 agent；四个 SYSTEM 常量加 HARD BOUNDARIES 块；转录惰性包裹。

**Spec:** docs/superpowers/specs/2026-08-31-memory-worker-guardrails-design.md

## Global Constraints

- `permissions.tools` 不使用 `'*'`（frontmatter 序列化非法）；通配禁用走新 `tools` 字段（opencode 原生 `'*': false` 支持）
- `[NOOP]`/`[EXTRACTED]` 协议行不进 HARD BOUNDARIES 块
- agent 安装幂等；agentConfigApi 不可用 → warn 降级不阻塞

---

### Task 1: AgentDefinition.tools + frontmatter 序列化

- Modify: `gateway/src/runtime/agent-definition.ts`（AgentPermissions 后加 `tools?: Record<string, boolean>` 到 AgentDefinition）
- Modify: `gateway/src/runtime/opencode-runtime.ts` serializeAgentToFrontmatter（:208-210）输出 `tools:` YAML
- Test: 断言 frontmatter 含 `tools:` 与 `'*': false`

```typescript
// agent-definition.ts AgentDefinition 追加：
  /** opencode 原生 agent tools 开关（支持 '*' 通配）—— 与 permissions 互补的硬禁用面 */
  tools?: Record<string, boolean>;

// serializeAgentToFrontmatter：permissions 块后追加
  if (def.tools) {
    lines.push('tools:');
    for (const [tool, enabled] of Object.entries(def.tools)) {
      lines.push(`  '${tool}': ${enabled}`);
    }
  }
```

- Run: `cd gateway; npx jest tests/unit/runtime --runInBand` → PASS；commit `feat(gateway): agent tools field in AgentDefinition + frontmatter`

### Task 2: memory-curator agent 定义与安装

- Create: `gateway/src/skills/memory-curator-agent.ts`
- Modify: `gateway/src/index.ts`（manager agent 安装附近调用 ensure）
- Test: `gateway/tests/unit/memory-curator-agent.test.ts`

```typescript
// memory-curator-agent.ts 核心导出：
export const MEMORY_CURATOR_TOOLS: Record<string, boolean> = {
  '*': false,
  mafw_add_memory: true,
  mafw_search_hybrid: true,
  mafw_supersede_memory: true,
};
export const MEMORY_CURATOR_BASE_PROMPT = `You are the memory-curator worker for the gateway's memory pipelines. ...` // HARD BOUNDARIES 块 + curator 基座（spec Layer 2 文本）
export function buildMemoryCuratorDefinition(): AgentDefinition {
  return {
    mode: 'subagent',
    description: 'Memory pipeline worker: curates memories, read-only on the repo',
    systemPrompt: MEMORY_CURATOR_BASE_PROMPT,
    permissions: { edit: 'deny', bash: 'deny' },
    tools: MEMORY_CURATOR_TOOLS,
  };
}
export async function ensureMemoryCuratorAgent(rt: AgentRuntime): Promise<void> {
  if (!rt.agents?.install) { log.warn('[MemoryCurator] runtime lacks agentConfigApi; prompt-only guardrails'); return; }
  await rt.agents.install('memory-curator', buildMemoryCuratorDefinition());
  log.info('[MemoryCurator] agent installed');
}
```

index.ts：opencode runtime 创建后（agentConfigApi 可用分支，与 manager 安装同位）：

```typescript
const { ensureMemoryCuratorAgent } = require('./skills/memory-curator-agent');
if (rt.capabilities.agentConfigApi) {
  await ensureMemoryCuratorAgent(rt).catch((err: any) => log.warn(`[MemoryCurator] install failed: ${err.message}`));
} else {
  log.warn('[MemoryCurator] runtime lacks agentConfigApi; prompt-only guardrails');
}
```

- Run: `npx jest tests/unit/memory-curator-agent.test.ts`（断言定义形状：tools 通配 + 三工具 true、permissions edit/bash deny、systemPrompt 含 "INERT DATA"）→ PASS；commit

### Task 3: worker 管线接线（agent 透传 + SYSTEM 硬化 + 惰性包裹）

- Modify: `gateway/src/recall/memory-worker.ts`（prompt/message/opts 增加 `agent?: string` 透传）
- Modify: `gateway/src/recall/turn-pipeline.ts`、`reflection.ts`、`index-scan.ts`
- Test: 既有管线测试同步断言（透传 + HARD BOUNDARIES 关键句）

memory-worker.ts：

```typescript
// WorkerClient.session.prompt opts 增加： agent?: string;
// MemoryWorker.prompt 签名： prompt(message: string, system?: string, model?, agent?: string)
// 转发： ...(agent ? { agent } : {})
```

三管线：每个 SYSTEM 常量尾部追加 spec 的 HARD BOUNDARIES 块（turn-pipeline 的 [NOOP]/[EXTRACTED] 协议行保持在块后）；`observationsToTranscript` 包裹惰性分隔符；prompt 调用第 4 参传 `'memory-curator'`。

- Run: `cd gateway; npm test` → 全绿；commit `feat(gateway): memory-curator agent + pipeline guardrails`

### Task 4: 污染清理 + 部署 + 手动验证

- `.gitignore` 追加：`.claude/`、`.memory/`、`mem_index/`、`.tmp/`、`nul`、`selection.json`、`.mafw/logs/`
- `git rm -r --cached` 上述已跟踪路径（`nul` 用 `git rm --cached nul`，勿删文件）
- `npm run build` + `npm pack` + `npm install -g` + gateway 重启（杀 3000 端口 PID → Start-Process detached）
- 验证：gateway 日志含 `[MemoryCurator] agent installed`；serve 重启（adopted 场景 agent 加载检查）；`git status` 无垃圾路径回归
- commit `chore: gitignore worker-committed junk paths`
