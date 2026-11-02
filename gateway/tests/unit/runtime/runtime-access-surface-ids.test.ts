import * as fs from 'fs';
import * as path from 'path';
import { buildRuntimeContractManifest } from '../../../src/runtime/contract-manifest';

const ROOT = path.resolve(process.cwd(), 'src');
const SURFACES = new Set(buildRuntimeContractManifest().surfaces.map((s) => s.id));

function walk(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return walk(full);
    return entry.name.endsWith('.ts') ? [full] : [];
  });
}

function surfaceIdsIn(file: string): string[] {
  const text = fs.readFileSync(file, 'utf8');
  const ids: string[] = [];
  const patterns = [
    /capGuard\(res,\s*['"]([^'"]+)['"]\)/g,
    /access(?:\?)?\.can\(['"]([^'"]+)['"]\)/g,
    /requireSurface\(['"]([^'"]+)['"]\)/g,
  ];
  for (const re of patterns) {
    for (const match of text.matchAll(re)) ids.push(match[1]);
  }
  return ids;
}

describe('runtime surface ids in source', () => {
  it('every hard-coded surface id exists in the manifest', () => {
    const found = walk(ROOT).flatMap((file) =>
      surfaceIdsIn(file).filter((id) => !SURFACES.has(id)).map((id) => `${path.relative(ROOT, file)}: ${id}`),
    );
    expect(found).toEqual([]);
  });
});
