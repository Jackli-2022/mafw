// Usage: npx ts-node scripts/calibrate-laya.ts [pairsJsonlPath]
// Default: ~/.mafw/logs/consolidation-pairs.jsonl
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { bucketDistribution, proposeTauLow, proposeTauRedundantHigh, LayaPairRecord } from '../src/memory/laya-calibrate';

const file = process.argv[2] ?? path.join(os.homedir(), '.mafw', 'logs', 'consolidation-pairs.jsonl');
if (!fs.existsSync(file)) {
  console.log(JSON.stringify({ error: `not found: ${file}` }));
  process.exit(1);
}
const records: LayaPairRecord[] = fs.readFileSync(file, 'utf-8')
  .split('\n').filter(Boolean)
  .map((line) => { try { return JSON.parse(line); } catch { return null; } })
  .filter(Boolean);
console.log(JSON.stringify({
  file,
  conflict: { ...bucketDistribution(records), ...proposeTauLow(records) },
  redundant: proposeTauRedundantHigh(records as any),
}, null, 2));
