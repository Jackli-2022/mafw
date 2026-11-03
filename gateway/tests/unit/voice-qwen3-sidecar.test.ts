import { EventEmitter } from 'events';
import { Qwen3AsrSidecar } from '../../src/voice/sidecar/qwen3-asr-sidecar';

class FakeChild extends EventEmitter {
  pid = 1234; stdout = new EventEmitter(); stderr = new EventEmitter();
  killed = false;
  kill = () => { this.killed = true; return true; };
}

test('start spawns the sidecar and waits for health', async () => {
  const child = new FakeChild();
  const sidecar = new Qwen3AsrSidecar({
    port: 3911,
    spawnImpl: (() => child) as any,
    fetchImpl: (async () => ({
      ok: true,
      json: async () => ({ ok: true, model: 'Qwen/Qwen3-ASR-1.7B', chunkSizeSec: 0.16 }),
    })) as any,
    sleepImpl: async () => {},
  });
  await sidecar.start();
  expect(sidecar.pid).toBe(1234);
  expect(sidecar.baseUrl).toBe('http://127.0.0.1:3911');
});

test('start rejects with stderr when the child exits before health', async () => {
  const child = new FakeChild();
  const sidecar = new Qwen3AsrSidecar({
    port: 3912,
    spawnImpl: (() => child) as any,
    fetchImpl: (async () => ({ ok: false })) as any,
    sleepImpl: async () => { child.emit('exit', 2); },
    startupTimeoutMs: 50,
  });
  await expect(sidecar.start()).rejects.toThrow(/exited|stderr|sidecar/i);
});

test('stop kills the child and is idempotent', async () => {
  const child = new FakeChild();
  const sidecar = new Qwen3AsrSidecar({
    port: 3913,
    spawnImpl: (() => child) as any,
    fetchImpl: (async () => ({
      ok: true,
      json: async () => ({ ok: true, model: 'Qwen/Qwen3-ASR-1.7B', chunkSizeSec: 0.16 }),
    })) as any,
    sleepImpl: async () => {},
  });
  await sidecar.start();
  await sidecar.stop();
  await sidecar.stop();
  expect(child.killed).toBe(true);
  expect(sidecar.pid).toBeUndefined();
});

test('start rejects when health never becomes ready', async () => {
  const child = new FakeChild();
  const sidecar = new Qwen3AsrSidecar({
    port: 3914,
    spawnImpl: (() => child) as any,
    fetchImpl: (async () => ({ ok: false })) as any,
    sleepImpl: async () => { await new Promise(r => setTimeout(r, 1)); },
    startupTimeoutMs: 20,
  });
  await expect(sidecar.start()).rejects.toThrow(/health|timeout|sidecar/i);
});

test('start reports port conflict from stderr', async () => {
  const child = new FakeChild();
  const sidecar = new Qwen3AsrSidecar({
    port: 3915,
    spawnImpl: (() => child) as any,
    fetchImpl: (async () => ({ ok: false })) as any,
    sleepImpl: async () => { await new Promise(r => setTimeout(r, 1)); },
    startupTimeoutMs: 1000,
  });
  const pending = sidecar.start();
  await new Promise(r => setTimeout(r, 0));
  child.stderr.emit('data', Buffer.from('OSError: [Errno 98] Address already in use'));
  child.emit('exit', 1);
  await expect(pending).rejects.toThrow(/sidecar_port_in_use/);
});

test('start rejects when spawn emits error', async () => {
  const child = new FakeChild();
  const sidecar = new Qwen3AsrSidecar({
    port: 3916,
    spawnImpl: (() => {
      queueMicrotask(() => child.emit('error', new Error('spawn python ENOENT')));
      return child;
    }) as any,
    fetchImpl: (async () => ({ ok: false })) as any,
    sleepImpl: async () => { await new Promise(r => setTimeout(r, 1)); },
    startupTimeoutMs: 100,
  });
  await expect(sidecar.start()).rejects.toThrow(/sidecar_unavailable|ENOENT|spawn/i);
});

test('start rejects before spawning when the port is already in use', async () => {
  let spawned = false;
  const sidecar = new Qwen3AsrSidecar({
    port: 3917,
    spawnImpl: (() => { spawned = true; return new FakeChild(); }) as any,
    probePortImpl: async () => true,
    fetchImpl: (async () => ({ ok: false })) as any,
    sleepImpl: async () => { await new Promise(r => setTimeout(r, 1)); },
    startupTimeoutMs: 30,
  });
  await expect(sidecar.start()).rejects.toThrow(/sidecar_port_in_use/);
  expect(spawned).toBe(false);
});

test('stop taskkills the tree before killing the parent', async () => {
  const child = new FakeChild();
  const order: string[] = [];
  child.kill = () => { order.push('kill'); child.killed = true; return true; };
  const sidecar = new Qwen3AsrSidecar({
    port: 3918,
    spawnImpl: (() => child) as any,
    killTreeImpl: async () => { order.push('tree'); },
    fetchImpl: (async () => ({
      ok: true,
      json: async () => ({ ok: true, model: 'Qwen/Qwen3-ASR-1.7B', chunkSizeSec: 0.16 }),
    })) as any,
    sleepImpl: async () => {},
  });
  await sidecar.start();
  await sidecar.stop();
  expect(order).toEqual(['tree', 'kill']);
});

test('stopSync kills the child without waiting', async () => {
  const child = new FakeChild();
  const sidecar = new Qwen3AsrSidecar({
    port: 3919,
    spawnImpl: (() => child) as any,
    fetchImpl: (async () => ({
      ok: true,
      json: async () => ({ ok: true, model: 'Qwen/Qwen3-ASR-1.7B', chunkSizeSec: 0.16 }),
    })) as any,
    sleepImpl: async () => {},
  });
  await sidecar.start();
  sidecar.stopSync();
  expect(child.killed).toBe(true);
  expect(sidecar.pid).toBeUndefined();
});

test('adopts a compatible external sidecar without spawning or killing it', async () => {
  let spawned = false;
  const sidecar = new Qwen3AsrSidecar({
    port: 3920,
    probePortImpl: async () => true,
    spawnImpl: (() => { spawned = true; return new FakeChild(); }) as any,
    fetchImpl: (async () => ({
      ok: true,
      json: async () => ({ ok: true, model: 'Qwen/Qwen3-ASR-1.7B', chunkSizeSec: 0.16 }),
    })) as any,
  });
  await sidecar.start();
  expect(spawned).toBe(false);
  expect(sidecar.isExternal()).toBe(true);
  expect(sidecar.pid).toBeUndefined();
  await sidecar.stop();
  expect(sidecar.isExternal()).toBe(true);
});

test('rejects an unrelated service occupying the sidecar port', async () => {
  let spawned = false;
  const sidecar = new Qwen3AsrSidecar({
    port: 3921,
    probePortImpl: async () => true,
    spawnImpl: (() => { spawned = true; return new FakeChild(); }) as any,
    fetchImpl: (async () => ({ ok: true, json: async () => ({ ok: true }) })) as any,
  });
  await expect(sidecar.start()).rejects.toThrow(/sidecar_port_in_use|not a compatible/i);
  expect(spawned).toBe(false);
  expect(sidecar.isExternal()).toBe(false);
});

test('adopted sidecar survives stopSync and repeated stop calls', async () => {
  const sidecar = new Qwen3AsrSidecar({
    port: 3922,
    probePortImpl: async () => true,
    spawnImpl: (() => new FakeChild()) as any,
    fetchImpl: (async () => ({
      ok: true,
      json: async () => ({ ok: true, model: 'Qwen/Qwen3-ASR-0.6B', chunkSizeSec: 0.08 }),
    })) as any,
  });
  await sidecar.start();
  sidecar.stopSync();
  await sidecar.stop();
  await sidecar.stop();
  expect(sidecar.isExternal()).toBe(true);
  expect(sidecar.pid).toBeUndefined();
});

test('rejects a listener whose health payload is not JSON', async () => {
  let spawned = false;
  const sidecar = new Qwen3AsrSidecar({
    port: 3923,
    probePortImpl: async () => true,
    spawnImpl: (() => { spawned = true; return new FakeChild(); }) as any,
    fetchImpl: (async () => ({
      ok: true,
      json: async () => { throw new SyntaxError('Unexpected token <'); },
    })) as any,
  });
  await expect(sidecar.start()).rejects.toThrow(/sidecar_port_in_use|not a compatible/i);
  expect(spawned).toBe(false);
});

// Regression guard for the compatibility predicate. Every body below has a
// valid `model`, so it gets past the model check and can only be rejected by
// the `ok === true` or `chunkSizeSec` branches.
const incompatibleHealthBodies: Array<{ port: number; label: string; body: Record<string, unknown> }> = [
  {
    port: 3930,
    label: 'missing chunkSizeSec',
    body: { ok: true, model: 'Qwen/Qwen3-ASR-1.7B' },
  },
  {
    port: 3931,
    label: 'string chunkSizeSec',
    body: { ok: true, model: 'Qwen/Qwen3-ASR-1.7B', chunkSizeSec: '0.16' },
  },
  {
    port: 3932,
    label: 'zero chunkSizeSec',
    body: { ok: true, model: 'Qwen/Qwen3-ASR-1.7B', chunkSizeSec: 0 },
  },
  {
    port: 3933,
    label: 'negative chunkSizeSec',
    body: { ok: true, model: 'Qwen/Qwen3-ASR-1.7B', chunkSizeSec: -1 },
  },
  {
    port: 3934,
    label: 'ok:false with an otherwise full shape',
    body: { ok: false, model: 'Qwen/Qwen3-ASR-1.7B', chunkSizeSec: 0.16 },
  },
];

test.each(incompatibleHealthBodies)(
  'rejects and never spawns when health is incompatible: $label',
  async ({ port, body }) => {
    let spawned = false;
    const sidecar = new Qwen3AsrSidecar({
      port,
      probePortImpl: async () => true,
      spawnImpl: (() => { spawned = true; return new FakeChild(); }) as any,
      fetchImpl: (async () => ({ ok: true, json: async () => body })) as any,
    });
    await expect(sidecar.start()).rejects.toThrow(/sidecar_port_in_use|not a compatible/i);
    expect(spawned).toBe(false);
    expect(sidecar.isExternal()).toBe(false);
    expect(sidecar.pid).toBeUndefined();
  },
);

test('isReady only accepts the compatible health contract', async () => {
  const compatible = new Qwen3AsrSidecar({
    port: 3924,
    fetchImpl: (async () => ({
      ok: true,
      json: async () => ({ ok: true, model: 'Qwen/Qwen3-ASR-1.7B', chunkSizeSec: 0.16 }),
    })) as any,
  });
  expect(await compatible.isReady()).toBe(true);

  const foreign = new Qwen3AsrSidecar({
    port: 3925,
    fetchImpl: (async () => ({ ok: true, json: async () => ({ ok: true }) })) as any,
  });
  expect(await foreign.isReady()).toBe(false);

  const unreachable = new Qwen3AsrSidecar({
    port: 3926,
    fetchImpl: (async () => { throw new Error('ECONNREFUSED'); }) as any,
  });
  expect(await unreachable.isReady()).toBe(false);
});

test('adopting after the owned child died never kills the old child', async () => {
  let portOpen = false;
  let treeKills = 0;
  const child = new FakeChild();
  const sidecar = new Qwen3AsrSidecar({
    port: 3927,
    probePortImpl: async () => portOpen,
    spawnImpl: (() => child) as any,
    killTreeImpl: async () => { treeKills += 1; },
    fetchImpl: (async () => ({
      ok: true,
      json: async () => ({ ok: true, model: 'Qwen/Qwen3-ASR-1.7B', chunkSizeSec: 0.16 }),
    })) as any,
    sleepImpl: async () => {},
  });
  await sidecar.start();
  expect(sidecar.isExternal()).toBe(false);
  child.emit('exit', 0);
  portOpen = true;
  await sidecar.start();
  expect(sidecar.isExternal()).toBe(true);
  expect(sidecar.pid).toBeUndefined();
  await sidecar.stop();
  sidecar.stopSync();
  expect(treeKills).toBe(0);
  expect(child.killed).toBe(false);
});
