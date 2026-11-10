import { config } from "../../config";
import { ToolHandler } from "../../types";
import { HarmonicUnit } from "../../core/memory/harmonic-types";
import { reconstructSource } from "../../recall/source-reconstruction";

/**
 * Resolve a memory by full id or by the 6-char pointer tail shown in <recall>
 * blocks (#mem-xxxxxx). Ambiguous tails return a candidate list instead of
 * guessing. Superseded memories report the supersede chain with the latest
 * version attached so the agent never acts on stale notes.
 */
export const handleGetMemory: ToolHandler = async (args, { memory, mafwDir, searchArchive, resolveT1, readTrace, recordT1Retrieval }) => {
  try {
    // V1: t1 pointer redemption — ids of the form `t1:<sessionTail>:<turnId>`
    // resolve to raw archived round rows (verbatim layer).
    const rawId = String(args?.id || '').trim();
    if (/^#?t1:[^:]+:\d+$/.test(rawId)) {
      const body = rawId.replace(/^#/, '');
      const [, tail, turnStr] = body.split(':');
      const turnId = Number(turnStr);
      if (!resolveT1) {
        return { content: [{ type: "text", text: JSON.stringify({ success: false, error: 't1 pointer resolution unavailable (gateway service missing)' }) }], isError: true };
      }
      const rows = resolveT1(tail, turnId);
      if (!rows.length) {
        return { content: [{ type: "text", text: JSON.stringify({ success: false, error: `no t1 rows for session tail ${tail} turn ${turnId}` }) }], isError: true };
      }
      const traceId = rows[0].trace_id ?? undefined;
      if (traceId) recordT1Retrieval?.(traceId, 'redeem');
      const t1Payload = {
        success: true,
        t1: {
          sessionId: rows[0].session_id,
          turnId,
          ...(traceId ? { traceId } : {}),
          rows: rows.map(r => ({ source: r.source, content: r.content })),
        },
      };
      return { content: [{ type: "text", text: JSON.stringify(t1Payload) }], structuredContent: t1Payload };
    }

    // V2: permanent trace pointer `t1:<traceId>` resolves active+archived rows
    // by identity, independent of the legacy session-tail pointer above.
    const traceMatch = rawId.replace(/^#/, '').match(/^t1:([^:]+)$/);
    if (traceMatch) {
      const traceId = traceMatch[1];
      if (!readTrace) {
        return { content: [{ type: "text", text: JSON.stringify({ success: false, error: 't1 trace resolution unavailable (gateway service missing)' }) }], isError: true };
      }
      const trace = readTrace(traceId);
      if (!trace) {
        return { content: [{ type: "text", text: JSON.stringify({ success: false, error: `no t1 rows for trace ${traceId}` }) }], isError: true };
      }
      recordT1Retrieval?.(traceId, 'redeem');
      const t1Payload = {
        success: true,
        t1: {
          traceId,
          sessionId: trace.turn.session_id,
          turnId: trace.turn.turn_seq,
          archived: trace.archived,
          legacyAmbiguous: trace.turn.legacy_ambiguous === 1,
          rows: trace.rows.map(r => ({
            source: r.source,
            content: r.content,
            ...(r.observation_key ? { observationKey: r.observation_key } : {}),
          })),
        },
      };
      return { content: [{ type: "text", text: JSON.stringify(t1Payload) }], structuredContent: t1Payload };
    }

    const id = String(args.id || '').trim().replace(/^#?(?:mem-)?/, '');
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

    // A4 hit-proxy: a redemption is "the injected pointer was actually used"
    // evidence — the calibration join (recall/fok-samples.ts) matches it
    // against recent injections. Fail-open.
    try {
      const { appendFokEvent } = await import("../../recall/fok-samples.js");
      appendFokEvent({ e: 'rdm', ts: Date.now(), id: target.id });
    } catch { /* fail-open */ }

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

    // Exact T1 provenance: source_trace_ids captured at write time win over
    // C0 session search; unresolvable ids fall back to C0 below.
    let source: {
      sessionId: string;
      evidence?: string;
      traces?: Array<{ traceId: string; sessionId: string; turnId: number; archived: boolean; excerpt: string }>;
    } | undefined;
    const exactIds = Array.isArray((unit as any).source_trace_ids)
      ? ((unit as any).source_trace_ids as unknown[])
          .filter((x): x is string => typeof x === 'string' && Boolean(x.trim()))
          .slice(0, 5)
      : [];
    if (exactIds.length > 0 && readTrace) {
      const traces: NonNullable<typeof source>['traces'] = [];
      for (const id of exactIds) {
        try {
          const t = readTrace(id);
          if (!t) continue;
          const first = t.rows.find((r) => (r.content || '').trim());
          traces.push({
            traceId: id,
            sessionId: t.turn.session_id,
            turnId: t.turn.turn_seq,
            archived: t.archived,
            excerpt: (first?.content || '').slice(0, 300),
          });
        } catch { /* fail-open: try the next id */ }
      }
      if (traces.length > 0) source = { sessionId: traces[0].sessionId, traces };
    }

    // C0: reconstruct raw source-turn evidence from t1_archive when available.
    if (!source && searchArchive && unit.source_session_id && config.recall.sourceEvidence.enabled) {
      try {
        const turns = searchArchive(unit.source_session_id, unit.cue_anchors ?? [], config.recall.sourceEvidence.k);
        const evidence = reconstructSource(turns, config.recall.sourceEvidence.maxChars);
        if (evidence) source = { sessionId: unit.source_session_id, evidence };
      } catch { /* fail-open */ }
    }

    const memPayload = {
      success: true as const,
      memory: unit,
      ...(latest ? { latest } : {}),
      ...(source ? { source } : {}),
    };
    return { content: [{ type: "text", text: JSON.stringify(memPayload) }], structuredContent: memPayload as Record<string, unknown> };
  } catch (err: any) {
    return { content: [{ type: "text", text: JSON.stringify({ success: false, error: err.message }) }], isError: true };
  }
};
