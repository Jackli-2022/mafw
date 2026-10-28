import { createHash } from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import type { DiscoveryInstruction, DiscoveryWarning } from './types';

export interface AgentsDiscoveryFs {
  existsSync(p: string): boolean;
  statSync(p: string): { size: number; mtime: Date };
  realpathSync(p: string): string;
}

export interface AgentsDiscoveryOptions {
  homeDir: string;
  globalConfigDir: string;
  fs?: AgentsDiscoveryFs;
}

function comparable(p: string): string {
  const r = path.resolve(p);
  return process.platform === 'win32' ? r.toLowerCase() : r;
}

function isUnder(child: string, parent: string): boolean {
  const c = comparable(child);
  const p = comparable(parent);
  return c === p || c.startsWith(p.endsWith(path.sep) ? p : p + path.sep);
}

function idOf(real: string): string {
  return createHash('sha1').update(real).digest('hex').slice(0, 12);
}

/**
 * Discover AGENTS.md sources, metadata only. Mirrors opencode v2 boundaries:
 * - inside home: walk to home inclusive, ignoring .git as a stop;
 * - outside home: walk to the nearest .git (file or directory), else only start;
 * - global file is always first;
 * - contents are never read.
 */
export function discoverAgentsFiles(
  directory: string,
  opts: AgentsDiscoveryOptions,
): { instructions: DiscoveryInstruction[]; warnings: DiscoveryWarning[] } {
  const f = opts.fs ?? fs;
  const start = path.resolve(directory);
  const home = path.resolve(opts.homeDir);
  const globalDir = path.resolve(opts.globalConfigDir);
  const insideHome = isUnder(start, home);
  const warnings: DiscoveryWarning[] = [];
  const instructions: DiscoveryInstruction[] = [];
  const seen = new Set<string>();

  const push = (file: string, scope: DiscoveryInstruction['scope']) => {
    try {
      const stat = f.statSync(file);
      const real = f.realpathSync(file);
      if (seen.has(comparable(real))) return;
      seen.add(comparable(real));
      instructions.push({
        id: idOf(real),
        path: real,
        scope,
        kind: 'agents-md',
        bytes: stat.size,
        mtime: stat.mtime.toISOString(),
      });
    } catch (err: any) {
      warnings.push({
        source: 'instructions',
        message: `${file}: ${String(err?.message ?? err).slice(0, 300)}`,
      });
    }
  };

  const globalFile = path.join(globalDir, 'AGENTS.md');
  if (f.existsSync(globalFile)) push(globalFile, 'global');

  const chain: string[] = [];
  let cur = start;
  let gitRoot: string | null = null;
  while (true) {
    chain.push(cur);
    if (f.existsSync(path.join(cur, '.git'))) {
      if (!gitRoot) gitRoot = cur; // nearest .git wins for the project scope label
      if (!insideHome) break;
    }
    if (insideHome && comparable(cur) === comparable(home)) break;
    const parent = path.dirname(cur);
    if (parent === cur) break;
    cur = parent;
  }

  if (!insideHome && !gitRoot) {
    chain.length = 0;
    chain.push(start);
  }

  const top = chain[chain.length - 1];
  for (const dir of chain) {
    const file = path.join(dir, 'AGENTS.md');
    if (!f.existsSync(file)) continue;
    const scope: DiscoveryInstruction['scope'] =
      gitRoot && comparable(dir) === comparable(gitRoot)
        ? 'project'
        : !gitRoot && comparable(dir) === comparable(top)
          ? 'project'
          : 'nested';
    push(file, scope);
  }

  return { instructions, warnings };
}
