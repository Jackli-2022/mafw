/**
 * E10h-R6：TTS 写接口（2 个 op）的 200 响应 schema（`RouteDef.response`）。
 *
 * 只声明 OpenAPI 元数据，不做运行时校验；handler 是事实源：
 *   - `routes/tts.ts`（tts.speak / tts.speakStream）
 *   - `routes/tts-interrupt.ts`（tts.interrupt）
 *
 * **`tts.speakStream` 是唯一被排除的写 op**：200 是
 * `Content-Type: text/event-stream` 的 PCM16 分块流（`data: {data,voice}` … +
 * 终止帧 `{"done":true}`），在 chunked 流上不是单个 JSON 文档——按 spec §1.1
 * 排除（收口 `WRITE_RESPONSE_EXCLUDED` 记录原因），**不声明 `response`**。
 *
 * 错误体（400/403/502/503）不属于 200 形态，不在此建模。
 */
import { Type } from '@sinclair/typebox'

// ── tts.speak ───────────────────────────────────────────────────────────────

/**
 * `POST /api/tts`（handler：`routes/tts.ts` `tts.speak`）。
 *
 * 整段合成 → wav 工件引用：`mime` 是 handler 写死的字面量 `audio/wav`，
 * `voice` 是请求回显（缺省回落到配置默认音色），`url` 指向
 * `GET /a2a/artifacts/:id`。TTS 未初始化 → 503、空文本 → 400、引擎异常 → 502。
 */
export const TtsSpeakResponse = Type.Object({
  artifactId: Type.String({ description: 'Artifact id of the synthesized wav.' }),
  voice: Type.String({ description: 'Effective voice (request value, else the configured default).' }),
  mime: Type.Literal('audio/wav', { description: 'Always wav; the streaming endpoint is tts.speakStream.' }),
  url: Type.String({ description: 'Absolute loopback artifact URL (http://127.0.0.1:<port>/a2a/artifacts/<id>).' }),
})

// ── tts.interrupt ───────────────────────────────────────────────────────────

/**
 * `POST /api/tts/interrupt`（handler：`routes/tts-interrupt.ts`
 * `handleTtsInterrupt`）。
 *
 * barge-in：取消该 session 全部在途合成后回 `{ok:true, cancelled}`；
 * `cancelled` 是被打断的合成数（0 也是正常回执——没有在途流）。`sessionId`
 * 缺失 → 400。
 */
export const TtsInterruptResponse = Type.Object({
  ok: Type.Literal(true),
  cancelled: Type.Number({ description: 'Number of in-flight syntheses aborted for this session (0 is valid).' }),
})
