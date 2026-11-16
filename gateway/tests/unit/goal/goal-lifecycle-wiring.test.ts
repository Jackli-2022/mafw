import * as fs from 'fs';
import * as path from 'path';

const kernel = fs.readFileSync(path.join(__dirname, '../../../src/kernel.ts'), 'utf-8');
const boot = fs.readFileSync(path.join(__dirname, '../../../src/boot.ts'), 'utf-8');

test('node lifecycle appends domain events', () => {
  const start = kernel.indexOf('private onPodGoalNode(');
  const end = kernel.indexOf('onGoalPhaseTransition(', start);
  const block = kernel.slice(start, end > start ? end : kernel.length);
  expect(block).toMatch(/goalNodeStartedEvent/);
  expect(block).toMatch(/goalNodeFinishedEvent|goalNodeFailedEvent/);

  // Appends go through the fail-open helper, not inline.
  const helperStart = kernel.indexOf('private recordDomainEvent(');
  expect(helperStart).toBeGreaterThanOrEqual(0);
  const helper = kernel.slice(helperStart, helperStart + 600);
  expect(helper).toMatch(/domainEvents\?\.append/);
  expect(helper).toMatch(/log\.warn/);
});

test('phase transitions are wired to the kernel', () => {
  expect(boot).toMatch(/onGoalPhaseTransition/);
});
