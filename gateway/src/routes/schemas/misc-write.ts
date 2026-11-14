/**
 * E10g-W7：chat / python / obs / models / tools / eval / llm / mobile / devices /
 * skills 写接口的请求体 schema（`RouteDef.request`）。
 *
 * 只有声明，不做运行时校验：字段面逐项来自 handler 的实际读取
 * （`routes/chat.ts`、`routes/python.ts`、`routes/obs.ts`、
 * `routes/model-config.ts`、`routes/tools.ts`、`routes/misc.ts` 的
 * eval adapter、`routes/llm.ts`、`mobile/media-proxy.ts`、
 * `routes/devices-mobile.ts`、`routes/skills.ts`）。
 *
 * 分类（与 W1-W6 同口径）：
 *   - JSON body（`requestRequired` 缺省 true）：`chat.send`、`chat.sendEnriched`、
 *     `python.execute`、`python.restart`、`obs.capture`、`models.update`、
 *     `tools.execute`、`eval.chatCompletions`、`llm.compress`、
 *     `mobile.mediaTaskAsk`、`mobile.devicesRegister`、`mobile.pairingVerify`、
 *     `devices.register`；
 *   - 可选 body + 声明字段（`requestRequired:false`）：`skills.deopt`（空 body
 *     合法 → 默认 reason `manual`）；
 *   - 空对象 + `requestRequired:false`（catalog 直接复用 `EmptyRequest`）：
 *     `devices.delete` / `mobile.devicesDelete`（DELETE 只读路径 `:id`）、
 *     `humanToken.rotate`（E11-1：`{method:'human-token'}` 凭据在头部，body 为空）；
 *   - **排除**：`mobile.mediaTaskUpload`（multipart）在 `media-write.ts` 尾注，
 *     `pods.a2a`（A2A 透传）在 catalog 注释；见收口 `REQUEST_EXCLUDED`。
 */
import { Type } from '@sinclair/typebox'

/** Runtime prompt part 的边界形状：`type` 必填，其余字段由 runtime 归一化。 */
const PromptPart = Type.Object({
  type: Type.String(),
}, { additionalProperties: true })

const ModelRef = Type.Object({
  providerID: Type.String(),
  modelID: Type.String(),
})

// ── chat.send / chat.sendEnriched ─────────────────────────────────────────

/**
 * `POST /api/chat`（handler：`routes/chat.ts` `chat.send`）。
 *
 * fire-and-forget：新建 session 后 `promptAsync`，立即回 `{sessionID}` 供 SSE
 * 订阅。`message` 缺失/空 → 400；runtime 不可用 → 503。
 */
export const ChatSendRequest = Type.Object({
  message: Type.String({
    minLength: 1,
    description: 'Prompt text (required; empty → 400). Sent as a single text part.',
  }),
})

/**
 * `POST /api/chat/enriched`（handler：同上 `chat.sendEnriched`）。
 *
 * 记忆上下文注入版（`mergedSearch` 结果渲染成块后前置到文本）。handler 要求
 * `message` 或 `parts` 至少一个；`sessionID` 缺省时新建 session；挂起中的
 * session → 409。`parts` 是 runtime 原生 part（`type` 必填 + 其余字段开放），
 * 不在这里重复 runtime 的 part 词表。
 */
export const ChatSendEnrichedRequest = Type.Object({
  message: Type.Optional(Type.String({
    description: 'Prompt text (excluding parts). Required when parts is absent.',
  })),
  parts: Type.Optional(Type.Array(PromptPart, {
    description: 'Extra runtime prompt parts (file/agent attachments); required when message is absent.',
  })),
  sessionID: Type.Optional(Type.String({
    description: 'Reuse this session; absent → a new session in the first registered project.',
  })),
  agent: Type.Optional(Type.String({
    description: 'Runtime agent name override for this prompt.',
  })),
  model: Type.Optional(ModelRef),
}, {
  description: 'message or parts is required (both absent → 400).',
})

// ── python.execute / python.restart ───────────────────────────────────────

/**
 * `POST /api/python/execute`（handler：`routes/python.ts` `python.execute`）。
 *
 * loopback-only；`sessionID` + `code` 必填（缺失 → 400）。内核未初始化 → 503，
 * 并发帽 → 429 `quota_exceeded`，执行错误 → 502。`timeoutMs` 只接受 number。
 */
export const PythonExecuteRequest = Type.Object({
  sessionID: Type.String({
    minLength: 1,
    description: 'Session-scoped kernel key (required).',
  }),
  code: Type.String({
    minLength: 1,
    description: 'Python source to execute in the persistent kernel (required).',
  }),
  timeoutMs: Type.Optional(Type.Number({
    description: 'Execution timeout override; non-number values are ignored.',
  })),
})

/**
 * `POST /api/python/restart`（handler：同上 `python.restart`）。
 *
 * 重启会话内核（变量与导入全部丢失）。`sessionID` 必填。
 */
export const PythonRestartRequest = Type.Object({
  sessionID: Type.String({
    minLength: 1,
    description: 'Session-scoped kernel to restart (required).',
  }),
})

// ── obs.capture ───────────────────────────────────────────────────────────

/** `ObsSource`（`routes/obs.ts` 白名单）：非法值 → 400。 */
const ObsSource = Type.Union([
  Type.Literal('user_input'),
  Type.Literal('assistant_reply'),
  Type.Literal('tool_result'),
  Type.Literal('reasoning'),
])

/**
 * `POST /api/obs/capture`（handler：`routes/obs.ts` `obs.capture`）。
 *
 * opencode 宿主的 observation intake（T1 写入 + turn 编号）。**不是**原始
 * 二进制：body 是 JSON，1MB 上限（超出直接断开 socket），`sessionID` +
 * `source` 白名单校验失败 → 400；`content` trim 后为空 → 200 `{deduped:true}`
 * （不进 T1），因此 `content` 不设必填。内部 pipeline 会话与提取提示词内容
 * 会被递归守卫拦成 200 `{deduped:true}`。**任何异常都 fail-open 200
 * `{ok:false}`**，所以「空 body」在 wire 上不是 4xx —— 这里仍按 JSON body
 * 声明（插件每次都发 JSON 对象），schema 描述里注明该 fail-open 行为。
 */
export const ObsCaptureRequest = Type.Object({
  sessionID: Type.String({
    minLength: 1,
    description: 'Originating session (required; missing → 400).',
  }),
  source: ObsSource,
  content: Type.Optional(Type.String({
    description: 'Observation text; empty → 200 {deduped:true} without a T1 write. Truncated to 100k after redaction.',
  })),
  failure: Type.Optional(Type.Boolean({
    description: 'Mark the row as a failed/errored step (stored as 0/1).',
  })),
}, {
  description: 'JSON observation envelope. Missing/invalid sessionID or source → 400; any other error → fail-open 200 {ok:false}.',
})

// ── models.update ─────────────────────────────────────────────────────────

/** 媒体模型对（`provider` 省略时沿用顶层 media.provider）。 */
const MediaModelRef = Type.Object({
  provider: Type.Optional(Type.String()),
  model: Type.Optional(Type.String()),
}, {
  description: 'Empty pair (both "") = reset to the built-in default; partial pairs fall back for validation.',
})

/**
 * `POST /api/model-config`（handler：`routes/model-config.ts`
 * `handleModelConfigUpdate`）。
 *
 * 三段可独立提交，但至少要有一段（否则 400 `No model config specified`）：
 *   - `recall`：worker 模型，必须是完整对（缺 providerID/modelID → 400）；
 *     注意请求是**扁平** `{recall:{providerID,modelID}}`（响应里才包一层
 *     `recall.workerModel`）；
 *   - `goal`：`providerID`/`modelID` 顶层对 = nodeModel（双空串 = 恢复默认，
 *     半空对 → 400）；`goal.techLeadModel` = Tech Lead 覆盖（同规则）；
 *   - `media`：顶层 provider/model + 逐模态覆盖（引擎插件决定值域）。
 * provider 列表不可用（扫描失败）时跳过名字校验。
 */
export const ModelsUpdateRequest = Type.Object({
  recall: Type.Optional(Type.Object({
    providerID: Type.String({ description: 'Worker model provider id (required within recall).' }),
    modelID: Type.String({ description: 'Worker model id (required within recall).' }),
  }, {
    description: 'Worker model; flat pair in the request (workerModel envelope is response-only).',
  })),
  goal: Type.Optional(Type.Object({
    providerID: Type.Optional(Type.String({
      description: 'Goal node model provider; both providerID and modelID empty = reset to identity model.',
    })),
    modelID: Type.Optional(Type.String({
      description: 'Goal node model id; half-empty pair → 400.',
    })),
    techLeadModel: Type.Optional(Type.Object({
      providerID: Type.Optional(Type.String()),
      modelID: Type.Optional(Type.String()),
    }, {
      description: 'Tech Lead model override; both empty = reset; half-empty pair → 400.',
    })),
  })),
  media: Type.Optional(Type.Object({
    provider: Type.Optional(Type.String({
      description: 'Default media provider; both provider and model empty = reset to built-in default.',
    })),
    model: Type.Optional(Type.String()),
    image: Type.Optional(MediaModelRef),
    video: Type.Optional(MediaModelRef),
    audio: Type.Optional(MediaModelRef),
  })),
}, {
  description: 'At least one of recall / goal / media is required (none → 400).',
})

// ── tools.execute ─────────────────────────────────────────────────────────

/**
 * `POST /api/tools/execute`（handler：`routes/tools.ts` `handleToolsExecute`）。
 *
 * 通用 out-of-process 工具执行（loopback-only）。`name` 必填（否则 400），
 * `sessionID` 用于构造工具注册面；`params` 是**工具自定义**负载，原样交给
 * `executeWithToolFrames` —— 只声明开放对象边界，不枚举六件套各自的参数。
 */
export const ToolsExecuteRequest = Type.Object({
  name: Type.String({
    minLength: 1,
    description: 'Tool name from GET /api/tools (unknown → 404 + available list).',
  }),
  sessionID: Type.Optional(Type.String({
    description: 'Session the tool registration surface is built for; absent → empty id.',
  })),
  params: Type.Optional(Type.Object({}, {
    additionalProperties: true,
    description: 'Tool-defined argument object, passed through verbatim.',
  })),
})

// ── eval.chatCompletions ──────────────────────────────────────────────────

/** OpenAI 兼容的 message content：纯文本或多媒体 part 数组（part 由 adapter 解释）。 */
const EvalMessageContent = Type.Union([
  Type.String(),
  Type.Array(Type.Object({}, {
    additionalProperties: true,
    description: 'text | image_url | input_audio | video_url part (EvalScope shapes).',
  })),
])

/**
 * `POST /api/eval/chat/completions`（handler：`routes/misc.ts` →
 * `eval-endpoint.ts` `handleEvalChatCompletion`）。
 *
 * EvalScope 的 OpenAI 兼容适配：body 是 chat-completions 请求，adapter 只读取
 * `model` 与 `messages`（取最后一条 user 消息，把 content 拆成 text + 媒体 part
 * 后驱动一次完整 agent run）。没有 user 消息 / 既无文本也无媒体 → 400（仍是
 * OpenAI 错误信封）。`messages` 的 role 词表与 part 形状归 OpenAI/EvalScope
 * 所有，故只钉 role + 开放 content。
 */
export const EvalChatCompletionsRequest = Type.Object({
  model: Type.Optional(Type.String({
    description: 'Echoed back in the completion; absent → the configured main-agent model.',
  })),
  messages: Type.Array(Type.Object({
    role: Type.String({
      description: 'OpenAI role (system | user | assistant | …); the last user message drives the run.',
    }),
    content: Type.Optional(EvalMessageContent),
  }, {
    additionalProperties: true,
    description: 'Chat message; unknown fields are ignored by the adapter.',
  }), {
    description: 'Chat history (a user message with text or media is required).',
  }),
}, {
  additionalProperties: true,
  description: 'OpenAI-compatible chat completion request (unknown fields tolerated).',
})

// ── llm.compress ──────────────────────────────────────────────────────────

/**
 * `POST /api/llm/compress`（handler：`routes/llm.ts` `llm.compress`）。
 *
 * 经 runtime session 做一次性压缩代理（worker 管线用）。`observations` 必须是
 * 数组（否则 400；空数组合法）；`model` 缺省用 runtime 默认模型。
 */
export const LlmCompressRequest = Type.Object({
  observations: Type.Array(Type.String(), {
    description: 'Observation texts to compress (must be an array; empty array is valid).',
  }),
  model: Type.Optional(Type.String({
    description: 'Model id override for the compression run; absent → runtime default.',
  })),
})

// ── mobile.mediaTaskAsk ───────────────────────────────────────────────────

/**
 * `POST /api/mobile/media/tasks/:id/ask`（handler：`mobile/media-proxy.ts`）。
 *
 * 手机端的追问代理（转发成 A2A `SendMessage` + `referenceTaskIds`）。
 * `question` 必填（缺失/空白 → 400）；问题文本里的外部 URL / IP / localhost
 * 会被拒（400，SSRF 纵深防御）。
 */
export const MobileMediaTaskAskRequest = Type.Object({
  question: Type.String({
    minLength: 1,
    description: 'Follow-up question (required; blank → 400). External URLs are rejected.',
  }),
})

// ── mobile.devicesRegister ────────────────────────────────────────────────

/**
 * `POST /api/mobile/devices/register`（handler：`routes/devices-mobile.ts`
 * `mobile.devicesRegister`）。
 *
 * 手机端注册别名：`token` 是**客户端上报的 FCM push token**（不是网关 bearer
 * token），`id` / `apiTokenHash` 全部由服务端派生（已配对设备用
 * `principal.deviceId`，老客户端用 FCM token 的 hash）。`token` / `platform`
 * 缺失 → 400。
 */
export const MobileDevicesRegisterRequest = Type.Object({
  token: Type.String({
    minLength: 1,
    description: 'FCM push token reported by the app (required); never a gateway credential.',
  }),
  platform: Type.String({
    minLength: 1,
    description: 'Client platform label, e.g. android / ios (required).',
  }),
  deviceName: Type.Optional(Type.String({
    description: 'Human-readable label; ignored by the mobile alias path (persisted by pairing instead).',
  })),
})

// ── mobile.pairingVerify ──────────────────────────────────────────────────

/**
 * `POST /api/mobile/pairing/verify`（handler：同上 `mobile.pairingVerify`）。
 *
 * 未认证端点（nonce 本身即凭据）：单次、5 分钟 TTL、生成侧限流。body 上限
 * `PAIRING_VERIFY_MAX_BODY_BYTES`（超出 → 413 `payload_too_large`）；`nonce`
 * 必填；已配对设备未显式 `rotate:true` → 409 `device_already_paired`
 * （nonce 不被消费）。
 */
export const MobilePairingVerifyRequest = Type.Object({
  nonce: Type.String({
    minLength: 1,
    description: 'Single-use pairing nonce from GET /api/mobile/pairing-code (required).',
  }),
  deviceId: Type.Optional(Type.String({
    maxLength: 128,
    pattern: '^[A-Za-z0-9._:-]+$',
    description: 'Stable device id; absent → a generated uuid. Invalid chars/length → 400.',
  })),
  platform: Type.Optional(Type.String({
    maxLength: 40,
    description: 'Client platform label (too long → 400).',
  })),
  deviceName: Type.Optional(Type.String({
    maxLength: 100,
    description: 'Human-readable device label (too long → 400).',
  })),
  rotate: Type.Optional(Type.Boolean({
    description: 'Required true to re-pair a device that already holds a credential (else 409).',
  })),
})

// ── devices.register ──────────────────────────────────────────────────────

/**
 * `POST /api/devices`（handler：同上 `devices.register`）。
 *
 * legacy 注册别名（push 形状）。`id` 在 device-token principal 下由 transport
 * 注入，因此只有共享 token / loopback 客户端才在 body 里发 `id`；`fcmToken`
 * / `platform` / `token` 恒必填（缺失 → 400）。`apiTokenHash` 由服务端从
 * `token` 计算，客户端无法指定。
 */
export const DevicesRegisterRequest = Type.Object({
  id: Type.Optional(Type.String({
    description: 'Device id; absent → the transport-resolved principal.deviceId (legacy fallback).',
  })),
  fcmToken: Type.String({
    minLength: 1,
    description: 'FCM push token (required).',
  }),
  platform: Type.String({
    minLength: 1,
    description: 'Client platform label (required).',
  }),
  token: Type.String({
    minLength: 1,
    description: 'Presented token; the server derives apiTokenHash from it (required).',
  }),
})

// ── skills.deopt ──────────────────────────────────────────────────────────

/**
 * `POST /api/skills/:name/deopt`（handler：`routes/skills.ts` `skills.deopt`）。
 *
 * 把已安装 playbook 移出发现范围并把 registry 行标 paused（下一次发现边界
 * 生效）。handler 对缺失/非法 body 都回退默认 reason `manual`，因此 body
 * 可缺省；`reason` 截断到 200 字符。未知 skill → 404 `{deopted:false}`。
 */
export const SkillsDeoptRequest = Type.Object({
  reason: Type.Optional(Type.String({
    description: 'Why the skill is deopted; absent/blank → "manual". Truncated to 200 chars.',
  })),
})
