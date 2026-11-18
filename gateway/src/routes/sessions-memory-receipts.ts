/**
 * GET /api/sessions/:id/memory-receipts — structured recall receipts for the
 * desktop history backfill. Fail-open 200 `{ items: [] }`: a missing table or
 * malformed row must never break session opening.
 */
import type { IncomingMessage, ServerResponse } from 'http';
import { log } from '../core/utils/logger';
import type { GatewayDatabase } from '../memory/gateway-db';
import type { RouteRegistry } from './registry';

export interface SessionsMemoryReceiptsDeps {
  getGatewayDb: () => GatewayDatabase;
}

export function attachSessionsMemoryReceiptsRoutes(
  registry: RouteRegistry,
  deps: SessionsMemoryReceiptsDeps,
): void {
  registry.attachHandler(
    'session.memoryReceipts',
    async (req: IncomingMessage, res: ServerResponse, params: Record<string, string>) => {
      const sessionID = params?.id ?? '';
      let limit = 100;
      try {
        const url = new URL(req.url!, `http://${req.headers.host || 'localhost'}`);
        const raw = Number(url.searchParams.get('limit'));
        if (Number.isFinite(raw) && raw > 0) limit = raw;
      } catch { /* keep default */ }

      try {
        const items = sessionID
          ? deps.getGatewayDb().listMemoryReceipts(sessionID, { limit })
          : [];
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ items }));
      } catch (err: any) {
        log.warn(`[Sessions] memory receipts read failed: ${err?.message || err}`);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ items: [] }));
      }
    },
  );
}
