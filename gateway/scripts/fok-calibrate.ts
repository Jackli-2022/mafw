// A4 CLI: offline FOK threshold calibration.
//
// Usage:
//   npx ts-node scripts/fok-calibrate.ts <samples.jsonl>
//     --noMemoryRate 0.2 --lowConfRate 0.6
//
// samples.jsonl: one {"top1prob": 0.83, "hit": true} per line. Sources:
//   - production FOK logs ([Recall] decision lines carry zone + top1prob;
//     `hit` labeling comes from downstream usefulness / L2 annotation)
//   - LongMemEval L1/L2 run products (probe-fok style, _abs abstention seeds)
// Out-of-fold is mandatory when refitting on data used to pick the current
// thresholds (arXiv:2606.29959).
import * as fs from 'fs';
import * as path from 'path';
import { fitIsotonic, pickThresholds, FokSample } from '../src/recall/fok-calibration';

function main(): void {
  const args = process.argv.slice(2);
  const file = args.find((a) => !a.startsWith('--'));
  if (!file) {
    console.error('usage: ts-node scripts/fok-calibrate.ts <samples.jsonl> [--noMemoryRate 0.2] [--lowConfRate 0.6]');
    process.exit(1);
  }
  const opt = (name: string, dflt: number): number => {
    const i = args.indexOf(`--${name}`);
    return i >= 0 && args[i + 1] ? Number(args[i + 1]) : dflt;
  };
  const noMemoryRate = opt('noMemoryRate', 0.2);
  const lowConfRate = opt('lowConfRate', 0.6);

  const raw = fs.readFileSync(path.resolve(file), 'utf-8').split(/\r?\n/).filter(Boolean);
  const samples: FokSample[] = [];
  for (const line of raw) {
    try {
      const j = JSON.parse(line);
      if (Number.isFinite(j?.top1prob)) samples.push({ top1prob: j.top1prob, hit: !!j.hit });
    } catch { /* skip malformed line */ }
  }
  if (samples.length === 0) {
    console.error('no valid samples (need {"top1prob": number, "hit": boolean} lines)');
    process.exit(1);
  }

  const { fit, ece, n } = fitIsotonic(samples);
  console.log(`samples=${n}  ECE(10-bin)=${ece.toFixed(3)}`);
  console.log('\nP(hit | top1prob) isotonic curve:');
  for (let p = 0.05; p <= 1.0001; p += 0.05) {
    const bar = '#'.repeat(Math.round(fit(p) * 40));
    console.log(`  ${p.toFixed(2)}  ${fit(p).toFixed(3)}  ${bar}`);
  }

  const { probLow, probHigh } = pickThresholds(fit, { noMemoryRate, lowConfRate });
  console.log(`\nrecommended (noMemoryRate=${noMemoryRate}, lowConfRate=${lowConfRate}):`);
  console.log('search:\n  fok:\n    enabled: true');
  console.log(`    probLow: ${probLow}   # below: declare "no reliable memory"`);
  console.log(`    probHigh: ${probHigh}  # above: inject normally; between: low-confidence wrap`);
  console.log('\nnote: refit out-of-fold; per-type (Mondrian) thresholds need >=300 labeled samples per group (arXiv:2608.19376).');
}

main();
