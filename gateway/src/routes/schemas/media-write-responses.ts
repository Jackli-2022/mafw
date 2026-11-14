/**
 * E10h-R6：media 写接口（7 个 op）的 200 响应 schema（`RouteDef.response`）。
 *
 * 只声明 OpenAPI 元数据，不做运行时校验；handler 是事实源：
 *   - `routes/media-switch.ts`（media.switch）
 *   - `routes/media-upload.ts`（media.upload / media.uploadAndCreate /
 *     media.createTaskApi / media.analyzeAudio）
 *   - `http/transport.ts` 的 `/a2a` 分支（media.createTask）
 *   - `routes/media-plugins.ts`（media.pluginsReload）
 *
 * 三个 op 的**请求**是原始字节 / multipart / A2A JSON-RPC（E10g 已排除），
 * 但它们的**响应**都是 JSON，因此全部在本波补 200 schema——唯一例外是
 * `tts.speakStream`（见 tts-write-responses.ts）。
 *
 * 错误体（400/413/415/502/503）不属于 200 形态，不在此建模。
 */
import { Type } from '@sinclair/typebox'
import { MediaPluginsResponse } from './media-voice'

// ── media.switch ────────────────────────────────────────────────────────────

/** 逐模态覆盖（`Config['media'].image|video|audio`）：引擎插件决定值域。 */
const MediaModalityConfigSchema = Type.Object({
  provider: Type.Optional(Type.String()),
  model: Type.Optional(Type.String()),
  engine: Type.Optional(Type.String()),
})

/**
 * `POST /api/media/switch`（handler：`routes/media-switch.ts` `handleMediaSwitch`）。
 *
 * 落盘 + 重载插件后回 `{success:true, media}`：`media` 是**写后重新读回**的
 * `config.raw.media` 四段（顶层 engine + 逐模态覆盖），未涉及的模态原样回显。
 * 引擎名校验失败 / 无字段 → 400，不在本 schema 内。
 */
export const MediaSwitchResponse = Type.Object({
  success: Type.Literal(true),
  media: Type.Object({
    engine: Type.Optional(Type.String()),
    image: Type.Optional(MediaModalityConfigSchema),
    video: Type.Optional(MediaModalityConfigSchema),
    audio: Type.Optional(MediaModalityConfigSchema),
  }, {
    description: 'Effective media config after persist (per-modality overrides echoed verbatim).',
  }),
})

// ── media.upload ────────────────────────────────────────────────────────────

/**
 * `POST /api/media/upload`（handler：`routes/media-upload.ts` `media.upload`）。
 *
 * 请求是原始媒体字节流（E10g 排除），200 是工件引用：`url` 指向
 * `GET /a2a/artifacts/:id`，`size` 是**本次接收**的字节数（非配额余量）。
 */
export const MediaUploadResponse = Type.Object({
  artifactId: Type.String({ description: 'Artifact id usable as a URL part in a later A2A task.' }),
  mediaType: Type.String({ description: 'Effective media type (query ?type= or application/octet-stream).' }),
  size: Type.Number({ description: 'Received byte count for this upload.' }),
  url: Type.String({ description: 'Absolute loopback artifact URL (http://127.0.0.1:<port>/a2a/artifacts/<id>).' }),
})

// ── media.uploadAndCreate ───────────────────────────────────────────────────

/**
 * `POST /api/media/upload-and-create`（handler：同上 `media.uploadAndCreate`）。
 *
 * 上传 + 建任务一次往返：任务**立即**以 working 态返回，分析在后台跑，所以
 * `state` 是网关自己写死的字面量 `TASK_STATE_WORKING`（不是 A2A 回包值）。
 */
export const MediaUploadAndCreateResponse = Type.Object({
  id: Type.String({ description: 'A2A task id (analysis still running in the background).' }),
  contextId: Type.String(),
  state: Type.Literal('TASK_STATE_WORKING', {
    description: 'Always the gateway-seeded working state; later transitions are observed via A2A.',
  }),
  artifactId: Type.String(),
  mediaType: Type.String(),
  size: Type.Number(),
})

// ── media.createTask ────────────────────────────────────────────────────────

/**
 * `POST /a2a`（handler：`http/transport.ts` 的 `/a2a` 分支 →
 * `mediaAgent.handleJsonRpc`，原样透传 status/headers/body）。
 *
 * owner = A2A 协议：200 是 JSON-RPC 2.0 信封（`{jsonrpc:'2.0', id, result}` 或
 * `{jsonrpc, id, error}`），信封字段面归 A2A 演进，gateway 只转字节，故按协议
 * 边界声明为开放对象，**不排除**（仍是 JSON 200 schema）。
 * `Content-Type` 是 `application/a2a+json`——仍是 JSON 体。
 */
export const MediaCreateTaskResponse = Type.Object({}, {
  additionalProperties: true,
  description: 'A2A JSON-RPC 2.0 envelope; fields are owned by the A2A protocol and forwarded verbatim.',
})

// ── media.createTaskApi ─────────────────────────────────────────────────────

/**
 * `POST /api/media/create-task`（handler：同上 `media.createTaskApi`）。
 *
 * 从已上传 artifact 建任务后的**窄投影**（`{id, contextId, state}`，不是 A2A
 * 信封）；`state` 直接取 `task.status?.state || ''`，空串是合法值。A2A 回包
 * 带 `error` → 透传其状态码，不是 200。
 */
export const MediaCreateTaskApiResponse = Type.Object({
  id: Type.String({ description: 'A2A task id.' }),
  contextId: Type.String(),
  state: Type.String({ description: 'A2A task state; empty string when the agent omitted it.' }),
})

// ── media.analyzeAudio ──────────────────────────────────────────────────────

/**
 * `POST /api/media/analyze-audio`（handler：同上 `media.analyzeAudio`）。
 *
 * 叙述式音频理解：`result` 是 media-service 的**自然语言文本**
 * （`MediaService.analyze()` / `analyzeAudioNarrative()` 的真实返回类型是
 * `Promise<string>`；路由的 deps 接口为了可单测写宽成 `unknown`）。
 * 自定义 `prompt` 时走通用 analyze，返回同样是文本。
 */
export const MediaAnalyzeAudioResponse = Type.Object({
  result: Type.String({ description: 'Narrative analysis text (content + prosody/intent, natural language).' }),
})

// ── media.pluginsReload ─────────────────────────────────────────────────────

/**
 * `POST /api/media/plugins/reload`（handler：`routes/media-plugins.ts`）。
 *
 * 重载后回 `{ok:true, plugins}`：`plugins` 与 `media.plugins` 的列表段是
 * **同一个** `getState()` 五键投影（复用同一 schema，不写第二份转写）。
 * loader 未初始化时是静默 no-op → `plugins: []`。
 */
export const MediaPluginsReloadResponse = Type.Object({
  ok: Type.Literal(true),
  plugins: MediaPluginsResponse.properties.plugins,
})
