import {
  projectLeadSessionMetadata,
  clearManagerSlot,
  clearSlotsForSession,
  readManagerSlot,
  writeManagerSlot,
  resolveManagerRuntime,
  backfillManagerSlot,
} from '../../src/core/manager/manager-session-runtime';

const OC = { sessionId: 'ses_f60d', createdAt: '2026-09-14T09:07:10.054Z' };
const PI = { sessionId: 'pi_9f2c', createdAt: '2026-09-16T03:00:00.000Z' };

describe('manager-session per-runtime slots', () => {
  it('resolveManagerRuntime: explicit tag only — session id prefixes are not ownership evidence', () => {
    expect(resolveManagerRuntime({ sessionId: 'ses_x', runtime: 'pi' })).toBe('pi');
    // opencode / pi 的 id 前缀是 runtime 私有命名约定，不得用于归属推断。
    expect(resolveManagerRuntime({ id: 'ses_abc' })).toBeNull();
    expect(resolveManagerRuntime({ id: 'pi_0023' })).toBeNull();
    expect(resolveManagerRuntime({ sessionId: 'weird_1' })).toBeNull();
    expect(resolveManagerRuntime({ runtime: '   ' })).toBeNull();
    expect(resolveManagerRuntime({})).toBeNull();
  });

  it('clearManagerSlot removes only the active runtime while preserving others', () => {
    const v2 = { byRuntime: { opencode: OC, pi: PI } };
    const cleared = clearManagerSlot(v2, 'opencode') as any;
    expect(cleared.byRuntime).toEqual({ pi: PI });
    expect(readManagerSlot(cleared, 'opencode')).toBeNull();
    expect(readManagerSlot(cleared, 'pi')).toEqual(PI);
  });

  it('clearSlotsForSession clears every row pointing at the archived session (current runtime only)', () => {
    const rows = [
      { key: '/proj/a', value: { byRuntime: { opencode: { sessionId: 'ses_old' }, pi: PI } } },
      { key: '/proj/b', value: { byRuntime: { opencode: { sessionId: 'ses_other' } } } },
      { key: '/proj/c', value: { sessionId: 'ses_old', runtime: 'opencode', createdAt: OC.createdAt } },
    ];
    const cleared = clearSlotsForSession(rows, 'ses_old', 'opencode');
    expect(cleared.map((r) => r.key)).toEqual(['/proj/a', '/proj/c']);
    expect(readManagerSlot(cleared[0].value, 'opencode')).toBeNull();
    expect(readManagerSlot(cleared[0].value, 'pi')).toEqual(PI);
    expect(readManagerSlot(cleared[1].value, 'opencode')).toBeNull();
  });

  it('readManagerSlot: v2 returns the active runtime slot', () => {
    const v2 = { byRuntime: { opencode: OC, pi: PI } };
    expect(readManagerSlot(v2, 'opencode')).toEqual(OC);
    expect(readManagerSlot(v2, 'pi')).toEqual(PI);
    expect(readManagerSlot(v2, 'gemini')).toBeNull();
  });

  it('readManagerSlot: untagged v1 legacy stays dormant (no guessing)', () => {
    expect(readManagerSlot({ sessionId: 'ses_f60d', createdAt: OC.createdAt }, 'opencode')).toBeNull();
    expect(readManagerSlot({ sessionId: 'pi_9f2c' }, 'pi')).toBeNull();
  });

  it('readManagerSlot: tagged v1 legacy resolves to its explicit runtime only', () => {
    expect(readManagerSlot({ sessionId: 'pi_9f2c', runtime: 'pi' }, 'pi')).toEqual({ sessionId: 'pi_9f2c' });
    expect(readManagerSlot({ sessionId: 'pi_9f2c', runtime: 'pi' }, 'opencode')).toBeNull();
  });

  it('readManagerSlot: empty/malformed values yield null', () => {
    expect(readManagerSlot(null, 'pi')).toBeNull();
    expect(readManagerSlot({}, 'pi')).toBeNull();
    expect(readManagerSlot({ byRuntime: {} }, 'pi')).toBeNull();
  });

  it('writeManagerSlot: tagged v1 legacy migrates into its own slot, current slot set', () => {
    const out = writeManagerSlot({ sessionId: 'ses_f60d', runtime: 'opencode', createdAt: OC.createdAt }, 'pi', PI);
    expect(out.byRuntime.opencode).toEqual(OC);
    expect(out.byRuntime.pi).toEqual(PI);
    expect(out.unattributed).toBeUndefined();
  });

  it('writeManagerSlot: untagged v1 legacy is preserved as unattributed (never guessed, never dropped)', () => {
    const out = writeManagerSlot({ sessionId: 'ses_f60d', createdAt: OC.createdAt }, 'pi', PI);
    expect(out.byRuntime).toEqual({ pi: PI });
    expect(out.unattributed).toEqual(OC);
  });

  it('writeManagerSlot: v2 keeps other slots and replaces only the current one (rotate)', () => {
    const v2 = { byRuntime: { opencode: OC, pi: PI } };
    const rotated = { sessionId: 'pi_aaaa', createdAt: '2026-09-16T04:00:00.000Z' };
    const out = writeManagerSlot(v2, 'pi', rotated);
    expect(out.byRuntime.opencode).toEqual(OC); // untouched
    expect(out.byRuntime.pi).toEqual(rotated);  // replaced
  });

  it('writeManagerSlot: v2 keeps the unattributed legacy entry across writes', () => {
    const v2 = { byRuntime: { opencode: OC }, unattributed: PI };
    const rotated = { sessionId: 'ses_new', createdAt: '2026-09-17T00:00:00.000Z' };
    const out = writeManagerSlot(v2, 'opencode', rotated);
    expect(out.byRuntime.opencode).toEqual(rotated);
    expect(out.unattributed).toEqual(PI);
  });

  it('writeManagerSlot: fresh entry (no existing value) creates a single slot', () => {
    const out = writeManagerSlot(null, 'opencode', OC);
    expect(out.byRuntime).toEqual({ opencode: OC });
  });
});

// Task 2（spec 2026-11-02-pod-collaborative-goal-loop §3.1）：Manager 的 kv 槽位名保留
// （`manager-session` / readManagerSlot），但会话对外的身份是 Lead——元数据写 `role:'lead'`，
// 老的 `manager` / `manager-archived` 行只作为兼容读取路径存在。
// Review I3：单 runtime 时代的 legacy 行没有 tag，读路径（正确地）不猜归属——
// 于是迁移进来的行永远休眠，新会话顶掉旧 topic 后旧 topic 又"复活"。
// 一次性 backfill 把存量行按「旧 writer = opencode」打标；读路径规则不变。
describe('backfillManagerSlot（一次性归属补齐）', () => {
  it('untagged v1（迁移写下的形状）→ byRuntime.opencode（读得到，不再休眠）', () => {
    const out = backfillManagerSlot({ sessionId: 'ses_f60d', createdAt: OC.createdAt });
    expect(out.changed).toBe(true);
    expect(out.value).toEqual({ byRuntime: { opencode: OC } });
    expect(readManagerSlot(out.value, 'opencode')).toEqual(OC);
    // 其他 runtime 仍然读不到（没有伪造归属）
    expect(readManagerSlot(out.value, 'pi')).toBeNull();
  });

  it('v2 的 unattributed（旧 write 保留下来的行）→ 提升为 opencode slot', () => {
    const out = backfillManagerSlot({ byRuntime: { pi: PI }, unattributed: OC });
    expect(out.changed).toBe(true);
    expect(out.value).toEqual({ byRuntime: { opencode: OC, pi: PI } });
    expect(readManagerSlot(out.value, 'opencode')).toEqual(OC);
    expect(readManagerSlot(out.value, 'pi')).toEqual(PI);
  });

  it('已有 opencode slot 时不覆盖真实状态（unattributed 原样保留）', () => {
    const existing = { byRuntime: { opencode: PI }, unattributed: OC };
    const out = backfillManagerSlot(existing);
    expect(out.changed).toBe(false);
    expect(out.value).toBe(existing);
  });

  it('tagged v1 归一到自己的 runtime 槽位', () => {
    const out = backfillManagerSlot({ sessionId: 'pi_9f2c', runtime: 'pi', createdAt: PI.createdAt });
    expect(out.changed).toBe(true);
    expect(out.value).toEqual({ byRuntime: { pi: PI } });
  });

  it('幂等：补齐后的值再跑一次不变；空/坏值原样返回', () => {
    const once = backfillManagerSlot({ sessionId: 'ses_x' }).value;
    expect(backfillManagerSlot(once)).toEqual({ value: once, changed: false });
    expect(backfillManagerSlot(null)).toEqual({ value: null, changed: false });
    expect(backfillManagerSlot({})).toEqual({ value: {}, changed: false });
    expect(backfillManagerSlot({ byRuntime: { opencode: OC } })).toEqual({
      value: { byRuntime: { opencode: OC } },
      changed: false,
    });
  });
});

// 迁移与启动兜底都必须走显式打标（不是读路径推断）
describe('migration wiring（legacy 文件导入按 opencode 打标）', () => {
  const fs = require('fs');
  const path = require('path');
  const migrateSrc = fs.readFileSync(
    path.join(__dirname, '../../src/recall/gateway-db-migrate.ts'),
    'utf-8',
  );
  const indexSrc = fs.readFileSync(path.join(__dirname, '../../src/index.ts'), 'utf-8');

  it('gateway-db-migrate 用 writeManagerSlot(..., "opencode", ...) 打标', () => {
    expect(migrateSrc).toContain("writeManagerSlot(existing, 'opencode', {");
    expect(migrateSrc).not.toMatch(/kvSet\('manager-session', ms\.projectDir, \{\s*sessionId:/);
  });

  it('启动时对存量 untagged 行做一次 backfill（fail-open）', () => {
    expect(indexSrc).toContain('this.backfillManagerSessionSlots()');
    expect(indexSrc).toContain('backfillManagerSlot(row.value)');
  });
});

describe('projectLeadSessionMetadata', () => {  it('marks the coordination session as the Lead, pinned and lifecycle-exempt', () => {
    expect(projectLeadSessionMetadata()).toMatchObject({ mafw: { role: 'lead', pinned: true } });
  });

  it('keeps the exemption flags the manager session always had', () => {
    expect(projectLeadSessionMetadata().mafw).toMatchObject({
      exemptFromTrim: true,
      exemptFromEvict: true,
      exemptFromArchive: true,
    });
  });

  it('is a fresh object per call (metadata is handed to the session store)', () => {
    expect(projectLeadSessionMetadata()).not.toBe(projectLeadSessionMetadata());
    expect(projectLeadSessionMetadata()).toEqual(projectLeadSessionMetadata());
  });

  it('never labels the session with the deprecated manager role', () => {
    expect(projectLeadSessionMetadata().mafw.role).not.toBe('manager');
  });
});

// 注：原「读 src/index.ts 做源码正则」的接线断言已被行为测试取代——
// `listSessions` 的合并/隐藏口径现在由纯函数 `selectVisibleSessions` 承担，
// 四条路径（serve metadata / 本地独有 / 空合并回退 / 普通会话）见
// tests/unit/session-list-selection.test.ts。kv 键名与 readManagerSlot 的兼容性
// 由上面的槽位测试 + `writeManagerSlot` 用例钉住。
