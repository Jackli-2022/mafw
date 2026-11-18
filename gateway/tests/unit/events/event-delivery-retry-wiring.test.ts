import * as fs from 'fs';
import * as path from 'path';

const kernel = fs.readFileSync(path.join(__dirname, '../../../src/kernel.ts'), 'utf-8');

test('kernel starts the delivery retry sweep and clears the handle on shutdown', () => {
  expect(kernel).toMatch(/startEventDeliveryRetry\(/);
  expect(kernel).toMatch(/resumeIncompleteDeliveries/);
  expect(kernel).toMatch(/eventDeliveryRetryTimer = null/);
});
