import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { handleCreateGoal } from '../../../src/mcp/handlers/create-goal';

describe('mafw_create_goal shared intake', () => {
  let dir: string;
  const old = process.env.MAFW_PROJECT_DIR;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mafw-create-goal-intake-'));
    process.env.MAFW_PROJECT_DIR = dir;
  });

  afterEach(() => {
    process.env.MAFW_PROJECT_DIR = old;
    fs.rmSync(dir, { recursive: true, force: true });
  });

  test('writes authorization and acceptance through the shared intake', async () => {
    const out = await handleCreateGoal({
      goalId: 'g1', title: 'Fix', charter: '# Fix',
      acceptance: ['tests pass'], source: 'user',
    } as any, {} as any);
    expect(JSON.parse((out as any).content[0].text).success).toBe(true);
    const request = JSON.parse(fs.readFileSync(path.join(dir, '.mafw', 'requests', 'g1.json'), 'utf8'));
    expect(request).toMatchObject({
      acceptance: ['tests pass'],
      authorization: { source: 'user', requestMode: 'explicit' },
    });
  });
});
