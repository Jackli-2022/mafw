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
import type { MemoryReceipt } from '../recall/receipt';
import { recordRecallRequest, recordRecallStage } from '../recall/recall-metrics';
import type { RecallSnapshotDecision } from '../recall/recall-metrics';
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
  /** `memory.recalled` SSE fan-out; optional for tests / older callers. */
  broadcast?: (event: { type: string; sessionID?: string; properties?: unknown }) => void;
  /** Best-effort persistence; called after the response ends, never awaited. */
  saveReceipt?: (input: { sessionId: string; anchorKey: string; receipt: MemoryReceipt }) => unknown;
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
    const tStart = Date.now();
    // Task 1 instrumentation: the real recorder is installed once the cheap
    // per-turn blocks are built (below), so every exit path — empty query,
    // served body, error — records exactly one request outcome. Declared here
    // so the catch path can reach it.
    let recordRequestOutcome: (() => void) | null = null;
    try {
      const parsedUrl = new URL(req.url!, `http://${req.headers.host || 'localhost'}`);
      const query = parsedUrl.searchParams.get('query') || '';
      const sessionID = parsedUrl.searchParams.get('sessionID') || '';
      const anchorKey = parsedUrl.searchParams.get('anchorKey') || '';
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
      // Task 1 stage/request metrics (in-memory, fail-open). Stage samples
      // are recorded only where the stage actually runs; `total` comes from
      // recordRecallRequest (no double counting with recordRecallStage).
      let snapshotDecision: RecallSnapshotDecision | undefined;
      let servedRoute: 'snapshot' | 'fallback' = 'fallback';
      let requestRecorded = false;
      recordRequestOutcome = () => {
        if (requestRecorded) return;
        requestRecorded = true;
        try {
          recordRecallRequest({
            route: servedRoute,
            snapshotDecision,
            // The client may have aborted while the server was still building
            // the block (the plugin gives up at 100ms) — that response was
            // never seen, so it must not count as visible.
            clientAborted: Boolean(res.destroyed || req.destroyed),
            totalMs: Date.now() - tStart,
          });
        } catch { /* fail-open: metrics must never affect the recall body */ }
      };
      if (!query.trim()) {
        const only = [noteBoard, goalSnap].filter(Boolean);
        const { renderTopicRecallHeader } = require('../recall/topic-recall');
        const header = renderTopicRecallHeader(topicState, false);
        res.writeHead(200);
        res.end(JSON.stringify({ pointers: [header, ...only].join('\n\n') }));
        recordRequestOutcome?.();
        return;
      }
      const { formatRecallContext } = require('../recall/inject-format');
      const { searchRecallMemories, evaluateRecallFokZone, recallNeighbors } = require('../recall/recall-context');
      // R8: serve the precomputed snapshot when it still matches the topic
      // (falls back to the live cheap search otherwise).
      let snapshotPointers: string | null = null;
      let snapshotFokStatus: string | undefined;
      let snapshotMemories: any[] | undefined;
      let snapshotT1: any[] | undefined;
      let snapshotT1Rendered = false;
      const snapCfg = config.search.snapshot;
      if (snapCfg?.enabled && sessionID) {
        try {
          const { decideSnapshotUse } = require('../recall/recall-snapshot');
          const snap = deps.getGatewayDb().kvGet('recall-snapshot', sessionID) as any;
          const decision = decideSnapshotUse(snap, query, new Date(), snapCfg);
          snapshotDecision = decision;
          if (decision === 'use' && snap) {
            const snapFok = snap.fokStatus ?? 'inject';
            if (snapFok === 'inject') {
            servedRoute = 'snapshot';
            snapshotPointers = snap.block;
            snapshotFokStatus = snapFok;
            snapshotMemories = Array.isArray(snap.memories) ? snap.memories : undefined;
            snapshotT1 = Array.isArray(snap.t1Hits) ? snap.t1Hits : undefined;
            snapshotT1Rendered = snap.t1Rendered === true;
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
            } else {
              // Decision said "use" but the snapshot carries no reliable
              // recall body: the fallback search serves this turn. Record the
              // FOK reason so the skip rate is attributable.
              snapshotDecision = 'fok';
              log.info(`[Recall] snapshot skipped (fok=${snapFok}, no reliable recall body) for ${sessionID}`);
            }
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
        const tSearchCall = Date.now();
        memories = await searchRecallMemories(
          deps.memoryService()!.harmonicIndex,
          query,
          pushed,
          3,
          {
            retriever: config.search.defaultRetriever,
            scanSnapshot,
            denseScores,
            // Live boundary path only: secondary (entity / multi-hop) passes
            // skip anchor-graph expansion to stay inside the 100ms contract.
            // The snapshot builder and every other caller keep the default
            // (legacy: index default on secondary passes too).
            secondaryGraphExpand: false,
          },
        );
        recordRecallStage('search', Date.now() - tSearchCall);
        // R5 FOK gate (fail-open): weak evidence is stated, not silently
        // withheld. Only active when config.search.fok.enabled.
        const tFok = Date.now();
        const fokEval = evaluateRecallFokZone(
          deps.memoryService()!.harmonicIndex,
          query,
          config.search.fok,
        );
        recordRecallStage('fok', Date.now() - tFok);
        fokStatus = fokEval.zone;
        // Word-level support veto: BM25 indexes CJK as unigrams, so a
        // no-answer query can still dominate top1/mean through scattered
        // single characters. An `inject` whose every candidate shares no
        // ASCII word, identifier part, or topical CJK bigram is a ratio
        // artifact — not evidence. Only an *evaluated* inject is judged:
        // disabled / missing-scorer / throwing FOK keeps its fail-open inject.
        // Supported turns drop their unsupported pointers (and therefore their
        // neighbours); exact evidence below may still rescue a vetoed turn.
        if (fokEval.evaluated && fokStatus === 'inject') {
          try {
            const { selectLexicallySupportedCandidates } = require('../recall/lexical-support');
            const tLexical = Date.now();
            const selection = selectLexicallySupportedCandidates(memories, query);
            recordRecallStage('lexical', Date.now() - tLexical);
            if (selection.applicable && selection.supported.length === 0) {
              fokStatus = 'no-memory';
              log.debug(`[Recall] lexical support veto: no word-level overlap (candidates=${memories.length})`);
            } else if (selection.applicable) {
              if (selection.supported.length !== memories.length) {
                log.debug(`[Recall] lexical support filter: kept ${selection.supported.length}/${memories.length} pointers`);
              }
              memories = selection.supported;
            }
          } catch (err: any) {
            // Fail-open, but never silently: a broken gate must be visible.
            log.warn(`[Recall] lexical support check failed, keeping FOK result: ${err?.message || err}`);
          }
        }
        // P1 exact-evidence admission: a flattened BM25 ratio must not veto a
        // target that the index identifies exactly (verbatim title / cue /
        // identifier). Rescue only — an inject turn that passed the lexical
        // support check keeps BM25 order and skips the scan entirely. Metadata-
        // only, deterministic, and live path only; snapshots keep their own
        // probability gate. Ordinary low-confidence candidates are untouched
        // (no evidence → same result).
        if (fokStatus !== 'inject') {
          try {
            const { findExactRecallEvidence, applyExactRecallEvidence } = require('../recall/exact-evidence');
            // Evidence discovery must be wide enough to keep every equal-
            // specificity owner that the BM25 candidate set can prefer; the
            // existing search cap (50) is the bound. Apply still enforces topK=3.
            const evidenceLimit = config.search.maxMemoryResults || 50;
            const tExact = Date.now();
            const harmonicIndex = deps.memoryService()!.harmonicIndex;
            // Warm exact-evidence index: keyed by the live index version, so
            // writes invalidate it without a per-turn rebuild. Partial mocks /
            // legacy index implementations without the getter stay on the pure
            // scan (fail-open, no behavior change).
            let searchVersion: number | undefined;
            try {
              if (typeof harmonicIndex.getSearchVersion === 'function') {
                searchVersion = harmonicIndex.getSearchVersion();
              }
            } catch { searchVersion = undefined; }
            const evidence = findExactRecallEvidence(
              harmonicIndex.getIndex().entries,
              query,
              evidenceLimit,
              searchVersion,
            );
            recordRecallStage('exact', Date.now() - tExact);
            const exact = applyExactRecallEvidence(
              memories,
              evidence,
              fokStatus,
              3,
            );
            memories = exact.memories;
            fokStatus = exact.status;
          } catch { /* fail-open: keep the FOK/BM25 result */ }
        }
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
      }
      // R6 presentation (off by default): bundle chronological neighbours
      // under their anchors. Never re-ranks — presentation only.
      const tNb0 = Date.now();
      let neighbors: Map<string, any[]> | undefined;
      const neighborsRan = Boolean(
        config.search.temporalNeighbors?.presentation && memories.length > 0 && deps.memoryService(),
      );
      if (neighborsRan) {
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
      if (neighborsRan) recordRecallStage('neighbors', tNeighbors);
      const tRender0 = Date.now();
      const formatted = snapshotPointers
        ? { pointers: snapshotPointers }
        : formatRecallContext(memories, { status: fokStatus, neighbors });
      if (!snapshotPointers) recordRecallStage('render', Date.now() - tRender0);
      const { hasRelatedRecallBody, renderTopicRecallHeader } = require('../recall/topic-recall');
      const hasRelated = hasRelatedRecallBody(
        formatted.pointers,
        fokStatus,
        snapshotPointers,
        snapshotFokStatus,
      );
      const relatedBody = hasRelated ? (snapshotPointers ?? formatted.pointers) : null;
      // A3: record the live-path retrieval for the daily ACT-R settlement
      // (log-form bonus + exposure discount — the linear +0.02 direct write was
      // unbounded with popularity feedback). Only pointers that actually
      // rendered count as exposure: a vetoed/no-memory body must not reward
      // unrelated candidates. Snapshot serving records its own exposure above.
      if (!snapshotPointers && hasRelated) {
        try {
          const { recordRetrievalFromScored } = require('../core/memory/retrieval-events');
          recordRetrievalFromScored(
            memories.map((m: any) => ({ entry: { id: m.id } })),
            'recall',
          );
        } catch { /* fail-open */ }
      }
      const arbiterWithBody = arbiterNote && relatedBody
        ? `${arbiterNote}\n${relatedBody}`
        : relatedBody;
      const blocks = [arbiterWithBody, noteBoard, goalSnap].filter(Boolean);
      const header = renderTopicRecallHeader(topicState, hasRelated);
      const pointers = [header, ...blocks].join('\n\n');

      // Build the structured receipt from data already in hand. Pure and
      // synchronous: it must never add I/O to the 100ms boundary path.
      let receipt: MemoryReceipt | null = null;
      if (anchorKey && sessionID && process.env.MAFW_MEMORY_RECEIPT !== '0') {
        try {
          const { buildMemoryReceipt } = require('../recall/receipt');
          const neighborEntries = neighbors
            ? [...neighbors.entries()].flatMap(([anchorId, list]) =>
                (list ?? []).map((entry: any) => ({ ...entry, neighborOf: anchorId })))
            : [];
          const receiptMemories = snapshotPointers
            ? (snapshotMemories ?? [])
            : [...memories, ...neighborEntries];
          const receiptT1 = snapshotPointers
            ? (snapshotT1Rendered ? (snapshotT1 ?? []) : [])
            : [];
          const status: 'inject' | 'low-confidence' | 'no-memory' = snapshotPointers
            ? ((snapshotFokStatus as any) ?? 'inject')
            : fokStatus;
          receipt = buildMemoryReceipt({
            status,
            tookMs: Date.now() - tStart,
            now: new Date().toISOString(),
            topic: topicState ? { title: topicState.topic, hasRelated } : null,
            memories: receiptMemories,
            t1: receiptT1,
            noMemoryBlockRendered: status === 'no-memory',
          });
        } catch (err: any) {
          log.warn(`[Recall] receipt build failed: ${err?.message || err}`);
        }
      }

      // Latency breakdown (debug): the boundary path has a 100ms contract.
      log.debug(`[Recall] timing session=${sessionID || '-'} search=${snapshotPointers ? 0 : Date.now() - tSearch0}ms noteBoard=${tNoteBoard}ms goal=${tGoal}ms neighbours=${tNeighbors}ms`);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ pointers }));
      recordRequestOutcome?.();

      if (receipt && !res.destroyed) {
        const finalReceipt = receipt;
        // Persistence and fan-out happen after the response; never awaited.
        setImmediate(() => {
          try {
            deps.saveReceipt?.({ sessionId: sessionID, anchorKey, receipt: finalReceipt });
          } catch (err: any) {
            log.warn(`[Recall] receipt save failed: ${err?.message || err}`);
          }
          try {
            deps.broadcast?.({
              type: 'memory.recalled',
              sessionID,
              properties: { anchorKey, receipt: finalReceipt },
            });
          } catch (err: any) {
            log.warn(`[Recall] receipt broadcast failed: ${err?.message || err}`);
          }
        });
      }
    } catch (err: any) {
      log.error('[Scheduler] recall/context error:', err.message);
      recordRequestOutcome?.();
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
