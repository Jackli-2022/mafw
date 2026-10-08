# 事件映射注册接口设计（Event Mapping Registration）

日期：2026-10-08
状态：已批准（四节设计逐节确认）
前置调研：`docs/research/2026-10-03-agent-runtime-sdk-survey.md`；行业模式调研（OTTL/EventBridge/ECS/AI SDK v2/DAP/Cordis，2026-10-08）

## 1. 问题

runtime 插件接入事件流时，今天必须手写翻译层把自己的原生事件**伪装成 opencode 形状**（pi 的 `translatePiEvent`：11 种原生事件 → opencode wire 形状），gateway 再用硬编码的 `normalizeOpencodeEvent` 二次解析出 EventFacets。成本：

- 插件作者要复制 10 类暗知识（信封约定、canonical 形状、facet 产生规则、丢弃集、前缀豁免、rewrite 双发语义…）
- pi 原始事件名在 gateway 边界丢失（trajectory/排错看到的是伪装后的形状）
- 已产出实际 bug：pi `turn_end` 翻译用 `assistantMessageID`，而 step facet 提取器读 `part.messageID`——pi 上 BudgetGuard step 计数从未触发（被 pi 未声明 turnBudgetApi 掩盖）

**目标**：gateway 提供声明式注册接口，插件用纯数据表声明「原生类型 → canonical 类型 + 字段构造」，不再手写适配层。

## 2. 决策记录（用户逐节批准）

| 决策点 | 结论 | 备选（否决理由） |
|---|---|---|
| 抽象形态 | 声明式映射注册 | 归一化函数注册（又回手写代码）；两层混合（复杂度） |
| 映射表宿主形态 | `module.exports.eventMappings` 纯数据 + 模块级 `transformEvent` 独立逃逸口 | 字段级内嵌函数（失去静态校验，两种机制混合语义复杂）；ctx API 注册（加载期校验推迟到 createRuntime 执行） |
| canonical 词汇表 | 沿用 opencode 形状（25+13 类型不动） | 重设中立词汇（客户端冻结面全动，工程量大一个数量级；v2 迁移时再评估） |
| 现有 runtime 迁移 | opencode + pi 都迁入（dogfood） | 只服务插件（两套机制并存）；pi 先迁 opencode 随 v2（opencode 知识仍硬编码） |

## 3. 架构：两张表，一条链

```
插件原生事件 ──▶ [PluginEventMap] ──▶ canonical 事件 ──▶ [CanonicalFacetTable] ──▶ EventFacets ──▶ handleOpencodeEvent
（插件声明，纯数据）        （opencode 形状词汇表）      （gateway 拥有，纯数据）          （现有消费者零改动）
```

- **PluginEventMap**（插件侧）：原生类型 → canonical 类型 + properties 构造。pi `translatePiEvent` 表化。
- **CanonicalFacetTable**（gateway 侧）：canonical type → facet 提取规则。`normalizeOpencodeEvent` 的 if 链表化。**插件不需要懂 facet**——facet 是 gateway 的协议知识。
- opencode 迁入：其原生事件即 canonical 事件，PluginEventMap 为恒等（可省略声明），迁移工作量全在 CanonicalFacetTable 化。

行业依据：ECS 模式（词汇表与规则宿主定义，插件只搬运）；DAP 模式（词汇表只增不废 + capabilities 位）；OTTL/EventBridge（声明式映射 + 加载期校验 + 错误 fail-open）。

## 4. PluginEventMap Schema（纯数据，JSON-serializable 子集）

```js
// ~/.mafw/runtime-plugins/my-runtime.js
module.exports = {
  name: 'my-runtime',
  capabilities: { eventStream: true, /* ... */ },

  // 原生信封形状声明：gateway 从原始事件取 type/sessionID 的路径
  eventSource: {
    typePath: '$.type',              // 必填：原生事件类型字段
    sessionIdPath: '$.session.id',   // 可选；插件出口已解析 sessionID 可省略
    directoryPath: '$.directory',    // 可选
  },

  // 核心：原生类型 → canonical 类型 + properties 构造
  eventMappings: [
    // 纯改名（properties 原样透传）
    { from: ['agent_end', 'agent_settled'], to: 'session.idle' },

    // 字段构造：path 抽取 / const 常量 / template 模板（EventBridge 式 {$.path} 插值）
    { from: 'message_update', to: 'message.part.updated',
      fields: {
        'part.type': { const: 'text' },
        'part.text': { path: '$.delta' },
      } },

    // template 覆盖 ID 物化（pi_step_<sid> 类），无需逃逸口
    { from: 'turn_end', to: 'message.part.updated',
      fields: {
        'part.type': { const: 'step-finish' },
        'part.messageID': { template: 'pi_step_{$.sessionID}' },
      } },

    // 条件行：when 全部满足才命中（纯数据条件）——例：仅带 delta 的
    // message_update 才产 canonical 事件，无 delta 的心跳帧丢弃
    { from: 'message_update', to: 'message.part.updated',
      when: [{ path: '$.delta', exists: true }],
      fields: {
        'part.type': { const: 'text' },
        'part.text': { path: '$.delta' },
      } },

    // 显式丢弃
    { from: 'queue_update', to: 'drop' },
  ],

  // 逃逸口：跨事件状态机、1→N 扇出、真副作用。未匹配的 from 才轮到它。
  // 返回 null = 丢弃；返回数组 = 扇出。
  transformEvent(raw, ctx) { /* ... */ },

  async createRuntime(ctx) { /* ... */ },
};
```

### 规则语义

- `fields` 值三选一：`{path}` / `{const}` / `{template}`——无裸字符串，无歧义。
- 路径语法 = 裁剪 JSONPath 子集（点号 + 数组下标）。**无 eval、无脚本表达式**。理由修正：同进程可信插件下 eval 不扩大恶意威胁模型，但①表达式混入数据面会扩大威胁；②运行期崩溃 vs 加载期校验；③丧失试衣间/字段契约的静态分析能力。
- `sessionID` 命中后自动注入 properties（`part.sessionID`/`info.sessionID` 按 canonical 类型字段契约推断），插件不用每条手写。（与 §5 facet 执行器的信封级五层提取链是两个层面：这里是**构造** canonical properties 时注入，那里是**消费**时从信封提取。）
- 命中优先级：`eventMappings` 数组顺序，先匹配先赢；未匹配 → `transformEvent`；再未匹配 → 丢弃 + 未知类型遥测（与现状 fail-open 一致）。
- 路径不存在 → 该字段不创建（EventBridge 语义），可见性由加载期校验 + dry-event 试衣间提供。
- `to: 'drop'` 显式丢弃（等价 pi 现状 default → null）。

### 声明式表达边界（调研共识，不做）

| 能声明式 | 不能（走 transformEvent 逃逸口） |
|---|---|
| 字段路径抽取/重命名 | 跨事件状态机 |
| 常量注入 / template 插值 | 真副作用 ID 生成（序列分配等） |
| 类型转换（枚举） | 1→N 扇出 / N→1 聚合 |
| 简单条件路由（when） | 增量 JSON 累积（tool_calls 分片） |

## 5. CanonicalFacetTable Schema（gateway 侧）

```ts
// gateway/src/runtime/canonical-facets.ts
export interface FacetCondition {
  path: string;
  equals?: unknown;    // 与 exists 二选一
  exists?: true;
}

export interface FacetRule {
  type: string;                        // canonical type（多条同 type 时数组顺序=优先级）
  when?: FacetCondition[];
  step?: { sessionID: string; assistantMessageID: string; finish: string };  // 值=路径
  chatSignal?: 'delta' | 'complete' | 'error';
  deltaText?: string;                  // path
  chatError?: string;                  // path
  broadcast?: 'idle' | 'error' | 'passthrough';
  compaction?: 'start' | 'end';
  toolCommand?: string;                // path
  // 值 = 路径；string[] = 多路径回退（取第一个存在的）——approval 的
  // 双形状对齐（requestId??id / permission??toolName）靠它表达。
  approval?: { requestId: string | string[]; toolName: string | string[]; patterns?: string; metadata?: string };
}
```

`CANONICAL_FACET_RULES` 初始内容 = `normalizeOpencodeEvent`（normalize.ts:97-163）if 链的逐行表化：

```ts
export const CANONICAL_FACET_RULES: FacetRule[] = [
  // step 三载体
  { type: 'session.next.step.ended',
    step: { sessionID: '$.sessionID', assistantMessageID: '$.assistantMessageID', finish: '$.finish' } },
  { type: 'message.part.updated', when: [{ path: '$.part.type', equals: 'step-finish' }],
    step: { sessionID: '$.part.sessionID', assistantMessageID: '$.part.messageID', finish: '$.part.reason' } },
  { type: 'message.updated',
    when: [{ path: '$.info.role', equals: 'assistant' }, { path: '$.info.time.completed', exists: true }],
    step: { sessionID: '$.info.sessionID', assistantMessageID: '$.info.id', finish: '$.info.finish' } },
  // chatSignal / broadcast
  { type: 'message.part.updated', when: [{ path: '$.part.text', exists: true }],
    chatSignal: 'delta', deltaText: '$.part.text' },
  { type: 'session.idle', chatSignal: 'complete', broadcast: 'idle' },
  { type: 'session.error', chatSignal: 'error', broadcast: 'error' },
  { type: 'message.error', chatSignal: 'error' },
  // compaction
  { type: 'session.compacting', compaction: 'start' },
  { type: 'session.compacted', compaction: 'end' },
  // approval（双形状对齐：requestId??id / permission??toolName 用路径回退数组表达）
  { type: 'permission.asked',
    approval: { requestId: ['$.requestId', '$.id'], toolName: ['$.permission', '$.toolName'], patterns: '$.patterns' } },
  // toolCommand：type 匹配条件（type.includes('tool')）+ 路径回退
  // （args.command / info.args.command / payload.args.command）——type 匹配条件
  // 表达不了 includes 语义，保留为执行器内置特例（同 sessionID 提取链），
  // 文档化进表头注释；…全量规则在建表时逐行对照 normalize.ts 现状补齐
];
```

- `normalizeOpencodeEvent` 重构为纯查表执行器 `evaluateFacetRules(rules, event)`：opencode 知识与执行机制分离。
- **sessionID 五层提取链**（`props.sessionID || part.sessionID || info.sessionID || payload.sessionID || evt.sessionID`）保留为执行器内置行为（它是信封约定不是 facet 规则），文档化进表头注释。
- 顺手修 pi step bug：pi 映射表 template 写 `part.messageID`，facet 规则读 `$.part.messageID`——对齐天然成立。

## 6. 加载期校验与可观测性

**loader 扩展**（`validate.ts`）——插件声明 `eventMappings` 时静态检查：
- `to ∈ canonical 词汇表 ∪ 'drop'`（词汇表来自 `packages/gateway-sdk/src/events.ts`，单一事实源）
- `eventSource.typePath` 必填且语法合法；所有 `path`/`template` 插值语法合法
- canonical 目标必填字段覆盖检查（对照 `event-field-contract.ts` 的逐类型清单）——缺失 warn 不拒载
- 校验失败 = 该插件 `eventStream` 能力降级 + error 状态（fail-open，与现状一致）

**dry-event 试衣间升级**：`POST /api/runtime/dry-event` 接受 `{ plugin: 'pi', event: <原生事件> }`，走完整链路（eventSource 提取 → 映射表 → facet 表 → flow 矩阵 → 字段契约）输出每跳结果。插件作者自测不起会话。

**未知类型遥测**：映射后仍为未知 canonical 类型的事件走现有 `UnknownEventTracker`（行为不变）。

## 7. 迁移与验证策略

顺序（pi 先，opencode 后）：

1. **执行器先行**：`applyEventMappings`（插件表）+ `evaluateFacetRules`（facet 表）两个纯函数落地，完整单测（路径求值/when 条件/template 插值/优先级/丢弃/路径不存在语义）。
2. **pi 迁入**：`translatePiEvent` → `eventMappings`；`pi-events.test.ts` 存量断言**零修改全绿**即行为等价证明（Phase 3 host-adapter 同款方法论）；`turn_end` 修 `part.messageID` 对齐（新增断言钉扎）。
3. **opencode 迁入（dogfood）**：`normalizeOpencodeEvent` 逐行表化。验证不双跑——旧函数保留一个 commit 作为**测试 oracle**：fixture 语料（现有 normalize/pi-events/event-flow-matrix 测试用例 + 手工补边界样本）上断言 表输出 ≡ 函数输出，绿后删函数。
4. **暗契约补登**（顺带小修）：`permission_mode`（gateway 自发，index.ts:2212）与 `session.diff`（opencode v2 passthrough）入 `events.ts` union + `event-flow-matrix`，消除矩阵单一事实源的两个已知漏洞。

**测试增量预估**：执行器 ~15 + facet 表 oracle 对照 ~10 + loader 校验 ~6 + dry-event 扩展 ~4 + pi bug 修复钉扎 ~2 ≈ **+37 测试**。

## 8. 不在范围（YAGNI）

- canonical 词汇表中立化（并入将来 v2 迁移立项）
- `schemaVersion` 事件自标注（v2 落地时再评；词汇表只增不废期间不需要）
- 1→N 扇出 / 跨事件状态机的声明式表达（逃逸口函数覆盖——AI SDK/DAP 用整层放弃声明式证明此类逻辑永远手写）
- HostAdapter 认知面四动词（独立通道，不动）
- pi `message_end` 无 `time.completed` 导致不产 trajectory step_finish 的现状（语义保留，另行评估）

## 9. 风险

| 风险 | 缓解 |
|---|---|
| facet 表化引入行为漂移（生产事件链路 bug 都是静默的） | oracle 对照测试（旧函数 vs 表，fixture 语料全量比对）；pi 侧存量断言零修改 |
| 映射表执行性能（每事件查表） | 规则按 type 索引预编译 Map；条件求值是纯数据访问，量级远小于现有 BM25 |
| 插件作者仍要理解 canonical 词汇表 | 词汇表文档化进 loader README + dry-event 试衣间 + 字段契约 warn 可定位 |
| eventSource 信封与 pi 实际形状不符（pi 事件经 PiEventStream 已解析 sessionID） | pi 迁移时 sessionIdPath 省略（出口已解析）；eventSource 仅服务新插件的原始流 |
