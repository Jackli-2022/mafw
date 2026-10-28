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
    fetchImpl: (async () => ({ ok: true })) as any,
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
    fetchImpl: (async () => ({ ok: true })) as any,
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
    fetchImpl: (async () => ({ ok: true })) as any,
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
    fetchImpl: (async () => ({ ok: true })) as any,
    sleepImpl: async () => {},
  });
  await sidecar.start();
  sidecar.stopSync();
  expect(child.killed).toBe(true);
  expect(sidecar.pid).toBeUndefined();
});
