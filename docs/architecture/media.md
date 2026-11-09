# MAFW Media（A2A 多模态）

> 迁移自根 `AGENTS.md`（2026-11-10），原文搬迁（未改写）；章节号沿用迁移前编号，
> 交叉引用以标题为准。后续变更记录写 `docs/releases/`，不再回填本文件。

### Media 接入（A2A Media Agent，pi 引擎 · 多模态）

纯文本/多模态推理模型通过 **A2A 协议**（Agent2Agent v1.0）与 gateway 内置的
**Media Agent** 多轮协作分析 **图片 / 视频 / 音频**。**推理 Agent（LLM）主动驱动**，
MAFW 插件仅作为 A2A 客户端执行。媒体分析引擎是 **pi-coding-agent**
（`@earendil-works/pi-coding-agent`，进程内 SDK 嵌入），模型经每模态配置指定
（默认 `xiaomi/mimo-v2.5`，直连小米 API，认证复用 opencode auth.json 的凭据）。

```
MafwShell（桌面前端）                           Gateway 进程（3000）
  粘贴/上传图片/视频/音频 → POST /a2a SendMessage  gateway/src/media/media-agent.ts
    parts: [{raw: 媒体base64}, {text: 问题}]       ├─ A2A JSON-RPC（@a2a-js/sdk v1.0.1）
  → 消息只发文本指针                               ├─ POST /a2a、/.well-known/agent-card.json、
    [媒体附件 taskID: x contextID: y（媒体: 名）]   │  /a2a/artifacts/<id>（loopback-only）
                                                  ├─ TaskStore + ArtifactStore（LRU 500 + TTL 24h）
opencode LLM（推理 Agent）                       └─ MediaService → pi adapter → 模型（每模态可配）
  看到指针 → 自主调用 mafw_media_ask                └─ gateway/src/media/pi-adapter.ts
    src/tools/media-ask.ts（插件 tool，A2A client）    ├─ pi-coding-agent（ModelRuntime，进程内 SDK）
      ├─ GetTask { id: taskID } → contextId          ├─ 认证：opencode auth.json 的 provider key
      └─ SendMessage { contextId, referenceTaskIds:    │  （setRuntimeApiKey 运行时注入，不落盘）
           [taskID], parts: [{text: question}] } → 追问  └─ fixMediaPayload（onPayload 钩子）
    返回：媒体回答 + 新 taskID（继续追问用新 ID，媒体不重传）
```

要点：
- **纯 A2A，无 MCP、无 transform 自动转发**：追问由推理 Agent 自主决策（调用
  `mafw_media_ask` 工具）；媒体只上传一次（raw FilePart），追问经
  `referenceTaskIds` 引用前序任务，每轮是一个新任务（同步模型下任务即时终结）
- **多模态（image / video / audio）**：MediaAgent 的 `SUPPORTED_INPUT_MODES` 为
  `['text','image','video','audio']`，按 mediaType 白名单路由；大小上限：
  image ≤20MB / video ≤50MB / audio ≤25MB（超限显式失败）
- **媒体原生进入主模型**（非"描述注入文本模型"）：媒体作为 PiAiImage carrier
  （`{type:'image', data: base64, mimeType: video/mp4|audio/...}`）交给 pi；
  pi 的 openai-completions 序列化器输出 `image_url`，**fixMediaPayload**
  （`gateway/src/media/pi-adapter.ts`，派生自 pi-multimodal-proxy 的
  fixVideoAudioPayload，MIT）在 `onPayload` 钩子里重写 wire format：
  - `video/*` → `{type:'video_url', video_url:{url}}`（小米视频格式）
  - `audio/*` → `{type:'input_audio', input_audio:{data:url}}`（小米音频格式，
    data 为整串 data URI）
  主模型（如 xiaomi/mimo-v2.5）直接分析媒体，`video_tokens`/`audio_tokens`
  真实计入（实测验证）
- **每模态独立模型**：gateway `media:` 配置段——`provider`/`model`（默认
  xiaomi/mimo-v2.5）+ `image/video/audio` 每模态 `{provider?, model}` 覆盖；
  经 pi 的 `getModel(provider, modelId)` 解析；桌面 Config 页可编辑
- **认证复用 opencode**：key 从 `~/.local/share/opencode/auth.json` 按 provider
  读取（opencode 里 connect 即可），`setRuntimeApiKey` 运行时注入，无独立
  MAFW API key
- **CJS/ESM 桥**：gateway 编译为 CJS，pi-coding-agent 是 ESM——pi-adapter 通过
  `new Function('spec','return import(spec)')` 运行时动态导入（tsc 会把普通
  `import()` 降级为 require，require ESM 包会抛错）
- 工具描述强化 LLM 可读性：触发条件（会话存在 `[媒体附件]` 指针）、taskID 从
  指针提取、返回含新 taskID；`ToolResult` 结构化
  `{ title, output, metadata: { taskID, newTaskID } }`
- 错误处理：GetTask TaskNotFound / SendMessage 失败 / 任务 FAILED / gateway 不可达
  → 显式错误文本，不抛异常不崩会话
- **标准 opencode（无桌面端）完整可用**：
  - 入口 A：`src/hooks/media-ingest.ts`（transform）——粘贴图片/视频/音频
    自动建任务并替换为文本指针；`MEDIA_INGEST=off`（兼容 `VISION_INGEST=off`）可关
  - 入口 B：`mafw_media_upload` 工具——LLM 主动上传本地媒体路径建任务
  - 追问：`mafw_media_ask`；指针 `[媒体附件 taskID: x contextID: y（媒体: 名）...]`，
    幂等兼容旧 `[视觉附件` 前缀；参数 `mediaPath`
- 安全：`/a2a` 系列端点 loopback-only（403 拒绝非本机）；Artifact id 为 uuid 不可猜；
  FilePart `url` 只接受本 agent 工件引用（SSRF 防护）
- 前端（MafwShell）媒体附件 → `window.api.mafw.media.createTask` → 文本指针；
  图片走 canvas 下采样，视频/音频直读 dataUrl
- 工具清单：`mafw_media_upload`（建任务，返回指针 + taskID）、`mafw_media_ask`
  （追问，返回回答 + 新 taskID）；旧名 `mafw_vision_upload`/`mafw_vision_ask` 已移除
- **MediaRuntimeExecutor**（`gateway/src/media/media-runtime-executor.ts`）：媒体 agent 的
  AgentRuntime 后端——pi runtime 激活时 `resolvePrompt` 的 `engine='pi'` 分支返回 executor 的
  PromptFn；图片追问在同一 AgentSession 内连续 prompt（真多轮记忆，同一 dataUrl + provider/model
  复用会话，追问轮自动回退到最近会话）；视频/音频保持 ModelRuntime.complete + fixMediaPayload
  单次路径；超时 180s + abort；A2A cancelTask → cancelHook → cancelInflight 中止进行中会话
- 测试：`tests/unit/gateway/pi-adapter.test.ts`（fixMediaPayload 单测 + adapter 边界）、
  `media-service.test.ts`（PromptFn 抽象隔离）、`media-agent.test.ts`（A2A 四模态）、
  `media-runtime-executor.test.ts`（会话复用/超时/cancel）

#### Media Engine 插件系统

媒体分析引擎可插拔：用户往 `~/.mafw/media-plugins/` 丢 `.js` 文件即可替换/新增某模态的分析引擎。
`MediaPluginLoader`（`gateway/src/media/media-plugin-loader.ts`）扫描/热加载/fail-open，
`MediaService.resolvePrompt(kind, cfg)` 按模态路由到插件引擎或默认 pi。

> **插件中心全量清单（2026-09-15）**：三个 loader 不再生成 `example.js.disabled` 模板（启动时 `cleanupExamples()` 幂等清理存量）；`GET /api/plugins`（插件中心）含内置条目——runtime: `opencode`/`pi`、media: `pi`、usage: 全部内置适配器（`builtin`/`overridden`/`pluginType` 字段，同名用户文件 → 内置件标 `overridden`）；安装为 **raw octet-stream**（`POST /api/plugins/install?filename=&type=`，`type` 可缺省——gateway 落 tmp-require 嗅探 `module.exports` 接口（`createRuntime`→runtime / `createPrompt`+`fixPayload`+`engine`+`modalities`→media / `fetch`→usage / `tools`→ui；多命中 400 `ambiguous plugin interface: <a/b>`，前端出兜底下拉）。桌面 Config→Plugins：「Runtime & Media」卡已删，runtime 切换=hub 行「激活」、media 每模态下拉并入 hub、usage 内置行只读+「克隆」（复用 clone-builtin 模板端点）。响应另含 `packages` 键（统一插件包状态，2026-09-16）。
