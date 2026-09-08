# completionApi：Runtime 契约无状态 LLM 通道

- 日期：2026-09-09
- 状态：已批准（设计），待实现计划
- 动机：统一 gateway 内的无状态 LLM 调用通道（index-scan 直连 HTTP、media pi-adapter 各搞一套），使其成为 runtime 契约的可选能力，获得 runtime 中立性、统一认证与热切换支持。

## 背景

现状有两条私有的无状态 LLM 传输：

1. **index-scan**（`gateway/src/recall/index-scan.ts`）：直连 OpenAI-compatible HTTP chat completion，刻意不走 session（无状态分类调用，session churn 曾淹没 registry；prompt-cache 前缀控制是成本核心）。
2. **media**（`gateway/src/media/pi-adapter.ts`）：进程内 `ModelRuntime.complete`（pi SDK）+ `fixMediaPayload` wire 改写，服务于 video/audio 单次分析与 opencode runtime 下的 image。

两条通道各自实现认证解析（auth.json / provider config / credentials）、超时与错误处理，且都不被 runtime 插件契约覆盖——第三方 runtime 无法提供自己的传输。

### 明确排除

- **pi runtime 下 image 的多轮 session 路径**（`MediaRuntimeExecutor` 的 session 分支）不动——它走 session 契约是正确的，无状态通道替代不了多轮记忆。
- **session 契约媒体附件支持**（video/audio 有状态化 + image session 疑似 bug 修复）是独立后续议题，与本期正交。
- 不改动消费方的业务逻辑（scan 的 cooldown/snapshot、media 的缓存与 TTL 均原样保留）。

## 设计

### 1. 契约面（`gateway/src/runtime/contract.ts`）

```ts
// RuntimeCapabilities 新增（可选，未声明即无此能力）
completionApi?: boolean;

// RuntimeClient 新增可选字段
completion?: {
  complete(req: CompletionRequest): Promise<CompletionResult>;
};

export interface CompletionRequest {
  model: { providerID: string; modelID: string };
  /** 系统块；cacheable=true 的块构成 provider prompt-cache 前缀（scan 的索引文本） */
  system?: Array<{ text: string; cacheable?: boolean }>;
  /** 用户内容：文本 + 可选媒体（dataUrl carrier，与 PiAiImage 形状对齐） */
  user: Array<
    | { type: 'text'; text: string }
    | { type: 'image'; data: string; mimeType: string }   // data = base64（无 data: 前缀）
  >;
  maxTokens?: number;
  temperature?: number;
  timeoutMs?: number;       // 消费方传入（scan 30s / media 180s）
}

export interface CompletionResult {
  text: string;
  /** undefined = provider 未回传 usage；消费方据此跳过记账 */
  usage?: { input: number; cached: number; output: number };
}
```

语义约束：

- **无状态是契约语义**：请求不携带 sessionID，实现方不得跨调用保留对话状态。
- `cacheable` 是**提示而非承诺**：实现方映射到自己 provider 的缓存机制（如 DashScope `cache_control: ephemeral`），映射不了则忽略（fail-open）。
- 契约内只有 `image` 媒体 carrier；wire 格式改写（video_url / input_audio）是实现方内部细节，不进契约。

### 2. 内置 runtime 实现

**opencode runtime**（`gateway/src/runtime/opencode-runtime.ts`）：

- `capabilities.completionApi = true`。
- `complete()` = 把 `index-scan.ts` 现有直连 HTTP 传输上移：endpoint 解析链（`recall.scanEndpoints` → opencode provider config `options.baseURL` → 硬编码表）、key 解析链（`credentials` → provider config `options.apiKey` → auth.json）、`cacheable` 块 → `cache_control: ephemeral` 标记、usage 解析（`prompt_tokens_details.cached_tokens`）。
- 媒体 part 序列化为 OpenAI `image_url`。

**pi runtime**（`gateway/src/runtime/plugins/pi-runtime.ts`）：

- `capabilities.completionApi = true`。
- `complete()` = 包装现有 `ModelRuntime.complete`（ESM 桥 `new Function('spec','return import(spec)')`、`setRuntimeApiKey`、`onPayload: fixMediaPayload`），即 pi-adapter 现有逻辑的契约化形态；usage 从 pi 响应映射（取不到则 `undefined`）。

**第三方 runtime 插件**：不实现即声明 `completionApi: false`（或缺省），消费方回退，零破坏。

### 3. 消费方接线与回退

```
IndexScanService._doScan
  ├─ rt.capabilities.completionApi && rt.completion
  │    → rt.completion.complete()；usage 交给现有 recordUsage 回调（合成 turn 逻辑不变）
  └─ 否则或抛错 → 现有直连 HTTP 传输（ScanHttpDeps 注入链原样保留）

MediaRuntimeExecutor 构造的 completeFn（media-runtime-executor.ts:195 注入点）
  ├─ rt.capabilities.completionApi → rt.completion.complete()
  └─ 否则 → 现有 createPiPromptAdapter（pi 直连）
```

- 热切换（`POST /api/runtime/switch`）天然生效：消费方每次调用现读 `rt.completion`，无缓存句柄。
- usage 记账留在消费侧（`complete()` 只负责返回 usage），runtime 不自行记账——记账逻辑保持单点。
- pi 下 image 的 session 路径（`MediaRuntimeExecutor` 有状态分支）不经过 completeFn，不受本改动影响。

### 4. 错误语义

- `complete()` 抛异常或超时 → 消费方回退到旧传输；scan 侧一次契约失败同时计入现有 cooldown streak。
- `CompletionResult.text` 为空 → 视为失败（scan 侧等价 unparsable → cooldown）。
- 能力声明了但持续失败 → 由消费方 cooldown 兜住；gateway 不做契约级熔断（YAGNI）。

### 5. 测试策略

- 契约：能力声明 + 类型形状。
- opencode runtime complete：mock fetch，验证 endpoint/key 解析链、cacheable 块 → `cache_control` 标记、usage 解析、媒体序列化。
- pi runtime complete：mock ModelRuntime，验证 ESM 桥、`setRuntimeApiKey`、onPayload 透传。
- index-scan：注入带/不带 completionApi 的 fake runtime，验证优先走契约 + 失败回退直连。
- media-runtime-executor：completeFn 优先契约 + 回退 pi-adapter。
- 回归门槛：全部现有测试保持绿（回退路径行为不变）。

## 影响面

| 文件 | 变更 |
|---|---|
| `gateway/src/runtime/contract.ts` | 新增 `completionApi` 能力 + `CompletionRequest/Result` 类型 |
| `gateway/src/runtime/opencode-runtime.ts` | 实现 `completion.complete`（接收 index-scan 上移的传输逻辑） |
| `gateway/src/runtime/plugins/pi-runtime.ts` | 实现 `completion.complete`（包装 ModelRuntime.complete） |
| `gateway/src/recall/index-scan.ts` | 传输层改为优先契约、回退直连 |
| `gateway/src/media/media-runtime-executor.ts` | completeFn 注入点优先契约、回退 pi-adapter |
| `tests/unit/gateway/*` | 新增上述测试 |
