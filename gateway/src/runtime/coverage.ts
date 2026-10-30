/**
 * 覆盖引擎：ContractSubject -> RuntimeCoverage。
 *
 * 静态覆盖只做 presence/declaration 探针，永不调用 runtime 的 LLM 路径；
 * 行为覆盖由 plugin-check/conformance 通过 applyBehaviorResults 注入。
 */
import type { AgentRuntime } from './contract';
import type { EventMappingEntry } from './event-mapper';
import type {
  ContractDomain,
  ContractObligation,
  ContractSurface,
  PresetId,
  RuntimeContractManifest,
  SurfaceStatus,
  Verification,
} from './contract-manifest-types';

export interface ContractSubject {
  rt: AgentRuntime;
  /** loader 文件插件 meta / builtin extras / package entry；opencode 为 resolveEventEntry() 结果。 */
  declaration?: EventMappingEntry;
  /** loader 级插件元数据（meta.plugin 面用）。 */
  plugin?: { name?: string; createRuntime?: Function; external?: boolean; capabilities?: unknown };
  /** 当前方言（opencode 自适应探测结果；其他 runtime 缺省）。 */
  dialect?: string;
  source: 'file' | 'builtin' | 'package' | 'active';
}

export interface BehaviorResult {
  surfaceId: string;
  status: 'verified' | 'failed';
  detail?: string;
}

export interface RuntimeCoverage {
  runtime: string;
  contractVersion: string;
  /** 静态覆盖：始终计算，不调 runtime。 */
  static: {
    declared: Record<string, boolean>;
    effective: Record<string, boolean>;
    presets: Record<PresetId, {
      required: number;
      covered: number;
      missing: string[];
    }>;
    obligations: Record<ContractObligation, {
      total: number;
      present: number;
      unverified: number;
      missing: string[];
    }>;
    surfaces: Record<string, {
      status: SurfaceStatus;
      verification: Verification;
      impact: string;
    }>;
    missing: Array<{
      id: string;
      domain: ContractDomain;
      obligation: ContractObligation;
      verification: Verification;
      impact: string;
    }>;
    unverified: Array<{ id: string; reason: string }>;
    notes: string[];
  };
  /** 行为覆盖：仅在 plugin-check / conformance 运行后存在。 */
  behavioral?: {
    scenarioResults: Array<{ id: string; pass: boolean; failures: string[] }>;
    verified: string[];
    failed: string[];
    unverified: string[];
    details: Record<string, string>;
  };
}

function getPath(root: any, path: string[]): any {
  let cur = root;
  for (const key of path) {
    if (cur === null || cur === undefined) return undefined;
    cur = cur[key];
  }
  return cur;
}

/**
 * presence 探针。第一段决定探针主体：
 *   rt（缺省）/ declaration / plugin
 * declaration/plugin 是数据面：非 null/undefined 即存在；
 * rt 是方法面：最终值必须是函数（容器/布尔值不算实现）。
 */
export function probePasses(subject: ContractSubject, surface: ContractSurface): boolean {
  const path = surface.probe;
  if (!path || path.length === 0) return false;

  let root: any;
  let rest: string[];
  const [head, ...tail] = path;
  if (head === 'declaration') {
    root = subject.declaration;
    rest = tail;
  } else if (head === 'plugin') {
    root = subject.plugin;
    rest = tail;
  } else if (head === 'rt') {
    root = subject.rt;
    rest = tail;
  } else {
    root = subject.rt;
    rest = path;
  }

  const value = rest.length === 0 ? root : getPath(root, rest);
  // declaration/plugin 是数据面，任意非空值即可；rt 是方法面，必须是函数。
  // 这条规则防止 `{ question: {} }` / `update: true` 这类容器/值被误判为 present。
  if (head === 'declaration' || head === 'plugin') {
    return value !== undefined && value !== null;
  }
  return typeof value === 'function';
}

export function computeCoverage(subject: ContractSubject, manifest: RuntimeContractManifest): RuntimeCoverage {
  const declared = { ...(subject.rt.capabilities as unknown as Record<string, boolean>) };
  const effective = { ...declared };
  const surfaces: RuntimeCoverage['static']['surfaces'] = {};
  const missing: RuntimeCoverage['static']['missing'] = [];
  const unverified: RuntimeCoverage['static']['unverified'] = [];
  const notes: string[] = [];

  const emptyObligation = () => ({ total: 0, present: 0, unverified: 0, missing: [] as string[] });
  const obligations: RuntimeCoverage['static']['obligations'] = {
    required: emptyObligation(),
    gated: emptyObligation(),
    optional: emptyObligation(),
    advisory: emptyObligation(),
  };

  for (const s of manifest.surfaces) {
    let status: SurfaceStatus;
    if (s.verification !== 'presence') {
      status = 'unverified';
      const reason = s.verification === 'attested'
        ? 'attested'
        : s.domain === 'cognition'
          ? 'cognition'
          : `${s.verification}-not-run`;
      unverified.push({ id: s.id, reason });
    } else if (s.obligation === 'gated' && s.capability && !declared[s.capability]) {
      status = 'missing';
      notes.push(`capability '${s.capability}' is false; ${s.id} unavailable`);
    } else if (probePasses(subject, s)) {
      status = 'present';
    } else {
      status = 'missing';
    }

    surfaces[s.id] = { status, verification: s.verification, impact: s.impact };
    const o = obligations[s.obligation];
    o.total += 1;
    if (status === 'present') {
      o.present += 1;
    } else if (status === 'unverified') {
      o.unverified += 1;
    } else {
      o.missing.push(s.id);
      missing.push({
        id: s.id,
        domain: s.domain,
        obligation: s.obligation,
        verification: s.verification,
        impact: s.impact,
      });
    }
  }

  const presets = {} as RuntimeCoverage['static']['presets'];
  for (const p of manifest.presets) {
    const required = p.requiredSurfaces.length;
    const missingIds = p.requiredSurfaces.filter((id) => surfaces[id]?.status === 'missing');
    const covered = p.requiredSurfaces.filter((id) => surfaces[id]?.status === 'present').length;
    presets[p.id] = { required, covered, missing: missingIds };
  }

  return {
    runtime: subject.rt.name,
    contractVersion: manifest.contractVersion,
    static: { declared, effective, presets, obligations, surfaces, missing, unverified, notes },
  };
}

/**
 * 包贡献 runtime 的声明兜底：eventStream=true 但没有 eventMappings/transformEvent
 * 时先降级 capability，再计算 coverage——否则 coverage.effective 会与
 * active.capabilities 自相矛盾。
 */
export function applyEventStreamDeclarationDowngrade(rt: AgentRuntime, hasDeclarations: boolean): boolean {
  if ((rt.capabilities as any)?.eventStream && !hasDeclarations) {
    (rt.capabilities as any).eventStream = false;
    return true;
  }
  return false;
}

export function applyBehaviorResults(coverage: RuntimeCoverage, results: BehaviorResult[]): RuntimeCoverage {
  const verified = new Set(coverage.behavioral?.verified ?? []);
  const failed = new Set(coverage.behavioral?.failed ?? []);
  const details: Record<string, string> = { ...(coverage.behavioral?.details ?? {}) };

  for (const r of results) {
    (r.status === 'verified' ? verified : failed).add(r.surfaceId);
    if (r.detail) details[r.surfaceId] = r.detail;
  }

  const touched = new Set([...verified, ...failed]);
  const unverified = Object.entries(coverage.static.surfaces)
    .filter(([, v]) => v.verification === 'behavior' || v.verification === 'conformance')
    .map(([id]) => id)
    .filter((id) => !touched.has(id));

  return {
    ...coverage,
    static: {
      ...coverage.static,
      surfaces: { ...coverage.static.surfaces },
    },
    behavioral: {
      scenarioResults: coverage.behavioral?.scenarioResults ?? [],
      verified: [...verified],
      failed: [...failed],
      unverified,
      details,
    },
  };
}
