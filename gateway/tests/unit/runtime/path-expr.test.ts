import { isValidPath, getPath, evalConditions, renderTemplate, setPath } from '../../../src/runtime/path-expr';

describe('isValidPath', () => {
  test.each(['$.type', '$.part.type', '$.a[0].b', '$.items[12]', '$.session-id'])('valid: %s', (p) => {
    expect(isValidPath(p)).toBe(true);
  });
  test.each(['type', '$.a b', '$.a[', '$..a', '$.a;alert(1)', '$.a[(...)]', ''])('reject: %s', (p) => {
    expect(isValidPath(p)).toBe(false);
  });
});

describe('getPath', () => {
  const obj = { part: { type: 'step-finish', list: [{ id: 'x' }] }, n: 0, s: '' };
  test('nested + index', () => {
    expect(getPath(obj, '$.part.type')).toBe('step-finish');
    expect(getPath(obj, '$.part.list[0].id')).toBe('x');
  });
  test('missing → undefined（不抛）', () => {
    expect(getPath(obj, '$.part.missing.deep')).toBeUndefined();
    expect(getPath(null, '$.a')).toBeUndefined();
    expect(getPath(obj, 'not-a-path')).toBeUndefined();
  });
  test('falsy 值原样返回', () => {
    expect(getPath(obj, '$.n')).toBe(0);
    expect(getPath(obj, '$.s')).toBe('');
  });
});

describe('evalConditions', () => {
  const raw = { part: { type: 'step-finish' }, time: { completed: 123 }, s: '' };
  test('undefined/空数组 → true', () => {
    expect(evalConditions(undefined, raw)).toBe(true);
    expect(evalConditions([], raw)).toBe(true);
  });
  test('equals', () => {
    expect(evalConditions([{ path: '$.part.type', equals: 'step-finish' }], raw)).toBe(true);
    expect(evalConditions([{ path: '$.part.type', equals: 'text' }], raw)).toBe(false);
  });
  test('exists = truthy（空串/0 不算存在——对齐 normalize 现状 `||` 语义）', () => {
    expect(evalConditions([{ path: '$.time.completed', exists: true }], raw)).toBe(true);
    expect(evalConditions([{ path: '$.s', exists: true }], raw)).toBe(false);
    expect(evalConditions([{ path: '$.missing', exists: true }], raw)).toBe(false);
  });
  test('多条件 AND', () => {
    expect(evalConditions([
      { path: '$.part.type', equals: 'step-finish' },
      { path: '$.time.completed', exists: true },
    ], raw)).toBe(true);
  });
});

describe('renderTemplate', () => {
  test('插值', () => {
    expect(renderTemplate('pi_step_{$.sessionID}', { sessionID: 'abc' })).toBe('pi_step_abc');
  });
  test('路径不存在 → undefined（EventBridge 语义：字段不创建）', () => {
    expect(renderTemplate('pi_step_{$.missing}', {})).toBeUndefined();
  });
  test('非字符串值 String() 化', () => {
    expect(renderTemplate('n={$.n}', { n: 42 })).toBe('n=42');
  });
});

describe('setPath', () => {
  test('构造嵌套', () => {
    const o: Record<string, any> = {};
    setPath(o, 'part.type', 'text');
    setPath(o, 'part.text', 'hi');
    expect(o).toEqual({ part: { type: 'text', text: 'hi' } });
  });
});
