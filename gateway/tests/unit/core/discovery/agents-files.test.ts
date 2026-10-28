import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { discoverAgentsFiles } from '../../../../src/core/discovery/agents-files';

function write(file: string, body = '# instructions\n') {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, body, 'utf8');
  return fs.realpathSync(file);
}

describe('discoverAgentsFiles', () => {
  it('inside home: global, nearest-first to home, even past .git', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mafw-agents-inside-'));
    const home = path.join(root, 'home');
    const globalDir = path.join(home, '.config/opencode');
    const proj = path.join(home, 'code/proj');
    const pkg = path.join(proj, 'pkg');
    fs.mkdirSync(path.join(proj, '.git'), { recursive: true });

    const global = write(path.join(globalDir, 'AGENTS.md'));
    const project = write(path.join(proj, 'AGENTS.md'));
    const nested = write(path.join(pkg, 'AGENTS.md'));
    const homeFile = write(path.join(home, 'AGENTS.md'));

    const result = discoverAgentsFiles(pkg, { homeDir: home, globalConfigDir: globalDir });

    expect(result.instructions.map((i) => i.path)).toEqual([global, nested, project, homeFile]);
    expect(result.instructions.find((i) => i.path === project)?.scope).toBe('project');
    expect(result.instructions.find((i) => i.path === nested)?.scope).toBe('nested');
    expect(result.instructions.find((i) => i.path === homeFile)?.scope).toBe('nested');
    expect(result.warnings).toEqual([]);
  });

  it('outside home: stops at .git file (worktree) and ignores ancestors above it', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mafw-agents-outside-'));
    const home = path.join(root, 'home');
    const globalDir = path.join(home, '.config/opencode');
    const proj = path.join(root, 'work/proj');
    const pkg = path.join(proj, 'pkg');
    write(path.join(proj, '.git'), 'gitdir: elsewhere\n');

    const global = write(path.join(globalDir, 'AGENTS.md'));
    const project = write(path.join(proj, 'AGENTS.md'));
    const nested = write(path.join(pkg, 'AGENTS.md'));
    write(path.join(root, 'work/AGENTS.md'));

    const result = discoverAgentsFiles(pkg, { homeDir: home, globalConfigDir: globalDir });

    expect(result.instructions.map((i) => i.path)).toEqual([global, nested, project]);
    expect(result.instructions.find((i) => i.path === project)?.scope).toBe('project');
  });

  it('outside home without .git: only the directory', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mafw-agents-nogit-'));
    const home = path.join(root, 'home');
    const globalDir = path.join(home, '.config/opencode');
    const dir = path.join(root, 'work/pkg');

    const global = write(path.join(globalDir, 'AGENTS.md'));
    const local = write(path.join(dir, 'AGENTS.md'));
    write(path.join(root, 'work/AGENTS.md'));

    const result = discoverAgentsFiles(dir, { homeDir: home, globalConfigDir: globalDir });

    expect(result.instructions.map((i) => i.path)).toEqual([global, local]);
  });

  it('skips unreadable metadata with a warning and never returns content', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mafw-agents-stat-'));
    const home = path.join(root, 'home');
    const globalDir = path.join(home, '.config/opencode');
    const dir = path.join(root, 'work/pkg');
    const global = write(path.join(globalDir, 'AGENTS.md'));
    const local = write(path.join(dir, 'AGENTS.md'));

    const result = discoverAgentsFiles(dir, {
      homeDir: home,
      globalConfigDir: globalDir,
      fs: {
        existsSync: fs.existsSync,
        realpathSync: fs.realpathSync,
        statSync: ((file: string) => {
          if (file === global) throw new Error('permission denied');
          return fs.statSync(file);
        }) as typeof fs.statSync,
      },
    });

    expect(result.instructions.map((i) => i.path)).toEqual([local]);
    expect(result.warnings[0]).toMatchObject({ source: 'instructions' });
    expect(result.instructions.every((i) => !('content' in i))).toBe(true);
  });
});
