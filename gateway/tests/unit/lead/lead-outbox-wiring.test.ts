import * as fs from 'fs';
import * as path from 'path';

const kernel = fs.readFileSync(path.join(__dirname, '../../../src/kernel.ts'), 'utf-8');
const dispatcher = fs.readFileSync(path.join(__dirname, '../../../src/core/lead/lead-outbox.ts'), 'utf-8');

test('decision context delivery enqueues into the Lead outbox', () => {
  const start = kernel.indexOf('deliverContext:');
  expect(start).toBeGreaterThanOrEqual(0);
  const block = kernel.slice(start, kernel.indexOf('log: (message) => log.warn(message)', start));
  expect(block).toMatch(/enqueueDecision/);
  expect(block).not.toMatch(/promptAsync/);
});

test('kernel constructs and starts/stops the Lead outbox', () => {
  expect(kernel).toMatch(/new LeadOutbox\(/);
  expect(kernel).toMatch(/leadOutbox\.start\(\)/);
  expect(kernel).toMatch(/leadOutbox\?\.stop\(\)/);
  expect(kernel).toMatch(/isIdle\(\)/);
});

test('the dispatcher owns the lead:outbox timer', () => {
  expect(dispatcher).toMatch(/'lead:outbox'/);
});
