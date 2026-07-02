import { ZeroTokenCompressor } from './zero-token-compressor';

export interface CompressedMemory {
  id: string;
  type: 'rule_compressed' | 'fallback';
  facts: string[];
  concepts: string[];
  narrative?: string;
  energy: number;
}

export class RuleBasedCompressor {
  private zeroToken: ZeroTokenCompressor;
  private energyThreshold: number = 0.6;

  constructor() {
    this.zeroToken = new ZeroTokenCompressor();
  }

  async compress(observations: any[]): Promise<CompressedMemory> {
    if (observations.length === 0) {
      return { id: 'empty', type: 'fallback', facts: [], concepts: [], energy: 0 };
    }
    const highEnergy = observations.filter(o => (o.energy ?? 0.5) > this.energyThreshold);
    if (highEnergy.length === 0) {
      const zeroResult = this.zeroToken.compress(observations);
      return {
        id: `fallback_${Date.now()}`,
        type: 'fallback',
        facts: zeroResult.map(r => r.fact).filter(Boolean),
        concepts: [...new Set(zeroResult.map(r => r.concept).filter(Boolean))],
        energy: observations.reduce((s, o) => s + (o.energy ?? 0.5), 0) / observations.length
      };
    }
    const narrative = highEnergy.map(o => o.content).join('\n');
    const allFacts: string[] = [];
    const allConcepts: string[] = [];
    const conceptPatterns = [
      { regex: /(jwt|oauth|bcrypt|auth)/i, concept: 'authentication' },
      { regex: /(error|fail|exception)/i, concept: 'error' },
      { regex: /(coverage|test|jest)/i, concept: 'testing' },
      { regex: /(api|endpoint|route)/i, concept: 'api' },
      { regex: /(config|setting|env)/i, concept: 'configuration' }
    ];
    for (const obs of highEnergy) {
      const content = obs.content || '';
      const lines = content.split('\n').filter((l: string) => l.length > 20);
      allFacts.push(...lines.slice(0, 3));
      for (const { regex, concept } of conceptPatterns) {
        if (regex.test(content)) allConcepts.push(concept);
      }
    }
    return {
      id: `rule_${Date.now()}`,
      type: 'rule_compressed',
      narrative,
      facts: [...new Set(allFacts)],
      concepts: [...new Set(allConcepts)],
      energy: Math.min(
        highEnergy.reduce((s, o) => s + (o.energy ?? 0.5), 0) / highEnergy.length + 0.1,
        1.0
      )
    };
  }
}
