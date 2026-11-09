import * as fs from 'node:fs';
import * as path from 'node:path';

const NEUTRAL_FILES = [
  'adapter-event.ts',
  'adapter-event-mapper.ts',
  'runtime-bus.ts',
  'plugin-entry.ts',
];

const FORBIDDEN = /opencode|claude|\bpi\b/i;

it('neutral kernel files do not contain runtime protocol names', () => {
  const root = path.join(__dirname, '../../../src/runtime');
  const offenders: string[] = [];
  for (const file of NEUTRAL_FILES) {
    const full = path.join(root, file);
    if (!fs.existsSync(full)) continue;
    const text = fs.readFileSync(full, 'utf8');
    if (FORBIDDEN.test(text)) offenders.push(file);
  }
  expect(offenders).toEqual([]);
});
