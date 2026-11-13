import * as fs from 'fs';
import * as path from 'path';

test('the synchronous boundary recall modules do not import or call the reranker', () => {
  const recallDir = path.join(__dirname, '../../../src/recall');
  const files = [
    ...fs.readdirSync(recallDir)
      .filter((file) => file.endsWith('.ts'))
      .map((file) => path.join(recallDir, file)),
    path.join(__dirname, '../../../src/routes/recall.ts'),
  ];
  for (const file of files) {
    const source = fs.readFileSync(file, 'utf8');
    expect(source).not.toMatch(/from ['"][^'"]*reranker/);
    expect(source).not.toMatch(/\b(getReranker|applyReranker)\s*\(/);
  }
});
