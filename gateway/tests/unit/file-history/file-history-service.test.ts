import { mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { FileHistoryService, writeToolPaths, resolveHistoryTarget } from '../../../src/core/file-history/file-history-service';

function tempDir(): string {
  return mkdtempSync(join(tmpdir(), 'mafw-fh-'));
}

describe('FileHistoryService（非 git/二进制文件级历史）', () => {
  let root: string;
  let project: string;
  let svc: FileHistoryService;

  beforeEach(() => {
    root = tempDir();
    project = join(root, 'proj');
    mkdirSync(join(project, 'slides'), { recursive: true });
    svc = new FileHistoryService(join(root, 'history'));
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it('snapshot 保存前内容，restore 恢复文本', async () => {
    const file = join(project, 'slides', 'a.md');
    writeFileSync(file, 'v1');
    const snap = await svc.snapshot({ sessionID: 'ses_1', projectDir: project, relPaths: ['slides/a.md'] });
    expect(snap.entries).toHaveLength(1);
    writeFileSync(file, 'v2');
    const restore = await svc.restore('ses_1', snap.entries[0].id);
    expect(restore.ok).toBe(true);
    expect(readFileSync(file, 'utf8')).toBe('v1');
  });

  it('restore 前先快照当前内容（可反悔）', async () => {
    const file = join(project, 'slides', 'a.md');
    writeFileSync(file, 'v1');
    const snap = await svc.snapshot({ sessionID: 'ses_1', projectDir: project, relPaths: ['slides/a.md'] });
    writeFileSync(file, 'v2');
    await svc.restore('ses_1', snap.entries[0].id);
    const list = await svc.list('ses_1', 'slides/a.md');
    expect(list.map((e) => e.reason)).toContain('pre-restore');
    expect(readFileSync(file, 'utf8')).toBe('v1');
  });

  it('二进制字节完全保留（pptx 等）', async () => {
    const file = join(project, 'slides', 'deck.pptx');
    const buf = Buffer.from([0, 1, 2, 250, 251, 255]);
    writeFileSync(file, buf);
    const snap = await svc.snapshot({ sessionID: 'ses_1', projectDir: project, relPaths: ['slides/deck.pptx'] });
    writeFileSync(file, Buffer.from('changed'));
    await svc.restore('ses_1', snap.entries[0].id);
    expect(readFileSync(file).equals(buf)).toBe(true);
  });

  it('内容相同的快照只存一份 blob（会话内去重）', async () => {
    const file = join(project, 'a.txt');
    writeFileSync(file, 'same');
    await svc.snapshot({ sessionID: 'ses_1', projectDir: project, relPaths: ['a.txt'] });
    await svc.snapshot({ sessionID: 'ses_1', projectDir: project, relPaths: ['a.txt'], reason: 'again' });
    const blobs = readdirSync(join(root, 'history', 'ses_1', 'blobs'));
    expect(blobs).toHaveLength(1);
  });

  it('拒绝 traversal / 绝对路径；不存在的文件跳过', async () => {
    mkdirSync(join(root, 'outside'), { recursive: true });
    writeFileSync(join(root, 'outside', 'x.txt'), 'secret');
    const snap = await svc.snapshot({
      sessionID: 'ses_1',
      projectDir: project,
      relPaths: ['../outside/x.txt', 'C:\\Windows\\win.ini', 'missing.txt'],
    });
    expect(snap.entries).toHaveLength(0);
    expect(snap.skipped.length).toBeGreaterThanOrEqual(2);
  });

  it('每个文件的条目数按上限保留最新（旧 blob 清理）', async () => {
    const capped = new FileHistoryService(join(root, 'history'), { maxEntriesPerFile: 2 });
    const file = join(project, 'a.txt');
    for (const v of ['v1', 'v2', 'v3']) {
      writeFileSync(file, v);
      await capped.snapshot({ sessionID: 'ses_1', projectDir: project, relPaths: ['a.txt'], reason: v });
    }
    const list = await capped.list('ses_1', 'a.txt');
    expect(list.map((e) => e.reason)).toEqual(['v3', 'v2']);
    const blobs = readdirSync(join(root, 'history', 'ses_1', 'blobs'));
    expect(blobs).toHaveLength(2);
  });

  it('list 支持按 rel 过滤、按时间倒序', async () => {
    writeFileSync(join(project, 'a.txt'), 'a');
    writeFileSync(join(project, 'b.txt'), 'b');
    await svc.snapshot({ sessionID: 'ses_1', projectDir: project, relPaths: ['a.txt', 'b.txt'] });
    const all = await svc.list('ses_1');
    expect(all).toHaveLength(2);
    expect(all[0].createdAt >= all[1].createdAt).toBe(true);
    const onlyA = await svc.list('ses_1', 'a.txt');
    expect(onlyA.every((e) => e.rel === 'a.txt')).toBe(true);
  });

  it('目标路径解析：项目内通过，越界/盘符拒绝', () => {
    const proj = resolve('/proj');
    expect(resolveHistoryTarget(proj, 'a/b.txt')).toBe(join(proj, 'a/b.txt'));
    expect(resolveHistoryTarget(proj, '../x')).toBeNull();
    expect(resolveHistoryTarget(proj, 'C:\\Windows\\x')).toBeNull();
    expect(resolveHistoryTarget(proj, '')).toBeNull();
  });
});

describe('writeToolPaths（工具输入 → 文件路径）', () => {
  it('write/edit 的 filePath / path / file_path 都识别', () => {
    expect(writeToolPaths('write', { filePath: 'a.txt' })).toEqual(['a.txt']);
    expect(writeToolPaths('edit', { path: 'b.txt' })).toEqual(['b.txt']);
    expect(writeToolPaths('Edit', { file_path: 'c.txt' })).toEqual(['c.txt']);
  });

  it('apply_patch 解析 V4A 的 Update/Add/Delete File 行', () => {
    const patch = [
      '*** Begin Patch',
      '*** Update File: src/a.ts',
      '@@',
      '-old',
      '+new',
      '*** Add File: src/b.ts',
      '*** Delete File: old/c.ts',
      '*** End Patch',
    ].join('\n');
    expect(writeToolPaths('apply_patch', { patchText: patch })).toEqual(['src/a.ts', 'src/b.ts', 'old/c.ts']);
  });

  it('非写类工具 / 无路径 → 空', () => {
    expect(writeToolPaths('read', { path: 'a.txt' })).toEqual([]);
    expect(writeToolPaths('write', {})).toEqual([]);
  });
});
