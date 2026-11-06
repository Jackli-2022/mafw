/**
 * Runtime 插件静态体检 —— 插件声明的 eventMappings × 契约 JSON 交叉核对。
 *
 * 目的：不启动 runtime、不调 LLM、不切 active runtime，就能回答四个问题
 *   1. 哪些事件翻译不对（映射到不存在的 canonical 类型 / 行不可达 / drop 过宽）
 *   2. 需要什么结构（映射缺 contract.events[].requiredFields 里的字段）
 *   3. 哪些没有输出（样本 → 未命中 / 被压制 / transformEvent 非法）
 *   4. 哪些接口面不对（capability 声明与契约 surfaces/presets 不一致；
 *      可选 probe 真调一次只读方法验返回形状）
 *
 * 契约源：packages/gateway-sdk/contract/runtime-contract.json（emit:runtime-contract 产物）。
 * 插件源：module.exports.eventSource / eventMappings / transformEvent / capabilities。
 * 与 gateway 运行时执行器同源：样本走 applyEventMappings（不是二次实现）。
 */
import { applyEventMappings, type EventMapping, type EventMappingEntry } from './event-mapper';
import { checkEventFields } from './event-field-contract';
import { normalizeOpencodeEvent } from './normalize';
import { EVENT_FLOW_MATRIX } from './event-flow-matrix';
import { getPath } from './path-expr';
import { isKnownEventType } from './event-telemetry';
import type { RuntimeCapabilities } from './contract';

// ─── 契约 JSON 的最小结构（runtime-contract.json 的子集） ──────────────────

export interface AuditContractEvent {
  type: string;
  family?: string;
  requiredFields?: string[];
  consumers?: string[];
  producers?: string[];
}

export interface AuditContractCapability {
  id: string;
  title?: string;
  requires?: string[];
  unlocks?: string[];
  degrade?: string;
}

export interface AuditContractSurface {
  id: string;
  capability?: string;
  obligation?: string;
  verification?: string;
  impact?: string;
}

export interface AuditContractPreset {
  id: string;
  title?: string;
  requiredSurfaces?: string[];
  capabilities?: string[];
}

/** 结构兼容 buildRuntimeContractManifest() 与 runtime-contract.json。 */
export interface AuditContract {
  contractVersion?: string;
  events: AuditContractEvent[];
  capabilities: AuditContractCapability[];
  surfaces?: AuditContractSurface[];
  presets?: AuditContractPreset[];
}

// ─── 发现项 ────────────────────────────────────────────────────────────────

export type AuditSeverity = 'error' | 'warn' | 'info';

export type AuditFindingKind =
  | 'invalid-declaration'
  | 'unknown-target'
  | 'missing-required'
  | 'unreachable-mapping'
  | 'duplicate-mapping'
  | 'suppressed-row'
  | 'no-producer'
  | 'unknown-capability'
  | 'preset-capability'
  | 'runtime-hard'
  | 'runtime-downgraded';

export interface AuditFinding {
  kind: AuditFindingKind;
  severity: AuditSeverity;
  /** 定位：mapping[3] system → session.created / capabilities / preset core */
  where: string;
  message: string;
  /** 可执行的下一步（怎么改） */
  fix?: string;
}

// ─── 样本事件 trace ────────────────────────────────────────────────────────

export type SampleOutcome = 'ok' | 'bad-structure' | 'no-output';
export type NoOutputReason = 'unmatched' | 'suppressed' | 'invalid';

export interface SampleOutput {
  type: string;
  known: boolean;
  warnings: string[];
  facets: {
    sessionID: string | null;
    step: boolean;
    chatSignal: string | null;
    compaction: string | null;
    toolCommand: string | null;
  };
  flow?: { modeA: string; desktop: string; tui: string; note?: string };
}

export interface SampleAudit {
  index: number;
  /** 原生事件摘要：system/init、assistant、result/success… */
  label: string;
  nativeType: string | null;
  outcome: SampleOutcome;
  reason?: NoOutputReason;
  detail?: string;
  via: 'mapping' | 'transform' | 'none';
  mapping?: { index: number; from: string | string[]; to: string };
  outputs: SampleOutput[];
}

// ─── 接口面 ────────────────────────────────────────────────────────────────

export interface ApiSurfaceAudit {
  capability: string;
  title?: string;
  /** 该 capability 在契约里要求的 surface 清单。 */
  surfaces: string[];
  /** plugin-check 的运行时校验结论（missing 的 surface 才会出现）。 */
  missing: string[];
}

export type ApiProbeStatus = 'ok' | 'missing' | 'error' | 'skipped';

export interface ApiProbe {
  surface: string;
  status: ApiProbeStatus;
  detail?: string;
  ms: number;
}

export interface PluginAuditReport {
  contractVersion?: string;
  mappings: { total: number; mapped: number; drop: number };
  findings: AuditFinding[];
  samples: SampleAudit[];
  capabilities: ApiSurfaceAudit[];
  probes?: ApiProbe[];
  summary: {
    errors: number;
    warnings: number;
    samplesOk: number;
    samplesBad: number;
    samplesMissing: number;
    probesBad: number;
  };
}

export interface PluginAuditInput {
  entry: EventMappingEntry;
  capabilities?: Partial<RuntimeCapabilities> | Record<string, unknown>;
  contract: AuditContract;
  /** 目标 preset（用于「preset 需要的 capability 没声明」判定）。 */
  preset?: string;
  samples?: unknown[];
  /** plugin-check 已算出的运行时校验结论（存在则并入接口面视图）。 */
  runtimeValidation?: {
    hard?: string[];
    downgraded?: string[];
    warnings?: string[];
    surfaces?: Record<string, { status: string; impact: string }>;
  } & Record<string, unknown>;
}

// ─── 静态映射审计 ──────────────────────────────────────────────────────────

const topSegment = (p: string): string => p.split('.')[0];
const fromList = (m: EventMapping): string[] => (Array.isArray(m.from) ? m.from : [m.from]);
const sameWhen = (a: EventMapping, b: EventMapping): boolean =>
  JSON.stringify(a.when ?? []) === JSON.stringify(b.when ?? []);

function providedTopLevel(m: EventMapping): Set<string> | null {
  // passProperties 整段透传：字段是否齐全取决于运行时载荷，静态不可判。
  if (m.passProperties) return null;
  const out = new Set<string>();
  for (const key of Object.keys(m.fields ?? {})) out.add(topSegment(key));
  return out;
}

function suggestTypes(contract: AuditContract, target: string): string[] {
  const prefix = target.split('.')[0];
  const all = contract.events.map((e) => e.type);
  const sameFamily = all.filter((t) => t.split('.')[0] === prefix);
  return (sameFamily.length > 0 ? sameFamily : all).slice(0, 6);
}

export function auditMappings(
  entry: EventMappingEntry,
  contract: AuditContract,
): AuditFinding[] {
  const findings: AuditFinding[] = [];
  const rows = (entry.eventMappings ?? []) as EventMapping[];

  if (rows.length > 0 && !entry.eventSource?.typePath) {
    findings.push({
      kind: 'invalid-declaration',
      severity: 'error',
      where: 'eventSource',
      message: 'eventMappings declared but eventSource.typePath is missing',
      fix: "add eventSource: { typePath: '$.type', sessionIdPath: '$.session_id' }",
    });
  }

  const contractTypes = new Set(contract.events.map((e) => e.type));

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i] as any;
    const where = `mapping[${i}] ${row?.from ?? '?'} -> ${row?.to ?? '?'}`;
    if (!row || typeof row !== 'object') {
      findings.push({ kind: 'invalid-declaration', severity: 'error', where: `mapping[${i}]`, message: 'mapping row is not an object' });
      continue;
    }
    if (!row.from || (Array.isArray(row.from) && row.from.length === 0)) {
      findings.push({ kind: 'invalid-declaration', severity: 'error', where, message: "mapping row has no 'from'" });
    }
    if (!row.to) {
      findings.push({ kind: 'invalid-declaration', severity: 'error', where, message: "mapping row has no 'to'" });
      continue;
    }
    if (row.to === 'drop') {
      findings.push({
        kind: 'suppressed-row',
        severity: 'info',
        where,
        message: `native '${fromList(row).join('|')}' is explicitly dropped - consumers never see it`,
        fix: 'confirm no desktop/TUI/gateway consumer needs this event',
      });
      continue;
    }
    const evt = contract.events.find((e) => e.type === row.to);
    if (!evt) {
      const suggestions = suggestTypes(contract, row.to);
      findings.push({
        kind: 'unknown-target',
        severity: 'error',
        where,
        message: `'${row.to}' is not a canonical type in the contract (${contract.events.length} types)`,
        fix: `map to one of: ${suggestions.join(', ')}`,
      });
    } else {
      const provided = providedTopLevel(row);
      if (provided) {
        const missing = (evt.requiredFields ?? []).filter((r) => !provided.has(topSegment(r)));
        if (missing.length > 0) {
          const consumers = (evt.consumers ?? ['desktop']).join('/');
          findings.push({
            kind: 'missing-required',
            severity: 'error',
            where,
            message: `does not set required field(s): ${missing.join(', ')} - ${consumers} silently degrade`,
            fix: `add fields: { ${missing.map((m) => `'${m}': { path: '$.…' }`).join(', ')} } or passProperties on the native payload`,
          });
        }
      }
    }

    // 行可达性：同 from 的更早一行没有 when（恒匹配）→ 本行永远轮不到。
    const froms = fromList(row);
    for (let j = 0; j < i; j++) {
      const prev = rows[j];
      if (!prev || !prev.from) continue;
      const overlap = fromList(prev).some((f) => froms.includes(f));
      if (!overlap) continue;
      if ((prev.when ?? []).length === 0) {
        findings.push({
          kind: 'unreachable-mapping',
          severity: 'warn',
          where,
          message: `unreachable: earlier mapping[${j}] matches '${fromList(prev).join('|')}' unconditionally (first-match wins)`,
          fix: 'move the unconditional row last, or add a when condition to the earlier row',
        });
        break;
      }
      if (sameWhen(prev, row)) {
        findings.push({
          kind: 'duplicate-mapping',
          severity: 'warn',
          where,
          message: `duplicate of mapping[${j}] (same from + when) - the later row never runs`,
        });
        break;
      }
    }

    if (!contractTypes.has(row.to)) continue; // 已报 unknown-target
  }

  // 契约覆盖：没有 transformEvent 时，能静态列出「运行时产出的 canonical 事件它永远发不出」。
  // 收成一条 info（逐事件刷屏会淹没真正的错误；作者按需展开 JSON 看全量）。
  if (!entry.transformEvent) {
    const produced = new Set(
      rows.filter((r) => r && typeof r === 'object' && r.to !== 'drop').map((r) => r.to),
    );
    const silent = contract.events
      .filter((evt) => (evt.producers ?? []).includes('runtime'))
      .filter((evt) => (evt.requiredFields ?? []).length > 0)
      .filter((evt) => !produced.has(evt.type))
      .map((evt) => evt.type);
    if (silent.length > 0) {
      findings.push({
        kind: 'no-producer',
        severity: 'info',
        where: 'coverage',
        message: `${silent.length} runtime event(s) have no producer: ${silent.slice(0, 10).join(', ')}${silent.length > 10 ? ', ...' : ''}`,
        fix: 'expected for partial runtimes; add a mapping row if this runtime should emit one',
      });
    }
  }

  return findings;
}

// ─── 样本 trace（真执行器） ────────────────────────────────────────────────

function labelOf(raw: any, nativeType: string | null): string {
  if (!nativeType) {
    return String(raw?.payload?.type ?? raw?.type ?? '(no type)');
  }
  const subtype = typeof raw?.subtype === 'string' ? raw.subtype : undefined;
  const status = typeof raw?.status === 'string' ? raw.status : undefined;
  return [nativeType, subtype ?? status].filter(Boolean).join('/');
}

export function traceSamples(
  entry: EventMappingEntry,
  samples: unknown[],
  opts: { isCanonicalType?: (t: string) => boolean } = {},
): SampleAudit[] {
  const isCanonical = opts.isCanonicalType ?? isKnownEventType;

  return samples.map((raw, index) => {
    const nativeRaw = entry.eventSource?.typePath ? getPath(raw, entry.eventSource.typePath) : undefined;
    const nativeType = typeof nativeRaw === 'string' && nativeRaw ? nativeRaw : null;

    let via: SampleAudit['via'] = 'none';
    let mapping: SampleAudit['mapping'];
    let reason: NoOutputReason | undefined;
    let detail: string | undefined;

    const out = applyEventMappings(raw, entry, isCanonical, {
      onMatched: (info) => {
        via = info.via;
        if (info.via === 'mapping') {
          mapping = {
            index: info.mappingIndex ?? -1,
            from: info.from,
            to: Array.isArray(info.to) ? info.to.join('|') : info.to,
          };
        }
      },
      onSuppressed: () => {
        reason = 'suppressed';
        detail = detail ?? 'a drop row matched, or transformEvent returned null for this type';
      },
      onUnmatched: (t) => { reason = 'unmatched'; detail = detail ?? `no translation for native '${t}'`; },
      onTranslationError: (_raw, msg) => { reason = 'invalid'; detail = msg; },
    });

    const outputs: SampleOutput[] = out.map((evt: any) => {
      const type: string = evt?.payload?.type ?? evt?.type ?? '';
      const f = normalizeOpencodeEvent(evt as any);
      const row = EVENT_FLOW_MATRIX[type];
      return {
        type,
        known: isCanonical(type),
        warnings: checkEventFields(evt),
        facets: {
          sessionID: (f as any).sessionID ?? null,
          step: !!(f as any).step,
          chatSignal: (f as any).chatSignal ?? null,
          compaction: (f as any).compaction ?? null,
          toolCommand: (f as any).toolCommand ?? null,
        },
        ...(row ? { flow: { modeA: row.modeA, desktop: row.desktop, tui: row.tui, ...(row.note ? { note: row.note } : {}) } } : {}),
      };
    });

    let outcome: SampleOutcome;
    if (outputs.length === 0) outcome = 'no-output';
    else if (outputs.some((o) => !o.known || o.warnings.length > 0)) outcome = 'bad-structure';
    else outcome = 'ok';

    return {
      index,
      label: labelOf(raw, nativeType),
      nativeType,
      outcome,
      ...(outcome === 'no-output' ? { reason: reason ?? 'unmatched', ...(detail ? { detail } : {}) } : {}),
      via,
      ...(mapping ? { mapping } : {}),
      outputs,
    };
  });
}

// ─── 接口面审计 ────────────────────────────────────────────────────────────

const capSurfaces = (contract: AuditContract, id: string): string[] =>
  contract.surfaces?.filter((s) => s.capability === id).map((s) => s.id) ?? [];

export function auditCapabilities(
  capabilities: Record<string, unknown> | undefined,
  contract: AuditContract,
  opts: { preset?: string; runtimeValidation?: PluginAuditInput['runtimeValidation'] } = {},
): { findings: AuditFinding[]; surfaces: ApiSurfaceAudit[] } {
  const findings: AuditFinding[] = [];
  const caps = capabilities ?? {};
  const known = new Map(contract.capabilities.map((c) => [c.id, c]));

  for (const key of Object.keys(caps)) {
    if (!known.has(key)) {
      findings.push({
        kind: 'unknown-capability',
        severity: 'warn',
        where: 'capabilities',
        message: `'${key}' is not a capability in the contract - it will be ignored by clients/coverage`,
      });
    }
  }

  // 契约 capability → 声明状态 + 需要的 surface（作者可逐条自查）
  const surfaces: ApiSurfaceAudit[] = [];
  const hard = opts.runtimeValidation?.hard ?? [];
  const surfaceStatus = opts.runtimeValidation?.surfaces ?? {};
  for (const cap of contract.capabilities) {
    const declared = caps[cap.id] === true;
    if (!declared) continue;
    const required = cap.requires ?? [];
    const missing = required.filter((s) => surfaceStatus[s]?.status === 'missing');
    // runtimeValidation 的 hard 消息里没有结构化 surface id，用 surfaces 状态兜底；
    // 若覆盖表缺席（旧检查器）则保持空（无法判定 ≠ 错）。
    surfaces.push({
      capability: cap.id,
      ...(cap.title ? { title: cap.title } : {}),
      surfaces: required.length > 0 ? required : capSurfaces(contract, cap.id),
      missing,
    });
  }

  for (const msg of hard) {
    findings.push({ kind: 'runtime-hard', severity: 'error', where: 'runtime', message: msg, fix: 'implement the missing surface or declare the capability false' });
  }
  for (const msg of opts.runtimeValidation?.downgraded ?? []) {
    findings.push({ kind: 'runtime-downgraded', severity: 'warn', where: 'runtime', message: msg, fix: 'implement the required surfaces or accept the reduced capability' });
  }

  if (opts.preset) {
    const preset = contract.presets?.find((p) => p.id === opts.preset);
    if (preset) {
      for (const capId of preset.capabilities ?? []) {
        if (caps[capId] === true) continue;
        findings.push({
          kind: 'preset-capability',
          severity: 'warn',
          where: `preset ${preset.id}`,
          message: `preset requires capability '${capId}' but it is not declared true`,
          fix: `declare '${capId}: true' in module.exports.capabilities or pick a smaller preset`,
        });
      }
    }
  }

  return { findings, surfaces };
}

// ─── 只读接口探针（可选；真的调用一次） ────────────────────────────────────

type ProbeShape = (value: unknown) => string | null;

const isObject = (v: unknown): v is Record<string, any> => typeof v === 'object' && v !== null && !Array.isArray(v);

const PROBES: Array<{
  surface: string;
  /** 实际方法路径（surface id 与实现路径不一定同名，如 provider.config → config.get）。 */
  path: string[];
  args?: unknown;
  shape: ProbeShape;
}> = [
  {
    surface: 'process.getBaseUrl',
    path: ['getBaseUrl'],
    shape: (v) => (typeof v === 'string' && v.length > 0 ? null : `expected non-empty string, got ${typeof v}`),
  },
  {
    surface: 'process.healthCheck',
    path: ['healthCheck'],
    shape: (v) => (v === undefined || typeof v === 'boolean' ? null : `expected boolean|undefined, got ${typeof v}`),
  },
  {
    surface: 'tools.nativeTools',
    path: ['tools', 'nativeTools'],
    shape: (v) => (Array.isArray(v) && v.every((t: any) => typeof t?.name === 'string') ? null : 'expected [{ name, toolClass? }]'),
  },
  {
    surface: 'provider.list',
    path: ['provider', 'list'],
    shape: (v) => (isObject(v) && Array.isArray(v.all) && Array.isArray(v.connected) ? null : 'expected { all: [], connected: [], default: {} }'),
  },
  {
    surface: 'provider.app.agents',
    path: ['app', 'agents'],
    shape: (v) => (Array.isArray(v) ? null : 'expected agent[]'),
  },
  {
    surface: 'provider.config',
    path: ['config', 'get'],
    shape: (v) => (isObject(v) ? null : 'expected config object'),
  },
  {
    surface: 'session.list',
    path: ['session', 'list'],
    shape: (v) => (Array.isArray(v) ? null : 'expected session[]'),
  },
  {
    surface: 'session.todo',
    path: ['session', 'todo'],
    args: { sessionID: 'probe' },
    shape: (v) => (Array.isArray(v) ? null : 'expected todo[]'),
  },
  {
    surface: 'session.children',
    path: ['session', 'children'],
    args: { sessionID: 'probe' },
    shape: (v) => (Array.isArray(v) ? null : 'expected session[]'),
  },
  {
    surface: 'mcp.list',
    path: ['mcp', 'list'],
    shape: (v) => (Array.isArray(v) ? null : 'expected server[]'),
  },
];

/** 只调无副作用/可安全重试的 surface；超时归类 skipped（外部 CLI 不可用 != 实现错误）。 */
export async function probeRuntimeApis(
  rt: any,
  opts: { timeoutMs?: number; only?: string[] } = {},
): Promise<ApiProbe[]> {
  const timeoutMs = opts.timeoutMs ?? 3000;
  const only = opts.only ? new Set(opts.only) : null;
  const out: ApiProbe[] = [];

  for (const probe of PROBES) {
    if (only && !only.has(probe.surface)) continue;
    const started = Date.now();
    const fn = (() => {
      try {
        let owner: any = rt;
        let cur: any = rt;
        for (const key of probe.path) {
          if (cur === null || cur === undefined) return undefined;
          owner = cur;
          cur = cur[key];
        }
        return typeof cur === 'function' ? cur.bind(owner) : undefined;
      } catch {
        return undefined;
      }
    })();
    if (!fn) {
      // 方法缺席不在这里判死：presence 校验归 validateRuntime（hard/downgraded 会报），
      // 探针只负责「实现了的方法返回形状对不对」。
      out.push({ surface: probe.surface, status: 'skipped', detail: 'method not implemented', ms: 0 });
      continue;
    }
    try {
      const value = await Promise.race([
        Promise.resolve().then(() => (probe.args === undefined ? fn() : fn(probe.args))),
        new Promise((_, reject) => setTimeout(() => reject(Object.assign(new Error('timeout'), { __timeout: true })), timeoutMs)),
      ]);
      const problem = probe.shape(value);
      out.push({
        surface: probe.surface,
        status: problem ? 'error' : 'ok',
        ...(problem ? { detail: `bad shape: ${problem}` } : {}),
        ms: Date.now() - started,
      });
    } catch (err: any) {
      const timeout = err?.__timeout === true;
      out.push({
        surface: probe.surface,
        status: timeout ? 'skipped' : 'error',
        detail: timeout ? `timeout after ${timeoutMs}ms (external dependency unavailable)` : String(err?.message ?? err),
        ms: Date.now() - started,
      });
    }
  }

  return out;
}

// ─── 汇总 ──────────────────────────────────────────────────────────────────

export function auditPlugin(input: PluginAuditInput): PluginAuditReport {
  const capAudit = auditCapabilities(input.capabilities as Record<string, unknown> | undefined, input.contract, {
    preset: input.preset,
    runtimeValidation: input.runtimeValidation,
  });
  const findings: AuditFinding[] = [
    ...auditMappings(input.entry, input.contract),
    ...capAudit.findings,
  ];

  const rows = (input.entry.eventMappings ?? []) as EventMapping[];
  const samples = input.samples ? traceSamples(input.entry, input.samples) : [];

  return {
    ...(input.contract.contractVersion ? { contractVersion: input.contract.contractVersion } : {}),
    mappings: {
      total: rows.length,
      mapped: rows.filter((r) => r && typeof r === 'object' && r.to !== 'drop').length,
      drop: rows.filter((r) => r && typeof r === 'object' && r.to === 'drop').length,
    },
    findings,
    samples,
    capabilities: capAudit.surfaces,
    summary: {
      errors: findings.filter((f) => f.severity === 'error').length,
      warnings: findings.filter((f) => f.severity === 'warn').length,
      samplesOk: samples.filter((s) => s.outcome === 'ok').length,
      samplesBad: samples.filter((s) => s.outcome === 'bad-structure').length,
      samplesMissing: samples.filter((s) => s.outcome === 'no-output').length,
      probesBad: 0,
    },
  };
}
