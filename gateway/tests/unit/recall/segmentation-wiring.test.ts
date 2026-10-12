import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { TurnPipeline, abAssignment } from '../../../src/recall/turn-pipeline';
import { GatewayDatabase } from '../../../src/memory/gateway-db';
import { HarmonicIndexManager } from '../../../src/core/memory/harmonic-index';

class CapturingWorker {
  prompts: string[] = [];
  async prompt(text: string): Promise<string> { this.prompts.push(text); return '[NOOP: test]'; }
}

describe('V2 ②/③ segmentation shadow + event-segment input', () => {
  let dir: string;
  let db: GatewayDatabase;
  let idx: HarmonicIndexManager;
  let worker: CapturingWorker;
  let shadowPath: string;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mafwseg-'));
    db = new GatewayDatabase(path.join(dir, 't1.db'));
    idx = new HarmonicIndexManager(dir);
    worker = new CapturingWorker();
    shadowPath = path.join(dir, 'segmentation-shadow.jsonl');
    // Two turns on distinct topics (BM25 vs desktop tray).
    db.append({ session_id: 'ses_seg', turn_id: 1, source: 'user_input', content: 'fix the BM25 token cache bug in harmonic index', salience: 0.8 });
    db.append({ session_id: 'ses_seg', turn_id: 1, source: 'assistant_reply', content: 'the BM25 cache now memoizes tokens per entry for speed', salience: 0.8 });
    db.append({ session_id: 'ses_seg', turn_id: 2, source: 'user_input', content: 'switching gears: the desktop tray icon needs a new menu', salience: 0.8 });
    db.append({ session_id: 'ses_seg', turn_id: 2, source: 'assistant_reply', content: 'tray menu should show pending approvals count', salience: 0.8 });
  });
  afterEach(() => { db.close(); fs.rmSync(dir, { recursive: true, force: true }); });

  function mkPipeline(opts: any): TurnPipeline {
    return new TurnPipeline({
      t1db: db, index: idx, workerFor: () => worker as any,
      staleMs: 0, ...opts,
    });
  }

  it('shadow mode logs boundary structure next to the batch', async () => {
    await mkPipeline({ segmentation: 'shadow', shadowLogPath: shadowPath }).runSession('ses_seg');
    const lines = fs.readFileSync(shadowPath, 'utf-8').trim().split('\n').filter(Boolean);
    expect(lines.length).toBe(1);
    const parsed = JSON.parse(lines[0]);
    expect(parsed.sessionID).toBe('ses_seg');
    expect(parsed.batchTurns).toBe(2);
    expect(parsed.segments.length).toBeGreaterThanOrEqual(1);
  });

  it('segmentation off → no shadow log', async () => {
    await mkPipeline({ segmentation: 'off', shadowLogPath: shadowPath }).runSession('ses_seg');
    expect(fs.existsSync(shadowPath)).toBe(false);
  });

  it('eventSegmentInput follows the day-parity assignment', async () => {
    await mkPipeline({ eventSegmentInput: true }).runSession('ses_seg');
    const prompt = worker.prompts[0] ?? '';
    const armOn = abAssignment('ses_seg', Date.now());
    if (armOn) {
      expect(prompt).toContain('Event-segment verbatim');
      expect(prompt).toContain('### Event Segment 1');
    } else {
      expect(prompt).not.toContain('Event-segment verbatim');
    }
  });

  it('eventSegmentInput off → prompt has no segment block', async () => {
    await mkPipeline({ eventSegmentInput: false }).runSession('ses_seg');
    expect(worker.prompts[0] ?? '').not.toContain('Event-segment verbatim');
  });
});

describe('abAssignment (V2 ③ A/B day parity)', () => {
  it('stable per (session, day) and alternates across days', () => {
    const day1 = Date.parse('2026-10-12T00:00:00Z');
    const day2 = Date.parse('2026-10-13T00:00:00Z');
    const a1 = abAssignment('ses_x', day1);
    expect(abAssignment('ses_x', day1)).toBe(a1); // stable within the day
    expect(abAssignment('ses_x', day2)).toBe(!a1); // alternates next day
  });
});
