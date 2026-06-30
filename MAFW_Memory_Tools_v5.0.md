# MAFW v5.0 记忆系统 Tools 设计

## 设计原则

1. **Agent 是调用方**：Agent 通过调用 tools 与记忆系统交互
2. **Plugin 提供 tools**：所有 tools 在 Plugin 中注册，Agent 无感知实现细节
3. **分层暴露**：每层记忆有独立的读写 tools，Agent 按需调用
4. **LLM 压缩隐藏**：Agent 不直接调用压缩，压缩由管道自动触发

---

## Tools 清单

### Tier 1: Working Memory（原始观察）

| Tool | 用途 | 谁调用 |
|------|------|--------|
| `mafw_observe` | 记录原始观察（工具调用、文件修改） | **Plugin 自动**（hook 触发） |
| `mafw_get_observations` | 查询原始观察 | Agent（调试/审计） |

```typescript
// mafw_observe — Plugin 自动调用，Agent 不感知
{
  name: "mafw_observe",
  description: "Record a raw observation. Called automatically by Plugin hooks.",
  parameters: {
    goalId: { type: "string" },
    loopNum: { type: "number" },
    phase: { type: "string", enum: ["plan", "execute", "review"] },
    type: { type: "string", enum: ["tool_use", "file_edit", "llm_call"] },
    content: { type: "string" },
    metadata: { type: "object" }
  }
}

// mafw_get_observations — Agent 调试时调用
{
  name: "mafw_get_observations",
  description: "Get raw observations for a goal/loop/phase. For debugging/auditing only.",
  parameters: {
    goalId: { type: "string" },
    loopNum: { type: "number" },
    phase: { type: "string" },
    since: { type: "string", format: "date-time" }
  }
}
```

---

### Tier 2: Episodic Memory（会话摘要）

| Tool | 用途 | 谁调用 |
|------|------|--------|
| `mafw_get_episode` | 读取某 Loop 的会话摘要 | Agent（跨 Loop 学习） |
| `mafw_list_episodes` | 列出所有会话摘要 | Agent（历史回顾） |

```typescript
// mafw_get_episode — Agent 读取历史经验
{
  name: "mafw_get_episode",
  description: "Read the episodic memory (narrative summary) of a specific loop. Use this to understand what happened in previous loops.",
  parameters: {
    goalId: { type: "string" },
    loopNum: { type: "number" }
  }
}
// 返回: { narrative: "Loop 1 failed due to...", metrics: {...}, timeline: [...] }

// mafw_list_episodes — Agent 查看历史
{
  name: "mafw_list_episodes",
  description: "List all episodic memories for a goal. Use this to see the full history.",
  parameters: {
    goalId: { type: "string" }
  }
}
// 返回: [{ loop: 1, verdict: "FAIL", summary: "..." }, ...]
```

---

### Tier 3: Semantic Memory（结构化事实）

| Tool | 用途 | 谁调用 |
|------|------|--------|
| `mafw_search_semantic` | 搜索结构化事实 | **Agent（主路径）** |
| `mafw_get_facts` | 获取某 Loop 的事实 | Agent（快速查阅） |
| `mafw_get_concepts` | 获取相关概念 | Agent（知识关联） |

```typescript
// mafw_search_semantic — Agent 核心工具
{
  name: "mafw_search_semantic",
  description: "Search semantic memories (facts and concepts) for a goal. Use this to find relevant lessons from previous loops.",
  parameters: {
    goalId: { type: "string" },
    query: { type: "string", description: "Search query, e.g. 'coverage', 'boundary test', 'JWT'" },
    maxResults: { type: "number", default: 5 },
    minEnergy: { type: "number", default: 0.3 }
  }
}
// 返回: { memories: [{ id, facts, concepts, energy, loopNum }] }

// mafw_get_facts — Agent 快速查阅
{
  name: "mafw_get_facts",
  description: "Get all facts from a specific loop. Use this for quick reference.",
  parameters: {
    goalId: { type: "string" },
    loopNum: { type: "number" }
  }
}
// 返回: { facts: ["coverage 60% < 80%", "boundary test missing"] }

// mafw_get_concepts — Agent 知识关联
{
  name: "mafw_get_concepts",
  description: "Get all concepts from a specific loop. Use this to understand the domain.",
  parameters: {
    goalId: { type: "string" },
    loopNum: { type: "number" }
  }
}
// 返回: { concepts: ["jwt", "rs256", "coverage", "boundary-testing"] }
```

---

### Tier 4: Procedural Memory（工作流模式）

| Tool | 用途 | 谁调用 |
|------|------|--------|
| `mafw_find_procedural` | 查找工作流模式 | **Agent（主路径）** |
| `mafw_list_procedural` | 列出所有工作流模式 | Agent（浏览） |

```typescript
// mafw_find_procedural — Agent 核心工具
{
  name: "mafw_find_procedural",
  description: "Find procedural memory (workflow patterns) for the current task. Use this to learn how to do things efficiently.",
  parameters: {
    goalType: { type: "string", description: "e.g. 'auth', 'api', 'database'" },
    technologies: { type: "array", items: { type: "string" }, description: "e.g. ['jwt', 'bcrypt', 'nodejs']" },
    minSuccessRate: { type: "number", default: 0.7 }
  }
}
// 返回: { patterns: [{ id, pattern, successRate, sourceLoops }] }

// mafw_list_procedural — Agent 浏览
{
  name: "mafw_list_procedural",
  description: "List all procedural memories. Use this to see available workflow patterns.",
  parameters: {}
}
// 返回: { patterns: [{ id, type, energy, successRate }] }
```

---

### L3: Parametric Memory（行为约束）

| Tool | 用途 | 谁调用 |
|------|------|--------|
| `mafw_get_deltas` | 获取 Parametric Δ | **Agent（主路径）** |

```typescript
// mafw_get_deltas — Agent 读取行为约束
{
  name: "mafw_get_deltas",
  description: "Get parametric deltas (behavioral constraints) for the current goal and phase. These are rules you MUST follow.",
  parameters: {
    goalId: { type: "string" },
    phase: { type: "string", enum: ["plan", "execute", "review"] },
    maxResults: { type: "number", default: 5 }
  }
}
// 返回: { deltas: [{ id, type, energy, content }] }
```

---

### 记忆管理（通用）

| Tool | 用途 | 谁调用 |
|------|------|--------|
| `mafw_update_memory_energy` | 反馈记忆是否有用 | **Agent（主路径）** |
| `mafw_search_hybrid` | 混合搜索所有记忆层 | **Agent（主路径）** |

```typescript
// mafw_update_memory_energy — Agent 反馈记忆质量
{
  name: "mafw_update_memory_energy",
  description: "Rate whether a memory was useful. This helps the system learn which memories to keep.",
  parameters: {
    memoryId: { type: "string" },
    wasUseful: { type: "boolean", description: "Did this memory help you?" }
  }
}
// 内部: 更新 energy = energy + 0.1 (useful) or -0.05 (not useful)

// mafw_search_hybrid — Agent 一站式搜索
{
  name: "mafw_search_hybrid",
  description: "Search across all memory tiers (semantic + procedural + parametric) using hybrid search. This is the primary way to find relevant memories.",
  parameters: {
    goalId: { type: "string" },
    query: { type: "string", description: "Search query" },
    maxResults: { type: "number", default: 10 },
    tokenBudget: { type: "number", default: 2000 }
  }
}
// 返回: { 
//   semantic: [{ facts, concepts, energy }],
//   procedural: [{ pattern, successRate }],
//   parametric: [{ id, type, content }],
//   totalTokens: 1234
// }
```

---

### 压缩与管道（Plugin 自动）

| Tool | 用途 | 谁调用 |
|------|------|--------|
| `mafw_compress_session` | 压缩 Session 为记忆 | **Plugin 自动**（session.idle 触发） |
| `mafw_cleanup_memories` | 清理低能量记忆 | **Plugin 自动**（定时任务） |

```typescript
// mafw_compress_session — Plugin 自动调用
{
  name: "mafw_compress_session",
  description: "Compress a completed session into episodic + semantic + procedural memories. Called automatically by Plugin.",
  parameters: {
    goalId: { type: "string" },
    loopNum: { type: "number" },
    sessionId: { type: "string" }
  }
}

// mafw_cleanup_memories — Plugin 自动调用
{
  name: "mafw_cleanup_memories",
  description: "Clean up memories with energy below threshold. Called automatically by Plugin.",
  parameters: {
    threshold: { type: "number", default: 0.3 }
  }
}
```

---

## Tools 分类总结

### Agent 主动调用（业务逻辑）

| Tool | 场景 | 频率 |
|------|------|------|
| `mafw_search_hybrid` | 查找相关记忆 | **每 Loop 调用** |
| `mafw_get_deltas` | 读取行为约束 | **每 Phase 调用** |
| `mafw_find_procedural` | 查找工作流模式 | 遇到新任务类型时 |
| `mafw_update_memory_energy` | 反馈记忆质量 | 使用记忆后 |
| `mafw_get_episode` | 回顾历史 | 需要上下文时 |
| `mafw_get_facts` | 快速查阅事实 | 需要具体数据时 |

### Plugin 自动调用（系统逻辑）

| Tool | 触发时机 | 频率 |
|------|---------|------|
| `mafw_observe` | tool.execute.after hook | 每个 tool 调用 |
| `mafw_compress_session` | session.idle 事件 | 每个 Session 结束 |
| `mafw_cleanup_memories` | 定时任务 | 每小时 |

---

## 使用示例

### Plan Agent 执行流程

```markdown
# Plan Agent 工作流程

1. 调用 `mafw_search_hybrid` 查找相关记忆
   - 获取 Semantic 事实（历史失败原因）
   - 获取 Procedural 模式（工作流建议）
   - 获取 Parametric Δ（行为约束）

2. 读取 goals/{goalId}.md 了解目标

3. 生成 Waves 和 Tasks

4. 写入 waves.json

5. 调用 `mafw_update_state` 更新状态

6. 调用 `mafw_update_memory_energy` 反馈记忆是否有用
```

### Execute Agent 执行流程

```markdown
# Execute Agent 工作流程

1. 调用 `mafw_get_deltas` 读取行为约束（如"必须使用 RS256"）

2. 调用 `mafw_find_procedural` 查找工作流模式（如"标准 JWT 配置步骤"）

3. 读取 waves.json 了解当前 Task

4. 执行 Task

5. 调用 `mafw_update_state` 更新状态
```

### Review Agent 执行流程

```markdown
# Review Agent 工作流程

1. 调用 `mafw_search_hybrid` 查找历史审查经验

2. 读取 receipts/ 和 git diff

3. 生成 Review 报告

4. 写入 reviews/

5. 调用 `mafw_update_state` 更新状态

6. Plugin 自动调用 `mafw_compress_session` 压缩为记忆
```

---

## 与 v4.1 的对比

| v4.1 Tools | v5.0 Tools | 变化 |
|-----------|-----------|------|
| `mafw_update_state` | `mafw_update_state` | 保留 |
| `mafw_write_plan` | `mafw_write_plan` | 保留 |
| 无记忆搜索 | `mafw_search_hybrid` | **新增** |
| 无记忆查询 | `mafw_get_episode`, `mafw_get_facts` | **新增** |
| 无工作流模式 | `mafw_find_procedural` | **新增** |
| 无能量反馈 | `mafw_update_memory_energy` | **新增** |
| 无自动观察 | `mafw_observe`（自动） | **新增** |
| 无自动压缩 | `mafw_compress_session`（自动） | **新增** |

---

*核心设计：Agent 通过 `mafw_search_hybrid` 一站式获取所有相关记忆，无需关心记忆分层和存储细节。Plugin 负责自动观察、压缩、清理。*
