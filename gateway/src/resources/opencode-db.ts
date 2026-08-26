import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

/**
 * Minimal read-only access to the opencode server database (`opencode.db`).
 *
 * TODO(runtime-debt): this is a filesystem-level coupling to opencode's private
 * storage. When supporting other runtimes, abstract this behind a "session
 * storage provider" interface. Other runtimes won't have opencode.db.
 *
 * The opencode serve instance resolves the current project to `project_id =
 * "global"` on this machine, which makes its `session.list` return only global
 * sessions and hide the sessions that actually belong to the project (keyed by
 * the git root hash). Gateway cannot fix that from the request side (serve
 * ignores the directory hint for listing). So for listing we read the same
 * SQLite database opencode writes and filter by directory ourselves.
 *
 * Read-only + WAL: opening a WAL database in read-only mode is safe and
 * concurrent with the writer. We never hold a transaction.
 *
 * `node:sqlite` ships with Node 22.5+; @types/node in this repo (20.x) has no
 * typings for it yet, so we load it via require() and type it minimally.
 */

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { DatabaseSync } = require('node:sqlite') as {
  DatabaseSync: new (path: string, opts?: { readOnly?: boolean }) => {
    prepare(sql: string): {
      all(...params: unknown[]): Record<string, unknown>[];
    };
    close(): void;
  };
};

function normalizeDir(dir: string): string {
  return dir.replace(/\\/g, '/').toLowerCase().replace(/\/+$/, '');
}

export function opencodeDbPath(): string {
  const base = process.env.XDG_DATA_HOME || path.join(os.homedir(), '.local', 'share');
  return path.join(base, 'opencode', 'opencode.db');
}

export interface DbSessionRow {
  id: string;
  project_id: string;
  directory: string;
  title: string;
  metadata: Record<string, unknown> | null;
  time_created: number;
  time_updated: number;
}

/** Map a `session` table row to the wire shape gateway already returns. */
export function toSessionShape(row: DbSessionRow) {
  return {
    id: row.id,
    projectID: row.project_id,
    directory: row.directory,
    title: row.title,
    metadata: row.metadata ?? undefined,
    time: { created: row.time_created, updated: row.time_updated },
  };
}

/**
 * Resolve the project_id(s) whose directories contain `directory`.
 *
 * opencode tracks per-project directories in `project_directory` (git
 * worktrees/sandboxes) and the canonical worktree in `project`. We match the
 * normalized target path against both, plus a final fallback that matches the
 * session table's own directory column (for sessions created before the
 * project_directory table populated, or in non-git dirs).
 */
export function projectIdsForDirectory(
  db: { prepare(sql: string): { all(...params: unknown[]): Record<string, unknown>[] } },
  directory: string,
): string[] {
  const target = normalizeDir(directory);
  const ids = new Set<string>();

  try {
    const byDir = db.prepare('SELECT project_id, directory FROM project_directory').all();
    for (const row of byDir) {
      const rowDir = row.directory;
      if (typeof rowDir === 'string' && normalizeDir(rowDir) === target) {
        ids.add(String(row.project_id));
      }
    }
  } catch { /* column may be absent on old schemas */ }

  try {
    const byWorktree = db.prepare('SELECT id, worktree FROM project').all();
    for (const row of byWorktree) {
      const rowDir = row.worktree;
      if (typeof rowDir === 'string' && normalizeDir(rowDir) === target) {
        ids.add(String(row.id));
      }
    }
  } catch { /* ignore */ }

  return [...ids];
}

/** Sessions whose directory is (or is under) the target project directory. */
export function sessionsUnderDirectory(
  db: { prepare(sql: string): { all(...params: unknown[]): Record<string, unknown>[] } },
  directory: string,
  limit = 200,
): DbSessionRow[] {
  const target = normalizeDir(directory);
  const rows = db.prepare(
    `SELECT id, project_id, directory, title, metadata, time_created, time_updated
     FROM session
     ORDER BY time_updated DESC
     LIMIT 5000`,
  ).all() as unknown as DbSessionRow[];

  const matching: DbSessionRow[] = [];
  for (const row of rows) {
    const rowDir = normalizeDir(row.directory || '');
    // Match the project dir itself or any descendant (subdir sessions belong
    // to the same git project on disk).
    if (rowDir === target || rowDir.startsWith(target + '/')) matching.push(row);
    if (matching.length >= limit) break;
  }
  return matching;
}

/**
 * Sessions that belong to `directory`'s project, resolved through the project
 * registry first (worktrees/sandboxes), falling back to a directory prefix
 * match. Returns wire-shaped session objects.
 */
export function listSessionsFromDb(directory: string, limit = 200): any[] {
  if (!directory) return [];
  const dbPath = opencodeDbPath();
  if (!fs.existsSync(dbPath)) return [];

  let db: InstanceType<typeof DatabaseSync>;
  try {
    db = new DatabaseSync(dbPath, { readOnly: true });
  } catch {
    return [];
  }

  try {
    const projectIds = projectIdsForDirectory(db, directory);
    const out: any[] = [];
    const seen = new Set<string>();

    const push = (row: DbSessionRow) => {
      if (seen.has(row.id)) return;
      seen.add(row.id);
      out.push(toSessionShape(row));
    };

    if (projectIds.length > 0) {
      const placeholders = projectIds.map(() => '?').join(', ');
      const rows = db.prepare(
        `SELECT id, project_id, directory, title, metadata, time_created, time_updated
         FROM session
         WHERE project_id IN (${placeholders})
         ORDER BY time_updated DESC
         LIMIT ?`,
      ).all(...projectIds, limit) as unknown as DbSessionRow[];
      for (const row of rows) push(row);
    }

    // Fallback: directory prefix match in case the project registry has no
    // entry for this directory (non-git dirs, or project_directory gaps).
    if (out.length === 0) {
      for (const row of sessionsUnderDirectory(db, directory, limit)) push(row);
    }

    return out;
  } finally {
    try { db.close(); } catch { /* ignore */ }
  }
}
