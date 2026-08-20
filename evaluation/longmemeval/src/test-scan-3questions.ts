/**
 * Test scan on 3 specific questions to see if it can find missing gold sessions.
 */
import * as fs from 'fs';
import * as path from 'path';
import { loadDataset } from './dataset';
import { ingestQuestion } from './ingest';
import { HarmonicUnitFileStore } from '../../../gateway/src/memory/harmonic-file-store';
import { HarmonicIndexManager } from '../../../gateway/src/core/memory/harmonic-index';
import { runScan } from './l1-retrieval';

const TARGET_IDS = ['3c1045c8', '4dfccbf8', '09d032c9'];

async function main() {
  const dataset = loadDataset();
  const questions = dataset.filter(q => TARGET_IDS.includes(q.question_id));
  
  console.log(`Testing ${questions.length} questions with scan enabled\n`);
  
  for (const question of questions) {
    console.log(`=== ${question.question_id} ===`);
    console.log(`Question: ${question.question}`);
    console.log(`Gold sessions: ${question.answer_session_ids.join(', ')}`);
    
    // Ingest
    const tmpDir = fs.mkdtempSync(path.join(require('os').tmpdir(), `scan-test-${question.question_id}-`));
    const store = new HarmonicUnitFileStore(tmpDir);
    await ingestQuestion(store, question, { granularity: 'session', energyMode: 'frozen' });
    
    const index = new HarmonicIndexManager(tmpDir);
    
    // Run scan
    console.log('\nRunning scan...');
    const scanResult = await runScan(
      index,
      question.question,
      'https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions',
      'alibaba-cn',
      'qwen3.7-max'
    );
    
    console.log(`Scan returned ${scanResult.ids.length} IDs:`);
    scanResult.ids.forEach(id => {
      const entry = index.getIndex().entries.find(e => e.id === id);
      // Check lmesid markers in cue_anchors
      const lmesidMarkers = entry?.cue_anchors?.filter((a: string) => a.startsWith('lmesid:')) || [];
      const sessionIds = lmesidMarkers.map((m: string) => m.replace('lmesid:', ''));
      const isGold = question.answer_session_ids.some(sid => sessionIds.includes(sid));
      console.log(`  ${id} ${isGold ? '[GOLD]' : ''}`);
      console.log(`    Session IDs: ${sessionIds.join(', ')}`);
      console.log(`    Content: ${entry?.primary_abstraction?.slice(0, 80)}`);
    });
    
    // Check if gold sessions are in scan results
    const goldInScan = question.answer_session_ids.filter(sid =>
      scanResult.ids.some(id => {
        const entry = index.getIndex().entries.find(e => e.id === id);
        return entry?.cue_anchors?.some((a: string) => a.includes(sid));
      })
    );
    
    console.log(`\nGold sessions in scan: ${goldInScan.length}/${question.answer_session_ids.length}`);
    console.log(`  Found: ${goldInScan.join(', ')}`);
    console.log(`  Missing: ${question.answer_session_ids.filter(s => !goldInScan.includes(s)).join(', ')}`);
    
    // Cleanup
    fs.rmSync(tmpDir, { recursive: true, force: true });
    console.log('\n' + '='.repeat(80) + '\n');
  }
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
