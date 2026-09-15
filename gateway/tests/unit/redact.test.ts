import { redactSecrets } from '../../src/recall/redact';

describe('redactSecrets', () => {
  test('redacts OpenAI-style sk- keys', () => {
    const input = 'key is sk-abcdefghij0123456789abcd ok';
    expect(redactSecrets(input)).toBe('key is [REDACTED] ok');
  });

  test('redacts openrouter/dashscope style keys with extra segments', () => {
    expect(redactSecrets('sk-or-v1-abcdef0123456789abcdef0123456789')).toBe('[REDACTED]');
    expect(redactSecrets('sk-ant-api03-abcdef0123456789')).toBe('[REDACTED]');
  });

  test('redacts Bearer tokens', () => {
    const input = 'Authorization: Bearer eyJhbGciOiJIUzI1NiJ9abc';
    expect(redactSecrets(input)).toBe('Authorization: Bearer [REDACTED]');
  });

  test('redacts GitHub token formats', () => {
    expect(redactSecrets('ghp_0123456789abcdefghijklmn')).toBe('[REDACTED]');
    expect(redactSecrets('github_pat_11ABCDE0123456789_abcdefghij0123456789')).toBe('[REDACTED]');
  });

  test('redacts Google/AWS/Slack key formats', () => {
    expect(redactSecrets('AIza0123456789abcdefghij0123456789abcde')).toBe('[REDACTED]');
    expect(redactSecrets('AKIA0123456789ABCDEF')).toBe('[REDACTED]');
    expect(redactSecrets('xoxb-1234567890-abcdefghijkl')).toBe('[REDACTED]');
  });

  test('redacts JWTs', () => {
    const jwt = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJVadQssw5c';
    expect(redactSecrets(`token=${jwt}`)).toBe('token=[REDACTED]');
  });

  test('redacts key=value secret forms', () => {
    expect(redactSecrets('api_key=supersecretvalue123')).toBe('api_key=[REDACTED]');
    expect(redactSecrets('"apiKey": "supersecretvalue123"')).toBe('"apiKey": "[REDACTED]"');
    expect(redactSecrets('password: hunter2hunter2')).toBe('password: [REDACTED]');
    expect(redactSecrets('access_token = tok_abcdefghijklm')).toBe('access_token = [REDACTED]');
  });

  test('redacts multiple secrets in one string', () => {
    const input = 'a sk-abcdefghij0123456789abcd b Bearer abcdefghijklmn c';
    const out = redactSecrets(input);
    expect(out).not.toContain('sk-abcdefghij');
    expect(out).not.toContain('abcdefghijklmn');
  });

  test('leaves ordinary prose and short values intact', () => {
    const prose = [
      'token budget is 128000 for this model',
      'pref:ui-language=chinese',
      'date:2026-09 and date:2026-10',
      'the secret sauce is teamwork',
      'password length must be 8+ characters',
      'see secrets.* reference in the workflow docs',
    ];
    for (const line of prose) {
      expect(redactSecrets(line)).toBe(line);
    }
  });

  test('handles empty string', () => {
    expect(redactSecrets('')).toBe('');
  });
});
