import type { EventEnvelope } from '../event-types';
import { normalizeGitHubEvent } from '../event-normalize';

export interface GitHubSourceConfig {
  repo: string;
  token?: string;
  labels?: string[];
  branches?: string[];
  authors?: string[];
  cursor?: {
    issuesSince?: string;
    commentsSince?: string;
    reviewsSince?: string;
    checksSince?: string;
  };
}

export interface GitHubPollResult {
  envelopes: EventEnvelope[];
  cursor: NonNullable<GitHubSourceConfig['cursor']>;
}

const API = 'https://api.github.com';
const EPOCH = '1970-01-01T00:00:00.000Z';

function headers(config: GitHubSourceConfig): Record<string, string> {
  const out: Record<string, string> = {
    Accept: 'application/vnd.github+json',
    'User-Agent': 'mafw-gateway',
  };
  if (config.token) out.Authorization = `Bearer ${config.token}`;
  return out;
}

async function fetchJson(
  fetchImpl: typeof fetch,
  url: string,
  config: GitHubSourceConfig,
): Promise<any> {
  const response = await fetchImpl(url, { headers: headers(config) });
  if (!response.ok) throw new Error(`GitHub request failed: ${response.status} ${url}`);
  return response.json();
}

function labelNames(item: any): string[] {
  return Array.isArray(item?.labels)
    ? item.labels.map((label: any) => String(label?.name ?? label)).filter(Boolean)
    : [];
}

function passesFilters(item: any, config: GitHubSourceConfig, applyLabels = true): boolean {
  const login = String(item?.user?.login ?? item?.actor?.login ?? '');
  if (login.endsWith('[bot]') && !(config.authors ?? []).includes(login)) return false;
  if (config.authors?.length && !config.authors.includes(login)) return false;
  if (applyLabels && config.labels?.length) {
    const labels = labelNames(item);
    if (!labels.some((label) => config.labels!.includes(label))) return false;
  }
  if (config.branches?.length) {
    const branch = String(item?.base?.ref ?? item?.head?.ref ?? '');
    if (branch && !config.branches.includes(branch)) return false;
  }
  return true;
}

function maxIso(values: Array<string | undefined>, fallback?: string): string | undefined {
  const valid = values.filter((value): value is string => !!value).sort();
  return valid.at(-1) ?? fallback;
}

export async function pollGitHubSource(input: {
  projectDir: string;
  sourceId: string;
  config: GitHubSourceConfig;
  fetchImpl?: typeof fetch;
  now(): string;
}): Promise<GitHubPollResult> {
  const fetchImpl = input.fetchImpl ?? fetch;
  const config = input.config;
  const cursor: NonNullable<GitHubSourceConfig['cursor']> = { ...(config.cursor ?? {}) };
  const issuesSince = cursor.issuesSince ?? EPOCH;
  const commentsSince = cursor.commentsSince ?? EPOCH;
  const envelopes: EventEnvelope[] = [];

  const issuesUrl = `${API}/repos/${config.repo}/issues?state=all&sort=updated&direction=asc&per_page=100&since=${encodeURIComponent(issuesSince)}`;
  const issues = await fetchJson(fetchImpl, issuesUrl, config);
  for (const item of Array.isArray(issues) ? issues : []) {
    if (!passesFilters(item, config)) continue;
    const isPull = !!item.pull_request;
    const created = String(item.created_at ?? issuesSince);
    const opened = !cursor.issuesSince || created >= cursor.issuesSince;
    const number = Number(item.number);
    const updated = String(item.updated_at ?? input.now());
    envelopes.push(normalizeGitHubEvent({
      projectDir: input.projectDir,
      sourceId: input.sourceId,
      deliveryId: `poll:${config.repo}#${number}:${updated}`,
      event: isPull ? 'pull_request' : 'issues',
      action: isPull && !opened ? 'synchronize' : 'opened',
      repo: config.repo,
      number,
      actor: String(item.user?.login ?? '') || null,
      payload: {
        title: item.title,
        body: item.body,
        url: item.html_url,
        labels: labelNames(item),
        branch: item.pull_request?.base?.ref ?? item.pull_request?.head?.ref ?? null,
        pull_request: item.pull_request ?? null,
      },
      occurredAt: updated,
      receivedAt: input.now(),
    }));
  }
  cursor.issuesSince = maxIso(
    (Array.isArray(issues) ? issues : []).map((item: any) => String(item.updated_at ?? '')),
    issuesSince,
  );

  const commentsUrl = `${API}/repos/${config.repo}/issues/comments?sort=updated&direction=asc&per_page=100&since=${encodeURIComponent(commentsSince)}`;
  const comments = await fetchJson(fetchImpl, commentsUrl, config);
  for (const comment of Array.isArray(comments) ? comments : []) {
    if (!passesFilters(comment, config, false)) continue;
    const issueNumber = Number(String(comment.issue_url ?? '').split('/').at(-1));
    if (!Number.isFinite(issueNumber)) continue;
    const updated = String(comment.updated_at ?? comment.created_at ?? input.now());
    envelopes.push(normalizeGitHubEvent({
      projectDir: input.projectDir,
      sourceId: input.sourceId,
      deliveryId: `poll-comment:${comment.id}:${updated}`,
      event: 'issue_comment',
      action: 'created',
      repo: config.repo,
      number: issueNumber,
      actor: String(comment.user?.login ?? '') || null,
      payload: {
        body: comment.body,
        url: comment.html_url,
        issue_url: comment.issue_url,
      },
      occurredAt: updated,
      receivedAt: input.now(),
    }));
  }
  cursor.commentsSince = maxIso(
    (Array.isArray(comments) ? comments : []).map((comment: any) => String(comment.updated_at ?? comment.created_at ?? '')),
    commentsSince,
  );

  return { envelopes, cursor };
}
