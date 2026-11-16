/**
 * Phase D1 Task F1: memory 查询/统计面（registry dispatch 接线）。
 *
 *   GET    /api/memory/merged-search       — memory context injection 结果（memory.mergedSearch）
 *   POST   /api/memory/embeddings/backfill — 缺失向量的条目补建（memory.embeddingsBackfill）
 *   GET    /api/memory/stats               — 巩固健康度 + 向量覆盖（memory.stats）
 *   GET    /api/memory/sticky              — note-board 结构化列表（memory.listSticky）
 *   GET    /api/memory/get                 — 按 id / 6 位指针尾取全文（memory.get）
 *   GET    /api/memory/search              — 谐波索引检索（memory.search）
 *   DELETE /api/memory/:id                 — 物理删除 OKF 文件 + 索引条目（memory.delete）
 *   GET    /api/memory/energy-distribution — 按 energy 分桶（memory.getEnergyDistribution）
 *   GET    /api/l5/axioms                  — 全局 L5 公理 + 启发式（memory.getL5Axioms）
 *
 * handler 体从 index.ts legacy 分支逐字迁移（`this.x` → `deps.x()`）：查询串解析、
 * 懒 require()、fail-open 壳（sticky 兜底 200）、503/404/500 状态全部保留。
 * Spec: 2026-11-09-gateway-kernel-microkernel-design.md §5.2.
 */
import * as fs from 'fs';
import type { IncomingMessage, ServerResponse } from 'http';
import { config } from '../config';
import { log } from '../core/utils/logger';
import { L5Store } from '../core/memory/l5-store';
import { getRetrievalEventBuffer } from '../core/memory/retrieval-events';
import { getReconsolidationQueue } from '../recall/reconsolidation';
import { computeDenseScores, getEmbeddingRuntime } from '../memory/embedding-runtime';
import { getRouteStats } from '../memory/route-write';
import { HarmonicUnitFileStore } from '../memory/harmonic-file-store';
import type { ConsolidationService } from '../memory/consolidation-service';
import type { GatewayDatabase } from '../memory/gateway-db';
import type { MemoryService } from '../memory/service';
import type { PipelineHeartbeat } from '../recall/pipeline-heartbeat';
import type { CoactivationGraphStore } from '../graph/coactivation-store';
import type { RouteRegistry } from './registry';
import type { EpisodeHit } from '../recall/t1-episode-search';

export interface FokStatsCache {
  at: number;
  stats: any;
}

export interface MemoryRouteDeps {
  memoryService: () => MemoryService | null | undefined;
  consolidationService: () => ConsolidationService | null | undefined;
  heartbeat: () => PipelineHeartbeat | null | undefined;
  coactivationGraphStore: () => CoactivationGraphStore | null | undefined;
  /** GET /api/memory/stats 的 10s 热缓存（legacy 字段直写，需回写 live 实例）。 */
  fokStatsCache: () => FokStatsCache | null;
  setFokStatsCache: (value: FokStatsCache | null) => void;
  mafwDir: () => string;
  getGatewayDb: () => GatewayDatabase;
  /** Shared core of POST /api/memory/embeddings/backfill（GatewayServer 上保留）。 */
  backfillEmbeddings: (limit?: number) => Promise<any>;
  /**
   * E4-6b: live 资源压力（governor.pressure() 的窄面）。disk critical →
   * backfill 直接 503 `disk_low`，不启动补建（写放大在满盘上最危险）。
   */
  pressure?: () => { disk: string; degraded: string[] } | null;
  /** T1 dense search over active/archive verbatim rows. */
  searchT1?: (query: string, k: number) => Promise<import('../recall/verbatim-recall').T1Hit[]>;
  /** Episode-channel search (T1 turn hits aggregated by episode). */
  searchEpisodes?: (query: string, k: number) => Promise<EpisodeHit[]>;
}

export function attachMemoryRoutes(registry: RouteRegistry, deps: MemoryRouteDeps): void {
  // GET /api/memory/merged-search — expose memory context injection results
  registry.attachHandler('memory.mergedSearch', async (req: IncomingMessage, res: ServerResponse) => {
    try {
      const parsedUrl = new URL(req.url!, `http://${req.headers.host || 'localhost'}`);
      const query = parsedUrl.searchParams.get('query') || '';
      const maxFacts = parseInt(parsedUrl.searchParams.get('maxFacts') || '5', 10);
      if (!deps.memoryService()) {
        res.writeHead(503); res.end(JSON.stringify({ error: 'Memory service not available' })); return;
      }
      const results = await deps.memoryService()!.mergedSearch(query, maxFacts);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ results }));
    } catch (err: any) {
      res.writeHead(500);
      res.end(JSON.stringify({ error: err.message }));
    }
  });

  // POST /api/memory/embeddings/backfill — index entries missing vectors.
  // Optional ?limit=N to batch (full store ≈ 12s for short abstractions).
  registry.attachHandler('memory.embeddingsBackfill', async (req: IncomingMessage, res: ServerResponse) => {
    try {
      // E4-6b: 满盘时拒绝补建（写放大）——503 + 稳定 code，任何工作都不启动。
      const pressure = deps.pressure?.() ?? null;
      if (pressure && (pressure.disk === 'critical' || pressure.degraded.includes('disk_critical'))) {
        res.writeHead(503);
        res.end(JSON.stringify({ error: 'disk space critical', code: 'disk_low' }));
        return;
      }
      const parsedUrl = new URL(req.url!, `http://${req.headers.host || 'localhost'}`);
      const limit = parseInt(parsedUrl.searchParams.get('limit') || '', 10);
      const result = await deps.backfillEmbeddings(!Number.isNaN(limit) && limit > 0 ? limit : undefined);
      if (!result) {
        res.writeHead(400); res.end(JSON.stringify({ error: 'embedding provider off (memory.embedding.provider)' })); return;
      }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(result));
    } catch (err: any) {
      res.writeHead(500);
      res.end(JSON.stringify({ error: err.message }));
    }
  });

  // GET /api/memory/stats — consolidation health + vector coverage (P2)
  registry.attachHandler('memory.stats', async (_req: IncomingMessage, res: ServerResponse) => {
    try {
      const embeddingRuntime = getEmbeddingRuntime();
      const consolidation = deps.consolidationService()?.getStats() ?? null;
      const indexEntries = deps.memoryService()?.harmonicIndex.getIndex().entries ?? [];
      const indexed = embeddingRuntime ? embeddingRuntime.vectors.size() : 0;
      const t1 = (() => {
        const emptyStats = {
          total: 0,
          byKind: { search: 0, recall: 0, redeem: 0 },
          uniqueTraces: 0,
          lastAt: null,
        };
        let vectors = 0;
        let activeRows = 0;
        let archiveRows = 0;
        let retrieval: any = emptyStats;
        let activation = { traces: 0, mean: 0, max: 0 };
        try {
          vectors = (embeddingRuntime as any)?.t1Vectors?.size?.() ?? 0;
        } catch { /* fail-open */ }
        try {
          const db: any = deps.getGatewayDb();
          activeRows = typeof db?.count === 'function' ? db.count() : 0;
          archiveRows = typeof db?.archiveCount === 'function' ? db.archiveCount() : 0;
          const since = Math.floor(Date.now() / 1000) - 7 * 86400;
          retrieval = typeof db?.t1RetrievalStats === 'function' ? db.t1RetrievalStats({ since }) : emptyStats;
          activation = typeof db?.t1ActivationStats === 'function'
            ? db.t1ActivationStats()
            : activation;
        } catch { /* fail-open */ }
        const totalRows = activeRows + archiveRows;
        const withExact = indexEntries.filter(
          (e: any) => Array.isArray(e.source_trace_ids) && e.source_trace_ids.length > 0,
        ).length;
        let activationRanking = {
          mode: config.recall.t1Recall?.activationRanking ?? 'shadow',
          evaluations: 0,
          wouldReorder: 0,
          applied: 0,
        };
        try {
          const { getT1RankingStats } = require('../recall/t1-search');
          activationRanking = { mode: config.recall.t1Recall?.activationRanking ?? 'shadow', ...getT1RankingStats() };
        } catch { /* fail-open: zero counters */ }
        let denseIndex = { mode: 'shadow', evaluations: 0, withDenseHits: 0 };
        try {
          const { getT1DenseStats } = require('../recall/t1-search');
          denseIndex = { mode: config.recall.t1Recall?.denseIndex ?? 'shadow', ...getT1DenseStats() };
        } catch { /* fail-open: zero counters */ }
        let code = {
          turns: 0,
          features: 0,
          actors: 0,
          concepts: 0,
          atomTurns: 0,
          atoms: 0,
        };
        try {
          const dbStats = (deps.getGatewayDb() as any).t1CodeStats;
          if (typeof dbStats === 'function') code = { ...code, ...dbStats.call(deps.getGatewayDb()) };
        } catch { /* fail-open: zero coverage */ }
        let calibrated = false;
        try {
          const { getT1AtomCalibration } = require('../recall/t1-semantic-atoms');
          calibrated = Boolean(getT1AtomCalibration());
        } catch { /* fail-open */ }
        return {
          vectors,
          activeRows,
          archiveRows,
          coverage: totalRows > 0 ? Math.min(1, vectors / totalRows) : 0,
          retrieval,
          provenance: {
            memories: indexEntries.length,
            withExact,
            coverage: indexEntries.length > 0 ? withExact / indexEntries.length : 0,
          },
          activation,
          activationRanking,
          denseIndex,
          semanticAtoms: config.recall.t1Recall?.semanticAtoms ?? 'on',
          atoms: {
            turns: code.atomTurns,
            atoms: code.atoms,
            avgPerTurn: code.atomTurns > 0 ? code.atoms / code.atomTurns : 0,
            calibrated,
          },
          code: {
            turns: code.turns,
            features: code.features,
            actors: code.actors,
            concepts: code.concepts,
          },
        };
      })();
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        embedding: {
          provider: config.memory.embedding.provider,
          model: config.memory.embedding.model,
          vectors: indexed,
          indexEntries: indexEntries.length,
          coverage: indexEntries.length > 0 ? indexed / indexEntries.length : 0,
        },
        t1,
        consolidation,
        routing: (() => { try { return getRouteStats(); } catch { return null; } })(),
        dedup: (() => { try { const { getDedupStats } = require('../memory/dedup-guard'); return getDedupStats(); } catch { return null; } })(),
        commitment: (() => {
          try {
            const { commitmentStats } = require('../recall/commitment');
            const inWindow = indexEntries.filter((e: any) => e.commitment_capped_at).length;
            return { ...commitmentStats, inWindow };
          } catch { return null; }
        })(),
        reconsolidation: (() => {
          try { return { eligible: getReconsolidationQueue().listEligible().length }; } catch { return null; }
        })(),
        pipelines: deps.heartbeat()?.snapshot() ?? [],
        coactivation: (() => {
          try { return deps.coactivationGraphStore()?.stats() ?? null; } catch { return null; }
        })(),
        abstractionLevels: (() => {
          const counts: Record<string, number> = { '1': 0, '2': 0, '3': 0, unknown: 0 };
          for (const e of indexEntries) {
            const lvl = (e as any).abstraction_level;
            if (lvl === 1 || lvl === 2 || lvl === 3) counts[String(lvl)]++;
            else counts.unknown++;
          }
          return counts;
        })(),
        // A4 observability: hit-proxy labeling counts (10s cache — the
        // file read must not run on every stats poll).
        fok: (() => {
          try {
            const now = Date.now();
            if (!deps.fokStatsCache() || now - deps.fokStatsCache()!.at > 10_000) {
              const { FOK_SAMPLES_FILE, fokSampleStats } = require('../recall/fok-samples');
              const lines = fs.existsSync(FOK_SAMPLES_FILE())
                ? fs.readFileSync(FOK_SAMPLES_FILE(), 'utf-8').split(/\r?\n/).filter(Boolean)
                : [];
              deps.setFokStatsCache({ at: now, stats: fokSampleStats(lines) });
            }
            return deps.fokStatsCache()!.stats;
          } catch { return null; }
        })(),
        // A3 observability: event stream counters (pending = unsettled
        // batch for the daily pass; needTracked = live need signals).
        retrievalEvents: (() => {
          try {
            return getRetrievalEventBuffer().stats();
          } catch { return null; }
        })(),
      }));
    } catch (err: any) {
      res.writeHead(500);
      res.end(JSON.stringify({ error: err.message }));
    }
  });

  // GET /api/memory/sticky — structured note-board list for desktop UI.
  // Same deps as the agent-facing recall/context block, JSON shape.
  registry.attachHandler('memory.listSticky', async (_req: IncomingMessage, res: ServerResponse) => {
    try {
      if (!deps.memoryService()) {
        res.writeHead(503, { 'Content-Type': 'application/json' });
        const { emptyNoteBoardBudget } = require('./note-board');
        res.end(JSON.stringify({ entries: [], budget: emptyNoteBoardBudget() }));
        return;
      }
      const { handleNoteBoard } = require('./note-board');
      const { HarmonicUnitFileStore } = require('../memory/harmonic-file-store.js');
      const store = new HarmonicUnitFileStore(deps.mafwDir(), deps.memoryService()!.harmonicIndex);
      const nb = await handleNoteBoard({
        getIndex: () => deps.memoryService()!.harmonicIndex.getIndex(),
        readUnit: (id: string) => store.read(id),
      });
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ entries: nb.entries, budget: nb.budget }));
    } catch (err: any) {
      log.warn(`[Scheduler] /api/memory/sticky failed: ${err.message}`);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      const { emptyNoteBoardBudget } = require('./note-board');
      res.end(JSON.stringify({ entries: [], budget: emptyNoteBoardBudget() }));
    }
  });

  // GET /api/memory/get?id=... — fetch one memory's full content by id
  // (or 6-char pointer tail). Mirrors the mafw_get_memory MCP tool.
  registry.attachHandler('memory.get', async (req: IncomingMessage, res: ServerResponse) => {
    try {
      const parsedUrl = new URL(req.url!, `http://${req.headers.host || 'localhost'}`);
      const id = parsedUrl.searchParams.get('id') || '';
      const { handleGetMemory } = require('../mcp/handlers/get-memory');
      const result = await handleGetMemory({ id }, {
        memory: deps.memoryService(),
        mafwDir: deps.mafwDir(),
        searchArchive: (sid: string, anchors: string[], k: number) => deps.getGatewayDb().searchArchive(sid, anchors, k),
        resolveT1: (tail: string, turnId: number) => deps.getGatewayDb().findT1BySessionTail(tail, turnId),
        readTrace: (traceId: string) => deps.getGatewayDb().readTrace(traceId),
        recordT1Retrieval: (traceId: string, kind: any, score?: number) =>
          deps.getGatewayDb().recordT1RetrievalEvent({ traceId, kind, score }),
        propagateT1Activation: (traceIds: string[]) => deps.getGatewayDb().propagateT1Activation(traceIds),
      } as any);
      const body = JSON.parse(result.content[0].text);
      res.writeHead(result.isError ? 404 : 200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(body));
    } catch (err: any) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: false, error: err.message }));
    }
  });

  // GET /api/memory/search — harmonic index search; empty query lists all entries
  registry.attachHandler('memory.search', async (req: IncomingMessage, res: ServerResponse) => {
    try {
      const parsedUrl = new URL(req.url!, `http://${req.headers.host || 'localhost'}`);
      const query = parsedUrl.searchParams.get('query') || '';
      const topK = parseInt(parsedUrl.searchParams.get('topK') || '50', 10);
      const layer = parsedUrl.searchParams.get('layer') || 'gist';
      if (!['gist', 't1', 'both', 'episodes', 'auto'].includes(layer)) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'invalid layer: use gist|t1|both|episodes|auto' }));
        return;
      }
      const wantsEpisodes = layer === 'episodes' || layer === 'auto';
      const episodesLive = config.recall.t1Episodes?.mode === 'live';
      let episodes: EpisodeHit[] | undefined;
      if (wantsEpisodes && (layer === 'episodes' || episodesLive)) {
        try {
          episodes = deps.searchEpisodes ? await deps.searchEpisodes(query, topK) : [];
        } catch { episodes = []; }
      }
      if (layer === 'episodes') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ results: [], t1Results: [], episodes: episodes ?? [] }));
        return;
      }
      let t1Results: any[] | undefined;
      if (layer === 't1' || layer === 'both') {
        t1Results = [];
        try {
          const hits = deps.searchT1 ? await deps.searchT1(query, topK) : [];
          t1Results = hits;
          const db: any = deps.getGatewayDb();
          if (typeof db?.recordT1RetrievalEvent === 'function') {
            for (const hit of hits) {
              if (hit.traceId) db.recordT1RetrievalEvent({ traceId: hit.traceId, kind: 'search', score: hit.score ?? hit.cosine });
            }
          }
        } catch { /* fail-open: T1 channel empty */ }
      }
      if (layer === 't1') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ results: [], t1Results }));
        return;
      }
      if (!deps.memoryService()) {
        res.writeHead(503); res.end(JSON.stringify({ error: 'Memory service not available' })); return;
      }
      const retrieverParam = parsedUrl.searchParams.get('retriever');
      const includeLegacyEpisodic = parsedUrl.searchParams.get('includeLegacyEpisodic') === 'true';
      const store = new HarmonicUnitFileStore(deps.mafwDir());
      const index = store.indexManager_();
      let entries;
      if (query && retrieverParam === 'hybrid') {
        const dense = await computeDenseScores(query, topK, index);
        entries = index.search(query, topK, {
          retriever: 'bm25',
          ...(dense ? { denseScores: dense } : {}),
          ...(includeLegacyEpisodic ? { includeLegacyEpisodic: true } : {}),
        });
      } else if (query) {
        const retriever = retrieverParam === 'bm25' ? 'bm25' : 'token';
        entries = index.search(query, topK, {
          retriever,
          ...(includeLegacyEpisodic ? { includeLegacyEpisodic: true } : {}),
        });
      } else {
        entries = [...index.getIndex().entries]
            .filter((entry: any) => includeLegacyEpisodic || !(entry.type === 'episodic' && !entry.pinned && !entry.sticky_until))
            .sort((a, b) => b.energy - a.energy)
            .slice(0, topK);
      }
      const results: any[] = [];
      for (const entry of entries) {
        const unit = await store.read(entry.id);
        if (unit) {
          results.push(unit);
        } else {
          results.push({
            id: entry.id,
            type: entry.type,
            primary_abstraction: entry.primary_abstraction,
            cue_anchors: entry.cue_anchors,
            memory_value: '',
            energy: entry.energy,
            tier: entry.tier,
          });
        }
      }
      const legacyEpisodic = includeLegacyEpisodic
        ? results.filter((unit: any) => unit.type === 'episodic')
        : undefined;
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        results,
        ...(legacyEpisodic ? { legacyEpisodic } : {}),
        ...(layer === 'both' ? { t1Results } : {}),
        ...(layer === 'auto' ? { t1Results: [], episodes: episodes ?? [] } : {}),
      }));
    } catch (err: any) {
      res.writeHead(500);
      res.end(JSON.stringify({ error: err.message }));
    }
  });

  // GET /api/memory/episodes — browse recent derived episodes (empty query ok).
  registry.attachHandler('memory.episodes', async (req: IncomingMessage, res: ServerResponse) => {
    try {
      const parsedUrl = new URL(req.url!, `http://${req.headers.host || 'localhost'}`);
      const limit = Math.min(200, Math.max(1, parseInt(parsedUrl.searchParams.get('limit') || '50', 10)));
      const cursor = parsedUrl.searchParams.get('cursor') || undefined;
      const sessionId = parsedUrl.searchParams.get('sessionId') || undefined;
      const sinceRaw = Number(parsedUrl.searchParams.get('since'));
      const since = Number.isFinite(sinceRaw) && sinceRaw > 0 ? sinceRaw : undefined;
      const page = deps.getGatewayDb().listEpisodes({ limit, cursor, sessionId, since });
      const episodes: EpisodeHit[] = page.episodes.map((episode) => ({
        episodeId: episode.episodeId,
        sessionId: episode.sessionId,
        startTurn: episode.startTurn,
        endTurn: episode.endTurn,
        status: episode.status,
        startedAt: episode.startedAt,
        boundarySource: episode.boundarySource,
        boundaryReason: episode.boundaryReason,
        intent: episode.intent,
        outcome: episode.outcome,
        actors: episode.actors.map((actor) => actor.actorId),
        conceptIds: episode.conceptIds,
        score: 0,
        sources: [],
        topTraceIds: episode.sourceTraceIds.slice(0, 3),
      }));
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ episodes, ...(page.nextCursor ? { nextCursor: page.nextCursor } : {}) }));
    } catch (err: any) {
      res.writeHead(500);
      res.end(JSON.stringify({ error: err?.message || String(err) }));
    }
  });

  // GET /api/memory/episodes/:id — episode metadata + member turn ids.
  registry.attachHandler('memory.getEpisode', async (_req: IncomingMessage, res: ServerResponse, params: Record<string, string>) => {
    try {
      const episode = deps.getGatewayDb().getEpisode(params.id);
      if (!episode) {
        res.writeHead(404);
        res.end(JSON.stringify({ error: 'episode not found' }));
        return;
      }
      const members = deps.getGatewayDb().listEpisodeMembers(episode.episodeId);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ episode, members }));
    } catch (err: any) {
      res.writeHead(500);
      res.end(JSON.stringify({ error: err?.message || String(err) }));
    }
  });

  // DELETE /api/memory/{id} — physically remove OKF file + index entry
  // registry 参数已 decode（legacy 用原始段），id 均为 hex 形式，语义等价。
  registry.attachHandler('memory.delete', async (_req: IncomingMessage, res: ServerResponse, params: Record<string, string>) => {
    const id = params.id;
    try {
      const store = new HarmonicUnitFileStore(deps.mafwDir());
      const removed = await store.delete(id);
      if (removed && deps.memoryService()) {
        deps.memoryService()!.harmonicIndex.removeEntry(id);
      }
      res.writeHead(removed ? 200 : 404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(removed ? { status: 'deleted' } : { error: 'Not found' }));
    } catch (err: any) {
      res.writeHead(500);
      res.end(JSON.stringify({ error: err.message }));
    }
  });

  // GET /api/memory/energy-distribution — bucket index entries by energy
  registry.attachHandler('memory.getEnergyDistribution', async (_req: IncomingMessage, res: ServerResponse) => {
    try {
      if (!deps.memoryService()) {
        res.writeHead(503); res.end(JSON.stringify({ error: 'Memory service not available' })); return;
      }
      const entries = new HarmonicUnitFileStore(deps.mafwDir()).indexManager_().getIndex().entries;
      const dist = { critical: 0, high: 0, medium: 0, low: 0, total: entries.length };
      for (const e of entries) {
        if (e.energy >= 0.8) dist.critical++;
        else if (e.energy >= 0.6) dist.high++;
        else if (e.energy >= 0.4) dist.medium++;
        else dist.low++;
      }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(dist));
    } catch (err: any) {
      res.writeHead(500);
      res.end(JSON.stringify({ error: err.message }));
    }
  });

  // GET /api/l5/axioms — global L5 axioms + heuristics
  registry.attachHandler('memory.getL5Axioms', async (req: IncomingMessage, res: ServerResponse) => {
    try {
      const parsedUrl = new URL(req.url!, `http://${req.headers.host || 'localhost'}`);
      const topK = parseInt(parsedUrl.searchParams.get('topK') || '10', 10);
      const { axioms, heuristics } = new L5Store().getTop(topK);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ axioms, heuristics }));
    } catch (err: any) {
      res.writeHead(500);
      res.end(JSON.stringify({ error: err.message }));
    }
  });
}
