/**
 * View DTO 编译期钉扎（不涉及运行时；由 `tsc --noEmit`/build 检查）。
 *
 * 目的：`contract/view-dto.json` 是生成的，但字段清单本身是手写数据。本文件
 * 把清单与**接口**绑死：
 *  - `Covers<T, Fields>` 要求清单里每个字段名都真实存在于对应接口；
 *  - 正例字面量证明 Review Focus 字段（toolClass/canonicalTool/stopReason/
 *    model/state/summary/error）在类型层面可用；
 *  - 反例 `@ts-expect-error` 证明 `native` 不是合法 View DTO 字段。
 *
 * 任一 DTO 删字段 / 改名 / 重新引入 `native`，这里都会编译失败。
 */
import {
  VIEW_DTO_FIELD_INVENTORY,
  type MafwAgent,
  type MafwBackgroundJob,
  type MafwCheckpoint,
  type MafwDiff,
  type MafwMessage,
  type MafwModel,
  type MafwPart,
  type MafwPartBase,
  type MafwPermissionRequest,
  type MafwProvider,
  type MafwQuestionRequest,
  type MafwSession,
} from './view-dto'

/** 清单字段全部是接口字段时得到 true；否则 never（把 true 赋给 never 即报错）。 */
type Covers<T, Fields extends readonly string[]> =
  [Fields[number]] extends [keyof T] ? true : never

/** 部件公共字段（身份主干 + 判别字段）。 */
type PartCommon = MafwPartBase & { type: string }

// ── 清单 ↔ 接口：每个 DTO 的必填/全量字段都必须真实存在 ──
const _messageFields: Covers<MafwMessage, typeof VIEW_DTO_FIELD_INVENTORY.message.fields> = true
const _partFields: Covers<PartCommon, typeof VIEW_DTO_FIELD_INVENTORY.part.fields> = true
const _textVariant: Covers<
  Extract<MafwPart, { type: 'text' }>,
  typeof VIEW_DTO_FIELD_INVENTORY.part.variants.text
> = true
const _reasoningVariant: Covers<
  Extract<MafwPart, { type: 'reasoning' }>,
  typeof VIEW_DTO_FIELD_INVENTORY.part.variants.reasoning
> = true
const _toolVariant: Covers<
  Extract<MafwPart, { type: 'tool' }>,
  typeof VIEW_DTO_FIELD_INVENTORY.part.variants.tool
> = true
const _fileVariant: Covers<
  Extract<MafwPart, { type: 'file' }>,
  typeof VIEW_DTO_FIELD_INVENTORY.part.variants.file
> = true
const _stepStartVariant: Covers<
  Extract<MafwPart, { type: 'step-start' }>,
  typeof VIEW_DTO_FIELD_INVENTORY.part.variants['step-start']
> = true
const _stepFinishVariant: Covers<
  Extract<MafwPart, { type: 'step-finish' }>,
  typeof VIEW_DTO_FIELD_INVENTORY.part.variants['step-finish']
> = true
const _compactionVariant: Covers<
  Extract<MafwPart, { type: 'compaction' }>,
  typeof VIEW_DTO_FIELD_INVENTORY.part.variants.compaction
> = true
const _agentPartVariant: Covers<
  Extract<MafwPart, { type: 'agent' }>,
  typeof VIEW_DTO_FIELD_INVENTORY.part.variants.agent
> = true
const _dataVariant: Covers<
  Extract<MafwPart, { type: `data-${string}` }>,
  typeof VIEW_DTO_FIELD_INVENTORY.part.variants['data-*']
> = true
const _modelFields: Covers<MafwModel, typeof VIEW_DTO_FIELD_INVENTORY.model.fields> = true
const _sessionFields: Covers<MafwSession, typeof VIEW_DTO_FIELD_INVENTORY.session.fields> = true
const _checkpointFields: Covers<MafwCheckpoint, typeof VIEW_DTO_FIELD_INVENTORY.checkpoint.fields> = true
const _diffFields: Covers<MafwDiff, typeof VIEW_DTO_FIELD_INVENTORY.diff.fields> = true
const _providerFields: Covers<MafwProvider, typeof VIEW_DTO_FIELD_INVENTORY.provider.fields> = true
const _agentFields: Covers<MafwAgent, typeof VIEW_DTO_FIELD_INVENTORY.agent.fields> = true
const _permissionFields: Covers<
  MafwPermissionRequest,
  typeof VIEW_DTO_FIELD_INVENTORY.permission.fields
> = true
const _questionFields: Covers<
  MafwQuestionRequest,
  typeof VIEW_DTO_FIELD_INVENTORY.question.fields
> = true
const _backgroundFields: Covers<
  MafwBackgroundJob,
  typeof VIEW_DTO_FIELD_INVENTORY.background.fields
> = true

// ── 正例：Review Focus 字段在类型层面真实可用（字段消失即编译失败） ──
const _toolPart: MafwPart = {
  id: 'part_1',
  sessionID: 'ses_1',
  messageID: 'msg_1',
  type: 'tool',
  callID: 'call_1',
  tool: 'shell',
  toolClass: 'shell',
  canonicalTool: 'bash',
  state: {
    status: 'completed',
    input: { command: 'pwd' },
    output: '/tmp',
    time: { start: 1, end: 2 },
  },
}

const _assistantMessage: MafwMessage = {
  id: 'msg_1',
  sessionID: 'ses_1',
  role: 'assistant',
  model: { providerID: 'pi', modelID: 'm1' },
  agent: 'build',
  stopReason: 'cancelled',
  // 回合快照树（per-turn diff 依据）：只有树 id 进 DTO，仓库位置留在 adapter。
  snapshot: { start: 'a'.repeat(40), end: 'b'.repeat(40), files: [{ file: 'a.ts' }] },
  summary: {
    title: 'title',
    diffs: [{ file: 'a.ts', additions: 1, deletions: 0, status: 'modified' }],
  },
  error: { kind: 'abort', message: 'cancelled by user' },
  content: [_toolPart],
}

const _checkpoint: MafwCheckpoint = {
  id: 'ck_1',
  sessionID: 'ses_1',
  anchorMessageID: 'msg_1',
  kind: 'auto',
  createdAt: '2026-11-02T00:00:00.000Z',
  filesAvailable: false,
}

// ── 反例：`native` 不是 View DTO 字段（opaque 走 extensions） ──
// @ts-expect-error `native` 已被禁止；受控扩展只能走 extensions
const _noNative: MafwPart = { id: 'p1', type: 'text', text: 'x', native: { opaque: true } }
