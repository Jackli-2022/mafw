/**
 * wrapDialectEventStream —— 方言感知的事件流接线（mapper → assembler）。
 *
 * 机制：
 *  - 首次接线保存 runtime 的原始 global.event（__mafwRawGlobalEvent）与接线
 *    参数（__mafwEventWiring）；每次（重）接线 = 恢复原始 → 按解析出的
 *    entry 重包 wrapGlobalEventStream + wrapToolPartAssembly——幂等，无
 *    双重包装。
 *  - 静态 entry 是 fail-safe（opencode 裸名 = @v1 表）；rt.resolveEventEntry
 *    存在（自适应 opencode，dialectProbe 模式）时经其解析覆盖（SSE peek
 *    探测，见 opencode-dialect-probe.ts）。
 *  - subscribeToEvents 每次（重）订阅调用本函数（无参重入复用存储参数）：
 *    serve 恢复后的重订阅即重探测时机（激活期 serve 未起，探测必然
 *    fail-safe 落 @v1，不阻塞启动）。
 *
 * 接线序列与激活路径（index.ts activatePluginRuntime / direct fallback）同款：
 * mapper wrap 必须在 assembler wrap 之前（assembler 消费映射后的 canonical 流）。
 */
import { wrapGlobalEventStream } from './event-mapper';
import { wrapToolPartAssembly } from './tool-part-assembler';
import type { EventMappingEntry, TranslationHooks } from './event-mapper';

type WiringHooks = TranslationHooks & { onNoMappings?: () => void };

interface StoredWiring {
  staticEntry: EventMappingEntry;
  isCanonical: (t: string) => boolean;
  hooks: WiringHooks;
}

/**
 * （重）接线 runtime 的全局事件流。
 * 首次调用必须携带 staticEntry/isCanonical/hooks；后续可无参调用（复用存储）。
 * 返回接线所用方言标签（activeDialect ?? 'static' ?? 'none'）。
 */
export async function wrapDialectEventStream(
  rt: any,
  staticEntry?: EventMappingEntry,
  isCanonical?: (t: string) => boolean,
  hooks?: WiringHooks,
): Promise<string> {
  if (!rt?.global || typeof rt.global.event !== 'function') return 'none';

  // 首次：保存原始 event 与接线参数
  if (!rt.__mafwRawGlobalEvent) {
    if (!staticEntry || !isCanonical) return 'none'; // 无参首调且无存储 = 无从接线
    rt.__mafwRawGlobalEvent = rt.global.event.bind(rt.global);
    rt.__mafwEventWiring = { staticEntry, isCanonical, hooks: hooks ?? {} } satisfies StoredWiring;
  } else if (staticEntry && isCanonical) {
    // 显式带参重入：更新存储（激活点带参、订阅点无参）
    rt.__mafwEventWiring = { staticEntry, isCanonical, hooks: hooks ?? (rt.__mafwEventWiring?.hooks ?? {}) } satisfies StoredWiring;
  }
  const wiring: StoredWiring | undefined = rt.__mafwEventWiring;
  const raw = rt.__mafwRawGlobalEvent;
  if (!wiring || !raw) return 'none';

  // 方言解析：resolveEventEntry（自适应）→ 静态 fail-safe；解析抛错回退静态
  let entry: EventMappingEntry = wiring.staticEntry;
  if (typeof rt.resolveEventEntry === 'function') {
    try {
      const resolved = await rt.resolveEventEntry();
      if (resolved && Array.isArray((resolved as any).eventMappings)) entry = resolved;
    } catch {
      // fail-safe：探测失败保持静态 entry（@v1）
    }
  }

  // 恢复原始 → 重包（幂等：从 raw 重建，无叠加包装）
  rt.global.event = raw;
  wrapGlobalEventStream(rt, entry, wiring.isCanonical, wiring.hooks);
  wrapToolPartAssembly(rt);
  rt.__mafwActiveEntry = entry;

  const label = typeof rt.activeDialect === 'string' ? rt.activeDialect : 'static';
  return label;
}
