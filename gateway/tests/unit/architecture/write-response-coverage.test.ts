// E10h closeout: the write-response ledger.
//
// Every non-GET catalog op (199 of them) must close on *exactly one* of:
//
//   198 covered  +  1 excluded (tts.speakStream)  =  199
//
// `RouteDef.response` is the catalog's single source for a write op's 200 body
// (`toOpenApiPaths()` projects it to `responses.200.content['application/json']`;
// the gateway never validates at runtime — the handler stays the source of
// truth). A new write route that lands without either fails here *by name*, and
// an exclusion that drifts out of the catalog fails here too.
//
// GET coverage is **not** re-asserted here: it has its own ledger
// (`schema-coverage.test.ts` / `E10_COVERED_OPS`). This file only guards the
// write half, which is why the 6 non-JSON GET transport endpoints
// (`event.subscribe` SSE, `media.artifact`, `pods.a2aArtifact`,
// `mobile.ttsArtifact`, `plugins.webAsset`, `plugins.webEvents`) appear only as
// "uncovered" in the total-response arithmetic.
//
// The single exclusion is a transport shape, not a forgotten schema:
// `tts.speakStream` answers `text/event-stream` with PCM16 chunks
// (`data: {data,voice}` … `{"done":true}`) — not one JSON document. Its request
// body *is* covered by E10g; only the streamed 200 is left unmodelled.
import { buildRouteCatalog } from '../../../src/routes/route-catalog';

/** Every non-GET catalog op (the write-response denominator, same set as E10g requests). */
const WRITE_OPS_TOTAL = 200;

/** Write ops that declare a `response` schema (all but `tts.speakStream`). */
const COVERED_TOTAL = 199;

/** Whole-catalog size and response coverage after E10h (127 pre-wave → 330). */
const CATALOG_OPS_TOTAL = 337;
const CATALOG_RESPONSES_TOTAL = 330;

/**
 * Write ops whose 200 is *not* a JSON body, with the reason it is excluded.
 *
 * Adding an entry here is a deliberate decision to leave the transport contract
 * unmodelled in OpenAPI. Do not use it to park an op whose JSON body was simply
 * forgotten: that must get a `response` schema.
 */
const WRITE_RESPONSE_EXCLUDED: Record<string, string> = {
  'tts.speakStream': 'audio byte stream (PCM16), not JSON',
};

/**
 * Write 200s that are open at the top level (`additionalProperties:true`), i.e.
 * the body is owned by someone else:
 *   - `pods.a2a` / `media.createTask` — A2A JSON-RPC envelope (protocol-owned);
 *   - `session.command` — no gateway handler, tail-proxies runtime serve;
 *   - `mafwCommands.run` — user command registry may append arbitrary keys.
 * Pinned so a new open top-level object cannot ship silently.
 */
const OPEN_TOP_LEVEL = ['mafwCommands.run', 'media.createTask', 'pods.a2a', 'session.command'];

/**
 * Write 200s whose JSON body is literally `{}` (handler `json(200, {})`).
 * Intentional: these actions report success through the status code only.
 */
const EMPTY_BODY = ['session.background', 'session.revert', 'session.summarize', 'session.unrevert'];

/**
 * Write 200s modelled as a union (`anyOf`), i.e. the handler has >1 success
 * shape. Flattening one of these into an optional-heavy object would legalize
 * key combinations the handler never emits, so the set is pinned.
 */
const UNION_BODIES = [
  'cognition.gate',
  'memory.add',
  'memory.merge',
  'memory.setSticky',
  'obs.capture',
  'plugins.delete',
  'plugins.disable',
  'plugins.enable',
  'session.promptAsync',
  'triage.confirm',
];

interface OpView {
  operationId: string;
  method: string;
  response?: object | null;
}

function opViews(): OpView[] {
  return buildRouteCatalog().map((def) => ({
    operationId: def.operationId,
    method: def.method,
    response: def.response,
  }));
}

function writeOps(ops: OpView[] = opViews()): OpView[] {
  return ops.filter((op) => op.method !== 'GET');
}

/**
 * The guard itself, as a pure function so the mutation test can drive it with a
 * deliberately broken catalog view (removing one `response`, dropping one
 * exclusion) and see it fail by name.
 */
function auditWriteResponses(ops: OpView[] = opViews()): string[] {
  const excluded = new Set(Object.keys(WRITE_RESPONSE_EXCLUDED));
  const problems: string[] = [];
  for (const op of writeOps(ops)) {
    const hasResponse = Boolean(op.response);
    const isExcluded = excluded.has(op.operationId);
    if (hasResponse && isExcluded) problems.push(`${op.operationId}: declares a response and is excluded`);
    if (!hasResponse && !isExcluded) problems.push(`${op.operationId}: neither a response nor an exclusion`);
  }
  return problems;
}

function shapeOf(schema: any): { open: boolean; empty: boolean; union: boolean } {
  const union = Array.isArray(schema?.anyOf);
  const open = schema?.type === 'object' && schema?.additionalProperties === true;
  const empty =
    schema?.type === 'object' &&
    schema?.additionalProperties !== true &&
    typeof schema?.properties === 'object' &&
    Object.keys(schema.properties).length === 0;
  return { open, empty, union };
}

describe('write-response-coverage: ledger for catalog write responses (E10h)', () => {
  it('every non-GET op is exactly one of "declares a response" or "excluded"', () => {
    // Named, so a new write route surfaces by operationId instead of as a count delta.
    expect(auditWriteResponses()).toEqual([]);
  });

  it('the exclusion is a catalog write op, carries a reason, and declares no response', () => {
    const byId = new Map(writeOps().map((op) => [op.operationId, op]));
    const problems: string[] = [];
    for (const [id, reason] of Object.entries(WRITE_RESPONSE_EXCLUDED)) {
      const op = byId.get(id);
      if (!op) { problems.push(`${id}: not a catalog write op`); continue; }
      if (reason.trim().length === 0) problems.push(`${id}: exclusion needs a reason`);
      if (op.response) problems.push(`${id}: excluded op must not declare a response`);
    }
    expect(problems).toEqual([]);
    expect(Object.keys(WRITE_RESPONSE_EXCLUDED)).toEqual(['tts.speakStream']);
  });

  it('closes on 200 write ops = 199 covered + 1 excluded', () => {
    const ops = writeOps();
    const covered = ops.filter((op) => Boolean(op.response)).map((op) => op.operationId);
    expect(ops).toHaveLength(WRITE_OPS_TOTAL);
    expect(covered).toHaveLength(COVERED_TOTAL);
    // Duplicates would mask an alias/typo in the catalog.
    expect(new Set(covered).size).toBe(COVERED_TOTAL);
    expect(COVERED_TOTAL + Object.keys(WRITE_RESPONSE_EXCLUDED).length).toBe(WRITE_OPS_TOTAL);
    // Nothing unaccounted for: every write op is covered or excluded.
    const coveredSet = new Set(covered);
    const unaccounted = ops
      .map((op) => op.operationId)
      .filter((id) => !coveredSet.has(id) && !(id in WRITE_RESPONSE_EXCLUDED));
    expect(unaccounted).toEqual([]);
  });

  it('whole-catalog arithmetic: 330/337 with the 7 gaps fully accounted for', () => {
    const ops = opViews();
    expect(ops).toHaveLength(CATALOG_OPS_TOTAL);
    const covered = ops.filter((op) => Boolean(op.response)).map((op) => op.operationId);
    expect(covered).toHaveLength(CATALOG_RESPONSES_TOTAL);
    expect(CATALOG_OPS_TOTAL - CATALOG_RESPONSES_TOTAL).toBe(7);
    // The 7 gaps are exactly: 6 non-JSON GET transports (their own ledger) + the 1 write exclusion.
    const getGaps = ops
      .filter((op) => op.method === 'GET' && !op.response)
      .map((op) => op.operationId)
      .sort();
    expect(getGaps).toEqual([
      'event.subscribe',
      'media.artifact',
      'mobile.ttsArtifact',
      'plugins.webAsset',
      'plugins.webEvents',
      'pods.a2aArtifact',
    ]);
    const writeGaps = ops
      .filter((op) => op.method !== 'GET' && !op.response)
      .map((op) => op.operationId);
    expect(writeGaps).toEqual(['tts.speakStream']);
  });

  it('does not require GET coverage here (GET is the read-surface ledger)', () => {
    // The write denominator must not contain a single GET: if one leaked in, the
    // 196/197 arithmetic would silently change meaning.
    const getIds = new Set(opViews().filter((op) => op.method === 'GET').map((op) => op.operationId));
    const coveredIds = writeOps().filter((op) => Boolean(op.response)).map((op) => op.operationId);
    expect(coveredIds.filter((id) => getIds.has(id))).toEqual([]);
    // Excluding a GET here would be a boundary violation (it belongs to the
    // transport-level read ledger, not to this one).
    expect(Object.keys(WRITE_RESPONSE_EXCLUDED).filter((id) => getIds.has(id))).toEqual([]);
    // And GETs are not silently counted as write ops.
    expect(writeOps().filter((op) => op.method === 'GET')).toEqual([]);
  });

  it('200 shapes are closed unless the body is owned by someone else', () => {
    const open: string[] = [];
    const empty: string[] = [];
    const unions: string[] = [];
    for (const op of writeOps()) {
      if (!op.response) continue;
      const shape = shapeOf(op.response);
      if (shape.open) open.push(op.operationId);
      else if (shape.empty) empty.push(op.operationId);
      if (shape.union) unions.push(op.operationId);
    }
    // `session.command` / `media.createTask` / `pods.a2a` are also open+empty by
    // construction; `shapeOf` reports them as open only.
    expect(open.sort()).toEqual(OPEN_TOP_LEVEL);
    expect(empty.sort()).toEqual(EMPTY_BODY);
    expect(unions.sort()).toEqual(UNION_BODIES);
  });

  it('mutation: dropping one response or one exclusion fails the audit by name', () => {
    const ops = opViews();
    // Sanity: the victim is a real, covered write op before we break it.
    const victim = 'session.create';
    expect(ops.find((op) => op.operationId === victim)?.response).toBeTruthy();

    const withoutResponse = ops.map((op) =>
      op.operationId === victim ? { ...op, response: undefined } : op,
    );
    expect(auditWriteResponses(withoutResponse)).toEqual([
      `${victim}: neither a response nor an exclusion`,
    ]);

    // Directed case: a dropped exclusion surfaces as "neither" for the stream op.
    const excludedId = Object.keys(WRITE_RESPONSE_EXCLUDED)[0];
    const savedReason = WRITE_RESPONSE_EXCLUDED[excludedId];
    delete WRITE_RESPONSE_EXCLUDED[excludedId];
    try {
      expect(auditWriteResponses(ops)).toEqual([
        `${excludedId}: neither a response nor an exclusion`,
      ]);
    } finally {
      WRITE_RESPONSE_EXCLUDED[excludedId] = savedReason;
    }

    // Restore: the untouched catalog view is clean again.
    expect(auditWriteResponses(ops)).toEqual([]);
    expect(Object.keys(WRITE_RESPONSE_EXCLUDED)).toEqual(['tts.speakStream']);
  });
});
