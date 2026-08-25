# Media Engine 插件系统实施计划

> 日期：2026-08-25 | 前置：usage-plugins 模式已验证（commit 0918b72d）

## 目标

把 media 分析引擎（当前硬编码 pi-coding-agent）做成可插拔：用户往 `~/.mafw/media-plugins/` 丢一个 `.js` 文件即可替换/新增某个模态的分析引擎，同时解决 `fixMediaPayload` 硬编码小米 wire 格式的问题。

## 非目标

- opencode SDK 后端插件化（接缝已存在于 opencode-adapter.ts，YAGNI）
- Desktop 插件管理 UI（本期只做 HTTP API，UI 后续跟进）
- 重构 usage PluginLoader 抽取公共基类（避免动刚上线的代码，接受 ~120 行重复，留 TODO）

## 插件契约

`~/.mafw/media-plugins/*.js`（CJS），两种形态：

```js
// 形态 A：完全自定义引擎（不经 pi，直接 HTTP 调用）
module.exports = {
  name: "gemini-vision",
  modalities: ["image", "video"],        // 声明支持的模态
  async createPrompt(ctx) {              // 返回 PromptFn
    return async (parts, opts) => { /* ... */ return "分析结果"; };
  },
};

// 形态 B：复用 pi 运行时，只换 wire 格式修复器
module.exports = {
  name: "qwen-vl",
  modalities: ["image", "video"],
  engine: "pi",
  fixPayload(payload) { /* 自定义改写，返回 undefined 表示不修改 */ },
};
```

校验规则：`name` 必填且唯一；`modalities` 必填且为 image/video/audio 子集；`createPrompt` 与 `engine:"pi"` 二选一。加载失败 fail-open（状态记 error，不影响其他插件与默认 pi）。

**ctx**（`media/plugin-context.ts`，复用 usage 的 auth-helpers）：
- `apiKey(name)` → opencode auth.json
- `fetch(url, opts)` → 60s timeout（媒体分析比 usage 慢）
- `pluginConfig(name)` → `config.media.pluginConfig[name]`
- `log`

## 引擎路由

config 增加 engine 字段（per-modality 覆盖全局）：

```yaml
media:
  provider: xiaomi
  model: mimo-v2.5
  engine: pi                    # 默认引擎
  video:
    model: mimo-v2.5
    engine: qwen-vl             # video 模态走插件
  pluginConfig: {}              # 插件自定义配置
```

`MediaService` 新增可选 dep `resolvePrompt(kind, cfg) → PromptFn | undefined`：
`analyze()` / `analyzeAudioStructured()` 中 `promptFn = resolvePrompt?.(kind, cfg) ?? deps.prompt`。
路由逻辑在 index.ts：engineName = `cfg[kind]?.engine ?? cfg.engine ?? 'pi'` → loader 的 `Map<name, PromptFn>` 查找 → 插件未声明该模态或找不到时 warn + 回退 pi。**缓存 key 已含 providerID/modelID，需把 engineName 也加入 cacheKey**（防同模型不同引擎串缓存）。

## 任务分解

### Task 1: pi-adapter fixPayload 可配
- `PiAdapterDeps` 加 `fixPayload?: (payload: unknown) => unknown`
- piPrompt 中 `onPayload: deps.fixPayload ?? fixMediaPayload`
- 测试：自定义 fixPayload 被调用、缺省走 fixMediaPayload（`tests/unit/gateway/pi-adapter.test.ts` 扩展）

### Task 2: MediaPluginLoader + plugin-context
- `gateway/src/media/media-plugin-loader.ts`：ensureDir（+README/example）、scan、require cache 清理、300ms 防抖 watch、目录删除检测、状态 Map、getEngines()→`Map<name, {prompt, modalities}>`、reload()、stop()
- 形态 B 插件 → `createPiPromptAdapter({ fixPayload: mod.fixPayload })`；形态 A → 加载时调 `createPrompt(ctx)` 缓存 PromptFn（调用失败记 error）
- `gateway/src/media/plugin-context.ts`：createMediaPluginContext（apiKey/fetch 60s/pluginConfig/log）
- 单测 `tests/unit/gateway/media-plugin-loader.test.ts`：scan/校验失败/重名/形态A/形态B/热加载/目录删除（~8 例）

### Task 3: MediaService 路由 + config
- `MediaServiceDeps.resolvePrompt?`；analyze/analyzeAudioStructured 使用；cacheKey 加 engineName（签名改为 `cacheKey(kind, engine, providerID, modelID, url, prompt)`，破坏性变更仅内部使用，检查调用点）
- `config.ts`：`media.engine?: string`、`image/video/audio` 各加 `engine?: string`、`media.pluginConfig: Record<string, any>`
- 单测扩展 `tests/unit/gateway/media-service.test.ts`：per-modality 路由、回退 pi、缓存隔离（~4 例）

### Task 4: index.ts 接线 + HTTP API
- initServices：创建 MediaPluginLoader（`~/.mafw/media-plugins`）→ init → resolvePrompt 注入 MediaService
- `GET /api/media/plugins`（状态列表）、`POST /api/media/plugins/reload`
- gateway stop() 时 loader.stop()
- 注意 regex 需兼容 query string（`(?:\?|$)`，AGENTS.md 6.5 教训）

### Task 5: 构建 + 部署 + 端到端验证
- gateway build → robocopy 部署 → 重启
- 创建测试插件（形态 A：返回固定字符串）→ 验证 `/api/media/plugins` 状态 ok → 配置 `media.image.engine: test` → 上传图片验证走插件 → 删文件验证热清理
- 全部测试 `npx jest tests/unit/gateway/media-*.test.ts`

### Task 6: 文档
- AGENTS.md 5.14 节更新（引擎插件化）
- 插件目录 README 自动生成内容含两种形态示例

## 风险与对策

| 风险 | 对策 |
|---|---|
| 形态 A 插件的 createPrompt 是同步工厂但内部异步出错 | 加载时调用并缓存 Promise，reject 记 error 状态 |
| 插件引擎不支持某模态却被路由 | resolvePrompt 检查 modalities 声明，不匹配回退 pi + warn |
| 缓存串扰（同模型不同引擎） | cacheKey 加 engineName |
| ESM 依赖（插件想 import ESM 包） | README 注明 `new Function('spec','return import(spec)')` 技巧 |
