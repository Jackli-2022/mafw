/**
 * Ingest LongMemEval haystacks into an isolated HarmonicUnitFileStore.
 *
 * Benchmark adapter semantics (documented divergence from production):
 * - Production memories are agent-curated 6-8 word abstractions; here we
 *   deterministically ingest every haystack round/session with its FULL text
 *   in primary_abstraction, because HarmonicIndexManager.search() only scans
 *   primary_abstraction + cue_anchors (memory_value is invisible to search).
 *   L1 therefore measures the retriever's ranking quality given indexed
 *   content — not the agent's write decisions (that is L3's concern).
 * - energy is FROZEN (default 0.8) for reproducibility; 'realistic' mode
 *   applies the same 0.005/day decay but relative to question_date (not wall
 *   clock), so runs are deterministic.
 * - Each unit carries an `lmesid:<session_id>` cue anchor so retrieved entries
 *   map back to answer_session_ids for Recall@k/NDCG@k. The marker cannot
 *   collide with natural question tokens.
 */

import { HarmonicUnit, generateHarmonicId } from '../../../gateway/src/core/memory/harmonic-types';
import { HarmonicUnitFileStore } from '../../../gateway/src/memory/harmonic-file-store';
import { LmeQuestion } from './dataset';

export interface IngestOptions {
  granularity?: 'round' | 'session';
  energyMode?: 'frozen' | 'realistic';
  frozenEnergy?: number;
}

export const SID_MARKER_PREFIX = 'lmesid:';
const DECAY_PER_DAY = 0.005; // mirrors gateway energy-system decayRatePerDay
const MIN_REALISTIC_ENERGY = 0.05;

/** Parse '2023/05/20 (Sat) 02:21' → ms epoch. Returns NaN on failure. */
export function parseLmeDate(dateStr: string): number {
  const m = dateStr.match(/^(\d{4})\/(\d{2})\/(\d{2})\s+\(\w+\)\s+(\d{2}):(\d{2})/);
  if (!m) return NaN;
  return new Date(`${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:00`).getTime();
}

function realisticEnergy(sessionDate: string, questionDate: string, base: number): number {
  const sessionMs = parseLmeDate(sessionDate);
  const questionMs = parseLmeDate(questionDate);
  if (Number.isNaN(sessionMs) || Number.isNaN(questionMs)) return base;
  const days = Math.max(0, (questionMs - sessionMs) / (24 * 60 * 60 * 1000));
  return Math.min(1, Math.max(MIN_REALISTIC_ENERGY, base * (1 - DECAY_PER_DAY * days)));
}

function makeUnit(opts: {
  abstraction: string;
  value: string;
  cueAnchors: string[];
  date: string;
  energy: number;
}): HarmonicUnit {
  const ms = parseLmeDate(opts.date);
  const iso = Number.isNaN(ms) ? new Date(0).toISOString() : new Date(ms).toISOString();
  return {
    id: generateHarmonicId(),
    type: 'episodic',
    primary_abstraction: opts.abstraction,
    cue_anchors: opts.cueAnchors,
    memory_value: opts.value,
    energy: opts.energy,
    created_at: iso,
    updated_at: iso,
  };
}

/**
 * Build the units for one question's haystack (pure; does not touch disk).
 * Also returns the id → session_id map used to score retrieval.
 */
export function buildUnitsForQuestion(
  question: LmeQuestion,
  options: IngestOptions = {},
): { units: HarmonicUnit[]; sessionOfUnit: Map<string, string> } {
  const granularity = options.granularity ?? 'round';
  const energyMode = options.energyMode ?? 'frozen';
  const base = options.frozenEnergy ?? 0.8;
  const units: HarmonicUnit[] = [];
  const sessionOfUnit = new Map<string, string>();

  question.haystack_sessions.forEach((session, si) => {
    const sid = question.haystack_session_ids[si];
    const date = question.haystack_dates[si];
    const energy = energyMode === 'realistic'
      ? realisticEnergy(date, question.question_date, base)
      : base;
    const marker = `${SID_MARKER_PREFIX}${sid}`;

    if (granularity === 'session') {
      const text = session.map(r => `${r.role}: ${r.content}`).join('\n');
      const unit = makeUnit({
        abstraction: `[${date}] ${text}`,
        value: text,
        cueAnchors: [marker, date],
        date,
        energy,
      });
      units.push(unit);
      sessionOfUnit.set(unit.id, sid);
    } else {
      for (const round of session) {
        const unit = makeUnit({
          abstraction: `[${date}] ${round.role}: ${round.content}`,
          value: round.content,
          cueAnchors: [marker, date, round.role],
          date,
          energy,
        });
        units.push(unit);
        sessionOfUnit.set(unit.id, sid);
      }
    }
  });

  return { units, sessionOfUnit };
}

/** Write all units for a question into the given (isolated) store, serially.
 *  skipMerge is set so the benchmark ingests one deterministic unit per
 *  round/session — MinHash cross-tier merging would collapse near-duplicate
 *  rounds and break per-session mapping. */
export async function ingestQuestion(
  store: HarmonicUnitFileStore,
  question: LmeQuestion,
  options: IngestOptions = {},
): Promise<{ unitCount: number; sessionOfUnit: Map<string, string> }> {
  const { units, sessionOfUnit } = buildUnitsForQuestion(question, options);
  for (const unit of units) {
    await store.write(unit, undefined, { skipMerge: true });
  }
  return { unitCount: units.length, sessionOfUnit };
}
