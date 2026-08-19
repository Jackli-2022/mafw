import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { HarmonicUnitFileStore } from '../../../gateway/src/memory/harmonic-file-store';
import { HarmonicIndexManager } from '../../../gateway/src/core/memory/harmonic-index';
import { buildUnitsForQuestion, ingestQuestion, parseLmeDate, SID_MARKER_PREFIX } from '../../../evaluation/longmemeval/src/ingest';
import { LmeQuestion } from '../../../evaluation/longmemeval/src/dataset';
import { recallAtK } from '../../../evaluation/longmemeval/src/metrics';

function syntheticQuestion(): LmeQuestion {
  return {
    question_id: 'q_synth',
    question_type: 'single-session-user',
    question: 'What is the name of my hamster?',
    answer: 'Rex',
    question_date: '2023/06/01 (Thu) 10:00',
    haystack_session_ids: ['s_noise1', 's_evidence', 's_noise2'],
    haystack_dates: [
      '2023/05/01 (Mon) 09:00',
      '2023/05/20 (Sat) 14:30',
      '2023/05/28 (Sun) 18:45',
    ],
    haystack_sessions: [
      [
        { role: 'user', content: 'Help me plan a trip to Paris next spring.' },
        { role: 'assistant', content: 'Sure, I recommend booking flights early.' },
      ],
      [
        { role: 'user', content: 'I just adopted a hamster named Rex and need cage advice.' },
        { role: 'assistant', content: 'A hamster like Rex needs at least 450 square inches of floor space.' },
      ],
      [
        { role: 'user', content: 'What is a good recipe for sourdough bread?' },
        { role: 'assistant', content: 'Mix flour, water, salt and starter, then fold every 30 minutes.' },
      ],
    ],
    answer_session_ids: ['s_evidence'],
  };
}

describe('longmemeval ingest', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lme-ingest-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('parseLmeDate parses the dataset date format', () => {
    expect(parseLmeDate('2023/05/20 (Sat) 02:21')).toBe(new Date('2023-05-20T02:21:00').getTime());
    expect(Number.isNaN(parseLmeDate('garbage'))).toBe(true);
  });

  it('buildUnitsForQuestion: round granularity yields one unit per round with sid markers', () => {
    const { units, sessionOfUnit } = buildUnitsForQuestion(syntheticQuestion());
    expect(units.length).toBe(6); // 3 sessions × 2 rounds
    for (const u of units) {
      expect(u.energy).toBe(0.8); // frozen default
      expect(u.type).toBe('episodic');
      const marker = u.cue_anchors.find(a => a.startsWith(SID_MARKER_PREFIX));
      expect(marker).toBeDefined();
      expect(sessionOfUnit.get(u.id)).toBe(marker!.slice(SID_MARKER_PREFIX.length));
    }
  });

  it('buildUnitsForQuestion: session granularity yields one unit per session', () => {
    const { units } = buildUnitsForQuestion(syntheticQuestion(), { granularity: 'session' });
    expect(units.length).toBe(3);
    expect(units[1].primary_abstraction).toContain('hamster named Rex');
  });

  it('realistic energy decays older sessions relative to question_date', () => {
    const q = syntheticQuestion();
    const { units, sessionOfUnit } = buildUnitsForQuestion(q, { energyMode: 'realistic' });
    const bySid = new Map<string, number>();
    for (const u of units) bySid.set(sessionOfUnit.get(u.id)!, u.energy);

    function expectedEnergy(sessionDate: string): number {
      const ms = parseLmeDate(sessionDate);
      const qms = parseLmeDate(q.question_date);
      const days = Math.max(0, (qms - ms) / (24 * 60 * 60 * 1000));
      return Math.min(1, Math.max(0.05, 0.8 * (1 - 0.005 * days)));
    }

    expect(bySid.get('s_noise1')).toBeCloseTo(expectedEnergy(q.haystack_dates[0]), 3);
    expect(bySid.get('s_evidence')).toBeCloseTo(expectedEnergy(q.haystack_dates[1]), 3);
    expect(bySid.get('s_noise2')).toBeCloseTo(expectedEnergy(q.haystack_dates[2]), 3);
    // monotonic: older < newer
    expect(bySid.get('s_noise1')!).toBeLessThan(bySid.get('s_noise2')!);
  });

  it('end-to-end: ingest into isolated store, search finds the evidence session', async () => {
    const q = syntheticQuestion();
    const store = new HarmonicUnitFileStore(tmpDir);
    const { unitCount, sessionOfUnit } = await ingestQuestion(store, q);
    expect(unitCount).toBe(6);

    const index = new HarmonicIndexManager(tmpDir);
    const results = index.search('hamster named Rex', 3);
    expect(results.length).toBeGreaterThan(0);

    const retrievedSids = results.map(r => sessionOfUnit.get(r.id)!);
    expect(retrievedSids[0]).toBe('s_evidence'); // distinctive query → top-1 hit
    expect(recallAtK(retrievedSids, q.answer_session_ids, 3)).toBe(1);

    // noise sessions must not contain the evidence marker
    expect(fs.existsSync(path.join(tmpDir, 'memory', '.harmonic_index.json'))).toBe(true);
  });
});
