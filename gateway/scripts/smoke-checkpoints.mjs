// T2-1 真机冒烟：自动检查点 / 三态 restore / 后悔药 / 时间线倒带 / 事件。
import { execFile } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { promisify } from 'node:util';

const exec = promisify(execFile);
const BASE = 'http://127.0.0.1:3000';
const git = async (cwd, args) => (await exec('git', args, { cwd, windowsHide: true, encoding: 'utf8' })).stdout.trim();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function j(url, opts) {
  const r = await fetch(url, opts);
  const text = await r.text();
  let body; try { body = JSON.parse(text); } catch { body = text; }
  return { status: r.status, body };
}

async function waitIdle(sid, minMessages) {
  for (let i = 0; i < 120; i++) {
    await sleep(1000);
    const r = await j(`${BASE}/api/sessions/${sid}/messages?limit=50`);
    const msgs = (r.body?.data ?? []).map((m) => m.info ?? m);
    const assistants = msgs.filter((m) => m.role === 'assistant');
    if (msgs.length >= minMessages && assistants.length > 0 && assistants.every((m) => m?.time?.completed)) return msgs;
  }
  throw new Error('turn timed out');
}

async function checkpoints(sid) {
  const r = await j(`${BASE}/api/sessions/${sid}/checkpoints`);
  if (r.status !== 200) throw new Error(`list checkpoints ${r.status}: ${JSON.stringify(r.body)}`);
  return r.body.checkpoints;
}

async function waitCheckpoints(sid, n) {
  for (let i = 0; i < 20; i++) {
    const list = await checkpoints(sid);
    if (list.length >= n) return list;
    await sleep(500);
  }
  return checkpoints(sid);
}

(async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mafw-ckpt-smoke-'));
  const repo = path.join(root, 'repo');
  fs.mkdirSync(repo, { recursive: true });
  await git(repo, ['init', '-q']);
  await git(repo, ['config', 'user.email', 'smoke@example.com']);
  await git(repo, ['config', 'user.name', 'smoke']);
  fs.writeFileSync(path.join(repo, 'file0.txt'), 'base\n');
  await git(repo, ['add', '.']);
  await git(repo, ['commit', '-q', '-m', 'base']);

  const created = await j(`${BASE}/api/session`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ directory: repo, title: 't2-1 smoke' }),
  });
  const sid = created.body?.id;
  console.log('[smoke] session', created.status, sid);
  if (!sid) process.exit(1);

  let failures = 0;
  const check = (name, cond, extra = '') => {
    console.log(`[smoke] ${cond ? 'PASS' : 'FAIL'} ${name}${extra ? ' — ' + extra : ''}`);
    if (!cond) failures++;
  };

  try {
    // ── turn 1（只回复，不改文件）──────────────────────────────
    await j(`${BASE}/api/session/${sid}/promptAsync`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: 'Reply with exactly: one' }),
    });
    await waitIdle(sid, 2);
    const after1 = await waitCheckpoints(sid, 1);
    const ckpt1 = after1[after1.length - 1];
    check('turn1 auto checkpoint recorded', !!ckpt1, `id=${ckpt1?.id} tree=${ckpt1?.snapshotTree?.slice(0, 8)} kind=${ckpt1?.kind}`);
    check('turn1 checkpoint has file tree', typeof ckpt1?.snapshotTree === 'string' && ckpt1.snapshotTree.length >= 40);

    // ── 回合外提交（用户在两轮之间 commit 新文件）────────────────
    fs.writeFileSync(path.join(repo, 'demo.txt'), 'one\n');
    await git(repo, ['add', '.']);
    await git(repo, ['commit', '-q', '-m', 'add demo']);

    // ── turn 2（只回复；其 pre-turn 快照应包含 demo.txt）──────────
    await j(`${BASE}/api/session/${sid}/promptAsync`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: 'Reply with exactly: two' }),
    });
    await waitIdle(sid, 4);
    const after2 = await waitCheckpoints(sid, 2);
    const newest = after2[0];
    check('turn2 auto checkpoint recorded', after2.length >= 2, `count=${after2.length}`);
    check('checkpoints newest-first', Date.parse(newest.createdAt) >= Date.parse(ckpt1.createdAt));

    // ── files restore 到 ckpt1：demo.txt 应被删除 ─────────────────
    fs.writeFileSync(path.join(repo, 'loose.txt'), 'untracked\n');
    const r1 = await j(`${BASE}/api/sessions/${sid}/checkpoints/${ckpt1.id}/restore`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ scope: 'files', confirm: true }),
    });
    check('files restore 200', r1.status === 200, `status=${r1.status} ${JSON.stringify(r1.body).slice(0, 200)}`);
    check('demo.txt deleted by files restore', !fs.existsSync(path.join(repo, 'demo.txt')));
    check('loose.txt reported as leftover', (r1.body?.leftoverUntracked ?? []).includes('loose.txt'), JSON.stringify(r1.body?.leftoverUntracked));
    check('loose.txt not deleted', fs.existsSync(path.join(repo, 'loose.txt')));
    const preId = r1.body?.preRestoreCheckpointId;
    check('pre-restore checkpoint created', typeof preId === 'string' && preId.length > 0);

    // ── 后悔药：恢复到 pre-restore → demo.txt 回来 ──────────────
    const r2 = await j(`${BASE}/api/sessions/${sid}/checkpoints/${preId}/restore`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ scope: 'files', confirm: true }),
    });
    check('undo restore 200', r2.status === 200, `status=${r2.status} ${JSON.stringify(r2.body).slice(0, 200)}`);
    check('demo.txt restored by undo', fs.readFileSync(path.join(repo, 'demo.txt'), 'utf8') === 'one\n');

    // ── 手动检查点 + SSE 事件 ────────────────────────────────────
    const sseEvents = [];
    const ac = new AbortController();
    const ssePromise = (async () => {
      try {
        const r = await fetch(`${BASE}/api/events`, { signal: ac.signal, headers: { Accept: 'text/event-stream' } });
        if (!r.ok || !r.body) return;
        const reader = r.body.getReader();
        const dec = new TextDecoder();
        let buf = '';
        const deadline = Date.now() + 8000;
        while (Date.now() < deadline) {
          const { value, done } = await reader.read();
          if (done) break;
          buf += dec.decode(value, { stream: true });
          const frames = buf.split('\n\n');
          buf = frames.pop() ?? '';
          for (const f of frames) {
            const line = f.split('\n').find((l) => l.startsWith('data: '));
            if (!line) continue;
            try { sseEvents.push(JSON.parse(line.slice(6))); } catch {}
          }
          if (sseEvents.some((e) => e?.type === 'session.checkpoint' || e?.data?.type === 'session.checkpoint')) break;
        }
      } catch {}
    })();

    const manual = await j(`${BASE}/api/sessions/${sid}/checkpoint`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({}),
    });
    check('manual checkpoint 200', manual.status === 200 && manual.body?.checkpoint?.kind === 'manual');
    await sleep(600); // SSE 建连是异步的，给握手留时间（事件在 create 后立即广播）
    await Promise.race([ssePromise, sleep(6000)]);
    ac.abort();
    const typeOf = (e) => e?.data?.type ?? e?.type;
    const sawEvent = sseEvents.some((e) => typeOf(e) === 'session.checkpoint');
    check('session.checkpoint SSE event observed', sawEvent, `events=${sseEvents.map(typeOf).join(',')}`);

    // ── 破坏性门 + 404 ──────────────────────────────────────────
    const noConfirm = await j(`${BASE}/api/sessions/${sid}/checkpoints/${ckpt1.id}/restore`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ scope: 'files' }),
    });
    check('restore without confirm => 400', noConfirm.status === 400, `status=${noConfirm.status}`);
    const unknown = await j(`${BASE}/api/sessions/${sid}/checkpoints/ckpt_nope/restore`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ scope: 'files', confirm: true }),
    });
    check('unknown checkpoint => 404', unknown.status === 404, `status=${unknown.status}`);

    // ── review 修复活体断言 ─────────────────────────────────────
    // 1) files 幂等不是空口：恢复到同一检查点（记忆=目标树）后回合外编辑 → 400
    fs.writeFileSync(path.join(repo, 'file0.txt'), 'edited-out-of-turn\n');
    const dirty = await j(`${BASE}/api/sessions/${sid}/checkpoints/${preId}/restore`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ scope: 'files', confirm: true }),
    });
    check('out-of-turn edit rejected on idempotent path (400)', dirty.status === 400, `status=${dirty.status}`);
    await git(repo, ['checkout', '--', 'file0.txt']).catch(() => {});

    // 2) manual checkpoint 仅代码：session/both 应 400
    const manualSession = await j(`${BASE}/api/sessions/${sid}/checkpoints/${manual.body.checkpoint.id}/restore`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ scope: 'session', confirm: true }),
    });
    check('manual checkpoint session restore => 400 (files-only)', manualSession.status === 400, `status=${manualSession.status}`);

    // ── session restore 到 turn2：时间线倒带 ────────────────────
    const before = await checkpoints(sid);
    const beforeMsgs = (await j(`${BASE}/api/sessions/${sid}/messages?limit=50`)).body?.data ?? [];
    const turn2Ckpt = before.find((c) => c.id !== ckpt1.id && c.kind === 'auto' && c.id !== preId);
    const target = turn2Ckpt ?? newest;
    const rs = await j(`${BASE}/api/sessions/${sid}/checkpoints/${target.id}/restore`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ scope: 'session', confirm: true }),
    });
    check('session restore 200', rs.status === 200, `status=${rs.status} ${JSON.stringify(rs.body).slice(0, 160)}`);
    const after = await checkpoints(sid);
    check('timeline rewound (target and later checkpoints deleted)', after.every((c) => Date.parse(c.createdAt) < Date.parse(target.createdAt)), `before=${before.length} after=${after.length}`);
    const afterMsgs = (await j(`${BASE}/api/sessions/${sid}/messages?limit=50`)).body?.data ?? [];
    check('exclusive anchor: target anchor message removed', afterMsgs.length < beforeMsgs.length, `msgs ${beforeMsgs.length} -> ${afterMsgs.length}`);

    // ── 历史被截断、工作区未被 session 档改动 ────────────────────
    check('session scope left working tree untouched', fs.readFileSync(path.join(repo, 'demo.txt'), 'utf8') === 'one\n');
  } finally {
    await j(`${BASE}/api/sessions/${sid}`, { method: 'DELETE' });
    try { fs.rmSync(root, { recursive: true, force: true }); } catch {}
  }

  console.log(`[smoke] ${failures === 0 ? 'ALL PASS' : failures + ' FAILURES'}`);
  process.exit(failures === 0 ? 0 : 2);
})().catch((e) => { console.error('[smoke] ERROR', e); process.exit(3); });
