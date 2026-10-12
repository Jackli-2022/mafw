# 跨 runtime 工具 part 兼容设计（ToolPartAssembler + MessageNormalizer）

日期：2026-10-12
状态：草稿（待逐节批准）
前置调研：`docs/research/2026-10-12-tool-call-result-model-compat.md`（各家 call/result 模型 + MAFW 断层实证）；相关：`docs/superpowers/specs/2026-10-08-event-mapping-registration-design.md`（事件映射注册，本设计是其延续而非 reopen）

## 1. 问题

canonical `ToolPart`（opencode 形状：单 part + `state` 判别联合，call/result 同体）与多数 runtime 的原生模型不匹配——Claude/pi(pi-ai)/Kimi/dsh 原生是「call 与 result 两条独立记录、id 关联」。现状已造成实际断层：

- pi 映射表产 `part.type: "tool-call"/"tool-result"`（`gateway/src/runtime/pi/pi-events.ts:17-18`），桌面 `renderable()` 只认 `type === "tool"`（`packages/session-ui/src/components/parts-rules.ts:16`）→ **pi 工具卡在桌面从不渲染**；
- `PiSessionRegistry.messages()` 原样返回 pi 原生消息（`pi-session.ts:229-233`），桌面 `loadSessionHistory` 期望 `{info, parts}` → 历史无工具卡；
- gateway 无任何合成点（canonical facet 表不碰 tool，纯透传）。

**目标**：任何「call/result 分离」的 runtime 只需**声明式抽取三个原语**（`tool.call` / `tool.delta` / `tool.result`），gateway 统一合帧成 opencode 形状 ToolPart；历史消息统一过 normalizer 转 `{info, parts}` DTO。前端、trajectory、flow-card、obs/capture 全部零改动。

**非目标**：Claude/Codex/dsh 插件本体（后续立项）；canonical 词汇表中立化（10-08 已拍板沿用 opencode 形状）；usage/plan/question/subagent 词汇扩展（10-08 清单，另行评审）。

## 2. 决策记录（提案）

| 决策点 | 提案 | 备选（否决理由） |
|---|---|---|
| join 责任归属 | **gateway 侧 assembler**（方案 B） | 插件各自手写 join（N 份重复暗知识，无公共测试面）；canonical 中立化双 part（与 10-08 决策冲突，消费者面太大） |
| 原语进 canonical 词汇表 | **不进公开词汇表**：`tool.call/delta/result` 是 assembler 的内部入口类型，不广播、不进 SDK events.ts | 进词汇表（冻结面扩大；消费方误以为可直接订阅） |
| assembler 挂载点 | runtime 事件流包装层：plugin raw → eventMappings → **assembler** → canonical `message.part.updated` → handleOpencodeEvent | handleOpencodeEvent 内部拦截（污染现有消费者链路）；desktop 侧 join（违背 canonical 单一形状） |
| part.id 物化 | 确定性 `toolpart_<callID>`——live 事件与历史 normalizer 收敛同 id，store upsert 天然去重 | 随机 id（live/history 双份并存）；裸 callID（与其他 part 类型撞名空间） |
| delta 语义 | `kind: 'input' \| 'output'` 二态：input=参数增量（Claude input_json_delta / kimi tool.call.delta），output=输出增量（codex commandExecution/outputDelta） | 单 delta（语义混淆）；不支持 delta（丢 codex/kimi 能力） |
| 无 call 直接 result | assembler 合成 pending→completed 两帧（result 携带 toolName/input 时回填） | 丢弃（崩流后工具卡整个消失） |
| 历史转换位置 | runtime 契约可选 `session.normalizeMessages`（缺省恒等），gateway messages 路由统一过 | desktop 侧适配（每客户端重做一遍）；插件自转 DTO（同 A 的重复问题） |

## 3. 架构

```
插件原生事件 ──▶ eventMappings（纯数据表，新增三原语抽取）
                  │
                  ▼
        tool.call / tool.delta / tool.result   ← 内部类型，不广播
                  │
                  ▼
        ToolPartAssembler（gateway 拥有，per-session，callID 键控状态机）
                  │  产出 opencode 形状快照
                  ▼
        message.part.updated { part: ToolPart } ──▶ handleOpencodeEvent ──▶ facet/广播/桌面
（opencode runtime：原生已融合，assembler 恒等直通）

历史路径：runtime.session.messages() ──▶ session.normalizeMessages?() ──▶ {info, parts}[] ──▶ 桌面 loadSessionHistory
```

assembler 位于 runtime 事件流包装层（与 `wrapGlobalEventStream` 同层、其后），对 `handleOpencodeEvent` 及全部下游透明。

## 4. ToolPartAssembler

```ts
// gateway/src/runtime/tool-part-assembler.ts
interface ToolCallPrimitive {
  sessionID: string; messageID?: string;
  callID: string; tool: string;
  input?: Record<string, unknown>;      // 一次性结构化参数（无流式时）
  title?: string;
}
interface ToolDeltaPrimitive {
  sessionID: string; callID: string;
  kind: 'input' | 'output';
  text: string;                          // input: 参数 JSON 增量片段；output: 输出增量
}
interface ToolResultPrimitive {
  sessionID: string; callID: string;
  output?: string; isError?: boolean;
  tool?: string; input?: Record<string, unknown>;  // 无 call 兜底回填
  title?: string; metadata?: Record<string, unknown>;
}
// 出口：标准 opencode message.part.updated 载荷
type EmitFn = (part: ToolPart) => void;
```

### 状态机（per callID）

```
        tool.call                tool.delta(input)            tool.result
  ──▶ pending(raw累积) ─────────────────────────────▶ pending ──▶ completed | error
        │  tool.delta(output)/首个执行信号
        └──────▶ running ────────────────────────────────────────▶ completed | error
```

- `call`：建 part（`id: toolpart_<callID>`，state `{status:'pending', input, raw:''}`）；input 已结构化则直接 `running` 语义由 delta/result 推进，桌面 shimmer 两种状态同处理。
- `delta kind:input`：追加 `raw`；每帧尝试 `JSON.parse(raw)`，成功则写入 `state.input`（增量结构化预览）。
- `delta kind:output`：首帧 pending→running；追加 output 预览（可选广播——能力位 `toolOutputDelta`，默认关，防大屏输出刷屏）。
- `result`：终态。`isError` → `{status:'error', error: output}`；否则 `{status:'completed', output, title, metadata, time:{start,end}}`。input 以 call/累积 raw 的最后一次成功 parse 为准。
- **每帧产全量快照**（opencode 语义），不产增量——store upsert 幂等合并。

### 防御与边界

| 情形 | 处置 |
|---|---|
| result 无先序 call | 用 result.tool/input 合成完整终态 part；缺 tool 名 → `unknown`，warn 一次 |
| 重复 result | 后者覆盖（与 opencode 多次 part.updated 同语义） |
| 缺 callID | 生成 uuid，warn 一次（该 runtime 映射表缺陷，加载期校验应已拦截） |
| 会话清理 | `session.deleted`/runtime dispose 时释放 per-session 表；重启后历史走 normalizer 重建，不依赖 assembler 状态 |
| messageID 缺失 | assembler 维护 per-session 当前 assistant 消息锚点（沿用 pi 合成 id 模式：`{runtime}_asst_<sid>_<turnSeq>`），同时产一条 `message.updated`(assistant) 保证载体存在——对齐现有 `ensureAssistantMessage` 语义 |

## 5. eventMappings 扩展

映射表 `to` 新增三个内部目标（loader 校验白名单扩充，SDK 公开词汇表不动）：

```js
{ from: 'tool_call', to: 'tool.call',
  fields: { callID: { path: '$.toolCallId' }, tool: { path: '$.toolName' }, input: { path: '$.args' } } },
{ from: 'tool_result', to: 'tool.result',
  fields: { callID: { path: '$.toolCallId' }, output: { path: '$.text' }, isError: { path: '$.isError' } } },
```

声明式表达边界不变（10-08 spec §4）：跨事件状态机在 assembler（gateway 拥有），插件侧仍零状态。Claude 类 `content_block index → callID` 物化是**插件逃逸口**职责（per-session index 表），assembler 只吃已物化 callID。

## 6. MessageNormalizer

runtime 契约 `session` 增可选方法：

```ts
normalizeMessages?(raw: unknown[]): Array<{ info: MessageInfoLike; parts: PartLike[] }>
```

- gateway `/api/sessions/:id/messages` 路由统一过（缺省恒等 = opencode 直通）。
- **pi 转换器**：assistant 消息的 `ToolCall` content block + 后续 `ToolResultMessage`（toolCallId 关联）→ 单 ToolPart（`id: toolpart_<callID>`，state completed/error）；toolResult 消息被消费、不再作为顶层消息；user/assistant 文本 → text part。无原生 id 的消息用 `时间戳+序号` 合成稳定 id。
- pi 会话重启后 `fromFile` 重建的消息同路径转换——assembler 状态不参与历史。

## 7. pi dogfood 改造（顺带修现存缺口）

1. `PI_EVENT_MAPPINGS`：`tool_call`/`tool_result` 两行改产 `tool.call`/`tool.result` 原语（字段路径对齐 pi 实际载荷）；`toolcall_delta` 有则接 `tool.delta kind:input`。
2. pi runtime 加 `normalizeMessages`（§6）。
3. 验收：pi 会话在桌面**首次出现工具卡**（live + 历史）；flow-card 内联锚定获得 callID（替代 `findPendingToolPart` 反推兜底）；obs/capture 路径不变（host extension 直捕 tool_result，本就不走 part 流）。
4. 现存断言零修改绿（pi-events 存量测试改断三原语输出，属目标行为变更，逐条对照更新）。

## 8. opencode 恒等路径与 oracle 验证

- opencode 不声明三原语映射 → assembler 收不到内部类型 → 恒等直通。oracle 测试：同一事件语料过「assembler 接线前后」两条链，广播输出逐字节一致。
- dry-event 试衣间支持三原语：`POST /api/runtime/dry-event { plugin, event }` 输出链追加 assembler 跳（合成 ToolPart 快照回显）。

## 9. 测试策略与增量

| 套件 | 内容 | 预估 |
|---|---|---|
| tool-part-assembler | 状态机全路径 + 防御表（§4 六种边界）+ id 物化 + messageID 锚点 | ~12 |
| pi 映射改造 | 三原语输出断言（逐条对照旧表）+ oracle | ~6 |
| normalizer | pi 消息→DTO：call+result 归并 / 无 result 的 call / 多 tool 混杂文本 / id 稳定性 | ~6 |
| 契约/接线 | assembler 挂接、loader 白名单、dry-event 新跳 | ~4 |
| **合计** | | **~+28** |

TDD 先行；桌面/TUI 测试零改动即兼容证明。

## 10. 风险

| 风险 | 缓解 |
|---|---|
| assembler 有状态引入崩溃脏态 | per-session 持有、session 删除联动清理；历史不依赖它 |
| messageID 锚点错配导致工具卡挂错消息 | 锚点分配集中 assembler 一处 + 契约测试钉扎；沿用 pi 合成 id 既有模式 |
| output delta 大输出广播风暴 | `toolOutputDelta` 能力位默认关；kimi/codex 接入时再按 runtime 开 |
| 三原语内部类型被误当公开词汇订阅 | 不进 SDK events.ts；广播层显式过滤 + 未知类型遥测兜底 |

## 11. 不在范围（YAGNI）

- Claude/Codex/dsh/Kimi 插件本体（本设计是它们的**接入面**，插件各自立项）
- canonical 词汇表中立化 / schemaVersion（10-08 spec §8）
- usage/plan/question/subagent 词汇扩展（10-08 调研 §5.3 清单）
- 桌面渲染层任何改动（本设计的不变量）
