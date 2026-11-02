import * as fs from 'fs';
import * as path from 'path';

const root = path.resolve(__dirname, '../../../..');
const source = path.join(root, 'packages/gateway-sdk/src/view-dto.ts');
const mirror = path.join(root, 'gateway/src/runtime/view-dto.generated.ts');

/** 统一行尾：Windows autocrlf 检出为 CRLF，逐字比较前归一到 LF。 */
function readNormalized(file: string): string {
  return fs.readFileSync(file, 'utf-8').replace(/\r\n/g, '\n');
}

test('gateway View DTO mirror matches the SDK source', () => {
  const expected = readNormalized(source)
    .replace(/^\/\*\*[\s\S]*?\*\/\n/, '');
  const actual = readNormalized(mirror)
    .replace(/^\/\*\*[\s\S]*?\*\/\n/, '');
  expect(actual.trim()).toBe(expected.trim());
});
