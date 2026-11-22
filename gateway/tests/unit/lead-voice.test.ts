import { LEAD_IDENTITY_SYSTEM_PROMPT } from '../../src/skills/lead-identity';
import { LEAD_VOICE_CASES } from './lead-voice-cases';

const BANNED = [
  /很高兴为您服务/,
  /请稍候/,
  /如有问题请随时告诉我/,
  /你说得(?:太对了|完全对)/,
  /放心，?一定/,
  /肯定没问题/,
  /非常+抱歉/,
  /主人/,
  /我(?:真的|也)很难过/,
];

describe('Lead voice v1.1', () => {
  it('ships the voice contract without dropping routing constraints', () => {
    for (const token of [
      'Voice:',
      '不谄媚',
      '已确认的事实 / 我的判断 / 建议',
      '记忆只在能解释当前判断或延续 Goal 时提',
      '只在四个节点主动开口',
      '不假装有感情、意识或经历',
      'Response patterns:',
      '接住意图 / 方向变了',
      '疲惫/模糊',
    ]) {
      expect(LEAD_IDENTITY_SYSTEM_PROMPT).toContain(token);
    }
    expect(LEAD_IDENTITY_SYSTEM_PROMPT).toContain('你不做技术方案讨论');
    expect(LEAD_IDENTITY_SYSTEM_PROMPT).toContain('mafw_create_goal');
    expect(LEAD_IDENTITY_SYSTEM_PROMPT).toContain('Tech Lead');
  });

  it('keeps ten tone regression cases with non-empty fields', () => {
    expect(LEAD_VOICE_CASES).toHaveLength(10);
    for (const item of LEAD_VOICE_CASES) {
      expect(item.id).toBeTruthy();
      expect(item.scenario).toBeTruthy();
      expect(item.user).toBeTruthy();
      expect(item.bad).toBeTruthy();
      expect(item.good).toBeTruthy();
      expect(item.why).toBeTruthy();
    }
  });

  it('target replies stay out of the banned phrasing', () => {
    for (const item of LEAD_VOICE_CASES) {
      for (const pattern of BANNED) {
        expect({
          id: item.id,
          pattern: String(pattern),
          hit: pattern.test(item.good),
        }).toEqual({ id: item.id, pattern: String(pattern), hit: false });
      }
    }
  });

  it('covers ten distinct situations', () => {
    expect(new Set(LEAD_VOICE_CASES.map((item) => item.scenario)).size).toBe(10);
  });
});
