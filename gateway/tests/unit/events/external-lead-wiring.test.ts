import * as fs from 'fs';
import * as path from 'path';

const kernel = fs.readFileSync(path.join(__dirname, '../../../src/kernel.ts'), 'utf-8');

test('lead context subscriptions accept external threads', () => {
  const start = kernel.indexOf('evaluate: async ({ thread, triggers, subscriptions })');
  expect(start).toBeGreaterThanOrEqual(0);
  const block = kernel.slice(start, start + 1800);
  expect(block).toMatch(/subscriberType === 'lead' && subscription\.mode === 'context'/);
  expect(block).toMatch(/rationale: 'lead context'/);
});

test('external delivery context goes through the lead outbox', () => {
  const start = kernel.indexOf('deliverContext: async');
  const block = kernel.slice(start, start + 1800);
  expect(block).toMatch(/enqueueExternal/);
  expect(block).toMatch(/renderExternalEvent/);
});

test('lead ack and boot sweep are wired', () => {
  const ack = kernel.slice(kernel.indexOf('ackLeadOutboxForSession('), kernel.indexOf('ackLeadOutboxForSession(') + 800);
  expect(ack).toMatch(/ackDeliveriesForSession/);
  const boot = kernel.slice(kernel.indexOf("ensureSystemSource('cron')"), kernel.indexOf("ensureSystemSource('cron')") + 500);
  expect(boot).toMatch(/resumeIncompleteDeliveries/);
});
