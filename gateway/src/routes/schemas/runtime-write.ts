/**
 * E10g-W6：runtime 写接口的请求体 schema（`RouteDef.request`）。
 *
 * 只有声明，不做运行时校验：字段面逐项来自 handler 的实际读取
 * （`routes/runtime-switch.ts`、`routes/dry-event.ts`、
 * `routes/conformance.ts`、`routes/runtime-config.ts`）。
 *
 * 分类（与 W1-W5 同口径）：
 *   - JSON body（`requestRequired` 缺省 true）：`runtime.switch`、
 *     `runtime.dryEvent`、`runtime.config.update`；
 *   - 可选 body + 声明字段（`requestRequired:false`）：`runtime.conformance`；
 *   - 空对象 + `requestRequired:false`：`runtime.restartAgent` /
 *     `runtime.reload` —— 两个 handler 都不读 body（`_req`）。
 */
import { Type } from '@sinclair/typebox'

// ── runtime.switch ────────────────────────────────────────────────────────

/**
 * `POST /api/runtime/switch`（handler：`routes/runtime-switch.ts`
 * `handleRuntimeSwitch` → `performRuntimeSwitch`）。
 *
 * body 必须是合法 JSON（空 body / 非法 JSON → 400），但 `plugin` 可缺省：
 * 空串 = 按持久化配置重建（内置 opencode）。插件名 trim 后必须是 loader
 * 可见的名字（否则 400 `not-found` + `available`），`opencode@v2` 这类
 * pinned dialect 是同一 runtime 的方言，不算 fallback。
 */
export const RuntimeSwitchRequest = Type.Object({
  plugin: Type.Optional(Type.String({
    description: 'Runtime plugin name (loader key or alias); empty/absent rebuilds the configured runtime.',
  })),
})

// ── runtime.dryEvent ──────────────────────────────────────────────────────

/**
 * `POST /api/runtime/dry-event`（handler：`routes/dry-event.ts`
 * `handleDryEvent`）。
 *
 * 输入一个 **runtime 原生事件样本**，形状是 adapter-owned：
 *   - 直接事件对象（`{ type, ...payload }`，opencode 形状 A/B 均可）；
 *   - 或 `{ event: <原生事件>, plugin? }` 信封。
 * 因此 `event` 声明为开放对象边界，顶层也 `additionalProperties:true`
 * （否则直接对象形态会被契约判非法 —— 那是契约比 handler 更严）。
 * handler 要求 body 是合法 JSON 对象（否则 400），故 `requestRequired`
 * 保持 true；未知 `plugin` → 400（已注册但无映射声明也是 400 的另一种文案）。
 */
export const RuntimeDryEventRequest = Type.Object({
  event: Type.Optional(Type.Object({}, {
    additionalProperties: true,
    description: 'Runtime-native event payload (adapter-owned). Omit to treat the top-level object itself as the event.',
  })),
  plugin: Type.Optional(Type.String({
    description: 'Apply this runtime plugin’s event mapping table before normalization; absent → identity.',
  })),
}, {
  additionalProperties: true,
  description: 'Either { event: {...}, plugin? } or a bare runtime-native event object.',
})

// ── runtime.conformance ───────────────────────────────────────────────────

/**
 * `POST /api/runtime/conformance`（handler：`routes/conformance.ts`
 * `handleConformance`）。
 *
 * 无 body / 非法 JSON 都退化为「跑全部场景」（handler 的 catch 分支），
 * 因此是可选 body。`scenarios` 只保留命中 `SCENARIOS` 的 id；
 * `timeoutMs` 只接受 number（其它类型忽略）。注意：这会驱动真实会话、
 * 消耗 LLM 调用。
 */
export const RuntimeConformanceRequest = Type.Object({
  scenarios: Type.Optional(Type.Array(Type.String(), {
    description: 'Scenario ids to run (unknown ids are ignored); absent → every scenario.',
  })),
  timeoutMs: Type.Optional(Type.Number({
    description: 'Per-scenario observation window; non-number values are ignored.',
  })),
})

// ── runtime.config.update ─────────────────────────────────────────────────

/**
 * `PATCH /api/runtime-config`（handler：`routes/runtime-config.ts`
 * `attachRuntimeConfigRoutes` → `RuntimeHost.config.update(body)`）。
 *
 * 请求体是 **runtime 原生 Config 文档**（merge 语义由 runtime host 定义：
 * 缺省字段保留、显式 null 清空），gateway 只 `JSON.parse` 后原样转发，
 * 不读任何字段。字段面归 runtime 所有，因此声明为开放对象边界而不是
 * 伪造一份可能立刻过期的 Config schema；body 必须存在（空 body 解析失败
 * → 500），所以 `requestRequired` 保持 true。
 */
export const RuntimeConfigUpdateRequest = Type.Object({}, {
  additionalProperties: true,
  description: 'Runtime-native Config merge document (shape owned by the active runtime; gateway forwards it verbatim).',
})
