/**
 * Phase D1 Task A1: project 面（registry dispatch 接线）。
 *
 *   GET /api/projects          — 已注册项目清单（过滤基础设施目录）
 *   GET /api/projects/current  — 当前/活跃项目（含 current-project kv self-heal）
 *
 * handler 体从 index.ts legacy 分支逐字迁移；deps 走 live getter（
 * registeredProjects / gatewayDb 在启动后会被重新赋值，引用必须实时取）。
 */
import type { IncomingMessage, ServerResponse } from 'http';
import { isSelectableProject, pickCurrentProject } from '../runtime/project-selection';
import { resolveRuntimeRoot } from '../runtime/runtime-root';
import type { RouteRegistry } from './registry';

export interface RegisteredProjectLike {
  projectDir: string;
  mafwDir: string;
  registeredAt?: string;
}

export interface ProjectDbLike {
  kvGet<T = string>(scope: string, key: string): T | null;
  kvSet(scope: string, key: string, value: unknown): void;
}

export interface ProjectRouteDeps {
  registeredProjects: () => Map<string, RegisteredProjectLike>;
  currentProjectDir: () => string | null;
  setCurrentProjectDir: (dir: string | null) => void;
  db: () => ProjectDbLike;
}

export function attachProjectRoutes(registry: RouteRegistry, deps: ProjectRouteDeps): void {
  registry.attachHandler('project.list', async (_req: IncomingMessage, res: ServerResponse) => {
    // 基础设施目录（runtime server root / "."）不是用户项目，不暴露给 Rail。
    const runtimeRoot = resolveRuntimeRoot();
    const projects = Array.from(deps.registeredProjects().values())
      .filter(p => isSelectableProject(p.projectDir, runtimeRoot))
      .map(p => ({
        id: p.projectDir,
        worktree: p.projectDir,
      }));
    res.end(JSON.stringify({ projects }));
  });

  registry.attachHandler('project.current', async (_req: IncomingMessage, res: ServerResponse) => {
    if (!deps.currentProjectDir()) {
      deps.setCurrentProjectDir(deps.db().kvGet<string>('current-project', 'default') || null);
    }
    const runtimeRoot = resolveRuntimeRoot();
    const cur = pickCurrentProject({
      stored: deps.currentProjectDir(),
      registered: deps.registeredProjects().keys(),
      runtimeRoot,
    });
    if (cur !== deps.currentProjectDir()) {
      // 修复被污染的 current-project（旧版插件自动注册曾把 runtime-root 选成当前项目）。
      deps.setCurrentProjectDir(cur);
      if (cur) deps.db().kvSet('current-project', 'default', cur);
    }
    if (!cur) {
      res.end(JSON.stringify({ project: null }));
      return;
    }
    const info = deps.registeredProjects().get(cur);
    if (!info) {
      res.end(JSON.stringify({ project: null }));
      return;
    }
    res.end(JSON.stringify({
      project: { id: cur, worktree: cur, mafwDir: info.mafwDir },
    }));
  });
}
