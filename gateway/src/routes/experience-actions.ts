import * as http from 'http';
import {
  EXPERIENCE_VERSION,
  MIN_CLIENT_EXPERIENCE_VERSION,
  type ActionDescriptor,
  type ExperienceActionId,
} from '../experience/experience-contract';
import type { ExperienceProjectionContext } from '../experience/experience-projector';
import type { ExperienceProjectionWorktree } from '../experience/experience-projector';

export interface ExperienceActionsDeps {
  project(ctx: ExperienceProjectionContext): Record<ExperienceActionId, ActionDescriptor>;
  isBusy?(sessionID: string): boolean;
  /** 目录级 worktree 可用性（git 工作区探测）；deps 注入便于单测。 */
  worktreeAvailability?(directory: string): Promise<ExperienceProjectionWorktree>;
}

function json(res: http.ServerResponse, status: number, payload: unknown): void {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(payload));
}

export async function handleExperienceActions(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  url: string,
  deps: ExperienceActionsDeps,
): Promise<boolean> {
  if (req.method !== 'GET' || !/^\/api\/experience\/actions(?:\?|$)/.test(url)) return false;
  const query = url.includes('?') ? new URLSearchParams(url.slice(url.indexOf('?') + 1)) : new URLSearchParams();
  const sessionID = query.get('sessionID') ?? undefined;
  const directory = query.get('directory') ?? undefined;
  const worktree = directory && deps.worktreeAvailability
    ? await deps.worktreeAvailability(directory)
    : undefined;
  const actions = deps.project({
    sessionID,
    busy: sessionID ? deps.isBusy?.(sessionID) === true : false,
    ...(worktree ? { worktree } : {}),
  });
  json(res, 200, {
    experienceVersion: EXPERIENCE_VERSION,
    minClientVersion: MIN_CLIENT_EXPERIENCE_VERSION,
    ...(sessionID ? { sessionID } : {}),
    actions,
  });
  return true;
}
