// E10i closeout: the error-response ledger.
//
// Before E10i the catalog modelled only 200 — a client could not learn the shape
// of any 4xx/5xx from OpenAPI. E10i gives every op a non-2xx contract:
//
//   327/327 ops      -> `default` (unified `ErrorEnvelope`, the catch-all)
//   318 /api/* ops   -> + 401 / 403 (transport auth layer)
//   157 ops          -> + 356 explicit status entries (400 / 404 / 409 / 413 / 429 / 503)
//
// `toOpenApiPaths()` is the single projection (`errorResponsesFor(def)` is its
// per-op half), the handler stays the source of truth, and nothing is validated
// at runtime. This file pins the policy so a new route cannot land with a hole
// and a projection cannot drift away from the catalog:
//
//   1. every op has `default` == `ErrorEnvelope`;
//   2. every `/api/*` op has 401 + 403, and no non-`/api` op has either;
//   3. the 9 non-`/api` paths are exactly the known set (health / well-known /
//      a2a / control / register) — those have no transport auth layer;
//   4. every status listed in `errors` is projected, with
//      `errorSchemas[status] ?? ErrorEnvelope`; the only non-envelope shape is
//      the named `goals.respondQuestion` exemption (below);
//   5. the measured ledger (157 ops / 356 entries / per-status split) is pinned,
//      so "someone removed half the explicit statuses" fails here by name;
//   6. mutation test: a dropped `default` (or a dropped 401) fails by
//      operationId; restoring the view returns the audit to zero.
//
// Not asserted here: the *content* of each explicit status (that lives in
// `api-contract.test.ts` per domain report), and 200 bodies (E10f / E10h own
// those ledgers).
import { buildRouteCatalog } from '../../../src/routes/route-catalog';
import { errorResponsesFor, RouteRegistry, type RouteDef } from '../../../src/routes/registry';
import {
  ErrorEnvelope,
  QuotaExceededErrorSchema,
  QuestionLedgerErrorSchema,
} from '../../../src/routes/schemas/errors';

/** Whole catalog after E10h/E10i (330 ops / 296 paths). */
const CATALOG_OPS_TOTAL = 332;

/** Ops whose path starts with `/api/` — the set that carries transport 401/403. */
const API_PREFIX_OPS_TOTAL = 323;

/** Ops that declare at least one explicit error status. */
const EXPLICIT_ERROR_OPS_TOTAL = 161;

/** Sum of `errors.length` over those ops (individual status entries, not distinct statuses). */
const EXPLICIT_ERROR_ENTRIES_TOTAL = 368;

/** Explicit status distribution after E10i (pinned; a status may only move by editing this). */
const EXPLICIT_STATUS_SPLIT: Record<number, number> = {
  400: 127,
  403: 2,
  404: 81,
  409: 56,
  413: 6,
  429: 3,
  503: 93,
};

/**
 * The 9 catalog ops outside `/api/*`. None of them sits behind the transport auth
 * layer, so P0's projection deliberately gives them `default` only (a 401/403
 * here would advertise a door that does not exist). Pinned by id + method + path:
 * adding a tenth non-`/api` route is a transport decision, not an accident.
 */
const NON_API_OPS: Record<string, { method: string; path: string }> = {
  'a2a.agentCard': { method: 'GET', path: '/.well-known/agent-card.json' },
  'goals.controlLegacy': { method: 'POST', path: '/control' },
  'health.root': { method: 'GET', path: '/health' },
  'media.artifact': { method: 'GET', path: '/a2a/artifacts/:id' },
  'media.createTask': { method: 'POST', path: '/a2a' },
  'pods.a2a': { method: 'POST', path: '/a2a/pods/:podId' },
  'pods.a2aArtifact': { method: 'GET', path: '/a2a/pods/:podId/artifacts/:artifactId' },
  'pods.a2aCard': { method: 'GET', path: '/a2a/pods/:podId/.well-known/agent-card.json' },
  'project.setCurrent': { method: 'POST', path: '/register' },
};

/**
 * The only shapes with no `error` field: `goals.respondQuestion`'s handler
 * (`routes/goals-inline.ts`) answers the question ledger with
 * `{status:'not_found'}` / `{status:'conflict', currentState}` — **no `error`
 * field at all** — so forcing the envelope would declare a body the handler
 * never writes. The catalog models the real shape instead.
 *
 * Every other explicit status keeps `error` (the `ErrorEnvelope` field clients
 * already parse), even when the shape is narrowed by `errorSchemas`
 * (`429` → `QuotaExceededErrorSchema`, which still requires `error`).
 *
 * Exemptions are bidirectional: a listed status must project exactly
 * `exemption.schema`, and any non-envelope schema without `error` must have an
 * exemption here. Do not add an entry to park a forgotten envelope.
 */
const ERROR_SCHEMA_EXEMPTIONS: Record<string, { statuses: number[]; schema: object; reason: string }> = {
  'goals.respondQuestion': {
    statuses: [404, 409],
    schema: QuestionLedgerErrorSchema,
    reason: 'question ledger body is {status:not_found|conflict}, no error field',
  },
};

const UNIFIED_ENVELOPE = {
  description: 'Error',
  content: { 'application/json': { schema: ErrorEnvelope } },
};

interface ErrorResponse {
  description?: string;
  content?: Record<string, { schema?: object }>;
}

/** One op as the guard sees it: catalog facts + their OpenAPI projection. */
interface ErrorOpView {
  operationId: string;
  method: string;
  path: string;
  errors: number[];
  errorSchemas?: Record<number, object>;
  responses: Record<string, ErrorResponse>;
}

function schemaOf(response: ErrorResponse | undefined): object | undefined {
  return response?.content?.['application/json']?.schema;
}

function errorOpViews(defs: RouteDef[] = buildRouteCatalog()): ErrorOpView[] {
  return defs.map((def) => ({
    operationId: def.operationId,
    method: def.method,
    path: def.path,
    errors: def.errors ?? [],
    errorSchemas: def.errorSchemas,
    responses: errorResponsesFor(def) as Record<string, ErrorResponse>,
  }));
}

/**
 * The guard itself, as a pure function so the mutation test can drive it with a
 * deliberately broken view (dropping one `default`, one 401) and see it fail by
 * name without touching the catalog.
 */
function auditErrorCoverage(ops: ErrorOpView[] = errorOpViews()): string[] {
  const problems: string[] = [];
  for (const op of ops) {
    const id = op.operationId;
    const isApi = op.path.startsWith('/api/');

    // 1. `default` is the catch-all every op must carry.
    const fallback = op.responses.default;
    if (!fallback) {
      problems.push(`${id}: no default error response`);
    } else if (schemaOf(fallback) !== ErrorEnvelope || fallback.description !== 'Error') {
      problems.push(`${id}: default is not the unified ErrorEnvelope`);
    }

    // 2. Transport auth statuses follow the path prefix, not the tag.
    if (isApi) {
      for (const status of ['401', '403']) {
        const response = op.responses[status];
        if (!response) problems.push(`${id}: /api op has no ${status}`);
        else if (schemaOf(response) !== ErrorEnvelope) problems.push(`${id}: ${status} is not the ErrorEnvelope`);
      }
    } else {
      for (const status of ['401', '403']) {
        if (op.responses[status]) problems.push(`${id}: non-/api op must not declare ${status}`);
      }
    }

    // 3. Every explicit status is projected with a schema; nothing else appears.
    const accounted = new Set(['200', 'default', '401', '403']);
    for (const status of op.errors) {
      accounted.add(String(status));
      const response = op.responses[String(status)];
      if (!response) {
        problems.push(`${id}: errors lists ${status} but nothing is projected`);
        continue;
      }
      const schema = schemaOf(response);
      if (!schema) {
        problems.push(`${id}: ${status} has no JSON error schema`);
        continue;
      }
      const expected = op.errorSchemas?.[status] ?? ErrorEnvelope;
      if (schema !== expected) {
        problems.push(`${id}: ${status} projects neither errorSchemas[${status}] nor ErrorEnvelope`);
      }
      // The unified-envelope invariant: an explicit error body carries `error`,
      // even when `errorSchemas` narrowed it (quota 429 does). The only bodies
      // without `error` are the named exemptions.
      const exemption = ERROR_SCHEMA_EXEMPTIONS[id];
      const exempted = exemption?.statuses.includes(status) ?? false;
      if (schema !== ErrorEnvelope && !((schema as any).required ?? []).includes('error')) {
        if (!exemption) problems.push(`${id}: ${status} uses a body without \`error\` and has no exemption`);
        else if (!exempted) problems.push(`${id}: ${status} is not covered by its exemption`);
        else if (schema !== exemption.schema) problems.push(`${id}: ${status} exemption names a different schema`);
      } else if (exempted) {
        problems.push(`${id}: ${status} is exempted from \`error\` but projects a body that has it`);
      }
    }
    for (const status of Object.keys(op.responses)) {
      if (!accounted.has(status)) problems.push(`${id}: unexpected error status ${status}`);
    }
    // A special shape declared for a status the op never lists would be dead
    // config (it would project nothing, since only `errors` is projected).
    for (const status of Object.keys(op.errorSchemas ?? {})) {
      if (!op.errors.includes(Number(status))) {
        problems.push(`${id}: errorSchemas[${status}] is not listed in errors`);
      }
    }
  }
  return problems;
}

describe('error-coverage: ledger for catalog error responses (E10i)', () => {
  it('every catalog op projects a `default` ErrorEnvelope (330/330)', () => {
    const ops = errorOpViews();
    expect(ops).toHaveLength(CATALOG_OPS_TOTAL);
    expect(auditErrorCoverage(ops)).toEqual([]);
    // The catch-all is the same object for every op, and it keeps the fields the
    // existing clients rely on (`error` required; `code` / `message` / `success`
    // additive; body open so a handler may add domain fields).
    for (const op of ops) expect(op.responses.default).toEqual(UNIFIED_ENVELOPE);
    const schema = ErrorEnvelope as any;
    expect(schema.required).toEqual(['error']);
    expect(schema.properties.error).toBeDefined();
    expect(schema.properties.code).toBeDefined();
    expect(schema.properties.message).toBeDefined();
    expect(schema.properties.success).toBeDefined();
    expect(schema.additionalProperties).toBe(true);
  });

  it('the full toOpenApiPaths() projection agrees with errorResponsesFor() for every op', () => {
    // Guards the real emit path: the audit above runs on the per-def half, this
    // one proves the registry actually assigns it (and that 327 unique
    // method+path keys exist, so no op is silently overwritten by a sibling).
    const paths = new RouteRegistry().register(...buildRouteCatalog()).toOpenApiPaths();
    const projected = new Map<string, any>();
    for (const methods of Object.values<Record<string, any>>(paths)) {
      for (const [method, op] of Object.entries<any>(methods)) {
        projected.set(`${method.toUpperCase()} ${op.operationId}`, op.responses);
      }
    }
    const ops = errorOpViews();
    expect(projected.size).toBe(CATALOG_OPS_TOTAL);
    for (const op of ops) {
      const responses = projected.get(`${op.method} ${op.operationId}`);
      expect(responses).toBeDefined();
      // 200 stays owned by E10f/E10h; only the error half is reconciled here.
      const errorsOnly = Object.fromEntries(
        Object.entries(responses).filter(([status]) => status !== '200'),
      );
      expect(errorsOnly).toEqual(op.responses);
    }
  });

  it('/api/* ops carry 401 + 403 and non-/api ops carry neither (323 / 9)', () => {
    const ops = errorOpViews();
    const api = ops.filter((op) => op.path.startsWith('/api/'));
    const nonApi = ops.filter((op) => !op.path.startsWith('/api/'));
    expect(api).toHaveLength(API_PREFIX_OPS_TOTAL);
    expect(nonApi).toHaveLength(CATALOG_OPS_TOTAL - API_PREFIX_OPS_TOTAL);
    for (const op of api) {
      expect(op.responses['401']).toEqual({
        description: 'Unauthorized',
        content: { 'application/json': { schema: ErrorEnvelope } },
      });
      expect(op.responses['403']).toEqual({
        description: 'Forbidden',
        content: { 'application/json': { schema: ErrorEnvelope } },
      });
    }
    for (const op of nonApi) {
      expect(op.responses['401']).toBeUndefined();
      expect(op.responses['403']).toBeUndefined();
    }
  });

  it('the 9 non-/api ops are exactly the known set', () => {
    const actual: Record<string, { method: string; path: string }> = {};
    for (const op of errorOpViews().filter((o) => !o.path.startsWith('/api/'))) {
      actual[op.operationId] = { method: op.method, path: op.path };
    }
    expect(actual).toEqual(NON_API_OPS);
    expect(Object.keys(actual)).toHaveLength(9);
  });

  it('explicit statuses close on `errorSchemas[status] ?? ErrorEnvelope`', () => {
    // Rule 3 of the audit, isolated: a status listed in `errors` that projects no
    // response, or a response that projects some third schema, fails by name.
    expect(auditErrorCoverage()).toEqual([]);
    const ops = errorOpViews();
    const withErrors = ops.filter((op) => op.errors.length > 0);
    expect(withErrors).toHaveLength(EXPLICIT_ERROR_OPS_TOTAL);
    for (const op of withErrors) {
      for (const status of op.errors) {
        const expected = op.errorSchemas?.[status] ?? ErrorEnvelope;
        expect({ id: op.operationId, status, schema: schemaOf(op.responses[String(status)]) })
          .toEqual({ id: op.operationId, status, schema: expected });
      }
    }
  });

  it('ledger arithmetic: 161 ops / 368 entries with the pinned status split', () => {
    const ops = errorOpViews();
    const withErrors = ops.filter((op) => op.errors.length > 0);
    expect(withErrors).toHaveLength(EXPLICIT_ERROR_OPS_TOTAL);

    const split: Record<number, number> = {};
    let entries = 0;
    for (const op of withErrors) {
      for (const status of op.errors) {
        entries++;
        split[status] = (split[status] ?? 0) + 1;
      }
    }
    expect(entries).toBe(EXPLICIT_ERROR_ENTRIES_TOTAL);
    expect(split).toEqual(EXPLICIT_STATUS_SPLIT);
    // A duplicate status inside one op would inflate the entry count silently.
    for (const op of withErrors) expect(new Set(op.errors).size).toBe(op.errors.length);
    // Every catalog op is accounted for: explicit or default-only.
    expect(withErrors.length + ops.filter((op) => op.errors.length === 0).length)
      .toBe(CATALOG_OPS_TOTAL);
  });

  it('special shapes: quota 429s keep `error`; only the respondQuestion exemption drops it', () => {
    const ops = errorOpViews();
    const nonEnvelope: string[] = [];
    const withoutError: string[] = [];
    for (const op of ops) {
      for (const status of op.errors) {
        const schema = schemaOf(op.responses[String(status)]);
        if (schema !== ErrorEnvelope) nonEnvelope.push(`${op.operationId} ${status}`);
        if (!((schema as any)?.required ?? []).includes('error')) {
          withoutError.push(`${op.operationId} ${status}`);
        }
      }
    }
    // Narrowed-but-envelope-compatible: the three quota 429s only.
    expect(nonEnvelope.sort()).toEqual([
      'goals.respondQuestion 404',
      'goals.respondQuestion 409',
      'project.setCurrent 429',
      'python.execute 429',
      'session.create 429',
    ]);
    for (const id of ['project.setCurrent', 'python.execute', 'session.create']) {
      const op = ops.find((o) => o.operationId === id)!;
      expect(schemaOf(op.responses['429'])).toBe(QuotaExceededErrorSchema);
    }
    // The real exception: two entries, both the question ledger body.
    expect(withoutError.sort()).toEqual(['goals.respondQuestion 404', 'goals.respondQuestion 409']);

    // The table itself: real op, real statuses, non-empty reason, pinned schema.
    expect(Object.keys(ERROR_SCHEMA_EXEMPTIONS)).toEqual(['goals.respondQuestion']);
    const byId = new Map(ops.map((op) => [op.operationId, op]));
    for (const [id, exemption] of Object.entries(ERROR_SCHEMA_EXEMPTIONS)) {
      const op = byId.get(id);
      expect(op).toBeDefined();
      expect(exemption.reason.trim().length).toBeGreaterThan(0);
      expect(exemption.schema).toBe(QuestionLedgerErrorSchema);
      for (const status of exemption.statuses) {
        expect(op!.errors).toContain(status);
        expect(schemaOf(op!.responses[String(status)])).toBe(QuestionLedgerErrorSchema);
      }
    }
    // And the ledger body really is what the exemption claims: no `error` key,
    // `status` is the discriminator the handler writes.
    const ledger = QuestionLedgerErrorSchema as any;
    expect(ledger.properties.error).toBeUndefined();
    expect(ledger.properties.status).toBeDefined();
    expect(ledger.required).toEqual(['status']);
  });

  it('mutation: dropping one default (or one 401) fails the audit by name', () => {
    const ops = errorOpViews();
    const victim = 'session.create';
    const before = ops.find((op) => op.operationId === victim)!;
    expect(before.responses.default).toEqual(UNIFIED_ENVELOPE);

    const withoutDefault = ops.map((op) => {
      if (op.operationId !== victim) return op;
      const { default: _dropped, ...rest } = op.responses;
      return { ...op, responses: rest };
    });
    expect(auditErrorCoverage(withoutDefault)).toEqual([`${victim}: no default error response`]);

    // Directed case 2: an /api op without its transport 401.
    const without401 = ops.map((op) => {
      if (op.operationId !== victim) return op;
      const { 401: _dropped, ...rest } = op.responses;
      return { ...op, responses: rest };
    });
    expect(auditErrorCoverage(without401)).toEqual([`${victim}: /api op has no 401`]);

    // Directed case 3: a non-/api op that grew a transport status.
    const legacy = 'health.root';
    const withAuth = ops.map((op) =>
      op.operationId === legacy
        ? { ...op, responses: { ...op.responses, 401: UNIFIED_ENVELOPE } }
        : op,
    );
    expect(auditErrorCoverage(withAuth)).toEqual([`${legacy}: non-/api op must not declare 401`]);

    // Restore: the untouched view is clean again (nothing was mutated in place).
    expect(auditErrorCoverage(ops)).toEqual([]);
    expect(before.responses.default).toEqual(UNIFIED_ENVELOPE);
  });
});
