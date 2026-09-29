// Audit H4 hygiene: prune dead vectors (superseded entries + orphans whose
// units are no longer in the harmonic index) from the embedding vector files.
// These pollute cosine candidate recall for consolidation (and any future
// dense path reading the raw store).
//
// Usage:
//   npx ts-node scripts/prune-vectors.ts            # dry-run (default)
//   npx ts-node scripts/prune-vectors.ts --apply    # rewrite files (.bak backup)
//
// Files: ~/.mafw/memory/vectors-*.json — pruned per file; entries removed only
// when (a) id not in index, or (b) index entry has superseded_by set.
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

interface VectorFile {
  [id: string]: number[] | { vector?: number[]; [k: string]: any };
}

function main(): void {
  const apply = process.argv.includes('--apply');
  const memDir = path.join(os.homedir(), '.mafw', 'memory');
  const indexPath = path.join(memDir, '.harmonic_index.json');
  if (!fs.existsSync(indexPath)) {
    console.error(`index not found: ${indexPath}`);
    process.exit(1);
  }
  const index = JSON.parse(fs.readFileSync(indexPath, 'utf-8'));
  const byId = new Map<string, any>(index.entries.map((e: any) => [e.id, e]));

  const files = fs.readdirSync(memDir).filter((f) => f.startsWith('vectors-') && f.endsWith('.json'));
  if (files.length === 0) {
    console.log('no vector files found');
    return;
  }

  for (const f of files) {
    const fp = path.join(memDir, f);
    const raw = JSON.parse(fs.readFileSync(fp, 'utf-8')) as Record<string, any>;
    // Shape: { model?, vectors: { [id]: number[] } } or a bare map.
    const holder = raw.vectors && typeof raw.vectors === 'object' ? raw : null;
    const vecMap: VectorFile = holder ? holder.vectors : raw;
    const ids = Object.keys(vecMap);
    let orphans = 0;
    let superseded = 0;
    const keep: VectorFile = {};
    for (const id of ids) {
      const e = byId.get(id);
      if (!e) { orphans++; continue; }
      if (e.superseded_by) { superseded++; continue; }
      keep[id] = vecMap[id];
    }
    console.log(`${f}: ${ids.length} vectors → keep ${ids.length - orphans - superseded} (drop ${orphans} orphans, ${superseded} superseded)`);
    if (apply && orphans + superseded > 0) {
      const bak = fp + '.bak-' + new Date().toISOString().replace(/[:.]/g, '-');
      fs.copyFileSync(fp, bak);
      if (holder) holder.vectors = keep as any;
      else fs.writeFileSync(fp, JSON.stringify(keep), 'utf-8');
      if (holder) fs.writeFileSync(fp, JSON.stringify(raw), 'utf-8');
      console.log(`  applied (backup: ${path.basename(bak)})`);
    }
  }
  if (!apply) console.log('\n(dry-run — pass --apply to rewrite)');
}

main();
