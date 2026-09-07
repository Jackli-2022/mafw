import { config } from "../../config";
import { ToolHandler } from "../../types";

export const handlePinMemory: ToolHandler = async (args, { memory, mafwDir }) => {
  try {
    const id = String(args.id || '');
    const hasPinned = typeof args.pinned === 'boolean';
    const hasSticky = typeof args.sticky === 'boolean';

    if (!id) {
      return { content: [{ type: "text", text: JSON.stringify({ success: false, error: 'id required' }) }], isError: true };
    }
    if (!hasPinned && !hasSticky) {
      return { content: [{ type: "text", text: JSON.stringify({ success: false, error: 'pinned or sticky required' }) }], isError: true };
    }

    const resolvedDir = mafwDir ?? config.resolvePath();

    const { HarmonicUnitFileStore } = await import("../../memory/harmonic-file-store.js");
    const sharedIndex = (memory as any)?.harmonicIndex;
    const sharedGraph = (memory as any)?.harmonicIndex?.getAnchorGraphStore?.()
      ?? (memory as any)?.getAnchorGraphStore?.() ?? undefined;
    const store = sharedIndex
      ? new HarmonicUnitFileStore(resolvedDir, sharedIndex, sharedGraph)
      : new HarmonicUnitFileStore(resolvedDir, undefined, sharedGraph);

    const result: Record<string, unknown> = { success: true, id };

    if (hasPinned) {
      const pinned = args.pinned === true;
      const ok = store.setPinned(id, pinned);
      if (!ok) {
        return { content: [{ type: "text", text: JSON.stringify({ success: false, error: `memory not found: ${id}` }) }], isError: true };
      }
      result.pinned = pinned;
    }

    if (hasSticky) {
      // sticky: true sticks/renews the note-board TTL (default 7 days,
      // stickyDays overrides); sticky: false removes the note from the board.
      // Board membership expires — the memory itself is never touched.
      const stickyDays = typeof args.stickyDays === 'number' && args.stickyDays > 0 ? args.stickyDays : 7;
      const until = args.sticky === true ? new Date(Date.now() + stickyDays * 86400e3).toISOString() : null;
      const ok = store.setSticky(id, until);
      if (!ok) {
        return { content: [{ type: "text", text: JSON.stringify({ success: false, error: `memory not found: ${id}` }) }], isError: true };
      }
      result.sticky = args.sticky === true;
      if (until) result.sticky_until = until;
    }

    return { content: [{ type: "text", text: JSON.stringify(result) }] };
  } catch (err: any) {
    return { content: [{ type: "text", text: JSON.stringify({ success: false, error: err.message }) }], isError: true };
  }
};
