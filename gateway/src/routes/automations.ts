/**
 * Phase D1 Task C1: automation 面（registry dispatch 接线）。
 *
 *   POST   /api/automations/draft       — 建草稿规则（disabled）
 *   GET    /api/automations             — 列表（next trigger + recent history）
 *   GET    /api/automations/:id         — 单规则详情
 *   PUT    /api/automations/:id         — toggle（enabled/disabled）
 *   DELETE /api/automations/:id         — 删除规则
 *   GET    /api/automations/:id/history — 规则审计轨迹
 *
 * handler 体从 index.ts legacy 分支逐字迁移。registry 静态段优先（draft 先于 :id）
 * 结构上等价于 legacy 的「draft 必须注册在 {id} matcher 之前」注释。
 * Spec: 2026-11-09-gateway-kernel-microkernel-design.md §5.2.
 */
import type { ServerResponse } from 'http';
import { readRouteBody } from './cognition';
import type { RouteRegistry } from './registry';

export interface AutomationEngineLike {
  getRules(): any[];
  getRule(id: string): any | undefined;
  getNextTriggers(rule: any, count?: number): { next5: string[] };
  draftRule(rule: any): { id: string; valid: boolean; errors: string[] };
  toggleRule(id: string, enabled: boolean): boolean;
  deleteRule(id: string): boolean;
}

export interface SchedulerLedgerLike {
  append(entry: any): void;
  getHistory(ruleId?: string, limit?: number): any[];
}

export interface AutomationRouteDeps {
  automationEngine: () => AutomationEngineLike | null | undefined;
  ledger: () => SchedulerLedgerLike | null | undefined;
}

export function attachAutomationRoutes(registry: RouteRegistry, deps: AutomationRouteDeps): void {
  // ── Automation endpoints (Tier 4 — user only) ──

  // POST /api/automations/draft — create a draft rule (disabled).
  // MUST be registered before the /api/automations/{id} matcher.
  registry.attachHandler('automations.draft', async (req, res: ServerResponse) => {
    try {
      const body = JSON.parse(await readRouteBody(req));
      const trigger = body.trigger || {};
      const rule = {
        id: body.id as string,
        enabled: false,
        trigger: trigger.type === 'event'
          ? {
              type: 'event' as const,
              on: Array.isArray(trigger.on) ? trigger.on : [],
              perGoalCooldown: trigger.perGoalCooldown || '5m',
            }
          : {
              type: 'cron' as const,
              schedule: trigger.schedule || '',
              timezone: trigger.timezone || 'UTC',
            },
        skill: body.skill as string | undefined,
        args: body.args as Record<string, any> | undefined,
        action: body.action as any,
        onResult: body.onResult as any,
        goal_defaults: body.goal_defaults as any,
      };
      const result = deps.automationEngine()?.draftRule(rule);
      if (!result) { res.writeHead(503); res.end(JSON.stringify({ error: 'Automation engine not available' })); return; }
      deps.ledger()?.append({
        timestamp: new Date().toISOString(),
        event: 'AUTOMATION_TRIGGERED',
        ruleId: result.id,
        source: 'user',
        reason: 'rule_drafted',
      });
      res.end(JSON.stringify(result));
    } catch (err: any) {
      res.writeHead(400); res.end(JSON.stringify({ error: err.message }));
    }
  });

  // GET /api/automations — list automation rules with next trigger + recent history
  registry.attachHandler('automations.list', async (_req, res: ServerResponse) => {
    const rules = deps.automationEngine()?.getRules() || [];
    const enriched = rules.map(r => ({
      ...r,
      nextTriggers: deps.automationEngine()?.getNextTriggers(r).next5 || [],
      recentHistory: deps.ledger()?.getHistory(r.id, 3) || [],
    }));
    res.end(JSON.stringify({ rules: enriched }));
  });

  // GET /api/automations/{id} — single rule detail
  registry.attachHandler('automations.get', async (_req, res: ServerResponse, params: Record<string, string>) => {
    const id = params.id;
    const rule = deps.automationEngine()?.getRule(id);
    if (!rule) { res.writeHead(404); res.end(JSON.stringify({ error: 'Rule not found' })); return; }
    res.end(JSON.stringify({
      ...rule,
      nextTriggers: deps.automationEngine()?.getNextTriggers(rule)?.next5 || [],
      history: deps.ledger()?.getHistory(id, 10) || [],
    }));
  });

  // PUT /api/automations/{id} — toggle an automation rule (enabled/disabled)
  registry.attachHandler('automations.toggle', async (req, res: ServerResponse, params: Record<string, string>) => {
    try {
      const id = params.id;
      const body = await readRouteBody(req);
      const { enabled } = JSON.parse(body);
      const ok = deps.automationEngine()?.toggleRule(id, enabled);
      deps.ledger()?.append({
        timestamp: new Date().toISOString(),
        event: 'AUTOMATION_TRIGGERED',
        ruleId: id,
        source: 'user',
        reason: enabled ? 'enabled' : 'disabled',
      });
      res.end(JSON.stringify({ status: ok ? 'toggled' : 'not_found', enabled }));
    } catch (err: any) {
      res.writeHead(400); res.end(JSON.stringify({ error: err.message }));
    }
  });

  // DELETE /api/automations/{id} — delete an automation rule
  registry.attachHandler('automations.remove', async (_req, res: ServerResponse, params: Record<string, string>) => {
    const id = params.id;
    const ok = deps.automationEngine()?.deleteRule(id);
    deps.ledger()?.append({
      timestamp: new Date().toISOString(),
      event: 'AUTOMATION_TRIGGERED',
      ruleId: id,
      source: 'user',
      reason: 'deleted',
    });
    res.end(JSON.stringify({ status: ok ? 'deleted' : 'not_found' }));
  });

  // GET /api/automations/{id}/history — audit trail for a rule
  registry.attachHandler('automations.history', async (req, res: ServerResponse, params: Record<string, string>) => {
    const id = params.id;
    const limit = parseInt(new URL(req.url!, `http://${req.headers.host}`).searchParams.get('limit') || '20');
    const history = deps.ledger()?.getHistory(id, limit) || [];
    res.end(JSON.stringify({ history }));
  });
}
