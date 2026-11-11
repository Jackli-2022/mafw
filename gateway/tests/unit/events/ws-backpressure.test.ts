/**
 * E4-5 WS 广播背压（spec §4.5）。
 *
 * `ws.send` 从不失败，它只是把帧堆进 `bufferedAmount`；慢设备可以让内存无限
 * 涨。广播前检查上限 → terminate + 移出 `wsClients` + 计数；该设备不再算作
 * "已被 WS 服务"，push 兜底仍然投递。WS 是 live-only，重连走 REST 快照。
 */
import WebSocket from 'ws';
import { EventHub } from '../../../src/server/event-hub';
import { BufferCounters } from '../../../src/resources/outbound-buffer';

interface FakeWs {
  deviceId?: string;
  readyState: number;
  bufferedAmount: number;
  sent: string[];
  terminated: boolean;
  send(frame: string): void;
  terminate(): void;
}

function fakeWs(deviceId: string | undefined, bufferedAmount: number): FakeWs {
  const ws: FakeWs = {
    deviceId,
    readyState: WebSocket.OPEN,
    bufferedAmount,
    sent: [],
    terminated: false,
    send(frame: string) { ws.sent.push(frame); },
    terminate() { ws.terminated = true; },
  };
  return ws;
}

function makeHub(counters: BufferCounters, cap: number) {
  const deliveries: Array<{ deviceId: string; type: string }> = [];
  const devices = ['dev-ok', 'dev-slow', 'dev-offline'];
  const hub = new EventHub({
    getEventStore: () => null,
    config: () => ({ events: { logRetention: 1000, pruneEveryN: 100 } }) as any,
    log: { info: () => {}, warn: () => {} },
    getPushGateway: () => ({
      onBroadcast: async (event: any, opts?: any) => {
        const excluded = new Set(opts?.excludeDeviceIds ?? []);
        for (const deviceId of devices) {
          if (!excluded.has(deviceId)) deliveries.push({ deviceId, type: event.type });
        }
      },
    }) as never,
    startGoal: () => {},
    getGoalDriver: () => null,
    getMilestonePush: () => undefined,
    ingestInternalEvent: () => {},
    wsMaxBufferedBytes: () => cap,
    buffers: counters,
  });
  return { hub, deliveries };
}

describe('EventHub: WS broadcast backpressure (E4-5)', () => {
  it('drops a slow socket: terminate + remove + count, push still delivers', () => {
    const counters = new BufferCounters();
    const { hub, deliveries } = makeHub(counters, 100);
    const slow = fakeWs('dev-slow', 101);
    hub.wsClients.add(slow as unknown as WebSocket);

    hub.broadcast({ type: 'turn.completed', sessionID: 's1' });

    expect(slow.sent).toEqual([]);
    expect(slow.terminated).toBe(true);
    expect(hub.wsClients.has(slow as unknown as WebSocket)).toBe(false);
    expect(counters.snapshot()).toEqual({
      sseOverflows: 0,
      sseDropped: 0,
      sseWriteErrors: 0,
      sseQueuedFrames: 0,
      sseQueuedBytes: 0,
      wsDropped: 1,
    });
    // Slow device was not served → it must not be excluded from push fallback.
    expect(deliveries.map((d) => d.deviceId)).toEqual(['dev-ok', 'dev-slow', 'dev-offline']);
    expect(deliveries.some((d) => d.deviceId === 'dev-slow')).toBe(true);
  });

  it('still delivers to healthy sockets in the same broadcast', () => {
    const counters = new BufferCounters();
    const { hub, deliveries } = makeHub(counters, 100);
    const healthy = fakeWs('dev-ok', 0);
    const slow = fakeWs('dev-slow', 500);
    hub.wsClients.add(healthy as unknown as WebSocket);
    hub.wsClients.add(slow as unknown as WebSocket);

    hub.broadcast({ type: 'goal_created', goalId: 'g1' });

    expect(healthy.sent).toHaveLength(1);
    expect(JSON.parse(healthy.sent[0])).toMatchObject({ type: 'goal_created', goalId: 'g1' });
    expect(slow.sent).toEqual([]);
    expect(counters.wsDropped).toBe(1);
    expect(hub.wsClients.has(healthy as unknown as WebSocket)).toBe(true);
    expect(hub.wsClients.has(slow as unknown as WebSocket)).toBe(false);
    // Only the healthy socket counts as served; push still reaches the slow one.
    expect(deliveries.map((d) => d.deviceId)).toEqual(['dev-slow', 'dev-offline']);
  });

  it('treats a 0 cap as the 1 MiB fallback (not unlimited)', () => {
    const counters = new BufferCounters();
    const { hub } = makeHub(counters, 0);
    const small = fakeWs(undefined, 5000);
    const huge = fakeWs(undefined, 50 * 1024 * 1024);
    hub.wsClients.add(small as unknown as WebSocket);
    hub.wsClients.add(huge as unknown as WebSocket);

    hub.broadcast({ type: 'turn.completed' });

    expect(small.sent).toHaveLength(1);
    expect(small.terminated).toBe(false);
    expect(huge.sent).toEqual([]);
    expect(huge.terminated).toBe(true);
    expect(counters.wsDropped).toBe(1);
  });

  it('keeps the SSE loop unchanged (writer owns SSE backpressure)', () => {
    const counters = new BufferCounters();
    const { hub } = makeHub(counters, 100);
    const written: string[] = [];
    hub.sseClients.set({} as never, (frame) => written.push(frame));

    hub.broadcast({ type: 'turn.completed' });

    expect(written).toHaveLength(1);
    expect(written[0]).toContain('"type":"turn.completed"');
    expect(counters.sseDropped).toBe(0);
  });
});
