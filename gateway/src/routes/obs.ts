/**
 * Phase D1 Task C3: 观察捕获面（registry dispatch 接线）。
 *
 *   POST /api/obs/capture — opencode plugin 的 observation intake（T1 写入 + turn 编号）
 *
 * handler 体从 index.ts legacy 分支逐字迁移。**手动 chunked body reader 逐字保留**
 * （media-batch 先例）：1_000_000 字节上限 → req.destroy() + 静默丢弃（不写响应）；
 * 递归守卫（internal session / pipeline prompt 内容正则）；catch 一律 fail-open
 * 200 { ok:false, error }（绝不 4xx/5xx）。懒 require（t1VectorKey）保持 runtime-lazy。
 * Spec: 2026-11-09-gateway-kernel-microkernel-design.md §5.2.
 */
import type { IncomingMessage, ServerResponse } from 'http';
import { log } from '../core/utils/logger';
import { getEmbeddingRuntime } from '../memory/embedding-runtime';
import { redactSecrets } from '../recall/redact';
import { obsSalience } from '../recall/obs-salience';
import type { GatewayDatabase } from '../memory/gateway-db';
import type { T1EpisodeBoundary } from '../recall/t1-episodes';
import type { IndexScanService } from '../recall/index-scan';
import type { RouteRegistry } from './registry';

export interface ObsInternalRolesLike {
  has(sessionID: string): boolean;
}

export interface ObsRouteDeps {
  internalSessionRoles: () => ObsInternalRolesLike;
  getGatewayDb: () => GatewayDatabase;
  getScanService: () => IndexScanService | null;
  scheduleSnapshotRefresh: (sessionID: string) => void;
}

export function attachObsRoutes(registry: RouteRegistry, deps: ObsRouteDeps): void {
  // POST /api/obs/capture — observation intake from the opencode plugin.
  // The gateway owns the T1 store (SQLite) and assigns turn IDs, so
  // plugin/serve restarts can never renumber turns or duplicate writes
  // (database-level UNIQUE dedup).
  registry.attachHandler('obs.capture', async (req: IncomingMessage, res: ServerResponse) => {
    let body = '';
    let aborted = false;
    req.on('data', (chunk: Buffer) => {
      body += chunk.toString('utf-8');
      if (body.length > 1_000_000) {
        aborted = true;
        req.destroy();
      }
    });
    req.on('end', () => {
      if (aborted) return;
      try {
        const data = JSON.parse(body);
        const sessionID = String(data?.sessionID || '');
        const source = String(data?.source || '');
        const content = typeof data?.content === 'string' ? data.content : '';
        const failure = data?.failure ? 1 : 0;
        if (!sessionID || !['user_input', 'assistant_reply', 'tool_result', 'reasoning'].includes(source)) {
          res.writeHead(400);
          res.end(JSON.stringify({ ok: false, error: 'sessionID and valid source required' }));
          return;
        }
        if (!content.trim()) {
          res.writeHead(200);
          res.end(JSON.stringify({ ok: true, id: null, deduped: true, turnId: 0 }));
          return;
        }
        // Recursion guard (A): internal pipeline sessions must never feed
        // their own output back into T1 as observations.
        if (deps.internalSessionRoles().has(sessionID)) {
          res.writeHead(200);
          res.end(JSON.stringify({ ok: true, id: null, deduped: true, turnId: 0, internal: true }));
          return;
        }
        // Recursion guard (B): content that looks like a pipeline
        // extraction prompt is pipeline-internal noise, never a real
        // user/agent observation.
        if (/Analyze the following agent observations|extract structured memories/i.test(content)) {
          res.writeHead(200);
          res.end(JSON.stringify({ ok: true, id: null, deduped: true, turnId: 0, filtered: true }));
          return;
        }
        const db = deps.getGatewayDb();
        // Redact secrets once at capture so every downstream consumer
        // (turnCompress transcripts, worker prompts, archive) only
        // ever sees redacted content. S3: encoding-time salience tag
        // (deterministic, LLM-free) is computed before the turn is
        // allocated so the turn's encoding_salience starts there.
        const redacted = redactSecrets(content).slice(0, 100_000);
        const salience = obsSalience({ text: redacted }).score;
        // Allocate the logical turn: user input opens a fresh turn,
        // every other source joins the current turn (allocating one if
        // none exists yet).
        const turn = source === 'user_input'
          ? db.beginTurn(sessionID, salience)
          : db.currentTurn(sessionID) ?? db.beginTurn(sessionID, salience);
        const id = db.append({
          session_id: sessionID,
          turn_id: turn.turn_seq,
          trace_id: turn.trace_id,
          source: source as any,
          content: redacted,
          failure,
          salience,
        });
        // A queued `/new-episode` boundary binds to this new user turn. The
        // edge is `turnSeq - 1`, so capture timing cannot move completed turns.
        let episodeBoundary: unknown = null;
        if (source === 'user_input' && typeof db.consumePendingEpisodeBoundary === 'function') {
          try {
            episodeBoundary = db.consumePendingEpisodeBoundary(sessionID, turn.turn_seq);
          } catch { /* fail-open: boundary can be declared again */ }
        }
        // V1 verbatim layer: fire-and-forget dense embedding of the raw
        // row. Key = session:turn:contentHash — stable across the
        // obs→archive move, idempotent on identical content. Fail-open.
        try {
          const rt = getEmbeddingRuntime();
          const { t1VectorKey } = require('../recall/verbatim-recall');
          if (rt?.t1Indexer && redacted) {
            rt.t1Indexer.enqueueText(t1VectorKey(sessionID, turn.turn_seq, redacted), redacted.slice(0, 2000));
            rt.scheduleFlush();
          }
        } catch { /* fail-open */ }
        // Async scan prefetch: precompute semantic recall for this turn
        // so the next boundary recall can merge it without waiting.
        if (source === 'user_input') {
          deps.getScanService()?.prefetch(sessionID, content.slice(0, 500));
          // R8: refresh the predictive prefetch snapshot (debounced) so
          // the next boundary recall can serve the expensive retrieval.
          deps.scheduleSnapshotRefresh(sessionID);
          // D4a: consume any dream queries generated overnight for this
          // session — prefetch them so the day's first recall hits a
          // prebuilt snapshot (one-shot handoff).
          try {
            const dq = deps.getGatewayDb().kvGet<{ queries: string[] }>('dream-queries', sessionID);
            if (dq?.queries?.length) {
              deps.getGatewayDb().kvDelete('dream-queries', sessionID);
              for (const q of dq.queries) deps.getScanService()?.prefetch(sessionID, q);
            }
          } catch { /* fail-open */ }
        }
        res.writeHead(200);
        res.end(JSON.stringify({
          ok: true,
          id,
          turnId: turn.turn_seq,
          traceId: turn.trace_id,
          deduped: id === null,
          ...(episodeBoundary ? { episodeBoundary } : {}),
        }));
      } catch (err: any) {
        // fail-open: never let capture errors surface to the plugin
        log.warn(`[Scheduler] /api/obs/capture failed: ${err.message}`);
        res.writeHead(200);
        res.end(JSON.stringify({ ok: false, error: err.message }));
      }
    });
  });

  // POST /api/obs/episode-boundary — append-only episode edge declaration.
  // `next_user_turn` only queues a flag; capture consumes it later.
  registry.attachHandler('obs.episodeBoundary', async (req: IncomingMessage, res: ServerResponse) => {
    let body = '';
    let aborted = false;
    req.on('data', (chunk: Buffer) => {
      body += chunk.toString('utf-8');
      if (body.length > 1_000_000) {
        aborted = true;
        req.destroy();
      }
    });
    req.on('end', () => {
      if (aborted) return;
      try {
        const data = JSON.parse(body || '{}');
        const sessionID = String(data?.sessionID || '');
        if (!sessionID) {
          res.writeHead(400);
          res.end(JSON.stringify({ ok: false, error: 'sessionID required' }));
          return;
        }
        const scope = data?.scope == null ? undefined : String(data.scope);
        if (
          scope !== undefined &&
          !['start_new', 'end_current', 'next_user_turn'].includes(scope)
        ) {
          res.writeHead(400);
          res.end(JSON.stringify({ ok: false, error: 'invalid scope: use start_new|end_current|next_user_turn' }));
          return;
        }
        const reason = typeof data?.reason === 'string' ? data.reason : undefined;
        const intent = typeof data?.intent === 'string' ? data.intent : undefined;
        const source = data?.source === 'user' ? 'user' : 'agent';
        const nowSec = Math.floor(Date.now() / 1000);
        const db = deps.getGatewayDb();

        if (scope === 'next_user_turn') {
          db.setPendingEpisodeBoundary(sessionID, {
            reason: reason ?? 'user_declared',
            intent,
            createdAt: nowSec,
          });
          res.writeHead(200);
          res.end(JSON.stringify({ ok: true, pending: true }));
          return;
        }

        const current = db.currentTurn(sessionID);
        const currentMax = current?.turn_seq ?? 0;
        const explicit = Number(data?.afterTurn);
        const hasExplicit = Number.isFinite(explicit) && explicit >= 0;
        if (!hasExplicit && currentMax < 1) {
          res.writeHead(200);
          res.end(JSON.stringify({ ok: true, ignored: true }));
          return;
        }
        const afterTurn = hasExplicit
          ? Math.trunc(explicit)
          : scope === 'end_current'
            ? currentMax
            : currentMax - 1;
        if (!hasExplicit && afterTurn <= 0) {
          res.writeHead(200);
          res.end(JSON.stringify({ ok: true, ignored: true }));
          return;
        }

        const boundary: T1EpisodeBoundary = {
          sessionId: sessionID,
          afterTurn,
          source,
          reason: reason as T1EpisodeBoundary['reason'] | undefined,
          intent,
          createdAt: nowSec,
        };
        db.recordEpisodeBoundary(boundary);
        res.writeHead(200);
        res.end(JSON.stringify({ ok: true, boundary }));
      } catch (err: any) {
        res.writeHead(500);
        res.end(JSON.stringify({ ok: false, error: err?.message || String(err) }));
      }
    });
  });
}
