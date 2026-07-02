export interface PrivacyRule {
  name: string;
  pattern: RegExp;
  replacement: string;
  severity: 'critical' | 'high' | 'medium' | 'low';
}

export interface RedactionLog {
  rule: string;
  severity: string;
  position: { start: number; end: number };
  originalLength: number;
  timestamp: string;
}

const DEFAULT_RULES: PrivacyRule[] = [
  {
    name: 'api_key',
    pattern: /(api[_-]?key|apikey)\s*[:=]\s*["']?[a-zA-Z0-9_-]{20,}["']?/gi,
    replacement: '$1: [REDACTED_API_KEY]',
    severity: 'critical',
  },
  {
    name: 'aws_access_key',
    pattern: /AKIA[0-9A-Z]{16}/g,
    replacement: '[REDACTED_AWS_KEY]',
    severity: 'critical',
  },
  {
    name: 'password',
    pattern: /(password|passwd|pwd)\s*[:=]\s*["']?[^\s"']+["']?/gi,
    replacement: '$1: [REDACTED_PASSWORD]',
    severity: 'critical',
  },
  {
    name: 'bearer_token',
    pattern: /Bearer\s+[a-zA-Z0-9_-]+\.[a-zA-Z0-9_-]+\.[a-zA-Z0-9_-]+/g,
    replacement: 'Bearer [REDACTED_JWT]',
    severity: 'high',
  },
  {
    name: 'private_tag',
    pattern: /<private>.*?<\/private>/gs,
    replacement: '<private>[REDACTED]</private>',
    severity: 'high',
  },
  {
    name: 'email',
    pattern: /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g,
    replacement: '[REDACTED_EMAIL]',
    severity: 'medium',
  },
  {
    name: 'ip_address',
    pattern: /\b(?:\d{1,3}\.){3}\d{1,3}\b/g,
    replacement: '[REDACTED_IP]',
    severity: 'low',
  },
  {
    name: 'credit_card',
    pattern: /\b(?:\d{4}[-\s]?){3}\d{4}\b/g,
    replacement: '[REDACTED_CC]',
    severity: 'critical',
  },
];

export class PrivacyFilter {
  private rules: PrivacyRule[];
  private enabled: boolean;
  private logRedactions: boolean;
  private activeRules: string[];

  constructor(config?: {
    enabled?: boolean;
    logRedactions?: boolean;
    rules?: string[];
    customPatterns?: Array<{ name: string; pattern: string; replacement: string }>;
  }) {
    this.enabled = config?.enabled ?? true;
    this.logRedactions = config?.logRedactions ?? false;
    this.activeRules = config?.rules ?? [];

    const rules: PrivacyRule[] = [...DEFAULT_RULES];

    if (config?.customPatterns) {
      for (const cp of config.customPatterns) {
        const existing = rules.findIndex(r => r.name === cp.name);
        const rule: PrivacyRule = {
          name: cp.name,
          pattern: new RegExp(cp.pattern, 'g'),
          replacement: cp.replacement,
          severity: 'high',
        };
        if (existing >= 0) {
          rules[existing] = rule;
        } else {
          rules.push(rule);
        }
      }
    }

    this.rules = rules;
  }

  filter(text: string): { filtered: string; redactions: RedactionLog[] } {
    if (!this.enabled) {
      return { filtered: text, redactions: [] };
    }

    const redactions: RedactionLog[] = [];
    const rulesToApply = this.activeRules.length === 0
      ? this.rules
      : this.rules.filter(r => this.activeRules.includes(r.name));

    let filtered = text;

    for (const rule of rulesToApply) {
      const regex = new RegExp(rule.pattern.source, rule.pattern.flags);
      const replacements: Array<{ offset: number; original: string; replacement: string }> = [];

      let m: RegExpExecArray | null;
      while ((m = regex.exec(filtered)) !== null) {
        const match = m;
        let replacement = rule.replacement;
        replacement = replacement.replace(/\$(\d+)/g, (_, n) => match[parseInt(n)] ?? '');

        replacements.push({
          offset: m.index,
          original: m[0],
          replacement,
        });

        if (m.index === regex.lastIndex) {
          regex.lastIndex++;
        }
      }

      for (let i = replacements.length - 1; i >= 0; i--) {
        const r = replacements[i];
        redactions.push({
          rule: rule.name,
          severity: rule.severity,
          position: { start: r.offset, end: r.offset + r.original.length },
          originalLength: r.original.length,
          timestamp: new Date().toISOString(),
        });
        filtered = filtered.slice(0, r.offset) + r.replacement + filtered.slice(r.offset + r.original.length);
      }
    }

    if (this.logRedactions && redactions.length > 0) {
      console.log(`[PrivacyFilter] Redacted ${redactions.length} items`);
    }

    return { filtered, redactions };
  }

  filterObservation(obs: any): any {
    if (!obs || typeof obs !== 'object') return obs;

    const result = Array.isArray(obs) ? [...obs] : { ...obs };

    if (typeof result.content === 'string') {
      const { filtered, redactions } = this.filter(result.content);
      result.content = filtered;
      if (redactions.length > 0) {
        result.metadata = {
          ...(result.metadata || {}),
          redactions,
        };
      }
    }

    return result;
  }

  setEnabledRules(rules: string[]): void {
    this.activeRules = rules;
  }

  enable(): void {
    this.enabled = true;
  }

  disable(): void {
    this.enabled = false;
  }

  getStats(): { enabled: boolean; rules: number; activeRules: string[] } {
    const names = this.activeRules.length === 0
      ? this.rules.map(r => r.name)
      : this.activeRules;
    return {
      enabled: this.enabled,
      rules: this.rules.length,
      activeRules: names,
    };
  }
}
