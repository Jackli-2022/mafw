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
import type { IncomingMessage, ServerResponse } from 'http';
import { config } from '../config';
import { log } from '../core/utils/logger';
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
    // legacy 是 `if (handled) return;`（未处理则落回反代）。registry 只在
    // (GET, 精确 path) 命中时进入本 handler，handleRecallInstructions 的未命中
    // 分支不可达 → 直接返回等价（见 Task B3 report）。
    if (handled) return;
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
}
