// gateway/tests/unit/pod/pod-events-route.test.ts
import { handlePodEvents } from '../../../src/routes/pod-events';

it('lists unread events', async () => {
  const h = handlePodEvents({
    service: { list: () => ({ items: [{ id: 'e1' }], unread: 1 }) } as any,
  });
  const res = await h({ method: 'GET', podId: 'p1', query: { state: 'unread' } });
  expect(res.status).toBe(200);
  expect((res.body as any).items).toHaveLength(1);
});

it('marks one event seen', async () => {
  const seen: string[] = [];
  const h = handlePodEvents({
    service: { markSeen: (_p: string, id: string) => { seen.push(id); return true; } } as any,
  });
  const res = await h({ method: 'POST', podId: 'p1', id: 'e1' });
  expect(res.status).toBe(200);
  expect(seen).toEqual(['e1']);
});

it('seenAll requires goalId and revision', async () => {
  const h = handlePodEvents({ service: { markSeenAll: () => 0 } as any });
  expect((await h({ method: 'POST', podId: 'p1', action: 'seenAll', body: { goalId: 'g1' } })).status).toBe(400);
  expect((await h({ method: 'POST', podId: 'p1', action: 'seenAll', body: { revision: 1 } })).status).toBe(400);
  expect((await h({ method: 'POST', podId: 'p1', action: 'seenAll', body: { goalId: 'g1', revision: 2 } })).status).toBe(200);
});

it('unknown method is 404', async () => {
  const h = handlePodEvents({ service: {} as any });
  expect((await h({ method: 'DELETE', podId: 'p1' })).status).toBe(404);
});
