import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { loadDataset } from './dataset';
import { ingestQuestion } from './ingest';
import { HarmonicUnitFileStore } from '../../../gateway/src/memory/harmonic-file-store';
import { HarmonicIndexManager } from '../../../gateway/src/core/memory/harmonic-index';
import { formatEntryForIndex } from '../../../gateway/src/recall/index-scan';

async function main() {
  const dataset = loadDataset() as any[];
  const q = dataset.find(x => x.question_id === 'e47becba');
  console.log('gold:', q.answer_session_ids);
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'scan-dbg-'));
  const store = new HarmonicUnitFileStore(tmpDir);
  await ingestQuestion(store, q, { granularity: 'session', energyMode: 'frozen' });
  const index = new HarmonicIndexManager(tmpDir);
  const entries = index.getIndex().entries.filter((e: any) => !e.superseded_by);
  console.log('entries:', entries.length);
  // gold-marked entries?
  const goldMarked = entries.filter((e: any) => (e.cue_anchors || []).some((a: string) => q.answer_session_ids.some((s: string) => a.includes(s))));
  console.log('entries whose anchors mention gold sessions:', goldMarked.length);
  // show anchor formats
  const withLmesid = entries.filter((e: any) => (e.cue_anchors || []).some((a: string) => a.startsWith('lmesid:')));
  console.log('entries with lmesid: prefixed anchors:', withLmesid.length);
  const sample = entries[0];
  console.log('sample id:', sample.id);
  console.log('sample anchors:', JSON.stringify((sample.cue_anchors || []).slice(0, 6)));
  const goldSample = (goldMarked[0] || withLmesid[0] || sample);
  console.log('sample2 anchors:', JSON.stringify((goldSample.cue_anchors || []).slice(0, 8)));
  // short-id prefix length used by formatEntryForIndex = 12; do ids collide?
  const prefixes = new Set(entries.map((e: any) => e.id.slice(0, 12)));
  console.log('unique 12-char prefixes:', prefixes.size, '/', entries.length);
  fs.rmSync(tmpDir, { recursive: true, force: true });
}
main().catch(e => { console.error(e); process.exit(1); });
