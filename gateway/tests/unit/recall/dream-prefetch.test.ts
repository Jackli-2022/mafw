import { selectDreamSessions, parseDreamQueries } from '../../../src/recall/dream-prefetch';

describe('selectDreamSessions', () => {
  const turn = (sid: string, ageH: number) => ({
    session_id: sid, turn_id: 1, status: 'completed',
    last_ts: Date.now() / 1000 - ageH * 3600,
  });
  test('picks sessions active within 24h, excludes internal roles, top 5 by recency', () => {
    const turns = [
      turn('s-recent', 1), turn('s-old', 30), turn('s-internal', 2),
      ...Array.from({ length: 6 }, (_, i) => turn(`s-${i}`, i + 2)),
    ];
    const ids = selectDreamSessions(turns as any, {
      now: Date.now(), maxSessions: 5, windowMs: 24 * 3600_000,
      isInternal: (sid) => sid === 's-internal',
    });
    expect(ids).not.toContain('s-old');
    expect(ids).not.toContain('s-internal');
    expect(ids).toContain('s-recent');
    expect(ids.length).toBeLessThanOrEqual(5);
  });
  test('empty input → empty', () => {
    expect(selectDreamSessions([], { now: Date.now(), maxSessions: 5, windowMs: 86400_000, isInternal: () => false })).toEqual([]);
  });
});

describe('parseDreamQueries', () => {
  test('parses one query per line, trims, drops empties and >200 chars, caps at max', () => {
    const reply = '用户下次可能问 gateway 部署状态\n\n' + 'x'.repeat(300) + '\n记忆系统的预算帽生效了吗\n第三条查询\n第四条查询';
    expect(parseDreamQueries(reply, 3)).toEqual([
      '用户下次可能问 gateway 部署状态',
      '记忆系统的预算帽生效了吗',
      '第三条查询',
    ]);
  });
  test('garbage → empty', () => {
    expect(parseDreamQueries('', 3)).toEqual([]);
    expect(parseDreamQueries('\n\n', 3)).toEqual([]);
  });
});
