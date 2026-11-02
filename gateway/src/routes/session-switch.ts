import * as http from 'http';
import type { RuntimeAccess } from '../runtime/runtime-access';
import { surfaceUnavailableMessage } from '../runtime/runtime-access';

export type SessionSwitchKind = 'agent' | 'model';

export interface SessionSwitchClientLike {
  session: {
    switchAgent?(opts: { sessionID: string; agent: string }): Promise<void>;
    switchModel?(opts: {
      sessionID: string;
      model: { providerID: string; modelID: string };
      variant?: string;
    }): Promise<void>;
  };
}

export interface SessionSwitchDeps {
  getRuntime: () => SessionSwitchClientLike | null;
  /** surface 门：注入 facade 的 RuntimeAccess（业务不构造 raw access）。 */
  getAccess?: () => Pick<RuntimeAccess, 'can'> | null;
}

class SwitchError extends Error {
  constructor(public readonly status: number, message: string) {
    super(message);
  }
}

async function readJson(req: http.IncomingMessage): Promise<any> {
  let raw = '';
  for await (const chunk of req) raw += chunk;
  return JSON.parse(raw || '{}');
}

/** 2.1 sticky 切换的共用实现（两个 POST 路由：agent / model）。 */
export async function applySessionSwitch(
  client: SessionSwitchClientLike,
  sessionID: string,
  kind: SessionSwitchKind,
  body: any,
): Promise<void> {
  if (kind === 'agent') {
    if (typeof client.session.switchAgent !== 'function') {
      throw new SwitchError(503, surfaceUnavailableMessage('session.switchAgent'));
    }
    if (typeof body?.agent !== 'string' || !body.agent.trim()) {
      throw new SwitchError(400, 'agent is required');
    }
    await client.session.switchAgent({ sessionID, agent: body.agent });
    return;
  }

  if (typeof client.session.switchModel !== 'function') {
    throw new SwitchError(503, surfaceUnavailableMessage('session.switchModel'));
  }
  const model = body?.model;
  if (typeof model?.providerID !== 'string' || typeof model?.modelID !== 'string') {
    throw new SwitchError(400, 'model.providerID/modelID required');
  }
  await client.session.switchModel({
    sessionID,
    model: { providerID: model.providerID, modelID: model.modelID },
    ...(typeof body?.variant === 'string' && body.variant ? { variant: body.variant } : {}),
  });
}

/**
 * POST /api/sessions/:id/agent {agent}
 * POST /api/sessions/:id/model {model:{providerID,modelID}, variant?}
 * 能力门：session.switchAgent / session.switchModel surface。
 * 统一返回 200 {ok:true}（SDK request 恒解析 JSON；204 会炸）。
 */
export async function handleSessionSwitch(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  sessionID: string,
  kind: SessionSwitchKind,
  deps: SessionSwitchDeps,
): Promise<void> {
  const json = (status: number, body: any) => {
    res.writeHead(status, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(body));
  };
  const client = deps.getRuntime();
  // 能力门只经注入的 RuntimeAccess（facade 的 access）；业务不构造 raw access。
  const access = deps.getAccess?.() ?? null;
  const surface = kind === 'agent' ? 'session.switchAgent' : 'session.switchModel';
  if (!client || !access?.can(surface)) {
    json(503, { error: surfaceUnavailableMessage(surface) });
    return;
  }
  let body: any;
  try {
    body = await readJson(req);
  } catch {
    json(400, { error: 'invalid json' });
    return;
  }
  try {
    await applySessionSwitch(client, sessionID, kind, body);
    json(200, { ok: true });
  } catch (err: any) {
    json(err instanceof SwitchError ? err.status : 500, { error: err?.message ?? String(err) });
  }
}
