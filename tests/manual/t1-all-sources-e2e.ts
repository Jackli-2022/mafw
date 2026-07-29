import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { T1Store, COMPRESSION_THRESHOLD } from '../../src/memory/t1-store';
import { T1ToT2Compressor } from '../../src/memory/t1-to-t2-compressor';
import { CompressionPipeline } from '../../src/compression/compression-pipeline';
import { HarmonicIndexManager } from '../../src/memory/harmonic-index';
import { ObservationService } from '../../src/memory/observation-service';

async function main() {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mafw-t1-all-'));
  console.log('Working dir:', tmpDir);
  fs.mkdirSync(path.join(tmpDir, 'memory'), { recursive: true });

  const store = new T1Store(tmpDir);
  const pipeline = new CompressionPipeline({ baseDir: tmpDir });
  const index = new HarmonicIndexManager(tmpDir);
  const compressor = new T1ToT2Compressor(store, pipeline, index, tmpDir);
  const service = new ObservationService({ t1Store: store, compressor });

  console.log('=== T1: Capturing 3 data sources ===\n');

  // 1. User input
  for (let i = 0; i < 15; i++) {
    service.captureUserInput('sess-1', `implement JWT authentication with RS256 algorithm and refresh token rotation for production use. Make sure to handle token expiry gracefully`);
  }
  console.log('After 15 user_inputs:', store.getCount());

  // 2. Tool results
  for (let i = 0; i < 20; i++) {
    service.captureToolResult('Bash', `npm test -- --coverage\nPASS src/auth/jwt.test.ts (87.5% coverage)\nPASS src/auth/oauth.test.ts\nTests: 42 passed`, 'npm test', undefined, 1);
    service.captureToolResult('Read', `export function verifyToken(token: string): boolean {\n  try { return jwt.verify(token, RS256_PUBLIC_KEY); } catch { return false; }\n}`, 'src/auth/jwt.ts', undefined, 1);
    service.captureToolResult('Edit', 'File modified: src/auth/jwt.ts', 'replace line 42-58', undefined, 1);
  }
  console.log('After +20 tool_results:', store.getCount());

  // 3. Assistant replies
  for (let i = 0; i < 15; i++) {
    service.captureAssistantReply('sess-1', 'Here is the JWT implementation with RS256:\n\n```typescript\nimport jwt from "jsonwebtoken";\nconst publicKey = fs.readFileSync("rs256.pub");\nexport function verify(token: string) {\n  return jwt.verify(token, publicKey, { algorithms: ["RS256"] });\n}\n```\n\nThis handles expiry and rotation automatically.');
  }
  console.log('After +15 assistant_replies:', store.getCount());

  // Show T1 spiral file
  const tier1Dir = path.join(tmpDir, 'memory', 'tier1', 'default');
  const files = fs.readdirSync(tier1Dir).filter((f: string) => f.endsWith('.jsonl'));
  console.log('\nT1 spiral files:', files);
  const raw = fs.readFileSync(path.join(tier1Dir, files[0]), 'utf-8').trim().split('\n');
  console.log('T1 total lines:', raw.length);

  // Show first line of each source type
  const parsed = raw.map((l: string) => JSON.parse(l));
  const sources = new Set(parsed.map((p: any) => p.source));
  console.log('Source types captured:', [...sources]);
  for (const src of ['user_input', 'tool_result', 'assistant_reply']) {
    const sample = parsed.find((p: any) => p.source === src);
    if (sample) {
      console.log(`\n  ${src} sample:`);
      console.log(`    content: ${sample.content.substring(0, 100)}...`);
      console.log(`    energy: ${sample.energy}`);
    }
  }

  // Verify threshold and trigger compression
  console.log('\n=== Compression trigger ===');
  console.log('Count:', store.getCount(), '/ Threshold:', COMPRESSION_THRESHOLD);
  console.log('shouldCompress:', store.shouldCompress());

  // Wait for async compression
  await new Promise(r => setTimeout(r, 1000));

  const memPath = path.join(tmpDir, 'memory', 'memories.json');
  if (fs.existsSync(memPath)) {
    const memories = JSON.parse(fs.readFileSync(memPath, 'utf-8'));
    console.log('\n=== T2 units in memories.json ===');
    console.log('Total:', memories.length);
    for (const m of memories) {
      console.log(`  ${m.id} | type=${m.type} | level=${m.abstraction_level} | energy=${m.energy} | salience=${m.salience}`);
      console.log(`    abstraction: ${m.primary_abstraction.substring(0, 70)}`);
      if (m.goal_id) console.log(`    goal_id: ${m.goal_id}`);
    }
  }

  const idxPath = path.join(tmpDir, 'memory', '.harmonic_index.json');
  if (fs.existsSync(idxPath)) {
    const idx = JSON.parse(fs.readFileSync(idxPath, 'utf-8'));
    console.log('\n=== Harmonic index ===');
    console.log('Entries:', idx.entries.length);
  }

  console.log('\nT1 count after compression:', store.getCount());
  const remaining = fs.existsSync(tier1Dir) ? fs.readdirSync(tier1Dir).filter((f: string) => f.endsWith('.jsonl')) : [];
  console.log('T1 files remaining:', remaining.length);

  fs.rmSync(tmpDir, { recursive: true, force: true });
  console.log('\nAll sources verified. Cleanup done.');
}

main().catch(err => { console.error(err); process.exit(1); });
