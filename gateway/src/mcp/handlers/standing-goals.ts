import * as path from 'path';
import type { StandingGoalService } from '../../core/standing/standing-service';
import type { StandingGoal } from '../../core/standing/standing-types';

type ToolResult = {
  content: Array<{ type: 'text'; text: string }>;
  isError?: boolean;
};

function errorPayload(error: unknown): Record<string, unknown> {
  return {
    success: false,
    ...(typeof (error as any)?.status === 'number' ? { status: (error as any).status } : {}),
    error: String((error as any)?.message ?? error),
  };
}

function ok(payload: Record<string, unknown>): ToolResult {
  return { content: [{ type: 'text', text: JSON.stringify({ success: true, ...payload }) }] };
}

function fail(error: unknown): ToolResult {
  return {
    content: [{ type: 'text', text: JSON.stringify(errorPayload(error)) }],
    isError: true,
  };
}

export interface StandingGoalToolDeps {
  service?: Pick<StandingGoalService, 'create' | 'update' | 'list' | 'runNow'> | null;
  projectDir?: () => string;
  enabled?: () => boolean;
  isProjectDir?: (dir: string) => boolean;
}

function serviceOf(deps: StandingGoalToolDeps): Pick<StandingGoalService, 'create' | 'update' | 'list' | 'runNow'> {
  if (deps.enabled && !deps.enabled()) {
    throw Object.assign(new Error('standing goals disabled'), { status: 503 });
  }
  if (!deps.service) throw Object.assign(new Error('standing goals service unavailable'), { status: 503 });
  return deps.service;
}

export function createStandingGoalTool(deps: StandingGoalToolDeps) {
  return {
    async execute(args: any, _ctx: { sessionID?: string }): Promise<ToolResult> {
      try {
        const projectDir = String(args?.projectDir ?? deps.projectDir?.() ?? process.cwd());
        if (deps.isProjectDir && !deps.isProjectDir(projectDir)) {
          throw Object.assign(new Error('projectDir is not a registered project'), { status: 400 });
        }
        const goal = serviceOf(deps).create({
          projectDir,
          title: String(args?.title ?? ''),
          objective: String(args?.objective ?? ''),
          template: args?.template ?? {},
          triggers: args?.triggers ?? [],
          concurrency: args?.concurrency,
          cooldownMs: args?.cooldownMs,
          budget: args?.budget,
          approval: args?.approval,
          createdBy: args?.createdBy ?? _ctx?.sessionID ?? null,
        });
        return ok({ goal });
      } catch (err) {
        return fail(err);
      }
    },
  };
}

export function updateStandingGoalTool(deps: StandingGoalToolDeps) {
  return {
    async execute(args: any, _ctx: { sessionID?: string }): Promise<ToolResult> {
      try {
        const goal = serviceOf(deps).update(String(args?.id ?? ''), args?.patch ?? args ?? {});
        return ok({ goal });
      } catch (err) {
        return fail(err);
      }
    },
  };
}

export function listStandingGoalsTool(deps: StandingGoalToolDeps) {
  return {
    async execute(args: any, _ctx: { sessionID?: string }): Promise<ToolResult> {
      try {
        return ok({ items: serviceOf(deps).list(String(args?.projectDir ?? deps.projectDir?.() ?? process.cwd())) });
      } catch (err) {
        return fail(err);
      }
    },
  };
}

export function runStandingGoalTool(deps: StandingGoalToolDeps) {
  return {
    async execute(args: any, _ctx: { sessionID?: string }): Promise<ToolResult> {
      try {
        const run = await serviceOf(deps).runNow(String(args?.id ?? ''), args?.payload ?? {});
        return run ? ok({ run }) : { content: [{ type: 'text', text: JSON.stringify({ success: false, error: 'run not admitted' }) }], isError: true };
      } catch (err) {
        return fail(err);
      }
    },
  };
}

function depsFromServices(services: any): StandingGoalToolDeps {
  const projectDir = typeof services?.projectDir === 'function'
    ? services.projectDir()
    : services?.projectDir;
  return {
    service: services?.standingGoals ?? services?.standingGoalService ?? null,
    projectDir: () => String(projectDir ?? process.env.MAFW_PROJECT_DIR ?? process.cwd()),
    enabled: () => process.env.MAFW_STANDING_GOALS === '1',
    isProjectDir: (dir: string) => {
      const target = path.resolve(dir).toLowerCase();
      const projects: Array<{ projectDir?: string }> = services?.listProjects?.() ?? [];
      return projects.some((project) => project?.projectDir && path.resolve(project.projectDir).toLowerCase() === target);
    },
  };
}

export const handleCreateStandingGoal = async (args: any, services: any) =>
  createStandingGoalTool(depsFromServices(services)).execute(args, { sessionID: args?.sessionID });
export const handleUpdateStandingGoal = async (args: any, services: any) =>
  updateStandingGoalTool(depsFromServices(services)).execute(args, { sessionID: args?.sessionID });
export const handleListStandingGoals = async (args: any, services: any) =>
  listStandingGoalsTool(depsFromServices(services)).execute(args, { sessionID: args?.sessionID });
export const handleRunStandingGoal = async (args: any, services: any) =>
  runStandingGoalTool(depsFromServices(services)).execute(args, { sessionID: args?.sessionID });
