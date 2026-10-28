import * as path from 'path';
import { mergeCommands, mergeSkills, computeRevision } from '../../../../src/core/discovery/merge';

describe('discovery merge', () => {
  it('includes MAFW builtin + user custom + same-project custom, omits foreign custom', () => {
    const home = path.resolve('home');
    const proj = path.resolve('proj');
    const other = path.resolve('other');
    const mafw = [
      { name: 'goal', description: 'g', category: 'goals', kind: 'builtin' },
      { name: 'user-cmd', description: 'u', category: 'custom', kind: 'custom', source: path.join(home, '.mafw/commands/user.md') },
      { name: 'proj-cmd', description: 'p', category: 'custom', kind: 'custom', source: path.join(proj, '.mafw/commands/p.md') },
      { name: 'foreign-cmd', description: 'f', category: 'custom', kind: 'custom', source: path.join(other, '.mafw/commands/f.md') },
    ];

    const out = mergeCommands({
      mafw: mafw as any,
      runtime: [{ name: 'goal', agent: 'build' }, { name: 'init', description: 'i' }],
      directory: proj,
      gatewayProjectDir: proj,
      mafwDir: path.join(home, '.mafw'),
    });

    expect(out.commands.map((c) => c.name)).toEqual(['goal', 'init', 'proj-cmd', 'user-cmd']);
    expect(out.commands.find((c) => c.name === 'goal')).toMatchObject({
      source: 'mafw', scope: 'gateway', runtime: true, agent: 'build',
    });
    expect(out.commands.find((c) => c.name === 'proj-cmd')).toMatchObject({ source: 'custom', scope: 'project' });
    expect(out.commands.find((c) => c.name === 'foreign-cmd')).toBeUndefined();
    expect(out.warnings.some((w) => w.source === 'commands')).toBe(true);
  });

  it('infers skill scope and defaults slash to false', () => {
    const proj = path.resolve('proj');
    const home = path.resolve('home');
    const out = mergeSkills([
      { id: 'a', name: 'A', location: path.join(proj, '.opencode/skills/a/SKILL.md'), contentLength: 10 },
      { id: 'b', name: 'B', location: path.join(home, '.config/opencode/skills/b/SKILL.md'), contentLength: 20 },
    ], { directory: proj, homeDir: home, globalConfigDir: path.join(home, '.config/opencode') });

    expect(out[0]).toMatchObject({ id: 'b', scope: 'user', slash: false });
    expect(out[1]).toMatchObject({ id: 'a', scope: 'project', slash: false });
  });

  it('revision is stable and changes when commands change', () => {
    const a = computeRevision({
      commands: [{ name: 'x', description: 'x', source: 'runtime', scope: 'runtime' }],
      skills: [],
      instructions: [],
    });
    const b = computeRevision({
      commands: [{ name: 'x', description: 'x', source: 'runtime', scope: 'runtime' }],
      skills: [],
      instructions: [],
    });
    const c = computeRevision({
      commands: [{ name: 'y', description: 'y', source: 'runtime', scope: 'runtime' }],
      skills: [],
      instructions: [],
    });

    expect(a).toEqual(b);
    expect(a.revision).toMatch(/^[0-9a-f]{64}$/);
    expect(a.revision).not.toBe(c.revision);
    expect(a.commandsRevision).not.toBe(c.commandsRevision);
  });
});
