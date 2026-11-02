// gateway/src/core/goal/direction-decision.ts
// Goal 方向决策的纯类型与序列化层。
//
// 语义约束（spec §5.1）：
// - 用户可以用自然语言裁定，不强迫从固定选项里选；
// - 决策 append-only：旧决定永不改写、永不删除，只能追加新决定；
// - 用户原话逐字保留（只做「是否存在」判定，不做 trim/改写）；
// - 语义是否一致由人把关，代码不假装理解自然语言。

/** 当前 `direction_json` / `direction.json` 的 schema 版本。 */
export const DIRECTION_STATE_VERSION = 1;

export interface DirectionOption {
  id: string;
  title: string;
  summary: string | null;
  risks: string[];
}

export interface DirectionOptionInput {
  id: string;
  title: string;
  summary?: string | null;
  risks?: readonly string[] | null;
}

export type DirectionDecisionStatus = 'none' | 'pending' | 'decided';

export interface DirectionDecision {
  /** 稳定 id：缺省时由内容哈希派生，重放同一条决策不会重复追加。 */
  id: string;
  optionId: string | null;
  /** 用户原话，逐字保留（含空白与换行）。 */
  userWords: string;
  reason: string | null;
  /** user / lead / tech_lead_clear / migration …（保持开放，便于后续来源）。 */
  source: string;
  revision: number | null;
  decidedAt: string;
  /** 决策时用户看到的候选（快照，后续 options 变化不会改写历史）。 */
  options: DirectionOption[];
}

export interface DirectionDecisionInput {
  id?: string | null;
  optionId?: string | null;
  userWords?: string | null;
  reason?: string | null;
  source?: string | null;
  revision?: number | null;
  decidedAt?: string | null;
  options?: readonly DirectionOptionInput[] | readonly DirectionOption[] | null;
}

/** 一次「需要用户裁定」的请求（只有存在真实分歧时才产生）。 */
export interface DirectionReviewRequest {
  id: string;
  options: DirectionOption[];
  reason: string | null;
  requestedAt: string;
  requestedBy: string | null;
  revision: number | null;
}

/** 单个 revision 的方向状态（revision `direction_json` 的镜像）。 */
export interface DirectionState {
  version: number;
  goalId: string;
  revision: number;
  status: DirectionDecisionStatus;
  options: DirectionOption[];
  requests: DirectionReviewRequest[];
  decisions: DirectionDecision[];
  updatedAt: string | null;
}

/** Goal 级方向产物（`<mafwDir>/goals/<goalId>/direction.json`）。 */
export interface DirectionArtifact {
  version: number;
  goalId: string;
  revisions: Record<string, DirectionState>;
}

function clean(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function stringOrNull(value: unknown): string | null {
  const text = clean(value);
  return text ? text : null;
}

function normalizeRevision(value: unknown): number | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 1) {
    throw new Error(`invalid direction decision revision: ${String(value)}`);
  }
  return value;
}

export function normalizeDirectionOption(input: DirectionOptionInput): DirectionOption {
  const id = clean(input?.id);
  if (!id) throw new Error('direction option id is required');
  const title = clean(input?.title);
  if (!title) throw new Error('direction option title is required');
  const risks: string[] = [];
  const seen = new Set<string>();
  for (const raw of input?.risks ?? []) {
    const risk = clean(raw);
    if (!risk || seen.has(risk)) continue;
    seen.add(risk);
    risks.push(risk);
  }
  return { id, title, summary: stringOrNull(input?.summary), risks };
}

export function normalizeDirectionOptions(
  inputs: readonly DirectionOptionInput[] | readonly DirectionOption[] | null | undefined,
): DirectionOption[] {
  const options: DirectionOption[] = [];
  const seen = new Set<string>();
  for (const input of inputs ?? []) {
    const option = normalizeDirectionOption(input as DirectionOptionInput);
    if (seen.has(option.id)) throw new Error(`duplicate direction option id: ${option.id}`);
    seen.add(option.id);
    options.push(option);
  }
  return options;
}

/** djb2：与仓库其它稳定标记同族，够用且无依赖。 */
function hashText(text: string): string {
  let hash = 5381;
  for (let index = 0; index < text.length; index += 1) {
    hash = ((hash << 5) + hash) ^ text.charCodeAt(index);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

function decisionId(parts: Array<string | null | number>): string {
  return `dirdec_${hashText(parts.map((part) => String(part ?? '')).join('|'))}`;
}

/**
 * 规范化一条方向决策。
 * - `userWords` 原样保留（空白/换行都不动）；
 * - 至少要有用户原话或选中方向；
 * - 传入候选时，`optionId` 必须真实存在（防止幻觉选项进入权威记录）。
 */
export function normalizeDirectionDecision(input: DirectionDecisionInput): DirectionDecision {
  const userWords = typeof input?.userWords === 'string' ? input.userWords : '';
  const optionId = stringOrNull(input?.optionId);
  if (!optionId && !userWords.trim()) {
    throw new Error('direction decision requires user words or an option');
  }
  const options = normalizeDirectionOptions(input?.options);
  if (optionId && options.length > 0 && !options.some((option) => option.id === optionId)) {
    throw new Error(`unknown direction option: ${optionId}`);
  }
  const revision = normalizeRevision(input?.revision);
  const decidedAt = clean(input?.decidedAt);
  const source = clean(input?.source) || 'user';
  const id = clean(input?.id)
    || decisionId([revision, optionId, userWords, decidedAt, source]);
  return {
    id,
    optionId,
    userWords,
    reason: stringOrNull(input?.reason),
    source,
    revision,
    decidedAt,
    options,
  };
}

export function emptyDirectionState(goalId: string, revision: number): DirectionState {
  return {
    version: DIRECTION_STATE_VERSION,
    goalId,
    revision,
    status: 'none',
    options: [],
    requests: [],
    decisions: [],
    updatedAt: null,
  };
}

function coerceStatus(value: unknown, decisions: DirectionDecision[], requests: DirectionReviewRequest[]): DirectionDecisionStatus {
  if (value === 'none' || value === 'pending' || value === 'decided') return value;
  if (decisions.length > 0) return 'decided';
  if (requests.length > 0) return 'pending';
  return 'none';
}

function coerceDecision(raw: any): DirectionDecision | null {
  if (!raw || typeof raw !== 'object') return null;
  const userWords = typeof raw.userWords === 'string' ? raw.userWords : '';
  const optionId = stringOrNull(raw.optionId);
  if (!optionId && !userWords.trim()) return null;
  const decidedAt = clean(raw.decidedAt);
  const source = clean(raw.source) || 'unknown';
  const revision = typeof raw.revision === 'number' && Number.isInteger(raw.revision) && raw.revision >= 1
    ? raw.revision
    : null;
  const options = normalizeDirectionOptions(raw.options);
  const id = clean(raw.id) || decisionId([revision, optionId, userWords, decidedAt, source]);
  return {
    id,
    optionId,
    userWords,
    reason: stringOrNull(raw.reason),
    source,
    revision,
    decidedAt,
    options,
  };
}

function coerceRequest(raw: any, revision: number): DirectionReviewRequest | null {
  if (!raw || typeof raw !== 'object') return null;
  const options = normalizeDirectionOptions(raw.options);
  return {
    id: clean(raw.id) || `dirreq_${hashText(`${revision}|${clean(raw.requestedAt)}|${options.map((o) => o.id).join(',')}`)}`,
    options,
    reason: stringOrNull(raw.reason),
    requestedAt: clean(raw.requestedAt),
    requestedBy: stringOrNull(raw.requestedBy),
    revision: typeof raw.revision === 'number' && Number.isInteger(raw.revision) && raw.revision >= 1
      ? raw.revision
      : revision,
  };
}

function coerceState(raw: any, goalId: string, revision: number): DirectionState {
  const decisions = Array.isArray(raw?.decisions)
    ? raw.decisions.map(coerceDecision).filter((item: DirectionDecision | null): item is DirectionDecision => !!item)
    : [];
  const requests = Array.isArray(raw?.requests)
    ? raw.requests.map((item: any) => coerceRequest(item, revision)).filter((item: DirectionReviewRequest | null): item is DirectionReviewRequest => !!item)
    : [];
  const options = normalizeDirectionOptions(raw?.options);
  return {
    version: DIRECTION_STATE_VERSION,
    goalId: clean(raw?.goalId) || goalId,
    revision: typeof raw?.revision === 'number' && Number.isInteger(raw.revision) && raw.revision >= 1
      ? raw.revision
      : revision,
    status: coerceStatus(raw?.status, decisions, requests),
    options: options.length > 0 ? options : requests[requests.length - 1]?.options ?? [],
    requests,
    decisions,
    updatedAt: stringOrNull(raw?.updatedAt),
  };
}

/** 容错解析 revision 的 `direction_json`；坏 JSON/坏形状一律回退空状态（读侧 fail-open）。 */
export function parseDirectionState(
  json: string | null | undefined,
  goalId: string,
  revision: number,
): DirectionState {
  if (!json) return emptyDirectionState(goalId, revision);
  try {
    return coerceState(JSON.parse(json), goalId, revision);
  } catch {
    return emptyDirectionState(goalId, revision);
  }
}

/** 稳定的 revision-key 排序（写入文件时不让对象键顺序漂移）。 */
function sortedRevisionKeys(revisions: Record<string, DirectionState>): string[] {
  return Object.keys(revisions).sort((a, b) => {
    const left = Number(a);
    const right = Number(b);
    if (Number.isFinite(left) && Number.isFinite(right)) return left - right;
    return a.localeCompare(b);
  });
}

export function serializeDirectionState(state: DirectionState): string {
  return JSON.stringify({
    version: state.version,
    goalId: state.goalId,
    revision: state.revision,
    status: state.status,
    options: state.options,
    requests: state.requests,
    decisions: state.decisions,
    updatedAt: state.updatedAt,
  }, null, 2);
}

export function serializeDirectionArtifact(artifact: DirectionArtifact): string {
  const revisions: Record<string, DirectionState> = {};
  for (const key of sortedRevisionKeys(artifact.revisions ?? {})) {
    const state = artifact.revisions[key];
    revisions[key] = {
      version: state.version,
      goalId: state.goalId,
      revision: state.revision,
      status: state.status,
      options: state.options,
      requests: state.requests,
      decisions: state.decisions,
      updatedAt: state.updatedAt,
    };
  }
  return JSON.stringify({
    version: artifact.version,
    goalId: artifact.goalId,
    revisions,
  }, null, 2);
}

/** 容错解析 Goal 级方向产物；坏 JSON 回退空 artifact（服务层对坏文件另有硬失败）。 */
export function parseDirectionArtifact(json: string | null | undefined): DirectionArtifact {
  if (!json) return { version: DIRECTION_STATE_VERSION, goalId: '', revisions: {} };
  let raw: any;
  try {
    raw = JSON.parse(json);
  } catch {
    return { version: DIRECTION_STATE_VERSION, goalId: '', revisions: {} };
  }
  const goalId = clean(raw?.goalId);
  const revisions: Record<string, DirectionState> = {};
  const source = raw?.revisions && typeof raw.revisions === 'object' ? raw.revisions : {};
  for (const key of Object.keys(source)) {
    const revision = Number(key);
    if (!Number.isInteger(revision) || revision < 1) continue;
    revisions[key] = coerceState(source[key], goalId, revision);
  }
  return {
    version: DIRECTION_STATE_VERSION,
    goalId,
    revisions,
  };
}

function quoteUserWords(words: string): string {
  return words.split(/\r?\n/).map((line) => `> ${line}`).join('\n');
}

/**
 * 渲染方向决定块（确定性：同一输入永远同一字符串）。
 * 用户原话逐字出现，供 Plan/GoalEval 作为权威输入。
 */
export function renderDirectionBlock(decisions: readonly DirectionDecision[]): string {
  if (!decisions || decisions.length === 0) return '';
  const lines: string[] = [
    '[DIRECTION DECISIONS]',
    'Append-only record of user direction. User words are authoritative and preserved verbatim.',
  ];
  decisions.forEach((decision, index) => {
    const option = decision.optionId
      ? decision.options.find((item) => item.id === decision.optionId)
      : null;
    const heading = decision.optionId
      ? (option ? `## ${index + 1}. option ${decision.optionId} — ${option.title}` : `## ${index + 1}. option ${decision.optionId}`)
      : `## ${index + 1}. (no option id)`;
    lines.push(heading);
    if (decision.optionId) lines.push(`- option: ${decision.optionId}${option ? ` — ${option.title}` : ''}`);
    if (decision.revision != null) lines.push(`- revision: ${decision.revision}`);
    lines.push(`- source: ${decision.source}`);
    if (decision.decidedAt) lines.push(`- decided: ${decision.decidedAt}`);
    if (decision.reason) lines.push(`- reason: ${decision.reason}`);
    if (decision.userWords) {
      lines.push('- user words (verbatim):');
      lines.push(quoteUserWords(decision.userWords));
    }
  });
  return lines.join('\n');
}
