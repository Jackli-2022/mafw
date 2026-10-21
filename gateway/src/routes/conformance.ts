/**
 * POST /api/runtime/conformance —— 对活跃 runtime 跑场景一致性验证。
 *
 * 驱动真实会话（消耗 LLM 调用），事件观测经 gateway 的 event tap 收集；
 * 结果含 per-scenario pass/fail 与失败说明。会话尽力清理（fail-open）。
 */
import * as http from 'http';
import { SCENARIOS, evaluateScenario, ObservedEvent } from '../runtime/conformance-scenarios';
import { buildToolPartEvent } from '../runtime/mafw-tools';

export interface ConformanceDeps {
  runtimeName(): string;
  caps(): { sessionApi?: boolean; eventStream?: boolean } & Record<string, unknown>;
  createSession(opts?: { directory?: string }): Promise<{ id: string }>;
  promptAsync(opts: { sessionID: string; message: string }): Promise<void>;
  deleteSession(id: string): Promise<void>;
  listSessions(): Promise<Array<{ id?: string }>>;
  registerEventTap(sessionID: string, cb: (e: ObservedEvent) => void): () => void;
  /** S3/S4：按会话取 T1 观察行。 */
  getObservations(sessionID: string): Promise<Array<{ source: string; content: string }>>;
  /** S4：gateway 侧 recall/context 最近触达时间（null = 从未）。 */
  getRecallCalledAt(sessionID: string): number | null;
  /** S5：绑定会话身份（策略层评估依据）。 */
  bindIdentity(sessionID: string, identity: string): void;
  /** S5：直接评估合成候选项的网关审批策略。 */
  evaluatePolicy(sessionID: string, candidate: { toolName: string; patterns: string[]; metadata: Record<string, unknown> }): { action: string };
  /** tool-visibility：注入点（与 /api/tools/execute 同一管线 = handleOpencodeEvent）。 */
  injectEvent(evt: unknown): void;
  /** B2：拉会话历史（session-lifecycle 历史形状断言用）。 */
  getMessages(sessionID: string): Promise<any[]>;
  /** B3：入口拦截计数快照（chat-roundtrip unmatched 差分断言用）；缺省不判。 */
  translationDrops?: () => Record<string, { unmatched?: Record<string, number>; suppressed?: Record<string, number> }>;
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

/** B3：场景窗口内 unmatched 差分（after - before）。 */
function diffUnmatched(
  before: Record<string, { unmatched?: Record<string, number> }> | undefined,
  after: Record<string, { unmatched?: Record<string, number> }> | undefined,
): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [src, d] of Object.entries(after ?? {})) {
    for (const [t, n] of Object.entries(d.unmatched ?? {})) {
      const delta = n - (before?.[src]?.unmatched?.[t] ?? 0);
      if (delta > 0) out[t] = (out[t] ?? 0) + delta;
    }
  }
  return out;
}

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
    if (e.type === 'turn.completed' || e.type === 'turn.failed') {
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
        const dropsBefore = deps.translationDrops?.();
        const p = collectUntilTerminal(deps.registerEventTap, sess.id, perTimeout ?? sc.timeoutMs);
        await deps.promptAsync({ sessionID: sess.id, message: sc.prompt });
        const events = await p;
        // B3：场景窗口 unmatched 差分 > 0 = 词汇漂移（升级 runtime 后跑 conformance 即暴露）
        const drops = diffUnmatched(deps.translationDrops?.(), dropsBefore as any);
        const r = evaluateScenario(sc.id, events, undefined, undefined, undefined, { unmatched: drops });
        await deps.deleteSession(sess.id).catch(() => {});
        results.push({ id: sc.id, title: sc.title, ...r, durationMs: Date.now() - t0 });
      } else if (sc.id === 'cognition-observe' || sc.id === 'cognition-inject') {
        const sess = await deps.createSession({});
        const p = collectUntilTerminal(deps.registerEventTap, sess.id, perTimeout ?? sc.timeoutMs);
        await deps.promptAsync({ sessionID: sess.id, message: sc.prompt });
        await p;
        const obs = await deps.getObservations(sess.id);
        const cognition = {
          sources: obs.map((o) => o.source),
          recallCalledAt: deps.getRecallCalledAt(sess.id),
          guideEcho: obs.filter((o) => o.source === 'assistant_reply').map((o) => o.content).join('\n'),
        };
        const r = evaluateScenario(sc.id, [], undefined, cognition);
        await deps.deleteSession(sess.id).catch(() => {});
        results.push({ id: sc.id, title: sc.title, ...r, durationMs: Date.now() - t0 });
      } else if (sc.id === 'identity-roundtrip') {
        const sess = await deps.createSession({});
        deps.bindIdentity(sess.id, 'manager');
        const p = collectUntilTerminal(deps.registerEventTap, sess.id, perTimeout ?? sc.timeoutMs);
        await deps.promptAsync({ sessionID: sess.id, message: sc.prompt });
        await p;
        const obs = await deps.getObservations(sess.id);
        const identity = {
          identityEcho: obs.filter((o) => o.source === 'assistant_reply').map((o) => o.content).join('\n'),
          policy: ['bash', 'webfetch', 'edit'].map((toolName) => ({
            tool: toolName,
            action: deps.evaluatePolicy(sess.id, { toolName, patterns: [], metadata: {} }).action,
          })),
        };
        const r = evaluateScenario(sc.id, [], undefined, undefined, identity);
        await deps.deleteSession(sess.id).catch(() => {});
        results.push({ id: sc.id, title: sc.title, ...r, durationMs: Date.now() - t0 });
      } else if (sc.id === 'tool-visibility') {
        // 确定性、零副作用（不执行真工具、不耗 LLM）：经与 /api/tools/execute 同一
        // 注入点喂探针帧对，tap 断言 canonical 管线产出（spec §4.3）。
        const sid = `conformance_probe_${Date.now()}`;
        const partId = `toolpart_conformance_${Date.now()}`;
        const events: ObservedEvent[] = [];
        const stop = deps.registerEventTap(sid, (e) => events.push(e));
        deps.injectEvent(buildToolPartEvent({ sessionID: sid, partId, tool: 'mafw_conformance_probe', status: 'running', input: {} }));
        deps.injectEvent(buildToolPartEvent({ sessionID: sid, partId, tool: 'mafw_conformance_probe', status: 'completed', input: {}, output: 'probe' }));
        await sleep(300);
        stop();
        const r = evaluateScenario(sc.id, events);
        results.push({ id: sc.id, title: sc.title, ...r, durationMs: Date.now() - t0 });
      } else {
        const sess = await deps.createSession({});
        const listAfterCreate = await deps.listSessions();
        const created = listAfterCreate.some((s) => s.id === sess.id);
        // B2：历史形状断言——create 后拉 messages，出口须为 flat MafwMessage（canonical v3）。
        // 拉取失败（serve 未就绪等）不判死（fail-open，history 传 undefined）。
        const history = await deps.getMessages(sess.id).catch(() => null);
        await deps.deleteSession(sess.id);
        const listAfterDelete = await deps.listSessions();
        const deleted = !listAfterDelete.some((s) => s.id === sess.id);
        const r = evaluateScenario(sc.id, [], { created, deleted, history: history ?? undefined });
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
