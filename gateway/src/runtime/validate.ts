/**
 * runtime 插件返回值"声明 vs 实现"一致性校验（清单驱动）。
 *
 * hard       — required 面缺失（条件由 requiredWhen 决定）→ 调用方回退内置 runtime
 * downgraded — gated 面缺失且该面在 capability.requires 中 → 能力位降级
 * warnings   — 非阻断缺口（session.update / permissionList / healthCheck / 信任声明）
 *
 * 清单源：contract-manifest.ts；覆盖计算：coverage.ts。
 */
import type { AgentRuntime, RuntimeCapabilities } from './contract';
import { buildRuntimeContractManifest } from './contract-manifest';
import { CONTRACT_CAPABILITIES } from './contract-capabilities';
import type { ContractSurface } from './contract-manifest-types';
import { computeCoverage, type ContractSubject, type RuntimeCoverage } from './coverage';

export interface RuntimeValidation {
  hard: string[];
  downgraded: string[];
  warnings: string[];
  staticCoverage?: RuntimeCoverage;
}

const MANIFEST = buildRuntimeContractManifest();
const CAP_BY_ID = new Map(CONTRACT_CAPABILITIES.map((c) => [c.id, c]));
const SESSION_CORE_IDS = new Set(CAP_BY_ID.get('sessionApi')!.requires);
const WARN_ON_MISSING = new Set([
  'session.update',
  'process.healthCheck',
  'process.getBaseUrl',
]);

function isObject(v: unknown): v is Record<string, any> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function requiredWhenSatisfied(surface: ContractSurface, caps: RuntimeCapabilities): boolean {
  if (!surface.requiredWhen) return true;
  return surface.requiredWhen.capabilities.every((c) => !!(caps as any)[c]);
}

function hardMessage(source: string, surface: ContractSurface): string {
  if (surface.id === 'events.global') {
    return `${source}: declares eventStream but global.event is missing — events.global is required when eventStream is true`;
  }
  if (surface.id === 'tools.registerTools') {
    return `${source}: tools.registerTools is missing (not a function) — MAFW basic tools have no path to your agents (Tier-0 required)`;
  }
  if (surface.id === 'tools.nativeTools') {
    return `${source}: tools.nativeTools is missing (not a function; returning [] is valid) — tool classification falls back to the static union table`;
  }
  if (surface.id.startsWith('session.')) {
    return `${source}: declares sessionApi but ${surface.id} is missing (not a function)`;
  }
  if (surface.id === 'provider.list') {
    return `${source}: declares providerConfigApi but provider.list is missing (not a function)`;
  }
  if (surface.id === 'provider.app.agents') {
    return `${source}: declares providerConfigApi but app.agents is missing (not a function)`;
  }
  if (surface.id === 'provider.config.update') {
    return `${source}: declares providerConfigApi but config.update is missing (not a function)`;
  }
  return `${source}: required surface ${surface.id} is missing — ${surface.impact}`;
}

export function validateRuntime(
  rt: AgentRuntime,
  source: string,
  subjectOpts?: Omit<ContractSubject, 'rt'>,
): RuntimeValidation {
  const out: RuntimeValidation = { hard: [], downgraded: [], warnings: [] };

  if (!isObject(rt)) {
    out.hard.push(`${source}: runtime must be an object (got ${typeof rt})`);
    return out;
  }
  if (typeof (rt as any).name !== 'string' || !(rt as any).name) {
    out.hard.push(`${source}: runtime.name must be a non-empty string (got ${typeof (rt as any).name})`);
  }
  const caps = (rt as any).capabilities as RuntimeCapabilities;
  if (!isObject(caps)) {
    out.hard.push(`${source}: runtime.capabilities must be an object (got ${typeof caps})`);
    return out;
  }

  const subject: ContractSubject = {
    rt,
    ...subjectOpts,
    plugin: subjectOpts?.plugin ?? {
      name: (rt as any).name,
      createRuntime: () => {},
      external: !!(rt as any).external,
      capabilities: caps,
    },
    source: subjectOpts?.source ?? 'active',
  };
  const coverage = computeCoverage(subject, MANIFEST);

  // 旧语义保留：sessionApi 声明为 true 但整个 session 缺失 → 单条 hard，
  // 不再逐方法刷 11 条。
  const sessionMissing = !!caps.sessionApi && !isObject((rt as any).session);
  if (sessionMissing) {
    out.hard.push(`${source}: declares sessionApi but session is missing`);
  }

  if (caps.turnBudgetApi) {
    out.warnings.push(
      `${source}: declares turnBudgetApi — trusting the runtime to enforce maxTurns/maxCostUsd natively; ` +
      `gateway BudgetGuard will NOT be attached (a false claim silently disables goal budgets)`,
    );
  }

  let downgradedAny = false;
  const effectiveCaps: RuntimeCapabilities = { ...caps };

  for (const surface of MANIFEST.surfaces) {
    if (sessionMissing && SESSION_CORE_IDS.has(surface.id)) continue;
    if (!caps.sessionApi && SESSION_CORE_IDS.has(surface.id)) continue;

    const status = coverage.static.surfaces[surface.id]?.status;

    if (surface.verification !== 'presence') {
      continue; // behavior/conformance/attested：激活期不探针
    }

    if (surface.obligation === 'required') {
      if (!requiredWhenSatisfied(surface, caps)) continue;
      if (status !== 'present') out.hard.push(hardMessage(source, surface));
      continue;
    }

    if (surface.obligation === 'gated') {
      if (!surface.capability) continue;
      const capKey = surface.capability as keyof RuntimeCapabilities;
      if (!caps[capKey]) continue;
      if (status === 'present') continue;
      const requires = CAP_BY_ID.get(surface.capability)?.requires ?? [];
      if (requires.includes(surface.id)) {
        if (effectiveCaps[capKey]) {
          effectiveCaps[capKey] = false;
          downgradedAny = true;
          out.downgraded.push(
            `${source}: declares ${surface.capability} but ${surface.id} is missing — capability downgraded to false (${surface.impact})`,
          );
        }
      } else {
        out.warnings.push(`${source}: ${surface.id} is missing — ${surface.impact}`);
      }
      continue;
    }

    // optional / advisory：只对旧语义里需要提示的面发 warning；其余进覆盖率。
    if (status !== 'present' && WARN_ON_MISSING.has(surface.id)) {
      out.warnings.push(`${source}: ${surface.id} is missing — ${surface.impact}`);
    }
  }

  if (downgradedAny) {
    (rt as any).capabilities = effectiveCaps;
    coverage.static.effective = { ...effectiveCaps };
  }

  out.staticCoverage = coverage;
  return out;
}
