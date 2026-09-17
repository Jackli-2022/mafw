/**
 * P5 Wave 2 — runtime×4 + plugins×5 从内联块迁入 registry dispatch。
 *
 * 与 Wave 1 的差异：这两组路由在内联时代携带 per-request 前置逻辑——
 * - runtime.switch 有 409 守卫（serveRecovering/switchingRuntime）+ switchingRuntime try/finally；
 *   这些是 gateway 状态机成员，由 Wave2Gateway 的小方法适配器暴露，闭包内编排。
 * - plugins 组每个请求都跑 cleanupExamples（内联时代无外层守卫、所有请求都跑）；
 *   迁入闭包后只在真正命中 /api/plugins 路由时执行——严格优化，行为等价。
 * - runtimeDeps/pluginHubDeps/restartAgentDeps 的构造整体搬进 gateway 私有方法
 *   （与 rotateDeps 同模式），registry 闭包只做接线。
 *
 * 行为修正（有意）：内联 runtime 块对未知 /api/runtime/* 请求悬空 return（无响应挂起），
 * 迁移后这类请求落回 legacy 链（dashboard 委托/反代 → 404），不再吞请求。
 */
import * as http from 'http';
import type { RouteRegistry, RouteDef } from './registry';
import type { RuntimeSwitchDeps } from './runtime-switch';
import type { RestartAgentDeps } from './restart-agent';
import type { PluginsRouteDeps } from './plugins';
import { handleRuntimeGet, handleRuntimeSwitch, handleRuntimeReload } from './runtime-switch';
import { handleRestartAgent } from './restart-agent';
import { handlePluginsList, handlePluginsInstall, handlePluginsEnable, handlePluginsDisable, handlePluginsDelete } from './plugins';
import { cleanupExamples } from '../plugins/hub';
import { log } from '../core/utils/logger';

/** gateway 实例的最小依赖面（Wave 2 闭包实际用到的成员）。 */
export interface Wave2Gateway {
  runtimeDeps(): RuntimeSwitchDeps;
  restartAgentDeps(): RestartAgentDeps;
  pluginHubDeps(): PluginsRouteDeps;
  /** runtime.switch 守卫：serveRecovering || switchingRuntime。 */
  runtimeSwitchBlocked(): boolean;
  beginRuntimeSwitch(): void;
  endRuntimeSwitch(): void;
}

type Handler = NonNullable<RouteDef['handler']>;

/** 绑定 Wave 2 的 9 条路由。index.ts 在 createServer 之前调用一次。 */
export function attachWave2Handlers(registry: RouteRegistry, gw: Wave2Gateway): void {
  const H = (fn: Handler) => fn;

  registry.attachHandler('runtime.get', H(async (req, res) =>
    handleRuntimeGet(req, res, gw.runtimeDeps())));

  registry.attachHandler('runtime.switch', H(async (req, res) => {
    if (gw.runtimeSwitchBlocked()) {
      res.writeHead(409, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Cannot switch runtime during agent restart' }));
      return;
    }
    gw.beginRuntimeSwitch();
    try {
      await handleRuntimeSwitch(req, res, gw.runtimeDeps());
    } finally {
      gw.endRuntimeSwitch();
    }
  }));

  registry.attachHandler('runtime.reload', H(async (req, res) =>
    handleRuntimeReload(req, res, gw.runtimeDeps())));

  registry.attachHandler('runtime.restartAgent', H(async (req, res) =>
    handleRestartAgent(req, res, gw.restartAgentDeps())));

  const withCleanup = async (req: http.IncomingMessage, fn: () => Promise<void>): Promise<void> => {
    try {
      const cleaned = cleanupExamples((gw.pluginHubDeps() as any).hub);
      if (cleaned.removed.length) log.info(`[PluginsHub] removed stale examples: ${cleaned.removed.length}`);
      if (cleaned.failed.length) log.warn(`[PluginsHub] cleanupExamples failed: ${cleaned.failed.join(', ')}`);
    } catch (err: any) {
      log.warn(`[PluginsHub] cleanupExamples error: ${err.message}`);
    }
    await fn();
  };

  registry.attachHandler('plugins.list', H(async (req, res) =>
    withCleanup(req, () => handlePluginsList(req, res, gw.pluginHubDeps()))));
  registry.attachHandler('plugins.install', H(async (req, res) =>
    withCleanup(req, () => handlePluginsInstall(req, res, gw.pluginHubDeps()))));
  registry.attachHandler('plugins.enable', H(async (req, res) =>
    withCleanup(req, () => handlePluginsEnable(req, res, gw.pluginHubDeps()))));
  registry.attachHandler('plugins.disable', H(async (req, res) =>
    withCleanup(req, () => handlePluginsDisable(req, res, gw.pluginHubDeps()))));
  registry.attachHandler('plugins.delete', H(async (req, res) =>
    withCleanup(req, () => handlePluginsDelete(req, res, gw.pluginHubDeps()))));
}
