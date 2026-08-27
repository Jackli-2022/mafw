import { ORCHESTRATION_REGISTRY } from '../../src/orchestration/registry';
import * as fs from 'fs';
import * as path from 'path';

describe('ORCHESTRATION_REGISTRY', () => {
  test('all ids are unique', () => {
    const ids = ORCHESTRATION_REGISTRY.map(c => c.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  test('each currentValueSource file exists', () => {
    const repoRoot = path.resolve(__dirname, '../../..');
    for (const comp of ORCHESTRATION_REGISTRY) {
      const filePart = comp.currentValueSource.split(':')[0];
      const fullPath = path.join(repoRoot, filePart);
      expect(fs.existsSync(fullPath)).toBe(true);
    }
  });
});
