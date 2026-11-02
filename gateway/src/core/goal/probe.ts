// gateway/src/core/goal/probe.ts
// Spike（技术验证）请求与报告的纯类型 / 机器可读校验层（spec §6）。
//
// 不变量：
// - ProbeRequest 的范围必须是机器可读字段：允许路径、命令类别、网络、凭据、预算。
//   自然语言约束不可执行，因此这里只接受结构化字段；
// - 路径只能是隔离工作区内的**相对**路径（绝对路径 / `..` 逃逸 / NUL 一律拒绝）；
//   探针不得借隔离工作区之名写主工作区；
// - 命令类别取自封闭词汇表，未知类别拒绝（不猜测未来命令）；
// - 预算必须有界（服务层再叠加每 Pod 上限，见 pod-probe-service）；
// - 报告在持久化前统一脱敏（redactProbeReport），调用方不需要记得脱敏。
//
// 这里只做纯数据校验，不读写文件、不调用 LLM。

import { redactSecrets } from '../../recall/redact';

/** 探针状态生命周期（queued → running → completed/failed；cancelled 为人工收尾）。 */
export type ProbeStatus = 'queued' | 'running' | 'completed' | 'failed' | 'cancelled';

/**
 * 探针可声明的命令类别（封闭词汇表）。
 * `install`/`shell` 是高风险类别：它们通常还需要网络与显式审批（Task 14 scope guard）。
 */
export const PROBE_COMMAND_CLASSES = [
  'read',
  'search',
  'build',
  'test',
  'lint',
  'format',
  'install',
  'shell',
] as const;

export type ProbeCommandClass = (typeof PROBE_COMMAND_CLASSES)[number];

/** 单条探针的硬上限（服务层可用 deps.limits 收紧，不能放宽到无界）。 */
export const DEFAULT_PROBE_LIMITS = {
  maxMinutes: 60,
  maxUsd: 5,
} as const;

export interface ProbeScope {
  /** 相对隔离工作区根的允许路径（`src`、`docs/plan.md`；`.` 表示整个工作区）。 */
  paths: string[];
  /** 允许执行的命令类别（至少一项）。 */
  commandClasses: ProbeCommandClass[];
  /** 是否允许联网（默认 false；越界需显式批准）。 */
  network: boolean;
  /** 允许读取的凭据名（默认空；`*` 通配被拒绝）。 */
  credentials: string[];
}

export interface ProbeBudget {
  maxMinutes: number;
  maxUsd: number;
}

export interface ProbeAffects {
  planAssertions?: string[];
  evalMethods?: string[];
  options?: string[];
}

export interface ProbeRequest {
  id: string;
  podId: string;
  goalId: string;
  revision: number;
  question: string;
  hypothesis: string;
  scope: ProbeScope;
  budget: ProbeBudget;
  evidenceRequired: string[];
  affects: ProbeAffects;
}

export type ProbeConclusion = 'supports' | 'refutes' | 'inconclusive';

export interface ProbeImpact {
  plan?: string;
  goalEval?: string;
}

export interface ProbeReport {
  probeId: string;
  conclusion: ProbeConclusion;
  commands: string[];
  keyOutput: string;
  repro: string[];
  remainingAssumptions: string[];
  impact: ProbeImpact;
}

export interface ProbeBudgetLimits {
  maxMinutes?: number;
  maxUsd?: number;
}

const ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const CREDENTIAL_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,63}$/;
const MAX_TEXT = 2000;
const MAX_KEY_OUTPUT = 20000;
const AFFECT_KEYS = ['planAssertions', 'evalMethods', 'options'] as const;
const IMPACT_KEYS = ['plan', 'goalEval'] as const;
const CONCLUSIONS: readonly ProbeConclusion[] = ['supports', 'refutes', 'inconclusive'];

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function clean(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function requireText(value: unknown, field: string, max = MAX_TEXT): string {
  const text = clean(value);
  if (!text) throw new Error(`probe ${field} is required`);
  if (text.length > max) throw new Error(`probe ${field} is too long (max ${max})`);
  return text;
}

function requireIdentifier(value: unknown, field: string): string {
  const text = clean(value);
  if (!ID_PATTERN.test(text)) throw new Error(`probe ${field} must be a safe identifier`);
  return text;
}

function uniqueStrings(value: unknown, field: string, opts: { allowEmpty?: boolean } = {}): string[] {
  if (value === undefined || value === null) {
    if (opts.allowEmpty) return [];
    throw new Error(`probe ${field} is required`);
  }
  if (!Array.isArray(value)) throw new Error(`probe ${field} must be an array of strings`);
  const seen = new Set<string>();
  const out: string[] = [];
  for (const item of value) {
    if (typeof item !== 'string') throw new Error(`probe ${field} must be an array of strings`);
    const text = item.trim();
    if (!text) continue;
    if (seen.has(text)) continue;
    seen.add(text);
    out.push(text);
  }
  if (out.length === 0 && !opts.allowEmpty) throw new Error(`probe ${field} requires at least one entry`);
  return out;
}

/**
 * 范围路径归一化：反斜杠转 `/`、去掉空段与 `.`、拒绝绝对路径 / 盘符 / UNC / `..` / NUL。
 * 结果永远指向隔离工作区内部（`.` 表示工作区根）。
 */
function normalizeScopePath(value: unknown): string {
  if (typeof value !== 'string') throw new Error('probe scope path must be a string');
  const raw = value.trim().replace(/\\/g, '/');
  if (!raw) throw new Error('probe scope path must not be empty');
  if (raw.includes('\0')) throw new Error(`probe scope path must not contain NUL: ${JSON.stringify(value)}`);
  if (raw.startsWith('/') || raw.startsWith('//') || /^[A-Za-z]:/.test(raw)) {
    throw new Error(`probe scope path must be relative: ${raw}`);
  }
  const segments = raw.split('/').filter((segment) => segment && segment !== '.');
  if (segments.some((segment) => segment === '..')) {
    throw new Error(`probe scope path must not escape the probe workspace: ${raw}`);
  }
  return segments.length ? segments.join('/') : '.';
}

function normalizeScopePaths(value: unknown): string[] {
  if (value === undefined || value === null) throw new Error('probe scope paths is required');
  if (!Array.isArray(value)) throw new Error('probe scope paths must be an array of strings');
  const seen = new Set<string>();
  const out: string[] = [];
  for (const item of value) {
    const normalized = normalizeScopePath(item);
    if (seen.has(normalized)) continue;
    seen.add(normalized);
    out.push(normalized);
  }
  // 空数组是合法的「只推理、不读写」范围；显式声明比隐式默认更安全。
  return out;
}

function normalizeCommandClasses(value: unknown): ProbeCommandClass[] {
  const classes = uniqueStrings(value, 'scope commandClasses');
  const known = new Set<string>(PROBE_COMMAND_CLASSES);
  const out: ProbeCommandClass[] = [];
  for (const item of classes) {
    if (!known.has(item)) throw new Error(`unknown probe command class: ${item}`);
    out.push(item as ProbeCommandClass);
  }
  if (out.length === 0) throw new Error('probe scope commandClasses requires at least one entry');
  return out;
}

function normalizeCredentials(value: unknown): string[] {
  const items = uniqueStrings(value, 'scope credentials', { allowEmpty: true });
  for (const item of items) {
    if (!CREDENTIAL_PATTERN.test(item)) {
      throw new Error(`probe scope credential name is not allowed: ${JSON.stringify(item)}`);
    }
  }
  return items;
}

function normalizeBudget(value: unknown, limits: ProbeBudgetLimits): ProbeBudget {
  if (!isPlainObject(value)) throw new Error('probe budget must be an object');
  const maxMinutes = value.maxMinutes;
  const maxUsd = value.maxUsd;
  if (typeof maxMinutes !== 'number' || !Number.isFinite(maxMinutes) || maxMinutes <= 0) {
    throw new Error('probe budget maxMinutes must be a positive finite number');
  }
  if (typeof maxUsd !== 'number' || !Number.isFinite(maxUsd) || maxUsd < 0) {
    throw new Error('probe budget maxUsd must be a non-negative finite number');
  }
  const minuteCap = limits.maxMinutes ?? DEFAULT_PROBE_LIMITS.maxMinutes;
  const usdCap = limits.maxUsd ?? DEFAULT_PROBE_LIMITS.maxUsd;
  if (maxMinutes > minuteCap) {
    throw new Error(`probe budget maxMinutes exceeds the cap of ${minuteCap} minutes`);
  }
  if (maxUsd > usdCap) {
    throw new Error(`probe budget maxUsd exceeds the cap of ${usdCap} USD`);
  }
  return { maxMinutes, maxUsd };
}

function normalizeAffects(value: unknown): ProbeAffects {
  if (value === undefined || value === null) return {};
  if (!isPlainObject(value)) throw new Error('probe affects must be an object');
  const affects: ProbeAffects = {};
  for (const key of Object.keys(value)) {
    if (!(AFFECT_KEYS as readonly string[]).includes(key)) {
      throw new Error(`probe affects has an unknown key: ${key}`);
    }
  }
  for (const key of AFFECT_KEYS) {
    if (value[key] === undefined || value[key] === null) continue;
    const items = uniqueStrings(value[key], `affects ${key}`, { allowEmpty: true });
    if (items.length) affects[key] = items;
  }
  return affects;
}

/**
 * 校验并规范化 ProbeRequest（非法输入抛错，合法输入返回新对象，绝不改入参）。
 * `limits` 是调用方（服务层配置）叠加的上限，只能收紧默认值。
 */
export function validateProbeRequest(input: unknown, limits: ProbeBudgetLimits = {}): ProbeRequest {
  if (!isPlainObject(input)) throw new Error('probe request must be an object');

  const revision = input.revision;
  if (typeof revision !== 'number' || !Number.isInteger(revision) || revision < 1) {
    throw new Error('probe revision must be a positive integer');
  }

  if (!isPlainObject(input.scope)) throw new Error('probe scope must be an object');
  if (typeof input.scope.network !== 'boolean') {
    throw new Error('probe scope network must be boolean');
  }

  return {
    id: requireIdentifier(input.id, 'id'),
    podId: requireIdentifier(input.podId, 'podId'),
    goalId: requireIdentifier(input.goalId, 'goalId'),
    revision,
    question: requireText(input.question, 'question'),
    hypothesis: requireText(input.hypothesis, 'hypothesis'),
    scope: {
      paths: normalizeScopePaths(input.scope.paths),
      commandClasses: normalizeCommandClasses(input.scope.commandClasses),
      network: input.scope.network,
      credentials: normalizeCredentials(input.scope.credentials),
    },
    budget: normalizeBudget(input.budget, limits),
    evidenceRequired: uniqueStrings(input.evidenceRequired, 'evidenceRequired'),
    affects: normalizeAffects(input.affects),
  };
}

function normalizeImpact(value: unknown): ProbeImpact {
  if (value === undefined || value === null) return {};
  if (!isPlainObject(value)) throw new Error('probe report impact must be an object');
  const impact: ProbeImpact = {};
  for (const key of Object.keys(value)) {
    if (!(IMPACT_KEYS as readonly string[]).includes(key)) {
      throw new Error(`probe report impact has an unknown key: ${key}`);
    }
  }
  for (const key of IMPACT_KEYS) {
    if (value[key] === undefined || value[key] === null) continue;
    impact[key] = requireText(value[key], `report impact.${key}`);
  }
  return impact;
}

/** 校验并规范化 ProbeReport（结构校验；脱敏在 redactProbeReport 中单独做）。 */
export function validateProbeReport(input: unknown): ProbeReport {
  if (!isPlainObject(input)) throw new Error('probe report must be an object');

  const conclusion = clean(input.conclusion);
  if (!CONCLUSIONS.includes(conclusion as ProbeConclusion)) {
    throw new Error(`probe report conclusion must be one of: ${CONCLUSIONS.join(', ')}`);
  }

  return {
    probeId: requireIdentifier(input.probeId, 'report probeId'),
    conclusion: conclusion as ProbeConclusion,
    commands: uniqueStrings(input.commands, 'report commands', { allowEmpty: true }),
    keyOutput: requireText(input.keyOutput, 'report keyOutput', MAX_KEY_OUTPUT),
    repro: uniqueStrings(input.repro, 'report repro', { allowEmpty: true }),
    remainingAssumptions: uniqueStrings(input.remainingAssumptions, 'report remainingAssumptions', {
      allowEmpty: true,
    }),
    impact: normalizeImpact(input.impact),
  };
}

// redactSecrets 的 `sk-` 规则要求 16+ 字符，而探针日志里短前缀（`sk-secret`）同样是
// 泄漏源。探针报告额外收紧短 token 前缀；误伤面仅限于形如 `sk-xxxx` 的技术文本。
const EXTRA_SECRET_PATTERNS: RegExp[] = [
  /\bsk-[A-Za-z0-9_-]{3,}\b/g,
  /\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{4,}\b/g,
];

/** 探针文本脱敏（报告与失败原因共用；短 token 前缀也在覆盖范围内）。 */
export function redactProbeText(text: string): string {
  let out = redactSecrets(text);
  for (const pattern of EXTRA_SECRET_PATTERNS) out = out.replace(pattern, '[REDACTED]');
  return out;
}

/**
 * 报告脱敏（写 DB / 写文件之前统一调用）：命令、关键输出、复现步骤、
 * 剩余假设与影响说明全部处理；结构与结论不变。
 */
export function redactProbeReport(report: ProbeReport): ProbeReport {
  const impact: ProbeImpact = {};
  if (report.impact.plan) impact.plan = redactProbeText(report.impact.plan);
  if (report.impact.goalEval) impact.goalEval = redactProbeText(report.impact.goalEval);
  return {
    probeId: report.probeId,
    conclusion: report.conclusion,
    commands: report.commands.map(redactProbeText),
    keyOutput: redactProbeText(report.keyOutput),
    repro: report.repro.map(redactProbeText),
    remainingAssumptions: report.remainingAssumptions.map(redactProbeText),
    impact,
  };
}
