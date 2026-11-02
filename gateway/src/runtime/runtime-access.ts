/**
 * RuntimeAccess —— gateway 业务侧唯一的 surface 能力/语义门。
 *
 * 只读取 AgentRuntime 的 canonical 声明、effective capabilities 和 presence
 * probes，不处理 runtime 名称、原生事件或 SDK 类型。错误消息保持中性，
 * 避免业务路由把 runtime 身份泄漏给客户端。
 */
import type { AgentRuntime } from './contract';
import { buildRuntimeContractManifest } from './contract-manifest';
import type { ContractSurface, RuntimeContractManifest } from './contract-manifest-types';
import { probePasses, type ContractSubject } from './coverage';

/**
 * 缺 surface 时的 HTTP 错误文案单一来源：中性、只含 surface id。
 * 业务路由不得把 runtime 名 / capability flag 拼进 503。
 */
export function surfaceUnavailableMessage(surface: string): string {
  return `runtime does not support ${surface}`;
}

export class RuntimeSurfaceError extends Error {
  readonly code = 'runtime.surface.unavailable' as const;
  readonly surface: string;

  constructor(surface: string, reason: string) {
    super(`runtime surface '${surface}' is not available: ${reason}`);
    this.name = 'RuntimeSurfaceError';
    this.surface = surface;
  }
}

const runtimeRefs = new WeakMap<RuntimeAccess, AgentRuntime>();

export class RuntimeAccess {
  private readonly byId: Map<string, ContractSurface>;
  private readonly subject: ContractSubject;

  constructor(
    rt: AgentRuntime,
    manifest: RuntimeContractManifest = buildRuntimeContractManifest(),
  ) {
    runtimeRefs.set(this, rt);
    this.byId = new Map(manifest.surfaces.map((s) => [s.id, s]));
    this.subject = { rt, source: 'active' };
  }

  can(surfaceId: string): boolean {
    const surface = this.byId.get(surfaceId);
    if (!surface) throw new RuntimeSurfaceError(surfaceId, 'unknown surface');
    const caps = (runtimeRefs.get(this)!.capabilities ?? {}) as unknown as Record<string, unknown>;
    if (surface.capability && !caps[surface.capability]) {
      return false;
    }
    if (surface.verification === 'presence') {
      return probePasses(this.subject, surface);
    }
    // behavior/conformance/attested 没有 presence 证据：只有显式 capability
    // 才允许尝试；未验证不等于可用。
    return !!surface.capability && !!caps[surface.capability];
  }

  requireSurface(surfaceId: string): void {
    if (!this.can(surfaceId)) {
      throw new RuntimeSurfaceError(surfaceId, 'capability or implementation missing');
    }
  }

  semantics<T = Record<string, unknown>>(surfaceId: string): T {
    const surface = this.byId.get(surfaceId);
    const raw = { ...((runtimeRefs.get(this)!.semantics?.[surfaceId] ?? {}) as Record<string, unknown>) };
    // 激活期按 manifest 的允许值过滤；adapter 写错值不得进入前端。
    for (const [key, value] of Object.entries(raw)) {
      const allowed = surface?.semantics?.[key]?.values;
      if (allowed && !allowed.includes(String(value))) delete raw[key];
    }
    return raw as T;
  }
}
