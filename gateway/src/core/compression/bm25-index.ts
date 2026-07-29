import * as fs from 'fs';

export class BM25Index {
  private invertedIndex: Map<string, Set<string>> = new Map();
  private docLengths: Map<string, number> = new Map();
  private avgDocLength = 0;
  private k1 = 1.2;
  private b = 0.75;
  private docContents: Map<string, string> = new Map();

  constructor(config?: { k1?: number; b?: number }) {
    if (config?.k1 !== undefined) this.k1 = config.k1;
    if (config?.b !== undefined) this.b = config.b;
  }

  addDocument(id: string, text: string): void {
    const tokens = this.tokenize(text);
    this.docLengths.set(id, tokens.length);
    this.docContents.set(id, text);

    const uniqueTokens = new Set(tokens);
    for (const token of uniqueTokens) {
      if (!this.invertedIndex.has(token)) {
        this.invertedIndex.set(token, new Set());
      }
      this.invertedIndex.get(token)!.add(id);
    }

    const totalLength = Array.from(this.docLengths.values()).reduce((a, b) => a + b, 0);
    this.avgDocLength = totalLength / this.docLengths.size;
  }

  search(query: string, topK = 10): Array<{ id: string; score: number; text: string }> {
    const tokens = this.tokenize(query);
    if (tokens.length === 0) return [];

    const N = this.docLengths.size;
    if (N === 0) return [];

    const scores = new Map<string, number>();

    for (const token of tokens) {
      const matchingDocs = this.invertedIndex.get(token);
      if (!matchingDocs) continue;

      const df = matchingDocs.size;
      const idf = Math.log((N - df + 0.5) / (df + 0.5) + 1);

      for (const docId of matchingDocs) {
        const docLength = this.docLengths.get(docId) || 0;
        const tf = this.getTermFreq(docId, token);
        const numerator = tf * (this.k1 + 1);
        const denominator = tf + this.k1 * (1 - this.b + this.b * (docLength / this.avgDocLength));
        const score = idf * (numerator / denominator);
        scores.set(docId, (scores.get(docId) || 0) + score);
      }
    }

    return Array.from(scores.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, topK)
      .map(([id, score]) => ({
        id,
        score,
        text: this.docContents.get(id) || ''
      }));
  }

  removeDocument(id: string): void {
    for (const [, docSet] of this.invertedIndex) {
      docSet.delete(id);
    }
    for (const [term, docSet] of this.invertedIndex) {
      if (docSet.size === 0) this.invertedIndex.delete(term);
    }

    this.docLengths.delete(id);
    this.docContents.delete(id);

    if (this.docLengths.size > 0) {
      const totalLength = Array.from(this.docLengths.values()).reduce((a, b) => a + b, 0);
      this.avgDocLength = totalLength / this.docLengths.size;
    } else {
      this.avgDocLength = 0;
    }
  }

  clear(): void {
    this.invertedIndex.clear();
    this.docLengths.clear();
    this.docContents.clear();
    this.avgDocLength = 0;
  }

  save(path: string): void {
    const data = {
      invertedIndex: Object.fromEntries(
        Array.from(this.invertedIndex.entries()).map(([k, v]) => [k, Array.from(v)])
      ),
      docLengths: Object.fromEntries(this.docLengths),
      avgDocLength: this.avgDocLength,
      docContents: Object.fromEntries(this.docContents),
      k1: this.k1,
      b: this.b
    };
    fs.writeFileSync(path, JSON.stringify(data, null, 2), 'utf-8');
  }

  load(path: string): void {
    const raw = fs.readFileSync(path, 'utf-8');
    const data = JSON.parse(raw);
    this.invertedIndex = new Map(
      Object.entries(data.invertedIndex).map(([k, v]) => [k, new Set(v as string[])])
    );
    this.docLengths = new Map(Object.entries(data.docLengths));
    this.avgDocLength = data.avgDocLength;
    this.docContents = new Map(Object.entries(data.docContents));
    this.k1 = data.k1;
    this.b = data.b;
  }

  get size(): number {
    return this.docLengths.size;
  }

  private tokenize(text: string): string[] {
    const tokens = text
      .toLowerCase()
      .replace(/[^\u4e00-\u9fff\w]/g, ' ')
      .split(/\s+/)
      .filter(t => t.length >= 2);

    return tokens.map(t => {
      if (t.length < 5) return t;
      const suffixes = ['ing', 'ed', 'es', 'ly', 'tion', 's'];
      for (const suffix of suffixes) {
        if (t.endsWith(suffix) && t.length > suffix.length) {
          let stemmed = t.slice(0, -suffix.length);
          if (stemmed.length >= 2 && stemmed[stemmed.length - 1] === stemmed[stemmed.length - 2]) {
            stemmed = stemmed.slice(0, -1);
          }
          if (stemmed.length >= 2) return stemmed;
        }
      }
      return t;
    });
  }

  private getTermFreq(docId: string, term: string): number {
    const content = this.docContents.get(docId);
    if (!content) return 1;
    const tokens = this.tokenize(content);
    return tokens.filter(t => t === term).length;
  }
}
