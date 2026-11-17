// E10g closeout: the request-coverage ledger.
//
// `RouteDef.request` is the catalog's single source for a write op's request
// body (`toOpenApiPaths()` projects it to `requestBody`; the gateway never
// validates at runtime — the handler stays the source of truth). After the
// Phase 6 merge the 195 write ops (every non-GET op) close as:
//
//   189 covered + 6 explicitly excluded = 195
//
// This test is the final ledger: every write op must be *exactly one* of
// "declares a request" or "recorded in REQUEST_EXCLUDED with a reason". A new
// write route that lands without either fails here by name; an exclusion that
// drifts out of the catalog fails here too. Response coverage is not touched by
// this ledger (E10f: 125/318).
//
// The 6 exclusions are transport shapes that are not JSON bodies: raw byte
// streams, multipart/form-data, and A2A JSON-RPC pass-through (the protocol owns
// the envelope). Each excluded op has a JSON sibling route
// (`plugins.installPackage`, `media.createTaskApi` / `media.analyzeAudio`,
// `mobile.mediaTaskAsk`) — the write surface is not left unreachable.
import { buildRouteCatalog } from '../../../src/routes/route-catalog';

/**
 * Every non-GET catalog op (the request-body denominator established in E10g-P0).
 * 188 through E10g-W8, +7 Phase 6 plugin recovery POSTs (E10g-fix) + 2 receipt routes = 197.
 */
const WRITE_OPS_TOTAL = 198;

/** Ops that declare a `request` schema (JSON body, optional body, or empty object). */
const COVERED_TOTAL = 192;

/**
 * Declared request bodies with no enumerable fields (`EmptyRequest` / bare
 * `Type.Object({})`): the "no body" actions (pause / resume / stop / abort /
 * seen / cancel / reload …). They must be `requestRequired:false` — the schema
 * says "no fields", not "any body" and not "a required object".
 *
 * 12 session + 9 task/terminal/pod + 13 goal/lead/standing + 7 event/human-gate
 * + 6 mcp/plugin/runtime + 6 memory/device/token + 6 Phase 6 plugin recovery
 * (doctorAll / doctor / kill / resume / unquarantine / rollback) = 61.
 *
 * `session.suspend` / `session.resume` / `session.discardRun` are *not* fieldless:
 * `routes/session-run.ts` reads `reason` / `runId`, so they moved to the
 * optional-body class (E10g-fix F1).
 */
const CLOSED_EMPTY_TOTAL = 61;

/**
 * Write ops whose body is *not* a JSON body, with the reason it is excluded.
 *
 * Adding an entry here is a deliberate decision to leave the transport contract
 * unmodelled in OpenAPI (the spec's §1.3 exclusion list). Do not use it to park
 * an op whose JSON body was simply forgotten: that must get a `request` schema.
 */
const REQUEST_EXCLUDED: Record<string, string> = {
  'plugins.install':
    'raw .js byte stream (readBodyBuffer) + query filename/type/overwrite; no JSON body',
  'media.upload':
    'raw media byte stream (for-await chunks) + query type; no JSON body',
  'media.uploadAndCreate':
    'raw media byte stream + query type/question; no JSON body',
  'media.createTask':
    'A2A JSON-RPC pass-through on POST /a2a (agent.handleJsonRpc); envelope owned by the protocol',
  'mobile.mediaTaskUpload':
    'multipart/form-data file part (boundary parsed in mobile/media-proxy.ts); no JSON body',
  'pods.a2a':
    'A2A JSON-RPC pass-through (raw body → PodA2AAgent.handleJsonRpc); envelope owned by the protocol',
};

interface WriteOpView {
  operationId: string;
  request?: object;
  requestRequired?: boolean;
}

function writeOps(): WriteOpView[] {
  return buildRouteCatalog()
    .filter((def) => def.method !== 'GET')
    .map((def) => ({
      operationId: def.operationId,
      request: def.request,
      requestRequired: def.requestRequired,
    }));
}

describe('request-coverage: ledger for catalog request bodies (E10g)', () => {
  it('every non-GET op is exactly one of "declares a request" or "excluded"', () => {
    const excluded = new Set(Object.keys(REQUEST_EXCLUDED));
    const problems: string[] = [];
    for (const op of writeOps()) {
      const hasRequest = Boolean(op.request);
      const isExcluded = excluded.has(op.operationId);
      if (hasRequest && isExcluded) problems.push(`${op.operationId}: covered and excluded`);
      if (!hasRequest && !isExcluded) problems.push(`${op.operationId}: neither a request nor an exclusion`);
    }
    // Named, so a new write route surfaces by operationId instead of as a count delta.
    expect(problems).toEqual([]);
  });

  it('exclusions are catalog write ops, carry a reason, and never declare a request', () => {
    const byId = new Map(writeOps().map((op) => [op.operationId, op]));
    const problems: string[] = [];
    for (const [id, reason] of Object.entries(REQUEST_EXCLUDED)) {
      const op = byId.get(id);
      if (!op) { problems.push(`${id}: not a catalog write op`); continue; }
      if (reason.trim().length === 0) problems.push(`${id}: exclusion needs a reason`);
      if (op.request) problems.push(`${id}: excluded op must not declare a request`);
    }
    expect(problems).toEqual([]);
    expect(Object.keys(REQUEST_EXCLUDED)).toHaveLength(6);
  });

  it('closes on 198 = 192 covered + 6 excluded', () => {
    const ops = writeOps();
    const covered = ops.filter((op) => Boolean(op.request)).map((op) => op.operationId);
    expect(ops).toHaveLength(WRITE_OPS_TOTAL);
    expect(covered).toHaveLength(COVERED_TOTAL);
    // Duplicates would mask an alias/typo in the catalog.
    expect(new Set(covered).size).toBe(COVERED_TOTAL);
    expect(COVERED_TOTAL + Object.keys(REQUEST_EXCLUDED).length).toBe(WRITE_OPS_TOTAL);
    // Nothing unaccounted for: every write op is covered or excluded.
    const coveredSet = new Set(covered);
    const unaccounted = ops
      .map((op) => op.operationId)
      .filter((id) => !coveredSet.has(id) && !(id in REQUEST_EXCLUDED));
    expect(unaccounted).toEqual([]);
  });

  it('empty-object request schemas are optional (requestRequired:false)', () => {
    const closedEmpty: string[] = [];
    const problems: string[] = [];
    for (const op of writeOps()) {
      const schema = op.request as
        | { properties?: Record<string, unknown>; additionalProperties?: unknown }
        | undefined;
      if (!schema) continue;
      if (Object.keys(schema.properties ?? {}).length !== 0) continue;
      // An open object (`additionalProperties:true`) is a protocol/runtime-owned
      // boundary (`events.webhook.receive`), not a "no body" action.
      if (schema.additionalProperties === true) continue;
      closedEmpty.push(op.operationId);
      if (op.requestRequired !== false) {
        problems.push(`${op.operationId}: empty object must be requestRequired:false`);
      }
    }
    expect(problems).toEqual([]);
    // Pinned so a new fieldless action cannot ship as a *required* body.
    expect(closedEmpty.sort()).toHaveLength(CLOSED_EMPTY_TOTAL);
  });

  it('no GET op declares a request body', () => {
    const getWithRequest = buildRouteCatalog()
      .filter((def) => def.method === 'GET' && def.request)
      .map((def) => def.operationId);
    // A request on a GET would advertise a body the HTTP layer never reads.
    expect(getWithRequest).toEqual([]);
  });
});
