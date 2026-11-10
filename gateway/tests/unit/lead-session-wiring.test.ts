import { readFileSync } from 'fs';
import * as path from 'path';

// D3 Task 8：组合根（class MafwScheduler）搬到 src/kernel.ts。
const indexSource = readFileSync(path.join(__dirname, '../../src/kernel.ts'), 'utf8');
// D3 Task 5：启动序（步骤 7/8 的 section markers）搬进 src/boot.ts。
const bootSource = readFileSync(path.join(__dirname, '../../src/boot.ts'), 'utf8');

function sectionOf(source: string, start: string, end: string): string {
  const from = source.indexOf(start);
  expect(from).toBeGreaterThanOrEqual(0);
  const to = source.indexOf(end, from + start.length);
  expect(to).toBeGreaterThan(from);
  return source.slice(from, to);
}

function section(start: string, end: string): string {
  return sectionOf(indexSource, start, end);
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
    // D3 Task 5: the startup block (section 7) moved verbatim into boot.ts.
    expect(bootSource).toContain('shouldEnsureLeadOnStartup');
    const startup = sectionOf(bootSource, '// 7. Lead 只属于已有 Pod', '// 8. 启动自动化引擎');
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
    // Phase D1 Task H2: the branch moved out of index.ts into
    // routes/manager-session.ts (registry dispatch, manager.session). The guard
    // follows the code: reads must go through the Lead registry + canonical keys,
    // never a raw kv-key comparison.
    const managersRoute = readFileSync(path.join(__dirname, '../../src/routes/manager-session.ts'), 'utf8');
    expect(managersRoute).toContain('deps.leadSessionRegistry().current(filter)');
    expect(managersRoute).toContain('canonicalProjectDir(entry.key)');
    expect(managersRoute).not.toContain('live.find((e) => e.key === filter)');
    // index.ts must not still own an inline manager/session branch.
    expect(indexSource).not.toContain("req.url.startsWith('/api/manager/session')");
  });
});
