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

it('only the mapper may speak payload.properties', () => {
  const root = path.join(__dirname, '../../../src/runtime');
  const offenders = NEUTRAL_FILES
    .filter((file) => file !== 'adapter-event-mapper.ts')
    .filter((file) => {
      const full = path.join(root, file);
      return fs.existsSync(full) && fs.readFileSync(full, 'utf8').includes('payload.properties');
    });
  expect(offenders).toEqual([]);
});
