/**
 * T2-1 turn.completed 自动检查点编排。
 *
 * 抽成独立函数（deps 注入）以便单测；gateway 侧只负责 fail-open 调用。
 * 门控顺序：能力位 → 内部角色 → session.get → isHiddenSession（含历史
 * kv 角色表兜底）→ messages → plan → create。
 *
 * 语义见 auto-recorder：anchor=本回合 user、tree=pre-turn 树；纯对话
 * 回合照记（tree=null），session 档仍可用。
 */
import type { SessionCheckpoint } from './checkpoint-service';
import { parseUntrackedLines, planAutoCheckpoint } from './auto-recorder';

export interface AutoCheckpointHookDeps {
  runtime(): {
    capabilities?: { checkpointApi?: boolean };
    session: {
      get(opts: { sessionID: string }): Promise<any>;
      messages(opts: { sessionID: string; limit?: number }): Promise<{ data: any[] }>;
    };
  } | null;
  internalRoleOf(sessionID: string): string | undefined;
  isHidden(info: any, roleFor: (id: string) => string | undefined): boolean;
  porcelainOf(projectDir: string): Promise<string>;
  create(input: {
    sessionID: string;
    projectDir: string;
    anchorMessageID: string;
    snapshotTree: string | null;
    untracked: string[];
    kind: 'auto';
  }): SessionCheckpoint;
}

export async function runAutoCheckpoint(
  deps: AutoCheckpointHookDeps,
  sessionID: string,
): Promise<SessionCheckpoint | null> {
  const rt = deps.runtime();
  if (rt?.capabilities?.checkpointApi !== true) return null;

  // 内部 worker（turnCompress / curator / btw / media）不记录；**manager 是可见会话**，
  // 照常记录（设计明确）。历史 kv 角色表里的 manager 同样放行。
  const role = deps.internalRoleOf(sessionID);
  if (role && role !== 'manager') return null;

  const info = await rt.session.get({ sessionID });
  if (!info) return null;

  let hidden = false;
  try {
    hidden = deps.isHidden(info, (id) => deps.internalRoleOf(id));
  } catch { hidden = false; }
  if (hidden) return null;

  const projectDir = info.directory ?? info.location?.directory;
  if (typeof projectDir !== 'string' || !projectDir) return null;

  const result = await rt.session.messages({ sessionID, limit: 200 });
  const plan = planAutoCheckpoint(Array.isArray(result?.data) ? result.data : []);
  if (!plan) return null;

  let untracked: string[] = [];
  try {
    untracked = parseUntrackedLines(await deps.porcelainOf(projectDir));
  } catch { untracked = []; }

  return deps.create({
    sessionID,
    projectDir,
    anchorMessageID: plan.anchorMessageID,
    snapshotTree: plan.snapshotTree,
    untracked,
    kind: 'auto',
  });
}
