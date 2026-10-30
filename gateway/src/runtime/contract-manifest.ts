/**
 * Runtime 契约覆盖矩阵 —— 唯一事实源。
 *
 * 本文件只做数据装配与结构不变量校验；覆盖计算在 coverage.ts，
 * 校验投影在 validate.ts，JSON 产物由 scripts/emit-runtime-contract.ts 生成。
 */
import type { RuntimeContractManifest } from './contract-manifest-types';
import { CORE_SURFACES } from './contract-surfaces-core';
import { AGENT_SURFACES } from './contract-surfaces-agent';

export const SCHEMA_VERSION = 1 as const;
export const CONTRACT_VERSION = '2026.10.0';

export function buildRuntimeContractManifest(): RuntimeContractManifest {
  return {
    schemaVersion: SCHEMA_VERSION,
    contractVersion: CONTRACT_VERSION,
    generatedFrom: 'gateway/src/runtime/contract-manifest.ts',
    domains: [],
    surfaces: [...CORE_SURFACES, ...AGENT_SURFACES],
    capabilities: [],
    events: [],
    cognition: [],
    presets: [],
  };
}

/**
 * 结构不变量（不检查“是否覆盖全部能力”——那是 Task 4 的完整性测试）。
 * 返回空数组 = 合法。
 */
export function validateManifest(m: RuntimeContractManifest): string[] {
  const errors: string[] = [];

  const surfaceIds = new Set<string>();
  for (const s of m.surfaces) {
    if (surfaceIds.has(s.id)) errors.push(`duplicate surface id: ${s.id}`);
    surfaceIds.add(s.id);

    if (s.obligation === 'gated' && !s.capability) {
      errors.push(`gated surface ${s.id} requires a capability`);
    }
    if (s.requiredWhen && s.obligation !== 'required') {
      errors.push(`requiredWhen is only valid on required surfaces (${s.id})`);
    }
    if (s.verification === 'presence' && !s.probe?.length) {
      errors.push(`presence surface ${s.id} requires a probe`);
    }
    if (s.verification === 'behavior' && !s.behavior) {
      errors.push(`behavior surface ${s.id} requires a behavior id`);
    }
    if (s.verification === 'conformance' && !s.conformance?.length) {
      errors.push(`conformance surface ${s.id} requires a conformance scenario`);
    }
    if (s.verification === 'attested' && s.probe?.length) {
      errors.push(`attested surface ${s.id} must not declare a probe`);
    }
  }

  const domainIds = new Set<string>();
  for (const d of m.domains) {
    if (domainIds.has(d.id)) errors.push(`duplicate domain id: ${d.id}`);
    domainIds.add(d.id);
  }

  const capabilityIds = new Set<string>();
  for (const c of m.capabilities) {
    if (capabilityIds.has(c.id)) errors.push(`duplicate capability id: ${c.id}`);
    capabilityIds.add(c.id);
    for (const id of [...c.requires, ...c.unlocks]) {
      if (!surfaceIds.has(id)) errors.push(`unknown surface ${id} in capability ${c.id}`);
    }
  }

  const eventTypes = new Set<string>();
  for (const e of m.events) {
    if (eventTypes.has(e.type)) errors.push(`duplicate event type: ${e.type}`);
    eventTypes.add(e.type);
  }

  const cognitionIds = new Set<string>();
  for (const v of m.cognition) {
    if (cognitionIds.has(v.id)) errors.push(`duplicate cognition verb: ${v.id}`);
    cognitionIds.add(v.id);
  }

  const presetIds = new Set<string>();
  for (const p of m.presets) {
    if (presetIds.has(p.id)) errors.push(`duplicate preset id: ${p.id}`);
    presetIds.add(p.id);
    for (const id of p.requiredSurfaces) {
      if (!surfaceIds.has(id)) errors.push(`unknown surface ${id} in preset ${p.id}`);
    }
    for (const id of p.capabilities) {
      if (!capabilityIds.has(id)) errors.push(`unknown capability ${id} in preset ${p.id}`);
    }
  }

  // surface.presets 是 preset.requiredSurfaces 的派生反向索引，必须双向一致。
  for (const s of m.surfaces) {
    const expected = m.presets
      .filter((p) => p.requiredSurfaces.includes(s.id))
      .map((p) => p.id)
      .sort();
    const actual = [...(s.presets ?? [])].sort();
    if (expected.join('|') !== actual.join('|')) {
      errors.push(`surface ${s.id} presets mismatch (expected [${expected.join(', ')}], got [${actual.join(', ')}])`);
    }
  }

  return errors;
}
