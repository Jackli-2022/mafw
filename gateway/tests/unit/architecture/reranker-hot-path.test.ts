import * as fs from 'fs';
import * as path from 'path';

test('the synchronous boundary recall module does not import the reranker', () => {
  const source = fs.readFileSync(
    path.join(__dirname, '../../../src/recall/recall-context.ts'),
    'utf8',
  );
  expect(source).not.toMatch(/from ['"][^'"]*reranker/);
  expect(source).not.toContain('getReranker');
  expect(source).not.toContain('applyReranker');
});
