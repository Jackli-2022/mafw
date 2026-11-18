/**
 * P0 remote access: Cloudflare Quick Tunnel lifecycle.
 *
 * The service is deliberately provider-shaped: URL discovery, timeout, stop and
 * fallback are testable without spawning a real cloudflared process.
 */
import { EventEmitter } from 'events';
import { RemoteAccessService, type TunnelChild } from '../../../src/mobile/remote-access';

class FakeChild extends EventEmitter implements TunnelChild {
  pid = 4242;
  stdout = new EventEmitter() as unknown as NodeJS.ReadableStream;
  stderr = new EventEmitter() as unknown as NodeJS.ReadableStream;
  killed = false;

  kill(): boolean {
    this.killed = true;
    this.emit('exit', 0, null);
    return true;
  }
}

describe('RemoteAccessService (Cloudflare Quick Tunnel)', () => {
  it('parses the tunnel URL from cloudflared output and publishes it', async () => {
    let child: FakeChild | undefined;
    const urls: string[] = [];
    const service = new RemoteAccessService({
      port: 3000,
      onUrl: (url) => urls.push(url),
      spawnImpl: () => {
        child = new FakeChild();
        return child;
      },
    });

    const starting = service.start();
    child!.stderr.emit('data', 'INF |  https://happy-dog.trycloudflare.com  |');
    await starting;

    expect(urls).toEqual(['https://happy-dog.trycloudflare.com']);
    expect(service.status()).toMatchObject({
      enabled: true,
      provider: 'cloudflare-quick',
      url: 'https://happy-dog.trycloudflare.com',
    });

    await service.stop();
    expect(child!.killed).toBe(true);
    expect(service.status().enabled).toBe(false);
  });

  it('is idempotent while a tunnel is already up', async () => {
    let spawned = 0;
    let child: FakeChild | undefined;
    const service = new RemoteAccessService({
      port: 3000,
      onUrl: () => undefined,
      spawnImpl: () => {
        spawned++;
        child = new FakeChild();
        return child;
      },
    });

    const first = service.start();
    child!.stdout.emit('data', 'https://one.trycloudflare.com');
    await first;
    await service.start();

    expect(spawned).toBe(1);
    await service.stop();
  });

  it('calls onStop when stopped so pairing links can fall back', async () => {
    let child: FakeChild | undefined;
    const stops: number[] = [];
    const service = new RemoteAccessService({
      port: 3000,
      onUrl: () => undefined,
      onStop: () => stops.push(1),
      spawnImpl: () => {
        child = new FakeChild();
        return child;
      },
    });

    const starting = service.start();
    child!.stderr.emit('data', 'https://fallback.trycloudflare.com');
    await starting;
    await service.stop();

    expect(stops).toHaveLength(1);
  });

  it('times out when cloudflared never prints a URL', async () => {
    let child: FakeChild | undefined;
    const service = new RemoteAccessService({
      port: 3000,
      onUrl: () => undefined,
      timeoutMs: 10,
      spawnImpl: () => {
        child = new FakeChild();
        return child;
      },
    });

    await expect(service.start()).rejects.toThrow(/did not print a tunnel URL/);
    expect(child!.killed).toBe(true);
    expect(service.status().enabled).toBe(false);
  });

  it('turns a missing binary into an actionable message', async () => {
    const service = new RemoteAccessService({
      port: 3000,
      onUrl: () => undefined,
      spawnImpl: () => {
        const err: any = new Error('spawn cloudflared ENOENT');
        err.code = 'ENOENT';
        throw err;
      },
    });

    await expect(service.start()).rejects.toThrow(/Install cloudflared|MAFW_CLOUDFLARED_PATH/);
  });

  it('falls back when the tunnel dies unexpectedly', async () => {
    let child: FakeChild | undefined;
    const stops: number[] = [];
    const service = new RemoteAccessService({
      port: 3000,
      onUrl: () => undefined,
      onStop: () => stops.push(1),
      spawnImpl: () => {
        child = new FakeChild();
        return child;
      },
    });

    const starting = service.start();
    child!.stderr.emit('data', 'https://dies.trycloudflare.com');
    await starting;
    child!.emit('exit', 1, null);

    expect(stops).toHaveLength(1);
    expect(service.status().enabled).toBe(false);
  });
});
