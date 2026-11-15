/**
 * P4-A 声明式路由注册表（Shadow Registry 架构）。
 *
 * RouteDef 是 gateway HTTP 端点的声明式描述。Phase 2"shadow 登记"模式下 catalog
 * 只贡献 OpenAPI spec（`toOpenApiPaths()` → emit-openapi 脚本），不参与 dispatch；
 * Phase 3 逐步给 def 挂 handler 并接线 index.ts 主循环，路由器行为由本文件单测锁定。
 */

import { ErrorEnvelope } from './schemas/errors';

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
   * 200 JSON 响应 schema（code-first：OpenAPI 的唯一来源，emit 时直接投影）。
   * 缺省 = 暂无 schema（旧路由）；null = 明确无 JSON 响应（SSE/二进制/代理）。
   * 用 TypeBox/JSON Schema 对象均可；JSON.stringify 后必须是合法 JSON Schema。
   */
  response?: object | null;
  /**
   * E10g：请求 body schema（TypeBox / JSON Schema）。缺省 = 未建模请求体
   * （openapi 不生成 requestBody）；`null` 不用——排除项直接不写本字段。
   * 只声明、不运行时校验：handler 仍是请求形状的事实源。
   */
  request?: object;
  /** 请求 content-type（默认 'application/json'；二进制上传用 'application/octet-stream'）。 */
  requestContentType?: string;
  /** 请求体是否必填（默认 true；无 body 的动作用 `request: Type.Object({})` + false）。 */
  requestRequired?: boolean;
  /**
   * E10i：显式声明的错误状态码（使用统一 `ErrorEnvelope`）。`default` 始终存在
   * 作兜底；`/api/*` 的 401/403 由 transport 层自动补齐。只声明不校验。
   */
  errors?: number[];
  /** E10i：按状态码覆盖错误 schema（429 quota / 503 capability / 409 / 404 等）。 */
  errorSchemas?: Record<number, object>;
  /** E10i：按状态码覆盖错误描述（缺省按状态码标准短语）。 */
  errorDescription?: Record<number, string>;
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

/** 状态码 → OpenAPI 默认描述（显式 errorDescription 覆盖）。 */
const STATUS_DESCRIPTION: Record<number, string> = {
  400: 'Bad Request',
  401: 'Unauthorized',
  402: 'Payment Required',
  403: 'Forbidden',
  404: 'Not Found',
  405: 'Method Not Allowed',
  408: 'Request Timeout',
  409: 'Conflict',
  410: 'Gone',
  412: 'Precondition Failed',
  413: 'Payload Too Large',
  415: 'Unsupported Media Type',
  422: 'Unprocessable Entity',
  423: 'Locked',
  425: 'Too Early',
  429: 'Quota Exceeded',
  500: 'Internal Server Error',
  501: 'Not Implemented',
  502: 'Bad Gateway',
  503: 'Service Unavailable',
  504: 'Gateway Timeout',
};

function errorResponse(schema: object, description: string): Record<string, unknown> {
  return { description, content: { 'application/json': { schema } } };
}

/**
 * E10i-P0：一个 op 的非 2xx 响应投影。
 *
 * - `default` 恒存在（统一 `ErrorEnvelope` 兜底）；
 * - `/api/*` 追加 transport 鉴权层的 401/403（非 /api 的 health / .well-known /
 *   a2a / control / register 没有该层）；
 * - `def.errors` 逐项追加，`errorSchemas[status]` 覆盖形状、`errorDescription`
 *   覆盖描述。显式状态码排在 401/403 之后，因此可以自定义同名状态。
 */
export function errorResponsesFor(def: RouteDef): Record<string, unknown> {
  const out: Record<string, unknown> = {
    default: errorResponse(ErrorEnvelope, 'Error'),
  };
  if (def.path.startsWith('/api/')) {
    out[401] = errorResponse(ErrorEnvelope, STATUS_DESCRIPTION[401]);
    out[403] = errorResponse(ErrorEnvelope, STATUS_DESCRIPTION[403]);
  }
  for (const status of def.errors ?? []) {
    const description = def.errorDescription?.[status] ?? STATUS_DESCRIPTION[status] ?? 'Error';
    out[status] = errorResponse(def.errorSchemas?.[status] ?? ErrorEnvelope, description);
  }
  return out;
}

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
      // E10g code-first：RouteDef.request 直接投影成 requestBody（只声明，不校验）。
      if (def.request) {
        op.requestBody = {
          required: def.requestRequired !== false,
          content: { [def.requestContentType ?? 'application/json']: { schema: def.request } },
        };
      }
      // code-first：RouteDef.response 直接投影成 OpenAPI 200 content schema。
      op.responses = def.response
        ? { 200: { description: 'OK', content: { 'application/json': { schema: def.response } } } }
        : { 200: { description: 'OK' } };
      // E10i：非 2xx 契约。`default` 是所有未列出 4xx/5xx 的兜底包；
      // `/api/*` 额外带 transport 鉴权层的 401/403；显式 errors 逐项追加。
      Object.assign(op.responses as Record<string, unknown>, errorResponsesFor(def));
      entry[def.method.toLowerCase()] = op;
    }
    return out;
  }
}
