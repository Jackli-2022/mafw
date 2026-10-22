# 认知面六动词（Cognition Six Verbs — gate/rewrite）设计

- 日期：2026-10-22（v2：builder check 两问六修正已并入——内部会话豁免、prompt+ask 校验拒绝、pi mutation 语义、fail-closed 防护、redact 图片透传、ReDoS 护栏）
- 状态：v2（builder check 完成，裁决已并入）
- 上游：`docs/superpowers/specs/2026-10-22-contract-gap-research/06-gap-synthesis.md` Tier 1 #1（认知面 hooks 门控/改写——6/6 平台收敛，判定 PARTIAL/高价值）

## 1. 意图与为什么

MAFW 认知面（HostAdapter，宿主适配器→gateway 的 loopback 契约）现有**四动词**：observe / injectContext / injectSystem / tools。缺口研究 Tier 1 #1：业界（Claude 33 hooks、Codex 14、dsh pre-step 权威拒绝/替换、pi 扩展钩子）已收敛的**门控（gate）与改写（rewrite）**两类动词我们缺失——

- **gate**：工具调用/prompt 提交**执行前**的决策拦截（放行/拒绝/改写后放行/转人工）
- **rewrite**：工具输出**回模型前**的变换（脱敏等）

为什么值钱：今日 pi 的审批扩展已能 block（`{block:true, reason}`）但决策面只有"会话 allowlist + 三档政策"；**没有用户可声明的规则层**（"deny `rm -rf /`"、"docker 命令追加 `--rm`"）、**没有改写**（入参规范化、输出脱敏）。goal 编排的 plan/review 身份强化、命令卫生、秘密防泄漏都卡在这层。

侦察确认的关键杠杆：**pi 扩展 API 原生支持全部拦截点**（`tool_call` 可 block+reason+原地改 `input`；`tool_result` 可替换 `content`；`input` 可 transform/handled）——宿主侧零等待。

**与 Claude hooks 的刻意分歧**：Claude hooks 是 shell 脚本（任意代码执行）；MAFW 的 gate/rewrite 驱动面是**声明式规则**（config 数据，gateway 求值）——不引入子进程执行面，规则可审计、可热重载、跨宿主一致。

## 2. 目标

- G1 契约形式化：HostAdapter 四动词→**六动词**（+gate/rewrite），时序常量进 `COGNITION_CONTRACT`，host-adapter.ts 文档更新
- G2 规则引擎（纯）：`CognitionRule` 声明式规则 + `evaluateGate`/`applyRewrite` 纯函数（模板插值 `{{field}}`、正则 match、fail-open）
- G3 gateway 服务与 HTTP 动词：`CognitionGate` 服务（规则求值编排）+ `POST /api/cognition/gate` + `POST /api/cognition/rewrite`（out-of-process 宿主契约面；loopback 门）
- G4 pi 宿主全接线（唯一可消费宿主）：审批扩展加 gate 步（规则 → deny/rewrite/ask/放行，rewrite 后继续走既有权限链——**改写不能绕过政策**）；宿主扩展加 `tool_result` 改写钩（`action: redact` 复用既有 `redactSecrets`）+ `input` 门（prompt deny/transform）
- G5 配置面：`cognition.rules` 段（config 既有 watcher 热重载免费获得）+ `GET /api/cognition/rules`（桌面 Config 页消费留后续）
- G6 优先级铁律：**认知规则不可覆盖身份政策 deny**——编排顺序 = 身份/政策链保持最终权威，规则层的 "allow" 只是"继续下一检查"非终局

## 3. 非目标 / 反目标

- **非目标**：脚本式 hooks（shell/JS 回调——刻意分歧，见 §1）；opencode v1 插件改造（既定裁决：生产宿主刻意不重构，v2 迁移统一）；Stop 门（拒 Stop 强制续跑——pi 无对应事件，YAGNI）；conformance S5/S6 场景（留规则引擎稳定后）；规则 CRUD HTTP 面（config 文件编辑 + 热重载已够，桌面 UI 留后续）
- **反目标**：fail-closed（gateway 卡顿时 brick agent——gate 超时/异常一律 fail-open 放行 + 一次性 warn，与既有认知面动词同哲学）；规则层 allow 越过身份政策（§2 G6）；求值引入 await（规则引擎纯同步——热路径）

## 4. 约束

- C1 gate 在 agent 循环热路径：pi 走**进程内注入**（同 `evaluatePermission` 先例，~µs）；HTTP 动词预算 `gateTimeoutMs: 2_000`（宿主侧裁剪，gateway 不阻塞）
- C2 规则是**数据非代码**：`match` 正则 + `input`/`text`/`content` 模板（`{{field}}` 插值）——无函数、无子进程
- C3 pi 拦截点三处全同步可用（侦察确认）：`tool_call`（block+reason+原地改 input）/ `tool_result`（content 替换）/ `input`（transform/handled）
- C4 既有审批链零破坏：gate 步插入审批扩展的 autoDeny 之后、evaluatePermission 之前；rewrite 后的 input 交既有链复评
- C5 测试基线：gateway 344 套件 / 2411 + SDK 140 + TUI 220 + desktop 1174 + adapter 24

## 5. 设计

### 5.1 契约（host-adapter.ts）

```
六动词（gate/rewrite 新增）：
  gate          拦截点同步问询 → POST /api/cognition/gate
                { sessionID, kind: 'tool_call'|'prompt', tool?, input?, text? }
                → { decision: 'allow'|'deny'|'rewrite'|'ask', reason?, input?, terminate? }
                2s fail-open allow（gateway 慢/挂不 brick agent）
  rewrite       工具输出回模型前 → POST /api/cognition/rewrite
                { sessionID, tool, input, output: { content, isError } }
                → { content?, isError? }（fail-open 原样透传）
```

`COGNITION_CONTRACT` 增 `gateTimeoutMs: 2_000`、`rewriteTimeoutMs: 2_000`。

### 5.2 规则引擎（新模块 `gateway/src/core/cognition/rules.ts`）

```typescript
export interface CognitionRule {
  on: 'tool_call' | 'prompt' | 'tool_result';
  tool?: string;                    // 工具名（缺省 = 全部工具）
  match?: string;                   // 正则（source）：tool_call/prompt 测主文本，tool_result 测输出文本
  action: 'deny' | 'ask' | 'rewrite' | 'transform' | 'redact';
  reason?: string;                  // deny/ask 的展示理由
  input?: Record<string, string>;   // rewrite：字段模板（{{command}} 插值原值）
  text?: string;                    // prompt transform 模板（{{text}} 插值）
  name?: string;                    // 规则名（日志/可观测）
}

// 纯函数（全部同步、无 IO）：
export function validateRules(rules: unknown): { valid: CognitionRule[]; errors: string[] };  // 见下
export function ruleMatches(rule, payload): boolean;                       // on/tool/match 三级过滤
export function interpolateTemplate(tpl: string, original: Record<string, unknown>): string;
export function evaluateGateRules(rules, payload): GateDecision | null;    // 首条命中；null=无命中
export function applyRedact(content: Array<TextContent | ImageContent>, redact: (s: string) => string): Array<TextContent | ImageContent>;
//   ⚠️ 签名含 ImageContent（builder check E）：非文本部件原样透传——mafw_python 的 matplotlib
//   图表与 media 结果走 ImageContent，text-only 实现会静默丢图
```

**加载期校验（v2 Q2 裁决）**：`on:'prompt'` + `action:'ask'` 组合**无效**（pi 无 prompt 人工通道；运行时猜测要么 brick 要么静默解除武装）——validateRules 拒绝该条 + error 日志 + 跳过（fail-open 有声）。HTTP 契约的 decision 枚举保留 `ask` 但文档注明 v1 仅 `tool_call` 类可产出。

**ReDoS 护栏（builder check F）**：坏正则分两类——编译 throw 在 validateRules 捕获（跳过 + error）；**合法但灾难性**的正则在同步热路径无超时可言——护栏 = ①加载期编译测试 + 长度帽（match 测试文本截 10KB 再测）②文档声明规则责任面（用户手写正则的自担风险，与审批危险正则同待遇）。

`match` 的主文本：`tool_call` → `commandTextOf` 既有候选链（command/cmd/script/text——复用审批分类学的同一提取器）；`prompt` → text；`tool_result` → content 拼接文本。

### 5.3 CognitionGate 服务 + 编排（index.ts 注入，pi 进程内）

```
pi 审批扩展（pi-approval-extension.ts）插入 gate 步（C4 顺序）：
  1. 会话 allowlist（现状）
  2. 显式 autoDeny（现状）
  2.5 【新】evaluateGate(gatewaySessionId, { kind:'tool_call', tool, input })：
       deny   → return { block: true, reason }（终局拒绝，agent 看到 reason）
       rewrite → Object.assign(event.input, 规则模板插值结果)（逐键 mutation——
                 ⚠️ builder check A：pi agent-loop 执行 prepared.args 本地引用，
                 event.input 整体重赋值会静默丢失；逐键赋值才生效）→ 继续走 3（复评）
       ask    → 跳到 4（human 流）
       allow/null → 继续走 3
       ⚠️ builder check B：pi 的 tool_call handler 异常 = fail-CLOSED（agent-loop
       catch 后 block）——gate 步自身必须 try/catch 包裹（异常 → 放行 + warn，
       与 evaluatePermission 步同防护）
  3. evaluatePermission（现状：身份政策 + 三档 + 规则库）
  4. human（permission.asked + bridge，现状）
```

**pi rewrite 语义边界（诚实记录，builder check A 附带发现）**：改写只影响**执行参数**——LLM 看到的仍是原始 args（transcript 记录的是 structuredClone 原值）且改写后**无 schema 复验**（pi types.d.ts 明示）。文档化：rewrite 是"执行侧规范化"，不是"上下文侧改写"。

**G6 铁律的保证**：gate 层的 allow 非终局（链继续）；rewrite 后复评；deny 只会更严。用户规则无法把 manager 的 file-edit deny 翻成 allow。

pi 宿主扩展（pi-mafw-host-extension.ts）新增两钩：

```
pi.on('tool_result') 既有 observe 消费点扩展：先经 CognitionGate.applyRewrite
  （action:'redact' 规则命中 → redactSecrets 变换 text 部件、非文本部件透传 →
   替换 event.content 原地）→ 再 observe
pi.on('input')（新注册）：
  ⚠️ v2 Q1 裁决——内部会话豁免：注入 isInternalSession(sessionID) 谓词
  （gateway 的 internalSessionRoles 注册表：manager/worker/btw/goal 节点会话全部在册），
  在册 → { action:'continue' }（用户规则不得拦编排/通知 prompt——否则 no-prod-deploy
  类规则会静默杀掉 goal execute 节点，watchdog 重试 → archive_fail）。
  builder check C 佐证：所有内部 prompt 都走 pi prompt() 且无 source 标记，
  注册表是唯一可靠边界。
  不在册 → evaluateGate(kind:'prompt')：
    deny     → { action:'handled' }（pi 语义：吞掉——builder check C：handled
               返回于持久化前，消息根本不进 transcript）+ cognition_gate 事件
               （用户输入"消失"必须有 UI 可见性）
    transform → { action:'transform', text: 模板插值 }
    allow/null → { action:'continue' }
  （input handler 异常由 pi runner 捕获——天然 fail-open，无需自包 try/catch）
```

HTTP 动词的同等豁免：`POST /api/cognition/gate` handler 在 gateway 内运行——直接查 internalSessionRoles 注册表，内部会话 kind:prompt 恒返 allow（宿主无需传 origin 字段）。

### 5.4 HTTP 动词与配置

- 路由：`POST /api/cognition/gate` / `POST /api/cognition/rewrite`（loopback 门 + route-catalog 登记 + 契约重生成）；`GET /api/cognition/rules`（只读清单）
- config 段：
  ```yaml
  cognition:
    rules:
      - name: no-root-wipe
        on: tool_call
        tool: bash
        match: 'rm\s+-rf\s+/(?:\s|$)'
        action: deny
        reason: 'destructive root wipe blocked by cognition rule'
      - name: docker-rm
        on: tool_call
        tool: bash
        match: '^docker run'
        action: rewrite
        input: { command: '{{command}} --rm' }
      - name: redact-tool-output
        on: tool_result
        tool: bash
        action: redact
      - name: no-prod-deploy
        on: prompt
        match: '(?i)deploy.*prod'
        action: deny
        reason: 'prod deploy needs a goal'
  ```
- 热重载：**builder check 修正 4**——config `reload()` 自动 diff 全部顶层段（仅 server/paths 是 restartRequired），cognition 段**免费热应用**；服务侧**每次求值现读 `config.cognition`**（不快照——快照会吃掉热重载）；defaults() 加 cognition 空段（env 覆盖 `MAFW_COGNITION_*` 需要 key 存在）
- 环境变量：`MAFW_COGNITION_*`（applyEnvOverrides 走 defaults 存在的 key）

### 5.5 可观测性

- gate deny/rewrite 命中：`log.info('[Cognition] rule <name> <action> on <tool|prompt> session=<sid>')` + broadcast 扁平事件 `cognition_gate` `{ sessionID, rule, action, tool?, reason? }`（desktop/TUI 可见被拦了什么——**新扁平事件**，走 broadcast 骑 event_log 持久化；不进 canonical MAFW 词表）
- desktop 消费（builder check D 修正）：`cognition_gate` **不进** `IGNORED_AT_SHELL`（那会触发 SDK union 五处同步——IGNORED 有 `⊆ SDK union` 钉扎测试）；改加 `TAIL_ACCOUNTED_PREFIXES` 一行 `cognition:` 前缀（`runtime_switched` 类扁平事件同款消费路径，零词表改动）
- HTTP 动词 403 非 loopback（与 /api/tools 同门）

## 6. 测试策略（TDD）

1. 规则引擎纯函数：match 三级过滤（on/tool/正则）、模板插值（原值替换/缺字段留空）、首条命中、redact content 变换、坏正则 fail-open 不命中
2. CognitionGate 编排：注入 fake evaluatePermission 验证顺序铁律（规则 deny 在政策前、规则 allow 不越过政策 deny、rewrite 后复评）
3. pi 审批扩展 gate 步：deny 返回 block、rewrite 原地改 input 且继续链、ask 跳 human、无命中走原路（既有测试不破）
4. pi 宿主扩展：tool_result redact 替换 content 后 observe 收到脱敏文本、input deny → handled、transform 插值
5. HTTP 动词：gate/rewrite 请求-响应形状 + loopback 403 + rules 清单
6. 热重载：cognition 段变更 → 规则生效（config reload 测试既有模式）
7. 四套全量回归（C5 基线）

## 7. 我做的裁决（builder check 重点核对）

1. **声明式规则而非脚本**（§1）：与 Claude hooks 刻意分歧——无任意代码执行面，规则可审计。代价：表达力上限低于脚本（无条件逻辑）——复杂场景留给 goal 编排/审批政策。
2. **gate 层插在 autoDeny 之后、evaluatePermission 之前**（C4）：规则比会话 allowlist 弱（allowlist 是用户显式 'always' 决定）但比政策链先（规则是用户最近意图）；allow 非终局保 G6 铁律。
3. **rewrite 后复评**：改写产物交既有权限链——规范化命令不能绕过危险正则/身份政策。
4. **pi 进程内注入而非 HTTP 自调**（C1）：同 evaluatePermission 先例——热路径 ~µs vs loopback RTT；HTTP 动词留给 out-of-process 宿主（契约面完整性）。
5. **prompt deny 用 handled 而非 transform 空串**：pi 语义 handled=吞掉（agent 不见）；空串 transform 会浪费一个回合。补 cognition_gate 事件让 UI 可见（用户输入"消失"不能无感知）。
6. **tool_result 只做 redact 不做模板**：输出模板改写边际价值低（脱敏是刚需且有现成 redactSecrets）；YAGNI。
7. **cognition_gate 扁平事件不进 MAFW 词表**：网关合成通知类走扁平自定义（desktop TAIL_ACCOUNTED_PREFIXES `cognition:` 前缀消费，builder check D 裁定的低成本路径）——避免为可观测性开词汇守卫链五处同步的成本。
8. **（v2 Q1）prompt gate 内部会话豁免**：internalSessionRoles 注册表（manager/worker/btw/goal 节点全在册）是内部/用户 prompt 的唯一可靠边界（builder check 证实 pi 事件层无 source 可辨）；豁免在 gateway 服务层实现（HTTP 动词同查）——用户规则误杀编排 prompt（watchdog 重试 → archive_fail）是反目标级风险。
9. **（v2 Q2）prompt+ask 组合加载期拒绝**：pi 无 prompt 人工通道，运行时二选一（treat-as-deny brick / no-match 静默解除武装）都是错——校验拒绝 + 有声跳过是最诚实的响应；HTTP 枚举保留 ask 但文档注明 v1 仅 tool_call 产出。
10. **（v2 A）rewrite 逐键 mutation + 语义边界文档化**：pi 只认 `Object.assign(event.input, ...)`；改写只影响执行参数（LLM 见原始 args、无 schema 复验）——执行侧规范化，非上下文侧改写。
11. **（v2 B/F）两层防护**：gate 步自包 try/catch（pi tool_call 异常 = fail-CLOSED，与我方 fail-open 哲学相反）；正则加载期编译测试 + 10KB match 文本帽（同步热路径无超时，诚实声明责任面）。

## 8. 留给 builder 的

- pi 审批扩展的 evaluateGate 注入点（createMafwApprovalExtension 第 6 参？——与 evaluatePermission 同列）与 index.ts 的注入处（wirePiPermissionEvaluator 三处赋值点跟随）
- pi 宿主扩展的 isInternalSession 注入形态（第参 vs opts——对照 evaluatePermission 先例）；internalSessionRoles 的读取接口（Map 直读 vs 提取谓词注入 pi-runtime）
- interpolateTemplate 的实现（简单 replace 全部 `{{field}}`；缺字段替换为空串 + warn 一次）
- cognition_gate 事件的 desktop TAIL_ACCOUNTED_PREFIXES 具体落点（session-events.ts 的前缀集合名）
