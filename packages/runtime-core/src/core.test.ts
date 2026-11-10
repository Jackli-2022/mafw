import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  isMafwMessage,
  isMafwPart,
  coerceOutput,
  requireSessionDir,
  fixMediaPayload,
  RUNTIME_ROOT_DIRNAME,
  resolveRuntimeRoot,
  ensureRuntimeRoot,
  httpComplete,
  resolveCompletionBaseUrl,
} from './index.ts';

test('isMafwMessage accepts a flat message and rejects an envelope', () => {
  assert.equal(isMafwMessage({ id: 'm1', sessionID: 's1', role: 'user' }), true);
  assert.equal(isMafwMessage({ info: { id: 'm1' }, parts: [] }), false);
  assert.equal(isMafwMessage(null), false);
});

test('isMafwPart accepts a flat part and rejects a bare object', () => {
  assert.equal(isMafwPart({ id: 'p1', sessionID: 's1', messageID: 'm1', type: 'text', text: 'hi' }), true);
  assert.equal(isMafwPart({ type: 'text' }), false);
});

test('coerceOutput normalises tool output', () => {
  assert.equal(coerceOutput('x'), 'x');
  assert.equal(coerceOutput({ a: 1 }), JSON.stringify({ a: 1 }));
  assert.equal(coerceOutput(undefined), '');
});

test('requireSessionDir prefers opts.directory and fails closed', () => {
  assert.equal(requireSessionDir('/a', '/b'), '/a');
  assert.equal(requireSessionDir(undefined, '/b'), '/b');
  assert.throws(() => requireSessionDir(undefined, undefined), /directory is required/);
});

test('fixMediaPayload rewrites video/audio data URLs only', () => {
  const video = { messages: [{ content: [{ type: 'image_url', image_url: { url: 'data:video/mp4;base64,AAA' } }] }] };
  const audio = { messages: [{ content: [{ type: 'image_url', image_url: { url: 'data:audio/wav;base64,BBB' } }] }] };
  const text = { messages: [{ content: [{ type: 'text', text: 'hi' }] }] };
  assert.deepEqual(fixMediaPayload(video), { messages: [{ content: [{ type: 'video_url', video_url: { url: 'data:video/mp4;base64,AAA' } }] }] });
  assert.deepEqual(fixMediaPayload(audio), { messages: [{ content: [{ type: 'input_audio', input_audio: { data: 'data:audio/wav;base64,BBB' } }] }] });
  assert.equal(fixMediaPayload(text), undefined);
});

// ─── runtime-root (Plan 6 Task 3: moved out of the gateway) ─────────────────

test('resolveRuntimeRoot appends the fixed runtime-root dirname to the data root', () => {
  assert.equal(RUNTIME_ROOT_DIRNAME, 'runtime-root');
  assert.equal(resolveRuntimeRoot('/data/mafw'), join('/data/mafw', 'runtime-root'));
});

test('ensureRuntimeRoot creates the directory and fails closed', () => {
  const root = resolveRuntimeRoot(mkdtempSync(join(tmpdir(), 'mafw-core-')));
  assert.equal(ensureRuntimeRoot(root), root);
  assert.equal(statSync(root).isDirectory(), true);

  writeFileSync(join(root, 'not-a-dir'), 'x');
  assert.throws(() => ensureRuntimeRoot(join(root, 'not-a-dir')), /not a directory/);
  assert.throws(() => ensureRuntimeRoot('relative/root'), /absolute path/);
});

// ─── completion-http (Plan 6 Task 3: explicit credentials resolver) ─────────

function okBody(overrides: Record<string, unknown> = {}) {
  return {
    ok: true,
    status: 200,
    json: async () => ({
      choices: [{ message: { content: 'hello world' }, finish_reason: 'stop' }],
      usage: { prompt_tokens: 100, completion_tokens: 5, prompt_tokens_details: { cached_tokens: 80 } },
      ...overrides,
    }),
  };
}

test('resolveCompletionBaseUrl maps qwen-family providers and prefers config endpoints', () => {
  assert.equal(
    resolveCompletionBaseUrl('alibaba-cn'),
    'https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions',
  );
  assert.equal(resolveCompletionBaseUrl('openai'), undefined);
  assert.equal(
    resolveCompletionBaseUrl('alibaba-cn', { 'alibaba-cn': 'https://x.example/v1/chat/completions' }),
    'https://x.example/v1/chat/completions',
  );
});

test('httpComplete resolves the API key through the injected credentials resolver', async () => {
  const seen: string[] = [];
  const calls: Array<{ url: string; init: any }> = [];
  const fetchFn = (async (url: string, init?: any) => {
    calls.push({ url, init });
    return okBody();
  }) as any;

  const res = await httpComplete(
    {
      model: { providerID: 'alibaba-cn', modelID: 'qwen3.7-max' },
      system: [{ text: 'sys' }, { text: '# Memory Index', cacheable: true }],
      user: [{ type: 'text', text: 'my query' }],
    },
    {
      fetchFn,
      credentials: (providerID) => {
        seen.push(providerID);
        return 'sk-injected';
      },
    },
  );

  assert.deepEqual(seen, ['alibaba-cn']);
  assert.equal(calls[0].url, 'https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions');
  assert.equal(calls[0].init.headers.Authorization, 'Bearer sk-injected');
  assert.equal(res.text, 'hello world');
  assert.deepEqual(res.usage, { input: 20, cached: 80, output: 5 });
});

test('httpComplete keeps the explicit apiKey / async resolver precedence over credentials', async () => {
  const calls: Array<{ init: any }> = [];
  const fetchFn = (async (_url: string, init?: any) => {
    calls.push({ init });
    return okBody();
  }) as any;
  const req = {
    model: { providerID: 'alibaba-cn', modelID: 'm' },
    user: [{ type: 'text' as const, text: 'q' }],
  };

  await httpComplete(req, { fetchFn, apiKey: 'sk-explicit', credentials: () => 'sk-injected' });
  assert.equal(calls[0].init.headers.Authorization, 'Bearer sk-explicit');

  let asyncCalls = 0;
  await httpComplete(req, {
    fetchFn,
    resolveApiKey: async () => { asyncCalls += 1; return 'sk-async'; },
    credentials: () => 'sk-injected',
  });
  assert.equal(asyncCalls, 1);
  assert.equal(calls[1].init.headers.Authorization, 'Bearer sk-async');
});

test('httpComplete fails closed when no endpoint or credential resolves', async () => {
  await assert.rejects(
    httpComplete(
      { model: { providerID: 'unknown-prov', modelID: 'm' }, user: [{ type: 'text', text: 'q' }] },
      { credentials: () => null },
    ),
    /no endpoint or API key/,
  );
});
