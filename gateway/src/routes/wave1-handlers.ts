/**
 * P5 Wave 1 — 把 routes/*.ts 既有模块的 handler 绑定到 shadow catalog 的
 * operationId 上（registry.attachHandler），index.ts 主循环顶端统一 dispatch。
 *
 * 迁移范围（22 条）：deps 走 gateway 实例既有 helper（rotateDeps 等）或轻量闭包，
 * 无内联前置守卫。runtime×4 / plugins×5（pluginHubDeps 重 preamble + 409 守卫）
 * 留 Wave 2；A2A/SSE/反代/MCP 永久内联。
 *
 * 约定：底层 handleX 返回 false（内部正则未命中）→ 透传回 legacy 链；
 * void 视为已处理。每个闭包必须与被退役的内联调用点行为逐字节等价。
 */
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
import { handleSessionMutations, type SessionMutationDeps } from './session-mutations';
import { handleSessionSummarize } from './session-summarize';
import { handleEventPublish } from './event-publish';
import { handleMediaSwitch } from './media-switch';
import {
  handleUsagePluginsList, handleUsagePluginCreate, handleUsagePluginSourceGet,
  handleUsagePluginSourcePut, handleUsagePluginTest, handleUsagePluginDelete,
  type UsagePluginsDeps,
} from './usage-plugins';

/** gateway 实例的最小依赖面（只声明 Wave 1 闭包实际用到的成员）。 */
export interface Wave1Gateway {
  getGatewayDb(): { listGoalSessions(goalId: string): any };
  runtime: AgentRuntime | null;
  automationEngine?: { rejectTriage(id: string): boolean } | null;
  ledger?: { append(entry: unknown): void } | null;
  rotateDeps(): ManagerRotateDeps;
  embeddingConfigDeps(): EmbeddingConfigDeps;
  modelConfigDeps(): ModelConfigDeps;
  usagePluginsDeps(): UsagePluginsDeps;
  pluginLoader?: { reload(): Promise<void> } | null;
  mediaPluginLoader?: { reload(): Promise<void>; getState(): { name?: string }[] } | null;
  broadcast(event: { type: string; [key: string]: any }): void;
  runtimeCaps: SessionMutationDeps['getCapabilities'] extends () => infer C ? C : never;
}

type Handler = NonNullable<RouteDef['handler']>;

/** 绑定 Wave 1 的 22 条路由。index.ts 在 createServer 之前调用一次。 */
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
    handleSessionBranch(req, res, req.url || '', { getRuntime: () => gw.runtime })));
  registry.attachHandler('session.revert', H(async (req, res, params) =>
    handleSessionBranch(req, res, req.url || '', { getRuntime: () => gw.runtime })));
  registry.attachHandler('session.unrevert', H(async (req, res, params) =>
    handleSessionBranch(req, res, req.url || '', { getRuntime: () => gw.runtime })));

  registry.attachHandler('session.delete', H(async (req, res) =>
    handleSessionMutations(req, res, {
      getCapabilities: () => gw.runtimeCaps,
      getClient: () => (gw.runtime ?? null) as any,
    })));
  registry.attachHandler('session.rename', H(async (req, res) =>
    handleSessionMutations(req, res, {
      getCapabilities: () => gw.runtimeCaps,
      getClient: () => (gw.runtime ?? null) as any,
    })));

  registry.attachHandler('session.summarize', H(async (req, res) =>
    handleSessionSummarize(req, res, req.url || '', { getRuntime: () => gw.runtime })));

  registry.attachHandler('event.publish', H(async (req, res) =>
    handleEventPublish({ broadcast: (e) => gw.broadcast(e) }, req, res)));

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
