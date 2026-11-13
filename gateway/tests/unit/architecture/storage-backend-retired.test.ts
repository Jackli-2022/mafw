import * as fs from 'fs';
import * as path from 'path';

const SRC = path.join(__dirname, '../../../src');

function sourceFiles(dir: string): string[] {
  const files: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...sourceFiles(full));
      continue;
    }
    if (/\.(ts|tsx)$/.test(entry.name) && !/\.test\.(ts|tsx)$/.test(entry.name)) {
      files.push(full);
    }
  }
  return files;
}

test('the unused StorageBackend implementation stays retired', () => {
  expect(fs.existsSync(path.join(SRC, 'core', 'storage'))).toBe(false);
  const offenders = sourceFiles(SRC).filter((file) => {
    const source = fs.readFileSync(file, 'utf8');
    return /core\/storage|StorageBackend|class\s+(FileStorage|SQLiteStorage)\b/.test(source);
  });
  expect(offenders.map((file) => path.relative(SRC, file))).toEqual([]);
});
