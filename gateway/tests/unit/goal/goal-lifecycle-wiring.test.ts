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

test('patchState goes through the writeGoalState authority', () => {
  const start = kernel.indexOf('private async patchState(');
  const end = kernel.indexOf('private readGoalStateFile(', start);
  const block = kernel.slice(start, end > start ? end : start + 2000);
  expect(block).toMatch(/writeGoalState/);
  expect(block).not.toMatch(/fs\.writeFileSync/);
});

test('terminal domain events are also recorded for pod-less goals', () => {
  const start = kernel.indexOf('private async finishPodGoal(');
  const block = kernel.slice(start, start + 14000);
  expect(block).toMatch(/!podId/);
  expect(block).toMatch(/archiveDomainEvent/);
});
