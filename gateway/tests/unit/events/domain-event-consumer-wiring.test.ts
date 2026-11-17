import * as fs from 'fs';
import * as path from 'path';

const kernel = fs.readFileSync(path.join(__dirname, '../../../src/kernel.ts'), 'utf-8');

test('lead external context prefers the domain event renderer', () => {
  const start = kernel.indexOf('deliverContext: async');
  const block = kernel.slice(start, start + 2200);
  expect(block).toMatch(/externalDomainEventForTrigger/);
  expect(block).toMatch(/renderDomainEvent/);
});

test('standing goal consumes the domain-event envelope with a stable event id', () => {
  const start = kernel.indexOf('deliverWork: async');
  const block = kernel.slice(start, start + 2200);
  expect(block).toMatch(/consumerEnvelope/);
  expect(block).toMatch(/eventId: trigger\.id/);
});
