// A4 CLI: offline FOK threshold calibration.
//
// Usage:
//   npx ts-node scripts/fok-calibrate.ts <samples.jsonl>
//     --noMemoryRate 0.2 --lowConfRate 0.6
//   npx ts-node scripts/fok-calibrate.ts --log <fok-samples.jsonl>
//
// samples.jsonl: one {"top1prob": 0.83, "hit": true} per line. Sources:
//   - hit-proxy event log (--log mode): injections joined against
//     mafw_get_memory redemptions within TTL (see recall/fok-samples.ts) —
//     the continuous label-free labeling loop
//   - production FOK logs / LongMemEval abstention seeds (L2 annotation)
// Out-of-fold is mandatory when refitting on data used to pick the current
// thresholds (arXiv:2606.29959).
import * as fs from 'fs';
import * as path from 'path';
import { fitIsotonic, pickThresholds, FokSample } from '../src/recall/fok-calibration';
import { joinFokSamples } from '../src/recall/fok-samples';

function main(): void {
  const args = process.argv.slice(2);
  const logIdx = args.indexOf('--log');

  let samples: FokSample[];
  if (logIdx >= 0) {
    const logFile = args[logIdx + 1];
    if (!logFile) {
      console.error('usage: --log <fok-samples.jsonl> (raw inj/rdm event log)');
      process.exit(1);
    }
    const raw = fs.readFileSync(path.resolve(logFile), 'utf-8').split(/\r?\n/).filter(Boolean);
    samples = joinFokSamples(raw);
    const hits = samples.filter((s) => s.hit).length;
    console.log(`hit-proxy join: ${samples.length} labeled samples (${hits} hits, ${samples.length - hits} misses)`);
  } else {
    const plain = args.find((a) => !a.startsWith('--'));
    if (!plain) {
      console.error('usage: ts-node scripts/fok-calibrate.ts <samples.jsonl> | --log <fok-samples.jsonl> [--noMemoryRate 0.2] [--lowConfRate 0.6]');
      process.exit(1);
    }
    const raw = fs.readFileSync(path.resolve(plain), 'utf-8').split(/\r?\n/).filter(Boolean);
    samples = raw
      .map((line) => { try { return JSON.parse(line); } catch { return null; } })
      .filter((j: any) => Number.isFinite(j?.top1prob))
      .map((j: any) => ({ top1prob: j.top1prob, hit: !!j.hit }));
  }
  if (samples.length === 0) {
    console.error('no valid samples (need {"top1prob": number, "hit": boolean} lines or inj/rdm events)');
    process.exit(1);
  }
  const opt = (name: string, dflt: number): number => {
    const i = args.indexOf(`--${name}`);
    return i >= 0 && args[i + 1] ? Number(args[i + 1]) : dflt;
  };
  const noMemoryRate = opt('noMemoryRate', 0.2);
  const lowConfRate = opt('lowConfRate', 0.6);

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
