# Runtime / Media 插件切换器 — 实现计划

**Spec**: `2026-08-27-plugin-switcher-design.md`（已评审通过，2ca79e1c）
**日期**: 2026-08-27

---

## 任务总览

| Task | 范围 | 文件数 | 依赖 |
|------|------|--------|------|
| T1 | Gateway switch 端点 | 1 | — |
| T2 | Gateway config.raw 整对象合并写入 | 1 | — |
| T3 | Gateway-sdk MafwClient 扩展 | 1 | — |
| T4 | Desktop preload 类型扩展 | 2 | T3 |
| T5 | Desktop Config 页「插件」卡片 | 1 | T4 |
| T6 | 测试 | 2 | T1, T2 |

> T1 + T2 可并行；T3/T4 串行；T5 依赖 T4；T6 贯穿各 Task。

---

## T1: Gateway switch 端点（gateway/src/index.ts）

### 目标
新增 `POST /api/runtime/switch` 和 `POST /api/media/switch` 两个端点。

### 实现细节

**POST /api/runtime/switch**
- 在 `GET /api/runtime` 端点之后插入（约 line 3139）
- Body: `{ plugin: string }` — `"pi"` | `"opencode"` | 用户插件名 | `""`
- 校验逻辑：
  - `plugin === '' || plugin === 'opencode'` → 合法（内置默认）
  - 否则 `this.runtimeLoader?.get(plugin)` 检查存在性 → 不存在返回 400
- 持久化：调用下方 T2 的合并写入函数（复用 PUT /api/config 的 yaml.dump + writeFileSync）
- 返回 `{ success, restartRequired: true, target, envOverride }`
- `envOverride = !!process.env.MAFW_RUNTIME_PLUGIN`

**POST /api/media/switch**
- Body: `{ engine?, image?, video?, audio? }` — partial
- 校验：不校验（fail-open）
- 持久化：合并到 `config.raw.media` → 整对象写入
- 热生效：`await this.mediaPluginLoader?.reload()`
- 返回 `{ success, restartRequired: false, resolved: { engine, image, video, audio } }`
- `resolved` 为合并后的最终值（未传字段保留原值）

### 验证
- `curl -X POST localhost:3000/api/runtime/switch -d '{"plugin":"pi"}'` → `{"success":true,"restartRequired":true,"target":"pi","envOverride":false}`
- `curl -X POST localhost:3000/api/media/switch -d '{"video":"qwen-vl"}'` → `{"success":true,"restartRequired":false,"resolved":{...}}`
- 切换未知 runtime → 400
- 切换未知 media 引擎 → 200 + resolved 显示回退

---

## T2: config.raw 整对象合并写入（gateway/src/index.ts）

### 目标
从 PUT /api/config 提取合并写入逻辑为可复用函数，确保 switch 端点不丢其他配置节。

### 实现细节

**提取 `writeConfigPatch(patch: Record<string, any>)` 函数**
- 位置：在 MafwScheduler 类内（private method）
- 逻辑：
  ```
  1. deepMerge(config.raw, patch)     // lodash 深合并或手动递归
  2. yaml.dump(merged)                // 复用现有 yaml 参数
  3. fs.writeFileSync(configPath, yamlStr)
  4. config.reload()
  5. return { restartRequired: reload.restartRequired }
  ```
- PUT /api/config 改为调用 `writeConfigPatch(overrides)` 保持向后兼容
- switch 端点调用 `writeConfigPatch({ runtime: { plugin } })` 或 `writeConfigPatch({ media: { ... } })`

**deepMerge 实现**
- 不引入 lodash，用现有项目内工具函数或内联递归：
  ```typescript
  function deepMerge(target: any, source: any): any {
    const out = { ...target };
    for (const key of Object.keys(source)) {
      if (source[key] && typeof source[key] === 'object' && !Array.isArray(source[key])) {
        out[key] = deepMerge(out[key] ?? {}, source[key]);
      } else if (source[key] !== undefined) {
        out[key] = source[key];
      }
    }
    return out;
  }
  ```

### 验证
- PUT /api/config 行为不变（回归）
- switch 端点写入后 config.yaml 保留其他节（手动检查 `~/.mafw/config.yaml`）
- 并发写无竞态（单线程 Node 事件循环天然安全）

---

## T3: Gateway-sdk MafwClient 扩展（gateway-sdk/src/client.ts）

### 目标
新增 `runtime` 和 `media` 命名空间到 MafwClient。

### 实现细节

```typescript
// 在 client.ts 类内新增
runtime = {
  get: async () => this.request<any>('/api/runtime'),
  switch: async (plugin: string) =>
    this.request<any>('/api/runtime/switch', {
      method: 'POST',
      body: JSON.stringify({ plugin }),
    }),
};

media = {
  // 扩展现有 media 命名空间
  plugins: async () => this.request<any>('/api/media/plugins'),
  switch: async (opts: { engine?: string; image?: string; video?: string; audio?: string }) =>
    this.request<any>('/api/media/switch', {
      method: 'POST',
      body: JSON.stringify(opts),
    }),
  reloadPlugins: async () =>
    this.request<any>('/api/media/plugins/reload', { method: 'POST' }),
};
```

> 注意：media 命名空间已存在（`createTask`、`createTaskAsync`），需合并而非覆盖。

### 验证
- `npm run build` in gateway-sdk 无类型错误
- 手动调用 client.runtime.switch('pi') 返回预期响应

---

## T4: Desktop preload 类型扩展（2 文件）

### 目标
在 `mafw-types.ts` 和 `mafw-api.ts` 新增 runtime/media 方法。

### 文件
- `opencode-dev/packages/desktop/src/preload/mafw-types.ts` — 接口定义
- `opencode-dev/packages/desktop/src/preload/mafw-api.ts` — IPC 实现

### 实现细节

**mafw-types.ts**
```typescript
// 在现有 MafwApi 接口内扩展
export interface MafwApi {
  // ...existing...
  runtime: {
    get: () => Promise<any>;
    switch: (plugin: string) => Promise<any>;
  };
  media: {
    // ...existing createTask, etc...
    plugins: () => Promise<any>;
    switch: (opts: { engine?: string; image?: string; video?: string; audio?: string }) => Promise<any>;
    reloadPlugins: () => Promise<any>;
  };
}
```

**mafw-api.ts**
```typescript
// 在 contextBridge.exposeInMainWorld 内扩展
runtime: {
  get: () => invoke("runtime", "get"),
  switch: (plugin: string) => invoke("runtime", "switch", plugin),
},
media: {
  // ...existing...
  plugins: () => invoke("media", "plugins"),
  switch: (opts) => invoke("media", "switch", opts),
  reloadPlugins: () => invoke("media", "reloadPlugins"),
},
```

### 验证
- TypeScript 编译通过（`tsgo -b`）
- 手动验证 IPC 调用到达 gateway

---

## T5: Desktop Config 页「插件」卡片

### 目标
在 Config 页新增「插件 Plugins」卡片，含 Runtime 下拉 + Media 每模态下拉。

### 文件
- `opencode-dev/packages/desktop/src/renderer/mafw/pages/Config.tsx`

### 实现细节

**Runtime 段**
- `onMount` 调 `window.api.mafw.runtime.get()` 获取 `{ active, plugins }`
- 下拉选项：`opencode`（默认） + `pi` + 用户插件（`status === 'ok'`）
- 当前 `active.name` 置顶/高亮
- 选择非当前项 → 弹确认框 → `window.api.mafw.runtime.switch(name)` → 监听 gateway ready
- 响应 `envOverride: true` → 显示警告条

**Media 段**
- 每模态一行：默认 / image / video / audio，各自下拉
- 选项来自 `window.api.mafw.media.plugins()`（含内置 pi）
- 选择 → `window.api.mafw.media.switch({ [kind]: name })` → toast
- `resolved` 与所选不一致 → 提示回退

**UI 样式**
- 使用 `@opencode-ai/ui/v2/*` 组件（ButtonV2, SelectV2, ToastV2）
- 卡片位于 Gateway 运维段与 opencode 配置段之间
- CSS 变量沿用 mafw.css 主题

### 验证
- Runtime 下拉列出 opencode + pi
- 切换 Runtime 弹确认框，确认后 gateway 重启
- Media 下拉各模态独立切换，热生效
- env 警告条正确显示

---

## T6: 测试（tests/unit/gateway/）

### 文件
- `tests/unit/gateway/runtime-switch.test.ts`（新建）
- `tests/unit/gateway/media-switch.test.ts`（新建）

### 测试用例

**runtime-switch.test.ts**
| # | 用例 | 预期 |
|---|------|------|
| 1 | `POST /api/runtime/switch { plugin: 'pi' }` | 200 + restartRequired: true |
| 2 | `POST /api/runtime/switch { plugin: 'unknown' }` | 400 |
| 3 | `POST /api/runtime/switch { plugin: 'opencode' }` | 200 + restartRequired: true |
| 4 | `POST /api/runtime/switch { plugin: '' }` | 200 |
| 5 | config.yaml 保留其他节 | 写入后 raw 包含原有字段 |
| 6 | envOverride 当 MAFW_RUNTIME_PLUGIN 设置 | 返回 envOverride: true |

**media-switch.test.ts**
| # | 用例 | 预期 |
|---|------|------|
| 1 | `POST /api/media/switch { video: 'qwen-vl' }` | 200 + restartRequired: false |
| 2 | partial 更新只改 video，engine/image/audio 不变 | resolved 反映 |
| 3 | 未知引擎不 400 | 200 + resolved 显示回退 |
| 4 | 触发 mediaPluginLoader.reload() | 验证调用 |

---

## 提交策略

每个 Task 完成后独立提交：

```
feat(gateway): add runtime/media switch endpoints (T1+T2)
feat(sdk): add runtime/media switch to MafwClient (T3)
feat(desktop): extend preload types for plugin switcher (T4)
feat(desktop): add plugin switcher card to Config page (T5)
test(gateway): add switch endpoint tests (T6)
```

**合并提交**：T1-T2 合为一个提交（紧密耦合），T6 按测试目标分散。

---

## 风险与缓解

| 风险 | 缓解 |
|------|------|
| config.raw 并发写竞态 | Node 单线程天然安全；无文件锁需求 |
| deepMerge 递归过深 | config.yaml 结构最多 3 层，无循环引用风险 |
| preload 类型与 renderer 不一致 | T4 严格对齐 mafw-types.ts 与 mafw-api.ts |
| Config 页组件膨胀 | 单文件 @ts-nocheck 沿用现有模式；后续可拆分 |
| runtime 切换后会话中断 | 文案明确提示；与现有 Restart 按钮行为一致 |

---

## 依赖关系图

```
T1 (switch端点) ──┐
                  ├──▶ T6 (测试)
T2 (合并写入) ──┘
                       │
T3 (SDK扩展) ──▶ T4 (preload) ──▶ T5 (Config UI)
```

T1+T2 → T6 可在 T3-T5 进行时并行测试。
