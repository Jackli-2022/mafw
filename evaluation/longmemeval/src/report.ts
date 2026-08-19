/**
 * LongMemEval report generator.
 *
 * Reads one or more L1 summaries (and matching L2 summaries if present) and
 * emits a markdown report with overall + per-type metrics and comparison
 * notes against the paper's published LLaMA-8B numbers.
 *
 * Usage:
 *   npx ts-node --project evaluation/longmemeval/tsconfig.json \
 *     evaluation/longmemeval/src/report.ts --dir <l1/l2 run dir>
 */

import * as fs from 'fs';
import * as path from 'path';

interface L1Summary {
  timestamp: string;
  config: { samplePerType: number; seed: number; granularity: string; energyMode: string; retriever: string; ks: number[] };
  overall: Record<string, number>;
  by_type: Record<string, { count: number; recall: Record<string, number>; ndcg: Record<string, number> }>;
}

interface L2Summary {
  overall: { count: number; accuracy: number };
  by_type: Record<string, { count: number; accuracy: number }>;
}

const PAPER_BASELINES: Record<string, { retrieval?: string; qaShort: number; qaWithCoN?: number }> = {
  'single-session-user': { qaShort: 0.62, qaWithCoN: 0.66 },
  'single-session-assistant': { qaShort: 0.51, qaWithCoN: 0.56 },
  'single-session-preference': { qaShort: 0.43, qaWithCoN: 0.48 },
  'multi-session': { qaShort: 0.38, qaWithCoN: 0.42 },
  'knowledge-update': { qaShort: 0.50, qaWithCoN: 0.56 },
  'temporal-reasoning': { qaShort: 0.27, qaWithCoN: 0.32 },
  // Abstention is judged separately by the paper; our judge treats them as 0/1
  // against a refusal rubric (we score the _abs questions inside their base type
  // in this report).
};

function readJson<T>(p: string): T | null {
  if (!fs.existsSync(p)) return null;
  return JSON.parse(fs.readFileSync(p, 'utf-8')) as T;
}

function fmt(n: number | undefined, digits = 3): string {
  return n === undefined || Number.isNaN(n) ? '—' : n.toFixed(digits);
}

function renderReport(dirs: string[]): string {
  const lines: string[] = [];
  for (const dir of dirs) {
    const stamp = path.basename(dir);
    lines.push(`## Run: \`${stamp}\` — \`${dir}\``);
    const l1 = readJson<L1Summary>(path.join(dir, 'l1-summary.json'));
    if (l1) {
      lines.push('\n### L1 Retrieval');
      lines.push(`Config: samplePerType=${l1.config.samplePerType} seed=${l1.config.seed} granularity=${l1.config.granularity} energyMode=${l1.config.energyMode} retriever=${l1.config.retriever} ks=${l1.config.ks.join(',')}`);
      lines.push('');
      lines.push('| metric | R@1 | R@3 | R@5 | R@10 | NDCG@10 |');
      lines.push('|---|---|---|---|---|---|');
      lines.push(
        `| overall | ${fmt(l1.overall['recall@1'])} | ${fmt(l1.overall['recall@3'])} | ${fmt(l1.overall['recall@5'])} | ${fmt(l1.overall['recall@10'])} | ${fmt(l1.overall['ndcg@10'])} |`,
      );
      lines.push('');
      lines.push('| type | count | R@1 | R@3 | R@5 | R@10 | NDCG@10 |');
      lines.push('|---|---|---|---|---|---|---|');
      for (const [type, m] of Object.entries(l1.by_type)) {
        lines.push(`| ${type} | ${m.count} | ${fmt(m.recall['1'])} | ${fmt(m.recall['3'])} | ${fmt(m.recall['5'])} | ${fmt(m.recall['10'])} | ${fmt(m.ndcg['10'])} |`);
      }
    }
    const l2 = readJson<L2Summary>(path.join(dir, 'l2-summary.json'));
    if (l2) {
      lines.push('\n### L2 QA Accuracy');
      lines.push(`Overall: N=${l2.overall.count}  accuracy=${fmt(l2.overall.accuracy)}`);
      lines.push('');
      lines.push('| type | N | our acc | paper LLaMA-8B (oracle context) |');
      lines.push('|---|---|---|---|');
      const types = Object.keys(l2.by_type).sort();
      for (const t of types) {
        const ours = l2.by_type[t].accuracy;
        const baseline = PAPER_BASELINES[t]?.qaShort;
        lines.push(`| ${t} | ${l2.by_type[t].count} | ${fmt(ours)} | ${baseline !== undefined ? fmt(baseline) : '—'} |`);
      }
      lines.push('');
      lines.push('> Paper baseline (arXiv:2410.10813 Table 1, LLaMA-3.1 8B Instruct, `Oracle` column = model answers from gold evidence sessions only — an upper bound, not a comparable retriever setting). MAFW L2 includes retrieval errors on top of reader errors, so direct equality is not expected.');
    }
    lines.push('');
  }
  return lines.join('\n');
}

function parseArgs() {
  const args = process.argv.slice(2);
  const flags = new Map<string, string>();
  let positional: string[] = [];
  for (const a of args) {
    if (a.startsWith('--')) continue;
    positional.push(a);
  }
  return { dirs: positional.filter(d => fs.existsSync(d) && fs.statSync(d).isDirectory()) };
}

if (require.main === module) {
  const { dirs } = parseArgs();
  if (dirs.length === 0) {
    // Default: all runs under results/
    const resultsRoot = path.join(__dirname, '..', 'results');
    if (fs.existsSync(resultsRoot)) {
      for (const name of fs.readdirSync(resultsRoot)) {
        const full = path.join(resultsRoot, name);
        if (fs.statSync(full).isDirectory()) dirs.push(full);
      }
    }
  }
  if (dirs.length === 0) {
    console.error('No run directories found; pass --dir results/<ts>');
    process.exit(1);
  }
  const md = renderReport(dirs.sort());
  const outPath = path.join(dirs[0], '..', 'report.md');
  fs.writeFileSync(outPath, md, 'utf-8');
  console.log(md);
  console.log(`\nSaved: ${outPath}`);
}
