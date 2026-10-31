/**
 * FileHistoryService — 文件级历史快照（2026-10-31）。
 *
 * 背景：checkpoint 依赖 opencode 的 git snapshot，只覆盖 git 工作区；
 * Office（pptx/xlsx/docx）、二进制与未跟踪/非 git 目录没有可回退版本。
 * 本服务在 agent 写文件前做 copy-on-write 快照（内容寻址去重），支持按文件/按会话恢复。
 *
 * 语义：
 * - 快照必须是**写入前**的内容；调用方在工具 running / 保存前触发。
 * - 存储：`<root>/<session>/index.json` + `<root>/<session>/blobs/<sha256>`。
 * - 每个文件保留最近 N 个版本、每会话最多 M 条；裁剪时清理无引用 blob。
 * - 恢复前自动快照当前内容（reason=pre-restore），保证可反悔。
 * - 路径必须落在 projectDir 内（traversal / 绝对路径 / 盘符拒绝）。
 */
import * as crypto from 'crypto';
import * as fs from 'fs/promises';
import * as path from 'path';

export type FileHistoryEntry = {
  id: string;
  sessionID: string;
  projectDir: string;
  rel: string;
  blob: string;
  size: number;
  mtimeMs: number;
  createdAt: string;
  /** 同毫秒内的单调序号（createdAt 相同时的稳定排序）。 */
  seq: number;
  reason: string;
};

export type SnapshotInput = {
  sessionID: string;
  projectDir: string;
  relPaths: string[];
  reason?: string;
};

export type SnapshotSkip = { rel: string; reason: 'unsafe-path' | 'missing' | 'not-file' | 'too-large' | 'io' };

export type SnapshotResult = {
  entries: FileHistoryEntry[];
  skipped: SnapshotSkip[];
};

export type FileHistoryOptions = {
  maxEntriesPerFile?: number;
  maxEntriesPerSession?: number;
  maxFileBytes?: number;
};

type SessionIndex = {
  version: 1;
  sessionID: string;
  entries: FileHistoryEntry[];
};

const DEFAULT_MAX_PER_FILE = 20;
const DEFAULT_MAX_PER_SESSION = 500;
const DEFAULT_MAX_FILE_BYTES = 50 * 1024 * 1024;

const normRel = (rel: string): string => rel.replace(/\\/g, '/').replace(/^\.\/+/, '').trim();

/** 工具输入常是绝对路径：项目内 → 归一为 rel；项目外保持原样交给 resolveHistoryTarget 拒绝。 */
function toProjectRel(projectDir: string, raw: string): string {
  const normalized = normRel(raw);
  if (!path.isAbsolute(normalized)) return normalized;
  const base = path.resolve(projectDir);
  const rel = path.relative(base, path.resolve(normalized));
  if (!rel || rel.startsWith('..') || path.isAbsolute(rel)) return normalized;
  return rel.replace(/\\/g, '/');
}

/** 解析历史目标路径；越界/绝对路径/盘符/NUL/空 → null。 */
export function resolveHistoryTarget(projectDir: string, rel: string): string | null {
  if (typeof rel !== 'string') return null;
  const norm = normRel(rel);
  if (!norm || norm === '.' || norm.startsWith('/') || /^[A-Za-z]:/.test(norm) || norm.includes('\u0000')) return null;
  if (norm.split('/').some((seg) => seg === '..')) return null;
  const base = path.resolve(projectDir);
  const target = path.resolve(base, norm);
  const cmp = process.platform === 'win32' ? (p: string) => p.toLowerCase() : (p: string) => p;
  if (cmp(target) !== cmp(base) && !cmp(target).startsWith(cmp(base) + path.sep)) return null;
  return target;
}

/** 写类工具的输入 → 目标文件 rel 列表（纯函数，可测）。 */
export function writeToolPaths(tool: string, input: any): string[] {
  const t = String(tool ?? '').toLowerCase();
  const out: string[] = [];
  const push = (v: unknown) => {
    if (typeof v === 'string' && v.trim() && !out.includes(v.trim())) out.push(v.trim());
  };
  if (t === 'write' || t === 'edit' || t === 'multiedit' || t === 'write_file' || t === 'edit_file') {
    push(input?.filePath);
    push(input?.file_path);
    push(input?.path);
    push(input?.filename);
    return out;
  }
  if (t === 'apply_patch' || t === 'patch') {
    const patch = typeof input?.patchText === 'string'
      ? input.patchText
      : typeof input?.patch === 'string' ? input.patch : typeof input?.input === 'string' ? input.input : '';
    if (patch) {
      const re = /^\*\*\* (?:Update|Add|Delete) File:\s*(.+?)\s*$/gm;
      for (const m of patch.matchAll(re)) push(m[1]);
    }
    return out;
  }
  return out;
}

export class FileHistoryService {
  private readonly maxPerFile: number;
  private readonly maxPerSession: number;
  private readonly maxFileBytes: number;
  /** per-session 串行队列：index.json 的读改写不并发。 */
  private readonly queues = new Map<string, Promise<unknown>>();
  private seq = 0;

  constructor(private readonly rootDir: string, opts: FileHistoryOptions = {}) {
    this.maxPerFile = Math.max(1, opts.maxEntriesPerFile ?? DEFAULT_MAX_PER_FILE);
    this.maxPerSession = Math.max(1, opts.maxEntriesPerSession ?? DEFAULT_MAX_PER_SESSION);
    this.maxFileBytes = Math.max(1, opts.maxFileBytes ?? DEFAULT_MAX_FILE_BYTES);
  }

  private sessionDir(sessionID: string): string {
    const safe = String(sessionID).replace(/[^A-Za-z0-9._-]/g, '_') || 'unknown';
    return path.join(this.rootDir, safe);
  }

  private indexPath(sessionID: string): string {
    return path.join(this.sessionDir(sessionID), 'index.json');
  }

  private blobDir(sessionID: string): string {
    return path.join(this.sessionDir(sessionID), 'blobs');
  }

  private async readIndex(sessionID: string): Promise<SessionIndex> {
    try {
      const raw = await fs.readFile(this.indexPath(sessionID), 'utf8');
      const parsed = JSON.parse(raw);
      if (parsed && Array.isArray(parsed.entries)) {
        return { version: 1, sessionID, entries: parsed.entries };
      }
    } catch { /* missing/corrupt → empty */ }
    return { version: 1, sessionID, entries: [] };
  }

  private async writeIndex(sessionID: string, index: SessionIndex): Promise<void> {
    const dir = this.sessionDir(sessionID);
    await fs.mkdir(dir, { recursive: true });
    const target = this.indexPath(sessionID);
    const tmp = `${target}.${process.pid}.${Date.now()}.tmp`;
    await fs.writeFile(tmp, JSON.stringify(index), 'utf8');
    await fs.rename(tmp, target);
  }

  private async withSession<T>(sessionID: string, fn: () => Promise<T>): Promise<T> {
    const prev = this.queues.get(sessionID) ?? Promise.resolve();
    const run = prev.then(fn, fn);
    this.queues.set(sessionID, run.catch(() => undefined));
    return run;
  }

  private nextId(): string {
    this.seq = (this.seq + 1) % 1_000_000;
    return `fh_${Date.now().toString(36)}_${this.seq.toString(36)}_${crypto.randomBytes(3).toString('hex')}`;
  }

  /** 写入前快照：缺失/越界/超大跳过；返回新条目。 */
  async snapshot(input: SnapshotInput): Promise<SnapshotResult> {
    const sessionID = String(input.sessionID ?? '');
    const projectDir = String(input.projectDir ?? '');
    if (!sessionID || !projectDir) return { entries: [], skipped: [] };
    return this.withSession(sessionID, async () => {
      const index = await this.readIndex(sessionID);
      const entries: FileHistoryEntry[] = [];
      const skipped: SnapshotSkip[] = [];
      await fs.mkdir(this.blobDir(sessionID), { recursive: true });

      for (const raw of input.relPaths ?? []) {
        const rel = toProjectRel(projectDir, String(raw));
        const target = resolveHistoryTarget(projectDir, rel);
        if (!target) { skipped.push({ rel: String(raw), reason: 'unsafe-path' }); continue; }
        try {
          const st = await fs.stat(target);
          if (!st.isFile()) { skipped.push({ rel, reason: 'not-file' }); continue; }
          if (st.size > this.maxFileBytes) { skipped.push({ rel, reason: 'too-large' }); continue; }
          const buf = await fs.readFile(target);
          const blob = crypto.createHash('sha256').update(buf).digest('hex');
          // 与最近一条版本内容相同 → 不重复记账（工具 running 事件可能多次到达）
          let latest: FileHistoryEntry | undefined;
          for (const e of [...index.entries, ...entries]) {
            if (e.rel !== rel) continue;
            if (!latest || e.createdAt > latest.createdAt || (e.createdAt === latest.createdAt && (e.seq ?? 0) > (latest.seq ?? 0))) latest = e;
          }
          if (latest?.blob === blob) continue;
          const blobPath = path.join(this.blobDir(sessionID), blob);
          try {
            await fs.access(blobPath);
          } catch {
            const tmp = `${blobPath}.${process.pid}.${Date.now()}.tmp`;
            await fs.writeFile(tmp, buf);
            await fs.rename(tmp, blobPath);
          }
          entries.push({
            id: this.nextId(),
            sessionID,
            projectDir,
            rel,
            blob,
            size: buf.length,
            mtimeMs: st.mtimeMs,
            createdAt: new Date().toISOString(),
            seq: this.seq,
            reason: input.reason ?? 'manual',
          });
        } catch (e: any) {
          skipped.push({ rel, reason: e?.code === 'ENOENT' ? 'missing' : 'io' });
        }
      }

      if (entries.length > 0) {
        index.entries.push(...entries);
        await this.prune(sessionID, index);
        await this.writeIndex(sessionID, index);
      }
      return { entries, skipped };
    });
  }

  /** 会话历史（可按 rel 过滤），最新在前。 */
  async list(sessionID: string, rel?: string): Promise<FileHistoryEntry[]> {
    const index = await this.readIndex(sessionID);
    const wanted = rel === undefined ? null : normRel(rel);
    return index.entries
      .filter((e) => (wanted === null ? true : e.rel === wanted))
      .sort((a, b) => (a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : (b.seq ?? 0) - (a.seq ?? 0)));
  }

  /** 恢复某条快照；恢复前先快照当前内容（可反悔）。 */
  async restore(sessionID: string, entryId: string): Promise<
    { ok: true; rel: string } | { ok: false; reason: 'not-found' | 'blob-missing' | 'unsafe-path' | 'io' }
  > {
    const index = await this.readIndex(sessionID);
    const entry = index.entries.find((e) => e.id === entryId);
    if (!entry) return { ok: false, reason: 'not-found' };
    const target = resolveHistoryTarget(entry.projectDir, entry.rel);
    if (!target) return { ok: false, reason: 'unsafe-path' };
    let buf: Buffer;
    try {
      buf = await fs.readFile(path.join(this.blobDir(sessionID), entry.blob));
    } catch {
      return { ok: false, reason: 'blob-missing' };
    }
    // 恢复前快照当前内容（失败不阻塞恢复）
    try {
      await this.snapshot({ sessionID, projectDir: entry.projectDir, relPaths: [entry.rel], reason: 'pre-restore' });
    } catch { /* fail-open */ }
    try {
      await fs.mkdir(path.dirname(target), { recursive: true });
      const tmp = `${target}.${process.pid}.${Date.now()}.tmp`;
      await fs.writeFile(tmp, buf);
      await fs.rename(tmp, target);
      if (entry.mtimeMs > 0) {
        try { await fs.utimes(target, new Date(), new Date(entry.mtimeMs)); } catch { /* ignore */ }
      }
      return { ok: true, rel: entry.rel };
    } catch {
      return { ok: false, reason: 'io' };
    }
  }

  private async prune(sessionID: string, index: SessionIndex): Promise<void> {
    const newestFirst = [...index.entries].sort((a, b) => (a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : (b.seq ?? 0) - (a.seq ?? 0)));
    const perFile = new Map<string, number>();
    const kept: FileHistoryEntry[] = [];
    for (const e of newestFirst) {
      const used = perFile.get(e.rel) ?? 0;
      if (used >= this.maxPerFile) continue;
      if (kept.length >= this.maxPerSession) break;
      perFile.set(e.rel, used + 1);
      kept.push(e);
    }
    index.entries = kept;
    // 清理无引用 blob（best-effort）
    const usedBlobs = new Set(kept.map((e) => e.blob));
    try {
      for (const name of await fs.readdir(this.blobDir(sessionID))) {
        if (!usedBlobs.has(name)) await fs.unlink(path.join(this.blobDir(sessionID), name));
      }
    } catch { /* ignore */ }
  }
}
