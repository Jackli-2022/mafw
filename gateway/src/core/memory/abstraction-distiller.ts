// src/memory/abstraction-distiller.ts — Rewritten for v7 proposition extraction

export function hasKnowledgeSignal(observation: string): string | null {
  const lower = observation.toLowerCase();
  if (lower.includes('error') && (lower.includes('fix') || lower.includes('root') || lower.includes('because'))) return 'pitfall';
  if (lower.includes('config') || lower.includes('set ')) return 'procedure';
  if (lower.includes(' is ') || lower.includes('always') || lower.includes('never') || lower.includes('requires')) return 'fact';
  if (lower.includes('decide') || lower.includes('choose') || lower.includes('reason')) return 'decision';
  return null;
}

export function extractPropositions(observations: string[]): string[] {
  const propositions: string[] = [];
  for (const obs of observations) {
    const sentences = obs.split(/[。.!?]/).filter(s => s.trim().length > 10);
    for (const s of sentences) {
      const cleaned = s.trim().replace(/用户|agent|然后|最终/gi, '').trim();
      if (cleaned.length > 0) {
        propositions.push(cleaned);
      }
    }
  }
  return [...new Set(propositions)].slice(0, 4);
}

export function passQualityGate(proposition: string, granularity: string): boolean {
  if (/用户|agent|然后|最终/i.test(proposition)) return false;
  if (proposition.length < 15) return false;
  if (!granularity) return false;
  return true;
}

// Keep original export signature for backward compatibility
export interface DistillationResult { created: number; locked: number; errors: string[]; }

export async function runDistillation(
  _indexManager: any,
  _baseDir: string,
): Promise<DistillationResult> {
  return { created: 0, locked: 0, errors: [] };
}
