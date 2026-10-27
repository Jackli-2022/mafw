#!/usr/bin/env node
// T2-4 live smoke: per-session instruction entries on opencode 2.1.
//
// Automated:
//   1. runtime advertises instructionsApi
//   2. first gateway prompt writes mafw.memory-guide / user-profile / agent-priors
//   3. /api/recall/instructions reports managed:true, missing:[]
//   4. second prompt leaves instruction_entry.time_updated unchanged
//   5. deleting user-profile makes the endpoint report only that missing block
//   6. a gateway prompt restores the deleted entry
//   7. fork copies the three entries
//
// Manual (not automated to avoid mutating real memory / restarting serve):
//   - pinned change: add a pinned marker -> prompt -> user-profile contains it -> unpin
//   - compaction: POST /api/session/:id/summarize -> entries still present
//   - pi fallback: switch runtime -> before_agent_start injects the three blocks
//   - enabled=false: config.recall.instructions.enabled=false -> prompt deletes the
//     three keys and the endpoint returns full blocks; restore true
import { execFile } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { promisify } from 'node:util';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const Database = require('../node_modules/better-sqlite3');

const exec = promisify(execFile);
const BASE = process.env.MAFW_SMOKE_BASE || 'http://127.0.0.1:3000';
const DB_PATH = path.join(os.homedir(), '.local', 'share', 'opencode', 'opencode.db');
const KEYS = ['mafw.memory-guide', 'mafw.user-profile', 'mafw.agent-priors'];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let failures = 0;
const check = (name, cond, extra = '') => {
  console.log(`[instr-smoke] ${cond ? 'PASS' : 'FAIL'} ${name}${extra ? ' — ' + extra : ''}`);
  if (!cond) failures++;
};

async function j(url, opts) {
  const r = await fetch(url, opts);
  const t = await r.text();
  let b;
  try { b = JSON.parse(t); } catch { b = t; }
  return { status: r.status, body: b };
}
const get = (p) => j(`${BASE}${p}`);
const post = (p, b) => j(`${BASE}${p}`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(b ?? {}),
});
const del = (p) => j(`${BASE}${p}`, { method: 'DELETE' });

async function entries(sid) {
  const r = await get(`/api/experimental/session/${sid}/instructions/entries`);
  return Array.isArray(r.body?.data) ? r.body.data : [];
}

async function waitEntries(sid, count = 3) {
  for (let i = 0; i < 40; i++) {
    const rows = await entries(sid);
    const present = rows.filter((e) => KEYS.includes(e?.key) && typeof e?.value === 'string' && e.value.length > 0);
    if (present.length >= count) return rows;
    await sleep(250);
  }
  return entries(sid);
}

function readEntryTimes(sid) {
  const db = new Database(DB_PATH, { readonly: true, fileMustExist: true });
  try {
    const rows = db.prepare(
      'select key, time_updated from instruction_entry where session_id=? and removed=0',
    ).all(sid);
    return new Map(rows.map((r) => [r.key, r.time_updated]));
  } finally {
    db.close();
  }
}

(async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mafw-instr-smoke-'));
  const repo = path.join(root, 'repo');
  fs.mkdirSync(repo, { recursive: true });
  let sid = null;
  let forkId = null;

  try {
    const runtime = await get('/api/runtime');
    const active = runtime.body?.active ?? runtime.body;
    const can = active?.capabilities?.instructionsApi === true;
    check('runtime advertises instructionsApi', can, active?.name);
    if (!can) {
      console.log('[instr-smoke] SKIP — runtime has no instruction entries (pi/older opencode)');
      return;
    }

    await exec('git', ['init', '-q'], { cwd: repo, windowsHide: true });
    await exec('git', ['config', 'user.email', 'smoke@example.com'], { cwd: repo, windowsHide: true });
    await exec('git', ['config', 'user.name', 'smoke'], { cwd: repo, windowsHide: true });
    fs.writeFileSync(path.join(repo, 'f.txt'), 'base\n');
    await exec('git', ['add', '.'], { cwd: repo, windowsHide: true });
    await exec('git', ['commit', '-q', '-m', 'base'], { cwd: repo, windowsHide: true });

    const created = await post('/api/session', { directory: repo, title: 't2-4 instruction smoke' });
    sid = created.body?.id;
    check('session created', typeof sid === 'string' && sid.startsWith('ses_'), String(sid));
    if (!sid) throw new Error('session create failed: ' + JSON.stringify(created.body).slice(0, 200));

    await post(`/api/session/${sid}/config`, { category: 'mode', value: 'full-access' });
    await post(`/api/session/${sid}/config`, {
      category: 'model',
      value: { providerID: 'gateway', modelID: 'volcengine/deepseek-v4.1-flash' },
    });

    // The gateway sync runs before promptAsync reaches the runtime, so entries
    // exist even if the model call itself fails (credits/offline).
    const first = await post(`/api/session/${sid}/promptAsync`, { message: 'Reply with exactly: instr-one' });
    if (first.status >= 400) console.log('[instr-smoke] first prompt returned', first.status, JSON.stringify(first.body).slice(0, 160));
    const rows1 = await waitEntries(sid, 3);
    const values1 = new Map(rows1.map((e) => [e.key, e.value]));
    check('three instruction entries exist', KEYS.every((k) => typeof values1.get(k) === 'string' && values1.get(k).length > 0), KEYS.map((k) => `${k}:${values1.has(k)}`).join(','));

    const managed1 = await get(`/api/recall/instructions?sessionID=${encodeURIComponent(sid)}`);
    check('endpoint managed=true', managed1.body?.managed === true, JSON.stringify(managed1.body)?.slice(0, 200));
    check('endpoint missing=[]', Array.isArray(managed1.body?.missing) && managed1.body.missing.length === 0);
    check('endpoint revision is sha256', /^[a-f0-9]{64}$/.test(String(managed1.body?.revision || '')));

    const times1 = readEntryTimes(sid);
    check('db has three entries', KEYS.every((k) => times1.has(k)), [...times1.keys()].join(','));

    // Second prompt: cache hit → no PUT/DELETE; time_updated unchanged.
    const second = await post(`/api/session/${sid}/promptAsync`, { message: 'Reply with exactly: instr-two' });
    if (second.status >= 400) console.log('[instr-smoke] second prompt returned', second.status, JSON.stringify(second.body).slice(0, 160));
    await sleep(500);
    const times2 = readEntryTimes(sid);
    check('second prompt is write-free', KEYS.every((k) => times1.get(k) === times2.get(k)), KEYS.map((k) => `${k}:${times1.get(k)}->${times2.get(k)}`).join(','));

    // Partial entry: delete profile; the endpoint must return only that block.
    const delProfile = await del(`/api/experimental/session/${sid}/instructions/entries/mafw.user-profile`);
    check('delete profile entry -> 204', delProfile.status === 204, String(delProfile.status));
    const managed2 = await get(`/api/recall/instructions?sessionID=${encodeURIComponent(sid)}`);
    check('endpoint reports missing profile', managed2.body?.managed === false && Array.isArray(managed2.body?.missing) && managed2.body.missing.includes('mafw.user-profile'), JSON.stringify(managed2.body)?.slice(0, 240));
    check('endpoint returns only profile block', typeof managed2.body?.blocks?.userProfile === 'string' && managed2.body?.blocks?.memoryGuide === undefined);

    // Next gateway prompt re-syncs the missing key.
    const third = await post(`/api/session/${sid}/promptAsync`, { message: 'Reply with exactly: instr-three' });
    if (third.status >= 400) console.log('[instr-smoke] third prompt returned', third.status, JSON.stringify(third.body).slice(0, 160));
    const rows3 = await waitEntries(sid, 3);
    check('prompt restores profile entry', rows3.some((e) => e.key === 'mafw.user-profile' && typeof e.value === 'string' && e.value.length > 0));
    const managed3 = await get(`/api/recall/instructions?sessionID=${encodeURIComponent(sid)}`);
    check('endpoint managed=true after restore', managed3.body?.managed === true, JSON.stringify(managed3.body)?.slice(0, 200));

    // Fork copies entries (opencode owns this; the smoke pins the behavior we rely on).
    const msgs = await get(`/api/sessions/${sid}/messages?limit=20`);
    const list = Array.isArray(msgs.body?.data) ? msgs.body.data : [];
    const userMsg = list.map((m) => m.info ?? m).find((m) => m?.role === 'user' || m?.type === 'user');
    const fork = await post(`/api/sessions/${sid}/fork`, userMsg?.id ? { messageID: userMsg.id } : {});
    forkId = fork.body?.session?.id ?? fork.body?.id ?? null;
    check('fork created', typeof forkId === 'string' && forkId.startsWith('ses_'), String(forkId));
    if (forkId) {
      const forkRows = await waitEntries(forkId, 3);
      check('fork copies three entries', KEYS.every((k) => forkRows.some((e) => e.key === k)), forkRows.map((e) => e.key).join(','));
    }
  } catch (err) {
    check('smoke completed without exception', false, err?.message ?? String(err));
  } finally {
    if (forkId) await del(`/api/session/${encodeURIComponent(forkId)}`).catch(() => {});
    if (sid) await del(`/api/session/${encodeURIComponent(sid)}`).catch(() => {});
    try { fs.rmSync(root, { recursive: true, force: true }); } catch { /* ignore */ }
  }

  console.log(`[instr-smoke] done failures=${failures}`);
  process.exit(failures > 0 ? 1 : 0);
})();
