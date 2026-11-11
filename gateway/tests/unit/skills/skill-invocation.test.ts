import { extractSkillInvocation, extractFailedSkillCall, observeSkillInvocation } from '../../../src/core/skills/skill-invocation';

const call = (tool: string, input: any, callID = 'call_1', sessionID = 's1') => ({
  type: 'tool.call',
  sessionID,
  properties: { tool, input, callID },
});

describe('skill invocation extraction', () => {
  test('extracts only the skill tool call with name and callID', () => {
    expect(extractSkillInvocation(call('skill', { name: 'mafw-plan' }))).toEqual({
      skillName: 'mafw-plan', callId: 'call_1', sessionId: 's1',
    });
    expect(extractSkillInvocation(call('bash', { name: 'mafw-plan' }))).toBeNull();
    expect(extractSkillInvocation(call('skill', { name: '   ' }))).toBeNull();
    expect(extractSkillInvocation(call('skill', { name: 'x' }, ''))).toBeNull();
  });

  test('supports skill/id fallback fields', () => {
    expect(extractSkillInvocation(call('skill', { skill: 'ms-a' }))?.skillName).toBe('ms-a');
    expect(extractSkillInvocation(call('skill', { id: 'ms-b' }))?.skillName).toBe('ms-b');
  });

  test('extracts failed tool results only when isError is true', () => {
    expect(extractFailedSkillCall({ type: 'tool.result', properties: { callID: 'call_1', isError: true } }))
      .toEqual({ callId: 'call_1' });
    expect(extractFailedSkillCall({ type: 'tool.result', properties: { callID: 'call_1', isError: false } }))
      .toBeNull();
    expect(extractFailedSkillCall({ type: 'tool.result', properties: { isError: true } })).toBeNull();
  });
});

describe('observeSkillInvocation', () => {
  function fakeDb() {
    return {
      recordSkillInvocation: jest.fn(() => true),
      markSkillInvocationFailed: jest.fn(() => true),
    };
  }

  test('records a skill call and ignores other tools', () => {
    const db = fakeDb();
    expect(observeSkillInvocation(db, call('skill', { name: 'ms-a' }))).toBe('recorded');
    expect(db.recordSkillInvocation).toHaveBeenCalledWith({
      skillName: 'ms-a', callId: 'call_1', sessionId: 's1',
    });
    expect(observeSkillInvocation(db, call('bash', { name: 'ms-a' }))).toBeNull();
  });

  test('marks only a matching tool result failure', () => {
    const db = fakeDb();
    expect(observeSkillInvocation(db, { type: 'tool.result', properties: { callID: 'call_1', isError: true } })).toBe('failed');
    expect(db.markSkillInvocationFailed).toHaveBeenCalledWith('call_1');
    db.markSkillInvocationFailed.mockReturnValue(false);
    expect(observeSkillInvocation(db, { type: 'tool.result', properties: { callID: 'other', isError: true } })).toBeNull();
  });

  test('is fail-open when the store throws', () => {
    const db = {
      recordSkillInvocation: () => { throw new Error('db down'); },
      markSkillInvocationFailed: () => { throw new Error('db down'); },
    };
    expect(observeSkillInvocation(db, call('skill', { name: 'ms-a' }))).toBeNull();
    expect(observeSkillInvocation(db, { type: 'tool.result', properties: { callID: 'c', isError: true } })).toBeNull();
  });
});
