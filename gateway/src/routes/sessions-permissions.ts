/**
 * Phase D1 Task E2: sessions 审批 / 子代理面（registry dispatch 接线）。
 *
 *   GET    /api/sessions/:sid/permission-mode            — 读取会话审批模式（委托 routes/permission-mode.ts）
 *   POST   /api/sessions/:sid/permission-mode            — 设置会话审批模式（委托 routes/permission-mode.ts）
 *   POST   /api/sessions/:sid/permissions/:rid           — 会话直连审批回复（委托 routes/permission.ts）
 *   POST   /api/sessions/:id/subagents                   — 生成子代理（委托 routes/subagents.ts）
 *   GET    /api/sessions/:id/subagents                   — 子代理列表
 *   POST   /api/sessions/:id/subagents/:subId/message    — 给子代理发消息
 *   POST   /api/sessions/:id/subagents/:subId/cancel     — 取消子代理
 *   GET    /api/sessions/:id/subagents/:subId/result     — 读取子代理结果
 *
 * handler 体从 index.ts legacy 分支逐字迁移（`this.x` → `deps.x()`）。legacy 里
 * permission-mode 的共享 const 与 subagents 的「一个 matcher 两个 method 臂」被
 * catalog 的 method 维度拆开（GET/POST 各自一个 operationId），method 判断由
 * registry 匹配承担，行为等价。
 * Spec: 2026-11-09-gateway-kernel-microkernel-design.md §5.2.
 */
import type { IncomingMessage, ServerResponse } from 'http';
import { AUTO_APPROVE_BUDGET } from '../core/approval/policy-service';
import { handlePermissionReply } from './permission';
import { handlePermissionModeGet, handlePermissionModeSet } from './permission-mode';
import {
  handleSubagentCancel, handleSubagentList, handleSubagentMessage,
  handleSubagentResult, handleSubagentSpawn,
} from './subagents';
import type { RouteRegistry } from './registry';

export interface SessionsPermissionsRouteDeps {
  approvalPolicy: () => any;
  runtime: () => any;
  permissionRules: () => any;
  subagentService: () => any;
}

export function attachSessionsPermissionsRoutes(registry: RouteRegistry, deps: SessionsPermissionsRouteDeps): void {
  // per-session 审批模式（manual/auto）—— 具体路径，legacy 解释：必须在
  // /api/permissions/:id 之前匹配；registry 按静态段优先级匹配，语义等价。
  registry.attachHandler('permissions.getMode', async (_req: IncomingMessage, res: ServerResponse, params: Record<string, string>) => {
    const pmDeps = { policy: deps.approvalPolicy(), budget: AUTO_APPROVE_BUDGET };
    await handlePermissionModeGet(res, params.sid, pmDeps);
  });
  registry.attachHandler('permissions.setMode', async (req: IncomingMessage, res: ServerResponse, params: Record<string, string>) => {
    const pmDeps = { policy: deps.approvalPolicy(), budget: AUTO_APPROVE_BUDGET };
    await handlePermissionModeSet(req, res, params.sid, pmDeps);
  });

  // POST /api/sessions/{id}/permissions/{requestId} — forward permission reply to runtime
  registry.attachHandler('permissions.replyRuntime', async (req: IncomingMessage, res: ServerResponse, params: Record<string, string>) => {
    // 直连路由与主 reply 路由对称：always 也沉淀持久规则（反查失败 fail-open）
    await handlePermissionReply(deps.runtime(), req, res, params.sid, params.rid, {
      access: deps.runtime()?.access ?? null,
      rules: deps.permissionRules(),
      findRequest: async () => {
        try {
          if (!deps.runtime()?.session?.permissionList) return null;
          const pending = await deps.runtime().session.permissionList();
          return (Array.isArray(pending) ? pending : []).find((p: any) => p?.id === params.rid) ?? null;
        } catch { return null; }
      },
    });
  });

  // ── Subagent spawn/list/message/cancel/result (gateway-owned) ──
  registry.attachHandler('session.subagents.message', async (req: IncomingMessage, res: ServerResponse, params: Record<string, string>) => {
    await handleSubagentMessage(req, res, params.id, params.subId, { service: deps.subagentService() });
  });
  registry.attachHandler('session.subagents.cancel', async (_req: IncomingMessage, res: ServerResponse, params: Record<string, string>) => {
    await handleSubagentCancel(res, params.id, params.subId, { service: deps.subagentService() });
  });
  registry.attachHandler('session.subagents.result', async (_req: IncomingMessage, res: ServerResponse, params: Record<string, string>) => {
    await handleSubagentResult(res, params.id, params.subId, { service: deps.subagentService() });
  });
  registry.attachHandler('session.subagents.spawn', async (req: IncomingMessage, res: ServerResponse, params: Record<string, string>) => {
    await handleSubagentSpawn(req, res, params.id, { service: deps.subagentService() });
  });
  registry.attachHandler('session.subagents.list', async (_req: IncomingMessage, res: ServerResponse, params: Record<string, string>) => {
    await handleSubagentList(res, params.id, { service: deps.subagentService() });
  });
}
