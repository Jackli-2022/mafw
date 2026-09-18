/**
 * 事件边界遥测 —— 插件（及内置 runtime）未知事件类型的采集与告警。
 *
 * 已知集 = EVENT_FLOW_MATRIX keys（canonical 全集，测试保证与 SDK union 同步）
 *        ∪ 前缀族（plugin:* 命名空间 / session.next.* legacy 族）。
 * 全量启用（内置 runtime 也采集）依赖该已知集覆盖内置实际发射的全部类型。
 *
 * fail-open：record/查询任何异常不抛出（调用方在事件热路径上）。
 */
import { EVENT_FLOW_MATRIX } from './event-flow-matrix';

const KNOWN_PREFIXES = ['plugin:', 'session.next.'];

/** 矩阵 keys 的运行时拷贝（模块加载时构建一次）。 */
const MATRIX_KEYS: ReadonlySet<string> = new Set(Object.keys(EVENT_FLOW_MATRIX));

export function isKnownEventType(type: string | undefined): boolean {
  if (!type) return true; // 无 type 属于畸形事件范畴（isMalformedEvent 管），不算未知
  if (MATRIX_KEYS.has(type)) return true;
  return KNOWN_PREFIXES.some((p) => type.startsWith(p));
}

const MAX_TYPES_PER_SOURCE = 100;

/** per-source（runtime 名或 'api'）per-type 计数器；firstSeen 供调用方做限频 warn。 */
export class UnknownEventTracker {
  private counts = new Map<string, Map<string, number>>();

  record(source: string, type: string): { firstSeen: boolean; total: number } {
    let byType = this.counts.get(source);
    if (!byType) {
      byType = new Map();
      this.counts.set(source, byType);
    }
    if (!byType.has(type) && byType.size >= MAX_TYPES_PER_SOURCE) {
      return { firstSeen: false, total: 0 }; // 有界内存：超出后新类型静默不记
    }
    const total = (byType.get(type) || 0) + 1;
    byType.set(type, total);
    return { firstSeen: total === 1, total };
  }

  snapshot(): Record<string, Record<string, number>> {
    const out: Record<string, Record<string, number>> = {};
    for (const [source, byType] of this.counts) {
      out[source] = Object.fromEntries(byType);
    }
    return out;
  }

  reset(): void {
    this.counts.clear();
  }
}
