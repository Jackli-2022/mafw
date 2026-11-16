import * as fs from 'fs';
import * as path from 'path';

const kernel = fs.readFileSync(
  path.join(__dirname, '../../../src/kernel.ts'),
  'utf-8',
);

describe('decision -> Lead event wiring', () => {
  test('drafted decisions are ingested into the event layer', () => {
    expect(kernel).toMatch(/ingestDecisionEvent/);
    expect(kernel).toMatch(/normalizeInternalEvent/);
    expect(kernel).toMatch(/kind: 'decision\.drafted'/);
    expect(kernel).toMatch(/sourceId: 'internal'/);
    expect(kernel).toMatch(/history\.at\(-1\)\?\.by === 'agent'/);
  });

  test('decision events create a Lead context subscription and prompt', () => {
    expect(kernel).toMatch(/subscriberType: 'lead'/);
    expect(kernel).toMatch(/mode: 'context'/);
    expect(kernel).toMatch(/deliverContext:/);
    expect(kernel).toMatch(/renderLeadDecisionEvent/);
  });

  test('event layer is on by default unless explicitly disabled', () => {
    expect(kernel).toMatch(/eventLayerEnabled\(\)/);
    expect(kernel).not.toMatch(/MAFW_EVENT_LAYER === '1'/);
  });
});
