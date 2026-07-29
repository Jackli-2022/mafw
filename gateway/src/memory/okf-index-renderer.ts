import * as fs from 'fs';
import * as path from 'path';
import type { HarmonicIndexManager } from '../core/memory/harmonic-index.js';

export function renderIndexMd(baseDir: string, indexManager: HarmonicIndexManager): void {
  const index = indexManager.getIndex();
  const lines: string[] = ['# Memory Index', '', '> Auto-generated from `.harmonic_index.json`', ''];

  const byTier = new Map<string, typeof index.entries>();
  for (const entry of index.entries) {
    const tier = entry.tier || 'unknown';
    if (!byTier.has(tier)) byTier.set(tier, []);
    byTier.get(tier)!.push(entry);
  }

  for (const [tier, entries] of byTier) {
    lines.push(`## ${tier}`, '');
    for (const e of entries) {
      const pathStr = (e as any).filePath || '';
      lines.push(`- **${e.primary_abstraction}** (energy: ${e.energy}) â€?\`${pathStr}\``);
    }
    lines.push('');
  }

  const memDir = path.join(baseDir, 'memory');
  if (!fs.existsSync(memDir)) fs.mkdirSync(memDir, { recursive: true });
  fs.writeFileSync(path.join(memDir, 'index.md'), lines.join('\n'), 'utf-8');
}
