import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { getActivePolicy, BUILTIN_POLICY } from '../../src/orchestration/policy';

describe('getActivePolicy', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'policy-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  test('returns builtin when active.json missing', () => {
    expect(getActivePolicy(tmpDir)).toEqual(BUILTIN_POLICY);
  });

  test('returns builtin when active.json malformed', () => {
    fs.mkdirSync(path.join(tmpDir, 'orchestration'), { recursive: true });
    fs.writeFileSync(path.join(tmpDir, 'orchestration', 'active.json'), 'not json', 'utf-8');
    expect(getActivePolicy(tmpDir)).toEqual(BUILTIN_POLICY);
  });

  test('reads version and proposalId from active.json', () => {
    fs.mkdirSync(path.join(tmpDir, 'orchestration'), { recursive: true });
    fs.writeFileSync(
      path.join(tmpDir, 'orchestration', 'active.json'),
      JSON.stringify({ version: 'v2', proposalId: 'prop1' }),
      'utf-8'
    );
    expect(getActivePolicy(tmpDir)).toEqual({ version: 'v2', proposalId: 'prop1' });
  });

  test('returns builtin when version is empty string', () => {
    fs.mkdirSync(path.join(tmpDir, 'orchestration'), { recursive: true });
    fs.writeFileSync(
      path.join(tmpDir, 'orchestration', 'active.json'),
      JSON.stringify({ version: '' }),
      'utf-8'
    );
    expect(getActivePolicy(tmpDir)).toEqual(BUILTIN_POLICY);
  });
});
