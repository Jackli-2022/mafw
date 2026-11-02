/**
 * MAFW View DTO 投影（Ingress 出口）：runtime 原生形状 → 中性 DTO。
 *
 * 业务核心/客户端只消费 `Mafw*` DTO；本模块是 `/api/sessions`、`/api/provider`、
 * `/api/agents`、permission / question 出口的单一投影点。
 *
 * 约定：
 *  - 规范字段（`status` / `reverted` / `models` / `kind` / `targets` …）是权威；
 *    过渡期内原生字段**原样保留**（诊断、trajectory、仍读原生的旧客户端不炸），
 *    但新客户端只读规范字段。
 *  - 归属推断不做猜测：`status` 只从原生时间戳/状态派生，`reverted` 只认
 *    `revert` / `reverted`，`model` 只认会话/消息上确实存在的模型引用。
 *  - 纯函数、无 IO（session 列表的 messages 不在此读取——按消息推导模型留给
 *    客户端 fallback，见 final-fix-report 的 residual）。
 */
import type {
  MafwAgent,
  MafwDiff,
  MafwModel,
  MafwModelRef,
  MafwPermissionRequest,
  MafwProvider,
  MafwQuestionInfo,
  MafwSession,
  MafwSessionRevert,
  MafwSessionStatus,
  MafwSuggestedRule,
} from './canonical-types';
import { canonicalToolOf } from './tool-classes';

type Rec = Record<string, any>;

function asRecord(value: unknown): Rec | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? (value as Rec) : null;
}

function asString(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function asNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function asStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : [];
}

const SESSION_STATUSES: ReadonlySet<string> = new Set(['idle', 'busy', 'retry', 'unknown']);

/**
 * 会话状态（规范字段）：`time.busy > time.idle` → busy；否则沿用原生 `status`
 * （字符串或 `{type}` 状态快照，例如 opencode 的 retry）；两者都没有时间信息 → unknown
 * （不猜 idle）。
 *
 * 原生 opencode 用 busy/idle 时间戳表达运行态；pi 无时间戳，只能拿到 unknown
 * （历史上靠 SSE 回合事件置位，这里不伪造）。
 */
export function canonicalSessionStatus(raw: unknown): MafwSessionStatus {
  const info = asRecord(raw);
  if (!info) return 'unknown';
  const busy = asNumber(info.time?.busy) ?? 0;
  const idle = asNumber(info.time?.idle) ?? 0;
  if (busy > idle) return 'busy';
  const declared = asRecord(info.status)?.type ?? info.status;
  const status = asString(declared);
  if (SESSION_STATUSES.has(status)) return status as MafwSessionStatus;
  if (asNumber(info.time?.busy) !== undefined || asNumber(info.time?.idle) !== undefined) return 'idle';
  return 'unknown';
}

/** 原生模型字段（`model.providerID|modelID` 对象 / assistant `providerID`+`modelID` / `model.id`）→ 中性引用。 */
export function canonicalModelRef(raw: unknown): MafwModelRef | undefined {
  const info = asRecord(raw);
  if (!info) return undefined;
  const model = asRecord(info.model);
  const providerID = asString(info.providerID) || asString(model?.providerID);
  const modelID = asString(info.modelID) || asString(model?.modelID) || asString(model?.id);
  if (!providerID || !modelID) return undefined;
  const variant = asString(info.variant) || asString(model?.variant);
  return { providerID, modelID, ...(variant ? { variant } : {}) };
}

const DIFF_STATUSES: ReadonlySet<string> = new Set(['added', 'modified', 'deleted', 'renamed', 'unknown']);

function canonicalDiff(raw: unknown): MafwDiff | null {
  const diff = asRecord(raw);
  if (!diff) return null;
  const file = asString(diff.file) || asString(diff.path);
  if (!file) return null;
  const status = asString(diff.status);
  return {
    file,
    ...(asString(diff.patch) ? { patch: asString(diff.patch) } : {}),
    ...(asNumber(diff.additions) !== undefined ? { additions: asNumber(diff.additions) } : {}),
    ...(asNumber(diff.deletions) !== undefined ? { deletions: asNumber(diff.deletions) } : {}),
    ...(status ? { status: (DIFF_STATUSES.has(status) ? status : 'unknown') as MafwDiff['status'] } : {}),
  };
}

function canonicalDiffs(value: unknown): MafwDiff[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const out = value.map(canonicalDiff).filter((d): d is MafwDiff => d !== null);
  return out.length ? out : undefined;
}

/** 原生 `revert`（opencode `{messageID, partID?, diff?}` / 已归一的 `reverted`）→ 中性回退状态。 */
export function canonicalSessionRevert(raw: unknown): MafwSessionRevert | undefined {
  const info = asRecord(raw);
  if (!info) return undefined;
  const source = asRecord(info.reverted) ?? asRecord(info.revert);
  if (!source) return undefined;
  const messageID = asString(source.messageID) || asString(source.messageId);
  if (!messageID) return undefined;
  const diffs = canonicalDiffs(source.diffs) ?? canonicalDiffs(source.diff);
  return {
    messageID,
    ...(asString(source.partID) ? { partID: asString(source.partID) } : {}),
    ...(diffs ? { diffs } : {}),
  };
}

/**
 * 会话 → `MafwSession`（原生字段原样保留，规范字段覆盖同名键）。
 * 无 id 的条目原样返回（无法构成 DTO，不伪造）。
 */
export function projectSession(raw: unknown): any {
  const info = asRecord(raw);
  if (!info) return raw;
  const id = asString(info.id) || asString(info.sessionID);
  if (!id) return raw;
  const model = canonicalModelRef(info);
  const reverted = canonicalSessionRevert(info);
  const canonical: MafwSession = {
    id,
    status: canonicalSessionStatus(info),
    ...(asString(info.title) ? { title: asString(info.title) } : {}),
    ...(asString(info.projectID) ? { projectID: asString(info.projectID) } : {}),
    ...(asString(info.directory) ? { directory: asString(info.directory) } : {}),
    ...(asString(info.parentID) ? { parentID: asString(info.parentID) } : {}),
    ...(asString(info.agent) ? { agent: asString(info.agent) } : {}),
    ...(model ? { model } : {}),
    ...(asNumber(info.time?.created) !== undefined || asNumber(info.time?.updated) !== undefined
      ? { time: { created: asNumber(info.time?.created), updated: asNumber(info.time?.updated) } }
      : {}),
    ...(reverted ? { reverted } : {}),
  };
  return { ...info, ...canonical };
}

/** 会话列表投影（逐项，保持顺序；无法投影的条目原样保留）。 */
export function projectSessions(list: unknown): any[] {
  return Array.isArray(list) ? list.map(projectSession) : [];
}

/** 模型条目 → `MafwModel`（`limit.context|output` 与服务商档案都收敛到中性字段）。 */
export function projectModel(raw: unknown, providerID: string, fallbackID = ''): MafwModel | null {
  const model = asRecord(raw);
  if (!model) return null;
  const id = asString(model.id) || fallbackID;
  if (!id) return null;
  const limit = asRecord(model.limit);
  const contextLimit = asNumber(limit?.context) ?? asNumber(model.contextLimit);
  const outputLimit = asNumber(limit?.output) ?? asNumber(model.outputLimit);
  const declared = asRecord(model.capabilities);
  const vision = declared?.input?.image === true || declared?.output?.image === true;
  const thinking = declared?.reasoning === true;
  return {
    id,
    name: asString(model.name) || id,
    providerID,
    ...(contextLimit !== undefined ? { contextLimit } : {}),
    ...(outputLimit !== undefined ? { outputLimit } : {}),
    ...(vision || thinking ? { extensions: { ...(vision ? { vision: true } : {}), ...(thinking ? { thinking: true } : {}) } } : {}),
  };
}

/** provider 条目 → `MafwProvider`（`models` 恒为数组：对象映射与数组两种原生形状同形）。 */
export function projectProvider(raw: unknown, connected?: boolean): MafwProvider | null {
  const provider = asRecord(raw);
  if (!provider) return null;
  const id = asString(provider.id);
  if (!id) return null;
  const rawModels = provider.models;
  const models: MafwModel[] = [];
  if (Array.isArray(rawModels)) {
    for (const entry of rawModels) {
      const model = projectModel(entry, id);
      if (model) models.push(model);
    }
  } else if (asRecord(rawModels)) {
    for (const [key, entry] of Object.entries(asRecord(rawModels)!)) {
      const model = projectModel(entry, id, key);
      if (model) models.push(model);
    }
  }
  return {
    id,
    name: asString(provider.name) || id,
    models,
    ...(connected !== undefined ? { connected } : {}),
  };
}

/**
 * provider 列表信封 → `{ items: MafwProvider[] }`（原生 `connected`/`default` 保留：
 * 默认模型是 composer 的初值来源，不在 View DTO 里另设字段）。
 */
export function projectProviderEnvelope(raw: unknown): { items: MafwProvider[] } & Rec {
  const envelope = asRecord(raw);
  const list = Array.isArray(raw)
    ? raw
    : Array.isArray(envelope?.all)
      ? envelope!.all
      : Array.isArray(envelope?.items)
        ? envelope!.items
        : [];
  const connected = asStringArray(envelope?.connected);
  const connectedSet = connected.length ? new Set(connected) : null;
  const items = list
    .map((entry) => projectProvider(entry, connectedSet ? connectedSet.has(asString(asRecord(entry)?.id)) : undefined))
    .filter((p): p is MafwProvider => p !== null);
  const rest: Rec = envelope && !Array.isArray(raw) ? { ...envelope } : {};
  delete rest.all;
  return { ...rest, items };
}

/**
 * agent 列表（`mergeAgentLists` 输出）→ `MafwAgent[]`。
 * `selectable` 由「注册表身份 = primary 才可选」/「runtime 原生 hidden+mode」决定，
 * 客户端不再自己按 runtime 名判断。
 */
export function projectAgents(list: unknown): MafwAgent[] {
  const out: MafwAgent[] = [];
  for (const entry of Array.isArray(list) ? list : []) {
    const agent = asRecord(entry);
    if (!agent) continue;
    const name = asString(agent.name) || asString(agent.id);
    if (!name) continue;
    const source = agent.source === 'mafw' ? 'mafw' : 'runtime';
    const mode = asString(agent.mode) || undefined;
    const selectable = source === 'mafw'
      ? mode !== 'subagent'
      : agent.hidden !== true && mode !== 'subagent';
    const model = canonicalModelRef(agent);
    out.push({
      id: name,
      label: asString(agent.label) || name,
      ...(asString(agent.description) ? { description: asString(agent.description) } : {}),
      source,
      selectable,
      ...(mode ? { mode } : {}),
      ...(model ? { model } : {}),
    });
  }
  return out;
}

const PERMISSION_TARGET_KEYS = ['command', 'cmd', 'script', 'path', 'filePath', 'file_path', 'url', 'pattern', 'query'];

function permissionTargetsFromArgs(args: unknown): string[] {
  const input = asRecord(args);
  if (!input) return [];
  const out: string[] = [];
  for (const key of PERMISSION_TARGET_KEYS) {
    const value = input[key];
    if (typeof value === 'string' && value) out.push(value);
  }
  return out;
}

function suggestedRuleOf(raw: Rec): MafwSuggestedRule | undefined {
  const declared = asRecord(raw.suggestedRule);
  if (declared) {
    const scope = declared.scope === 'tool' ? 'tool' : 'prefix';
    const value = asString(declared.value);
    if (value) return { scope, value };
  }
  const always = Array.isArray(raw.always) ? asStringArray(raw.always)[0] : asString(raw.always);
  if (always) return { scope: 'prefix', value: always };
  const toolName = asString(raw.toolName);
  if (toolName) return { scope: 'tool', value: toolName };
  return undefined;
}

/**
 * 权限请求归一（opencode `{id, permission, patterns, metadata}` /
 * pi `{requestId, toolName, args, risk}` / 已归一 DTO）。
 *
 * 规范字段：`id`（pi 取 requestId、opencode v2 的 replied 取 requestID —— 历史 bug
 * 就是卡片拿不到 id，答复必定 undefined）、`kind`（canonical 工具名，缺省 `tool`）、
 * `targets`（patterns，pi 从 args 的命令/路径/URL 提取）。
 * 原生字段在过渡期保留：出口（REST/SSE）在项目体内不删除原生键。
 *
 * 同一投影服务 `permission.asked` 与 `permission.replied`：replied 只带
 * `{requestId, approved, decision?, message?}`（无 toolName/args），**不得因缺
 * 工具元数据丢弃**——那会让桌面/远端永远销不掉卡片，只能显示与时序无关的旧态。
 */
export function projectPermissionRequest(raw: unknown, fallbackSessionID = ''): MafwPermissionRequest | null {
  const request = asRecord(raw);
  if (!request) return null;
  const id = asString(request.id) || asString(request.requestId) || asString(request.requestID);
  if (!id) return null;
  const sessionID = asString(request.sessionID) || fallbackSessionID;
  const rawKind = asString(request.kind) || asString(request.toolName) || asString(request.permission) || 'tool';
  const kind = canonicalToolOf(rawKind) ?? rawKind;
  const declaredTargets = asStringArray(request.targets);
  const targets = declaredTargets.length
    ? declaredTargets
    : asStringArray(request.patterns).length
      ? asStringArray(request.patterns)
      : [...permissionTargetsFromArgs(request.args), ...permissionTargetsFromArgs(request.metadata?.args)];
  const suggestedRule = suggestedRuleOf(request);
  const tool = asRecord(request.tool);
  const created = asNumber(request.time?.created) ?? asNumber(request.time?.createdAt);
  const extensions: Rec = {
    ...(asRecord(request.extensions) ?? {}),
    ...(asRecord(request.metadata) ? { metadata: asRecord(request.metadata) } : {}),
    ...(typeof request.metadata?.impact === 'string' ? { impact: request.metadata.impact } : {}),
    ...(asString(request.risk) ? { risk: asString(request.risk) } : {}),
  };
  return {
    id,
    sessionID,
    kind,
    targets,
    ...(suggestedRule ? { suggestedRule } : {}),
    ...(tool && asString(tool.messageID) && asString(tool.callID)
      ? { tool: { messageID: asString(tool.messageID), callID: asString(tool.callID) } }
      : {}),
    ...(created !== undefined ? { time: { created } } : {}),
    ...(Object.keys(extensions).length ? { extensions } : {}),
  };
}

/** 权限列表投影（无法归一的条目丢弃——客户端绝不收到无 id 的卡片）。 */
export function projectPermissionList(list: unknown, fallbackSessionID = ''): MafwPermissionRequest[] {
  const out: MafwPermissionRequest[] = [];
  for (const entry of Array.isArray(list) ? list : []) {
    const request = projectPermissionRequest(entry, fallbackSessionID);
    if (request) out.push(request);
  }
  return out;
}

/**
 * 权限事件载荷富化（canonical 字段并入 `properties`，原生键保留）。
 * 单一出口：live `permission.asked` 与 REST 列表走同一投影，卡片形状不再分叉。
 */
export function enrichPermissionEvent(props: Rec, fallbackSessionID = ''): MafwPermissionRequest | null {
  const canonical = projectPermissionRequest(props, fallbackSessionID);
  if (!canonical) return null;
  Object.assign(props, canonical);
  return canonical;
}

function canonicalQuestion(raw: unknown, index: number): MafwQuestionInfo {
  const question = asRecord(raw) ?? {};
  const options = Array.isArray(question.options)
    ? question.options.map((option: any) => ({
      label: asString(option?.label) || asString(option?.value),
      ...(asString(option?.description) ? { description: asString(option.description) } : {}),
    }))
    : [];
  const title = asString(question.question) || asString(question.title) || asString(question.header) || `Question ${index + 1}`;
  return {
    question: title,
    ...(asString(question.header) ? { header: asString(question.header) } : {}),
    options,
    ...(question.multiple === true || question.type === 'multiselect' ? { multiple: true } : {}),
    ...(question.custom === true ? { custom: true } : {}),
  };
}

/**
 * 问题请求投影：`{id, sessionID, questions: MafwQuestionInfo[]}` 规范字段齐备，
 * 原生字段（`form` / `mode` / `expiresAt` / 每题的 type/required/placeholder…）原样保留
 * ——AskCard 的 typed 控件仍读这些扩展，它们是 DTO 之外的 residual（见最终报告）。
 */
export function projectQuestionRequest(raw: unknown, fallbackSessionID = ''): any {
  const request = asRecord(raw);
  if (!request) return raw;
  const id = asString(request.id) || asString(request.requestId);
  if (!id) return raw;
  const sessionID = asString(request.sessionID) || fallbackSessionID;
  const questions = Array.isArray(request.questions)
    ? request.questions.map((question: any, index: number) => ({
      ...(asRecord(question) ?? {}),
      ...canonicalQuestion(question, index),
    }))
    : [];
  const tool = asRecord(request.tool);
  const created = asNumber(request.time?.created) ?? asNumber(request.createdAt);
  return {
    ...request,
    id,
    sessionID,
    questions,
    ...(tool && asString(tool.messageID) && asString(tool.callID)
      ? { tool: { messageID: asString(tool.messageID), callID: asString(tool.callID) } }
      : {}),
    ...(created !== undefined && !asRecord(request.time) ? { time: { created } } : {}),
  };
}
