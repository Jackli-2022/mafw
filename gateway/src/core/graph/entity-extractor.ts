export class EntityExtractor {
  private conceptPatterns: RegExp[];

  constructor() {
    this.conceptPatterns = [
      /\bjwt\b/gi,
      /\boauth\b/gi,
      /\bbcrypt\b/gi,
      /\bexpress\b/gi,
      /\breact\b/gi,
      /\bvue\b/gi,
      /\bangular\b/gi,
      /\bauthentication\b/gi,
      /\bauthorization\b/gi,
      /\bmiddleware\b/gi,
      /\bcontroller\b/gi,
      /\bservice\b/gi,
      /\bcoverage\b/gi,
      /\btesting\b/gi,
      /\bjest\b/gi,
      /\bmocha\b/gi,
      /\bcypress\b/gi,
      /\bapi\b/gi,
      /\bendpoint\b/gi,
      /\broute\b/gi,
      /\bhandler\b/gi,
    ];
  }

  extract(text: string): string[] {
    const matches = new Set<string>();
    for (const pattern of this.conceptPatterns) {
      const match = text.match(pattern);
      if (match) {
        matches.add(match[0].toLowerCase());
      }
    }
    const extPattern = /\.(\w+)\b/g;
    let extMatch: RegExpExecArray | null;
    while ((extMatch = extPattern.exec(text)) !== null) {
      const ext = extMatch[1].toLowerCase();
      if (['ts', 'js', 'py', 'go', 'rs', 'java'].includes(ext)) {
        matches.add(`.${ext}`);
      }
    }
    return Array.from(matches);
  }

  async extractWithLLM?(text: string): Promise<Array<{ entity: string; type: string; confidence: number }>> {
    return [];
  }
}
