/**
 * M0: cloudflared must talk to the loopback terminator, never directly to the
 * gateway's trusted local port.
 */
import { EventEmitter } from 'events';
import { RemoteAccessService, type TunnelChild } from '../../../src/mobile/remote-access';

class FakeChild extends EventEmitter implements TunnelChild {
  pid = 4242;
  stdout = new EventEmitter() as unknown as NodeJS.ReadableStream;
  stderr = new EventEmitter() as unknown as NodeJS.ReadableStream;
  kill(): boolean {
    this.emit('exit', 0, null);
    return true;
  }
}

describe('RemoteAccessService terminator target (M0)', () => {
  it('passes the terminator port to cloudflared', async () => {
    let child: FakeChild | undefined;
    const args: string[] = [];
    const service = new RemoteAccessService({
      port: 3000,
      tunnelPort: 3101,
      onUrl: () => undefined,
      spawnImpl: (_cmd, spawnArgs) => {
        args.push(...spawnArgs);
        child = new FakeChild();
        return child;
      },
    });

    const starting = service.start();
    child!.stderr.emit('data', 'https://x.trycloudflare.com');
    await starting;

    expect(args).toContain('http://127.0.0.1:3101');
    expect(args).not.toContain('http://127.0.0.1:3000');
    await service.stop();
  });
});
