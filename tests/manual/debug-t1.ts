import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { T1Store } from '../../src/memory/t1-store';
import { T1ToT2Compressor } from '../../src/memory/t1-to-t2-compressor';
import { CompressionPipeline } from '../../src/compression/compression-pipeline';
import { HarmonicIndexManager } from '../../src/memory/harmonic-index';
import { ObservationService } from '../../src/memory/observation-service';

async function main() {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'debug-t1-'));
  console.log('DEBUG dir:', tmpDir);
  fs.mkdirSync(path.join(tmpDir, 'memory'), { recursive: true });

  const store = new T1Store(tmpDir);
  const pipeline = new CompressionPipeline({ baseDir: tmpDir });
  const index = new HarmonicIndexManager(tmpDir);
  const compressor = new T1ToT2Compressor(store, pipeline, index, tmpDir);
  const service = new ObservationService({ t1Store: store, compressor });

  for (let i = 0; i < 3; i++) {
    service.captureUserInput('sess-1', 'prompt ' + i);
    service.captureToolResult('sess-1', 'Bash', 'output ' + i);
    service.captureAssistantReply('sess-1', 'reply ' + i);
  }
  console.log('T1 count:', store.getCount());
  console.log('Has session:', store.hasSession('sess-1'));

  const all = store.readBySession('sess-1');
  console.log('T1 observations:', all.length);
  if (all.length > 0) console.log('First:', JSON.stringify(all[0]));

  const result = await compressor.compressSession('sess-1');
  console.log('Compress result:', JSON.stringify(result));

  const memPath = path.join(tmpDir, 'memory', 'memories.json');
  console.log('memories.json exists:', fs.existsSync(memPath));
  if (fs.existsSync(memPath)) {
    const memories = JSON.parse(fs.readFileSync(memPath, 'utf-8'));
    console.log('Memories:', memories.length);
    if (memories.length > 0) console.log('First memory:', JSON.stringify(memories[0]));
  }

  console.log('T1 after clear, hasSession:', store.hasSession('sess-1'));

  fs.rmSync(tmpDir, { recursive: true, force: true });
  console.log('DONE');
}
main().catch(e => { console.error(e); process.exit(1); });
