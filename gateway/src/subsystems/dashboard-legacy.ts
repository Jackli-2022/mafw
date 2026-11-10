/**
 * Dashboard legacy dispatch (D3 Task 4, ruling R5).
 *
 * This is `MafwScheduler.handleDashboardAPI` moved VERBATIM out of the kernel:
 * the joint `/api/goals | /api/stats | /api/memory` catch-all handed to
 * `http/transport.ts` as the `dashboardDispatch` dep. Transport runs it only
 * after the dashboard joint branch, which MUST stay ordered BEFORE `/control`
 * (ruling R6) so the dead `/api/goals/control` alias stays shadowed.
 *
 * The four precise (method, path) pairs — goals.list / dashboard.stats /
 * memory.add / memory.setSticky — are registry-first since D1 Task G, so those
 * arms here are dead-but-retained (R5): they still serve the method-agnostic
 * phantom shapes (`/api/stats*`, `/api/goals*`, the `/api/memory` catch-all).
 * Behavior edits belong in the registry handler (`routes/dashboard.ts`).
 *
 * Response semantics are preserved exactly: the function RETURNS the JSON body
 * and never touches the response. `http/transport.ts` sets
 * `Content-Type: application/json`, writes status 200 and `JSON.stringify`s the
 * returned value — so even `{success:false,error}` bodies are HTTP 200.
 *
 * Cycle safety: type-only deps, no runtime import of the kernel/entry; every
 * reassigned kernel field is threaded as a live getter (D1 discipline). The
 * lazy `require()`s are re-anchored `./…` → `../…` because this file sits one
 * level deeper than the kernel (Global Constraint: lazy-require hazard).
 *
 * Spec: 2026-11-09-gateway-kernel-microkernel-design.md §5.2.
 */
import type { IncomingMessage } from 'http';
import { config } from '../config';
import { log } from '../core/utils/logger';
import { abstractionLevelFor } from '../core/memory/abstraction-level';
import { getRouteWriteDeps, routeAndWrite } from '../memory/route-write';
import type { MemoryService } from '../memory/service';
import type { TrajectoryStore } from '../trajectory/trajectory-store';

export interface DashboardLegacyDeps {
  /** live Map 引用（legacy 每次读 this.activeGoals，从不按值捕获）。 */
  activeGoals: () => Map<string, any>;
  registeredProjectsSize: () => number;
  sseClientsSize: () => number;
  serveRunning: () => boolean;
  trajectoryStore: () => TrajectoryStore | null;
  memoryService: () => MemoryService | null | undefined;
  /** Late-bound DB (the memory.add shadow branch validates T1 provenance). */
  getGatewayDb: () => import('../memory/gateway-db').GatewayDatabase;
}

export async function handleDashboardAPI(req: IncomingMessage, deps: DashboardLegacyDeps): Promise<any> {
  // Dead since D1 Task G: registry (routes/dashboard.ts) owns this exact pair; edit there.
  // Retained for catch-all shapes (R5).
  if (req.url?.startsWith("/api/goals")) {
    return {
      goals: Array.from(deps.activeGoals().values()).map(s => ({
        goalId: s.goalId,
        phase: s.phase,
        loop: s.loop,
        nextAction: s.nextAction,
        error: s.error || null,
        updatedAt: s.updatedAt,
      })),
    };
  }
  // Dead since D1 Task G: registry (routes/dashboard.ts) owns this exact pair; edit there.
  // Retained for catch-all shapes (R5).
  if (req.url?.startsWith("/api/stats")) {
    const base = {
      activeGoals: deps.activeGoals().size,
      registeredProjects: deps.registeredProjectsSize(),
      sseClients: deps.sseClientsSize(),
      serveRunning: deps.serveRunning(),
    };
    try {
      const store = deps.trajectoryStore();
      if (store) {
        const global = store.getGlobalTokenSummary();
        return { ...base, tokens: global };
      }
    } catch (err: any) {
      log.warn(`[Stats] token summary failed: ${err.message}`);
    }
    return base;
  }
  // Dead since D1 Task G: registry (routes/dashboard.ts) owns this exact pair; edit there.
  // Retained for catch-all shapes (R5).
  if (req.url === '/api/memory/add' && req.method === 'POST') {
    const body = await new Promise<string>((resolve) => {
      let b = '';
      req.on('data', (c: Buffer) => (b += c.toString('utf-8')));
      req.on('end', () => resolve(b));
    });
    try {
      const data = JSON.parse(body);
      const content = String(data?.content || '').trim();
      const memoryType = String(data?.memoryType || 'semantic');
      if (!content || !['episodic', 'semantic', 'procedural', 'global'].includes(memoryType)) {
        return { success: false, error: 'content and valid memoryType required' };
      }
      // V2 ①b L1: exact-content guard — skip verbatim re-submits (worker
      // double-writes). LRU is in-memory; read-time collapse backstops.
      if (config.memory.dedup?.exactHash !== false) {
        const { exactHashOf, seenExactHash } = require('../memory/dedup-guard.js');
        if (seenExactHash(exactHashOf(content))) {
          return { success: true, deduped: true, reason: 'exact-hash' };
        }
      }
      const { normalizeAuthority } = require('../core/memory/harmonic-types.js');
      const authority = normalizeAuthority(data?.authority);
      if (authority === null) {
        return { success: false, error: `invalid authority: ${String(data?.authority)} (user|agent|tool|pipeline)` };
      }
      if (!deps.memoryService()) return { success: false, error: 'memoryService not ready' };
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
      // Exact T1 provenance (validated against live identity; unknown dropped).
      const sourceTraceIds = require('../core/memory/provenance').normalizeSourceTraceIds(
        data?.sourceTraceIds,
        (id: string) => deps.getGatewayDb().hasTrace(id),
      );
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
      };
      let supersedesTarget: any = null;
      if (data?.supersedes) {
        const sid = String(data.supersedes);
        supersedesTarget = deps.memoryService()!.harmonicIndex.getIndex().entries.find((e: any) => e.id === sid);
        if (!supersedesTarget) return { success: false, error: `supersedes target not found: ${sid}` };
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
        return {
          success: true,
          id: routed.id,
          deduped: routed.action === 'skip' ? true : undefined,
          updated: routed.action === 'update' ? routed.targetId : undefined,
          sticky_until: routed.action === 'create' ? (unit as any).sticky_until : undefined,
        };
      }
      await store.write(unit);
      if (supersedesTarget && !supersedesTarget.superseded_by) {
        store.markSuperseded(supersedesTarget.id, unit.id);
      }
      return { success: true, id: unit.id, sticky_until: (unit as any).sticky_until };
    } catch (err: any) {
      log.warn(`[Scheduler] /api/memory/add failed: ${err.message}`);
      return { success: false, error: err.message };
    }
  }
  // Dead since D1 Task G: registry (routes/dashboard.ts) owns this exact pair; edit there.
  // Retained for catch-all shapes (R5).
  if (req.url === '/api/memory/pin' && req.method === 'POST') {
    const body = await new Promise<string>((resolve) => {
      let b = '';
      req.on('data', (c: Buffer) => (b += c.toString('utf-8')));
      req.on('end', () => resolve(b));
    });
    try {
      const data = JSON.parse(body);
      const id = String(data?.id || '');
      if (!id) return { success: false, error: 'id required' };
      if (!deps.memoryService()) return { success: false, error: 'memoryService not ready' };
      const { HarmonicUnitFileStore } = require('../memory/harmonic-file-store.js');
      const store = new HarmonicUnitFileStore(config.resolvePath(), deps.memoryService()!.harmonicIndex);
      const pinned = data?.pinned === true;
      const hasSticky = typeof data?.sticky === 'boolean';
      if (hasSticky) {
        const days = typeof data?.stickyDays === 'number' && data.stickyDays > 0 ? data.stickyDays : 7;
        const until = data.sticky === true ? new Date(Date.now() + days * 86400e3).toISOString() : null;
        const ok = store.setSticky(id, until);
        if (!ok) return { success: false, error: `memory not found: ${id}` };
        return { success: true, id, sticky: data.sticky === true, sticky_until: until ?? undefined };
      }
      const ok = store.setPinned(id, pinned);
      if (!ok) return { success: false, error: `memory not found: ${id}` };
      return { success: true, id, pinned };
    } catch (err: any) {
      log.warn(`[Scheduler] /api/memory/pin failed: ${err.message}`);
      return { success: false, error: err.message };
    }
  }
  if (req.url?.startsWith("/api/memory")) {
    return { status: "ok", message: "Memory API not yet implemented" };
  }
  return { error: "Unknown endpoint" };
}
