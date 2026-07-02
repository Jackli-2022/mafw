import { PrivacyFilter } from '../../src/memory/privacy-filter';

function makeFilter(config?: {
  enabled?: boolean;
  logRedactions?: boolean;
  rules?: string[];
  customPatterns?: Array<{ name: string; pattern: string; replacement: string }>;
}): PrivacyFilter {
  return new PrivacyFilter(config);
}

describe('PrivacyFilter', () => {
  describe('filter', () => {
    it('redacts API key pattern', () => {
      const pf = makeFilter();
      const text = 'api_key = sk-abc123def456ghi789jkl012';
      const result = pf.filter(text);
      expect(result.filtered).toContain('[REDACTED_API_KEY]');
      expect(result.filtered).not.toContain('sk-abc123def456ghi789jkl012');
    });

    it('redacts AWS key pattern', () => {
      const pf = makeFilter();
      const text = 'AWS Key: AKIAIOSFODNN7EXAMPLE';
      const result = pf.filter(text);
      expect(result.filtered).toContain('[REDACTED_AWS_KEY]');
      expect(result.filtered).not.toContain('AKIAIOSFODNN7EXAMPLE');
    });

    it('redacts password pattern', () => {
      const pf = makeFilter();
      const text = 'password = supersecret123!';
      const result = pf.filter(text);
      expect(result.filtered).toContain('[REDACTED_PASSWORD]');
      expect(result.filtered).not.toContain('supersecret123!');
    });

    it('redacts passwd pattern', () => {
      const pf = makeFilter();
      const text = 'passwd: mysecret';
      const result = pf.filter(text);
      expect(result.filtered).toContain('[REDACTED_PASSWORD]');
      expect(result.filtered).not.toContain('mysecret');
    });

    it('redacts pwd pattern', () => {
      const pf = makeFilter();
      const text = 'pwd=mypassword';
      const result = pf.filter(text);
      expect(result.filtered).toContain('[REDACTED_PASSWORD]');
      expect(result.filtered).not.toContain('mypassword');
    });

    it('redacts Bearer JWT', () => {
      const pf = makeFilter();
      const text = 'Authorization: Bearer eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjNk3a1oK3vC2p7gQwX8s5Y6a9b0c1d2e3f4g5h6';
      const result = pf.filter(text);
      expect(result.filtered).toContain('[REDACTED_JWT]');
      expect(result.filtered).not.toContain('eyJhbGci');
    });

    it('redacts email', () => {
      const pf = makeFilter();
      const text = 'Contact: user@example.com';
      const result = pf.filter(text);
      expect(result.filtered).toContain('[REDACTED_EMAIL]');
      expect(result.filtered).not.toContain('user@example.com');
    });

    it('redacts IP address', () => {
      const pf = makeFilter();
      const text = 'Server: 192.168.1.1';
      const result = pf.filter(text);
      expect(result.filtered).toContain('[REDACTED_IP]');
      expect(result.filtered).not.toContain('192.168.1.1');
    });

    it('redacts credit card', () => {
      const pf = makeFilter();
      const text = 'Card: 4111-1111-1111-1111';
      const result = pf.filter(text);
      expect(result.filtered).toContain('[REDACTED_CC]');
      expect(result.filtered).not.toContain('4111-1111-1111-1111');
    });

    it('redacts credit card with spaces', () => {
      const pf = makeFilter();
      const text = 'Card: 4111 1111 1111 1111';
      const result = pf.filter(text);
      expect(result.filtered).toContain('[REDACTED_CC]');
      expect(result.filtered).not.toContain('4111 1111 1111 1111');
    });

    it('redacts credit card without separators', () => {
      const pf = makeFilter();
      const text = 'Card: 4111111111111111';
      const result = pf.filter(text);
      expect(result.filtered).toContain('[REDACTED_CC]');
      expect(result.filtered).not.toContain('4111111111111111');
    });

    it('handles nested text with surrounding content', () => {
      const pf = makeFilter();
      const text = 'User info: api_key = secret12345678901234567890. Also email: test@test.com';
      const result = pf.filter(text);
      expect(result.filtered).toContain('[REDACTED_API_KEY]');
      expect(result.filtered).toContain('[REDACTED_EMAIL]');
      expect(result.filtered).toContain('User info:');
      expect(result.filtered).toContain('Also');
    });

    it('returns redaction log with correct positions', () => {
      const pf = makeFilter();
      const text = 'Email: test@example.com and IP: 10.0.0.1';
      const result = pf.filter(text);
      expect(result.redactions.length).toBeGreaterThanOrEqual(2);
      const emailRedaction = result.redactions.find(r => r.rule === 'email');
      const ipRedaction = result.redactions.find(r => r.rule === 'ip_address');
      expect(emailRedaction).toBeDefined();
      expect(ipRedaction).toBeDefined();
      expect(emailRedaction!.position.start).toBeGreaterThanOrEqual(0);
      expect(emailRedaction!.severity).toBe('medium');
      expect(ipRedaction!.severity).toBe('low');
    });

    it('redaction log has valid timestamp', () => {
      const pf = makeFilter();
      const result = pf.filter('Email: user@test.com');
      expect(result.redactions.length).toBe(1);
      expect(result.redactions[0].timestamp).toBeDefined();
      expect(new Date(result.redactions[0].timestamp).toISOString()).toBe(result.redactions[0].timestamp);
    });

    it('redacts private tag content', () => {
      const pf = makeFilter();
      const text = 'public text<private>secret content</private>more public';
      const result = pf.filter(text);
      expect(result.filtered).toContain('<private>[REDACTED]</private>');
      expect(result.filtered).not.toContain('secret content');
      expect(result.filtered).toContain('public text');
      expect(result.filtered).toContain('more public');
    });

    it('redacts private tag with multiline content', () => {
      const pf = makeFilter();
      const text = 'before<private>line1\nline2\nline3</private>after';
      const result = pf.filter(text);
      expect(result.filtered).toContain('<private>[REDACTED]</private>');
      expect(result.filtered).not.toContain('line2');
    });
  });

  describe('custom patterns', () => {
    it('accepts custom patterns', () => {
      const pf = makeFilter({
        customPatterns: [
          { name: 'custom_secret', pattern: 'SECRET-\\d+', replacement: '[REDACTED_CUSTOM]' },
        ],
        rules: ['custom_secret'],
      });
      const result = pf.filter('My SECRET-12345 is safe');
      expect(result.filtered).toContain('[REDACTED_CUSTOM]');
      expect(result.filtered).not.toContain('SECRET-12345');
    });

    it('overrides default rule when name matches', () => {
      const pf = makeFilter({
        customPatterns: [
          { name: 'email', pattern: 'test@example\\.com', replacement: '[OVERRIDDEN]' },
        ],
        rules: ['email'],
      });
      const result = pf.filter('Email: test@example.com');
      expect(result.filtered).toContain('[OVERRIDDEN]');
    });
  });

  describe('selective rules', () => {
    it('only applies selected rules', () => {
      const pf = makeFilter({
        rules: ['email'],
      });
      const text = 'Email: user@test.com API: api_key = sk-123456789012345678901234';
      const result = pf.filter(text);
      expect(result.filtered).toContain('[REDACTED_EMAIL]');
      expect(result.filtered).toContain('sk-123456789012345678901234');
    });

    it('setEnabledRules dynamically changes active rules', () => {
      const pf = makeFilter();
      pf.setEnabledRules(['credit_card']);
      const text = 'Card: 4111111111111111 Email: user@test.com';
      const result = pf.filter(text);
      expect(result.filtered).toContain('[REDACTED_CC]');
      expect(result.filtered).toContain('user@test.com');
    });

    it('empty rules array applies all rules', () => {
      const pf = makeFilter({ rules: [] });
      const result = pf.filter('Email: user@test.com api_key = sk-123456789012345678901234');
      expect(result.filtered).toContain('[REDACTED_EMAIL]');
      expect(result.filtered).toContain('[REDACTED_API_KEY]');
    });
  });

  describe('disable/enable', () => {
    it('filter disabled passes through unchanged', () => {
      const pf = makeFilter({ enabled: false });
      const text = 'api_key = sk-123456789012345678901234';
      const result = pf.filter(text);
      expect(result.filtered).toBe(text);
      expect(result.redactions).toHaveLength(0);
    });

    it('disable() stops filtering', () => {
      const pf = makeFilter();
      pf.disable();
      const result = pf.filter('Email: user@test.com');
      expect(result.filtered).toContain('user@test.com');
    });

    it('enable() resumes filtering after disable', () => {
      const pf = makeFilter();
      pf.disable();
      pf.enable();
      const result = pf.filter('Email: user@test.com');
      expect(result.filtered).toContain('[REDACTED_EMAIL]');
    });
  });

  describe('filterObservation', () => {
    it('filters content and adds metadata', () => {
      const pf = makeFilter();
      const obs = { content: 'Email: user@test.com', metadata: { source: 'test' } };
      const result = pf.filterObservation(obs);
      expect(result.content).toContain('[REDACTED_EMAIL]');
      expect(result.content).not.toContain('user@test.com');
      expect(result.metadata.source).toBe('test');
      expect(result.metadata.redactions).toBeDefined();
      expect(result.metadata.redactions.length).toBeGreaterThan(0);
      expect(result.metadata.redactions[0].rule).toBe('email');
    });

    it('does not mutate original observation', () => {
      const pf = makeFilter();
      const obs = { content: 'Email: user@test.com' };
      const result = pf.filterObservation(obs);
      expect(obs.content).toBe('Email: user@test.com');
      expect(result.content).toContain('[REDACTED_EMAIL]');
    });

    it('handles observation without content', () => {
      const pf = makeFilter();
      const obs = { type: 'note' };
      const result = pf.filterObservation(obs);
      expect(result).toEqual({ type: 'note' });
    });

    it('handles null or non-object input', () => {
      const pf = makeFilter();
      expect(pf.filterObservation(null)).toBeNull();
      expect(pf.filterObservation('string')).toBe('string');
      expect(pf.filterObservation(42)).toBe(42);
    });
  });

  describe('getStats', () => {
    it('returns correct stats', () => {
      const pf = makeFilter();
      const stats = pf.getStats();
      expect(stats.enabled).toBe(true);
      expect(stats.rules).toBe(8);
      expect(stats.activeRules.length).toBe(8);
    });

    it('reflects disabled state', () => {
      const pf = makeFilter({ enabled: false });
      expect(pf.getStats().enabled).toBe(false);
    });

    it('reflects active rules when restricted', () => {
      const pf = makeFilter({ rules: ['email', 'ip_address'] });
      const stats = pf.getStats();
      expect(stats.activeRules).toEqual(['email', 'ip_address']);
    });
  });

  describe('no false positives', () => {
    it('passes through normal text unchanged', () => {
      const pf = makeFilter();
      const text = 'Hello world, this is a normal message with no secrets.';
      const result = pf.filter(text);
      expect(result.filtered).toBe(text);
      expect(result.redactions).toHaveLength(0);
    });

    it('passes through code without sensitive data', () => {
      const pf = makeFilter();
      const code = 'function add(a: number, b: number): number { return a + b; }';
      const result = pf.filter(code);
      expect(result.filtered).toBe(code);
    });

    it('passes through short numbers that look like IPs', () => {
      const pf = makeFilter();
      const text = 'Version: 0.0.0.1 is not an IP';
      const result = pf.filter(text);
      expect(result.filtered).toContain('[REDACTED_IP]');
    });

    it('does not flag 15-digit numbers as credit cards', () => {
      const pf = makeFilter();
      const text = 'ID: 1234-5678-9012-3 is not a full card';
      const result = pf.filter(text);
      expect(result.filtered).toContain('1234-5678-9012-3');
      expect(result.redactions).toHaveLength(0);
    });
  });

  describe('redaction log details', () => {
    it('records originalLength correctly', () => {
      const pf = makeFilter();
      const email = 'user@test.com';
      const text = `Email: ${email}`;
      const result = pf.filter(text);
      const emailRedaction = result.redactions.find(r => r.rule === 'email');
      expect(emailRedaction).toBeDefined();
      expect(emailRedaction!.originalLength).toBe(email.length);
    });

    it('records severity for each redaction', () => {
      const pf = makeFilter();
      const text = 'api_key = sk-123456789012345678901234 and email: test@test.com';
      const result = pf.filter(text);
      const apiRedaction = result.redactions.find(r => r.rule === 'api_key');
      const emailRedaction = result.redactions.find(r => r.rule === 'email');
      expect(apiRedaction!.severity).toBe('critical');
      expect(emailRedaction!.severity).toBe('medium');
    });
  });

  describe('edge cases', () => {
    it('handles empty string', () => {
      const pf = makeFilter();
      const result = pf.filter('');
      expect(result.filtered).toBe('');
      expect(result.redactions).toHaveLength(0);
    });

    it('handles very long input', () => {
      const pf = makeFilter();
      const longText = 'A'.repeat(10000) + ' Email: user@test.com ' + 'B'.repeat(10000);
      const result = pf.filter(longText);
      expect(result.filtered).toContain('[REDACTED_EMAIL]');
      expect(result.redactions.length).toBe(1);
    });

    it('handles special characters in input', () => {
      const pf = makeFilter();
      const text = 'Special: \n\t\r\0 Email: user@test.com <private>secret</private>';
      const result = pf.filter(text);
      expect(result.filtered).toContain('[REDACTED_EMAIL]');
      expect(result.filtered).toContain('<private>[REDACTED]</private>');
    });

    it('handles repeated sensitive data', () => {
      const pf = makeFilter();
      const text = 'Email: a@a.com and Email: b@b.com';
      const result = pf.filter(text);
      expect(result.filtered).toContain('[REDACTED_EMAIL]');
      expect(result.filtered).not.toContain('@');
      expect(result.redactions.length).toBe(2);
    });

    it('handles overlapping patterns (private tag containing email)', () => {
      const pf = makeFilter();
      const text = '<private>user@test.com secret</private>';
      const result = pf.filter(text);
      expect(result.filtered).not.toContain('user@test.com');
      expect(result.filtered).toContain('<private>[REDACTED]</private>');
    });
  });
});
