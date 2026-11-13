import * as fs from 'fs';
import * as path from 'path';

test('the Goal review path can apply a provider result under core validation', () => {
  const source = fs.readFileSync(
    path.join(__dirname, '../../../src/core/goal/driver.ts'),
    'utf8',
  );
  expect(source).toContain('setGoalEvalProvider');
  expect(source).toContain('provider.evaluate({');
  expect(source).toContain('applyGoalEvalResults(verdict, evalRead.goalEval, results, requiredIds)');
  expect(source).toContain('keeping reviewer rubric');

  const kernel = fs.readFileSync(path.join(__dirname, '../../../src/kernel.ts'), 'utf8');
  expect(kernel).toContain('bindGoalEvalProvider');
  expect(kernel).toContain('createLlmGoalEvalProvider');
  expect(kernel).toContain("cfg.evalProvider ?? 'off'");

  const boot = fs.readFileSync(path.join(__dirname, '../../../src/boot.ts'), 'utf8');
  expect(boot).toContain('kernel.bindGoalEvalProvider(kernel.goalDriver)');
});
