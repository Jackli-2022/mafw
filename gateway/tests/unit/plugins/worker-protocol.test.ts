import {
  MAX_WORKER_MESSAGE_BYTES,
  decodeWorkerMessage,
  encodeWorkerMessage,
} from '../../../src/plugins/worker/worker-protocol';
import { permissionFlagFor } from '../../../src/plugins/worker/node-flags';

describe('worker protocol', () => {
  it('round-trips a worker message', () => {
    const message = { t: 'result', id: '1', ok: true, output: { value: 1 } } as const;
    expect(decodeWorkerMessage(encodeWorkerMessage(message))).toEqual(message);
  });

  it('rejects oversized and unknown messages', () => {
    const huge = { t: 'log', level: 'info', message: 'x'.repeat(MAX_WORKER_MESSAGE_BYTES + 1) } as const;
    expect(encodeWorkerMessage(huge)).toBe('');
    expect(decodeWorkerMessage('{"t":"nope"}')).toBeNull();
    expect(decodeWorkerMessage('not json')).toBeNull();
  });

  it('rejects malformed known messages', () => {
    expect(decodeWorkerMessage(JSON.stringify({ t: 'invoke', id: '1' }))).toBeNull();
    expect(decodeWorkerMessage(JSON.stringify({ t: 'ready' }))).toBeNull();
  });

  it('detects a Node permission flag', () => {
    expect(['--permission', '--experimental-permission']).toContain(permissionFlagFor(process.execPath));
  });
});
