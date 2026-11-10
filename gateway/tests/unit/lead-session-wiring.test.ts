import { readFileSync } from 'fs';
import * as path from 'path';

const indexSource = readFileSync(path.join(__dirname, '../../src/index.ts'), 'utf8');

function section(start: string, end: string): string {
  const from = indexSource.indexOf(start);
  expect(from).toBeGreaterThanOrEqual(0);
  const to = indexSource.indexOf(end, from + start.length);
  expect(to).toBeGreaterThan(from);
  return indexSource.slice(from, to);
}

describe('Lead lifecycle wiring', () => {
  test('scheduler owns one LeadSessionRegistry', () => {
    expect(indexSource).toContain("from './core/manager/lead-session-registry'");
    expect(indexSource).toContain('private leadSessionRegistry!: LeadSessionRegistry;');
  });

  test('createManagerSession delegates to the registry instead of creating directly', () => {
    const create = section('private async createManagerSession(', 'private mafwDirFor(');
    expect(create).toContain('this.leadSessionRegistry.ensure(projectDir)');
    expect(create).not.toContain('runtime.session.create');
    expect(create).not.toContain("kvSet('manager-session'");
  });

  test('Goal snapshot resolves Lead sessions through the registry', () => {
    // Phase D1 Task B3/B4: recall/context 迁入 routes/recall.ts —— 仍必须是
    // registry 的 findBySessionId 解析（不得回退到 .value.sessionId 比较）。
    const recallRoute = readFileSync(path.join(__dirname, '../../src/routes/recall.ts'), 'utf8');
    expect(recallRoute).toMatch(/attachHandler\('recall\.context'[\s\S]{0,2000}deps\.leadSessionRegistry\(\)\.findBySessionId\(sessionID\)/);
    expect(indexSource).not.toContain('.value.sessionId === sessionID');
    expect(recallRoute).not.toContain('.value.sessionId === sessionID');
  });

  test('startup only ensures registered projects with a Pod or in-flight goal', () => {
    expect(indexSource).toContain('shouldEnsureLeadOnStartup');
    const startup = section('// 7. Lead 只属于已有 Pod', '// 8. 启动自动化引擎');
    expect(startup).toContain('shouldEnsureLeadOnStartup');
    expect(startup).toContain('hasPod');
    expect(startup).toContain('hasInFlightGoal');
    expect(startup).not.toContain('await this.ensureManagerSession(projectDir, info.mafwDir);');
  });

  test('both runtime switch paths recover Pod Leads onto the new runtime', () => {
    expect(indexSource.match(/await this\.reconcilePodLeads\(\)/g)?.length ?? 0).toBeGreaterThanOrEqual(2);
    expect(indexSource).toContain('private async reconcilePodLeads()');
  });

  test('Lead registry reads the live runtime name and uses the neutral liveness check', () => {
    expect(indexSource).toContain('runtimeName: () => this.runtimeName');
    expect(indexSource).toContain("import { isLiveSessionInfo } from './runtime/session-liveness'");
    const probe = section('isAlive: async (sessionId) => {', 'registerLead: async (sessionId, dir) => {');
    expect(probe).toContain('isLiveSessionInfo');
  });

  test('Pod session supervisor uses the same neutral liveness check', () => {
    const supervisor = section(
      'this.podSessionSupervisor = new PodSessionSupervisor({',
      'this.podSessionLifecycle = new PodSessionLifecycle({',
    );
    expect(supervisor).toContain('isLiveSessionInfo');
  });

  test('internal rotate archives through the Lead path, not legacy manager metadata', () => {
    const downgrade = section('downgrade: async (sid) => {', 'create: (pd) => this.rotateCreateManagerSession(pd),');
    expect(downgrade).toContain('this.archiveLeadSession(sid)');
    expect(downgrade).not.toContain('manager-archived');
  });

  test('manager session route resolves canonical project keys through the registry', () => {
    const route = section("if (req.url && req.url.startsWith('/api/manager/session')", '// 健康检查');
    expect(route).toContain('this.leadSessionRegistry.current(filter)');
    expect(route).not.toContain('live.find((e) => e.key === filter)');
  });
});
