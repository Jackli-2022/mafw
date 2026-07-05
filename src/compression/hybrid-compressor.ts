import { ZeroTokenCompressor } from './zero-token-compressor';
import { HarmonicUnit, generateHarmonicId } from '../memory/harmonic-types';
import { HarmonicIndexManager } from '../memory/harmonic-index';
import * as fs from 'fs';
import * as path from 'path';

export class HybridCompressor {
  private zeroToken: ZeroTokenCompressor;
  private energyThreshold: number = 0.6;
  private gatewayUrl: string;
  private harmonicIndex?: HarmonicIndexManager;
  private baseDir?: string;

  constructor(
    gatewayUrl?: string,
    harmonicIndex?: HarmonicIndexManager,
    baseDir?: string
  ) {
    this.zeroToken = new ZeroTokenCompressor();
    this.gatewayUrl = gatewayUrl || 'http://127.0.0.1:3001';
    this.harmonicIndex = harmonicIndex;
    this.baseDir = baseDir;
  }

  async compress(observations: any[]): Promise<HarmonicUnit> {
    if (observations.length === 0) {
      return this.makeUnit(observations, [], 0);
    }
    const highEnergy = observations.filter(o => (o.energy ?? 0.5) > this.energyThreshold);
    const useHighEnergy = highEnergy.length > 0 ? highEnergy : observations;
    const energy = useHighEnergy.reduce((s, o) => s + (o.energy ?? 0.5), 0) / useHighEnergy.length;
    const memoryType = this.detectMemoryType(useHighEnergy);

    try {
      const res = await fetch(`${this.gatewayUrl}/api/llm/compress`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ observations: useHighEnergy.map(o => o.content || '') }),
        signal: AbortSignal.timeout(10000)
      });
      if (res.ok) {
        const result: any = await res.json();
        const unit = this.makeUnit(useHighEnergy, result.concepts || [], result.energy ?? energy);
        unit.memory_type = memoryType;
        unit.primary_abstraction = (result.narrative || 'compressed').slice(0, 50);
        unit.cue_anchors = Array.isArray(result.concepts) ? result.concepts.slice(0, 8) : [];
        unit.memory_value = result.narrative || useHighEnergy.map(o => o.content).join('\n');
        await this.persistUnit(unit);
        return unit;
      }
    } catch {}

    const unit = this.makeUnit(useHighEnergy, [], energy);
    unit.memory_type = memoryType;
    unit.primary_abstraction = (useHighEnergy[0]?.content || 'rule-compressed').slice(0, 50);
    unit.cue_anchors = this.extractConcepts(useHighEnergy).slice(0, 8);
    unit.memory_value = useHighEnergy.map(o => o.content).join('\n').slice(0, 1000);
    await this.persistUnit(unit);
    return unit;
  }

  private detectMemoryType(observations: any[]): 'episodic' | 'semantic' | 'procedural' {
    const allContent = observations.map(o => o.content || '').join(' ');
    if (observations.every(o => o.type === 'file_edit' || (o.content && o.content.includes('File modified')))) return 'procedural';
    if (/plan|wave|task|goal/i.test(allContent)) return 'episodic';
    return 'semantic';
  }

  private makeUnit(observations: any[], concepts: string[], energy: number): HarmonicUnit {
    return {
      id: generateHarmonicId(),
      goal_id: this.extractGoalId(observations),
      memory_type: 'semantic',
      primary_abstraction: 'compressed',
      cue_anchors: concepts.slice(0, 8),
      memory_value: '',
      energy: Math.max(0, Math.min(1, energy)),
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    };
  }

  private async persistUnit(unit: HarmonicUnit): Promise<void> {
    if (!this.baseDir || !this.harmonicIndex) return;
    const tier = unit.memory_type === 'procedural' ? 'tier4' : unit.memory_type === 'episodic' ? 'tier2' : 'tier3';
    const goalId = unit.goal_id || '__global__';
    const filePath = path.join(this.baseDir, 'memory', tier, `${goalId}.json`);
    const dir = path.dirname(filePath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    const existing = fs.existsSync(filePath) ? JSON.parse(fs.readFileSync(filePath, 'utf-8')) : [];
    existing.push(unit);
    fs.writeFileSync(filePath, JSON.stringify(existing, null, 2), 'utf-8');
    this.harmonicIndex.addEntry(unit, tier);
  }

  private extractGoalId(observations: any[]): string | null {
    for (const o of observations) {
      if (o.goalId) return o.goalId;
      if (o.metadata?.goalId) return o.metadata.goalId;
    }
    return null;
  }

  private extractConcepts(observations: any[]): string[] {
    const concepts = new Set<string>();
    const patterns = [
      { regex: /(jwt|oauth|bcrypt|auth)/i, concept: 'authentication' },
      { regex: /(error|fail|exception)/i, concept: 'error' },
      { regex: /(coverage|test|jest)/i, concept: 'testing' },
      { regex: /(api|endpoint|route)/i, concept: 'api' },
      { regex: /(config|setting|env)/i, concept: 'configuration' }
    ];
    for (const obs of observations) {
      const content = obs.content || '';
      for (const { regex, concept } of patterns) {
        if (regex.test(content)) concepts.add(concept);
      }
    }
    return Array.from(concepts);
  }
}
