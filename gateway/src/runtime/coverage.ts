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
 * 最终值非 null/undefined 即视为存在；函数天然存在。
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
  return value !== undefined && value !== null;
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
    if (status === 'present' || status === 'verified') {
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
    const covered = p.requiredSurfaces.filter((id) => {
      const st = surfaces[id]?.status;
      return st === 'present' || st === 'verified';
    }).length;
    presets[p.id] = { required, covered, missing: missingIds };
  }

  return {
    runtime: subject.rt.name,
    contractVersion: manifest.contractVersion,
    static: { declared, effective, presets, obligations, surfaces, missing, unverified, notes },
  };
}

export function applyBehaviorResults(coverage: RuntimeCoverage, results: BehaviorResult[]): RuntimeCoverage {
  const next: RuntimeCoverage = {
    ...coverage,
    static: {
      ...coverage.static,
      surfaces: { ...coverage.static.surfaces },
    },
    behavioral: {
      scenarioResults: coverage.behavioral?.scenarioResults ?? [],
      verified: [...(coverage.behavioral?.verified ?? [])],
      failed: [...(coverage.behavioral?.failed ?? [])],
      unverified: [...(coverage.behavioral?.unverified ?? [])],
    },
  };
  for (const r of results) {
    if (r.status === 'verified') next.behavioral!.verified.push(r.surfaceId);
    else next.behavioral!.failed.push(r.surfaceId);
  }
  return next;
}
