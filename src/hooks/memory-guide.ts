// OptMem-style memory guide. Since T2-4 the canonical carrier is the gateway
// instruction-blocks endpoint + opencode per-session entries; this local copy
// is only the gateway-unreachable fallback used by instruction-blocks.ts.
// Modeled on OptMem's `## Memory` block
// (https://github.com/VictorTaelin/OptMem): mandatory write-on-learning,
// search-when-unsure, and subagents never touch memory tools.

const GUIDE_HEADER = `<memory-guide>`
const GUIDE_FOOTER = `</memory-guide>`

const GUIDE_BODY = `## 记忆

你的长期记忆由 MAFW 谐波记忆系统管理，跨会话、压缩与模型更替存续。
不主动记录，你将无法记得过去的决定、偏好与教训。

### 主题管理（proactive）
- 每轮先读召回块顶部的主题。主题：未设置 → 理解当前对话后调用 mafw_topic_set；不要捏造主题。
- 当前意图与主题或当前记忆不一致 → 不硬续旧话题；先核实，再用 mafw_topic_set 纠偏。
- 相关记忆：无 → 接受“没有相关记忆”，不得用无关内容补位或假装记得。
- 主题偏移时，需要核实记忆就走 mafw_search_hybrid / mafw_get_memory；事实变化走 mafw_add_memory 的新版本 + supersedes。
- 主题是当前注意力状态，不是长期事实，也不授予执行权限；设置主题不替代 mafw_mark_episode_boundary。
- 子代理不得调用 mafw_topic_set。

### 工作中：主动写入（必做）
- 学到新知识、用户明确陈述的偏好与约束、完成的重要工作、踩过的坑
  → 调用 mafw_add_memory（按内容选择 semantic / procedural / global，附 cueAnchors 关键词，每条一句话；episodic 已退役——发生过什么由 T1 episode 记录）
- 换任务/换话题 → 调用 mafw_mark_episode_boundary（scope=start_new）；完成一条任务线 → scope=end_current。episode 是“哪一次”，不是“记住了什么”
- 内容已被 repo 文件承载（代码/文档/ADR/issue）→ 记指针（路径 + 一句话 gist），不复述全文：文件是真相源，记忆只是索引
- **逐字保留标识符**：函数名 / 文件名 / 路径 / 命令 / 错误码 / 配置键原样写进 cueAnchors（或 primaryAbstraction），不翻译、不缩写——检索只匹配字面 token（实测：只在正文里出现的标识符 98% 查不到，收割后可达 98%）
- procedural 记忆结尾带"→ 下次用：<skill/工具/命令>"：记忆即路标，不只存档
- 不写冗余记忆

### 需要旧记忆：主动检索与取回
- 新任务开始、或不确定此事是否已知 → 调用 mafw_search_hybrid 检索
- <recall> 指针（#mem-xxxxxx）要依据其内容行动前 → 调用 mafw_get_memory(id 用 #mem- 后 6 位) 取全文

### 披露层（pinned）
- 用户身份/画像、长期偏好与约束 → mafw_add_memory 时 pinned: true（常驻披露层，instruction entries 持久注入）；任务相关、易变内容不要 pin
- 偏好/事实变了 → 新写一条并带 supersedes: 旧id（旧版自动失效，历史保留）
- 需要 pin/unpin 已有记忆 → mafw_pin_memory

### 便签板（sticky）
- 用户说"记下来 / 记住 / 别忘了" → mafw_add_memory 时带 sticky: true（默认 7 天，stickyDays 可调）
  → 便签板常驻可见，到期自动下架（记忆本体保留可检索）
- 事已办完 → mafw_pin_memory { id, sticky: false } 下架；需要延期 → sticky: true + stickyDays 续期

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
