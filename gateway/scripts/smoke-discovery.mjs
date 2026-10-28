#!/usr/bin/env node
/**
 * T2-5 live smoke: discovery snapshot, skill load, legacy endpoints,
 * directory scoping, and the session.commands SSE broadcast.
 *
 * Run from the repo root with a live gateway + opencode serve:
 *   node gateway/scripts/smoke-discovery.mjs
 */
import { existsSync } from 'fs';
import * as path from 'path';

const BASE = process.env.MAFW_SMOKE_BASE || 'http://localhost:3000';
const repo = path.resolve(process.cwd());
let pass = 0;
let fail = 0;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** Serve may still be loading plugin commands/skills right after a restart. */
async function waitForRuntimeDiscovery(directory) {
  for (let i = 0; i < 30; i++) {
    const [cmd, skill] = await Promise.all([
      req('GET', `/api/command?directory=${encodeURIComponent(directory)}`),
      req('GET', `/api/skill?directory=${encodeURIComponent(directory)}`),
    ]);
    if ((cmd.json?.data || []).length > 0 && (skill.json?.data || []).length > 0) return true;
    await sleep(500);
  }
  return false;
}

function check(ok, label, detail = '') {
  if (ok) {
    pass++;
    console.log(`[discovery-smoke] PASS ${label}${detail ? ` — ${detail}` : ''}`);
  } else {
    fail++;
    console.log(`[discovery-smoke] FAIL ${label}${detail ? ` — ${detail}` : ''}`);
  }
}

async function req(method, url, body) {
  const res = await fetch(`${BASE}${url}`, {
    method,
    headers: body === undefined ? undefined : { 'content-type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const text = await res.text();
  let json;
  try { json = text ? JSON.parse(text) : null; } catch { json = null; }
  return { status: res.status, contentType: res.headers.get('content-type') || '', text, json };
}

let sessionID = '';
try {
  const created = await req('POST', '/api/session', { directory: repo, title: 't2-5 discovery smoke' });
  sessionID = created.json?.id || created.json?.sessionID || '';
  check(created.status === 200 && !!sessionID, 'session created', sessionID || `status=${created.status}`);

  const ready = await waitForRuntimeDiscovery(repo);
  check(ready, 'runtime command/skill catalog ready', repo);

  const first = await req('GET', `/api/sessions/${encodeURIComponent(sessionID)}/discovery?force=1`);
  check(first.status === 200 && first.json, 'discovery returns 200 JSON', `status=${first.status}`);
  const snap = first.json || {};
  const commandNames = (snap.commands || []).map((c) => c.name);
  const skillIds = (snap.skills || []).map((s) => s.id);
  check(commandNames.includes('goal') && commandNames.includes('init'), 'commands include goal + init', commandNames.join(','));
  check(skillIds.includes('mafw-plan') && skillIds.includes('opencode'), 'skills include mafw-plan + opencode', skillIds.slice(0, 8).join(','));
  check((snap.instructions || []).some((i) => /AGENTS\.md$/i.test(i.path)), 'AGENTS.md source discovered', String((snap.instructions || []).length));
  check(typeof snap.revision === 'string' && /^[0-9a-f]{64}$/.test(snap.revision), 'revision is sha256', snap.revision);
  check(snap.degraded === false, 'snapshot is not degraded', JSON.stringify(snap.degradedReason || null));

  const second = await req('GET', `/api/sessions/${encodeURIComponent(sessionID)}/discovery`);
  check(second.json?.revision === snap.revision, 'second read keeps revision', second.json?.revision || '');

  const skill = await req('GET', `/api/sessions/${encodeURIComponent(sessionID)}/discovery/skills/mafw-plan`);
  check(skill.status === 200 && String(skill.json?.content || '').length > 100, 'skill content loads', `status=${skill.status} len=${String(skill.json?.content || '').length}`);
  const missingSkill = await req('GET', `/api/sessions/${encodeURIComponent(sessionID)}/discovery/skills/__missing__`);
  check(missingSkill.status === 404, 'unknown skill is 404', `status=${missingSkill.status}`);

  const commands = await req('GET', `/command?directory=${encodeURIComponent(repo)}`);
  const commandList = commands.json?.commands || [];
  check(commands.status === 200 && commands.contentType.includes('application/json'), 'legacy /command is JSON', commands.contentType);
  check(commandList.length >= 1, 'legacy /command has runtime commands', String(commandList.length));
  check(!commandList.some((c) => c.name === 'goal'), 'legacy /command excludes MAFW goal', commandList.map((c) => c.name).join(','));

  const skills = await req('GET', `/skill?directory=${encodeURIComponent(repo)}`);
  check(skills.status === 200 && skills.contentType.includes('application/json'), 'legacy /skill is JSON', skills.contentType);
  check((skills.json?.skills || []).length >= 1, 'legacy /skill has skills', String((skills.json?.skills || []).length));

  const other = path.resolve(repo, '..');
  if (existsSync(other)) {
    const scoped = await req('GET', `/skill?directory=${encodeURIComponent(other)}`);
    check(
      scoped.json?.location?.directory && path.resolve(scoped.json.location.directory) === other,
      'legacy /skill respects directory',
      `${scoped.json?.location?.directory} vs ${other}`,
    );
  } else {
    check(true, 'legacy /skill directory scoping skipped (directory absent)', other);
  }

  const controller = new AbortController();
  const events = await fetch(`${BASE}/api/events`, { signal: controller.signal });
  check(events.ok, 'SSE connected', `status=${events.status}`);
  const reader = events.body.getReader();
  let buffer = '';
  let event = null;
  const readPromise = (async () => {
    const deadline = Date.now() + 8000;
    while (Date.now() < deadline) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += new TextDecoder().decode(value);
      let idx;
      while ((idx = buffer.indexOf('\n\n')) >= 0) {
        const frame = buffer.slice(0, idx);
        buffer = buffer.slice(idx + 2);
        for (const line of frame.split('\n')) {
          if (!line.startsWith('data:')) continue;
          try {
            const env = JSON.parse(line.slice(5).trim());
            const data = env?.data || env;
            if (data?.type === 'session.commands' && data.sessionID === sessionID) {
              return { ...data, __envelope: env?.type === 'mafw_event' };
            }
          } catch { /* ignore non-JSON frame */ }
        }
      }
    }
    return null;
  })();
  await req('POST', `/api/sessions/${encodeURIComponent(sessionID)}/discovery/refresh`);
  event = await readPromise;
  controller.abort();
  check(!!event, 'refresh broadcasts session.commands', event ? event.properties?.reason : 'no matching event');
  check(event?.__envelope === true, 'session.commands uses mafw_event envelope', String(event?.__envelope));
  check(!!event && Array.isArray(event.properties?.commands) && event.properties.commands.length > 0, 'broadcast has commands', event ? String(event.properties?.commands?.length ?? 0) : '');
  check(event?.properties?.reason === 'manual_refresh', 'broadcast reason is manual_refresh', event?.properties?.reason || '');
} catch (err) {
  fail++;
  console.error(`[discovery-smoke] ERROR ${err?.stack || err}`);
} finally {
  if (sessionID) {
    try { await req('DELETE', `/api/sessions/${encodeURIComponent(sessionID)}`); } catch { /* cleanup best-effort */ }
  }
}

console.log(`[discovery-smoke] ${fail === 0 ? 'PASS' : 'FAIL'} ${pass}/${pass + fail}`);
process.exit(fail === 0 ? 0 : 1);
