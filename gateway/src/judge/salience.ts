import { calculateSalience } from '../core/memory/salience-perceptor';

export interface SalienceSignals {
  text: string;
  /** Novelty 0–1 (1 = never seen; from embedding distance to the nearest existing memory). */
  novelty?: number;
  /** Reward/feedback 0–1 (thumbs up = 1, thumbs down = 0). */
  feedback?: number;
  /** Repetition count (how many times this topic has been seen). */
  repetitions?: number;
}

export interface SalienceJudgment {
  /** Salience on the existing 0.5–1.5 scale (compatible with calculateSalience). */
  score: number;
  /** How many of the four neuromodulator signals were available (0.25–1). */
  confidence: number;
  signals: { emotional: number; novelty: number; reward: number; repetition: number };
}

const clamp01 = (v: number) => Math.max(0, Math.min(1, v));

/**
 * Tier 0 salience judgment: a deterministic scalar integration of the brain's
 * "importance signals" (emotional/arousal, novelty/prediction-error, reward,
 * repetition) — NOT an LLM. With no extra signals it returns exactly the regex
 * 3-tier value (backward-compatible); with signals it adjusts it.
 */
export function judgeSalience(s: SalienceSignals): SalienceJudgment {
  const emotional = calculateSalience(s.text); // 0.5 / 1.0 / 1.5
  const novelty = clamp01(s.novelty ?? 0.5);
  const reward = clamp01(s.feedback ?? 0.5);
  const repetition = clamp01((s.repetitions ?? 0) / 5);
  const signals = { emotional, novelty, reward, repetition };

  if (s.novelty === undefined && s.feedback === undefined && !s.repetitions) {
    return { score: emotional, confidence: 0.25, signals };
  }
  // Neuromodulator integration: adjust the emotional baseline by novelty/reward/repetition.
  const boost = 0.3 * (novelty - 0.5) + 0.2 * (reward - 0.5) + 0.1 * (repetition - 0.5);
  const score = Math.max(0.5, Math.min(1.5, emotional + boost));
  const available = 1 + [s.novelty, s.feedback, s.repetitions].filter((v) => v !== undefined).length;
  return { score, confidence: available / 4, signals };
}
