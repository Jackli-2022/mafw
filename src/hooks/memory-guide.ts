// OptMem-style memory guide: injected into the system prompt (every turn) so
// the agent actively operates the harmonic memory system instead of relying on
// passive recall injection alone. Modeled on OptMem's `## Memory` block
// (https://github.com/VictorTaelin/OptMem): mandatory write-on-learning,
// search-when-unsure, and subagents never touch memory tools.

const GUIDE_HEADER = `<memory-guide>`
const GUIDE_FOOTER = `</memory-guide>`

const GUIDE_BODY = `## 记忆

你的长期记忆由 MAFW 谐波记忆系统管理，跨会话、压缩与模型更替存续。
不主动记录，你将无法记得过去的决定、偏好与教训。

### 工作中：主动写入（必做）
- 学到新知识、用户明确陈述的偏好与约束、完成的重要工作、踩过的坑
  → 调用 mafw_add_memory（按内容选择 semantic / episodic / procedural，附 cueAnchors 关键词，每条一句话）
- 不写冗余记忆

### 需要旧记忆：主动检索
- 新任务开始、或不确定此事是否已知 → 调用 mafw_search_hybrid 检索

### 子代理
子代理不得调用 mafw_add_memory / mafw_search_hybrid（防止重复写入），由父会话统一管理`

export function buildMemoryGuide(): string {
  return `${GUIDE_HEADER}\n${GUIDE_BODY}\n${GUIDE_FOOTER}`
}

export function memoryGuideHook(input: any, output: any): any {
  if (!output.system) output.system = []
  output.system.push(buildMemoryGuide())
  return output
}
