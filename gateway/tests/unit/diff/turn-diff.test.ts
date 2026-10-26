// Task 1 (B3.1): per-turn diff service tests.
import { execFileSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  computeTurnDiff,
  computeTurnDiffForRuntime,
  findSnapshotRepo,
  GitRunner,
  parseGitDiff,
  selectTurnSnapshot,
  TurnDiffUnavailableError,
} from '../../../src/core/diff/turn-diff';

const user = (id: string, created: number) => ({ id, role: 'user', time: { created } });
const asst = (id: string, created: number, snapshot: any) => ({ id, role: 'assistant', time: { created }, snapshot });
/** Valid 40-hex snapshot ids (validation requires real object ids). */
const hex = (n: number) => n.toString(16).padStart(40, '0');
const H1 = hex(1), H2 = hex(2), H3 = hex(3), H4 = hex(4), H5 = hex(5), H6 = hex(6), H7 = hex(7);
const PATCH = [
  'diff --git a/x.txt b/x.txt',
  '--- a/x.txt',
  '+++ b/x.txt',
  '@@ -1,2 +1,2 @@',
  ' a',
  '-b',
  '+c',
  '',
].join('\n');

describe('selectTurnSnapshot', () => {
  it('uses the first start and last end inside the user turn', () => {
    const messages = [
      user('u0', 1), asst('a0', 2, { start: H1, end: H2 }),
      user('u1', 10), asst('a1', 11, { start: H3, end: H4 }), asst('a2', 12, { start: H4, end: H5 }),
      user('u2', 20), asst('a3', 21, { start: H6, end: H7 }),
    ];
    expect(selectTurnSnapshot(messages, 'u1')).toEqual({ start: H3, end: H5 });
  });

  it('throws when the last snapshot has no end and files are non-empty', () => {
    const messages = [user('u1', 1), asst('a1', 2, { start: H1, files: ['x'] })];
    expect(() => selectTurnSnapshot(messages, 'u1')).toThrow(TurnDiffUnavailableError);
  });

  it('treats a missing end with empty files as no final change', () => {
    const messages = [user('u1', 1), asst('a1', 2, { start: H1, files: [] })];
    expect(selectTurnSnapshot(messages, 'u1')).toEqual({ start: H1, end: H1 });
  });

  it('keeps earlier changes when only the last assistant lacks an end', () => {
    const messages = [
      user('u1', 1),
      asst('a1', 2, { start: H1, end: H2 }),
      asst('a2', 3, { start: H2, files: [] }),
    ];
    expect(selectTurnSnapshot(messages, 'u1')).toEqual({ start: H1, end: H2 });
  });

  it('throws for no assistant snapshot, a missing user, and an assistant id', () => {
    expect(() => selectTurnSnapshot([user('u1', 1), asst('a1', 2, {})], 'u1')).toThrow(TurnDiffUnavailableError);
    expect(() => selectTurnSnapshot([user('u1', 1)], 'missing')).toThrow(TurnDiffUnavailableError);
    expect(() => selectTurnSnapshot([user('u1', 1), asst('a1', 2, { start: H1, end: H2 })], 'a1')).toThrow(TurnDiffUnavailableError);
  });

  it('handles wrapped items and unsorted input', () => {
    const messages = [
      { info: asst('a2', 12, { start: H2, end: H3 }) },
      { info: user('u1', 10) },
      { info: asst('a1', 11, { start: H1, end: H2 }) },
    ];
    expect(selectTurnSnapshot(messages, 'u1')).toEqual({ start: H1, end: H3 });
  });
});

describe('parseGitDiff', () => {
  it('parses a modified file', () => {
    expect(parseGitDiff(PATCH)).toEqual([
      { file: 'x.txt', patch: PATCH, additions: 1, deletions: 1, status: 'modified' },
    ]);
  });
  it('marks added and deleted files', () => {
    const added = 'diff --git a/n b/n\nnew file mode 100644\n--- /dev/null\n+++ b/n\n@@ -0,0 +1 @@\n+x\n';
    const deleted = 'diff --git a/d b/d\ndeleted file mode 100644\n--- a/d\n+++ /dev/null\n@@ -1 +0,0 @@\n-x\n';
    expect(parseGitDiff(added)).toMatchObject([{ file: 'n', status: 'added' }]);
    expect(parseGitDiff(deleted)).toMatchObject([{ file: 'd', status: 'deleted' }]);
  });
  it('keeps a binary/no-hunk block and handles multiple files', () => {
    const patch = 'diff --git a/a b/a\nBinary files a/a and b/a differ\ndiff --git a/b b/b\n--- a/b\n+++ b/b\n@@ -1 +1 @@\n-x\n+y\n';
    expect(parseGitDiff(patch)).toHaveLength(2);
    expect(parseGitDiff(patch)[0]).toMatchObject({ file: 'a', patch: expect.stringContaining('Binary files') });
    expect(parseGitDiff(patch)[1].file).toBe('b');
  });
});

it('returns [] for a same-tree turn without invoking git', async () => {
  let called = false;
  const git: GitRunner = { async run() {
    called = true;
    return { code: 0, stdout: '', stderr: '' };
  } };
  const files = await computeTurnDiff({
    messages: [user('u1', 1), asst('a1', 2, { start: H1, end: H1 })],
    messageID: 'u1',
    snapshotRoot: path.join(os.tmpdir(), 'mafw-turn-diff-unused'),
    git,
  });
  expect(files).toEqual([]);
  expect(called).toBe(false);
});

it('findSnapshotRepo scans other project dirs and returns null for non-trees', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mafw-snapshot-scan-'));
  fs.mkdirSync(path.join(root, 'other', 'repo'), { recursive: true });
  const treeGit: GitRunner = { async run(args) {
    return args.includes('cat-file')
      ? { code: 0, stdout: 'tree\n', stderr: '' }
      : { code: 0, stdout: PATCH, stderr: '' };
  } };
  const found = await findSnapshotRepo({ root, projectID: 'stale', start: 's', end: 'e', git: treeGit });
  expect(found).toBe(path.join(root, 'other', 'repo'));

  const blobGit: GitRunner = { async run() { return { code: 0, stdout: 'blob\n', stderr: '' }; } };
  expect(await findSnapshotRepo({ root, projectID: 'stale', start: 's', end: 'e', git: blobGit })).toBeNull();
});

it('computes a real tree diff from a separate-git-dir repo', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mafw-turn-diff-'));
  const repo = path.join(root, 'proj', 'repo');
  const work = path.join(root, 'work');
  fs.mkdirSync(path.join(root, 'proj'), { recursive: true });
  execFileSync('git', ['init', '--separate-git-dir', repo, work]);
  execFileSync('git', ['-C', work, 'config', 'core.autocrlf', 'false']);
  const git = (args: string[]) => execFileSync('git', ['-C', work, ...args], { encoding: 'utf8' }).trim();
  fs.writeFileSync(path.join(work, 'x.txt'), 'a\nb\n');
  git(['add', '-A']); const start = git(['write-tree']);
  fs.writeFileSync(path.join(work, 'x.txt'), 'a\nc\n');
  git(['add', '-A']); const end = git(['write-tree']);
  const files = await computeTurnDiff({
    messages: [user('u1', 1), asst('a1', 2, { start, end })],
    messageID: 'u1', projectID: 'proj', snapshotRoot: root,
  });
  expect(files).toEqual([{ file: 'x.txt', patch: expect.stringContaining('@@'), additions: 1, deletions: 1, status: 'modified' }]);
});

it('computeTurnDiffForRuntime fetches limit 200 and passes projectID', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mafw-turn-diff-runtime-'));
  fs.mkdirSync(path.join(root, 'p', 'r'), { recursive: true });
  let limit = -1;
  const git: GitRunner = { async run(args) {
    if (args.includes('cat-file')) return { code: 0, stdout: 'tree\n', stderr: '' };
    return { code: 0, stdout: PATCH, stderr: '' };
  } };
  const runtime = {
    session: {
      get: async () => ({ projectID: 'p' }),
      messages: async (o: { limit?: number }) => { limit = o.limit ?? -1; return { data: [user('u1', 1), asst('a1', 2, { start: H1, end: H2 })] }; },
    },
  };
  const files = await computeTurnDiffForRuntime(runtime as any, 's1', 'u1', { snapshotRoot: root, git });
  expect(limit).toBe(200);
  expect(files[0].file).toBe('x.txt');
});

// ── B3.1 历史 minors：snapshot id 校验 / 引号路径 / missing tree ──────────────
describe('snapshot id validation', () => {
  it('rejects non-hex and option-like snapshot ids', () => {
    const u = user('u1', 1);
    expect(() => selectTurnSnapshot(
      [u, asst('a1', 2, { start: '--output=/tmp/x', end: hex(2) })],
      'u1',
    )).toThrow(TurnDiffUnavailableError);
    expect(() => selectTurnSnapshot(
      [u, asst('a1', 2, { start: hex(1), end: '"--output=/tmp/x"', files: ['x'] })],
      'u1',
    )).toThrow(TurnDiffUnavailableError);
  });

  it('treats an invalid end with no files as no final change', () => {
    expect(selectTurnSnapshot(
      [user('u1', 1), asst('a1', 2, { start: hex(1), end: 'not-an-id', files: [] })],
      'u1',
    )).toEqual({ start: hex(1), end: hex(1) });
  });
});

describe('parseGitDiff quoted paths', () => {
  it('decodes C-quoted paths (tab) instead of leaking escapes', () => {
    const patch = [
      'diff --git "a/tab\\there.txt" "b/tab\\there.txt"',
      '--- "a/tab\\there.txt"',
      '+++ "b/tab\\there.txt"',
      '@@ -1 +1 @@',
      '-x',
      '+y',
      '',
    ].join('\n');
    expect(parseGitDiff(patch)[0].file).toBe('tab\there.txt');
  });

  it('keeps unicode/space paths raw when quotePath=false', () => {
    const patch = 'diff --git a/中文 文件.txt b/中文 文件.txt\n--- a/中文 文件.txt\n+++ b/中文 文件.txt\n@@ -1 +1 @@\n-x\n+y\n';
    expect(parseGitDiff(patch)[0].file).toBe('中文 文件.txt');
  });

  it('decodes quoted binary header paths', () => {
    const patch = 'diff --git "a/bin\\tfile.bin" "b/bin\\tfile.bin"\nBinary files "a/bin\\tfile.bin" and "b/bin\\tfile.bin" differ\n';
    expect(parseGitDiff(patch)[0].file).toBe('bin\tfile.bin');
  });
});

it('findSnapshotRepo returns null when the trees are missing (pruned snapshot)', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mafw-turn-diff-missing-'));
  fs.mkdirSync(path.join(root, 'p', 'r'), { recursive: true });
  const git: GitRunner = { async run() { return { code: 1, stdout: '', stderr: 'missing' }; } };
  expect(await findSnapshotRepo({ root, projectID: 'p', start: hex(1), end: hex(2), git })).toBeNull();
});

it('computeTurnDiff throws unavailable when snapshot trees are missing', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mafw-turn-diff-missing2-'));
  fs.mkdirSync(path.join(root, 'p', 'r'), { recursive: true });
  const git: GitRunner = { async run() { return { code: 1, stdout: '', stderr: 'missing' }; } };
  await expect(computeTurnDiff({
    messages: [user('u1', 1), asst('a1', 2, { start: hex(1), end: hex(2) })],
    messageID: 'u1',
    projectID: 'p',
    snapshotRoot: root,
    git,
  })).rejects.toBeInstanceOf(TurnDiffUnavailableError);
});
