#!/usr/bin/env node
// T2-3 真机冒烟：data part 注入 / 同 id 更新 / 历史合并 / transient 不入历史 / 各类校验。
import { execFile } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { promisify } from 'node:util';

const exec = promisify(execFile);
const BASE = process.env.MAFW_SMOKE_BASE || 'http://127.0.0.1:3000';
const git = async (cwd, args) => (await exec('git', args, { cwd, windowsHide: true, encoding: 'utf8' })).stdout.trim();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function j(url, opts) {
  const r = await fetch(url, opts);
  const t = await r.text();
  let b; try { b = JSON.parse(t); } catch { b = t; }
  return { status: r.status, body: b };
}
const post = (p, b) => j(`${BASE}${p}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(b ?? {}) });
async function messages(sid) {
  const r = await j(`${BASE}/api/sessions/${sid}/messages?limit=50`);
  return (r.body?.data ?? []).map((m) => ({ info: m.info ?? m, parts: Array.isArray(m.parts) ? m.parts : [] }));
}
async function waitAssistant(sid, minCount = 1) {
  for (let i = 0; i < 90; i++) {
    await sleep(1000);
    const msgs = await messages(sid);
    const assistants = msgs.filter((m) => m.info.role === 'assistant' && m.info?.time?.completed);
    if (assistants.length >= minCount) return assistants;
  }
  throw new Error('assistant timeout');
}
let failures = 0;
const check = (name, cond, extra = '') => {
  console.log(`[data-smoke] ${cond ? 'PASS' : 'FAIL'} ${name}${extra ? ' — ' + extra : ''}`);
  if (!cond) failures++;
};

(async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mafw-data-smoke-'));
  const repo = path.join(root, 'repo');
  fs.mkdirSync(repo, { recursive: true });
  await git(repo, ['init', '-q']);
  await git(repo, ['config', 'user.email', 'smoke@example.com']);
  await git(repo, ['config', 'user.name', 'smoke']);
  fs.writeFileSync(path.join(repo, 'f.txt'), 'a\n');
  await git(repo, ['add', '.']);
  await git(repo, ['commit', '-q', '-m', 'base']);

  const created = await post('/api/session', { directory: repo, title: 't2-3 data smoke' });
  const sid = created.body?.id;
  console.log('[data-smoke] session', created.status, sid);
  if (!sid) process.exit(1);

  try {
    await post(`/api/session/${sid}/config`, { category: 'mode', value: 'full-access' });
    await post(`/api/session/${sid}/config`, {
      category: 'model',
      value: { providerID: 'gateway', modelID: 'volcengine/deepseek-v4.1-flash' },
    });

    await post(`/api/session/${sid}/promptAsync`, { message: 'Reply with exactly: one' });
    const [a1] = await waitAssistant(sid, 1);
    check('first assistant message exists', !!a1?.info?.id, a1?.info?.id);

    const first = await post(`/api/sessions/${sid}/data`, {
      name: 'probe', id: 'job', data: { v: 1 },
    });
    check('inject persistent data part => 200', first.status === 200, JSON.stringify(first.body).slice(0, 160));
    const part = first.body?.part;
    check('part shape: data_ id / data-probe / assistant-bound', !!part
      && part.id.startsWith('data_') && part.type === 'data-probe' && part.messageID === a1.info.id,
      JSON.stringify(part).slice(0, 160));

    let msgs = await messages(sid);
    const merged = msgs.find((m) => m.info.id === a1.info.id)?.parts?.find((p) => p.id === part.id);
    check('persistent part merged into history', !!merged && merged.data?.v === 1, JSON.stringify(merged).slice(0, 120));

    const second = await post(`/api/sessions/${sid}/data`, {
      name: 'probe', id: 'job', data: { v: 2 },
    });
    msgs = await messages(sid);
    const parts = msgs.find((m) => m.info.id === a1.info.id)?.parts ?? [];
    const same = parts.filter((p) => p.id === second.body?.part?.id);
    check('same id updates in place (one part, v2)', same.length === 1 && same[0].data?.v === 2,
      `count=${same.length} data=${JSON.stringify(same[0]?.data)}`);

    await post(`/api/session/${sid}/promptAsync`, { message: 'Reply with exactly: two' });
    const assistants = await waitAssistant(sid, 2);
    const a2 = assistants.find((m) => m.info.id !== a1.info.id);
    const moved = await post(`/api/sessions/${sid}/data`, {
      name: 'probe', id: 'job', data: { v: 3 }, messageID: a2.info.id,
    });
    check('same id cross-message => 409', moved.status === 409, `status=${moved.status}`);

    const transient = await post(`/api/sessions/${sid}/data`, {
      name: 'live', id: 'live-1', data: { pulse: 1 }, transient: true, messageID: a2.info.id,
    });
    check('transient injection => 200 + transient flag', transient.status === 200 && transient.body?.part?.transient === true);
    msgs = await messages(sid);
    const allParts = msgs.flatMap((m) => m.parts);
    check('transient not in history', !allParts.some((p) => p.id === transient.body?.part?.id));

    const userMsg = msgs.find((m) => m.info.role === 'user')?.info?.id;
    const onUser = await post(`/api/sessions/${sid}/data`, { name: 'probe', id: 'u', data: {}, messageID: userMsg });
    check('user message target => 400', onUser.status === 400, `status=${onUser.status}`);

    const big = await post(`/api/sessions/${sid}/data`, { name: 'probe', id: 'big', data: { x: 'y'.repeat(70_000) } });
    check('oversize data => 400', big.status === 400, `status=${big.status}`);

    const badName = await post(`/api/sessions/${sid}/data`, { name: 'BAD', data: {} });
    check('invalid name => 400', badName.status === 400, `status=${badName.status}`);
  } finally {
    await j(`${BASE}/api/sessions/${sid}`, { method: 'DELETE' });
    try { fs.rmSync(root, { recursive: true, force: true }); } catch {}
  }

  console.log(`[data-smoke] ${failures === 0 ? 'ALL PASS' : failures + ' FAILURES'}`);
  process.exit(failures === 0 ? 0 : 2);
})().catch((e) => { console.error('[data-smoke] ERROR', e); process.exit(3); });
