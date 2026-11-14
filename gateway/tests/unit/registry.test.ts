import { RouteRegistry, toOpenApiPath, type RouteDef } from '../../src/routes/registry';

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
});
