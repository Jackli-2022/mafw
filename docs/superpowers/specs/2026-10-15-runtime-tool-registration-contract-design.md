# Runtime 契约必选工具注册接口设计 spec

日期：2026-10-15 · 状态：已批准待实施 · 前置：`docs/superpowers/specs/2026-10-13-tool-class-layer-design.md`（其非目标中的「`tools.install` 契约动词 + per-runtime 类别覆盖表」即本 spec 兑现）· 用户已批准方案 A

## 1. 目标与非目标

**目标**：
1. `RuntimeClient` 新增**非可选** `tools: RuntimeTools` 接口（`registerTools(factory)` + `nativeTools()`），纳入 Tier-0 必选基线——无能力位、无条件 hard 校验（缺 → 插件拒绝回退 opencode，激活期报错可见）；
2. 六件套（`mafw_add_memory` / `mafw_python` / `mafw_python_restart` / `mafw_media_speak` / `mafw_media_upload` / `mafw_media_ask`）spec 与执行逻辑收敛为 **gateway 单一来源**（`runtime/mafw-tools.ts`），执行逻辑从 pi extension 上移为 runtime 中性实现（execute 闭包随 spec 走）；
3. runtime 可**声明原生工具清单**（name + toolClass），经 tool-classes overlay 优先于并集表生效——审批 `isReadOnlyTool` / 身份 `resolveToolCategory` / 事件 `enrichToolClass` 零改动受益；
4. HTTP 补充通道（`GET /api/tools` + `POST /api/tools/execute`）覆盖 out-of-process runtime（agent 进程无法持有 in-process 闭包）。

**非目标**：v1 opencode 插件（`src/tools/`）不重构（生产宿主，v2 迁移统一——描述文本两处暂存记为文档债）；MCP 40 工具不经本通道（那是 opencode 的 MCP 自接线面，边界 = HostAdapter 六件套）；desktop/TUI 零改动（六工具已有卡，事件流不变）。

## 2. 现状痛点

- 第三方 runtime 插件（`~/.mafw/runtime-plugins/`）**无任何路径**获得 MAFW 基础工具——agent 无记忆工具，核心闭环断裂；
- 六件套实现重复两处（v1 插件 `src/tools/*.ts` + pi `pi-mafw-host-extension.ts` 手写 registerTool ×6，spec 与执行逻辑 270 行绑死 pi）；
- tool-classes 并集表硬编码，runtime 无法声明自己的 read/write/agent 等原生工具名 → 未知名落 `other`，审批/身份只能保守处理；
- 契约必选面（validate.ts hard 层）不含任何工具维度。

## 3. 决策记录

| 决策点 | 结论 | 备选（否决理由） |
|---|---|---|
| D1 必选语义 | **无条件 hard**（无能力位）：runtime 无工具通道 = agent 没有记忆工具 = 核心功能缺失，正是「必须」语义 | 能力位 + 503 门（声明式降级适合丰富度功能，不适合核心闭环） |
| D2 execute 归属 | **execute 闭包随 spec 走**（gateway 单源 `buildMafwToolFactory`；runtime 只做 plumbing ~15 行） | 只推 spec 数据（第三方仍要写 ~100 行执行逻辑）；通用端点为中心（in-process runtime 绕 HTTP 一圈丢闭包直调） |
| D3 factory 形态 | `registerTools(factory: (sessionId) => MafwToolRegistration[])`——按会话惰性调用，闭包携带 sessionID（python 内核亲和 / add_memory 归因）；幂等 = 重复调用替换 | 静态 specs + runtime 自取 sessionId（闭包无法按会话构造） |
| D4 nativeTools 必选级 | **必选函数，`[]` 合法**——强迫插件作者思考工具类别；坏条目 warning + 跳过不阻断 | 可选（作者会跳过思考，obs 3 的类别缺口保留） |
| D5 overlay 优先级 | runtime 声明 **优先于** 并集表（它最懂自己的工具）；小写归一；激活期 set、热切换整体替换 | 声明只作补充表查 miss（runtime 特有语义被并集表压住） |
| D6 opencode 实现 | `registerTools` = 确认 no-op（六件套由 v1 宿主插件承载、MCP 面自接线——通道已存在，推送为通道确认）+ debug 日志 | opencode 也走 factory（v1 插件刻意不重构，通道重复） |
| D7 out-of-process 通道 | `GET /api/tools`（spec 清单）+ `POST /api/tools/execute {name, params, sessionID}`（复用同一 factory；未知名 404）；信任域与既有 `/api/python/execute` 一致（loopback 绑定） | 强制 IPC plumbing（插件作者负担重） |
| D8 pi 的 schema 翻译 | `T.Unsafe(jsonSchema)`（typebox 1.3.7 有 `Unsafe` 导出，包 JSON Schema 为 TSchema）；spike 验证 `~unsafe` 标记是否泄漏 wire（OpenAI strict 模式风险）→ fallback：jsonSchema → T.Object 简单子集翻译器 | pi 侧保留手写 typebox（spec 双源，D2 失效） |

## 4. 契约与校验

```typescript
export interface MafwToolRegistration {
  name: string;
  label?: string;
  description: string;
  parameters: Record<string, any>;   // JSON Schema（object 形态）；runtime 翻译为自家类型系统
  execute(params: any, signal?: AbortSignal): Promise<{ text: string; isError?: boolean }>;
}

export interface NativeToolDeclaration { name: string; toolClass: TOOL_CLASS; }

export interface RuntimeTools {
  registerTools(factory: (sessionId: string) => MafwToolRegistration[]): Promise<void>;
  nativeTools(): NativeToolDeclaration[];
}
// RuntimeClient 增非可选字段 tools: RuntimeTools（contract.ts 头注释：Tier 0 = sessionApi + promptWhileBusy + 工具注册通道）
```

- **validate.ts hard +2**：`tools` 缺失 / `registerTools` 非函数；`nativeTools` 非函数——均无条件检查（非 cap 门控），hard → 抛错 → 调用方回退内置 opencode + hub status error；
- **激活期（index.ts createRuntime）**：`applyRuntimeValidation` 之后调 `rt.tools.registerTools(buildMafwToolFactory(...))`（时序保证在会话创建前；pi 侧 stash，无竞态）；再调 `nativeTools()` 校验条目（name 非空字符串 + toolClass ∈ 枚举，坏条目 warning + 跳过）→ `setToolClassOverlay(好条目)`；
- 热切换（runtime-switch）走同一 createRuntime 路径，overlay 被新 runtime 声明整体替换。

## 5. 单源模块（gateway/src/runtime/mafw-tools.ts，新）

- 六件套静态 spec（name/label/description/parameters JSON Schema，描述文本与现行 pi extension 逐字一致）+ 每工具 execute 实现（迁移自 pi extension，复用 host-adapter helpers：`postToolJson` / `a2aRequest` / `taskAnswer` / `mediaDataFromSource` / `makeMediaPointer`）；
- `buildMafwToolFactory({ baseUrl, fetchImpl? })` → `(sessionId) => MafwToolRegistration[]`；media_ask 的 GetTask→SendMessage 多步逻辑在此；
- HTTP 路由复用同一 factory：`POST /api/tools/execute` = `factory(sessionID)` 按名查找 → `execute(params)`。

## 6. pi / opencode 接线

- **pi**：`PiSessionRegistryOptions` 增 `toolFactory?` + `setToolFactory()`；runtime 对象 `tools.registerTools = (f) => registry.setToolFactory(f)`；`createMafwHostExtension` 的 `on(pi)` 消费 `toolFactory(sid)` 逐条 `pi.registerTool({name, label, description, parameters: T.Unsafe(r.parameters), execute: (_id, p, sig) => r.execute(p, sig)})`（typebox 经既有 ESM 桥 `getType`，不可达时 fail-open 跳过 + warn）；extension 270 → ~90 行；`nativeTools()` 返回 pi 清单（read/bash/edit/grep/find/ls/...，实施期对照 pi 源码枚举）；
- **opencode**：`registerTools` = no-op ack + debug 日志；`nativeTools()` 声明 read/write/edit/bash/grep/glob/list/task/webfetch/todowrite；
- `cfg.hostExtension === false` 时 pi 工具随认知面扩展一起下线（现状语义保持）。

## 7. tool-classes overlay

```typescript
export function setToolClassOverlay(entries: Array<{ name: string; toolClass: string }>): { applied: number; invalid: string[] };
export function clearToolClassOverlay(): void;
// toolClassOf：overlay（小写归一）→ TOOL_CLASS_TABLE → 'other'
```

消费方零改动：审批 `isReadOnlyTool` / 身份 `resolveToolCategory` / 事件 `enrichToolClass` 全部经 `toolClassOf` 单点。迁移故事：并集表降级为回退层，逐步被各 runtime 声明取代。

## 8. 实施清单（TDD）

1. `runtime/mafw-tools.ts` + `mafw-tools.test.ts`（6 工具唯一名 / JSON Schema 形状 / factory 按会话闭包携带 sessionId / execute 分发 mock fetch / media_ask 多步 / 未知名错误）；
2. `tool-classes.ts` overlay + 测试增（优先级 / 无效条目 / clear / 替换）；
3. `contract.ts` 类型 + `validate.ts` hard ×2 + validate 测试增（缺 tools → hard；present → 无 issue）；
4. `index.ts` 激活接线（registerTools + nativeTools 校验 + setToolClassOverlay）；
5. pi：registry `toolFactory` + extension 瘦身 + `T.Unsafe` spike（wire 序列化验证，`~unsafe` 泄漏则启用 fallback 翻译器）+ pi-runtime `tools` 实现 + 测试改；
6. opencode-runtime `tools` 实现 + 测试；
7. `routes/tools.ts`（GET /api/tools + POST /api/tools/execute）+ 路由测试；
8. 文档：contract 头注释 / loader.ts README_CONTENT 插件模板 + tools 段 / `.opencode/skills/runtime-plugin-authoring/SKILL.md`（第三方 ~15 行 plumbing 示例 + out-of-process HTTP 通道）/ AGENTS.md §5.19；
9. 全量回归（gateway jest + build）。

## 9. 验收

- 契约：缺 `tools` 的插件被 hard 拒绝（回退 opencode + hub error 可见）；`GET /api/runtime` validation notes 含新校验项；
- 单源：pi extension 不再含六件套 spec/执行逻辑文本；`GET /api/tools` 返回 6 条 spec；
- overlay：runtime 声明 `find → readonly` 后 `isReadOnlyTool('find')` / 身份判定 / `part.toolClass` enrich 均生效；未声明名字回落并集表；
- 第三方：按 SKILL.md 模板实现 ~15 行 plumbing 的插件在测试中通过 registerTools → factory → 执行全链路；
- 全量：gateway jest 绿 + `npm run build` exit 0。

## 10. 风险与边界

- **T.Unsafe `~unsafe` 标记泄漏 wire**（D8）：spike 优先，fallback 翻译器已预案；
- 激活时序：registerTools 在会话创建前完成（createRuntime 内 await）；factory 缺席（如 hostExtension off）fail-open + warn，不阻塞会话；
- overlay 与历史事件：enrich 只作用于活事件，历史/重放不经 overlay（现状语义）；
- 六件套描述文本在 v1 插件与 gateway 两处暂存（v2 迁移统一，文档债记录于 AGENTS.md）。
