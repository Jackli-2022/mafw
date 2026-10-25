# Batch 2 — Elicitation 结构化表单（Design）

> 日期：2026-10-25 · 状态：已实施（Batch 2；commits `bbf6dfed` / `9a4147e3` / `bfaad174` / `142bca8b`）
> 上游：Batch 1 outputSchema。两者成对：一出一入；本批也是 durable task `input_required` 的前置。

## 1. 意图与为什么

opencode 2.1 的 `Form.*` 是完整的结构化交互协议（string/number/integer/boolean/multiselect/external + `when` 条件 + required/default/min/max/pattern），但 MAFW 目前只把它降级成“一问一选”的 AskCard：

- `formToQuestion` 丢掉字段类型、required/default/format/placeholder/min/max/pattern/when/url；
- 桌面 `questions.list()` 不带 directory，2.1 只返回默认 location 的 forms → **用户看不到自己会话里的表单**；
- `form.created` 事件已经广播，但 dispatcher 不处理 → 卡片要等 60s 轮询；
- `external` 字段回复被当成字符串 → 2.1 返回 400 `External form field must be acknowledged`；
- `when` 条件、数字/布尔输入、外部 URL 同意、metadata 过期时间都没有 UI。

Batch 2 把这些“表单协议 → 可交互 UI”补齐，并保留旧 question 通道。

## 2. 目标 / 非目标

**目标**

1. `formToQuestion` 保留完整字段元数据（type/required/default/format/placeholder/min/max/minLength/maxLength/pattern/when/url）并作为共享纯函数（adapter + event transform 同源）。
2. `formAnswerOf` 按类型回写：external → boolean（true=acknowledged），number/integer → number，multiselect → string[]，boolean → boolean；保留旧 question 的 `string[][]` 入口。
3. 桌面 `questions.list(directory?)` 按当前会话 directory 查询；`form.created/updated/replied/cancelled` 触发立即 reconcile（不再等 60s）。
4. AskCard 支持 typed fields：文本/数字/整数/布尔/多选/外部 URL；required/default/format/min/max/pattern 基础校验；`when` 条件显示；external 必须勾选“已打开并同意”；metadata 有 `expiresAt` 时显示倒计时并禁用过期提交。
5. 保留旧 question（无 fields）的现有单选/多选/自定义输入行为。
6. `question.v2.asked` 若带 form 载荷，走同一 `formToQuestion` 归一；否则原样透传。

**非目标**

- 不新增 canonical 事件类型；复用 `question.asked/replied/rejected` + 顶层 `form.*` 刷新信号。
- 不做服务端定时取消/超时任务；2.1 Form schema 没有 expiresAt，只在 metadata 出现时做 UI 过期。
- 不实现 MCP elicitation 的独立协议；2.1 把 MCP 表单落到 Form.*，本批即覆盖。
- 不做表单模板/历史表单管理。
- 不改 opencode。

## 3. 2.1 实证（2026-10-25）

- `POST /api/session/{sid}/form` 创建表单；响应 `{data: Form.Detail}`。
- `GET /api/form` 只按 **`x-opencode-directory` header** 过滤 location；`?directory=` query 不生效（只有 header 生效）。
- 表单创建广播顶层 `form.created`（payload 只有 seq，无字段）；桌面应借此立即 reconcile。
- `GET /api/form` 列表项是 `Form.Info`（无 state）；`GET /api/session/{sid}/form/{fid}` 返回 `Form.Detail`（含 `state`）。
- `external` 字段回复必须是 boolean true，否则 400 `External form field must be acknowledged`；`false` 表示拒绝。
- 字段类型：string/email|uri|date|date-time、number/integer(min/max)、boolean、multiselect(options/min/max/custom)、external(url)、`when`（key/op eq|neq/value）、required/default/hidden。

## 4. 设计

### 4.1 共享纯模块 `gateway/src/runtime/form-question.ts`

```ts
export interface FormQuestion {
  id: string; question: string; header?: string;
  type: 'string'|'number'|'integer'|'boolean'|'multiselect'|'external';
  multiple?: boolean; custom?: boolean; required?: boolean;
  options?: Array<{ label: string; value: string; description?: string }>;
  default?: unknown; format?: string; placeholder?: string;
  minimum?: number; maximum?: number; minLength?: number; maxLength?: number; pattern?: string;
  when?: Array<{ key: string; op: 'eq'|'neq'; value: string|number|boolean }>;
  url?: string;
}
export function formToQuestion(form: any): { ...; form: any; questions: FormQuestion[]; __fields: any[] }
export function formAnswerOf(form: any, answers: string[][]): Record<string, unknown>
```

- `formToQuestion` 的 `questions[].id = field.key`；boolean 额外生成 是/否 options（value 为 'true'/'false'），external 不生成 options，number/integer 不生成 options。
- `formAnswerOf`：
  - external：`/^(true|yes|on|1|accept|accepted|已打开|同意|是)$/i` → true，否则 false；
  - boolean：true/false regex；
  - number/integer：Number，非法 → 0（服务端仍会校验）；
  - multiselect：数组；
  - 其余：首值字符串。
- adapter `formToQuestion/formAnswerOf` 改为 import；event transform `question.v2.asked` 若 `data.form?.fields` 或 `data.fields` 存在则调用同一函数。

### 4.2 事件

- `question.v2.asked` 从映射表移入 transform（form 归一）。
- 顶层 `form.created/form.updated/form.replied/form.cancelled` 原样透传（不新增词汇）；桌面 dispatcher 顶层分支 `scheduleReconcile(0)`。
- 现有 `question.asked` 的完整 payload 增加 `form`（字段原始对象）、`mode: 'url'|'form'`（含 external → url）、`expiresAt`（`metadata.expiresAt` 或 `metadata.expires_at`，ISO/number）。

### 4.3 桌面

- SDK `questions.list(directory?: string)` → `/api/questions?directory=`；preload/main IPC 透传。
- `reconcileFlowCards` 用 active session 的 `store.session[].directory`（非 '.'）调用 list；无 active 时回退 `list()`。
- `dispatchShellEvent` 顶层：
  ```ts
  if (type === 'form.created' || type === 'form.updated' || type === 'form.replied' || type === 'form.cancelled') {
    deps.core.trace(event, 'card:form-refresh'); deps.flowCards.scheduleReconcile(0); return;
  }
  ```
- `mapAskCard` 保留 `form`、`mode`、`expiresAt`，questions 映射 typed 字段。
- AskCard：
  - `visibleQuestions()` 按 `when` 过滤；`isAnswered(q)` 按类型/required 判断；`submittable` 只看可见 required + external 同意。
  - string（无 options）→ custom 文本框（placeholder/format/pattern/minLength/maxLength 基础校验）；
  - number/integer → `<input type="number">`，min/max；
  - boolean → 是/否 options（沿用）；
  - multiselect → 多选 options（沿用）；
  - external → URL 展示 + “已打开并同意”勾选；未勾选不可提交；提交 `['true']`；
  - default 初始化；`when` 依赖值取当前答案；
  - `expiresAt` → 倒计时/过期态（`expired`），禁用提交；不自动取消。
- 旧 question 无 `type` 时保持现有 single/multi/custom 行为。

## 5. 失败模式 / 风险

- 列表仍为空：directory 未加载（store.session.directory='.'）→ 回退 `list()`；form.created 立即 reconcile 一次。
- external 未同意就提交：UI 禁用；即使绕过，gateway 发送 false，2.1 可能 400 → 卡片保留 pending 并显示错误。
- `when` 依赖字段未回答：条件不满足 → 隐藏；提交不包含隐藏字段。
- 表单在别的 location：当前只查 active session directory；跨项目后台表单由 60s 轮询/切换会话时补。
- 过期时间格式坏：忽略，不阻塞。
- `form.created` 无 sessionID：只触发 reconcile，不建卡；避免假卡。
- 旧 question event 无 fields：走旧映射，不受影响。

## 6. 验收

1. 在 `C:/work` 会话创建含 5 种字段的表单：卡片立即出现（<2s），显示文本/数字/布尔/多选/URL 控件。
2. 填写并提交：`POST /api/questions/:id/reply` 成功；2.1 Form.Detail state=answered，external 为 boolean true。
3. 不勾选 external 同意时提交按钮禁用；取消走 reject。
4. `when` 条件字段随依赖值显示/隐藏；隐藏字段不进 answer。
5. 旧 question（无 fields）仍正常。
6. 单元：formToQuestion/formAnswerOf（external boolean/类型/默认值）、mapAskCard typed、visibility/validation 纯函数、dispatcher form.created refresh；全量不回归。
