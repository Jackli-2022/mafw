/**
 * Phase D1 Task B3/B4: recall 面（registry dispatch 接线）。
 *
 *   GET /api/recall/instructions — 三块 instruction block 缺失面（T2-4 fallback）
 *   GET /api/recall/pinned       — pinned 披露层（每轮注入，fail-open）
 *   GET /api/recall/priors       — W1 常驻先验块（L5 公理 + L2 失败模式谱，fail-open）
 *   GET /api/recall/context      — 边界 recall（100ms 契约，整体 fail-open 200）
 *
 * handler 体从 index.ts legacy 分支逐字迁移。四条 legacy 分支都用裸
 * startsWith('/api/recall/...')（无尾锚，`?query` 与 `/api/recall/pinnedX` 都会命中）；
 * registry 走精确段匹配 → 收紧为 `(method, 精确 path)`，属 Task B 认可的 R2 收紧。
 * 懒 require() 全部保持 runtime-lazy（fail-open 姿态的一部分，禁止静态提升）。
 */
import * as fs from 'fs';
import * as path from 'path';
import type { IncomingMessage, ServerResponse } from 'http';
import { config } from '../config';
import { log } from '../core/utils/logger';
import { canonicalProjectDir } from '../core/pod/pod-identity';
import { buildGoalSnapshot } from '../core/manager/goal-snapshot';
import { getRetrievalEventBuffer } from '../core/memory/retrieval-events';
import { L5Store } from '../core/memory/l5-store';
import type { GatewayDatabase } from '../memory/gateway-db';
import type { IndexScanService } from '../recall/index-scan';
import type { InstructionBlocks } from '../recall/instruction-blocks';
import type { InstructionSyncService } from '../core/instructions/instruction-sync-service';
import type { LeadSessionRegistry } from '../core/manager/lead-session-registry';
import type { MemoryService } from '../memory/service';
import type { RouteRegistry } from './registry';

export interface RecallRouteDeps {
  buildInstructionBlocks: () => Promise<InstructionBlocks>;
  instructionSync: () => Pick<InstructionSyncService, 'inspect'> | null;
  memoryService: () => MemoryService | null | undefined;
  /** S4 认知一致性记录（Map 本身，live reference）。 */
  recallCalledBySession: () => Map<string, number>;
  leadSessionRegistry: () => LeadSessionRegistry;
  registeredProjects: () => Map<string, { mafwDir: string }>;
  mafwDir: () => string;
  getGatewayDb: () => GatewayDatabase;
  getScanService: () => IndexScanService | null;
}

export function attachRecallRoutes(registry: RouteRegistry, deps: RecallRouteDeps): void {
  // GET /api/recall/instructions — T2-4 fallback: which of the three
  // instruction blocks are missing from the session's opencode entries.
  registry.attachHandler('recall.instructions', async (req: IncomingMessage, res: ServerResponse) => {
    const { handleRecallInstructions } = require('./recall-instructions');
    const handled = await handleRecallInstructions(req, res, req.url, {
      getBlocks: () => deps.buildInstructionBlocks(),
      getSync: () => deps.instructionSync(),
    });
    // legacy 是 `if (handled) return;`（未处理则落回反代）。dispatchAuthorized 把
    // `undefined` 当作"已处理"，所以这里必须 **return 委派方的 boolean**：委派方
    // 给出 false（fall-through 契约）时请求要能继续落回 dashboard / 反代，而不是
    // 静默挂死。同形：routes/sessions-core.ts `session.background`、routes/mcp-mgmt.ts。
    return handled;
  });

  // GET /api/recall/pinned — disclosure layer for system prompt injection.
  // Pinned memories appear every turn regardless of retrieval; fail-open.
  registry.attachHandler('recall.pinned', async (_req: IncomingMessage, res: ServerResponse) => {
    try {
      if (!deps.memoryService()) {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ profile: null, entries: [], budget: { max: 20, maxChars: 2000, used: 0 } }));
        return;
      }
      const { handleRecallPinned } = require('./pinned-recall');
      const { HarmonicUnitFileStore } = require('../memory/harmonic-file-store.js');
      const store = new HarmonicUnitFileStore(config.resolvePath(), deps.memoryService()!.harmonicIndex);
      const result = await handleRecallPinned({
        getIndex: () => deps.memoryService()!.harmonicIndex.getIndex(),
        readUnit: (id: string) => store.read(id),
      });
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(result));
    } catch (err: any) {
      log.error('[Scheduler] recall/pinned error:', err.message);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ profile: null, entries: [], budget: { max: 20, maxChars: 2000, used: 0 } }));
    }
  });

  // GET /api/recall/priors — W1 常驻先验块（L5 公理 + L2 失败模式谱），fail-open。
  registry.attachHandler('recall.priors', async (_req: IncomingMessage, res: ServerResponse) => {
    try {
      const { handleAgentPriors } = require('./agent-priors');
      const result = await handleAgentPriors({
        l5: new L5Store(),
        getIndex: () => deps.memoryService()?.harmonicIndex.getIndex() ?? { entries: [] },
        needFor: (id: string) => getRetrievalEventBuffer().needFor(id),
      });
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(result));
    } catch (err: any) {
      log.error('[Recall] priors error:', err.message);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ block: null, used: 0, budget: { maxChars: 800 } }));
    }
  });

  // GET /api/recall/context —boundary recall for memory injection
  registry.attachHandler('recall.context', async (req: IncomingMessage, res: ServerResponse) => {
    try {
      const parsedUrl = new URL(req.url!, `http://${req.headers.host || 'localhost'}`);
      const query = parsedUrl.searchParams.get('query') || '';
      const sessionID = parsedUrl.searchParams.get('sessionID') || '';
      let topicState: import('../recall/topic-state').TopicState | null = null;
      if (sessionID) {
        try {
          const { readTopicState } = require('../recall/topic-state');
          topicState = readTopicState(deps.getGatewayDb(), sessionID);
        } catch { /* fail-open: report unset below */ }
      }
      // S4 认知一致性：记录 recall 触达（有界，conformance 消费）
      if (sessionID) {
        deps.recallCalledBySession().set(sessionID, Date.now());
        if (deps.recallCalledBySession().size > 500) deps.recallCalledBySession().clear();
      }
      const tGoal0 = Date.now();
      // Goal snapshot: injected every turn for the ACTIVE manager session
      // only (kv compare). Compaction-proof goal awareness (spec §3.4①).
      let goalSnap: string | null = null;
      if (sessionID) {
        const lead = deps.leadSessionRegistry().findBySessionId(sessionID);
        if (lead) {
          const entry = Array.from(deps.registeredProjects().entries())
            .find(([raw]) => canonicalProjectDir(raw) === lead.projectDir);
          const mafwDir = entry?.[1].mafwDir ?? path.join(lead.projectDir, '.mafw');
          try { goalSnap = buildGoalSnapshot(mafwDir); } catch { /* fail-open */ }
        }
      }
      // Sticky note board: user-commissioned reminders with guaranteed
      // per-turn visibility until sticky_until passes (board-level
      // expiry only). Deterministic filter, fail-open like pinned;
      // injected even when the recall query is empty.
      const tGoal = Date.now() - tGoal0;
      const tNote0 = Date.now();
      let noteBoard: string | null = null;
      if (deps.memoryService()) {
        try {
          const { handleNoteBoard } = require('./note-board');
          const { HarmonicUnitFileStore } = require('../memory/harmonic-file-store.js');
          const store = new HarmonicUnitFileStore(deps.mafwDir(), deps.memoryService()!.harmonicIndex);
          const nb = await handleNoteBoard({
            getIndex: () => deps.memoryService()!.harmonicIndex.getIndex(),
            readUnit: (id: string) => store.read(id),
          });
          noteBoard = nb.board;
        } catch { /* fail-open */ }
      }
      const tNoteBoard = Date.now() - tNote0;
      if (!query.trim()) {
        const only = [noteBoard, goalSnap].filter(Boolean);
        const { renderTopicRecallHeader } = require('../recall/topic-recall');
        const header = renderTopicRecallHeader(topicState, only.length > 0);
        res.writeHead(200);
        res.end(JSON.stringify({ pointers: [header, ...only].join('\n\n') }));
        return;
      }
      const { formatRecallContext } = require('../recall/inject-format');
      const { searchRecallMemories, computeRecallFokZone, recallNeighbors } = require('../recall/recall-context');
      // R8: serve the precomputed snapshot when it still matches the topic
      // (falls back to the live cheap search otherwise).
      let snapshotPointers: string | null = null;
      const snapCfg = config.search.snapshot;
      if (snapCfg?.enabled && sessionID) {
        try {
          const { decideSnapshotUse } = require('../recall/recall-snapshot');
          const snap = deps.getGatewayDb().kvGet('recall-snapshot', sessionID) as any;
          const decision = decideSnapshotUse(snap, query, new Date(), snapCfg);
          if (decision === 'use' && snap) {
            snapshotPointers = snap.block;
            // A3: a served snapshot is a real injection — record exposure
            // for the daily ACT-R settlement (fail-open, in-memory only).
            try {
              const { recordRetrievalFromScored } = require('../core/memory/retrieval-events');
              recordRetrievalFromScored(
                ((snap.ids ?? []) as string[]).map((id) => ({ entry: { id } })),
                'recall',
              );
            } catch { /* fail-open */ }
            // T1 observe-only: a served snapshot is exposure of verbatim
            // evidence. No energy/ranking effect in phase 2A.
            try {
              const db: any = deps.getGatewayDb();
              for (const hit of (snap.t1Hits ?? [])) {
                if (hit?.traceId) {
                  db.recordT1RetrievalEvent?.({ traceId: hit.traceId, kind: 'recall', score: hit.score ?? hit.cosine });
                }
              }
            } catch { /* fail-open */ }
            // A4 hit-proxy: log the probability-gated injection as a
            // calibration sample — hit when a pointer is later redeemed
            // via mafw_get_memory (join by id within TTL).
            try {
              if (Number.isFinite(snap.top1prob)) {
                const { appendFokEvent } = require('../recall/fok-samples');
                appendFokEvent({
                  e: 'inj',
                  ts: Date.now(),
                  top1prob: snap.top1prob,
                  zone: snap.fokStatus ?? 'inject',
                  ids: (snap.ids ?? []) as string[],
                });
              }
            } catch { /* fail-open */ }
            log.info(`[Recall] snapshot served for ${sessionID} (age=${Date.now() - Date.parse(snap.builtAt)}ms, fok=${snap.fokStatus ?? 'inject'})`);
          } else if (decision !== 'no-snapshot') {
            // Log the containment score: short instruction-style user turns
            // ("继续", "可以") legitimately score 0 against a content window,
            // so this number tells us whether the threshold or the usage
            // pattern is responsible for the skip rate.
            let containment = 0;
            try {
              const { snapshotContainment } = require('../recall/recall-snapshot');
              containment = snap ? snapshotContainment(snap.query, query) : 0;
            } catch { /* ignore */ }
            log.info(`[Recall] snapshot skipped (${decision}, containment=${containment.toFixed(2)}, queryTokens=${query.trim().length}) for ${sessionID}`);
          }
        } catch { /* fail-open: live path */ }
      }
      let memories: any[] = [];
      let fokStatus: 'inject' | 'low-confidence' | 'no-memory' = 'inject';
      const tSearch0 = Date.now();
      let arbiterNote: string | undefined;
      if (!snapshotPointers && deps.memoryService()) {
        // No push channel exists anymore (step-inject retired): nothing
        // is filtered out of boundary recall.
        const pushed = new Set<string>();
        // Sync path is BM25-only (<50ms): the plugin client aborts after
        // 100ms. Scan results arrive via async prefetch snapshot (C).
        const scanSnapshot = deps.getScanService()?.getSnapshot(sessionID) ?? null;
        // R2 on the boundary fallback too (topic-shift turns / no snapshot):
        // the dense query embedding costs ~8ms, but a busy sidecar must
        // never blow the contract — hence the short deadline + BM25 fallback.
        let denseScores: Map<string, number> | undefined;
        if (config.search.boundaryDense !== false) {
          try {
            const { computeDenseScores } = require('../memory/embedding-runtime');
            const { withTimeout } = require('../recall/recall-context');
            const dense = await withTimeout(
              Promise.resolve(computeDenseScores(query, 12, deps.memoryService()!.harmonicIndex)),
              config.search.boundaryDenseTimeoutMs ?? 25,
            );
            denseScores = dense ?? undefined;
          } catch { /* fail-open: BM25 only */ }
        }
        memories = await searchRecallMemories(
          deps.memoryService()!.harmonicIndex,
          query,
          pushed,
          3,
          {
            retriever: config.search.defaultRetriever,
            scanSnapshot,
            denseScores,
          },
        );
        // R5 FOK gate (fail-open): weak evidence is stated, not silently
        // withheld. Only active when config.search.fok.enabled.
        fokStatus = computeRecallFokZone(deps.memoryService()!.harmonicIndex, query, config.search.fok);
        // G4 parametric arbiter (MARTA): annotate-only in v1 — prepends a
        // note when parametric knowledge likely suffices; never skips.
        if (config.search.arbiter !== false) {
          try {
            const { arbitrateRetrieval, entityOverlap, getEntitySetCached } = require('../recall/parametric-arbiter');
            const entries = deps.memoryService()!.harmonicIndex.getIndex().entries;
            const overlap = entityOverlap(query, getEntitySetCached(entries));
            const arb = arbitrateRetrieval(query, { entityOverlap: overlap, fokZone: fokStatus });
            arbiterNote = arb.note;
            // observe-first: one JSONL row per arbitrated boundary recall
            const line = JSON.stringify({ ts: Date.now(), q: query.length, overlap: +overlap.toFixed(3), zone: fokStatus, action: arb.action }) + '\n';
            fs.appendFile(path.join(config.resolvePath(), 'logs', 'arbiter-samples.jsonl'), line, () => {});
          } catch { /* fail-open */ }
        }
        // A3: record the live-path retrieval for the daily ACT-R
        // settlement (log-form bonus + exposure discount — the linear
        // +0.02 direct write was unbounded with popularity feedback).
        try {
          const { recordRetrievalFromScored } = require('../core/memory/retrieval-events');
          recordRetrievalFromScored(
            memories.map((m: any) => ({ entry: { id: m.id } })),
            'recall',
          );
        } catch { /* fail-open */ }
      }
      // R6 presentation (off by default): bundle chronological neighbours
      // under their anchors. Never re-ranks — presentation only.
      const tNb0 = Date.now();
      let neighbors: Map<string, any[]> | undefined;
      if (config.search.temporalNeighbors?.presentation && memories.length > 0 && deps.memoryService()) {
        try {
          const nb: Map<string, any[]> = recallNeighbors(
            deps.memoryService()!.harmonicIndex,
            memories,
            config.search.temporalNeighbors,
          );
          neighbors = nb.size > 0 ? nb : undefined;
        } catch { neighbors = undefined; }
      }
      const tNeighbors = Date.now() - tNb0;
      const formatted = snapshotPointers
        ? { pointers: snapshotPointers }
        : formatRecallContext(memories, { status: fokStatus, neighbors });
      if (arbiterNote && formatted.pointers) {
        formatted.pointers = `${arbiterNote}\n${formatted.pointers}`;
      }
      const blocks = [formatted.pointers, noteBoard, goalSnap].filter(Boolean);
      const { renderTopicRecallHeader } = require('../recall/topic-recall');
      const header = renderTopicRecallHeader(topicState, blocks.length > 0);
      const pointers = [header, ...blocks].join('\n\n');
      // Latency breakdown (debug): the boundary path has a 100ms contract.
      log.debug(`[Recall] timing session=${sessionID || '-'} search=${snapshotPointers ? 0 : Date.now() - tSearch0}ms noteBoard=${tNoteBoard}ms goal=${tGoal}ms neighbours=${tNeighbors}ms`);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ pointers }));
    } catch (err: any) {
      log.error('[Scheduler] recall/context error:', err.message);
      res.writeHead(200);
      res.end(JSON.stringify({ pointers: null }));
    }
  });

  // POST /api/recall/topic — set/correct the current per-session attention topic.
  // This is not a fact write and does not mark an episode boundary.
  registry.attachHandler('recall.topicSet', async (req: IncomingMessage, res: ServerResponse) => {
    let body = '';
    let aborted = false;
    req.on('data', (chunk: Buffer) => {
      body += chunk.toString('utf-8');
      if (body.length > 64_000) {
        aborted = true;
        req.destroy();
      }
    });
    req.on('end', () => {
      if (aborted) return;
      try {
        const data = JSON.parse(body || '{}');
        const sessionID = typeof data?.sessionID === 'string' ? data.sessionID.trim() : '';
        if (!sessionID) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: false, code: 'sessionID_required' }));
          return;
        }
        const {
          TopicRevisionConflict,
          setTopicState,
        } = require('../recall/topic-state');
        try {
          const state = setTopicState(deps.getGatewayDb(), {
            sessionID,
            topic: data?.topic,
            summary: data?.summary,
            entities: data?.entities,
            aliases: data?.aliases,
            openLoops: data?.openLoops,
            retrievalKeys: data?.retrievalKeys,
            matterId: data?.matterId,
            active: data?.active,
            expectedRevision:
              typeof data?.expectedRevision === 'number' ? data.expectedRevision : undefined,
          });
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: true, state }));
        } catch (err: any) {
          const conflict = err instanceof TopicRevisionConflict;
          res.writeHead(conflict ? 409 : 400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({
            ok: false,
            code: conflict ? 'topic_revision_conflict' : 'invalid_topic_state',
            error: err?.message || String(err),
          }));
        }
      } catch (err: any) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, code: 'invalid_json', error: err?.message || String(err) }));
      }
    });
  });
}
