/**
 * Phase D1 Task 3d: agent/terminal/mobile registry wiring.
 * Terminal delegates to the existing handleTerminal module (catalog has 4
 * entries); agent capabilities delegates to routes/capability; mobile
 * delegates to the existing tts-artifact + media-proxy handler factories.
 */
import type { IncomingMessage, ServerResponse } from 'http';
import { log } from '../core/utils/logger';
import { handleTerminal } from './terminal';
import { isLoopbackAddr } from '../core/auth';
import type { RouteRegistry } from './registry';

export interface TerminalRouteDeps {
  getTerminalService: () => any;
  getAccess: () => any;
}

export function attachTerminalRoutes(registry: RouteRegistry, deps: TerminalRouteDeps): void {
  const dispatch = async (req: IncomingMessage, res: ServerResponse) =>
    handleTerminal(req, res, req.url || '', {
      service: deps.getTerminalService(),
      access: deps.getAccess(),
    });
  registry.attachHandler('terminal.list', dispatch);
  registry.attachHandler('terminal.create', dispatch);
  registry.attachHandler('terminal.remove', dispatch);
  registry.attachHandler('terminal.connectTicket', dispatch);
}

export interface AgentRouteDeps {
  listOutcomes: () => unknown[];
  getIndex: () => { entries: unknown[] };
}

export function attachAgentRoutes(registry: RouteRegistry, deps: AgentRouteDeps): void {
  registry.attachHandler('agent.capabilities', async (_req, res) => {
    try {
      const { handleCapabilities } = require('./capability') as typeof import('./capability');
      const result = await handleCapabilities({
        listOutcomes: deps.listOutcomes as any,
        getIndex: deps.getIndex as any,
      });
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(result));
    } catch (err: any) {
      log.error('[Agent] capabilities error:', err.message);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ledger: { total: 0, passRate: 0 }, failureTaxonomy: [] }));
    }
  });
}

export interface MobileRouteDeps {
  /** mediaAgent for TTS artifacts + media proxy. */
  getMediaAgent: () => { putArtifactBytes(bytes: Buffer, mediaType: string): string; getArtifactMediaType(id: string): string | undefined } | null | undefined;
  apiToken: () => string;
  /** Dynamic-import loaders preserved from the legacy branches. */
  loadTtsArtifactHandler: () => Promise<(req: IncomingMessage, res: ServerResponse) => Promise<boolean>>;
  loadMobileMediaHandler: () => Promise<(req: IncomingMessage, res: ServerResponse) => Promise<boolean>>;
}

export function attachMobileRoutes(registry: RouteRegistry, deps: MobileRouteDeps): void {
  registry.attachHandler('mobile.ttsArtifact', async (req, res) => {
    try {
      const agent = deps.getMediaAgent();
      if (!agent) { res.writeHead(503); res.end(JSON.stringify({ error: 'MediaAgent not initialized' })); return; }
      const ttsArtifactHandler = await deps.loadTtsArtifactHandler();
      const handled = await ttsArtifactHandler(req, res);
      if (handled) return;
      return false; // module-internal miss → fall through (parity with legacy)
    } catch (err: any) {
      res.writeHead(500);
      res.end(JSON.stringify({ error: err?.message || String(err) }));
    }
  });
  const mediaProxy = async (req: IncomingMessage, res: ServerResponse): Promise<boolean | void> => {
    const mobileMediaHandler = await deps.loadMobileMediaHandler();
    return mobileMediaHandler(req, res);
  };
  registry.attachHandler('mobile.mediaTaskUpload', mediaProxy);
  registry.attachHandler('mobile.mediaTaskAsk', mediaProxy);
}

export { isLoopbackAddr };
