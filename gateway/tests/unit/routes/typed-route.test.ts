/**
 * Code-first P0：RouteDef.response → OpenAPI 投影，typed handler 的序列化行为。
 */
import { Type } from '@sinclair/typebox';
import { RouteRegistry } from '../../../src/routes/registry';
import { attachTypedRoute } from '../../../src/routes/typed';

function mockRes() {
  const chunks: string[] = [];
  const res: any = {
    statusCode: 0,
    headers: {} as Record<string, string>,
    writeHead(code: number, headers?: Record<string, string>) {
      this.statusCode = code;
      this.headers = headers ?? {};
      return this;
    },
    end(chunk?: unknown) {
      if (chunk !== undefined && chunk !== null) chunks.push(String(chunk));
    },
  };
  return { res, body: () => JSON.parse(chunks.join('') || 'null') };
}

describe('code-first route (P0)', () => {
  test('RouteDef.response projects into the OpenAPI 200 content schema', () => {
    const response = Type.Object({ ok: Type.Boolean() });
    const registry = new RouteRegistry().register({
      method: 'GET', path: '/api/probe', operationId: 'probe.get', response,
    });
    const op: any = (registry.toOpenApiPaths() as any)['/api/probe'].get;
    // TypeBox 对象带 Symbol(Kind)（仅内存）；JSON 化后才等价于实际写出的 schema。
    expect(JSON.parse(JSON.stringify(op.responses['200'].content['application/json'].schema)))
      .toEqual(JSON.parse(JSON.stringify(response)));
  });

  test('routes without a response schema keep the bare 200 (no content)', () => {
    const registry = new RouteRegistry().register({
      method: 'GET', path: '/api/legacy', operationId: 'legacy.get',
    });
    const op: any = (registry.toOpenApiPaths() as any)['/api/legacy'].get;
    // E10i-P0: the 200 shape is untouched; error plumbing only adds non-2xx
    // (`default` for every op, 401/403 for `/api/*`).
    expect(op.responses['200']).toEqual({ description: 'OK' });
    expect(Object.keys(op.responses).sort()).toEqual(['200', '401', '403', 'default']);
  });

  test('attachTypedRoute serializes handler data and returns true', async () => {
    const response = Type.Object({ sessions: Type.Array(Type.Object({ id: Type.String() })) });
    const registry = new RouteRegistry().register({
      method: 'GET', path: '/api/sessions', operationId: 'session.list', response,
    });
    attachTypedRoute(registry, {
      operationId: 'session.list',
      response,
      handler: async ({ url }) => ({ sessions: [{ id: url.searchParams.get('x') ?? 'none' }] }),
    });

    const matched = registry.match('GET', '/api/sessions?x=42')!;
    const { res, body } = mockRes();
    const handled = await matched.def.handler!(
      { url: '/api/sessions?x=42', headers: {} } as any,
      res,
      matched.params,
    );
    expect(handled).toBe(true);
    expect(res.statusCode).toBe(200);
    expect(res.headers['Content-Type']).toBe('application/json');
    expect(body()).toEqual({ sessions: [{ id: '42' }] });
  });

  test('attachTypedRoute rejects an unknown operationId (catalog drift)', () => {
    const registry = new RouteRegistry();
    expect(() => attachTypedRoute(registry, {
      operationId: 'nope.missing',
      response: Type.Object({}),
      handler: async () => ({}),
    })).toThrow(/unknown operationId/);
  });
});
