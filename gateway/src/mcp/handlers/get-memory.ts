import { config } from "../../config";
import { ToolHandler } from "../../types";
import { HarmonicUnit } from "../../core/memory/harmonic-types";

/**
 * Resolve a memory by full id or by the 6-char pointer tail shown in <recall>
 * blocks (#mem-xxxxxx). Ambiguous tails return a candidate list instead of
 * guessing. Superseded memories report the supersede chain with the latest
 * version attached so the agent never acts on stale notes.
 */
export const handleGetMemory: ToolHandler = async (args, { memory, mafwDir }) => {
  try {
    const id = String(args.id || '').trim().replace(/^#?mem-/, '');
    if (!id) {
      return { content: [{ type: "text", text: JSON.stringify({ success: false, error: 'id required' }) }], isError: true };
    }

    const resolvedDir = mafwDir ?? config.resolvePath();
    const { HarmonicUnitFileStore } = await import("../../memory/harmonic-file-store.js");
    const sharedIndex = (memory as any)?.harmonicIndex;
    const sharedGraph = (memory as any)?.harmonicIndex?.getAnchorGraphStore?.()
      ?? (memory as any)?.getAnchorGraphStore?.() ?? undefined;
    const store = sharedIndex
      ? new HarmonicUnitFileStore(resolvedDir, sharedIndex, sharedGraph)
      : new HarmonicUnitFileStore(resolvedDir, undefined, sharedGraph);

    const entries = store.indexManager_().getIndex().entries;
    let target = entries.find(e => e.id === id) ?? null;
    if (!target) {
      const matches = entries.filter(e => e.id.endsWith(id));
      if (matches.length > 1) {
        return { content: [{ type: "text", text: JSON.stringify({
          success: false,
          error: `ambiguous id tail "${id}" — use the full id`,
          candidates: matches.map(m => m.id),
        }) }], isError: true };
      }
      target = matches[0] ?? null;
    }
    if (!target) {
      return { content: [{ type: "text", text: JSON.stringify({ success: false, error: `memory not found: ${id}` }) }], isError: true };
    }

    const unit = await store.read(target.id);
    if (!unit) {
      return { content: [{ type: "text", text: JSON.stringify({ success: false, error: `memory file missing: ${target.id}` }) }], isError: true };
    }

    // Follow the supersede chain to the latest version (bounded loop).
    let latest: HarmonicUnit | null = null;
    let cursor: HarmonicUnit = unit;
    const seen = new Set<string>([cursor.id]);
    while (cursor.superseded_by && !seen.has(cursor.superseded_by)) {
      seen.add(cursor.superseded_by);
      const next: HarmonicUnit | null = await store.read(cursor.superseded_by);
      if (!next) break;
      cursor = next;
      latest = next;
    }

    return { content: [{ type: "text", text: JSON.stringify({
      success: true,
      memory: unit,
      ...(latest ? { latest } : {}),
    }) }] };
  } catch (err: any) {
    return { content: [{ type: "text", text: JSON.stringify({ success: false, error: err.message }) }], isError: true };
  }
};
