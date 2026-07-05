import { ZeroTokenCompressor } from './zero-token-compressor';

export interface CompressedMemory {
  id: string;
  type: 'hybrid' | 'fallback';
  facts: string[];
  concepts: string[];
  narrative?: string;
  energy: number;
}

export class HybridCompressor {
  private zeroToken: ZeroTokenCompressor;
  private energyThreshold: number = 0.6;
  private gatewayUrl: string;

  constructor(gatewayUrl?: string) {
    this.zeroToken = new ZeroTokenCompressor();
    this.gatewayUrl = gatewayUrl || 'http://127.0.0.1:3001';
  }

  async compress(observations: any[]): Promise<CompressedMemory> {
    if (observations.length === 0) {
      return { id: 'empty', type: 'fallback', facts: [], concepts: [], energy: 0 };
    }
    const highEnergy = observations.filter(o => (o.energy ?? 0.5) > this.energyThreshold);
    if (highEnergy.length === 0) return this.ruleFallback(observations);

    try {
      const res = await fetch(`${this.gatewayUrl}/api/llm/compress`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ observations: highEnergy.map(o => o.content || '') }),
        signal: AbortSignal.timeout(10000)
      });
      if (res.ok) {
        const result: any = await res.json();
        return {
          id: `hybrid_${Date.now()}`,
          type: 'hybrid',
          facts: result.facts || [],
          concepts: result.concepts || [],
          narrative: result.narrative || '',
          energy: result.energy ?? 0.5
        };
      }
    } catch {}

    return this.ruleFallback(highEnergy);
  }

  private ruleFallback(observations: any[]): CompressedMemory {
    const zeroResult = this.zeroToken.compress(observations);
    const allFacts: string[] = [];
    const allConcepts: string[] = [];
    const conceptPatterns = [
      { regex: /(jwt|oauth|bcrypt|auth)/i, concept: 'authentication' },
      { regex: /(error|fail|exception)/i, concept: 'error' },
      { regex: /(coverage|test|jest)/i, concept: 'testing' },
      { regex: /(api|endpoint|route)/i, concept: 'api' },
      { regex: /(config|setting|env)/i, concept: 'configuration' }
    ];
    for (const obs of observations) {
      const content = obs.content || '';
      const lines = content.split('\n').filter((l: string) => l.length > 20);
      allFacts.push(...lines.slice(0, 3));
      for (const { regex, concept } of conceptPatterns) {
        if (regex.test(content)) allConcepts.push(concept);
      }
    }
    return {
      id: `fallback_${Date.now()}`,
      type: 'fallback',
      facts: [...new Set(allFacts)],
      concepts: [...new Set(allConcepts)],
      energy: observations.reduce((s: number, o: any) => s + (o.energy ?? 0.5), 0) / observations.length
    };
  }
}
