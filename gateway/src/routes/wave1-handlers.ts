/**
 * P5 Wave 1 鈥?鎶?routes/*.ts 鏃㈡湁妯″潡鐨?handler 缁戝畾鍒?shadow catalog 鐨? * operationId 涓婏紙registry.attachHandler锛夛紝index.ts 涓诲惊鐜《绔粺涓€ dispatch銆? *
 * 杩佺Щ鑼冨洿锛?2 鏉★級锛歞eps 璧?gateway 瀹炰緥鏃㈡湁 helper锛坮otateDeps 绛夛級鎴栬交閲忛棴鍖咃紝
 * 鏃犲唴鑱斿墠缃畧鍗€俽untime脳4 / plugins脳5锛坧luginHubDeps 閲?preamble + 409 瀹堝崼锛? * 鐣?Wave 2锛汚2A/SSE/鍙嶄唬/MCP 姘镐箙鍐呰仈銆? *
 * 绾﹀畾锛氬簳灞?handleX 杩斿洖 false锛堝唴閮ㄦ鍒欐湭鍛戒腑锛夆啋 閫忎紶鍥?legacy 閾撅紱
 * void 瑙嗕负宸插鐞嗐€傛瘡涓棴鍖呭繀椤讳笌琚€€褰圭殑鍐呰仈璋冪敤鐐硅涓洪€愬瓧鑺傜瓑浠枫€? */
import * as http from 'http';
import { config } from '../config';
import type { AgentRuntime } from '../runtime/contract';
import type { RouteRegistry, RouteDef } from './registry';
import { handleGoalSessions } from './goal-sessions';
import { handleTriageDismiss } from './triage-dismiss';
import { handleManagerRotate, type ManagerRotateDeps } from './manager-rotate';
import { handleEmbeddingConfigGet, handleEmbeddingConfigUpdate, type EmbeddingConfigDeps } from './embedding-config';
import { handleModelConfigGet, handleModelConfigUpdate, type ModelConfigDeps } from './model-config';
import { handleSessionBranch } from './session-branch';
import { handleSessionCheckpoints } from './session-checkpoints';
import { handleSessionRun } from './session-run';
import { handleSessionData } from './session-data';
import {
  handleLegacyCommand,
  handleLegacySkill,
  handleSessionDiscovery,
  handleSessionDiscoveryRefresh,
  handleSessionDiscoverySkill,
} from './session-discovery';
import type { DiscoveryService } from '../core/discovery/discovery-service';
import { handleSessionDiff, handleSessionDiffRevert } from './session-diff';
import { cleanupWorktreeForSession } from './session-worktree';
import { handleSessionMutations, type SessionMutationDeps } from './session-mutations';
import { handleSessionSwitch } from './session-switch';
import { handleStructuredGet, handleStructuredSubmit } from './structured';
import { structuredOutput } from '../runtime/structured-output';
import type { TaskService } from '../runtime/task-service';
import type { SessionConfigService } from '../core/session-config';
import type { PodService } from '../core/pod/pod-service';
import { handleSessionConfigGet, handleSessionConfigSet } from './session-config';
import {
  handleTaskCancel, handleTaskGet, handleTaskList, handleTaskMessage,
  handleTaskOutput, handleTaskSubmit, parseTaskOutputQuery,
} from './tasks';
import { handleSessionSummarize } from './session-summarize';
import { handleEventPublish } from './event-publish';
import { handleMediaSwitch } from './media-switch';
import {
  handleUsagePluginsList, handleUsagePluginCreate, handleUsagePluginSourceGet,
  handleUsagePluginSourcePut, handleUsagePluginTest, handleUsagePluginDelete,
  type UsagePluginsDeps,
} from './usage-plugins';

/** gateway 瀹炰緥鐨勬渶灏忎緷璧栭潰锛堝彧澹版槑 Wave 1 闂寘瀹為檯鐢ㄥ埌鐨勬垚鍛橈級銆?*/
export interface Wave1Gateway {
  getGatewayDb(): { listGoalSessions(goalId: string): any };
  runtime: import('../runtime/runtime-facade').RuntimeFacade | null;
  automationEngine?: { rejectTriage(id: string): boolean } | null;
  ledger?: { append(entry: unknown): void } | null;
  rotateDeps(): ManagerRotateDeps;
  embeddingConfigDeps(): EmbeddingConfigDeps;
  modelConfigDeps(): ModelConfigDeps;
  usagePluginsDeps(): UsagePluginsDeps;
  pluginLoader?: { reload(): Promise<void> } | null;
  mediaPluginLoader?: { reload(): Promise<void>; getState(): { name?: string }[] } | null;
  broadcast(event: { type: string; [key: string]: any }): void;
  /** 鏈煡浜嬩欢閬ユ祴锛堟墎骞抽潪 plugin:* 鍙戝竷锛涚己鐪佷笉閲囬泦锛夈€?*/
  recordUnknownEvent?(type: string): void;
  runtimeCaps: SessionMutationDeps['getCapabilities'] extends () => infer C ? C : never;
  taskService?: TaskService | null;
  sessionConfig?: SessionConfigService | null;
  checkpointService?: import('../core/checkpoint/checkpoint-service').CheckpointService | null;
  podService?: PodService | null;
  runCoordinator?: import('../core/run/run-coordinator').RunCoordinator | null;
  dataPartService?: import('../core/data-parts/data-part-service').DataPartService | null;
  discovery?: DiscoveryService | null;
  /** T2-1锛氬洖鍚堣繘琛屼腑绂佹妫€鏌ョ偣 restore/create锛坓ateway-side apply 鏃?serve busy 淇濇姢锛夈€?*/
  isCheckpointBusy?(sessionID: string): boolean;
}

type Handler = NonNullable<RouteDef['handler']>;

/** 缁戝畾 Wave 1 鐨?22 鏉¤矾鐢便€俰ndex.ts 鍦?createServer 涔嬪墠璋冪敤涓€娆°€?*/
export function attachWave1Handlers(registry: RouteRegistry, gw: Wave1Gateway): void {
  const H = (fn: Handler) => fn;

  registry.attachHandler('goals.sessions', H(async (req, res, params) =>
    handleGoalSessions(req, res, req.url || '', {
      listGoalSessions: (goalId: string) => gw.getGatewayDb().listGoalSessions(goalId),
      getSession: (sessionID: string) => gw.runtime?.session.get({ sessionID }).catch(() => null),
    })));

  registry.attachHandler('triage.dismiss', H(async (req, res, params) =>
    handleTriageDismiss(req, res, req.url || '', {
      rejectTriage: (id: string) => gw.automationEngine?.rejectTriage(id) ?? false,
      appendLedger: (entry) => gw.ledger?.append(entry),
    })));
  registry.attachHandler('manager.rotate', H(async (req, res) =>
    handleManagerRotate(req, res, gw.rotateDeps())));

  registry.attachHandler('embedding.get', H(async (req, res) =>
    handleEmbeddingConfigGet(req, res, gw.embeddingConfigDeps())));
  registry.attachHandler('embedding.update', H(async (req, res) =>
    handleEmbeddingConfigUpdate(req, res, gw.embeddingConfigDeps())));

  registry.attachHandler('models.get', H(async (req, res) =>
    handleModelConfigGet(req, res, gw.modelConfigDeps())));
  registry.attachHandler('models.update', H(async (req, res) =>
    handleModelConfigUpdate(req, res, gw.modelConfigDeps())));

  registry.attachHandler('session.fork', H(async (req, res, params) =>
    handleSessionBranch(req, res, req.url || '', { getRuntime: () => gw.runtime, getAccess: () => gw.runtime?.access ?? null })));
  registry.attachHandler('session.revert', H(async (req, res, params) =>
    handleSessionBranch(req, res, req.url || '', { getRuntime: () => gw.runtime, getAccess: () => gw.runtime?.access ?? null })));
  registry.attachHandler('session.unrevert', H(async (req, res, params) =>
    handleSessionBranch(req, res, req.url || '', { getRuntime: () => gw.runtime, getAccess: () => gw.runtime?.access ?? null })));

  registry.attachHandler('session.diff', H(async (req, res, params) => {
    const u = new URL(req.url || '/', 'http://x');
    await handleSessionDiff(res, params.id, u.searchParams.get('messageID') ?? undefined, { runtime: gw.runtime });
  }));
  registry.attachHandler('session.revertDiff', H(async (req, res, params) =>
    handleSessionDiffRevert(req, res, params.id, { runtime: gw.runtime })));

  for (const op of ['session.checkpoint', 'session.checkpoints', 'session.restoreCheckpoint'] as const) {
    registry.attachHandler(op, H(async (req, res) =>
      handleSessionCheckpoints(req, res, req.url || '', {
        getRuntime: () => gw.runtime,
        checkpoints: gw.checkpointService ?? undefined,
        isBusy: (sid) => gw.isCheckpointBusy?.(sid) ?? false,
      })));
  }

  for (const op of ['session.suspend', 'session.resume', 'session.run', 'session.discardRun'] as const) {
    registry.attachHandler(op, H(async (req, res) =>
      handleSessionRun(req, res, req.url || '', {
        getRuntime: () => gw.runtime,
        run: gw.runCoordinator ?? undefined,
      })));
  }

  registry.attachHandler('session.data', H(async (req, res) =>
    handleSessionData(req, res, req.url || '', {
      getRuntime: () => gw.runtime,
      data: gw.dataPartService ?? undefined,
    })));

  for (const op of ['session.discovery', 'session.discoveryRefresh', 'session.discoverySkill'] as const) {
    registry.attachHandler(op, H(async (req, res, params) => {
      const deps = { discovery: gw.discovery ?? null };
      if (op === 'session.discovery') return handleSessionDiscovery(req, res, params, deps);
      if (op === 'session.discoveryRefresh') return handleSessionDiscoveryRefresh(req, res, params, deps);
      return handleSessionDiscoverySkill(req, res, params, deps);
    }));
  }
  registry.attachHandler('command.list', H(async (req, res) =>
    handleLegacyCommand(req, res, { discovery: gw.discovery ?? null })));
  registry.attachHandler('skill.list', H(async (req, res) =>
    handleLegacySkill(req, res, { discovery: gw.discovery ?? null })));

  registry.attachHandler('session.delete', H(async (req, res) =>
    handleSessionMutations(req, res, {
      getCapabilities: () => gw.runtimeCaps,
      getClient: () => (gw.runtime ?? null) as any,
      cleanupWorktree: (sid) => {
        const db = (gw as any).getGatewayDb?.();
        if (!db) return Promise.resolve();
        return cleanupWorktreeForSession({
          kvGet: (key, id) => db.kvGet(key, id),
          kvSet: (key, id, v) => db.kvSet(key, id, v),
          kvDel: (key, id) => db.kvDelete(key, id),
          createSession: async () => ({ id: '' }),
        }, sid);
      },
      deleteCheckpoints: (sid) => gw.checkpointService?.deleteForSession(sid),
      beforeDelete: async (sid) => {
        if (!gw.podService) return;
        try {
          await gw.podService.snapshotSession(sid);
        } catch {
          gw.podService.finalizeMissingSession(sid);
        }
      },
      deleteRuns: (sid) => gw.runCoordinator?.deleteForSession(sid),
      deleteDataParts: (sid) => gw.dataPartService?.deleteForSession(sid),
      forgetDiscovery: (sid) => gw.discovery?.forget(sid),
    })));
  registry.attachHandler('session.rename', H(async (req, res) =>
    handleSessionMutations(req, res, {
      getCapabilities: () => gw.runtimeCaps,
      getClient: () => (gw.runtime ?? null) as any,
    })));

  registry.attachHandler('session.switchAgent', H(async (req, res, params) =>
    handleSessionSwitch(req, res, params.id, 'agent', {
      getClient: () => (gw.runtime ?? null) as any,
    })));

  registry.attachHandler('session.switchModel', H(async (req, res, params) =>
    handleSessionSwitch(req, res, params.id, 'model', {
      getClient: () => (gw.runtime ?? null) as any,
    })));

  registry.attachHandler('structured.submit', H(async (req, res) =>
    handleStructuredSubmit(req, res, { service: structuredOutput })));

  registry.attachHandler('session.structured', H(async (_req, res, params) =>
    handleStructuredGet(res, params.id, { service: structuredOutput })));

  const taskDeps = () => ({ service: gw.taskService ?? null });
  registry.attachHandler('tasks.submit', H(async (req, res) => handleTaskSubmit(req, res, taskDeps())));
  registry.attachHandler('tasks.list', H(async (req, res) => {
    const u = new URL(req.url || '/', 'http://x');
    handleTaskList(res, {
      ...(u.searchParams.get('parentSessionID') ? { parentSessionID: u.searchParams.get('parentSessionID')! } : {}),
      ...(u.searchParams.get('status') ? { status: u.searchParams.get('status')! } : {}),
    }, taskDeps());
  }));
  registry.attachHandler('tasks.get', H(async (_req, res, params) => handleTaskGet(res, params.id, taskDeps())));
  registry.attachHandler('tasks.cancel', H(async (_req, res, params) => handleTaskCancel(res, params.id, taskDeps())));
  registry.attachHandler('tasks.message', H(async (req, res, params) => handleTaskMessage(req, res, params.id, taskDeps())));
  registry.attachHandler('tasks.output', H(async (req, res, params) => {
    const u = new URL(req.url || '/', 'http://x');
    await handleTaskOutput(res, params.id, parseTaskOutputQuery(u.searchParams), taskDeps());
  }));

  const configDeps = () => ({ service: gw.sessionConfig ?? null });
  registry.attachHandler('session.config', H(async (_req, res, params) =>
    handleSessionConfigGet(res, params.id, configDeps())));
  registry.attachHandler('session.config.set', H(async (req, res, params) =>
    handleSessionConfigSet(req, res, params.id, configDeps())));

  registry.attachHandler('session.summarize', H(async (req, res) =>
    handleSessionSummarize(req, res, req.url || '', { getRuntime: () => gw.runtime })));

  registry.attachHandler('event.publish', H(async (req, res) =>
    handleEventPublish({ broadcast: (e) => gw.broadcast(e), recordUnknown: (t) => gw.recordUnknownEvent?.(t) }, req, res)));

  registry.attachHandler('media.switch', H(async (req, res) =>
    handleMediaSwitch(req, res, {
      persist: (o) => config.persistOverrides(o),
      reloadPlugins: async () => { await gw.mediaPluginLoader?.reload(); },
      availableEngines: () => (gw.mediaPluginLoader?.getState().map((s) => s.name).filter((n): n is string => !!n) ?? []),
      currentMedia: () => config.raw.media,
    })));

  const usageDeps = () => gw.usagePluginsDeps();
  registry.attachHandler('session.usagePluginsList', H(async (req, res) =>
    handleUsagePluginsList(req, res, usageDeps())));
  registry.attachHandler('session.usagePluginsReload', H(async (req, res) => {
    await gw.pluginLoader?.reload();
    await handleUsagePluginsList(req, res, usageDeps());
  }));
  registry.attachHandler('session.usagePluginsCreate', H(async (req, res) =>
    handleUsagePluginCreate(req, res, usageDeps())));
  registry.attachHandler('session.usagePluginSourceGet', H(async (req, res, params) =>
    handleUsagePluginSourceGet(req, res, usageDeps(), decodeURIComponent(params.name))));
  registry.attachHandler('session.usagePluginSourcePut', H(async (req, res, params) =>
    handleUsagePluginSourcePut(req, res, usageDeps(), decodeURIComponent(params.name))));
  registry.attachHandler('session.usagePluginTest', H(async (req, res, params) =>
    handleUsagePluginTest(req, res, usageDeps(), decodeURIComponent(params.name))));
  registry.attachHandler('session.usagePluginsDelete', H(async (req, res, params) =>
    handleUsagePluginDelete(req, res, usageDeps(), decodeURIComponent(params.name))));
}
