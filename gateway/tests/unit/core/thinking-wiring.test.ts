import { readFileSync } from 'fs';
import { join } from 'path';

// D3 Task 8: 组合根（class MafwScheduler）搬到 kernel.ts。
const index = readFileSync(join(__dirname, '../../../src/kernel.ts'), 'utf8');
// Phase D1 Task D1: prompt/promptAsync 面迁入 registry route 模块。
const sessionsCore = readFileSync(join(__dirname, '../../../src/routes/sessions-core.ts'), 'utf8');
const queue = readFileSync(join(__dirname, '../../../src/core/session-queue.ts'), 'utf8');

describe('thinking controls wiring', () => {
  it('promptAsync validates thinkingLevel and forwards it', () => {
    expect(sessionsCore).toContain('invalid thinkingLevel');
    expect(sessionsCore).toContain('thinkingLevel: opts.thinkingLevel');
    expect(index).toContain('thinkingLevel: item.thinkingLevel');
    expect(index).toContain('variant: item.variant');
  });

  it('QueuedItem carries thinkingLevel/variant', () => {
    expect(queue).toContain('thinkingLevel?: string');
    expect(queue).toContain('variant?: string');
  });
});
