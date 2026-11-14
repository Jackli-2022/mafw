/**
 * E10g-W7：media / TTS 写接口的请求体 schema（`RouteDef.request`）。
 *
 * 只有声明，不做运行时校验：字段面逐项来自 handler 的实际读取
 * （`routes/media-switch.ts`、`routes/media-upload.ts`、`routes/tts.ts`、
 * `routes/tts-interrupt.ts`）。空 body / 非法 JSON 的 400 是 handler 语义，
 * 不复制校验逻辑。
 *
 * 分类（与 W1-W6 同口径）：
 *   - JSON body（`requestRequired` 缺省 true）：`media.switch`、
 *     `media.createTaskApi`、`media.analyzeAudio`、`tts.speak`、
 *     `tts.speakStream`、`tts.interrupt`；
 *   - 空对象 + `requestRequired:false`：`media.pluginsReload`（handler 不读
 *     body，catalog 直接复用 `EmptyRequest`）；
 *   - **排除**：`media.upload` / `media.uploadAndCreate`（原始字节流 + query）、
 *     `media.createTask`（`POST /a2a` A2A JSON-RPC 透传）、
 *     `mobile.mediaTaskUpload`（multipart/form-data）—— 见文件尾与收口
 *     `REQUEST_EXCLUDED` 台账。
 */
import { Type } from '@sinclair/typebox'

// ── media.switch ──────────────────────────────────────────────────────────

/** 媒体引擎选择：`{engine}` 全局默认 + 逐模态覆盖；未给出的模态保持原值。 */
const MediaEngineRef = Type.Object({
  engine: Type.Optional(Type.String({
    description: 'Media engine plugin name, or "pi" (always available).',
  })),
})

/**
 * `POST /api/media/switch`（handler：`routes/media-switch.ts` `handleMediaSwitch`）。
 *
 * 未知引擎 → 400（`available` 列在错误体里），一个引擎都没给 → 400
 * `No engine specified`；因此 body 本身必填而字段全部可缺省。持久化后
 * 立即 reload 媒体插件，响应回读新的 effective config。
 */
export const MediaSwitchRequest = Type.Object({
  engine: Type.Optional(Type.String({
    description: 'Default media engine for every modality (absent → unchanged).',
  })),
  image: Type.Optional(MediaEngineRef),
  video: Type.Optional(MediaEngineRef),
  audio: Type.Optional(MediaEngineRef),
}, {
  description: 'At least one engine (top-level or per-modality) is required; none → 400.',
})

// ── media.createTaskApi ───────────────────────────────────────────────────

/**
 * `POST /api/media/create-task`（handler：`routes/media-upload.ts`
 * `media.createTaskApi`）。
 *
 * 从**已上传**的 artifact 建 A2A 任务（`SendMessage`）。`artifactId` 缺失 →
 * 400；`mediaType` 缺省时读 artifact 记录的 content type；`question` 作为
 * 第二个 text part 追加。
 */
export const MediaCreateTaskApiRequest = Type.Object({
  artifactId: Type.String({
    minLength: 1,
    description: 'Artifact id returned by media.upload / media.uploadAndCreate.',
  }),
  question: Type.Optional(Type.String({
    description: 'Follow-up question appended as a text part; absent → media-only task.',
  })),
  mediaType: Type.Optional(Type.String({
    description: 'Override the artifact content type; absent → recorded type or application/octet-stream.',
  })),
})

// ── media.analyzeAudio ────────────────────────────────────────────────────

/**
 * `POST /api/media/analyze-audio`（handler：同上 `media.analyzeAudio`）。
 *
 * loopback-only；`dataUrl` 必填（缺失 → 400）。`prompt` 缺省时走
 * `analyzeAudioNarrative`（内容 + 情绪/语调轨迹 + 意图），给出则覆盖默认提示词。
 */
export const MediaAnalyzeAudioRequest = Type.Object({
  dataUrl: Type.String({
    minLength: 1,
    description: 'data: URL of the audio payload (required; empty → 400).',
  }),
  mediaType: Type.Optional(Type.String({
    description: 'MIME type; absent → audio/wav.',
  })),
  prompt: Type.Optional(Type.String({
    description: 'Custom analysis prompt; absent → the narrative (content + prosody + intent) pass.',
  })),
})

// ── tts.speak / tts.speakStream / tts.interrupt ───────────────────────────

/**
 * `POST /api/tts`（handler：`routes/tts.ts` `tts.speak`）。
 *
 * 整段合成成 wav artifact。TTS 未初始化 → 503；`text` trim 后为空 → 400。
 * `voice` / `style` 缺省由引擎配置决定。
 */
export const TtsSpeakRequest = Type.Object({
  text: Type.String({
    minLength: 1,
    description: 'Text to synthesize (trimmed; empty → 400).',
  }),
  voice: Type.Optional(Type.String({
    description: 'Preset voice name; absent → media.tts.defaultVoice.',
  })),
  style: Type.Optional(Type.String({
    description: 'Prosody/style instruction for engines that support it.',
  })),
})

/**
 * `POST /api/tts/stream`（handler：同上 `tts.speakStream`）。
 *
 * 响应是 SSE（PCM16 分块 + `x-tts-sample-rate`），**请求仍是 JSON**。
 * loopback-only；`sessionId` 用于在途集合登记，供 `tts.interrupt` 取消。
 */
export const TtsSpeakStreamRequest = Type.Object({
  text: Type.String({
    minLength: 1,
    description: 'Text to synthesize sentence-by-sentence (trimmed; empty → 400).',
  }),
  voice: Type.Optional(Type.String({
    description: 'Preset voice name; absent → media.tts.defaultVoice.',
  })),
  style: Type.Optional(Type.String({
    description: 'Prosody/style instruction for engines that support it.',
  })),
  sessionId: Type.Optional(Type.String({
    description: 'Session key for the in-flight set (barge-in target); absent → untracked stream.',
  })),
})

/**
 * `POST /api/tts/interrupt`（handler：`routes/tts-interrupt.ts`
 * `handleTtsInterrupt`）。
 *
 * loopback-only barge-in：取消该 session 全部在途合成。`sessionId` 缺失
 * （或 body 不是合法 JSON）→ 400。
 */
export const TtsInterruptRequest = Type.Object({
  sessionId: Type.String({
    minLength: 1,
    description: 'Session whose in-flight TTS streams are aborted (required; empty → 400).',
  }),
})

// ── 排除（W7 收口）─────────────────────────────────────────────────────────
//
// `media.upload` / `media.uploadAndCreate`：body 是**原始媒体字节**
// （`for await (const chunk of req)` + 尺寸帽），输入元数据全在 query
// （`type` / `question`）。声明 `application/octet-stream` + `Type.String()`
// 对客户端没有信息量，还会把「未声明形状」算成已覆盖 —— 按 spec §1.3 排除，
// 由收口的 `REQUEST_EXCLUDED` 台账记录；建任务的 JSON 面是
// `media.createTaskApi`（已覆盖）。
//
// `media.createTask`（`POST /a2a`）：A2A JSON-RPC 透传（`transport.ts` 只
// `JSON.parse` 后交给 `mediaAgent.handleJsonRpc`，响应 content-type
// `application/a2a+json`；非法 JSON 也原样传字符串）。信封归 A2A 协议所有，
// 排除。
//
// `mobile.mediaTaskUpload`：`multipart/form-data` 文件部 + boundary 解析
// （`mobile/media-proxy.ts`），不是 JSON body，排除。
