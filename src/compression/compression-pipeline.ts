import { ObservationDeduplicator } from './observation-deduplicator';
import { ObservationClassifier } from './observation-classifier';
import { ZeroTokenCompressor } from './zero-token-compressor';
import { HybridCompressor } from './hybrid-compressor';
import { DiffCompressor } from './diff-compressor';
import { CompressionStrategySelector } from './compression-strategy-selector';
import { PrivacyFilter } from '../memory/privacy-filter';

export interface PipelineStats {
  input: number;
  duplicates: number;
  filtered: number;
  compressed: number;
  merged: number;
  output: number;
}

export class CompressionPipeline {
  private deduplicator: ObservationDeduplicator;
  private classifier: ObservationClassifier;
  private zeroToken: ZeroTokenCompressor;
  private llm: HybridCompressor;
  private diff: DiffCompressor;
  private selector: CompressionStrategySelector;
  private privacyFilter?: PrivacyFilter;

  constructor(config?: { privacyFilter?: PrivacyFilter }) {
    this.deduplicator = new ObservationDeduplicator();
    this.classifier = new ObservationClassifier();
    this.zeroToken = new ZeroTokenCompressor();
    this.llm = new HybridCompressor();
    this.diff = new DiffCompressor();
    this.selector = new CompressionStrategySelector();
    if (config?.privacyFilter) {
      this.privacyFilter = config.privacyFilter;
    }
  }

  async process(observations: any[]): Promise<{ compressed: any[]; stats: PipelineStats }> {
    const stats: PipelineStats = {
      input: observations.length,
      duplicates: 0,
      filtered: 0,
      compressed: 0,
      merged: 0,
      output: 0,
    };

    let current = [...observations];

    const deduplicated = this.deduplicator.deduplicate(current);
    stats.duplicates = current.length - deduplicated.length;
    current = deduplicated;

    if (this.privacyFilter) {
      current = current.map((obs) => this.privacyFilter!.filterObservation(obs));
    }
    stats.filtered = 0;

    const groups = this.classifier.classifyBatch(current);

    const allCompressed: any[] = [];
    for (const [, group] of groups) {
      const strategy = this.selector.select(group);
      let compressed: any[];

      switch (strategy) {
        case 'diff': {
          const diffResult = this.diff.compress(group);
          compressed = [diffResult];
          break;
        }
        case 'zero-token':
          compressed = this.zeroToken.compress(group);
          break;
        case 'template':
          compressed = this.compressTemplate(group);
          break;
        case 'llm':
        default: {
          const llmResult = await this.llm.compress(group);
          compressed = [llmResult];
          break;
        }
      }

      allCompressed.push(...compressed);
    }

    stats.compressed = allCompressed.length;

    const merged = this.mergeSimilar(allCompressed);
    stats.merged = allCompressed.length - merged.length;
    stats.output = merged.length;

    return { compressed: merged, stats };
  }

  private mergeSimilar(memories: any[]): any[] {
    const merged: any[] = [];
    const used = new Set<number>();

    for (let i = 0; i < memories.length; i++) {
      if (used.has(i)) continue;

      let base = { ...memories[i] };
      used.add(i);

      for (let j = i + 1; j < memories.length; j++) {
        if (used.has(j)) continue;

        const similarity = this.jaccardSimilarity(base.concept, memories[j].concept);
        if (similarity > 0.85) {
          base.facts = this.mergeFacts(base.facts, memories[j].facts);
          base.energy = (base.energy + memories[j].energy) / 2;
          base.sourceLoops = this.mergeSourceLoops(base.sourceLoops, memories[j].sourceLoops);
          used.add(j);
        }
      }

      merged.push(base);
    }

    return merged;
  }

  private jaccardSimilarity(a: string, b: string): number {
    if (!a || !b) return 0;
    const setA = new Set(a.toLowerCase().split(/[-\s_]+/));
    const setB = new Set(b.toLowerCase().split(/[-\s_]+/));
    const intersection = new Set([...setA].filter((x) => setB.has(x)));
    const union = new Set([...setA, ...setB]);
    return union.size === 0 ? 0 : intersection.size / union.size;
  }

  private compressTemplate(group: any[]): any[] {
    return group.map((obs) => ({
      id: `template_${obs.timestamp || Date.now()}`,
      type: 'observation',
      fact: typeof obs.content === 'string' ? obs.content.substring(0, 80) : '',
      concept: 'observation',
      energy: 0.4,
      timestamp: obs.timestamp || Date.now(),
      loopNum: obs.loopNum || 0,
    }));
  }

  private mergeFacts(a: any, b: any): any {
    if (Array.isArray(a) && Array.isArray(b)) {
      return [...new Set([...a, ...b])];
    }
    if (typeof a === 'string' && typeof b === 'string') {
      return a !== b ? `${a}; ${b}` : a;
    }
    return a || b;
  }

  private mergeSourceLoops(a: any, b: any): any {
    if (Array.isArray(a) && Array.isArray(b)) {
      return [...new Set([...a, ...b])];
    }
    const set = new Set<number>();
    if (a !== undefined) set.add(a);
    if (b !== undefined) set.add(b);
    return [...set];
  }
}
