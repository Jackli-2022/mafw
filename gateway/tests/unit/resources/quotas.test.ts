/**
 * E4-7 项目/会话配额（spec §4.7）。
 *
 * 配额只提供机制与可观测：默认值偏高、`0` = 不限，拒绝路径由各入口映射 429。
 * 判定 `current < limit`（达到上限即拒绝）：limit=2 时第 2 个新增被拒。
 * snapshot 出口把非有限 limit 归一化为 0（JSON 里 `Infinity`/`NaN` 会变成 null）。
 */
import { QuotaExceededError, QuotaService, projectAdmission, type QuotaResource } from '../../../src/resources/quotas';

type Limits = Record<QuotaResource, number>;

function service(over: Partial<Limits> = {}): QuotaService {
  return new QuotaService({
    limits: (): Limits => ({ projects: 128, sessions: 1000, sessionRecordsPerProject: 200, ...over }),
  });
}

describe('QuotaService: check boundaries', () => {
  it('accepts below the limit and rejects at/above it', () => {
    const quotas = service({ projects: 2 });
    expect(quotas.check('projects', 0)).toEqual({ ok: true, limit: 2, current: 0 });
    expect(quotas.check('projects', 1)).toEqual({ ok: true, limit: 2, current: 1 });
    expect(quotas.check('projects', 2)).toEqual({ ok: false, limit: 2, current: 2 });
    expect(quotas.check('projects', 3)).toEqual({ ok: false, limit: 2, current: 3 });
  });

  it('treats 0 / negative / NaN as unlimited, normalizing the raw limit to 0', () => {
    for (const raw of [0, -1, NaN]) {
      const quotas = service({ sessions: raw });
      expect(quotas.check('sessions', 1_000_000)).toEqual({ ok: true, limit: 0, current: 1_000_000 });
      expect(() => quotas.assert('sessions', 1_000_000)).not.toThrow();
    }
  });

  it('normalizes Infinity / non-number raw limits to 0 on check too', () => {
    for (const raw of [Infinity, -Infinity, '10' as never, undefined as never]) {
      const quotas = service({ sessions: raw });
      expect(quotas.check('sessions', 1_000_000)).toEqual({ ok: true, limit: 0, current: 1_000_000 });
    }
  });

  it('floors positive finite limits so the wire value matches enforcement', () => {
    const quotas = service({ projects: 12.5, sessions: 0.5 });
    // 12.5 → 12：snapshot 与 limitOf 判定同值。
    expect(quotas.check('projects', 0)).toEqual({ ok: true, limit: 12, current: 0 });
    expect(quotas.check('projects', 11)).toEqual({ ok: true, limit: 12, current: 11 });
    expect(quotas.check('projects', 12)).toEqual({ ok: false, limit: 12, current: 12 });
    expect(quotas.snapshot({ projects: 1 }).projects).toEqual({ current: 1, limit: 12 });
    // 0.5 → 0：不足 1 的上限按"不限"处理（若原样保留，limitOf 会 floor 成 0 并拒绝一切）。
    expect(quotas.check('sessions', 1_000_000)).toEqual({ ok: true, limit: 0, current: 1_000_000 });
  });

  it('re-reads limits on every call (hot reload)', () => {
    let limit = 1;
    const quotas = new QuotaService({
      limits: () => ({ projects: limit, sessions: 0, sessionRecordsPerProject: 0 }),
    });
    expect(quotas.check('projects', 1).ok).toBe(false);
    limit = 2;
    expect(quotas.check('projects', 1).ok).toBe(true);
  });
});

describe('QuotaService: assert', () => {
  it('throws QuotaExceededError with resource/limit/current and stable code', () => {
    const quotas = service({ sessions: 2 });
    let err: any;
    try {
      quotas.assert('sessions', 2);
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(QuotaExceededError);
    expect(err).toBeInstanceOf(Error);
    expect(err.code).toBe('quota_exceeded');
    expect(err.resource).toBe('sessions');
    expect(err.limit).toBe(2);
    expect(err.current).toBe(2);
    expect(err.message).toContain('sessions');
  });

  it('does not throw below the limit', () => {
    expect(() => service({ sessions: 2 }).assert('sessions', 1)).not.toThrow();
  });
});

describe('QuotaService: snapshot', () => {
  it('reports an object keyed by resource with current + raw limit (0 = unlimited)', () => {
    const quotas = service({ projects: 128, sessions: 0 });
    expect(quotas.snapshot({ projects: 3, sessions: 7 })).toEqual({
      projects: { current: 3, limit: 128 },
      sessions: { current: 7, limit: 0 },
    });
  });

  it('includes every requested resource in canonical order, defaulting missing values', () => {
    const quotas = new QuotaService({ limits: () => ({ projects: 10 }) as never });
    const snap = quotas.snapshot({ sessionRecordsPerProject: 4, projects: 1 });
    expect(snap).toEqual({
      projects: { current: 1, limit: 10 },
      sessionRecordsPerProject: { current: 4, limit: 0 },
    });
    expect(Object.keys(snap)).toEqual(['projects', 'sessionRecordsPerProject']);
  });

  it('returns an empty object for an empty request', () => {
    expect(service().snapshot({})).toEqual({});
  });

  it('sanitizes non-finite and negative limits to 0 (unlimited) on the wire', () => {
    const quotas = new QuotaService({
      limits: () => ({ projects: Infinity, sessions: Number.NaN, sessionRecordsPerProject: -1 }) as never,
    });
    expect(quotas.snapshot({ projects: 1, sessions: 2, sessionRecordsPerProject: 3 })).toEqual({
      projects: { current: 1, limit: 0 },
      sessions: { current: 2, limit: 0 },
      sessionRecordsPerProject: { current: 3, limit: 0 },
    });
  });
});

describe('projectAdmission: duplicate registrations are not charged', () => {
  it('always admits an already-registered directory', () => {
    const quotas = service({ projects: 1 });
    expect(projectAdmission(quotas, false, 1)).toEqual({ ok: true, limit: 1, current: 1 });
  });

  it('applies the project quota only to new directories', () => {
    const quotas = service({ projects: 1 });
    expect(projectAdmission(quotas, true, 0).ok).toBe(true);
    expect(projectAdmission(quotas, true, 1)).toEqual({ ok: false, limit: 1, current: 1 });
  });
});
