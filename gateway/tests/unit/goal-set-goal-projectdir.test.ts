import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { handleManagerSetGoal } from '../../src/mcp/handlers/manager-set-goal';

function makeServices() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mafw-setg-'));
  const projectA = path.join(tmp, 'projA');
  fs.mkdirSync(path.join(projectA, '.mafw'), { recursive: true });
  const projects = [{ projectDir: projectA, mafwDir: path.join(projectA, '.mafw') }];
  const svc = {
    mafwDir: path.join(tmp, 'home-mafw'),
    listProjects: () => projects,
  } as any;
  return { tmp, svc, projectA };
}

describe('mafw_set_goal projectDir', () => {
  it('projectDir 已注册 → 写入该项目 .mafw', async () => {
    const { svc, projectA } = makeServices();
    const res = await handleManagerSetGoal(
      { goalId: 'g1', title: 'T', charter: '# c', projectDir: projectA }, svc,
    );
    expect(JSON.parse(res.content![0].text as string).success).toBe(true);
    expect(fs.existsSync(path.join(projectA, '.mafw', 'requests', 'g1.json'))).toBe(true);
  });

  it('projectDir 未注册 → 报错并列出可选项', async () => {
    const { svc, projectA } = makeServices();
    const res = await handleManagerSetGoal(
      { goalId: 'g2', title: 'T', charter: '# c', projectDir: 'C:/nope' }, svc,
    );
    const body = JSON.parse(res.content![0].text as string);
    expect(body.success).toBe(false);
    expect(body.error).toContain('C:/nope');
    expect(body.error).toContain('projA');
  });

  it('无 projectDir → 维持现状（写 services.mafwDir）', async () => {
    const { svc } = makeServices();
    await handleManagerSetGoal({ goalId: 'g3', title: 'T', charter: '# c' }, svc);
    expect(fs.existsSync(path.join(svc.mafwDir, 'requests', 'g3.json'))).toBe(true);
  });
});
