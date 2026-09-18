/**
 * POST /api/runtime/conformance —— 对活跃 runtime 跑场景一致性验证。
 *
 * 驱动真实会话（消耗 LLM 调用），事件观测经 gateway 的 event tap 收集；
 * 结果含 per-scenario pass/fail 与失败说明。会话尽力清理（fail-open）。
 */
import * as http from 'http';
import { SCENARIOS, evaluateScenario, ObservedEvent } from '../runtime/conformance-scenarios';

export interface ConformanceDeps {
  runtimeName(): string;
  caps(): { sessionApi?: boolean; eventStream?: boolean } & Record<string, unknown>;
  createSession(opts?: { directory?: string }): Promise<{ id: string }>;
  promptAsync(opts: { sessionID: string; message: string }): Promise<void>;
  deleteSession(id: string): Promise<void>;
  listSessions(): Promise<Array<{ id?: string }>>;
  registerEventTap(sessionID: string, cb: (e: ObservedEvent) => void): () => void;
}

function readBody(req: http.IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', (c: string) => (body += c));
    req.on('end', () => resolve(body));
    req.on('error', reject);
  });
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** 等 tap 攒出终态事件或超时；返回该窗口内全部观测。 */
async function collectUntilTerminal(
  tapReg: ConformanceDeps['registerEventTap'],
  sid: string,
  timeoutMs: number,
): Promise<ObservedEvent[]> {
  const events: ObservedEvent[] = [];
  let settled = false;
  const stop = tapReg(sid, (e) => {
    events.push(e);
    if (e.type === 'message.complete' || e.type === 'session.idle' || e.type === 'message.error' || e.type === 'session.error') {
      settled = true;
    }
  });
  const deadline = Date.now() + timeoutMs;
  while (!settled && Date.now() < deadline) await sleep(250);
  await sleep(250); // 尾部事件余量
  stop();
  return events;
}

export async function handleConformance(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  deps: ConformanceDeps,
): Promise<void> {
  let body: any = {};
  try { body = JSON.parse((await readBody(req)) || '{}'); } catch { /* 缺省全场景 */ }
  const only: string[] | undefined = Array.isArray(body?.scenarios) ? body.scenarios : undefined;
  const perTimeout: number | undefined = typeof body?.timeoutMs === 'number' ? body.timeoutMs : undefined;
  const caps = deps.caps() as any;

  const send = (payload: unknown) => {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(payload));
  };

  const results: Array<{ id: string; title: string; pass: boolean; failures: string[]; durationMs: number }> = [];
  for (const sc of SCENARIOS) {
    if (only && !only.includes(sc.id)) continue;
    const t0 = Date.now();
    if (!caps.sessionApi) {
      results.push({ id: sc.id, title: sc.title, pass: false, failures: ['runtime does not declare sessionApi — scenario skipped as failure'], durationMs: 0 });
      continue;
    }
    if (sc.requires.eventStream && !caps.eventStream) {
      results.push({ id: sc.id, title: sc.title, pass: false, failures: ['runtime does not declare eventStream — scenario requires event observations'], durationMs: 0 });
      continue;
    }
    try {
      if (sc.id === 'chat-roundtrip') {
        const sess = await deps.createSession({});
        const p = collectUntilTerminal(deps.registerEventTap, sess.id, perTimeout ?? sc.timeoutMs);
        await deps.promptAsync({ sessionID: sess.id, message: sc.prompt });
        const events = await p;
        const r = evaluateScenario(sc.id, events);
        await deps.deleteSession(sess.id).catch(() => {});
        results.push({ id: sc.id, title: sc.title, ...r, durationMs: Date.now() - t0 });
      } else {
        const sess = await deps.createSession({});
        const listAfterCreate = await deps.listSessions();
        const created = listAfterCreate.some((s) => s.id === sess.id);
        await deps.deleteSession(sess.id);
        const listAfterDelete = await deps.listSessions();
        const deleted = !listAfterDelete.some((s) => s.id === sess.id);
        const r = evaluateScenario(sc.id, [], { created, deleted });
        results.push({ id: sc.id, title: sc.title, ...r, durationMs: Date.now() - t0 });
      }
    } catch (err: any) {
      results.push({ id: sc.id, title: sc.title, pass: false, failures: [`scenario crashed: ${err.message}`], durationMs: Date.now() - t0 });
    }
  }
  send({
    runtime: deps.runtimeName(),
    results,
    summary: { pass: results.filter((r) => r.pass).length, fail: results.filter((r) => !r.pass).length },
  });
}
