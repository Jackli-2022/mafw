/**
 * RuntimeDiagnostics —— 组合根 / Admin 的窄诊断视图。
 *
 * 业务核心只消费 RuntimeAccess（surface 门）与 Experience / View DTO；runtime
 * 名称与裸 capabilities 只允许出现在本视图、`GET /api/runtime` 等诊断出口与
 * 组合根接线处。任何业务组件都不得经 RuntimeFacade 回读这些字段。
 *
 * 视图对 `capabilities` / `activeDialect` 使用**实时 getter**：自适应方言探测
 * （resolveEventEntry）在 facade 创建之后才写回 raw runtime，快照式字段会让
 * `/api/runtime` 永远停在 v1/null（并由 runtime 热切换重建兜底其他字段）。
 */
import type { AgentRuntime, RuntimeCapabilities } from './contract';

export interface RuntimeDiagnosticsView {
  readonly name: string;
  /** 每次读取返回当前能力的浅拷贝（不泄漏可变对象给诊断消费方）。 */
  readonly capabilities: RuntimeCapabilities;
  /** 实时值：缺省（undefined）表示该 runtime 未声明/未探测出方言。 */
  readonly activeDialect?: string;
}

/** 组合根诊断视图：name 固定，capabilities/activeDialect 随 runtime 实时变化。 */
export function buildRuntimeDiagnostics(
  rt: (Pick<AgentRuntime, 'name' | 'capabilities'> & { activeDialect?: unknown }) | null | undefined,
): RuntimeDiagnosticsView | null {
  if (!rt) return null;
  return {
    name: rt.name,
    get capabilities(): RuntimeCapabilities {
      return { ...(rt.capabilities ?? ({} as RuntimeCapabilities)) };
    },
    get activeDialect(): string | undefined {
      const dialect = (rt as { activeDialect?: unknown }).activeDialect;
      return typeof dialect === 'string' && dialect ? dialect : undefined;
    },
  };
}
