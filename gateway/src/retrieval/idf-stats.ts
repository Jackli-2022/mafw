export class IDFStats {
  private df = new Map<string, number>();
  private n = 0;
  private threshold: number;

  constructor(threshold = 0.5) {
    this.threshold = threshold;
  }

  addDocument(terms: string[]): void {
    this.n++;
    const unique = new Set(terms);
    for (const term of unique) {
      this.df.set(term, (this.df.get(term) || 0) + 1);
    }
  }

  idf(term: string): number {
    const freq = this.df.get(term) || 0;
    if (freq === 0) return 0;
    return Math.log(this.n / freq);
  }

  getThresholdIdf(): number {
    return this.threshold;
  }

  isNoisy(term: string): boolean {
    return this.idf(term) < this.threshold;
  }
}
