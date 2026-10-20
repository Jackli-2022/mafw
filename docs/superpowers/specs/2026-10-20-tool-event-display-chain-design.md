# 工具事件显示链补全设计 spec

日期：2026-10-20 · 状态：已批准待实施 · 前置调研：`docs/research/2026-10-20-agent-platform-tool-events-survey.md`（commit cd5a0a7c；执行侧发射先例 + 两帧终态/防双发修正）· 前置契约：`docs/superpowers/specs/2026-10-15-runtime-tool-registration-contract-design.md`（v4.30 注册链，本 spec 补其显示链切片）

## 1. 目标与非目标

**目标**：
1. `POST /api/tools/execute` 执行时**自动合成两帧 tool part 事件**（running → completed/error）并经 `handleOpencodeEvent` 全管线广播（facets + `enrichToolClass` + trajectory 记账 + Mode A）——out-of-process runtime 的工具调用从隐形变为可见；
2. in-process 第三方 runtime 的 **opt-in 事件包装**：`wrapRegistrationsWithEvents(regs, sessionId, emit)` 把 factory 注册项包成自发事件的版本（前 running 后终态），emit 指向 runtime 自己的 `global.event()` 流；
3. conformance 新增 **`tool-visibility` 场景**：经同一注入点喂探针帧 → per-session tap 断言两帧 + toolClass enrich + 广播可见——"注册了但隐形"从隐性缺陷变激活期可测；
4. SKILL 4.8 补**显示链三路径**文档 + normalizeMessages 历史提醒。

**非目标**：进度帧（对标 MCP `notifications/progress` 的执行中增量——六件套多为秒级，YAGNI 留后续）；运行时去重/开关（防双发用通道约定）；pi/opencode 改造（已自发事件，不包装）；desktop/TUI 零改动（part.updated tool part 本就是渲染契约）。

## 2. 现状缺口

v4.30 打通执行链（spec+execute 单源推送），显示链三断点：① out-of-process（`/api/tools/execute`）完全不发事件；② in-process 无事件映射的第三方 runtime 工具调用隐形（pi/opencode 因内置适配有人写）；③ conformance 5 场景无工具可见性维度。

## 3. 决策记录

| 决策点 | 结论 | 备选（否决理由） |
|---|---|---|
| D1 发射时机 | **两帧终态制**：running（含 input）→ completed（output）/ error（error）；无 pending 帧 | 三帧含 pending（opencode ToolState 有 pending，但 HTTP 到达即执行，pending 无信息量）；进度帧（调研 §4 YAGNI） |
| D2 注入点 | 合成事件喂 `handleOpencodeEvent`（单入口：normalize→facets→enrich→trajectory→广播）——与 runtime 事件同权 | 直接 `mafwBroadcast`（绕过 enrich/trajectory，合成事件少 toolClass 且不进轨迹）；推进 runtime 事件流（out-of-process 无流可进） |
| D3 part.id | `toolpart_<randomUUID()>`，**两帧同 id**——desktop chat store 按 part.id upsert，同 id 演进为一卡 | 每帧独立 id（产生两张卡） |
| D4 防双发 | **通道约定**：execute 端点调用方 = 放弃自发 canonical 工具事件（SKILL 写死 + conformance 校验） | 请求级 `emit:false` 开关（YAGNI）；运行时去重（隐性 bug 温床，方案 C 否决依据） |
| D5 isError 映射 | execute `{text, isError:true}` → `state:{status:'error', input, error:text}`；否则 `state:{status:'completed', input, output:text}`——对齐 opencode ToolState 消费面 | isError 仍 completed（语义失真） |
| D6 发射失败 | emission try/catch fail-open——渲染增强不得破坏工具执行 | 传播异常（工具因显示失败而失败） |
| D7 404/400 | 未知工具/缺 name **不发帧**（无执行） | 先发 running 再 error（未执行的工具不该有卡片） |
| D8 共用核心 | `executeWithToolFrames(reg, params, sessionId, emit)` 单源——route 与 wrapper 共用 | 两处各写一遍（漂移） |

## 4. 设计

### 4.1 合成事件构造（gateway/src/runtime/mafw-tools.ts 增量）

```typescript
export interface ToolPartEventFrame {
  type: 'part.updated';
  properties: {
    sessionID: string;
    part: {
      id: string;                    // 'toolpart_<uuid>'
      type: 'tool';
      tool: string;
      state: { status: 'running' | 'completed' | 'error'; input: any; output?: string; error?: string };
    };
  };
}

export function buildToolPartEvent(args: {
  sessionID: string; partId: string; tool: string;
  status: 'running' | 'completed' | 'error'; input: any; output?: string; error?: string;
}): ToolPartEventFrame;

/** 单源执行核：emit running → execute → emit 终态（D5/D6/D7 语义集中于此） */
export async function executeWithToolFrames(
  reg: MafwToolRegistration, params: any, sessionId: string,
  emit: (evt: ToolPartEventFrame) => void,
): Promise<{ text: string; isError?: boolean }>;

/** opt-in 包装：无事件映射的 in-process runtime 用（emit 指向其 global.event() 流） */
export function wrapRegistrationsWithEvents(
  regs: MafwToolRegistration[], sessionId: string, emit: (evt: unknown) => void,
): MafwToolRegistration[];
```

- 扁平形状 B（SKILL 3.1 输入契约）——`normalizeOpencodeEvent` 直接接受；
- wrapper 与 route 均调 `executeWithToolFrames`（D8）。

### 4.2 /api/tools/execute 接线

- `ToolsExecuteDeps` 增 `emitEvent: (evt: unknown) => void`（必选，测试注 spy）；
- 找到注册项后 `executeWithToolFrames(reg, params, sessionID, deps.emitEvent)`；404/400 原样早退；
- index.ts 挂载处：`emitEvent: (evt) => this.handleOpencodeEvent(evt)`——合成事件与 runtime 事件同管线（D2）。

### 4.3 conformance `tool-visibility` 场景

- **确定性、零副作用**（不执行真工具、不耗 LLM）：经与 route 同一 `handleOpencodeEvent` 注入点喂探针帧对（`tool: 'mafw_conformance_probe'`，running→completed）；
- 断言：per-session tap 收到两帧 `part.updated`（tool part、同 part.id、状态序 running→completed）+ `part.toolClass` 已 enrich（探针名落 `other` 亦为 enrich 生效证据）+ 帧到达 Mode A 广播；
- 验证的边界：gateway 显示链管线（注入→normalize→facets→enrich→广播）；runtime 侧自发映射由其映射表 + 既有场景覆盖，注册链由激活期校验覆盖。

### 4.4 文档

- SKILL 4.8 增「显示链」小节——三路径：① runtime 自发（三原语 `tool.call`/`tool.result` 映射或 `part.updated` 直映——pi/opencode 现状）② gateway 合成 opt-in（`wrapRegistrationsWithEvents`，emit 接 `global.event()` 流）③ out-of-process（`/api/tools/execute` 自动合成；**调用方 = 放弃自发 canonical 工具事件**，D4）；附 normalizeMessages 历史提醒（不实现则历史工具块不渲染）；
- AGENTS.md §5.19 `/api/tools` 行补「执行自动合成两帧 tool part 经全管线广播」。

## 5. 实施清单（TDD）

1. `mafw-tools.ts`：`buildToolPartEvent` / `executeWithToolFrames` / `wrapRegistrationsWithEvents` + 测试（帧形状/两帧同 id/isError→error 态/emit 抛错不阻断/异常→error 帧/404 路径不涉及）；
2. `routes/tools.ts`：`emitEvent` dep + 接 `executeWithToolFrames` + 测试改（happy 两帧冒出/未知工具零帧/emit spy 断言）；
3. `index.ts`：挂载点接 `handleOpencodeEvent`（+AGENTS.md 行）；
4. `conformance-scenarios.ts`：`tool-visibility` 场景 + 评估器测试；
5. SKILL 4.8 显示链段 + 全量回归（gateway jest + build）。

## 6. 验收

- `POST /api/tools/execute` 执行六件套任一工具 → SSE 广播流出现同 part.id 的 running + 终态两帧，`part.toolClass` 已填，trajectory 有该工具调用记录；
- wrapRegistrationsWithEvents 包装后的注册项执行 → emit 流收到两帧（单测）；
- `POST /api/runtime/conformance {scenarios:["tool-visibility"]}` PASS（双帧 + enrich + 广播三断言）；
- 未知工具 404 → 零帧（无幻影卡片）；
- gateway 全量 jest 绿 + root build exit 0。

## 7. 风险与边界

- **双帧与历史快照竞态**：沿用 store upsert 幂等语义（part.id 键控），两帧为全量快照非增量（10-12 调研 §5 已立此约束）；
- **内部会话（worker）经 execute 路径**：六件套 worker 走插件直连 HTTP 不经 execute 端点，v1 无交集；若未来有交集，internal 过滤逻辑与 tool part 的交互留观察；
- **探针帧污染**：conformance 探针用独立 `sessionID`（conformance 会话命名空间）+ tool 名带 `mafw_conformance_probe` 前缀，trajectory 可辨识可清理；
- **abort**：HTTP 客户端中途断连不额外发 aborted 帧（六件套秒级为主；超时由 execute 内部超时兜底 → error 帧）。
