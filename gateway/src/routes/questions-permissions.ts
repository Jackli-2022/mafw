/**
 * Phase D1 Task B1: question / permission 面（registry dispatch 接线）。
 *
 *   GET  /api/questions              — 待答问题清单（AskCard proxy → runtime session.question）
 *   POST /api/questions/:id/reply    — { answers: string[][] } + workspace 重试链
 *   POST /api/questions/:id/reject   — workspace 重试链
 *   GET  /api/permissions            — 待审批清单（PermissionCard proxy）
 *   POST /api/permissions/:id/reply  — 按 requestId 回复 → routes/permission
 *
 * handler 体从 index.ts legacy 分支逐字迁移；capGuard / capGuardQuestion 仍由
 * Gateway 提供（含 legacy nativeApprovals 兼容判断）。workspace 重试链顺序保持
 * [默认 location, projectDir, ...注册项目]。
 */
import type { IncomingMessage, ServerResponse } from 'http';
import { log } from '../core/utils/logger';
import { projectPermissionList, projectQuestionRequest } from '../runtime/view-projections';
import { handlePermissionReplyById, resolveApprovalDirectory, type PermissionReplyByIdDeps } from './permission';
import { readRouteBody } from './cognition';
import { requireHumanPrincipal } from '../core/http/human-guard';
import type { RouteRegistry } from './registry';
import type { RuntimeFacade } from '../runtime/runtime-facade';

export interface QuestionsPermissionsRouteDeps {
  /** Surface 门（legacy capGuardQuestion / capGuard 原样）。 */
  capGuard: (res: ServerResponse, surface: string) => boolean;
  capGuardQuestion: (res: ServerResponse) => boolean;
  serveUrl: () => string;
  currentProjectDir: () => string | null;
  projectDir: () => string;
  runtime: () => RuntimeFacade | null;
  registeredProjects: () => Map<string, unknown>;
  permissionRules: () => PermissionReplyByIdDeps['rules'];
}

export function attachQuestionsPermissionsRoutes(
  registry: RouteRegistry,
  deps: QuestionsPermissionsRouteDeps,
): void {
  // GET /api/questions ── list pending questions（契约：session.question.list）
  registry.attachHandler('questions.list', async (req: IncomingMessage, res: ServerResponse) => {
    if (deps.capGuardQuestion(res)) return;
    try {
      const dir = resolveApprovalDirectory({
        explicit: new URL(req.url!, deps.serveUrl()).searchParams.get('directory'),
        currentProjectDir: deps.currentProjectDir(),
        projectDir: deps.projectDir(),
      });
      const question = deps.runtime()?.session?.question;
      const items = question ? await question.list(dir ? { directory: dir } : undefined) : [];
      res.end(JSON.stringify({ items: (items ?? []).map((item: any) => projectQuestionRequest(item)) }));
    } catch (err: any) {
      log.error('[Question] list error:', err.message);
      res.end(JSON.stringify({ items: [] }));
    }
  });

  // POST /api/questions/{id}/reply ── { answers: string[][] }（契约 + workspace 重试）
  registry.attachHandler('questions.reply', async (req: IncomingMessage, res: ServerResponse, params: Record<string, string>) => {
    if (deps.capGuardQuestion(res)) return;
    const question = deps.runtime()?.session?.question;
    if (!question) {
      res.writeHead(503); res.end(JSON.stringify({ status: 'error', error: 'question API not available on this runtime' })); return;
    }
    try {
      const body = JSON.parse(await readRouteBody(req));
      // workspace 路由：默认（SDK 自带 projectDir）→ 各注册项目逐试
      const dirs: Array<string | undefined> = [undefined, deps.projectDir(), ...deps.registeredProjects().keys()];
      let lastErr: any = null;
      for (const dir of [...new Set(dirs)]) {
        try {
          await question.reply({ requestID: params.id, answers: body.answers, ...(dir ? { directory: dir } : {}) });
          res.end(JSON.stringify({ status: 'ok' }));
          return;
        } catch (err: any) { lastErr = err; }
      }
      res.writeHead(400);
      res.end(JSON.stringify({ status: 'error', error: lastErr?.message ?? 'question reply failed on all workspaces' }));
    } catch (err: any) {
      log.error('[Question] reply error:', err.message);
      res.writeHead(400);
      res.end(JSON.stringify({ status: 'error', error: err.message }));
    }
  });

  // POST /api/questions/{id}/reject（契约 + workspace 重试）
  registry.attachHandler('questions.reject', async (req: IncomingMessage, res: ServerResponse, params: Record<string, string>) => {
    if (deps.capGuardQuestion(res)) return;
    const question = deps.runtime()?.session?.question;
    if (!question) {
      res.writeHead(503); res.end(JSON.stringify({ status: 'error', error: 'question API not available on this runtime' })); return;
    }
    try {
      const dirs: Array<string | undefined> = [undefined, deps.projectDir(), ...deps.registeredProjects().keys()];
      let lastErr: any = null;
      for (const dir of [...new Set(dirs)]) {
        try {
          await question.reject({ requestID: params.id, ...(dir ? { directory: dir } : {}) });
          res.end(JSON.stringify({ status: 'ok' }));
          return;
        } catch (err: any) { lastErr = err; }
      }
      res.writeHead(400);
      res.end(JSON.stringify({ status: 'error', error: lastErr?.message ?? 'question reject failed on all workspaces' }));
    } catch (err: any) {
      log.error('[Question] reject error:', err.message);
      res.writeHead(400);
      res.end(JSON.stringify({ status: 'error', error: err.message }));
    }
  });

  // GET /api/permissions ── list pending permission requests（契约：session.permissionList）
  registry.attachHandler('permissions.list', async (req: IncomingMessage, res: ServerResponse) => {
    if (deps.capGuard(res, 'approval.permissionList')) return;
    try {
      const dir = resolveApprovalDirectory({
        explicit: new URL(req.url!, deps.serveUrl()).searchParams.get('directory'),
        currentProjectDir: deps.currentProjectDir(),
        projectDir: deps.projectDir(),
      });
      const runtime = deps.runtime();
      const items = runtime?.session?.permissionList
        ? await runtime.session.permissionList(dir ? { directory: dir } : undefined)
        : [];
      res.end(JSON.stringify({ items: projectPermissionList(items) }));
    } catch (err: any) {
      log.error('[Permission] list error:', err.message);
      res.end(JSON.stringify({ items: [] }));
    }
  });

  // POST /api/permissions/{id}/reply — { reply, message?, persist? }（列表反查 sessionID → permissionReply）
  registry.attachHandler('permissions.reply', async (req: IncomingMessage, res: ServerResponse, params: Record<string, string>) => {
    // E7-1: approving/denying a tool permission is a human decision.
    // `permissions.replyRuntime` (runtime-internal) is deliberately not gated.
    if (!requireHumanPrincipal(req, res)) return;
    await handlePermissionReplyById(req, res, params.id, {
      runtime: deps.runtime(),
      access: deps.runtime()?.access ?? null,
      rules: deps.permissionRules(),
      directories: () => [
        deps.currentProjectDir() ?? undefined,
        deps.projectDir() || undefined,
        ...deps.registeredProjects().keys(),
      ],
    });
  });
}
