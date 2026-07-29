interface ZeroTokenRule {
  pattern: RegExp;
  extractor: (match: RegExpMatchArray) => object;
}

export class ZeroTokenCompressor {
  private rules: ZeroTokenRule[];

  constructor() {
    this.rules = [
      {
        pattern: /coverage\s+([\d.]+)%/i,
        extractor: (match: RegExpMatchArray) => ({
          type: 'metric',
          fact: `coverage ${match[1]}%`,
          concept: 'coverage',
        }),
      },
      {
        pattern: /Error:\s+(.+)/,
        extractor: (match: RegExpMatchArray) => ({
          type: 'error',
          fact: `Error: ${match[1]}`,
          concept: 'error',
        }),
      },
      {
        pattern: /modified\s+(.+?):\s+(.+)/i,
        extractor: (match: RegExpMatchArray) => ({
          type: 'file_change',
          fact: `Modified ${match[1]}: ${match[2]}`,
          concept: 'file-edit',
        }),
      },
      {
        pattern: /Tool\s+(\w+)\s+executed/i,
        extractor: (match: RegExpMatchArray) => ({
          type: 'tool_use',
          fact: `Tool used: ${match[1]}`,
          concept: match[1].toLowerCase(),
        }),
      },
    ];
  }

  compress(observations: any[]): any[] {
    const results: any[] = [];
    let idCounter = 0;

    for (const obs of observations) {
      const content = typeof obs.content === 'string' ? obs.content : '';
      let matched = false;

      for (const rule of this.rules) {
        const match = content.match(rule.pattern);
        if (match) {
          const extracted = rule.extractor(match) as any;
          results.push({
            id: `compressed_${idCounter++}`,
            type: extracted.type,
            fact: extracted.fact,
            concept: extracted.concept,
            energy: 0.5,
            timestamp: obs.timestamp || Date.now(),
            loopNum: obs.loopNum || 0,
          });
          matched = true;
          break;
        }
      }

      if (!matched) {
        results.push({
          id: `compressed_${idCounter++}`,
          type: 'observation',
          fact: content.substring(0, 100),
          concept: 'misc',
          energy: 0.3,
          timestamp: obs.timestamp || Date.now(),
          loopNum: obs.loopNum || 0,
        });
      }
    }

    return results;
  }
}
