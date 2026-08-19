import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { mafwPlanEntry } from '../../../gateway/src/core/skills/mafw-plan/entry';
import { initState } from '../../../gateway/src/core/utils/state';

let tmpDir: string;
let cwdSpy: jest.SpyInstance;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mafw-plan-'));
  fs.mkdirSync(path.join(tmpDir, '.mafw', 'state'), { recursive: true });
  fs.mkdirSync(path.join(tmpDir, '.mafw', 'goals'), { recursive: true });
  fs.mkdirSync(path.join(tmpDir, '.mafw', 'lessons'), { recursive: true });
  fs.writeFileSync(path.join(tmpDir, '.mafw', 'goals', '001-auth.md'), '# Auth');
  initState('001-auth', tmpDir);
  cwdSpy = jest.spyOn(process, 'cwd').mockReturnValue(tmpDir);
});

afterEach(() => {
  cwdSpy.mockRestore();
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

test('mafwPlanEntry writes waves.json and updates state', async () => {
  const mockLlm = {
    chat: jest.fn().mockResolvedValue({
      content: JSON.stringify({ waves: [{ id: 'w1', tasks: [{ id: 't1', description: 'd', affected_files: ['a.ts'], acceptance_criteria: ['c'] }] }], tasks: [{ id: 't1', description: 'd', affected_files: ['a.ts'], acceptance_criteria: ['c'] }] })
    })
  };
  await mafwPlanEntry({ message: '/skill mafw-plan 001-auth', llm: mockLlm, config: { model: 'test' }, sessionId: 's1' });

  const state = JSON.parse(fs.readFileSync(path.join(tmpDir, '.mafw', 'state', '001-auth.json'), 'utf-8'));
  expect(state.nextAction).toBe('CREATE_EXECUTE_SESSION');
  expect(state.totalWaves).toBe(1);
  expect(fs.existsSync(path.join(tmpDir, '.mafw', 'waves.json'))).toBe(true);
});
