// E10-3 schema coverage ledger: how many catalog operations declare a 200
// response schema, sliced by tag, plus the uncovered operation list.
// E10g extends the same scan with request bodies: `requests: X/188` counts
// non-GET ops that declare `request:` (the 188 write-op denominator).
// E10h adds the write-response slice: `write responses: X/195` counts non-GET
// ops that declare `response:` (the 195 write-op denominator from E10g; till
// E10h-P0 only `humanToken.rotate` was covered).
//
// Source of truth is `src/routes/route-catalog.ts` itself (text scan, not a TS
// import) so this stays a plain `node` script with no ts-node/jest dependency
// and never reads generated SDK artifacts (gateway-paths.json / openapi.json).
// Entry objects may be single-line or multi-line, so each `method:` hit is
// expanded to its enclosing brace-balanced object literal.
//
// Usage: node scripts/schema-coverage.cjs [--json]
// Always exits 0 — this is a ledger, not a gate. The gate lives in
// tests/unit/architecture/schema-coverage.test.ts.
const fs = require('fs');
const path = require('path');

const CATALOG_PATH = path.join(__dirname, '..', 'src', 'routes', 'route-catalog.ts');

/** Strip // and /* *\/ comments while respecting string literals. */
function stripComments(src) {
  let out = '';
  let quote = null;
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    const next = src[i + 1];
    if (quote) {
      out += c;
      if (c === '\\') { out += next ?? ''; i++; continue; }
      if (c === quote) quote = null;
      continue;
    }
    if (c === "'" || c === '"' || c === '`') { quote = c; out += c; continue; }
    if (c === '/' && next === '/') {
      while (i < src.length && src[i] !== '\n') i++;
      out += '\n';
      continue;
    }
    if (c === '/' && next === '*') {
      i += 2;
      while (i < src.length && !(src[i] === '*' && src[i + 1] === '/')) {
        if (src[i] === '\n') out += '\n';
        i++;
      }
      i++; // skip the closing '/'
      continue;
    }
    out += c;
  }
  return out;
}

/** Find the `{ ... }` block that owns each `method: '<VERB>'` hit. */
function objectBlocks(src) {
  const blocks = [];
  const re = /method:\s*'(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)'/g;
  let m;
  while ((m = re.exec(src))) {
    const open = src.lastIndexOf('{', m.index);
    if (open < 0) continue;
    let depth = 0;
    let quote = null;
    let close = -1;
    for (let i = open; i < src.length; i++) {
      const c = src[i];
      if (quote) {
        if (c === '\\') { i++; continue; }
        if (c === quote) quote = null;
        continue;
      }
      if (c === "'" || c === '"' || c === '`') { quote = c; continue; }
      if (c === '{') depth++;
      else if (c === '}') {
        depth--;
        if (depth === 0) { close = i; break; }
      }
    }
    if (close < 0) continue;
    blocks.push(src.slice(open, close + 1));
  }
  return blocks;
}

function field(block, name) {
  const m = new RegExp(`\\b${name}:\\s*'([^']*)'`).exec(block);
  return m ? m[1] : undefined;
}

function tags(block) {
  const m = /\btags:\s*\[([^\]]*)\]/.exec(block);
  if (!m) return [];
  return [...m[1].matchAll(/'([^']+)'/g)].map((x) => x[1]);
}

/** Parse the catalog into `{ total, covered, coveredOps, byTag, uncoveredOps }`. */
function analyze(catalogPath = CATALOG_PATH) {
  const raw = fs.readFileSync(catalogPath, 'utf-8');
  const src = stripComments(raw);
  const ops = objectBlocks(src)
    .map((block) => ({
      operationId: field(block, 'operationId'),
      method: field(block, 'method'),
      tags: tags(block),
      hasResponse: /\bresponse\s*:/.test(block),
      hasRequest: /\brequest\s*:/.test(block),
    }))
    .filter((op) => op.operationId);

  const coveredOps = ops.filter((op) => op.hasResponse).map((op) => op.operationId).sort();
  const uncoveredOps = ops.filter((op) => !op.hasResponse).map((op) => op.operationId).sort();

  // E10g: write ops (non-GET) are the request-body denominator. A GET with a
  // body is not a thing we model, so it never counts as covered or uncovered.
  const writeOps = ops.filter((op) => op.method !== 'GET');
  const requestCovered = writeOps.filter((op) => op.hasRequest).map((op) => op.operationId).sort();
  const requestUncovered = writeOps.filter((op) => !op.hasRequest).map((op) => op.operationId).sort();

  // E10h: the same write ops are the *response* denominator — a write response
  // is the 200 body a client parses after the mutation lands.
  const writeResponseCovered = writeOps.filter((op) => op.hasResponse).map((op) => op.operationId).sort();
  const writeResponseUncovered = writeOps
    .filter((op) => !op.hasResponse)
    .map((op) => op.operationId)
    .sort();

  const buckets = new Map();
  for (const op of ops) {
    for (const tag of op.tags.length ? op.tags : ['(untagged)']) {
      const b = buckets.get(tag) ?? { tag, covered: 0, total: 0 };
      b.total++;
      if (op.hasResponse) b.covered++;
      buckets.set(tag, b);
    }
  }
  const byTag = [...buckets.values()].sort((a, b) => a.tag.localeCompare(b.tag));

  return {
    total: ops.length,
    covered: coveredOps.length,
    coveredOps,
    byTag,
    uncoveredOps,
    requests: requestCovered.length,
    requestCovered,
    requestTotal: writeOps.length,
    requestUncovered,
    writeResponses: writeResponseCovered.length,
    writeResponseCovered,
    writeResponseTotal: writeOps.length,
    writeResponseUncovered,
  };
}

function printReport(report) {
  const pct = report.total ? ((report.covered / report.total) * 100).toFixed(1) : '0.0';
  console.log(
    `schema coverage: ${report.covered}/${report.total} operations declare a 200 response schema (${pct}%)`,
  );
  console.log('by tag (covered/total):');
  for (const t of report.byTag) {
    console.log(`  ${t.tag.padEnd(16)} ${String(t.covered).padStart(3)}/${String(t.total).padEnd(3)}`);
  }
  const requestPct = report.requestTotal ? ((report.requests / report.requestTotal) * 100).toFixed(1) : '0.0';
  console.log(
    `requests: ${report.requests}/${report.requestTotal} write operations declare a request body schema (${requestPct}%)`,
  );
  const writePct = report.writeResponseTotal
    ? ((report.writeResponses / report.writeResponseTotal) * 100).toFixed(1)
    : '0.0';
  console.log(
    `write responses: ${report.writeResponses}/${report.writeResponseTotal} write operations declare a 200 response schema (${writePct}%)`,
  );
  console.log(`uncovered operations (${report.uncoveredOps.length}):`);
  for (const id of report.uncoveredOps) console.log(`  - ${id}`);
}

if (require.main === module) {
  const report = analyze();
  if (process.argv.includes('--json')) console.log(JSON.stringify(report, null, 2));
  else printReport(report);
}

module.exports = { analyze, printReport, CATALOG_PATH };
