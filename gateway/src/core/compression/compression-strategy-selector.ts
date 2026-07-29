import { ZeroTokenCompressor } from './zero-token-compressor';

export type CompressionStrategy = 'zero-token' | 'diff' | 'llm' | 'template';

export class CompressionStrategySelector {
  select(observations: any[]): CompressionStrategy {
    const allFileEdits = observations.every(
      (o) => o.type === 'file_edit' || (o.content && o.content.includes('File modified'))
    );
    if (allFileEdits && observations.length > 0) {
      return 'diff';
    }

    const matchRate = this.calculatePatternMatchRate(observations);
    if (matchRate > 0.8) {
      return 'zero-token';
    }

    if (observations.length < 3 && observations.length > 0) {
      const allSimple = observations.every(
        (o) => typeof o.content === 'string' && o.content.length < 200
      );
      if (allSimple) {
        return 'template';
      }
    }

    return 'llm';
  }

  private calculatePatternMatchRate(observations: any[]): number {
    if (observations.length === 0) return 0;

    const compressor = new ZeroTokenCompressor();
    const compressed = compressor.compress(observations);
    const matched = compressed.filter((c) => c.concept !== 'misc').length;

    return matched / observations.length;
  }
}
