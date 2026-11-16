/**
 * E10h-R6：内部执行面写接口（8 个 op）的 200 响应 schema（`RouteDef.response`）。
 *
 * 只声明 OpenAPI 元数据，不做运行时校验；handler 是事实源：
 *   - `routes/chat.ts`（chat.send / chat.sendEnriched）
 *   - `routes/python.ts`（python.execute / python.restart）
 *   - `routes/obs.ts`（obs.capture）
 *   - `routes/tools.ts`（tools.execute）
 *   - `routes/misc.ts` → `eval-endpoint.ts`（eval.chatCompletions）
 *   - `routes/llm.ts` → `kernel.handleCompress`（llm.compress）
 *
 * 这一面全是 loopback-only / internal 端点（SDK 只覆盖 chat 两个），错误体在
 * 400/429/502/503 上，不属于 200 形态。
 *
 * 只有 `obs.capture` 是**任何异常都 fail-open 200**，因此它的 200 必须带
 * `ok:false` 分支（不是错误体，是正常回执）。
 */
import { Type } from '@sinclair/typebox'

// ── chat.send / chat.sendEnriched ───────────────────────────────────────────

/**
 * `POST /api/chat`（handler：`routes/chat.ts` `chat.send`）。
 *
 * fire-and-forget：新建 session 后 `promptAsync`，立即回 `{sessionID}` 供 SSE
 * 订阅；200 只有这一个键（正文随后经事件流到达）。
 */
export const ChatSendResponse = Type.Object({
  sessionID: Type.String({ description: 'Session the prompt was dispatched to; subscribe to its SSE stream.' }),
})

/**
 * `POST /api/chat/enriched`（handler：同上 `chat.sendEnriched`）。
 *
 * 记忆注入版的 200 与 `chat.send` **严格同形**（`{sessionID}`）——复用同一
 * schema 对象，不复写第二份转写。
 */
export const ChatSendEnrichedResponse = ChatSendResponse

// ── python.execute ──────────────────────────────────────────────────────────

/** Jupyter 错误信封（`PythonExecuteResult['error']`）：只有引擎异常时出现。 */
const PythonErrorSchema = Type.Object({
  ename: Type.String(),
  evalue: Type.String(),
  traceback: Type.Array(Type.String()),
})

/** display_data 附件（matplotlib 图等）：base64 载荷 + mime。 */
const PythonAttachmentSchema = Type.Object({
  mimeType: Type.String(),
  data: Type.String({ description: 'base64 payload (no data: prefix).' }),
})

/**
 * `POST /api/python/execute`（handler：`routes/python.ts` → `kernel-service.ts`
 * `PythonExecuteResult`）。
 *
 * 内核执行结果**本体**（无信封）：`status` 三态里 `aborted` 是超时/中断，
 * `error` 是 Python 异常（`stdout`/`stderr` 同时可能非空）。`truncated` 为真时
 * handler 已把截断说明追加到 `stdout` 末尾。`kernelRestarted` 只在本次调用前
 * 触发过自动重启时出现。
 */
export const PythonExecuteResponse = Type.Object({
  stdout: Type.String(),
  stderr: Type.String(),
  result: Type.Optional(Type.String({ description: 'repr of the last expression value, when the kernel reports one.' })),
  error: Type.Optional(PythonErrorSchema),
  status: Type.Union([Type.Literal('ok'), Type.Literal('error'), Type.Literal('aborted')]),
  durationMs: Type.Number(),
  truncated: Type.Boolean({ description: 'Output hit maxOutputChars; a truncation note was appended to stdout.' }),
  attachments: Type.Array(PythonAttachmentSchema, {
    description: 'display_data attachments emitted by this execution (usually empty).',
  }),
  kernelRestarted: Type.Optional(Type.Boolean({
    description: 'Present only when the kernel was restarted before this call (state lost).',
  })),
})

// ── python.restart ──────────────────────────────────────────────────────────

/**
 * `POST /api/python/restart`（handler：同上 `python.restart`）。
 *
 * 重启会话内核（变量与导入全部丢失）→ 常量回执 `{ok:true}`；`sessionID`
 * 缺失 → 400，内核未初始化 → 503。
 */
export const PythonRestartResponse = Type.Object({
  ok: Type.Literal(true),
})

// ── obs.capture / obs.episodeBoundary ───────────────────────────────────────

/**
 * `POST /api/obs/capture`（handler：`routes/obs.ts` `obs.capture`）。
 *
 * T1 观察写入回执。成功分支四个键恒在：
 *   - `id`：新写入行的行号，三种「不落盘」路径（空内容 / 内部会话 /
 *     提取提示词内容）都是 `null`；
 *   - `deduped`：`id === null`（含数据库 UNIQUE 去重）；
 *   - `turnId`：本观察归属的 turn 序号（不落盘时是 0 或当前 turn）；
 *   - `traceId`：只有真正写入时才带。
 * `internal` / `filtered` 是两个递归守卫的标记（各自只在自己那条路径出现）。
 *
 * 失败分支是 **fail-open**：解析/写库异常一律 200 `{ok:false,error}`，
 * 插件侧永远不需要重试。超 1MB 时 handler 直接 `req.destroy()`（不写响应），
 * 不属于 200 形态。
 */
const EpisodeBoundarySchema = Type.Object({
  sessionId: Type.String(),
  afterTurn: Type.Number({ description: 'Canonical edge: turn N stays in the old episode, N+1 starts the new one.' }),
  source: Type.Union([Type.Literal('agent'), Type.Literal('user'), Type.Literal('system')]),
  reason: Type.Optional(Type.String()),
  intent: Type.Optional(Type.String()),
  createdAt: Type.Number(),
})

export const ObsCaptureResponse = Type.Union([
  Type.Object({
    ok: Type.Literal(true),
    id: Type.Union([Type.Number(), Type.Null()], {
      description: 'T1 row id; null when nothing was written (empty / internal / filtered / deduped).',
    }),
    turnId: Type.Number({ description: 'Logical turn ordinal this observation belongs to.' }),
    traceId: Type.Optional(Type.String({ description: 'Trace id of the turn; absent when nothing was written.' })),
    deduped: Type.Boolean({ description: 'id === null (including the database UNIQUE dedup).' }),
    internal: Type.Optional(Type.Literal(true, {
      description: 'Internal pipeline session: the observation was dropped by recursion guard A.',
    })),
    filtered: Type.Optional(Type.Literal(true, {
      description: 'Content matched an extraction prompt: dropped by recursion guard B.',
    })),
    episodeBoundary: Type.Optional(EpisodeBoundarySchema),
  }, {
    description: 'Capture accepted (written, deduped, or intentionally dropped by a recursion guard).',
  }),
  Type.Object({
    ok: Type.Literal(false),
    error: Type.String({ description: 'Captured error, returned fail-open so the plugin never has to retry.' }),
  }, {
    description: 'Fail-open receipt: capture errors never surface as 4xx/5xx.',
  }),
])

/**
 * `POST /api/obs/episode-boundary` — 200 receipts for an appended edge, a
 * queued next-user-turn flag, or a no-op (no completed turn yet).
 */
export const ObsEpisodeBoundaryResponse = Type.Object({
  ok: Type.Literal(true),
  pending: Type.Optional(Type.Boolean()),
  ignored: Type.Optional(Type.Boolean()),
  boundary: Type.Optional(EpisodeBoundarySchema),
})

// ── tools.execute ───────────────────────────────────────────────────────────

/**
 * `POST /api/tools/execute`（handler：`routes/tools.ts` `handleToolsExecute` →
 * `executeWithToolFrames`）。
 *
 * 200 是工具本体返回的 `ToolResult`：`text` 是给模型的文本，`isError` 只在
 * 工具自己判定失败时出现（此时仍可能带文本）。未知工具 → 404（附
 * `available` 名单），工具抛异常 → 502。
 */
export const ToolsExecuteResponse = Type.Object({
  text: Type.String({ description: 'Tool output text (may be empty).' }),
  isError: Type.Optional(Type.Boolean({ description: 'Present only when the tool reported its own failure.' })),
})

// ── eval.chatCompletions ────────────────────────────────────────────────────

/**
 * `POST /api/eval/chat/completions`（handler：`routes/misc.ts` →
 * `eval-endpoint.ts` `completion()`）。
 *
 * EvalScope 的 OpenAI 兼容适配：200 是**网关自己构造**的 chat.completion 信封
 * （不是上游模型回包透传），字段面固定：一条 assistant choice + 全零 usage
 * （适配器不做 token 计量）；`id` 是 `eval-<sessionId>`。没有 user 消息 /
 * 既无文本也无媒体 → 400（OpenAI 错误信封），prompt 失败 → 502。
 */
export const EvalChatCompletionsResponse = Type.Object({
  id: Type.String({ description: 'eval-<sessionId>.' }),
  object: Type.Literal('chat.completion'),
  model: Type.String({ description: 'Request model echo, else <provider>/<model> of the eval adapter.' }),
  choices: Type.Array(Type.Object({
    index: Type.Number(),
    finish_reason: Type.Literal('stop', { description: 'The adapter always reports stop; polling stops on settle/timeout.' }),
    message: Type.Object({
      role: Type.Literal('assistant'),
      content: Type.String({ description: 'Final assistant answer (empty string when the run settled with no text).' }),
    }),
  }), {
    description: 'Always exactly one choice (index 0).',
  }),
  usage: Type.Object({
    prompt_tokens: Type.Number({ description: 'Always 0: the adapter does not meter tokens.' }),
    completion_tokens: Type.Number({ description: 'Always 0: the adapter does not meter tokens.' }),
    total_tokens: Type.Number({ description: 'Always 0: the adapter does not meter tokens.' }),
  }),
})

// ── llm.compress ────────────────────────────────────────────────────────────

/**
 * `POST /api/llm/compress`（handler：`routes/llm.ts` → `kernel.handleCompress`
 * → `parseLLMResponse`）。
 *
 * 压缩结果四键恒在：`narrative` 是模型摘要（解析失败时是原文前 200 字符），
 * `energy` 是模型给出的 0..1 权重（缺失/非数 → 0.5），`facts` / `concepts`
 * 是**模型自定义**的数组（gateway 只保证是数组，元素形状不承诺）。
 * `observations` 非数组 → 400。
 */
export const LlmCompressResponse = Type.Object({
  narrative: Type.String({ description: 'Summary of what happened (raw text slice when the model reply was not JSON).' }),
  facts: Type.Array(Type.Unknown(), {
    description: 'Model-emitted facts; elements are model-defined (gateway only guarantees an array).',
  }),
  concepts: Type.Array(Type.Unknown(), {
    description: 'Model-emitted keywords; elements are model-defined (gateway only guarantees an array).',
  }),
  energy: Type.Number({ description: 'Model-reported salience weight; absent/non-numeric → 0.5.' }),
})
