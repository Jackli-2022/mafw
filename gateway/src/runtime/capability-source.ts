/**
 * 能力来源解析 —— 「能力声明 ↔ 实例实现」的唯一判定源。
 *
 * 两份声明问题（spec 2026-10-31-runtime-plugin-ergonomics-design §4.3）：
 *   - 唯一声明点 = module.exports.capabilities；实例自带 capabilities 只作为
 *     一致性对照，不一致 → 以模块声明为准 + 返回 mismatch 描述（调用方 log.error）。
 *   - 反向校验：实例实现了某能力的 presence 面但没声明 → 自动补 true + 警告
 *     （「实现了就让它生效」；行为型能力没有 presence 面，保持声明即信）。
 *
 * 盖印必须是普通可写赋值：激活期降级路径（coverage/validate）要继续能改写。
 */
import { minimalCapabilities, type RuntimeCapabilities } from './contract';
import { buildRuntimeContractManifest } from './contract-manifest';
import { probePasses, type ContractSubject } from './coverage';

const MANIFEST = buildRuntimeContractManifest();

export function resolveDeclaredCapabilities(moduleCaps?: Partial<RuntimeCapabilities>): RuntimeCapabilities {
  return { ...minimalCapabilities(), ...(moduleCaps ?? {}) };
}

export function stampDeclaredCapabilities(
  rt: { capabilities?: unknown },
  declared: RuntimeCapabilities,
): string | null {
  const instance = rt.capabilities;
  const differing: string[] = [];
  if (instance && typeof instance === 'object') {
    const inst = instance as Record<string, unknown>;
    for (const key of Object.keys(declared) as Array<keyof RuntimeCapabilities>) {
      if (key in inst && inst[key] !== declared[key]) differing.push(String(key));
    }
  }
  rt.capabilities = { ...declared };
  return differing.length > 0
    ? `declared capabilities differ from instance on: ${differing.join(', ')} — module declaration wins`
    : null;
}

export function deriveUndeclaredCapabilities(
  subject: ContractSubject,
  caps: RuntimeCapabilities,
): { caps: RuntimeCapabilities; warnings: string[] } {
  const next: RuntimeCapabilities = { ...caps };
  const warnings: string[] = [];

  for (const capability of MANIFEST.capabilities) {
    const key = capability.id as keyof RuntimeCapabilities;
    if (next[key]) continue;
    const faces = MANIFEST.surfaces.filter(
      (s) => s.capability === capability.id && s.verification === 'presence',
    );
    if (faces.length === 0) continue;
    if (!faces.every((s) => probePasses(subject, s))) continue;
    (next as any)[key] = true;
    warnings.push(
      `${capability.id} is implemented (${faces.map((s) => s.id).join(', ')}) but not declared — ` +
      'auto-enabled; declare it in module.exports.capabilities',
    );
  }

  return { caps: next, warnings };
}
