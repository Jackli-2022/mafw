/**
 * E10f-B：model / media / voice / python / agent / embedding 读面（8 ops）的 code-first 响应 schema。
 *
 * 只加 OpenAPI 元数据（`RouteDef.response`），不改变任何 handler 的 wire 形状；
 * `emit:openapi` 直接投影成 `responses.200.content['application/json'].schema`。
 * 形状来源（handler 是事实源）：
 *   - models.get           → routes/model-config.ts `handleModelConfigGet()`（config 段 + provider 扫描）
 *   - media.plugins        → routes/media-plugins.ts（media-loader `getState()` 五键投影）
 *   - tts.voices           → routes/tts.ts（engine.voices() + engine.profile + registry.list()）
 *   - voice.status         → voice/routes/voice-status.ts（config + ASR engines + routing）
 *   - python.status        → routes/python.ts + python/kernel-service.ts `status()`
 *   - agent.capabilities   → routes/capability.ts（L1 账本 + L2 失败谱，fail-open）
 *   - media.resolveTask    → routes/media-upload.ts（taskId → artifactId，未命中 null）
 *   - embedding.get        → routes/embedding-config.ts `handleEmbeddingConfigGet()`
 *
 * 与 `@mafw/sdk` DTO 的等价性由 `contract-compat.checks.ts` 的编译期 AssertEq 钉住
 * （`ModelConfigState` 的 recall/media/available、`MediaPluginState`、
 * `VoiceStatusResponse`、`EmbeddingConfigGetResponse`）。tts.voices 的 SDK 返回类型
 * 是 wire 的子集（缺 engine/capabilities/engines）→ schema-only；python / agent /
 * media.resolveTask 没有 SDK client → schema-only。
 */
import { Type } from '@sinclair/typebox'

// ── models.get ──────────────────────────────────────────────────────────────

/** `ModelRef`：recall worker / goal 节点模型的完整 provider+model 对。 */
export const ModelRefSchema = Type.Object({
  providerID: Type.String(),
  modelID: Type.String(),
})

/** `MediaModelRef`：媒体模型对（provider 省略时沿用顶层 media.provider）。 */
const MediaModelRefSchema = Type.Object({
  provider: Type.Optional(Type.String()),
  model: Type.Optional(Type.String()),
})

/**
 * media 段（owner = 外部媒体引擎）：顶层 provider/model 是默认对，
 * image/video/audio 是逐模态覆盖；值域由媒体引擎插件决定。
 */
export const MediaConfigSchema = Type.Object({
  provider: Type.Optional(Type.String()),
  model: Type.Optional(Type.String()),
  image: Type.Optional(MediaModelRefSchema),
  video: Type.Optional(MediaModelRefSchema),
  audio: Type.Optional(MediaModelRefSchema),
})

/** goal 编排模型覆盖（owner = runtime 身份模型通道；空对 = 身份内置模型）。 */
export const GoalModelConfigSchema = Type.Object({
  nodeModel: Type.Optional(Type.Union([ModelRefSchema, Type.Null()])),
  techLeadModel: Type.Optional(Type.Union([ModelRefSchema, Type.Null()])),
})

/** provider 扫描行（owner = runtime `provider.list()`；扫描失败时整个 available 为 null）。 */
const AvailableProviderSchema = Type.Object({
  providerID: Type.String(),
  providerName: Type.String(),
  models: Type.Array(Type.Object({
    id: Type.String(),
    name: Type.String(),
  })),
})

/**
 * `GET /api/model-config` → `{recall, media, goal, available}`。
 * `available` 为 null 表示 provider 列表不可用（客户端回退文本输入），不是错误。
 */
export const ModelConfigGetResponse = Type.Object({
  recall: Type.Object({ workerModel: ModelRefSchema }),
  media: MediaConfigSchema,
  goal: GoalModelConfigSchema,
  available: Type.Union([Type.Array(AvailableProviderSchema), Type.Null()]),
})

// ── media.plugins ───────────────────────────────────────────────────────────

/** `MediaPluginState`（media/media-plugin-loader.ts）：GET 五键投影（不暴露 loader 内部）。 */
const MediaPluginStateSchema = Type.Object({
  file: Type.String(),
  name: Type.Optional(Type.String()),
  status: Type.Union([Type.Literal('ok'), Type.Literal('error')]),
  error: Type.Optional(Type.String()),
  modalities: Type.Optional(Type.Array(Type.String())),
})

/** `GET /api/media/plugins` → `{plugins: MediaPluginState[]}`。 */
export const MediaPluginsResponse = Type.Object({
  plugins: Type.Array(MediaPluginStateSchema),
})

// ── tts.voices ──────────────────────────────────────────────────────────────

/** `TtsVoice`（tts/types.ts）：引擎内置音色。 */
const TtsVoiceSchema = Type.Object({
  id: Type.String(),
  label: Type.String(),
  lang: Type.String(),
})

/** `TtsProfile`（tts/types.ts）：引擎档案。刻意不叫 capabilities（那是 runtime 词汇）。 */
const TtsProfileSchema = Type.Object({
  streaming: Type.Union([Type.Literal('native'), Type.Literal('none')]),
  voiceCloning: Type.Boolean(),
  styleControl: Type.Boolean(),
  languages: Type.Array(Type.String()),
  sampleRate: Type.Number(),
})

/**
 * `GET /api/tts/voices`：当前引擎的音色 + 档案 + 全部注册引擎 + 固定模型目录 + 默认值。
 * `models` 是 gateway 内置目录（三种 MiMo TTS 变体），不是 provider 扫描结果。
 */
export const TtsVoicesResponse = Type.Object({
  voices: Type.Array(TtsVoiceSchema),
  engine: Type.String(),
  capabilities: TtsProfileSchema,
  engines: Type.Array(Type.Object({
    name: Type.String(),
    source: Type.Union([Type.Literal('builtin'), Type.Literal('legacy'), Type.Literal('package')]),
  })),
  models: Type.Array(Type.Object({
    id: Type.String(),
    description: Type.String(),
  })),
  defaultVoice: Type.String(),
  defaultModel: Type.String(),
})

// ── voice.status ────────────────────────────────────────────────────────────

/** `VoiceConfig`（voice/config.ts）：config.yaml + `MAFW_VOICE_*` 合并后的有效值。 */
const VoiceConfigSchema = Type.Object({
  tier: Type.Union([Type.Literal('auto'), Type.Literal('local'), Type.Literal('cloud')]),
  localTier: Type.Union([Type.Literal('dgpu'), Type.Literal('igpu')]),
  asrEngine: Type.String(),
  ttsEngine: Type.String(),
  cloudConsent: Type.Boolean(),
  modelsDir: Type.String(),
  sidecarPort: Type.Number(),
  duplexV1: Type.Boolean(),
})

/** `AsrCapabilities`（voice/types.ts）：引擎声明。 */
const VoiceAsrCapabilitiesSchema = Type.Object({
  streaming: Type.Union([Type.Literal('native'), Type.Literal('none')]),
  languages: Type.Array(Type.String()),
  punctuation: Type.Boolean(),
  timestamps: Type.Union([Type.Literal('word'), Type.Literal('segment'), Type.Literal('none')]),
  sampleRate: Type.Number(),
  maxAudioSeconds: Type.Optional(Type.Number()),
})

/** 注册的 ASR 引擎（sidecar 未起时为空数组，仍是 200）。 */
const VoiceEngineInfoSchema = Type.Object({
  name: Type.String(),
  capabilities: VoiceAsrCapabilitiesSchema,
  source: Type.Union([Type.Literal('builtin'), Type.Literal('plugin')]),
})

/** `VoiceRouting`：v1 今天会走的 ASR 路径（local_accelerated / local_cpu / cloud / degraded）。 */
const VoiceRoutingSchema = Type.Object({
  status: Type.Union([
    Type.Literal('local_accelerated'),
    Type.Literal('local_cpu'),
    Type.Literal('cloud'),
    Type.Literal('degraded'),
  ]),
  reason: Type.Optional(Type.String()),
})

/** `GET /api/voice/status` → `{ok, config, engines, routing}`。 */
export const VoiceStatusResponse = Type.Object({
  ok: Type.Boolean(),
  config: VoiceConfigSchema,
  engines: Type.Array(VoiceEngineInfoSchema),
  routing: VoiceRoutingSchema,
})

// ── python.status ───────────────────────────────────────────────────────────

/** `GET /api/python/status?sessionID=` → `{running}`（无输入 → 400 错误信封）。 */
export const PythonStatusResponse = Type.Object({
  running: Type.Boolean(),
})

// ── agent.capabilities ──────────────────────────────────────────────────────

/** `TaskLedger`：一个聚合桶（全局或 per-task-type）。 */
const TaskLedgerSchema = Type.Object({
  total: Type.Number(),
  passRate: Type.Number(),
  avgRounds: Type.Number(),
  avgCostUsd: Type.Number(),
})

/**
 * `CapabilityLedger`（orchestration/capability-ledger.ts）。
 *
 * fail-open 200 只发 `{total, passRate}`（handler catch 分支），成功分支补齐
 * 均值/倾向/分桶 → 其余键 optional，避免把降级路径判成违约。
 */
const CapabilityLedgerSchema = Type.Object({
  total: Type.Number(),
  passRate: Type.Number(),
  avgRounds: Type.Optional(Type.Number()),
  avgCostUsd: Type.Optional(Type.Number()),
  thumbsUp: Type.Optional(Type.Number()),
  thumbsDown: Type.Optional(Type.Number()),
  byFailureKind: Type.Optional(Type.Record(Type.String(), Type.Number())),
  byTaskType: Type.Optional(Type.Record(Type.String(), TaskLedgerSchema)),
})

/** `FailurePattern`（L2 失败谱聚类行）。 */
const FailurePatternSchema = Type.Object({
  pattern: Type.String(),
  count: Type.Number(),
  energy: Type.Number(),
  id: Type.String(),
})

/** `GET /api/agent/capabilities` → `{ledger, failureTaxonomy}`。 */
export const AgentCapabilitiesResponse = Type.Object({
  ledger: CapabilityLedgerSchema,
  failureTaxonomy: Type.Array(FailurePatternSchema),
})

// ── media.resolveTask ───────────────────────────────────────────────────────

/** `GET /api/media/resolve-task/:id` → `{artifactId}`；未命中显式 null（不是 404）。 */
export const MediaResolveTaskResponse = Type.Object({
  artifactId: Type.Union([Type.String(), Type.Null()]),
})

// ── embedding.get ───────────────────────────────────────────────────────────

/**
 * `EmbeddingConfigState`（routes/embedding-config.ts）：config.yaml 的有效 embedding 段。
 * E10h-R6：`embedding.update` 的 `current` 段是写后读回的同一投影 → 加 export 复用。
 */
export const EmbeddingConfigStateSchema = Type.Object({
  provider: Type.Union([Type.Literal('off'), Type.Literal('local'), Type.Literal('dashscope')]),
  engine: Type.Union([Type.Literal('onnx'), Type.Literal('llamacpp')]),
  model: Type.String(),
  dimensions: Type.Number(),
  /** 完整 endpoint URL（不是 base URL）。 */
  baseUrl: Type.String(),
  threads: Type.Number(),
  llamacpp: Type.Object({
    gpu: Type.String(),
    threads: Type.Number(),
    contextSize: Type.Number(),
    batchSize: Type.Number(),
  }),
})

/**
 * `EmbeddingRuntimeState`：live provider 状态（provider 关闭时 active/dims 为 null）。
 * E10h-R6：`embedding.update` 的 `runtime` 段同形 → 加 export 复用。
 */
export const EmbeddingRuntimeStateSchema = Type.Object({
  active: Type.Union([Type.String(), Type.Null()]),
  providerId: Type.Union([Type.String(), Type.Null()]),
  modelTag: Type.Union([Type.String(), Type.Null()]),
  dims: Type.Union([Type.Number(), Type.Null()]),
  vectors: Type.Number(),
  indexEntries: Type.Number(),
  coverage: Type.Number(),
})

/** `GET /api/memory/embedding-config` → `{current, runtime, available}`。 */
export const EmbeddingGetResponse = Type.Object({
  current: EmbeddingConfigStateSchema,
  runtime: EmbeddingRuntimeStateSchema,
  available: Type.Object({
    providers: Type.Array(Type.String()),
    engines: Type.Array(Type.String()),
    gpus: Type.Array(Type.String()),
  }),
})
