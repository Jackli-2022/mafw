/**
 * E1-7 移动端双投递去重（spec §E1-7 / A10）。
 *
 * 缺陷：带 `?deviceId=` 的移动端 socket 同时登记在 `eventHub.wsClients` 与
 * `pushGateway.onlineDevices`；`broadcast()` 先写 wsClients，再调
 * `pushGateway.onBroadcast(enriched)` 把同一个事件（不同 timestamp 副本）二次
 * 投给同一设备。
 *
 * 契约（ws 为主通道，push 仅兜底）：
 *  - 在线设备（socket 在 wsClients）→ WS 恰好 1 次，push 0 次；
 *  - 离线设备（已注册、无 socket）→ WS 0 次，push 1 次。
 * 推送侧的 1 msg/s 限流保持不变。
 */
import WebSocket from 'ws';
import { EventHub } from '../../../src/server/event-hub';
import { PushGateway } from '../../../src/mobile/push-gateway';

interface FakeWs {
  deviceId?: string;
  readyState: number;
  sent: string[];
  send: (frame: string) => void;
}

function fakeWs(deviceId?: string): FakeWs {
  const ws: FakeWs = {
    deviceId,
    readyState: WebSocket.OPEN,
    sent: [],
    send: (frame: string) => { ws.sent.push(frame); },
  };
  return ws;
}

/** 记录型 pushGateway：模拟"注册设备 − 已由 WS 投递的设备"的兜底投递。 */
function recordingPush(registeredDeviceIds: string[]) {
  const deliveries: Array<{ deviceId: string; type: string }> = [];
  const calls: Array<{ event: any; exclude: ReadonlySet<string> | undefined }> = [];
  const push = {
    deliveries,
    calls,
    async onBroadcast(event: any, opts?: { excludeDeviceIds?: ReadonlySet<string> }) {
      calls.push({ event, exclude: opts?.excludeDeviceIds });
      const exclude = opts?.excludeDeviceIds ?? new Set<string>();
      for (const deviceId of registeredDeviceIds) {
        if (!exclude.has(deviceId)) deliveries.push({ deviceId, type: event.type });
      }
    },
  };
  return push;
}

function makeHub(push: { onBroadcast: (event: any, opts?: any) => Promise<void> }) {
  return new EventHub({
    getEventStore: () => null,
    config: () => ({ events: { logRetention: 1000, pruneEveryN: 100 } }) as any,
    log: { info: () => {}, warn: () => {} },
    getPushGateway: () => push as never,
    startGoal: () => {},
    getGoalDriver: () => null,
    getMilestonePush: () => undefined,
    ingestInternalEvent: () => {},
  });
}

describe('EventHub.broadcast 移动端去重（E1-7）', () => {
  it('在线设备：WS 1 次 + push 0 次', () => {
    const online = fakeWs('dev-online');
    const push = recordingPush(['dev-online']);
    const hub = makeHub(push);
    hub.wsClients.add(online as unknown as WebSocket);

    hub.broadcast({ type: 'turn.completed', sessionID: 's1' });

    expect(online.sent).toHaveLength(1);
    expect(JSON.parse(online.sent[0]).type).toBe('turn.completed');
    // 在线设备已由 WS 主通道投递 → 兜底 push 必须跳过它。
    expect(push.deliveries.filter((d) => d.deviceId === 'dev-online')).toHaveLength(0);
    expect(push.calls[0]?.exclude?.has('dev-online')).toBe(true);
  });

  it('离线设备：WS 0 次 + push 1 次', () => {
    const online = fakeWs('dev-online');
    const push = recordingPush(['dev-online', 'dev-offline']);
    const hub = makeHub(push);
    hub.wsClients.add(online as unknown as WebSocket);

    hub.broadcast({ type: 'turn.completed', sessionID: 's1' });

    expect(push.deliveries.filter((d) => d.deviceId === 'dev-offline')).toHaveLength(1);
    expect(push.deliveries.filter((d) => d.deviceId === 'dev-online')).toHaveLength(0);
  });

  it('无 deviceId 的 WS 客户端不进入排除集（不误伤离线设备）', () => {
    const desktop = fakeWs(undefined);
    const push = recordingPush(['dev-offline']);
    const hub = makeHub(push);
    hub.wsClients.add(desktop as unknown as WebSocket);

    hub.broadcast({ type: 'goal_created', goalId: 'g1' });

    expect(desktop.sent).toHaveLength(1);
    expect(push.deliveries).toEqual([{ deviceId: 'dev-offline', type: 'goal_created' }]);
    expect(push.calls[0]?.exclude?.size).toBe(0);
  });
});

describe('PushGateway.onBroadcast 排除集（E1-7）', () => {
  it('excludeDeviceIds 命中的在线设备不再二次发送；未命中的照旧', async () => {
    const store = { touch: jest.fn() } as any;
    const gateway = new PushGateway(store);
    const excluded = fakeWs();
    const kept = fakeWs();
    gateway.addOnlineWs('dev-online', excluded as unknown as WebSocket);
    gateway.addOnlineWs('dev-other', kept as unknown as WebSocket);

    await gateway.onBroadcast(
      { type: 'turn.completed' },
      { excludeDeviceIds: new Set(['dev-online']) },
    );

    expect(excluded.sent).toHaveLength(0);
    expect(kept.sent).toHaveLength(1);
  });

  it('不传排除集时保持旧行为（全部在线设备各 1 次）', async () => {
    const gateway = new PushGateway({ touch: jest.fn() } as any);
    const ws = fakeWs();
    gateway.addOnlineWs('dev-1', ws as unknown as WebSocket);

    await gateway.onBroadcast({ type: 'turn.completed' });

    expect(ws.sent).toHaveLength(1);
  });
});
