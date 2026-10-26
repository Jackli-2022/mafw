import { readFileSync } from 'fs';
import { join } from 'path';

const index = readFileSync(join(__dirname, '../../../src/index.ts'), 'utf8');
const queue = readFileSync(join(__dirname, '../../../src/core/session-queue.ts'), 'utf8');

describe('thinking controls wiring', () => {
  it('promptAsync validates thinkingLevel and forwards it', () => {
    expect(index).toContain('invalid thinkingLevel');
    expect(index).toContain('thinkingLevel: opts.thinkingLevel');
    expect(index).toContain('thinkingLevel: item.thinkingLevel');
    expect(index).toContain('variant: item.variant');
  });

  it('QueuedItem carries thinkingLevel/variant', () => {
    expect(queue).toContain('thinkingLevel?: string');
    expect(queue).toContain('variant?: string');
  });
});
