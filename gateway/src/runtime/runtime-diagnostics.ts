/**
 * RuntimeDiagnostics —— 组合根 / Admin 的窄诊断视图。
 *
 * 业务核心只消费 RuntimeAccess（surface 门）与 Experience / View DTO；runtime
 * 名称与裸 capabilities 只允许出现在本视图、`GET /api/runtime` 等诊断出口与
 * 组合根接线处。任何业务组件都不得经 RuntimeFacade 回读这些字段。
 */
import type { AgentRuntime, RuntimeCapabilities } from './contract';

export interface RuntimeDiagnosticsView {
  name: string;
  capabilities: RuntimeCapabilities;
  activeDialect?: string;
}

/**
 * 生成快照（capabilities 为浅拷贝）：调用方持有的视图不会随后续能力降级
 * 悄悄变形，诊断出口与覆盖矩阵各自读到稳定值。
 */
export function buildRuntimeDiagnostics(
  rt: (Pick<AgentRuntime, 'name' | 'capabilities'> & { activeDialect?: unknown }) | null | undefined,
): RuntimeDiagnosticsView | null {
  if (!rt) return null;
  const dialect = (rt as { activeDialect?: unknown }).activeDialect;
  return {
    name: rt.name,
    capabilities: { ...(rt.capabilities ?? ({} as RuntimeCapabilities)) },
    ...(typeof dialect === 'string' && dialect ? { activeDialect: dialect } : {}),
  };
}
