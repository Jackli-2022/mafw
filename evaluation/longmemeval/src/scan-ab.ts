/**
 * Step 4 index-slimming A/B: scan quality (gold-session recall) vs prompt size.
 *
 * Arms (same model, temperature 0, same questions, isolated ingests):
 *   A control  — current formatEntryForIndex (full abstraction, 5 anchors)
 *   B slim-60  — absCap 60,  2 anchors (~67% chars)
 *   C slim-40  — absCap 40,  1 anchor  (~55% chars)
 *
 * Usage:
 *   npx ts-node --project evaluation/longmemeval/tsconfig.json \
 *     evaluation/longmemeval/src/scan-ab.ts --sample 24 [--model qwen3.7-max] [--provider alibaba-cn]
 */
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { loadDataset } from './dataset';
import { ingestQuestion } from './ingest';
import { HarmonicUnitFileStore } from '../../../gateway/src/memory/harmonic-file-store';
import { HarmonicIndexManager } from '../../../gateway/src/core/memory/harmonic-index';
import { formatEntryForIndex } from '../../../gateway/src/recall/index-scan';

const CHAT_URL = 'https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions';

const SCAN_SYSTEM = `You are a memory retrieval system. Given a memory index and a user query, identify the most relevant memory entries.

The index lists memories in this format:
- [id:<short_id>] (<date>) <type> | <summary> | anchors: <keywords>

Return ONLY valid JSON (no markdown):
{"relevant_ids": ["<short_id>", ...], "reasoning": "<one sentence>", "confidence": <0.0-1.0>}

Rules:
- You MUST return 5-8 entry IDs. If the index has entries at all, return at least 5.
- Return MORE entries rather than fewer — false negatives are worse than false positives
- Rank them by relevance (most relevant first)
- Consider semantic relevance, not just keyword matching — look for topic overlap, related concepts, paraphrases
- For preference queries (what does the user like/dislike), prioritize entries with "preference" type or "pref:" anchors
- For temporal queries (when/what happened), prioritize entries with matching dates
- For multi-session queries (what did we discuss about X), look for entries sharing topic anchors
- If answering the question requires combining information from multiple memories, include ALL relevant entries
- confidence = how sure you are that the selected entries answer the query (0.0 = guess, 1.0 = certain)
- If nothing is relevant, return {"relevant_ids": [], "reasoning": "no relevant memories", "confidence": 0.0}`;

const ARMS = [
  // Production-morphology control: the gateway write path already caps
  // abstraction at 200 chars (p99=200 in the live index) — this arm mirrors
  // what production scan actually sees, not the raw full-text haystack.
  { name: 'A-prod200', opts: { absCap: 200, anchorCap: 5 } as { absCap: number; anchorCap: number } },
  { name: 'B-slim60', opts: { absCap: 60, anchorCap: 2 } },
  { name: 'C-slim40', opts: { absCap: 40, anchorCap: 1 } },
];

function parseArgs() {
  const args = process.argv.slice(2);
  const flags = new Map<string, string>();
  for (let i = 0; i < args.length; i += 2) {
    if (args[i]?.startsWith('--')) flags.set(args[i], args[i + 1]);
  }
  return {
    sample: parseInt(flags.get('--sample') || '24', 10),
    model: flags.get('--model') || 'qwen3.7-max',
    provider: flags.get('--provider') || 'alibaba-cn',
  };
}

async function chatScan(
  indexText: string,
  query: string,
  apiKey: string,
  model: string,
): Promise<{ ids: string[]; parseFail: boolean } | null> {
  const prompt = `${indexText}\n\n---\n\nUser query: ${query}\n\nSelect the most relevant memory entries from the index above.`;
  try {
    const resp = await fetch(CHAT_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model,
        messages: [
          { role: 'system', content: SCAN_SYSTEM },
          { role: 'user', content: prompt },
        ],
        temperature: 0,
        max_tokens: 4096,
      }),
    });
    if (!resp.ok) {
      console.error(`    [scan] HTTP ${resp.status}`);
      return null;
    }
    const json: any = await resp.json();
    const msg = json?.choices?.[0]?.message;
    let content = typeof msg?.content === 'string' ? msg.content : '';
    if (!content.trim() && typeof msg?.reasoning_content === 'string') content = msg.reasoning_content;
    const cleaned = content.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '').trim();
    let parsed: any;
    try {
      parsed = JSON.parse(cleaned);
    } catch {
      return { ids: [], parseFail: true };
    }
    if (!Array.isArray(parsed?.relevant_ids)) return { ids: [], parseFail: true };
    return { ids: parsed.relevant_ids.filter((x: any) => typeof x === 'string').slice(0, 10), parseFail: false };
  } catch (err: any) {
    console.error(`    [scan] ${err.message}`);
    return null;
  }
}

async function main() {
  const { sample, model, provider } = parseArgs();
  const apiKey = loadKey(provider);
  if (!apiKey) {
    console.error(`no API key for provider "${provider}" in opencode auth.json`);
    process.exit(1);
  }
  const dataset = loadDataset() as any[];
  // deterministic spread across the dataset ordering (covers all 6 question types)
  const step = Math.max(1, Math.floor(dataset.length / sample));
  const questions = dataset.filter((_, i) => i % step === 0).slice(0, sample);

  console.log(`scan-ab: ${questions.length} questions × ${ARMS.length} arms, model=${model}\n`);

  const totals: Record<string, { goldHit: number; goldTotal: number; chars: number; scans: number; parseFail: number }> = {};
  for (const arm of ARMS) totals[arm.name] = { goldHit: 0, goldTotal: 0, chars: 0, scans: 0, parseFail: 0 };
  const perQuestion: any[] = [];

  for (const q of questions) {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'scan-ab-'));
    try {
      const store = new HarmonicUnitFileStore(tmpDir);
      await ingestQuestion(store, q, { granularity: 'session', energyMode: 'frozen' });
      const index = new HarmonicIndexManager(tmpDir);
      const entries = index.getIndex().entries.filter((e: any) => !e.superseded_by);

      const record: any = { qid: q.question_id, type: (q as any).question_type || '?', arms: {} };
      const parts: string[] = [];
      for (const arm of ARMS) {
        const lines = entries.map((e: any) => formatEntryForIndex(e, arm.opts));
        const indexText = `# Memory Index\n\n${lines.join('\n')}`;
        const res = await chatScan(indexText, q.question, apiKey, model);
        const t = totals[arm.name];
        t.chars += indexText.length;
        t.scans++;
        let recall = 0;
        if (!res) {
          t.parseFail++;
        } else {
          if (res.parseFail) t.parseFail++;
          const hitSessions = new Set<string>();
          for (const sid of res.ids) {
            const entry = entries.find((e: any) => e.id.endsWith(sid));
            if (!entry) continue;
            for (const a of entry.cue_anchors || []) {
              if (typeof a === 'string' && a.startsWith('lmesid:')) hitSessions.add(a.slice(7));
            }
          }
          const gold: string[] = q.answer_session_ids;
          const hits = gold.filter((s: string) => hitSessions.has(s)).length;
          t.goldHit += hits;
          t.goldTotal += gold.length;
          recall = gold.length ? hits / gold.length : 0;
        }
        record.arms[arm.name] = { recall, chars: indexText.length, ids: res?.ids.length ?? -1 };
        parts.push(`${arm.name}=${recall.toFixed(2)}`);
      }
      perQuestion.push(record);
      console.log(`${q.question_id} (${record.type})  ${parts.join('  ')}`);
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  }

  console.log('\n===== SUMMARY =====');
  for (const arm of ARMS) {
    const t = totals[arm.name];
    const recall = t.goldTotal ? (100 * t.goldHit / t.goldTotal).toFixed(1) : '-';
    const avgChars = t.scans ? Math.round(t.chars / t.scans) : 0;
    console.log(`${arm.name.padEnd(10)} session-recall=${recall}%  avgChars=${avgChars} (~${Math.round(avgChars / 2.5)} tok)  scans=${t.scans} parseFail=${t.parseFail}`);
  }

  const out = { generatedAt: new Date().toISOString(), model, provider, sample: questions.length, totals, perQuestion };
  const outFile = path.join(__dirname, '..', 'results', `scan-ab-${Date.now()}.json`);
  fs.writeFileSync(outFile, JSON.stringify(out, null, 2));
  console.log(`\nsaved: ${outFile}`);
}

function loadKey(provider: string): string | null {
  try {
    const authPath = path.join(os.homedir(), '.local', 'share', 'opencode', 'auth.json');
    const auth = JSON.parse(fs.readFileSync(authPath, 'utf-8'));
    return auth?.[provider]?.key || auth?.[provider]?.access || null;
  } catch {
    return null;
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
