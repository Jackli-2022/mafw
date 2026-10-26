// Per-turn diff from opencode snapshot trees (B3.1).
//
// Assistant messages carry `snapshot.start` / `snapshot.end` git tree ids.
// The user turn's diff is the tree diff from the first assistant start to the
// last assistant end. Snapshot repos live under
// ~/.local/share/opencode/snapshot/<projectID>/<repoDir> and are plain git
// dirs (HEAD/objects directly, no .git subdirectory).
import { execFile } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

export interface FileDiffInfo {
  file?: string;
  patch?: string;
  additions?: number;
  deletions?: number;
  status?: string;
}

export interface GitRunResult {
  code: number;
  stdout: string;
  stderr: string;
}

export interface GitRunner {
  run(
    args: string[],
    opts?: { timeoutMs?: number; maxBuffer?: number },
  ): Promise<GitRunResult>;
}

export class TurnDiffUnavailableError extends Error {
  constructor(message: string) {
    super(message.startsWith('per-turn diff unavailable:')
      ? message
      : `per-turn diff unavailable: ${message}`);
    this.name = 'TurnDiffUnavailableError';
  }
}

const TURN_DIFF_TIMEOUT_MS = 30_000;
const TURN_DIFF_MAX_BUFFER = 32 * 1024 * 1024;

/** Snapshot tree/commit ids must be hex object ids. Never pass raw message data
 *  to git as an argument without this check (git option injection, e.g. --output). */
export function isSnapshotId(value: unknown): value is string {
  return typeof value === 'string' && (/^[0-9a-f]{40}$/i.test(value) || /^[0-9a-f]{64}$/i.test(value));
}

export function roleOf(message: any): string | undefined {
  if (!message || typeof message !== 'object') return undefined;
  if (typeof message.role === 'string') return message.role;
  if (message.type === 'user' || message.type === 'assistant') return message.type;
  return undefined;
}

export function unwrapMessage(item: any): any {
  return item && typeof item === 'object' && item.info ? item.info : item;
}

export function createdOf(message: any): number {
  const value = message?.time?.created;
  return typeof value === 'number' ? value : Number.MAX_SAFE_INTEGER;
}

/** Select the snapshot tree range for a user turn (throws when unavailable). */
export function selectTurnSnapshot(
  messages: any[],
  messageID: string,
): { start: string; end: string } {
  const normalized = (Array.isArray(messages) ? messages : [])
    .map(unwrapMessage)
    .filter((message) => message && typeof message === 'object')
    .map((message, index) => ({ message, index }))
    .sort((a, b) => createdOf(a.message) - createdOf(b.message) || a.index - b.index)
    .map((entry) => entry.message);

  const userIndex = normalized.findIndex(
    (message) => message?.id === messageID && roleOf(message) === 'user',
  );
  if (userIndex < 0) {
    throw new TurnDiffUnavailableError(`user message ${messageID} not found`);
  }

  let nextUserIndex = normalized.length;
  for (let i = userIndex + 1; i < normalized.length; i++) {
    if (roleOf(normalized[i]) === 'user') {
      nextUserIndex = i;
      break;
    }
  }

  const snapshots = normalized
    .slice(userIndex + 1, nextUserIndex)
    .filter((message) => roleOf(message) === 'assistant')
    .map((message) => message?.snapshot)
    .filter((snapshot) => isSnapshotId(snapshot?.start));

  if (snapshots.length === 0) {
    throw new TurnDiffUnavailableError('no assistant snapshot in this turn');
  }

  const start = snapshots[0].start as string;
  const last = snapshots[snapshots.length - 1];
  let end: string | null = isSnapshotId(last.end) ? last.end : null;
  if (!end) {
    const files = Array.isArray(last.files) ? last.files : [];
    if (files.length > 0) {
      // A snapshot with files but no end is an incomplete step. Do not guess.
      throw new TurnDiffUnavailableError('incomplete turn snapshot (missing end after file changes)');
    }
    // No changes in the final step: the previous end (this step's start) is final.
    end = isSnapshotId(last.start) ? last.start : null;
  }
  if (!end) {
    throw new TurnDiffUnavailableError('invalid snapshot range');
  }
  return { start, end };
}

/** Decode git's C-style path escaping (inside quotes): \t \n \\ \" and octal. */
function decodeGitEscapes(body: string): string {
  let out = '';
  for (let i = 0; i < body.length; i++) {
    const ch = body[i];
    if (ch !== '\\') { out += ch; continue; }
    const next = body[++i];
    if (next === undefined) break;
    switch (next) {
      case 'a': out += '\x07'; break;
      case 'b': out += '\b'; break;
      case 't': out += '\t'; break;
      case 'n': out += '\n'; break;
      case 'v': out += '\v'; break;
      case 'f': out += '\f'; break;
      case 'r': out += '\r'; break;
      case '"': out += '"'; break;
      case '\\': out += '\\'; break;
      default: {
        if (/[0-7]/.test(next)) {
          let oct = next;
          while (oct.length < 3 && /[0-7]/.test(body[i + 1] ?? '')) oct += body[++i];
          out += String.fromCharCode(parseInt(oct, 8));
        } else {
          out += next;
        }
      }
    }
  }
  return out;
}

/** git wraps paths containing quotes/tabs/newlines/backslashes in double quotes. */
function unquoteGitPath(value: string): string {
  const v = value.trim();
  return v.length >= 2 && v.startsWith('"') && v.endsWith('"')
    ? decodeGitEscapes(v.slice(1, -1))
    : v;
}

function cleanPath(value: string): string {
  let result = unquoteGitPath(value);
  if (result.startsWith('a/') || result.startsWith('b/')) result = result.slice(2);
  return result;
}

function fileFromBlock(lines: string[]): string | undefined {
  const plus = lines.find((line) => line.startsWith('+++ '));
  const minus = lines.find((line) => line.startsWith('--- '));
  if (plus && !plus.startsWith('+++ /dev/null')) {
    const value = cleanPath(plus.slice(4));
    if (value) return value;
  }
  if (minus && !minus.startsWith('--- /dev/null')) {
    const value = cleanPath(minus.slice(4));
    if (value) return value;
  }
  if (plus?.startsWith('+++ /dev/null') && minus && !minus.startsWith('--- /dev/null')) {
    const value = cleanPath(minus.slice(4));
    if (value) return value;
  }
  if (minus?.startsWith('--- /dev/null') && plus && !plus.startsWith('+++ /dev/null')) {
    const value = cleanPath(plus.slice(4));
    if (value) return value;
  }

  const header = lines[0] ?? '';
  const quoted = /^diff --git "a\/((?:[^"\\]|\\.)*)" "b\/((?:[^"\\]|\\.)*)"$/.exec(header);
  if (quoted) {
    const value = decodeGitEscapes(quoted[2]).trim();
    if (value) return value;
  }
  const match = /^diff --git a\/(.+) b\/(.+)$/.exec(header);
  if (match) {
    const value = match[2].trim();
    if (value) return value;
  }
  return undefined;
}

/** Parse a multi-file `git diff` text into the gateway's FileDiffInfo shape. */
export function parseGitDiff(patchText: string): FileDiffInfo[] {
  const normalized = String(patchText ?? '').replace(/\r\n/g, '\n');
  if (!normalized.trim()) return [];

  const blocks: string[][] = [];
  let current: string[] | null = null;
  for (const line of normalized.split('\n')) {
    if (line.startsWith('diff --git ')) {
      if (current) blocks.push(current);
      current = [line];
      continue;
    }
    if (current) current.push(line);
  }
  if (current) blocks.push(current);

  const files: FileDiffInfo[] = [];
  for (const block of blocks) {
    const file = fileFromBlock(block);
    if (!file) continue;
    let additions = 0;
    let deletions = 0;
    for (const line of block) {
      if (line.startsWith('+') && !line.startsWith('+++')) additions++;
      else if (line.startsWith('-') && !line.startsWith('---')) deletions++;
    }
    const status = block.some((line) => line.startsWith('new file mode '))
      ? 'added'
      : block.some((line) => line.startsWith('deleted file mode '))
        ? 'deleted'
        : 'modified';
    files.push({
      file,
      patch: block.join('\n'),
      additions,
      deletions,
      status,
    });
  }
  return files;
}

function defaultSnapshotRoot(): string {
  const override = process.env.MAFW_OPENCODE_SNAPSHOT_ROOT;
  if (override) return override;
  const xdg = process.env.XDG_DATA_HOME;
  if (xdg) return path.join(xdg, 'opencode', 'snapshot');
  return path.join(os.homedir(), '.local', 'share', 'opencode', 'snapshot');
}

export { defaultSnapshotRoot };

export const defaultGit: GitRunner = {
  run(args, opts) {
    return new Promise((resolve, reject) => {
      execFile(
        'git',
        args,
        {
          encoding: 'utf8',
          windowsHide: true,
          timeout: opts?.timeoutMs ?? TURN_DIFF_TIMEOUT_MS,
          maxBuffer: opts?.maxBuffer ?? TURN_DIFF_MAX_BUFFER,
        },
        (error: any, stdout, stderr) => {
          // Spawn errors (git missing, timeout with killed=true) reject; normal
          // non-zero git exits resolve so the caller can map them deliberately.
          if (error && (error.code === 'ENOENT' || error.killed)) {
            reject(error);
            return;
          }
          const code = error
            ? (typeof error.code === 'number' ? error.code : 1)
            : 0;
          resolve({
            code,
            stdout: String(stdout ?? ''),
            stderr: String(stderr ?? ''),
          });
        },
      );
    });
  },
};

function listDirectories(dir: string): string[] {
  try {
    return fs.readdirSync(dir, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => path.join(dir, entry.name));
  } catch {
    return [];
  }
}

async function hasTrees(
  repo: string,
  start: string,
  end: string,
  git: GitRunner,
): Promise<boolean> {
  try {
    const startResult = await git.run(['--git-dir', repo, 'cat-file', '-t', start]);
    if (startResult.code !== 0 || startResult.stdout.trim() !== 'tree') return false;
    const endResult = await git.run(['--git-dir', repo, 'cat-file', '-t', end]);
    return endResult.code === 0 && endResult.stdout.trim() === 'tree';
  } catch {
    return false;
  }
}

/** Locate the snapshot git dir containing both tree ids. */
export async function findSnapshotRepo(opts: {
  root: string;
  projectID?: string;
  start: string;
  end: string;
  git: GitRunner;
}): Promise<string | null> {
  const { root, projectID, start, end, git } = opts;
  const safeProjectID = projectID
    && !path.isAbsolute(projectID)
    && !projectID.includes('/')
    && !projectID.includes('\\')
    && !projectID.includes('..')
    ? projectID
    : null;

  const candidates: string[] = [];
  if (safeProjectID) {
    for (const repo of listDirectories(path.join(root, safeProjectID))) {
      candidates.push(repo);
    }
  }
  for (const projectDir of listDirectories(root)) {
    if (safeProjectID && path.basename(projectDir) === safeProjectID) continue;
    for (const repo of listDirectories(projectDir)) {
      candidates.push(repo);
    }
  }

  for (const repo of candidates) {
    if (await hasTrees(repo, start, end, git)) return repo;
  }
  return null;
}

/** Compute the diff for one user turn from its snapshot tree range. */
export async function computeTurnDiff(opts: {
  messages: any[];
  messageID: string;
  projectID?: string;
  snapshotRoot?: string;
  git?: GitRunner;
}): Promise<FileDiffInfo[]> {
  const { start, end } = selectTurnSnapshot(opts.messages, opts.messageID);
  if (start === end) return [];

  const root = opts.snapshotRoot ?? defaultSnapshotRoot();
  const git = opts.git ?? defaultGit;
  const repo = await findSnapshotRepo({
    root,
    projectID: opts.projectID,
    start,
    end,
    git,
  });
  if (!repo) {
    throw new TurnDiffUnavailableError(
      `snapshot trees ${start.slice(0, 8)}..${end.slice(0, 8)} not found`,
    );
  }

  const result = await git.run(
    [
      '--git-dir',
      repo,
      '-c',
      'core.quotePath=false',
      'diff',
      '--no-color',
      '--no-ext-diff',
      '--no-textconv',
      '--no-renames',
      start,
      end,
    ],
    { timeoutMs: TURN_DIFF_TIMEOUT_MS, maxBuffer: TURN_DIFF_MAX_BUFFER },
  );
  if (result.code !== 0) {
    throw new Error(
      `git diff failed (${result.code}): ${(result.stderr || result.stdout).trim()}`,
    );
  }
  return parseGitDiff(result.stdout);
}

/** Runtime-facing wrapper: fetch the turn's message window and compute its diff. */
export async function computeTurnDiffForRuntime(
  runtime: {
    session: {
      get(opts: { sessionID: string }): Promise<any>;
      messages(opts: { sessionID: string; limit?: number }): Promise<{ data: any[] }>;
    };
  },
  sessionID: string,
  messageID: string,
  opts?: { snapshotRoot?: string; git?: GitRunner },
): Promise<FileDiffInfo[]> {
  const session = await runtime.session.get({ sessionID });
  const result = await runtime.session.messages({ sessionID, limit: 200 });
  return computeTurnDiff({
    messages: Array.isArray(result?.data) ? result.data : [],
    messageID,
    projectID: session?.projectID,
    ...opts,
  });
}
