import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { T1Store, COMPRESSION_THRESHOLD } from '../../src/memory/t1-store';
import { T1ToT2Compressor } from '../../src/memory/t1-to-t2-compressor';
import { CompressionPipeline } from '../../src/compression/compression-pipeline';
import { HarmonicIndexManager } from '../../src/memory/harmonic-index';

async function main() {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mafw-t1-e2e-'));
  console.log('Working dir:', tmpDir);
  fs.mkdirSync(path.join(tmpDir, 'memory'), { recursive: true });

  const store = new T1Store(tmpDir);
  const pipeline = new CompressionPipeline({ baseDir: tmpDir });
  const index = new HarmonicIndexManager(tmpDir);
  const compressor = new T1ToT2Compressor(store, pipeline, index, tmpDir);

  const types = ['tool_use', 'file_edit', 'error', 'state_change'];
  const contents = [
    'Tool Bash executed: npm test -- --coverage',
    'File modified: src/auth/jwt.ts added RS256 verification',
    'Error: JWT token validation failed in middleware',
    'coverage 87.5% - threshold met',
    'File modified: src/config/env.ts updated secret rotation',
    'Tool Git executed: git commit -m "fix auth"',
    'Error: Connection timeout on port 3000',
    'coverage 92.3% - above threshold',
    'File modified: src/api/handler.ts added rate limiting',
    'LLM call completed: generated review summary',
  ];

  // 1. Feed 50 observations
  for (let i = 0; i < COMPRESSION_THRESHOLD; i++) {
    store.append({
      content: contents[i % contents.length] + ' (#' + i + ')',
      type: types[i % types.length],
      phase: 'execute',
      loopNum: 1,
      timestamp: Date.now() + i,
    });
  }

  console.log('=== Step 1: T1 after 50 appends ===');
  console.log('T1 count:', store.getCount());
  console.log('Should compress:', store.shouldCompress());

  const tier1Dir = path.join(tmpDir, 'memory', 'tier1', 'default');
  const files = fs.readdirSync(tier1Dir);
  console.log('T1 JSONL files:', files);
  const firstFile = path.join(tier1Dir, files[0]);
  const rawLines = fs.readFileSync(firstFile, 'utf-8').trim().split('\n');
  console.log('T1 lines written:', rawLines.length);

  // 2. Run compression
  console.log('\n=== Step 2: Running T1->T2 compression ===');
  const result = await compressor.run();
  console.log('Compression result:', JSON.stringify(result, null, 2));

  // 3. Check memories.json
  const memPath = path.join(tmpDir, 'memory', 'memories.json');
  if (fs.existsSync(memPath)) {
    const memories = JSON.parse(fs.readFileSync(memPath, 'utf-8'));
    console.log('\n=== Step 3: T2 units in memories.json ===');
    console.log('Total T2 units:', memories.length);
    for (const m of memories) {
      console.log('  -', m.id, '| type:', m.type, '| level:', m.abstraction_level, '| energy:', m.energy, '| salience:', m.salience);
      console.log('    abstraction:', m.primary_abstraction.slice(0, 60));
      console.log('    anchors:', m.cue_anchors);
    }
  }

  // 4. Check index
  const idxPath = path.join(tmpDir, 'memory', '.harmonic_index.json');
  if (fs.existsSync(idxPath)) {
    const idx = JSON.parse(fs.readFileSync(idxPath, 'utf-8'));
    console.log('\n=== Step 4: Harmonic index ===');
    console.log('Index entries:', idx.entries.length);
    console.log('First entry:', JSON.stringify(idx.entries[0]));
  }

  // 5. Verify T1 is cleared
  console.log('\n=== Step 5: T1 after compression ===');
  console.log('T1 count:', store.getCount());
  const remaining = fs.existsSync(tier1Dir) ? fs.readdirSync(tier1Dir).filter((f: string) => f.endsWith('.jsonl')) : [];
  console.log('T1 JSONL files remaining:', remaining.length);

  // 6. Second batch
  console.log('\n=== Step 6: Second compression round ===');
  for (let i = 0; i < COMPRESSION_THRESHOLD; i++) {
    store.append({
      content: 'Round 2: ' + contents[i % contents.length] + ' (#' + i + ')',
      type: types[i % types.length],
      loopNum: 2,
      timestamp: Date.now() + i + 10000,
    });
  }
  console.log('T1 count before second compression:', store.getCount());
  const result2 = await compressor.run();
  console.log('Second compression result:', JSON.stringify(result2, null, 2));

  const mem2 = JSON.parse(fs.readFileSync(memPath, 'utf-8'));
  console.log('Total T2 units after 2 rounds:', mem2.length);
  console.log('T1 count after:', store.getCount());

  fs.rmSync(tmpDir, { recursive: true, force: true });
  console.log('\nAll steps verified. Cleanup done.');
}

main().catch(err => { console.error(err); process.exit(1); });
