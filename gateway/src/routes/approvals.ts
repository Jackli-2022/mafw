/**
 * Phase D1 Task A5: approvals 面（registry dispatch 接线）。
 *
 *   GET    /api/approvals              — 待办审批清单（user-questions 目录扫描）
 *   POST   /api/approvals/:id/respond  — 写回答/决定 → routes/approvals-respond
 *   GET/POST/DELETE /api/approvals/allowlist — 持久白名单 → routes/allowlist
 *   GET/POST/DELETE /api/approvals/rules     — 持久规则  → routes/rules
 *
 * handler 体从 index.ts legacy 分支逐字迁移。扫描路径（项目目录 + 数据根）全部保留：
 * 数据根扫描是 QuestionWidget 回退查找的载荷路径。
 * 405-else 分支不迁移：未匹配方法在 registry 下直接落到反代（见 commit 说明）。
 */
import * as fs from 'fs';
import * as path from 'path';
import type { IncomingMessage, ServerResponse } from 'http';
import { config } from '../config';
import { handleAllowlistDelete, handleAllowlistGet, handleAllowlistPost, type AllowlistRouteDeps } from './allowlist';
import { handleApprovalsRespond } from './approvals-respond';
import { handleRulesDelete, handleRulesGet, handleRulesPost, type RulesRouteDeps } from './rules';
import { requireHumanPrincipal } from '../core/http/human-guard';
import type { RouteRegistry } from './registry';

export interface ApprovalsRouteDeps {
  registeredProjects: () => Map<string, { mafwDir: string }>;
  allowlistStore: () => AllowlistRouteDeps['store'];
  permissionRules: () => RulesRouteDeps['store'];
}

export function attachApprovalsRoutes(registry: RouteRegistry, deps: ApprovalsRouteDeps): void {
  registry.attachHandler('approvals.list', async (_req: IncomingMessage, res: ServerResponse) => {
    const approvals: any[] = [];
    const scanUserQuestions = (mafwDir: string) => {
      try {
        const qDir = path.join(mafwDir, 'user-questions');
        if (fs.existsSync(qDir)) {
          for (const f of fs.readdirSync(qDir).filter((f: string) => f.endsWith('.json'))) {
            const q = JSON.parse(fs.readFileSync(path.join(qDir, f), 'utf-8'));
            approvals.push({ id: f.replace('.json', ''), goalId: q.goalId, question: q.question, status: q.answered ? 'answered' : 'pending', createdAt: q.createdAt });
          }
          // legacy: questions previously stored under user-questions/{goalId}/
          for (const gDir of fs.readdirSync(qDir)) {
            const gPath = path.join(qDir, gDir);
            if (!fs.statSync(gPath).isDirectory()) continue;
            for (const file of fs.readdirSync(gPath).filter((f: string) => f.endsWith('.json'))) {
              const q = JSON.parse(fs.readFileSync(path.join(gPath, file), 'utf-8'));
              approvals.push({ id: file.replace('.json', ''), goalId: gDir, question: q.question, status: q.answered ? 'answered' : 'pending', createdAt: q.createdAt });
            }
          }
        }
      } catch { /* ignore */ }
    };
    // Read from .mafw/user-questions/ directories (flat layout)
    for (const [, info] of deps.registeredProjects()) {
      scanUserQuestions(info.mafwDir);
    }
    // MCP handleAskUser 写入 ~/.mafw/user-questions（数据根，非项目目录）——
    // 不扫描会导致 QuestionWidget 的 approvals 回退查找永远失败（弹窗无问题文本）
    scanUserQuestions(config.resolvePath());
    res.end(JSON.stringify({ approvals }));
  });

  registry.attachHandler('approvals.respond', async (req: IncomingMessage, res: ServerResponse, params: Record<string, string>) => {
    // E7-1: answering a goal question / permission prompt is a human decision.
    if (!requireHumanPrincipal(req, res)) return;
    // 数据根优先：MCP handleAskUser 的问题文件在 ~/.mafw/user-questions
    const dirs = [config.resolvePath(), ...[...deps.registeredProjects().values()].map((info: any) => info.mafwDir)];
    // Registry 已对 path param 做过 decodeURIComponent（legacy 在此处手动 decode 一次）——
    // 不再二次解码（'%25' 会被解成 '%' 并让 decodeURIComponent 抛错）。
    await handleApprovalsRespond(req, res, params.id, { resolveDirs: () => dirs });
  });

  // 持久白名单 CRUD —— 同样必须在 /api/permissions/:id 之前
  registry.attachHandler('permissions.listAllowlist', async (_req: IncomingMessage, res: ServerResponse) => {
    const alDeps = { store: deps.allowlistStore() };
    await handleAllowlistGet(res, alDeps);
  });
  registry.attachHandler('permissions.addAllowlist', async (req: IncomingMessage, res: ServerResponse) => {
    const alDeps = { store: deps.allowlistStore() };
    await handleAllowlistPost(req, res, alDeps);
  });
  registry.attachHandler('permissions.removeAllowlist', async (req: IncomingMessage, res: ServerResponse) => {
    const alDeps = { store: deps.allowlistStore() };
    await handleAllowlistDelete(req, res, alDeps);
  });

  // 持久规则 CRUD（切片 1）—— 与 allowlist 同级注册
  registry.attachHandler('permissions.listRules', async (_req: IncomingMessage, res: ServerResponse) => {
    const rulesDeps = { store: deps.permissionRules() };
    await handleRulesGet(res, rulesDeps);
  });
  registry.attachHandler('permissions.addRule', async (req: IncomingMessage, res: ServerResponse) => {
    const rulesDeps = { store: deps.permissionRules() };
    await handleRulesPost(req, res, rulesDeps);
  });
  registry.attachHandler('permissions.removeRule', async (req: IncomingMessage, res: ServerResponse) => {
    const rulesDeps = { store: deps.permissionRules() };
    await handleRulesDelete(req, res, rulesDeps);
  });
}
