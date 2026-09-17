import { parseCommandFile, splitArgs, renderTemplate, scanCommandDirs } from '../../src/commands/custom-commands';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

describe('parseCommandFile', () => {
  test('frontmatter + template', () => {
    const s = parseCommandFile('---\ndescription: 跑测试\nargument-hint: "[scope]"\n---\n跑全部测试 $ARGUMENTS\n', 'test', '/f/test.md');
    expect(s).toMatchObject({ name: 'test', description: '跑测试', argumentHint: '[scope]', template: '跑全部测试 $ARGUMENTS' });
  });
  test('no frontmatter → whole body is template, description from first line', () => {
    const s = parseCommandFile('总结一下改动\n', 'sum', '/f/sum.md');
    expect(s).toMatchObject({ name: 'sum', template: '总结一下改动' });
    expect(s?.description).toBe('总结一下改动');
  });
  test('empty template → null', () => {
    expect(parseCommandFile('---\ndescription: x\n---\n\n', 'e', '/f/e.md')).toBeNull();
  });
});

describe('splitArgs', () => {
  test('respects double quotes', () => {
    expect(splitArgs('a "b c" d')).toEqual(['a', 'b c', 'd']);
    expect(splitArgs('')).toEqual([]);
  });
});

describe('renderTemplate', () => {
  const deps = {
    exec: async (cmd: string) => cmd === 'fail' ? Promise.reject(new Error('exit 1')) : `OUT(${cmd})`,
    readFile: async (rel: string) => rel === 'ok.md' ? 'FILE-CONTENT' : Promise.reject(new Error('ENOENT')),
  };
  test('$ARGUMENTS and positional', async () => {
    expect(await renderTemplate('A=$ARGUMENTS B=$1 C=$2', 'x "y z"', deps)).toBe('A=x "y z" B=x C=y z');
  });
  test('shell injection with escaped args inside block', async () => {
    expect(await renderTemplate('R: !`grep $1 .`', 'a"b', deps)).toBe('R: OUT(grep a\\"b .)');
  });
  test('shell failure → inline error note', async () => {
    expect(await renderTemplate('!`fail`', '', deps)).toMatch(/\[命令失败/);
  });
  test('@file injection, missing → placeholder', async () => {
    expect(await renderTemplate('see @ok.md and @no.md', '', deps)).toBe('see FILE-CONTENT and [无法读取文件: no.md]');
  });
  test('processing order: args content not re-expanded', async () => {
    // $ARGUMENTS 里的 "@x" 不应被二次展开（替换顺序保证）
    expect(await renderTemplate('$1', '@ok.md', deps)).toBe('@ok.md');
  });
});

describe('scanCommandDirs', () => {
  test('recursive .md, subdir namespacing, project overrides user', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mafw-cmd-'));
    const userDir = path.join(root, 'user');
    const projDir = path.join(root, 'proj');
    fs.mkdirSync(path.join(userDir, 'git'), { recursive: true });
    fs.mkdirSync(projDir, { recursive: true });
    fs.writeFileSync(path.join(userDir, 'deploy.md'), '---\ndescription: 用户级部署\n---\ndeploy user');
    fs.writeFileSync(path.join(userDir, 'git', 'commit.md'), 'commit template');
    fs.writeFileSync(path.join(projDir, 'deploy.md'), '---\ndescription: 项目级部署\n---\ndeploy proj');
    fs.writeFileSync(path.join(projDir, 'notmd.txt'), 'ignored');
    const specs = await scanCommandDirs([{ dir: userDir, scope: 'user' }, { dir: projDir, scope: 'project' }]);
    const byName = new Map(specs.map((s) => [s.name, s]));
    expect(byName.get('deploy')?.template).toBe('deploy proj');
    expect(byName.get('git:commit')?.template).toBe('commit template');
    expect(byName.has('notmd')).toBe(false);
    fs.rmSync(root, { recursive: true, force: true });
  });
  test('missing dir → skipped', async () => {
    expect(await scanCommandDirs([{ dir: '/nonexistent-xyz', scope: 'user' }])).toEqual([]);
  });
});
