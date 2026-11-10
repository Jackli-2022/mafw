import { pollGitHubSource } from '../../../src/core/events/sources/github-source';

function fetchRoutes(routes: Record<string, unknown>) {
  return jest.fn(async (url: string) => {
    const key = Object.keys(routes).find((part) => String(url).includes(part));
    if (!key) return { ok: true, json: async () => [] } as any;
    return { ok: true, json: async () => routes[key] } as any;
  }) as any;
}

describe('pollGitHubSource', () => {
  test('normalizes an opened PR and advances the issue cursor', async () => {
    const fetchImpl = fetchRoutes({
      '/issues?': [{
        number: 42,
        title: 'Fix',
        state: 'open',
        updated_at: '2026-11-10T00:00:02.000Z',
        created_at: '2026-11-10T00:00:00.000Z',
        user: { login: 'alice' },
        labels: [{ name: 'review' }],
        pull_request: { html_url: 'https://github.com/acme/app/pull/42' },
      }],
    });

    const out = await pollGitHubSource({
      projectDir: '/p',
      sourceId: 's1',
      config: { repo: 'acme/app' },
      fetchImpl,
      now: () => '2026-11-10T00:00:03.000Z',
    });

    expect(out.envelopes[0]).toMatchObject({ kind: 'pr_opened', externalKey: 'acme/app#42' });
    expect(out.cursor.issuesSince).toBe('2026-11-10T00:00:02.000Z');
  });

  test('ignores bot authors and filtered labels', async () => {
    const fetchImpl = fetchRoutes({
      '/issues?': [
        { number: 1, title: 'x', updated_at: '2026-11-10T00:00:02.000Z', user: { login: 'dependabot[bot]' }, pull_request: {}, labels: [] },
        { number: 2, title: 'y', updated_at: '2026-11-10T00:00:02.000Z', user: { login: 'alice' }, pull_request: {}, labels: [{ name: 'skip' }] },
      ],
    });

    const out = await pollGitHubSource({
      projectDir: '/p',
      sourceId: 's1',
      config: { repo: 'acme/app', authors: ['alice'], labels: ['review'] },
      fetchImpl,
      now: () => '2026-11-10T00:00:00.000Z',
    });

    expect(out.envelopes).toEqual([]);
  });
});
