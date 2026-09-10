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
- Return MORE entries rather than fewer — false negatives are worse than false positives`;

function loadKey(provider: string): string | null {
  try {
    const auth = JSON.parse(fs.readFileSync(path.join(os.homedir(), '.local', 'share', 'opencode', 'auth.json'), 'utf-8'));
    return auth?.[provider]?.key || auth?.[provider]?.access || null;
  } catch { return null; }
}

async function main() {
  const dataset = loadDataset() as any[];
  const q = dataset.find(x => x.question_id === 'e47becba');
  const apiKey = loadKey('alibaba-cn');
  console.log('gold:', q.answer_session_ids);
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'scan-dbg2-'));
  const store = new HarmonicUnitFileStore(tmpDir);
  await ingestQuestion(store, q, { granularity: 'session', energyMode: 'frozen' });
  const index = new HarmonicIndexManager(tmpDir);
  const entries = index.getIndex().entries.filter((e: any) => !e.superseded_by);
  console.log('entries:', entries.length);

  for (const [label, opts] of [['A', undefined], ['C', { absCap: 40, anchorCap: 1 }]] as any[]) {
    const lines = entries.map((e: any) => formatEntryForIndex(e, opts));
    const indexText = `# Memory Index\n\n${lines.join('\n')}`;
    const resp = await fetch(CHAT_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model: 'qwen3.7-max',
        messages: [
          { role: 'system', content: SCAN_SYSTEM },
          { role: 'user', content: `${indexText}\n\n---\n\nUser query: ${q.question}\n\nSelect the most relevant memory entries from the index above.` },
        ],
        temperature: 0,
        max_tokens: 4096,
      }),
    });
    const json: any = await resp.json();
    const msg = json?.choices?.[0]?.message;
    let content = typeof msg?.content === 'string' ? msg.content : '';
    if (!content.trim() && typeof msg?.reasoning_content === 'string') content = msg.reasoning_content;
    const cleaned = content.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '').trim();
    console.log(`\n=== arm ${label} (${indexText.length} chars) finish=${json?.choices?.[0]?.finish_reason} ===`);
    let parsed: any;
    try { parsed = JSON.parse(cleaned); } catch { console.log('PARSE FAIL:', cleaned.slice(0, 200)); continue; }
    console.log('raw ids:', JSON.stringify(parsed.relevant_ids));
    const resolved: string[] = [];
    const hitSessions = new Set<string>();
    for (const sid of parsed.relevant_ids || []) {
      const entry = entries.find((e: any) => e.id.endsWith(String(sid)));
      if (!entry) { console.log(`  unresolved: ${sid}`); continue; }
      resolved.push(entry.id);
      for (const a of entry.cue_anchors || []) {
        if (typeof a === 'string' && a.startsWith('lmesid:')) hitSessions.add(a.slice(7));
      }
    }
    console.log(`resolved=${resolved.length}/${(parsed.relevant_ids || []).length}`);
    console.log('hit sessions:', JSON.stringify([...hitSessions]));
    console.log('gold:', JSON.stringify(q.answer_session_ids));
  }
  fs.rmSync(tmpDir, { recursive: true, force: true });
}
main().catch(e => { console.error(e); process.exit(1); });
