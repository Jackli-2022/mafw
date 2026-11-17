import { attachEventRoutes, handleDeliveryReceipt } from '../../../src/routes/events';

function deps(over: Partial<any> = {}) {
  return {
    enabled: () => true,
    markReceipt: (id: string, next: 'read' | 'answered') => ({
      id, triggerId: 't1', subscriptionId: 's1', state: next,
      attempts: 0, lastError: null, deliveredAt: null, readAt: null,
      ackAt: null, answeredAt: null, nextRetryAt: null,
    }),
    ...over,
  } as any;
}

test('read and answer return the updated delivery', () => {
  expect(handleDeliveryReceipt({ id: 'd1', next: 'read' }, deps()).status).toBe(200);
  expect(handleDeliveryReceipt({ id: 'd1', next: 'answered' }, deps()).status).toBe(200);
});

test('maps disabled / missing / not-found / invalid transitions', () => {
  expect(handleDeliveryReceipt({ id: 'd1', next: 'read' }, deps({ enabled: () => false })).status).toBe(503);
  expect(handleDeliveryReceipt({ id: '', next: 'read' }, deps()).status).toBe(400);
  expect(handleDeliveryReceipt({ id: 'd1', next: 'read' }, deps({ markReceipt: undefined })).status).toBe(503);
  expect(handleDeliveryReceipt({ id: 'd1', next: 'read' }, deps({
    markReceipt: () => { throw new Error('delivery not found: d1'); },
  })).status).toBe(404);
  expect(handleDeliveryReceipt({ id: 'd1', next: 'answered' }, deps({
    markReceipt: () => { throw new Error('invalid delivery transition: delivered -> answered'); },
  })).status).toBe(409);
});

test('read route rejects non-human principals before writing', async () => {
  const handlers = new Map<string, Function>();
  const registry = { attachHandler: (id: string, fn: Function) => handlers.set(id, fn) } as any;
  let writes = 0;
  attachEventRoutes(registry, deps({
    markReceipt: (id: string) => { writes += 1; return { id } as any; },
  }));
  const res: any = { statusCode: 0, writeHead(code: number) { this.statusCode = code; }, end() {} };
  await handlers.get('events.deliveries.read')!({ mafwPrincipal: { kind: 'service' } }, res, { id: 'd1' });
  expect(res.statusCode).toBe(403);
  expect(writes).toBe(0);
});
