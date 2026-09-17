/**
 * P4-A 声明式路由注册表（Shadow Registry 架构）。
 *
 * RouteDef 是 gateway HTTP 端点的声明式描述。Phase 2"shadow 登记"模式下 catalog
 * 只贡献 OpenAPI spec（`toOpenApiPaths()` → emit-openapi 脚本），不参与 dispatch；
 * Phase 3 逐步给 def 挂 handler 并接线 index.ts 主循环，路由器行为由本文件单测锁定。
 */

export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

export interface RouteDef {
  method: HttpMethod;
  /** ':param' 风格路径，如 '/api/goals/:id/sessions'。必须以 / 开头。 */
  path: string;
  /** OpenAPI operationId，namespace.action 命名（如 'goals.sessions'），全局唯一。 */
  operationId: string;
  summary?: string;
  tags?: string[];
  /**
   * Phase 3 dispatch；shadow 登记阶段缺省。返回 false 表示"实际未处理"
   * （模块内部正则未命中，如 query 形状差异）→ dispatch 放行回退 legacy 链；
   * 返回 void/true 视为已处理。
   */
  handler?: (req: import('http').IncomingMessage, res: import('http').ServerResponse, params: Record<string, string>) => Promise<boolean | void> | boolean | void;
}

export interface MatchedRoute {
  def: RouteDef;
  params: Record<string, string>;
}

const HTTP_METHODS: readonly HttpMethod[] = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'];

/** ':param' 形式 → OpenAPI '{param}' 形式。 */
export function toOpenApiPath(path: string): string {
  return path.replace(/:([A-Za-z0-9_]+)/g, '{$1}');
}

interface CompiledRoute {
  def: RouteDef;
  /** 原始段（':param' 保留前缀），匹配时现场判定。 */
  segments: string[];
  staticSegments: number;
}
export class RouteRegistry {
  private defs: RouteDef[] = [];
  private operationIds = new Set<string>();
  private compiled: CompiledRoute[] | null = null;

  register(...defs: RouteDef[]): this {
    for (const def of defs) {
      if (!def.path.startsWith('/')) throw new Error(`RouteDef.path must start with '/': ${def.path}`);
      if (!HTTP_METHODS.includes(def.method)) throw new Error(`RouteDef.method invalid: ${def.method}`);
      if (!def.operationId) throw new Error(`RouteDef.operationId required: ${def.method} ${def.path}`);
      if (this.operationIds.has(def.operationId)) {
        throw new Error(`Duplicate operationId: ${def.operationId}`);
      }
      this.operationIds.add(def.operationId);
      this.defs.push(def);
      this.compiled = null;
    }
    return this;
  }

  list(): readonly RouteDef[] {
    return this.defs;
  }

  /**
   * P5 Wave 迁移：给已 shadow 登记的 operationId 挂真实 handler。
   * 幂等禁止——重复 attach 抛错（防两个迁移波次互相覆盖）。
   */
  attachHandler(operationId: string, handler: NonNullable<RouteDef['handler']>): this {
    const def = this.defs.find((d) => d.operationId === operationId);
    if (!def) throw new Error(`attachHandler: unknown operationId '${operationId}'（catalog 未登记？）`);
    if (def.handler) throw new Error(`attachHandler: '${operationId}' already has a handler`);
    def.handler = handler;
    return this;
  }

  /** 已挂 handler 的 operationId 集合（迁移覆盖率测试用）。 */
  attachedOperationIds(): Set<string> {
    return new Set(this.defs.filter((d) => d.handler).map((d) => d.operationId));
  }

  private compile(): CompiledRoute[] {
    if (this.compiled) return this.compiled;
    this.compiled = this.defs.map((def) => {
      const segments = def.path.split('/').filter((s) => s.length > 0);
      const staticSegments = segments.filter((s) => !s.startsWith(':')).length;
      return { def, segments, staticSegments };
    });
    return this.compiled;
  }

  /**
   * 匹配：静态段多的优先（/api/automations/draft 先于 /api/automations/:id），
   * 同特异度按注册序。pathname 只取 url 的 path 部分（剥 query）。
   */
  match(method: HttpMethod, url: string): MatchedRoute | null {
    const pathname = url.split('?')[0].replace(/\/+$/, '') || '/';
    const pathnameSegments = pathname.split('/').filter((s) => s.length > 0);
    const routes = this.compile()
      .map((r, i) => ({ r, i }))
      .sort((a, b) => b.r.staticSegments - a.r.staticSegments || a.i - b.i);

    for (const { r } of routes) {
      if (r.def.method !== method) continue;
      if (r.segments.length !== pathnameSegments.length) continue;
      const params: Record<string, string> = {};
      let ok = true;
      for (let i = 0; i < r.segments.length; i++) {
        const seg = r.segments[i];
        if (seg.startsWith(':')) {
          params[seg.slice(1)] = decodeURIComponent(pathnameSegments[i]);
        } else if (seg !== pathnameSegments[i]) {
          ok = false;
          break;
        }
      }
      if (ok) return { def: r.def, params };
    }
    return null;
  }

  /** 生成 OpenAPI paths 片段（':param' → '{param}'，同 path 多 method 合并）。 */
  toOpenApiPaths(): Record<string, Record<string, unknown>> {
    const out: Record<string, Record<string, unknown>> = {};
    for (const def of this.defs) {
      const key = toOpenApiPath(def.path);
      const entry = (out[key] ??= {});
      const op: Record<string, unknown> = { operationId: def.operationId };
      if (def.tags?.length) op.tags = def.tags;
      if (def.summary) op.summary = def.summary;
      const params = def.path.split('/').filter((s) => s.startsWith(':')).map((s) => ({
        name: s.slice(1),
        in: 'path',
        required: true,
        schema: { type: 'string' },
      }));
      if (params.length) op.parameters = params;
      op.responses = { 200: { description: 'OK' } };
      entry[def.method.toLowerCase()] = op;
    }
    return out;
  }
}
