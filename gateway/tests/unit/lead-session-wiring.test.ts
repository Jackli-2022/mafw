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
    expect(indexSource).toContain('this.leadSessionRegistry.findBySessionId(sessionID)');
    expect(indexSource).not.toContain('.value.sessionId === sessionID');
  });

  test('startup only ensures registered projects with a Pod or in-flight goal', () => {
    expect(indexSource).toContain('shouldEnsureLeadOnStartup');
    const startup = section('// 7. Lead 只属于已有 Pod', '// 8. 启动自动化引擎');
    expect(startup).toContain('shouldEnsureLeadOnStartup');
    expect(startup).toContain('hasPod');
    expect(startup).toContain('hasInFlightGoal');
    expect(startup).not.toContain('await this.ensureManagerSession(projectDir, info.mafwDir);');
  });

  test('manager session route resolves canonical project keys through the registry', () => {
    const route = section("if (req.url && req.url.startsWith('/api/manager/session')", '// 健康检查');
    expect(route).toContain('this.leadSessionRegistry.current(filter)');
    expect(route).not.toContain('live.find((e) => e.key === filter)');
  });
});
