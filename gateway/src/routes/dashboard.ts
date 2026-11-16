/**
 * Phase D1 Task G: dashboard 影子条的 registry dispatch 接线（零删除）。
 *
 *   GET  /api/goals        — 活跃 goal 列表（goals.list, SDK_FACING）
 *   GET  /api/stats        — 运行时计数 + 全局 token 汇总（dashboard.stats, NON_SDK）
 *   POST /api/memory/add   — 记忆写入管线（memory.add, NON_SDK）
 *   POST /api/memory/pin   — pinned / sticky 切换（memory.setSticky, SDK_FACING）
 *
 * 这四条是 handleDashboardAPI（index.ts 的返回对象式总分发器）里的**精确匹配**
 * 分支；R5 裁决下该分发器与其联合分支整体保留，继续服务 method-agnostic
 * `/api/stats*`、`/api/goals*` 未登记形状与 `/api/memory` catch-all。registry
 * dispatch 先于 legacy 链，因此这四个 (method, path) 被 registry 接管，legacy
 * 里的同名分支成为 dead-but-retained。E3 fix 删除了 goals.loops/loopsAt 的
 * catalog 误登记（catch-all 实际返回 goals 列表，形状不对；请求仍落此兜底）。
 *
 * 翻译规则（binding）：legacy 每个分支 `return {…}`，调用方统一
 * `res.setHeader('Content-Type','application/json')` + `JSON.stringify` + `end`，
 * **没有 writeHead** → 任何 `{success:false,error}` 也是 200。这里逐字保持：
 * `res.end(JSON.stringify({…}))`、不写 head、try/catch 与 log.warn 原文照搬、
 * 抛错不外捕（沿 dispatchAuthorized / 外层 500，与 legacy 同）。
 *
 * 懒 require()（dedup-guard / harmonic-types / harmonic-file-store /
 * salience-perceptor / judge-salience / embedding-runtime / turn-pipeline /
 * commitment / worker-origin）全部保持 handler 内惰性加载。
 * Spec: 2026-11-09-gateway-kernel-microkernel-design.md §5.2.
 */
import type { IncomingMessage, ServerResponse } from 'http';
import { config } from '../config';
import { log } from '../core/utils/logger';
import { abstractionLevelFor } from '../core/memory/abstraction-level';
import { isKnownMemoryType, memoryTypeWarnings, normalizeMemoryType } from '../core/memory/memory-type';
import { getRouteWriteDeps, routeAndWrite } from '../memory/route-write';
import type { MemoryService } from '../memory/service';
import type { TrajectoryStore } from '../trajectory/trajectory-store';
import { readRouteBody } from './cognition';
import type { RouteRegistry } from './registry';

export interface DashboardRouteDeps {
  /** live Map 引用（legacy 每次读 this.activeGoals）。 */
  activeGoals: () => Map<string, any>;
  registeredProjectsSize: () => number;
  sseClientsSize: () => number;
  serveRunning: () => boolean;
  trajectoryStore: () => TrajectoryStore | null;
  memoryService: () => MemoryService | null | undefined;
  /**
   * E2-5: event_log append 失败累计（EventStore.appendFailures()）。
   * null / undefined = 无持久 event store（纯直播部署）→ 字段省略，保持旧形状。
   */
  eventAppendFailures?: () => number | null;
  /**
   * E4-6b: live 资源压力（governor.pressure() 的窄面）。
   * `disk === 'critical'` 或 `degraded` 含 `disk_critical` → memory.add 拒写
   * （200 壳 + `code:'disk_low'`，不落盘）。null = 无 governor（fail-open）。
   */
  pressure?: () => { disk: string; degraded: string[] } | null;
  /** Exact T1 provenance validation for memory.add (defaults to drop all). */
  hasTrace?: (traceId: string) => boolean;
  /** Map a source trace to its T1 episode (optional; soft hint on the memory). */
  findEpisodeByTrace?: (traceId: string) => string | null;
}

export function attachDashboardRoutes(registry: RouteRegistry, deps: DashboardRouteDeps): void {
  // GET /api/goals — active goal states
  registry.attachHandler('goals.list', async (_req: IncomingMessage, res: ServerResponse) => {
    res.end(JSON.stringify({
      goals: Array.from(deps.activeGoals().values()).map(s => ({
        goalId: s.goalId,
        phase: s.phase,
        loop: s.loop,
        nextAction: s.nextAction,
        error: s.error || null,
        updatedAt: s.updatedAt,
      })),
    }));
  });

  // GET /api/stats — runtime counters (+ optional global token summary)
  registry.attachHandler('dashboard.stats', async (_req: IncomingMessage, res: ServerResponse) => {
    const appendFailures = deps.eventAppendFailures?.() ?? null;
    const base = {
      activeGoals: deps.activeGoals().size,
      registeredProjects: deps.registeredProjectsSize(),
      sseClients: deps.sseClientsSize(),
      serveRunning: deps.serveRunning(),
      // E2-5: 只在有持久 event store 时出现（纯直播部署保持旧 payload 形状）。
      ...(appendFailures !== null ? { eventAppendFailures: appendFailures } : {}),
    };
    try {
      const store = deps.trajectoryStore();
      if (store) {
        const global = store.getGlobalTokenSummary();
        res.end(JSON.stringify({ ...base, tokens: global }));
        return;
      }
    } catch (err: any) {
      log.warn(`[Stats] token summary failed: ${err.message}`);
    }
    res.end(JSON.stringify(base));
  });

  // POST /api/memory/add — memory write pipeline
  registry.attachHandler('memory.add', async (req: IncomingMessage, res: ServerResponse) => {
    // R3 accepted deviation: legacy 手写 req.on('data'/'end') reader（socket error 会挂住）；
    // readRouteBody 的 error 事件 reject → 未捕获上抛 → 外层 500。读取位置保持
    // 在 try 之外（与 legacy 一致）。
    const body = await readRouteBody(req);
    try {
      const data = JSON.parse(body);
      const content = String(data?.content || '').trim();
      const requestedType = String(data?.memoryType || 'semantic');
      const memoryType = normalizeMemoryType(requestedType);
      const warnings = memoryTypeWarnings(requestedType);
      if (!content || !isKnownMemoryType(requestedType)) {
        res.end(JSON.stringify({ success: false, error: 'content and valid memoryType required' }));
        return;
      }
      // Authority 校验先于判压与 dedup：无效输入始终回既有错误（即使盘满）。
      const { normalizeAuthority } = require('../core/memory/harmonic-types.js');
      const authority = normalizeAuthority(data?.authority);
      if (authority === null) {
        res.end(JSON.stringify({ success: false, error: `invalid authority: ${String(data?.authority)} (user|agent|tool|pipeline)` }));
        return;
      }
      // E4-6b: disk critical → 拒写（在全部输入校验之后、dedup/写之前：合法输入
      // 不落盘也不推进 exact-hash 状态）。
      const pressure = deps.pressure?.() ?? null;
      if (pressure && (pressure.disk === 'critical' || pressure.degraded.includes('disk_critical'))) {
        res.end(JSON.stringify({ success: false, error: 'disk space critical', code: 'disk_low' }));
        return;
      }
      // V2 ①b L1: exact-content guard — skip verbatim re-submits (worker
      // double-writes). LRU is in-memory; read-time collapse backstops.
      if (config.memory.dedup?.exactHash !== false) {
        const { exactHashOf, seenExactHash } = require('../memory/dedup-guard.js');
        if (seenExactHash(exactHashOf(content))) {
          res.end(JSON.stringify({ success: true, deduped: true, reason: 'exact-hash' }));
          return;
        }
      }
      if (!deps.memoryService()) { res.end(JSON.stringify({ success: false, error: 'memoryService not ready' })); return; }
      const { HarmonicUnitFileStore } = require('../memory/harmonic-file-store.js');
      const { generateHarmonicId } = require('../core/memory/harmonic-types.js');
      const { importanceToSalience } = require('../core/memory/salience-perceptor.js');
      const { judgeSalience } = require('../judge/salience.js');
      const { getEmbeddingRuntime } = require('../memory/embedding-runtime.js');
      const store = new HarmonicUnitFileStore(config.resolvePath(), deps.memoryService()!.harmonicIndex);
      const now = new Date().toISOString();
      let novelty: number | undefined;
      try {
        const rt = getEmbeddingRuntime();
        if (rt) {
          const [v] = await rt.provider.embed([content], 'document');
          if (v) {
            const hits = rt.vectors.searchByCosine(v, 1);
            novelty = hits.length > 0 ? 1 - hits[0].cosine : 1;
          }
        }
      } catch { /* fail-open */ }
      const salience = typeof data?.importance === 'number' && Number.isFinite(data.importance)
        ? importanceToSalience(data.importance)
        : judgeSalience({ text: content, novelty }).score;
      const sourceTraceIds = require('../core/memory/provenance.js').normalizeSourceTraceIds(
        data?.sourceTraceIds,
        (id: string) => (deps.hasTrace ? deps.hasTrace(id) : false),
      );
      const episodeId = sourceTraceIds.length > 0 && deps.findEpisodeByTrace
        ? deps.findEpisodeByTrace(sourceTraceIds[0])
        : null;
      const unit = {
        id: generateHarmonicId(),
        type: memoryType,
        primary_abstraction: String(data?.primaryAbstraction || content).slice(0, 200),
        cue_anchors: Array.isArray(data?.cueAnchors) ? data.cueAnchors.slice(0, 8).map(String) : [],
        memory_value: content.slice(0, 4000),
        energy: 0.8,
        salience,
        novelty,
        abstraction_level: abstractionLevelFor(memoryType),
        created_at: now,
        updated_at: now,
        pinned: data?.pinned === true || undefined,
        // G1: provenance authority — default 'agent' (direct agent write);
        // absent field on legacy entries is treated as 'pipeline' downstream.
        authority: authority ?? 'agent',
        // Sticky note board parity with the MCP mafw_add_memory handler.
        ...(data?.sticky === true ? {
          sticky_until: new Date(Date.now() + (typeof data?.stickyDays === 'number' && data.stickyDays > 0 ? data.stickyDays : 7) * 86400e3).toISOString(),
        } : {}),
        // V1 provenance: pipeline workers write via HTTP with their own
        // session id — map back to the source session for C0 reconstruction.
        source_session_id: (data?.sessionID && require('../recall/worker-origin').resolveWorkerOrigin(String(data.sessionID))) || (data?.sessionID ? String(data.sessionID) : undefined),
        ...(sourceTraceIds.length > 0 ? { source_trace_ids: sourceTraceIds } : {}),
        ...(episodeId ? { episode_id: episodeId } : {}),
      };
      let supersedesTarget: any = null;
      if (data?.supersedes) {
        const sid = String(data.supersedes);
        supersedesTarget = deps.memoryService()!.harmonicIndex.getIndex().entries.find((e: any) => e.id === sid);
        if (!supersedesTarget) { res.end(JSON.stringify({ success: false, error: `supersedes target not found: ${sid}` })); return; }
        unit.energy = Math.max(unit.energy, supersedesTarget.energy ?? 0);
      }
      // A2: tentative draft abstractions are energy-capped at write time
      // until the daily reflection pipeline promotes or discards them.
      try {
        const { capTentativeEnergy } = require('../recall/turn-pipeline');
        Object.assign(unit, capTentativeEnergy(unit as any));
      } catch { /* fail-open */ }
      // V2 ⑦: commitment gradient — pipeline worker first-pass writes cap
      // at 0.6; manual/user writes are exempt. Worker detection via the
      // V1 origin registry (registered = pipeline worker session).
      try {
        const { capCommitment } = require('../recall/commitment');
        const isPipelineWorker = Boolean(
          data?.sessionID && require('../recall/worker-origin').resolveWorkerOrigin(String(data.sessionID)));
        Object.assign(unit, capCommitment(unit as any, {
          isPipeline: isPipelineWorker,
          enabled: config.recall?.commitmentGradient !== false,
        }));
      } catch { /* fail-open */ }
      const routeDeps = getRouteWriteDeps();
      if (routeDeps) {
        const routed = await routeAndWrite(unit as any, store as any, routeDeps);
        if (routed.action === 'create' && supersedesTarget && !supersedesTarget.superseded_by) {
          store.markSuperseded(supersedesTarget.id, unit.id);
        }
        res.end(JSON.stringify({
          success: true,
          id: routed.id,
          deduped: routed.action === 'skip' ? true : undefined,
          updated: routed.action === 'update' ? routed.targetId : undefined,
          sticky_until: routed.action === 'create' ? (unit as any).sticky_until : undefined,
          ...(warnings.length > 0 ? { warnings } : {}),
        }));
        return;
      }
      await store.write(unit);
      if (supersedesTarget && !supersedesTarget.superseded_by) {
        store.markSuperseded(supersedesTarget.id, unit.id);
      }
      res.end(JSON.stringify({ success: true, id: unit.id, sticky_until: (unit as any).sticky_until, ...(warnings.length > 0 ? { warnings } : {}) }));
    } catch (err: any) {
      log.warn(`[Scheduler] /api/memory/add failed: ${err.message}`);
      res.end(JSON.stringify({ success: false, error: err.message }));
    }
  });

  // POST /api/memory/pin — toggle pinned flag / sticky window
  registry.attachHandler('memory.setSticky', async (req: IncomingMessage, res: ServerResponse) => {
    // R3 accepted deviation: readRouteBody 取代手写 reader（socket error → 外层 500）。
    const body = await readRouteBody(req);
    try {
      const data = JSON.parse(body);
      const id = String(data?.id || '');
      if (!id) { res.end(JSON.stringify({ success: false, error: 'id required' })); return; }
      if (!deps.memoryService()) { res.end(JSON.stringify({ success: false, error: 'memoryService not ready' })); return; }
      const { HarmonicUnitFileStore } = require('../memory/harmonic-file-store.js');
      const store = new HarmonicUnitFileStore(config.resolvePath(), deps.memoryService()!.harmonicIndex);
      const pinned = data?.pinned === true;
      const hasSticky = typeof data?.sticky === 'boolean';
      if (hasSticky) {
        const days = typeof data?.stickyDays === 'number' && data.stickyDays > 0 ? data.stickyDays : 7;
        const until = data.sticky === true ? new Date(Date.now() + days * 86400e3).toISOString() : null;
        const ok = store.setSticky(id, until);
        if (!ok) { res.end(JSON.stringify({ success: false, error: `memory not found: ${id}` })); return; }
        res.end(JSON.stringify({ success: true, id, sticky: data.sticky === true, sticky_until: until ?? undefined }));
        return;
      }
      const ok = store.setPinned(id, pinned);
      if (!ok) { res.end(JSON.stringify({ success: false, error: `memory not found: ${id}` })); return; }
      res.end(JSON.stringify({ success: true, id, pinned }));
    } catch (err: any) {
      log.warn(`[Scheduler] /api/memory/pin failed: ${err.message}`);
      res.end(JSON.stringify({ success: false, error: err.message }));
    }
  });
}
