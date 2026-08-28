# Config 页模型配置管理（Model Config UI）设计

日期：2026-08-28
状态：待审查

## 背景

记忆系统与媒体系统的 LLM 模型配置目前只能通过 Config 页底部的通用 JSON 编辑器
（`config.set` → `PUT /api/config` 全量写）修改：无校验（拼错模型名不报错）、
无下拉、`IndexScanService` 持快照导致 index-scan 管线要重启才换模型。

### 现状关键事实

| 配置 | 位置 | 默认值 | 消费方 | 热生效？ |
|---|---|---|---|---|
| `recall.workerModel` | `gateway/src/config.ts:131` | `alibaba-cn/qwen3.7-max` | TurnPipeline / ReflectionPipeline / IndexScanService | 前两者是每次调用新建实例（`index.ts:1109-1132`）已热生效；IndexScanService 是 lazy 单例（`index.ts:1038`）持快照，需失效重建 |
| `media.provider/model` + 每模态 | `gateway/src/config.ts:145-170` | xiaomi/mimo-v2.5，每模态空回退 | `media-service.ts:122-141` per-request 读 `config.raw.media` | 天然实时 |

Provider 列表数据源：`GET /api/provider`（`index.ts:3262`，能力门
`providerConfigApi`）→ opencode `provider.list()`，返回形状
`{ all: [{ id, name, models: { [modelID]: { name } } }], connected: [providerID] }`。
SDK `providers.list()` 与 preload `window.api.mafw.providers.list()` 均已存在。

## 目标

Config 页新增"模型"卡片，下拉修改以下 5 项模型配置，保存即持久化并热生效：

1. 记忆 worker 模型（`recall.workerModel`）
2. 媒体默认模型（`media.provider`/`media.model`，每模态空值时的回退）
3. 媒体 image 模型（`media.image`）
4. 媒体 video 模型（`media.video`）
5. 媒体 audio 模型（`media.audio`）

## 方案选择

- **A（选定）**：专用 `/api/model-config` 路由（deps 注入，仿 `media-switch.ts`）
  + 校验 + `scanService` 失效重建 + 级联 SelectV2 下拉。
  与现有 runtime/media switch 模式一致、可单测、有校验、热生效。
- B（否决）：纯前端复用 `PUT /api/config` —— 零 gateway 改动，但无校验、
  scanService 不失效（违背立即生效）、做不了下拉、路由逻辑不可单测。
- C（否决）：`IndexScanService` 改 live getter + 通用 PATCH /api/config ——
  最彻底但侵入核心服务签名，通用 PATCH 的可改字段校验规则难界定，超出本次需求。

## §1 Gateway

### 新文件 `gateway/src/routes/model-config.ts`

```typescript
interface ModelRef { providerID: string; modelID: string }

interface AvailableModel { id: string; name: string }
interface AvailableProvider { providerID: string; providerName: string; models: AvailableModel[] }

interface ModelConfigDeps {
  persist: (overrides: Record<string, any>) => { changed: string[] }
  /** 返回 null 表示 provider 列表不可用（fail-open）。 */
  listProviders: () => Promise<AvailableProvider[] | null>
  currentConfig: () => {
    recall: { workerModel: ModelRef }
    media: {
      provider?: string; model?: string
      image?: { provider?: string; model?: string }
      video?: { provider?: string; model?: string }
      audio?: { provider?: string; model?: string }
    }
  }
  invalidateScanService: () => void
}

handleModelConfigGet(req, res, deps): Promise<void>
handleModelConfigUpdate(req, res, deps): Promise<void>
```

### GET /api/model-config

```json
{
  "recall": { "workerModel": { "providerID": "alibaba-cn", "modelID": "qwen3.7-max" } },
  "media": {
    "provider": "xiaomi", "model": "mimo-v2.5",
    "image": { "provider": "", "model": "" },
    "video": { "provider": "", "model": "" },
    "audio": { "provider": "", "model": "" }
  },
  "available": [ { "providerID": "xiaomi", "providerName": "xiaomi",
                   "models": [ { "id": "mimo-v2.5", "name": "MiMo V2.5" } ] } ]
}
```

`available: null` 表示 provider 列表拉取失败（前端回退文本输入）。

### POST /api/model-config

请求体只传要改的字段：

```json
{
  "recall": { "providerID": "xiaomi", "modelID": "mimo-v2.5" },
  "media":  { "provider": "xiaomi", "model": "mimo-v2.5",
              "image": { "provider": "", "model": "" },
              "video": { "provider": "", "model": "" },
              "audio": { "provider": "", "model": "" } }
}
```

处理流程：

0. 请求体不含 `recall` 也不含 `media`（或二者均空对象）→ `400 { error: 'No model config specified' }`
1. 拉取 provider 列表
   - 拉得到 → **严格校验**：每个被修改的 `{provider, model}`（media）/
     `{providerID, modelID}`（recall）必须在列表中（provider 存在且 model
     属于该 provider）；不匹配 → `400 { error, available }`
     - **例外**：空字符串值（清空 per-modality、回退默认模型的"（跟随默认）"
       路径）跳过严格校验，直接放行
   - 拉不到 → **fail-open 放行**（文本输入兜底场景）
2. `deps.persist({ recall: { workerModel }, media: {...} })` —— 只含被修改字段；
   未变更字段一并发送亦可（`persistOverrides` 深合并幂等，前端实现可每次
   整行提交全量 media 对象）；`config.persistOverrides` 深合并进内存并全量写
   `~/.mafw/config.yaml`
3. 仅当 `recall` 被修改时调用 `deps.invalidateScanService()`
4. `200 { success: true, recall, media }`（persist 后读 `currentConfig()`）；
   注意响应形状与请求不同——`recall` 回显为 `{ workerModel: ModelRef }`
   包装形状（与 GET 一致），非请求的扁平 `{ providerID, modelID }`

### index.ts 接线

- 路由匹配用 `(?:\?|$)` 锚定约定（AGENTS.md §6.5）
- `persist: (o) => config.persistOverrides(o)`
- `listProviders`: `opencodeClient.provider.list()` 展平为 `AvailableProvider[]`；
  客户端缺失 / 能力门不满足 / 抛异常 → 返回 `null`
- `invalidateScanService`: `this.scanService = null`（同类私有字段直接置空，
  下次 `getScanService()` 重建即读新 `config.recall.workerModel`）

### SDK（opencode-dev/packages/gateway-sdk）

- `types.ts`：新增 `ModelsNamespace { get(): Promise<...>; update(opts): Promise<...> }`，
  注册进 `MafwClient` 接口
- `client.ts`：`models` 命名空间实现，GET/POST `/api/model-config`
- 同步更新 `types.test.ts`（存在性）与 `client.test.ts`（路由断言）

### preload / IPC

`src/preload/mafw-api.ts` 加 `models: { get, update }`（`mafw-ipc.ts` 泛型派发
自动可达，无需改 main 进程）；`mafw-types.ts` 加对应类型。

## §2 前端（desktop Config 页）

`Config.tsx` 在"插件 Plugins"卡下方新增"模型 Models"卡片。

### 数据加载

`onMount` 拉 `window.api.mafw.models.get()`；`available` 非 null → 下拉模式，
null → 文本输入模式（`TextInputV2` 两枚：providerID / modelID，附提示
"provider 列表不可用，请手动输入"）。

### 5 行配置，级联双下拉

| 行 | 配置路径 | 说明 |
|---|---|---|
| 记忆 worker 模型 | `recall.workerModel` | tooltip"用于记忆压缩/反思/IndexScan" |
| 媒体默认模型 | `media.provider`/`media.model` | 每模态空值时的回退 |
| 媒体 image 模型 | `media.image` | 空 = 跟随默认 |
| 媒体 video 模型 | `media.video` | 空 = 跟随默认 |
| 媒体 audio 模型 | `media.audio` | 空 = 跟随默认 |

交互约定：

- 每行两个 `SelectV2`：provider 下拉 → model 下拉（随 provider 过滤；
  provider 变更时 model 重置）
- 选中即保存（无独立保存按钮，与页面既有引擎下拉一致）；请求期间行内
  `LoaderV2`，成功/失败 `showToastV2`
- 媒体行的 model 下拉含"（跟随默认）"空选项；选空 = 清空 per-modality
  provider/model（回退默认模型）
- 样式复用 `.mafw-plugin-row` 系列；仅新增一个双下拉行内布局类

## 错误处理

- 校验失败 400：toast 显示 `error` 文本 + 可用 provider 摘要
- `models.get()` 失败：卡片内联错误条 + 重试按钮，不影响页面其他卡片
- POST 网络失败：toast + UI 回滚到保存前值
- `invalidateScanService` 抛异常不阻塞响应（fail-open，log warn）；
  下次 cron 重建兜底

## 测试

- `tests/unit/gateway/model-config.test.ts`：
  GET 形状；POST 空请求体 400；POST 校验通过与 400；provider 列表 null 时 fail-open；
  清空路径（空字符串值）通过校验；
  persist 载荷正确（recall 与 media 分字段、只含被改字段）；
  `invalidateScanService` 仅在 recall 变更时调用
- `gateway-sdk`：`client.test.ts` 加 `models.get/update` 路由断言；
  `types.test.ts` 加命名空间存在性
- 手动验证：桌面 Config 页改 `recall.workerModel` → gateway 日志确认
  scanService 失效，下次 `memory:turnCompress` 使用新模型

## 非目标

- 不改引擎（engine）切换逻辑（现有 media-switch 保持不变）
- 不做通用 PATCH /api/config
- 不改 `IndexScanService` 构造签名（用失效重建而非 live getter）
- TTS 模型（`media.tts.*`）不在本次范围
