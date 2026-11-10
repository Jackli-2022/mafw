/**
 * Phase D1 Task A4: triage 面（registry dispatch 接线）。
 *
 *   GET  /api/triage              — 列表（with llmSuggestions）
 *   POST /api/triage/:id/confirm  — 确认（skillDraft / axiomDraft / goal-request 三分支）
 *   POST /api/triage/:id/reject   — 拒绝
 *   POST /api/triage/:id/propose  — 提交决策建议（同 MCP mafw_propose_triage_decision）
 *
 * handler 体从 index.ts legacy 分支逐字迁移；confirm 不读请求体（原样保留）。
 * triage.dismiss 已在 wave1-handlers 接线，此处不碰。
 */
import * as fs from 'fs';
import * as path from 'path';
import type { IncomingMessage, ServerResponse } from 'http';
import { L5Store } from '../core/memory/l5-store';
import { readRouteBody } from './cognition';
import type { RouteRegistry } from './registry';

export interface TriageItemLike {
  state: string;
  automationId: string;
  proposedGoal: { title: string; boundaries: unknown; estimatedLoops: number };
  summary?: unknown;
}

export interface TriageAutomationEngineLike {
  getTriageItems(status?: string): TriageItemLike[];
  getTriageItem(triageId: string): TriageItemLike | null;
  confirmTriage(goalId: string, triageItem: TriageItemLike): void;
  rejectTriage(triageId: string): boolean;
  proposeTriageDecision(
    triageId: string,
    suggestion: 'confirm' | 'reject',
    reason: string,
    priority: string,
  ): { success: boolean; message: string } | null;
}

export interface TriageLedgerLike {
  append(entry: unknown): void;
}

export interface TriageRouteDeps {
  automationEngine: () => TriageAutomationEngineLike | null | undefined;
  skillInstallDeps: () => any;
  mafwDir: () => string;
  ledger: () => TriageLedgerLike | null | undefined;
}

export function attachTriageRoutes(registry: RouteRegistry, deps: TriageRouteDeps): void {
  // ── Triage endpoints (Tier 4 — user only, not MCP) ──

  registry.attachHandler('triage.list', async (_req: IncomingMessage, res: ServerResponse) => {
    const items = deps.automationEngine()?.getTriageItems() || [];
    res.end(JSON.stringify({ items }));
  });

  registry.attachHandler('triage.confirm', async (_req: IncomingMessage, res: ServerResponse, params: Record<string, string>) => {
    const triageId = params.id;
    const item = deps.automationEngine()?.getTriageItem(triageId);
    if (!item) {
      res.writeHead(404); res.end(JSON.stringify({ error: 'Triage item not found' })); return;
    }
    if (item.state !== 'PENDING_CONFIRMATION') {
      res.writeHead(400); res.end(JSON.stringify({ error: `Already ${item.state}` })); return;
    }
    // W2: skill 物化草稿的确认分支——安装 skill + 记忆变指针（不建 goal）
    const skillDraft = (item as any).summary?.skillDraft;
    if (skillDraft?.name && skillDraft?.memoryId) {
      const { installSkillDraft } = await import('../memory/skill-install.js');
      const r = await installSkillDraft(skillDraft, deps.skillInstallDeps());
      deps.automationEngine()?.confirmTriage(triageId, item);
      res.end(JSON.stringify({ status: 'confirmed', installed: r.installed }));
      return;
    }
    // A1: 公理草稿确认分支——每条 candidate 经 L5 commit（不建 goal）
    const axiomDraft = (item as any).summary?.axiomDraft;
    if (axiomDraft?.candidates?.length) {
      const l5 = new L5Store();
      let committed = 0;
      for (const pattern of axiomDraft.candidates as string[]) {
        try {
          l5.addHeuristic(pattern, ['axiom-distilled'], axiomDraft.sourceIds ?? []);
          committed++;
        } catch { /* fail-open per candidate */ }
      }
      deps.automationEngine()?.confirmTriage(triageId, item);
      res.end(JSON.stringify({ status: 'confirmed', axioms: committed }));
      return;
    }
    const goalId = `confirmed-${item.automationId}-${Date.now()}`;
    deps.automationEngine()?.confirmTriage(goalId, item);
    const requestsDir = path.join(deps.mafwDir(), 'requests');
    if (!fs.existsSync(requestsDir)) fs.mkdirSync(requestsDir, { recursive: true });
    fs.writeFileSync(path.join(requestsDir, `${goalId}.json`), JSON.stringify({
      goalId,
      source: 'triage-confirm',
      automationId: item.automationId,
      title: item.proposedGoal.title,
      boundaries: item.proposedGoal.boundaries,
      maxLoops: item.proposedGoal.estimatedLoops,
      createdAt: new Date().toISOString(),
    }, null, 2), 'utf-8');
    deps.ledger()?.append({
      timestamp: new Date().toISOString(),
      event: 'AUTOMATION_TRIGGERED',
      ruleId: item.automationId,
      goalId,
      source: 'user',
      reason: 'triage_confirmed',
    });
    res.end(JSON.stringify({ status: 'confirmed', goalId }));
  });

  registry.attachHandler('triage.reject', async (_req: IncomingMessage, res: ServerResponse, params: Record<string, string>) => {
    const triageId = params.id;
    const ok = deps.automationEngine()?.rejectTriage(triageId);
    deps.ledger()?.append({
      timestamp: new Date().toISOString(),
      event: 'AUTOMATION_TRIGGERED',
      source: 'user',
      reason: 'triage_rejected',
      details: { triageId },
    });
    res.end(JSON.stringify({ status: ok ? 'rejected' : 'not_found' }));
  });

  registry.attachHandler('triage.propose', async (req: IncomingMessage, res: ServerResponse, params: Record<string, string>) => {
    try {
      const triageId = params.id;
      const body = JSON.parse(await readRouteBody(req));
      const suggestion = body.suggestion as 'confirm' | 'reject';
      if (!['confirm', 'reject'].includes(suggestion)) {
        res.writeHead(400); res.end(JSON.stringify({ error: 'suggestion must be "confirm" or "reject"' })); return;
      }
      const reason = String(body.reason || '');
      const priority = (body.priority as string) || 'medium';
      const result = deps.automationEngine()?.proposeTriageDecision(triageId, suggestion, reason, priority);
      if (!result) { res.writeHead(404); res.end(JSON.stringify({ error: 'Triage item not found' })); return; }
      deps.ledger()?.append({
        timestamp: new Date().toISOString(),
        event: 'AUTOMATION_TRIGGERED',
        source: 'user',
        reason: `proposed_${suggestion}_for_${triageId}`,
        details: { triageId, suggestion, priority },
      });
      res.end(JSON.stringify(result));
    } catch (err: any) {
      res.writeHead(400); res.end(JSON.stringify({ error: err.message }));
    }
  });
}
