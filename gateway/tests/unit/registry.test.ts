import { RouteRegistry, toOpenApiPath, type RouteDef } from '../../src/routes/registry';
import {
  CapabilityUnavailableErrorSchema,
  ErrorEnvelope,
  QuotaExceededErrorSchema,
} from '../../src/routes/schemas/errors';

function def(over: Partial<RouteDef> & { path: string; operationId: string }): RouteDef {
  return { method: 'GET', ...over } as RouteDef;
}

describe('RouteRegistry', () => {
  describe('register 校验', () => {
    it('path 必须以 / 开头', () => {
      const r = new RouteRegistry();
      expect(() => r.register(def({ path: 'api/x', operationId: 'a.b' }))).toThrow("must start with '/'");
    });

    it('operationId 重复抛错', () => {
      const r = new RouteRegistry();
      r.register(def({ path: '/a', operationId: 'x.y' }));
      expect(() => r.register(def({ path: '/b', operationId: 'x.y' }))).toThrow('Duplicate operationId');
    });

    it('method 白名单校验', () => {
      const r = new RouteRegistry();
      expect(() => r.register({ method: 'FETCH' as any, path: '/a', operationId: 'x.y' })).toThrow('method invalid');
    });
  });

  describe('match', () => {
    it('静态路径精确匹配 + 参数提取', () => {
      const r = new RouteRegistry().register(
        def({ path: '/api/goals/:id/sessions', operationId: 'goals.sessions' }),
        def({ path: '/api/goals', operationId: 'goals.list' }),
      );
      expect(r.match('GET', '/api/goals')?.def.operationId).toBe('goals.list');
      const m = r.match('GET', '/api/goals/g-1/sessions');
      expect(m?.def.operationId).toBe('goals.sessions');
      expect(m?.params).toEqual({ id: 'g-1' });
    });

    it('静态段优先于参数段（draft 先于 :id）', () => {
      const r = new RouteRegistry().register(
        def({ method: 'POST', path: '/api/automations/:id', operationId: 'automations.wrong' }),
        def({ method: 'POST', path: '/api/automations/draft', operationId: 'automations.draft' }),
      );
      expect(r.match('POST', '/api/automations/draft')?.def.operationId).toBe('automations.draft');
      expect(r.match('POST', '/api/automations/other')?.def.operationId).toBe('automations.wrong');
    });

    it('query string 剥离 + URL 编码解码 + 尾斜杠容忍', () => {
      const r = new RouteRegistry().register(def({ path: '/api/memory/:id', operationId: 'memory.del' }));
      expect(r.match('GET', '/api/memory/abc?x=1')?.params).toEqual({ id: 'abc' });
      expect(r.match('GET', '/api/memory/t%201')?.params).toEqual({ id: 't 1' });
      expect(r.match('GET', '/api/memory/abc/')?.params).toEqual({ id: 'abc' });
    });

    it('method 不匹配返回 null', () => {
      const r = new RouteRegistry().register(def({ method: 'POST', path: '/api/x', operationId: 'x.post' }));
      expect(r.match('GET', '/api/x')).toBeNull();
    });

    it('参数段数不符不匹配（防 :id 吞多段）', () => {
      const r = new RouteRegistry().register(def({ path: '/api/goals/:id', operationId: 'goals.get' }));
      expect(r.match('GET', '/api/goals/a/b')).toBeNull();
    });
  });

  describe('toOpenApiPaths', () => {
    it(':param → {param}，同 path 多 method 合并，tags/summary 透传', () => {
      const r = new RouteRegistry().register(
        def({ path: '/api/goals/:id', operationId: 'goals.get', tags: ['goals'], summary: 'Get goal' }),
        def({ method: 'DELETE', path: '/api/goals/:id', operationId: 'goals.delete' }),
        def({ path: '/api/triage', operationId: 'triage.list' }),
      );
      const paths = r.toOpenApiPaths();
      expect(Object.keys(paths).sort()).toEqual(['/api/goals/{id}', '/api/triage']);
      const goal = paths['/api/goals/{id}'] as any;
      expect(goal.get.operationId).toBe('goals.get');
      expect(goal.get.tags).toEqual(['goals']);
      expect(goal.get.parameters).toEqual([expect.objectContaining({ name: 'id', in: 'path', required: true })]);
      expect(goal.delete.operationId).toBe('goals.delete');
      expect((paths['/api/triage'] as any).get.parameters).toBeUndefined();
    });

    // E10g-P0: requestBody projection. `request` is declarative only (no runtime
    // validation); it lands verbatim under the content-type key.
    it('request 投影为 requestBody（默认 application/json + required:true）', () => {
      const schema = { type: 'object', properties: { title: { type: 'string' } } };
      const r = new RouteRegistry().register(
        def({ method: 'POST', path: '/api/tasks', operationId: 'tasks.submit', request: schema }),
      );
      const op = (r.toOpenApiPaths()['/api/tasks'] as any).post;
      expect(op.requestBody).toEqual({
        required: true,
        content: { 'application/json': { schema } },
      });
    });

    it('requestContentType 覆盖 content-type（二进制上传）', () => {
      const schema = { type: 'string', format: 'binary' };
      const r = new RouteRegistry().register(
        def({
          method: 'POST',
          path: '/api/media/upload',
          operationId: 'media.upload',
          request: schema,
          requestContentType: 'application/octet-stream',
        }),
      );
      const body = (r.toOpenApiPaths()['/api/media/upload'] as any).post.requestBody;
      expect(body.content['application/octet-stream'].schema).toEqual(schema);
      expect(body.content['application/json']).toBeUndefined();
      expect(body.required).toBe(true);
    });

    it('requestRequired:false 表示无 body 动作（空对象 schema）', () => {
      const schema = { type: 'object', properties: {} };
      const r = new RouteRegistry().register(
        def({
          method: 'POST',
          path: '/api/goals/:id/pause',
          operationId: 'goals.pause',
          request: schema,
          requestRequired: false,
        }),
      );
      const body = (r.toOpenApiPaths()['/api/goals/{id}/pause'] as any).post.requestBody;
      expect(body.required).toBe(false);
      expect(body.content['application/json'].schema).toEqual(schema);
    });

    it('没有 request 的 op 不生成 requestBody（含有 response 的 GET）', () => {
      const r = new RouteRegistry().register(
        def({ path: '/api/goals', operationId: 'goals.list', response: { type: 'object' } }),
        def({ method: 'DELETE', path: '/api/goals/:id', operationId: 'goals.cancel' }),
      );
      const paths = r.toOpenApiPaths();
      expect((paths['/api/goals'] as any).get.requestBody).toBeUndefined();
      expect((paths['/api/goals/{id}'] as any).delete.requestBody).toBeUndefined();
    });
  });

  it('toOpenApiPath 转换', () => {
    expect(toOpenApiPath('/api/goals/:id/sessions')).toBe('/api/goals/{id}/sessions');
    expect(toOpenApiPath('/a2a/artifacts/:id')).toBe('/a2a/artifacts/{id}');
  });

  // E10i-P0：非 2xx 错误响应的统一投影（只声明，不运行时校验）。
  describe('E10i-P0 error response plumbing', () => {
    const DEFAULT_ERROR = {
      description: 'Error',
      content: { 'application/json': { schema: ErrorEnvelope } },
    };
    const errorResponses = (op: any) => Object.keys(op.responses).filter((s) => s !== '200');

    it('每个 op（含非 /api 路径）都有 default 错误包', () => {
      const r = new RouteRegistry().register(
        def({ path: '/api/goals', operationId: 'goals.list', response: { type: 'object' } }),
        def({ method: 'POST', path: '/api/goals/:id/pause', operationId: 'goals.pause' }),
        def({ path: '/health', operationId: 'health.root', response: { type: 'object' } }),
      );
      const paths = r.toOpenApiPaths();
      const ops: any[] = [];
      for (const methods of Object.values<any>(paths)) ops.push(...Object.values<any>(methods));
      expect(ops).toHaveLength(3);
      for (const op of ops) {
        expect(op.responses.default).toEqual(DEFAULT_ERROR);
        // 统一包的承重字段：error 必填，code/message/success 都是 additive。
        expect(op.responses.default.content['application/json'].schema.required).toEqual(['error']);
        expect(op.responses.default.content['application/json'].schema.properties.code).toBeDefined();
        expect(op.responses.default.content['application/json'].schema.properties.success).toBeDefined();
        expect(op.responses.default.content['application/json'].schema.additionalProperties).toBe(true);
      }
    });

    it('/api/ op 自动获得 401 与 403（transport 鉴权层）', () => {
      const r = new RouteRegistry().register(
        def({ path: '/api/goals', operationId: 'goals.list' }),
        def({ method: 'DELETE', path: '/api/goals/:id', operationId: 'goals.delete' }),
      );
      const paths = r.toOpenApiPaths();
      for (const op of [paths['/api/goals'].get, paths['/api/goals/{id}'].delete] as any[]) {
        expect(op.responses['401']).toEqual({
          description: 'Unauthorized',
          content: { 'application/json': { schema: ErrorEnvelope } },
        });
        expect(op.responses['403']).toEqual({
          description: 'Forbidden',
          content: { 'application/json': { schema: ErrorEnvelope } },
        });
      }
    });

    it('非 /api/ 路径不加 401/403（health / well-known / a2a / control / register）', () => {
      const r = new RouteRegistry().register(
        def({ path: '/health', operationId: 'health.root' }),
        def({ path: '/.well-known/agent-card.json', operationId: 'a2a.agentCard' }),
        def({ method: 'POST', path: '/a2a/artifacts/:id', operationId: 'media.artifact' }),
        def({ method: 'POST', path: '/control', operationId: 'goals.controlLegacy' }),
        def({ method: 'POST', path: '/register', operationId: 'project.setCurrent' }),
      );
      const paths = r.toOpenApiPaths();
      for (const methods of Object.values<any>(paths)) {
        for (const op of Object.values<any>(methods)) {
          expect(errorResponses(op)).toEqual(['default']);
        }
      }
    });

    it('显式 errors 状态码：errorSchemas 覆盖该状态的特殊形状（429 quota）', () => {
      const r = new RouteRegistry().register(
        def({
          method: 'POST',
          path: '/api/sessions/:id/prompt',
          operationId: 'session.prompt',
          errors: [400, 404, 429],
          errorSchemas: { 429: QuotaExceededErrorSchema },
          errorDescription: { 429: 'Quota Exceeded' },
        }),
      );
      const op = (r.toOpenApiPaths()['/api/sessions/{id}/prompt'] as any).post;
      expect(op.responses['429']).toEqual({
        description: 'Quota Exceeded',
        content: { 'application/json': { schema: QuotaExceededErrorSchema } },
      });
      expect(op.responses['429'].content['application/json'].schema.properties.code.const)
        .toBe('quota_exceeded');
      // 没有 errorSchemas 的状态回落到统一包，描述按状态码默认。
      expect(op.responses['400']).toEqual({
        description: 'Bad Request',
        content: { 'application/json': { schema: ErrorEnvelope } },
      });
      expect(op.responses['404'].content['application/json'].schema).toBe(ErrorEnvelope);
      expect(op.responses.default.content['application/json'].schema).toBe(ErrorEnvelope);
    });

    it('503 capability 用特殊包；显式错误不与 transport 401/403 冲突', () => {
      const r = new RouteRegistry().register(
        def({
          method: 'POST',
          path: '/api/plugins/x/invoke',
          operationId: 'plugins.invoke',
          errors: [503],
          errorSchemas: { 503: CapabilityUnavailableErrorSchema },
        }),
      );
      const op = (r.toOpenApiPaths()['/api/plugins/x/invoke'] as any).post;
      expect(op.responses['503'].content['application/json'].schema.properties.code.const)
        .toBe('capability_unavailable');
      expect(op.responses['401'].content['application/json'].schema).toBe(ErrorEnvelope);
      expect(op.responses['403']).toBeDefined();
    });

    it('只声明不校验：任意显式状态码原样投影（不做运行时拒绝）', () => {
      const r = new RouteRegistry().register(
        def({ path: '/api/odd', operationId: 'odd.get', errors: [418, 599] }),
      );
      expect(() => r.toOpenApiPaths()).not.toThrow();
      const op = (r.toOpenApiPaths()['/api/odd'] as any).get;
      expect(op.responses['418'].description).toBe('Error');
      expect(op.responses['599'].content['application/json'].schema).toBe(ErrorEnvelope);
    });

    it('200 行为不变（有 schema / 无 schema 两条分支保持原样）', () => {
      const schema = { type: 'object', properties: { ok: { type: 'boolean' } } };
      const r = new RouteRegistry().register(
        def({ path: '/api/with-schema', operationId: 'x.with', response: schema }),
        def({ path: '/api/no-schema', operationId: 'x.without' }),
        def({ path: '/api/stream', operationId: 'x.stream', response: null }),
      );
      const paths = r.toOpenApiPaths();
      expect((paths['/api/with-schema'] as any).get.responses['200']).toEqual({
        description: 'OK',
        content: { 'application/json': { schema } },
      });
      expect((paths['/api/no-schema'] as any).get.responses['200']).toEqual({ description: 'OK' });
      expect((paths['/api/stream'] as any).get.responses['200']).toEqual({ description: 'OK' });
    });
  });
});
