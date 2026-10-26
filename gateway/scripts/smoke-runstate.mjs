#!/usr/bin/env node
// T2-2 真机冒烟：回合软暂停（suspend/resume/discard + 队列闸门 + run.updated）。
// 前置：gateway 运行中（默认 127.0.0.1:3000）；会创建临时 git 仓库与会话。
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
  const text = await r.text();
  let body; try { body = JSON.parse(text); } catch { body = text; }
  return { status: r.status, body };
}

const post = (p, body) => j(`${BASE}${p}`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body ?? {}),
});

let failures = 0;
const check = (name, cond, extra = '') => {
  console.log(`[run-smoke] ${cond ? 'PASS' : 'FAIL'} ${name}${extra ? ' — ' + extra : ''}`);
  if (!cond) failures++;
};

async function messages(sid) {
  const r = await j(`${BASE}/api/sessions/${sid}/messages?limit=100`);
  return (r.body?.data ?? []).map((m) => m.info ?? m);
}

/** 发起长回合并轮询 suspend，直到成功或回合结束。 */
async function suspendDuringTurn(sid, prompt, attempts = 3) {
  for (let a = 0; a < attempts; a++) {
    await post(`/api/session/${sid}/promptAsync`, { message: prompt });
    for (let i = 0; i < 40; i++) {
      await sleep(500);
      const r = await post(`/api/sessions/${sid}/suspend`, { reason: 'smoke' });
      if (r.status === 200) return r.body.run;
    }
    await post(`/api/sessions/${sid}/abort`, {}).catch(() => {});
    await sleep(1500);
    const msgs = await messages(sid);
    const tail = msgs.slice(-2).map((m) => `${m.role}:${(m.parts ?? []).filter((p) => p.type === 'text').map((p) => p.text).join(' ').slice(0, 90)}`);
    console.log(`[run-smoke] (retry ${a + 1}: turn finished before suspend)`, tail.join(' | '));
  }
  return null;
}

(async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mafw-run-smoke-'));
  const repo = path.join(root, 'repo');
  fs.mkdirSync(repo, { recursive: true });
  await git(repo, ['init', '-q']);
  await git(repo, ['config', 'user.email', 'smoke@example.com']);
  await git(repo, ['config', 'user.name', 'smoke']);
  fs.writeFileSync(path.join(repo, 'f.txt'), 'a\n');
  await git(repo, ['add', '.']);
  await git(repo, ['commit', '-q', '-m', 'base']);

  const created = await post('/api/session', { directory: repo, title: 't2-2 smoke' });
  const sid = created.body?.id;
  console.log('[run-smoke] session', created.status, sid);
  if (!sid) process.exit(1);
  const sid2 = (await post('/api/session', { directory: repo, title: 't2-2 smoke-discard' })).body?.id;

  try {
    for (const s of [sid, sid2]) {
      const cfg = await post(`/api/session/${s}/config`, { category: 'mode', value: 'full-access' });
      if (cfg.status !== 200) console.log('[run-smoke] mode set failed', cfg.status, JSON.stringify(cfg.body).slice(0, 160));
      const mc = await post(`/api/session/${s}/config`, {
        category: 'model',
        value: { providerID: 'gateway', modelID: 'volcengine/deepseek-v4.1-flash' },
      });
      if (mc.status !== 200) console.log('[run-smoke] model set failed', mc.status, JSON.stringify(mc.body).slice(0, 160));
    }

    // 空闲会话暂停 → 409（先验，避免被后续队列转成的回合干扰）
    const idleBefore = await post(`/api/sessions/${sid}/suspend`, {});
    check('suspend while idle => 409', idleBefore.status === 409, `status=${idleBefore.status}`);

    // ── A. suspend → queue gate → resume ────────────────────────
    const longPrompt = 'Use the bash tool to run exactly this command: sleep 20 — then reply with exactly: done. Do not do anything else first.';
    const run = await suspendDuringTurn(sid, longPrompt);
    check('suspend during a live turn => 200 + suspended', !!run && run.status === 'suspended', `status=${run?.status}`);
    check('brief captures the paused request', !!run && run.brief.lastUserText.includes('sleep 20'), JSON.stringify(run?.brief ?? {}).slice(0, 160));

    const listed = await j(`${BASE}/api/sessions/${sid}/run`);
    check('GET /run returns the suspended run', !!run && listed.body?.run?.id === run.id);

    const again = await post(`/api/sessions/${sid}/suspend`, {});
    check('second suspend => 409', again.status === 409, `status=${again.status}`);

    const queued = await post(`/api/session/${sid}/promptAsync`, { message: 'queued while paused', delivery: 'queue' });
    check('prompt while suspended is queued (200 queued:true)', queued.status === 200 && queued.body?.queued === true, JSON.stringify(queued.body).slice(0, 120));
    const q = await j(`${BASE}/api/session/${sid}/queue`);
    check('gateway queue holds the paused message', (q.body?.items ?? []).length >= 1, `items=${(q.body?.items ?? []).length}`);

    let resumed = null;
    for (let i = 0; i < 20; i++) {
      const r = await post(`/api/sessions/${sid}/resume`, {});
      if (r.status === 200) { resumed = r; break; }
      await sleep(500);
    }
    check('resume => 200 prompted', resumed?.status === 200 && resumed?.body?.prompted === true, JSON.stringify(resumed?.body ?? {}).slice(0, 140));

    let sawResumePrompt = false;
    let active = null;
    for (let i = 0; i < 120; i++) {
      await sleep(1000);
      const msgs = await messages(sid);
      if (msgs.some((m) => {
        const parts = Array.isArray(m.parts) ? m.parts : [];
        const text = [typeof m.text === 'string' ? m.text : '', ...parts.filter((p) => p?.type === 'text').map((p) => String(p.text ?? ''))].join('\n');
        return text.includes('[MAFW 续跑]');
      })) sawResumePrompt = true;
      const r = await j(`${BASE}/api/sessions/${sid}/run`);
      active = r.body?.run ?? null;
      if (!active && sawResumePrompt) break;
    }
    check('resume prompt is in history', sawResumePrompt);
    check('run finished (no active run)', active === null, JSON.stringify(active).slice(0, 120));

    // ── B. discard clears the gate and flushes queued work ──────
    const run2 = await suspendDuringTurn(sid2, longPrompt);
    check('second session suspend => suspended', !!run2 && run2.status === 'suspended');

    const q2 = await post(`/api/session/${sid2}/promptAsync`, { message: 'deliver after discard', delivery: 'queue' });
    check('queue accepted while suspended (session B)', q2.status === 200 && q2.body?.queued === true);

    const dropped = await post(`/api/sessions/${sid2}/run/discard`, {});
    check('discard => cancelled', dropped.status === 200 && dropped.body?.run?.status === 'cancelled', JSON.stringify(dropped.body).slice(0, 120));

    let flushed = false;
    for (let i = 0; i < 30; i++) {
      await sleep(500);
      const msgs = await messages(sid2);
      if (msgs.some((m) => {
        const parts = Array.isArray(m.parts) ? m.parts : [];
        const text = [typeof m.text === 'string' ? m.text : '', ...parts.filter((p) => p?.type === 'text').map((p) => String(p.text ?? ''))].join('\n');
        return text.includes('deliver after discard');
      })) {
        flushed = true;
        break;
      }
    }
    check('discard flushes the gateway queue', flushed);
    await post(`/api/sessions/${sid2}/abort`, {});
  } finally {
    await j(`${BASE}/api/sessions/${sid}`, { method: 'DELETE' });
    if (sid2) await j(`${BASE}/api/sessions/${sid2}`, { method: 'DELETE' });
    try { fs.rmSync(root, { recursive: true, force: true }); } catch {}
  }

  console.log(`[run-smoke] ${failures === 0 ? 'ALL PASS' : failures + ' FAILURES'}`);
  process.exit(failures === 0 ? 0 : 2);
})().catch((e) => { console.error('[run-smoke] ERROR', e); process.exit(3); });
