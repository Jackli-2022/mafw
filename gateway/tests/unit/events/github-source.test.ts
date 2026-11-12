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

  test('does not apply PR labels to comments', async () => {
    const fetchImpl = fetchRoutes({
      '/issues?': [],
      '/comments?': [{
        id: 9,
        body: 'looks good',
        issue_url: 'https://api.github.com/repos/acme/app/issues/42',
        updated_at: '2026-11-10T00:00:02.000Z',
        user: { login: 'alice' },
      }],
    });

    const out = await pollGitHubSource({
      projectDir: '/p',
      sourceId: 's1',
      config: { repo: 'acme/app', labels: ['review'] },
      fetchImpl,
      now: () => '2026-11-10T00:00:03.000Z',
    });

    expect(out.envelopes).toHaveLength(1);
    expect(out.envelopes[0]).toMatchObject({ kind: 'issue_comment', externalKey: 'acme/app#42' });
  });

  test('skips malformed and bot comments but advances to the newest cursor', async () => {
    const fetchImpl = fetchRoutes({
      '/issues?': [],
      '/comments?': [
        {
          id: 1,
          body: 'bot noise',
          issue_url: 'https://api.github.com/repos/acme/app/issues/42',
          updated_at: '2026-11-10T00:00:01.000Z',
          user: { login: 'dependabot[bot]', type: 'Bot' },
        },
        {
          id: 2,
          body: 'no issue number',
          issue_url: '',
          updated_at: '2026-11-10T00:00:02.000Z',
          user: { login: 'alice' },
        },
        {
          id: 3,
          body: 'valid',
          issue_url: 'https://api.github.com/repos/acme/app/issues/43',
          updated_at: '2026-11-10T00:00:03.000Z',
          user: { login: 'alice' },
        },
      ],
    });

    const out = await pollGitHubSource({
      projectDir: '/p',
      sourceId: 's1',
      config: { repo: 'acme/app' },
      fetchImpl,
      now: () => '2026-11-10T00:00:04.000Z',
    });

    expect(out.envelopes).toHaveLength(1);
    expect(out.envelopes[0]).toMatchObject({ kind: 'issue_comment', externalKey: 'acme/app#43' });
    expect(out.cursor.commentsSince).toBe('2026-11-10T00:00:03.000Z');
  });
});
