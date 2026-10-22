/**
 * 认知面 HTTP 动词（spec：2026-10-22-cognition-gate-rewrite-design.md §5.4）。
 *
 * out-of-process 宿主的契约面（pi 走进程内注入不经此）；loopback-only。
 * deps 注入可单测（routes/ 域内既有模式）。
 *
 * decision 枚举含 'ask' 但 v1 仅 tool_call 类可产出（prompt+ask 加载期拒绝 C6）。
 */
import type { ServerResponse } from 'http';

export interface CognitionGateLike {
  gateToolCall(sessionID: string, payload: { tool: string; input: Record<string, unknown> }): unknown;
  gatePrompt(sessionID: string, text: string): { decision: string; [k: string]: unknown };
  applyToolResultRedact(sessionID: string, tool: string, content: unknown[]): unknown[];
}

export interface CognitionRouteDeps {
  body: any;
  gate: CognitionGateLike;
  res: ServerResponse;
}

function json(res: ServerResponse, status: number, payload: unknown): void {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(payload));
}

/** POST /api/cognition/gate {sessionID, kind: 'tool_call'|'prompt', tool?, input?, text?} → decision JSON */
export async function handleCognitionGate(deps: CognitionRouteDeps): Promise<void> {
  const { body, gate, res } = deps;
  try {
    if (!body || typeof body.sessionID !== 'string') {
      json(res, 400, { error: 'sessionID required' });
      return;
    }
    if (body.kind === 'tool_call') {
      if (typeof body.tool !== 'string') {
        json(res, 400, { error: 'tool required for kind:tool_call' });
        return;
      }
      const d = gate.gateToolCall(body.sessionID, { tool: body.tool, input: body.input ?? {} });
      json(res, 200, d ?? { decision: 'allow' });
      return;
    }
    if (body.kind === 'prompt') {
      const d = gate.gatePrompt(body.sessionID, typeof body.text === 'string' ? body.text : '');
      json(res, 200, d);
      return;
    }
    json(res, 400, { error: "kind must be 'tool_call' or 'prompt'" });
  } catch (err: any) {
    json(res, 500, { error: err?.message ?? 'cognition gate failed' });
  }
}

/** POST /api/cognition/rewrite {sessionID, tool, output:{content,isError?}} → 变换后 content */
export async function handleCognitionRewrite(deps: CognitionRouteDeps): Promise<void> {
  const { body, gate, res } = deps;
  try {
    if (!body || typeof body.sessionID !== 'string' || typeof body.tool !== 'string' || !Array.isArray(body.output?.content)) {
      json(res, 400, { error: 'sessionID, tool and output.content[] required' });
      return;
    }
    const content = gate.applyToolResultRedact(body.sessionID, body.tool, body.output.content);
    json(res, 200, { content });
  } catch (err: any) {
    json(res, 500, { error: err?.message ?? 'cognition rewrite failed' });
  }
}

/** GET /api/cognition/rules → validateRules 后清单 + errors */
export async function handleCognitionRules(deps: { res: ServerResponse; getRules: () => { valid: unknown[]; errors: string[] } }): Promise<void> {
  try {
    const { valid, errors } = deps.getRules();
    json(deps.res, 200, { rules: valid, errors });
  } catch (err: any) {
    json(deps.res, 500, { error: err?.message ?? 'cognition rules failed' });
  }
}
