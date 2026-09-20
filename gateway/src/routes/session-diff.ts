// 会话 diff 端点（切片 2，deps 注入可单测）。
// GET /api/sessions/:sid/diff?messageID= → runtime.session.diff（opencode v2 快照 diff）
// POST /api/sessions/:sid/diff/revert → buildRevertPatch（选中 hunk 反转）→ runtime.session.vcs.apply
// 能力门：runtime 缺 diffApi → 503；apply/dec 失败 → 502 带原始错误消息（不静默）。
import * as http from 'http';
import { AgentRuntime } from '../runtime/contract';
import { buildRevertPatch } from '../core/diff/hunk-patch';

function readBody(req: http.IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', (chunk: string) => { body += chunk; });
    req.on('end', () => resolve(body));
    req.on('error', reject);
  });
}

function json(res: http.ServerResponse, status: number, payload: any): void {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(payload));
}

export interface SessionDiffDeps {
  runtime: AgentRuntime | null;
}

function hasDiffApi(rt: SessionDiffDeps['runtime']): boolean {
  return !!(rt?.capabilities as any)?.diffApi;
}

export async function handleSessionDiff(
  res: http.ServerResponse,
  sessionID: string,
  messageID: string | undefined,
  deps: SessionDiffDeps,
): Promise<void> {
  if (!hasDiffApi(deps.runtime)) {
    json(res, 503, { error: "capability 'diffApi' not available on this runtime" });
    return;
  }
  try {
    const files = await deps.runtime!.session.diff!({
      sessionID,
      ...(messageID ? { messageID } : {}),
    });
    json(res, 200, { files: Array.isArray(files) ? files : [] });
  } catch (err: any) {
    json(res, 502, { error: err?.message ?? String(err) });
  }
}

interface RevertPatchEntry { file?: string; patch?: string; hunkIndices?: unknown }

function validateEntries(body: any): { ok: true; entries: Array<{ patch: string; hunkIndices: number[] }> } | { ok: false; error: string } {
  const patches = body?.patches;
  if (!Array.isArray(patches) || patches.length === 0) return { ok: false, error: 'patches must be a non-empty array' };
  for (const p of patches as RevertPatchEntry[]) {
    if (typeof p?.patch !== 'string' || !p.patch.trim()) return { ok: false, error: 'each entry needs a non-empty patch' };
    const idx = p?.hunkIndices;
    if (!Array.isArray(idx) || idx.length === 0 || !idx.every((i) => Number.isInteger(i) && i >= 0)) {
      return { ok: false, error: 'each entry needs non-empty hunkIndices (non-negative integers)' };
    }
    const total = p.patch.split('\n').filter((l: string) => l.startsWith('@@ ')).length;
    if (idx.some((i) => i >= total)) return { ok: false, error: `hunkIndices out of range (patch has ${total} hunks)` };
  }
  return {
    ok: true,
    entries: (patches as RevertPatchEntry[]).map((p) => ({ patch: p.patch!, hunkIndices: p.hunkIndices as number[] })),
  };
}

export async function handleSessionDiffRevert(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  sessionID: string,
  deps: SessionDiffDeps,
): Promise<void> {
  if (!hasDiffApi(deps.runtime) || typeof (deps.runtime!.session as any)?.vcs?.apply !== 'function') {
    json(res, 503, { error: "capability 'diffApi' not available on this runtime" });
    return;
  }
  let body: any;
  try {
    body = JSON.parse(await readBody(req) || '{}');
  } catch (err: any) {
    json(res, 400, { error: `invalid JSON: ${err.message}` });
    return;
  }
  const parsed = validateEntries(body);
  if (!parsed.ok) { json(res, 400, { error: parsed.error }); return; }

  const patch = buildRevertPatch(parsed.entries);
  if (!patch) { json(res, 400, { error: 'no valid hunks selected' }); return; }

  try {
    await deps.runtime!.session.vcs!.apply!({ patch });
    json(res, 200, { reverted: parsed.entries.length });
  } catch (err: any) {
    json(res, 502, { error: err?.message ?? String(err) });
  }
}
