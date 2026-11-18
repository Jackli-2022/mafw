#!/usr/bin/env node
/**
 * Personal-recall evaluation runner (Task 1 baseline).
 *
 * Measures the two real retrieval entrypoints against a frozen set of
 * personal queries, using read-only HTTP against a running gateway:
 *
 *   REST  GET /api/memory/search?query=<q>&topK=3   (raw index surface)
 *   AUTO  GET /api/recall/context?query=<q>[&sessionID=]  (boundary recall)
 *
 * Metrics are LongMemEval-style where practical: hit@1, hit@3, MRR, negative
 * false-injection, stale-injection (must_exclude), entrypoint agreement and
 * p50/p95 latency. Expectations are frozen in queries.json — this runner
 * never derives them from live ranks.
 *
 * Note-board and pinned blocks are must-surface, not related recall: they are
 * stripped before auto-recall ids are parsed, otherwise a sticky reminder
 * would count as a related-memory hit or as a false injection.
 *
 * Usage:
 *   node evaluation/personal-recall/run.js --out <absolute-json-path>
 *        [--base-url http://127.0.0.1:3000] [--fixture <path>]
 *
 * Dependency-free: only node built-ins + global fetch.
 */
'use strict';

const fs = require('fs');
const path = require('path');

const DEFAULT_BASE_URL = 'http://127.0.0.1:3000';
const DEFAULT_TIMEOUT_MS = 20_000;
const REST_TOP_K = 3;
const CATEGORIES = ['current-state', 'exact', 'implicit', 'negative'];
const REQUIRED_PER_CATEGORY = 10;
const REQUIRED_TOTAL = REQUIRED_PER_CATEGORY * CATEGORIES.length;

/** `#mem-xxxxxx` pointer: inject-format renders the last 6 chars of the id. */
const POINTER_RE = /#mem-([0-9a-z]{6})(?![0-9a-z])/g;
/** Blocks that are guaranteed per-turn surfaces, never related recall. */
const SURFACE_BLOCKS = [
  /<note-board>[\s\S]*?<\/note-board>/g,
  /<user-profile>[\s\S]*?<\/user-profile>/g,
  /<agent-priors>[\s\S]*?<\/agent-priors>/g,
];

function tailOf(id) {
  return String(id).slice(-6);
}

function stripSurfaces(pointers) {
  let text = String(pointers || '');
  for (const re of SURFACE_BLOCKS) text = text.replace(re, '');
  return text;
}

/**
 * Parse auto-recall pointers into ordered `{ tail, neighbor }` records.
 * Neighbour lines (`↳`) are still injected evidence, but they never compete
 * for ranking, so the caller keeps them separate.
 */
function parseRecallPointers(pointers) {
  if (!pointers) return [];
  const out = [];
  for (const line of stripSurfaces(pointers).split(/\r?\n/)) {
    const matches = line.match(POINTER_RE);
    if (!matches) continue;
    const neighbor = line.includes('↳');
    for (const raw of matches) out.push({ tail: raw.slice('#mem-'.length), neighbor });
  }
  return out;
}

/** Whether the block actually carries a related-recall body (not just headers). */
function hasRelatedBody(pointers) {
  if (!pointers) return false;
  return /<recall(\s|>)/.test(stripSurfaces(pointers));
}

function percentile(values, p) {
  if (!Array.isArray(values) || values.length === 0) return 0;
  const sorted = values.slice().sort((a, b) => a - b);
  const rank = Math.ceil((p / 100) * sorted.length) - 1;
  return sorted[Math.min(sorted.length - 1, Math.max(0, rank))];
}

function mean(values) {
  if (values.length === 0) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function round(value, digits = 4) {
  if (!Number.isFinite(value)) return value;
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

/** hit@k over a multi-id expectation: any expected id in the top k. */
function hitAtK(expectedIds, actualIds, k) {
  if (expectedIds.length === 0) return actualIds.length === 0;
  const top = new Set(actualIds.slice(0, Math.max(0, k)));
  return expectedIds.some((id) => top.has(id));
}

/** Reciprocal rank of the first expected id (0 when absent). */
function mrr(expectedIds, actualIds) {
  if (expectedIds.length === 0) return actualIds.length === 0 ? 1 : 0;
  const wanted = new Set(expectedIds);
  for (let i = 0; i < actualIds.length; i++) {
    if (wanted.has(actualIds[i])) return 1 / (i + 1);
  }
  return 0;
}

function firstRank(expectedIds, actualIds) {
  const wanted = new Set(expectedIds.map(tailOf));
  for (let i = 0; i < actualIds.length; i++) {
    if (wanted.has(tailOf(actualIds[i]))) return i + 1;
  }
  return null;
}

/**
 * Structural fixture validation.
 *
 * `knownIds` (optional) is the frozen corpus id set: every must_include /
 * must_exclude id must exist in it, so a stale expectation cannot silently
 * degrade into a permanent miss.
 */
function validateFixture(fixture, options = {}) {
  const knownIds = options.knownIds || null;
  if (!fixture || typeof fixture !== 'object') throw new Error('fixture must be an object');
  if (!Array.isArray(fixture.entries)) throw new Error('fixture.entries must be an array');
  const seen = new Set();
  for (const entry of fixture.entries) {
    if (!entry || typeof entry !== 'object') throw new Error('fixture entry must be an object');
    if (typeof entry.id !== 'string' || entry.id.trim() === '') {
      throw new Error('fixture entry is missing a non-empty id');
    }
    if (seen.has(entry.id)) throw new Error(`duplicate entry id: ${entry.id}`);
    seen.add(entry.id);
    if (!CATEGORIES.includes(entry.category)) {
      throw new Error(`unknown category "${entry.category}" for entry ${entry.id}`);
    }
    if (typeof entry.query !== 'string' || entry.query.trim() === '') {
      throw new Error(`entry ${entry.id} is missing a non-empty query`);
    }
    for (const key of ['must_include', 'must_exclude']) {
      if (!Array.isArray(entry[key]) || entry[key].some((id) => typeof id !== 'string' || id.trim() === '')) {
        throw new Error(`entry ${entry.id} has invalid ${key} (expected string[])`);
      }
    }
    if (entry.category === 'negative' && entry.must_include.length > 0) {
      throw new Error(`negative entry ${entry.id} must not declare must_include`);
    }
    if (entry.must_include.length === 0) {
      const markedNoAnswer = /no[- ]answer/i.test(String(entry.note || ''));
      if (entry.category !== 'negative' && !markedNoAnswer) {
        throw new Error(
          `must_include is empty for ${entry.id}: only negative or explicitly no-answer entries may omit it`,
        );
      }
    }
    if (knownIds) {
      for (const id of [...entry.must_include, ...entry.must_exclude]) {
        if (!knownIds.has(id)) throw new Error(`unknown memory id "${id}" in entry ${entry.id}`);
      }
    }
  }
  return true;
}

/** Real-set validation: shape + exactly 10 entries per category (40 total). */
function validateRealFixture(fixture, options = {}) {
  validateFixture(fixture, options);
  const counts = Object.fromEntries(CATEGORIES.map((category) => [category, 0]));
  for (const entry of fixture.entries) counts[entry.category]++;
  const wrong = CATEGORIES.filter((category) => counts[category] !== REQUIRED_PER_CATEGORY);
  if (wrong.length > 0 || fixture.entries.length !== REQUIRED_TOTAL) {
    const detail = CATEGORIES.map((category) => `${category}=${counts[category]}`).join(', ');
    throw new Error(
      `category count mismatch: expected exactly ${REQUIRED_PER_CATEGORY} per category ` +
        `(${REQUIRED_TOTAL} total), got ${fixture.entries.length} (${detail})`,
    );
  }
  return true;
}

/**
 * Resolve `id=<6-char tail>` to a full memory id via /api/memory/get (the same
 * pointer-tail lookup mafw_get_memory uses). Cached per run.
 */
function createTailResolver({ baseUrl, fetchImpl, timeoutMs, seed = new Map() }) {
  const cache = new Map(seed);
  return async function resolveTail(tail) {
    if (cache.has(tail)) return cache.get(tail);
    const res = await fetchImpl(`${baseUrl}/api/memory/get?id=${encodeURIComponent(tail)}`, {
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!res.ok) {
      cache.set(tail, null);
      return null;
    }
    const body = await res.json();
    const id = body?.memory?.id ?? body?.id ?? null;
    cache.set(tail, id);
    return id;
  };
}

/** Fail fast when a frozen expectation no longer exists or is superseded. */
async function fetchMemoryByTail(tail, { baseUrl, fetchImpl, timeoutMs }) {
  const res = await fetchImpl(`${baseUrl}/api/memory/get?id=${encodeURIComponent(tail)}`, {
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!res.ok) return null;
  const body = await res.json();
  const memory = body?.memory ?? body;
  if (!memory || typeof memory.id !== 'string') return null;
  return memory;
}

/**
 * Fail fast when a frozen expectation no longer exists in the live corpus.
 *
 * must_include members must also be ACTIVE: retrieval rewrites superseded hits
 * to their supersede-chain head (resolveSupersededHeads), so a superseded
 * expectation can never be returned and would silently become a permanent
 * miss. must_exclude members are intentionally stale and are exempt.
 */
async function verifyFixtureIds(fixture, { baseUrl = DEFAULT_BASE_URL, fetchImpl = fetch, timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
  const resource = { baseUrl, fetchImpl, timeoutMs };
  const includeIds = new Set();
  const excludeIds = new Set();
  for (const entry of fixture.entries) {
    for (const id of entry.must_include) includeIds.add(id);
    for (const id of entry.must_exclude) excludeIds.add(id);
  }
  const unknown = [];
  const superseded = [];
  for (const id of includeIds) {
    const memory = await fetchMemoryByTail(tailOf(id), resource);
    if (!memory || memory.id !== id) unknown.push(id);
    else if (memory.superseded_by) superseded.push(`${id} -> ${memory.superseded_by}`);
  }
  for (const id of excludeIds) {
    const memory = await fetchMemoryByTail(tailOf(id), resource);
    if (!memory || memory.id !== id) unknown.push(id);
  }
  if (unknown.length > 0) {
    throw new Error(`unknown memory id(s) in fixture (not in live corpus): ${unknown.join(', ')}`);
  }
  if (superseded.length > 0) {
    throw new Error(
      `superseded memory id(s) in must_include (retrieval rewrites them to the chain head, so they can never be returned): ${superseded.join(', ')}`,
    );
  }
  return true;
}

async function getJson(fetchImpl, url, timeoutMs) {
  const res = await fetchImpl(url, { signal: AbortSignal.timeout(timeoutMs) });
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  return res.json();
}

/** Measure one fixture entry across both entrypoints. */
async function runEntry(entry, ctx) {
  const { baseUrl, fetchImpl, timeoutMs, defaultSessionID, resolveTail, corpusTails } = ctx;
  const sessionID = entry.sessionID || defaultSessionID || null;

  const restUrl = `${baseUrl}/api/memory/search?query=${encodeURIComponent(entry.query)}&topK=${REST_TOP_K}`;
  const restStart = Date.now();
  const restBody = await getJson(fetchImpl, restUrl, timeoutMs);
  const restMs = Date.now() - restStart;
  const restIds = (restBody.results || []).map((r) => r.id).filter(Boolean);

  const autoParams = [`query=${encodeURIComponent(entry.query)}`];
  if (sessionID) autoParams.push(`sessionID=${encodeURIComponent(sessionID)}`);
  const autoUrl = `${baseUrl}/api/recall/context?${autoParams.join('&')}`;
  const autoStart = Date.now();
  const autoBody = await getJson(fetchImpl, autoUrl, timeoutMs);
  const autoMs = Date.now() - autoStart;

  // Resolution happens after both timings: pointer-tail lookups are report
  // bookkeeping, not part of the boundary latency contract.
  const parsed = parseRecallPointers(autoBody.pointers);
  const autoIds = [];
  for (const { tail } of parsed) {
    const full = await resolveTail(tail);
    autoIds.push(full || `#mem-${tail}`);
  }
  const autoTails = parsed.map((p) => p.tail);
  // `auto.rank` is anchor-relative: neighbour (`↳`) lines are injected
  // evidence but never compete for ranking, so they must not improve rank.
  const anchorTails = parsed.filter((p) => !p.neighbor).map((p) => p.tail);
  const anchorIds = [];
  for (const tail of anchorTails) {
    const full = await resolveTail(tail);
    anchorIds.push(full || `#mem-${tail}`);
  }

  const expected = entry.must_include || [];
  const excludedIds = entry.must_exclude || [];
  const included = expected.filter((id) => autoTails.includes(tailOf(id)) || autoIds.includes(id));
  const excluded = excludedIds.filter((id) => autoTails.includes(tailOf(id)));
  const restRank = firstRank(expected, restIds);
  const autoRank = firstRank(expected, anchorIds);
  const isNegative = entry.category === 'negative';

  const row = {
    id: entry.id,
    category: entry.category,
    query: entry.query,
    sessionID,
    rest: {
      ids: restIds,
      rank: restRank,
      hit1: expected.length ? hitAtK(expected, restIds, 1) : null,
      hit3: expected.length ? hitAtK(expected, restIds, REST_TOP_K) : null,
      mrr: expected.length ? round(mrr(expected, restIds)) : null,
      latencyMs: restMs,
    },
    auto: {
      relatedBody: hasRelatedBody(autoBody.pointers),
      ids: autoIds,
      tails: autoTails,
      anchors: anchorTails,
      anchorIds,
      included,
      excluded,
      hit: isNegative ? autoIds.length === 0 : included.length > 0,
      // Anchor-relative: neighbour lines never compete for ranking.
      rank: autoRank,
      falseInjection: isNegative ? autoIds.length > 0 : false,
      staleInjection: excluded.length > 0,
      latencyMs: autoMs,
    },
    entrypointAgreement: isNegative ? null : Boolean(hitAtK(expected, restIds, REST_TOP_K)) === (included.length > 0),
    corpusTailsKnown: autoTails.filter((tail) => corpusTails.has(tail)).length,
    pointers: autoBody.pointers ?? null,
  };
  return row;
}

function summarize(rows) {
  const positives = rows.filter((row) => row.category !== 'negative');
  const negatives = rows.filter((row) => row.category === 'negative');
  const restLatency = rows.map((row) => row.rest.latencyMs);
  const autoLatency = rows.map((row) => row.auto.latencyMs);
  const staleIds = [];
  for (const row of rows) for (const id of row.auto.excluded) staleIds.push(id);
  const falseIds = [];
  for (const row of negatives) for (const id of row.auto.ids) falseIds.push(id);
  const compared = positives.length;
  const agree = positives.filter((row) => row.entrypointAgreement).length;

  const byCategory = {};
  for (const category of CATEGORIES) {
    const group = rows.filter((row) => row.category === category);
    if (group.length === 0) continue;
    const groupPositives = group.filter((row) => row.category !== 'negative');
    byCategory[category] = {
      entries: group.length,
      restHit1: groupPositives.length ? round(mean(groupPositives.map((row) => (row.rest.hit1 ? 1 : 0)))) : null,
      restHit3: groupPositives.length ? round(mean(groupPositives.map((row) => (row.rest.hit3 ? 1 : 0)))) : null,
      autoHitRate: groupPositives.length ? round(mean(groupPositives.map((row) => (row.auto.hit ? 1 : 0)))) : null,
      falseInjection: group.length ? round(mean(group.map((row) => (row.auto.falseInjection ? 1 : 0)))) : null,
      staleInjection: group.filter((row) => row.auto.staleInjection).length,
    };
  }

  return {
    entries: rows.length,
    positives: positives.length,
    negatives: negatives.length,
    rest: {
      positive: positives.length,
      hit1: round(mean(positives.map((row) => (row.rest.hit1 ? 1 : 0)))),
      hit3: round(mean(positives.map((row) => (row.rest.hit3 ? 1 : 0)))),
      mrr: round(mean(positives.map((row) => row.rest.mrr ?? 0))),
    },
    auto: {
      positive: positives.length,
      hit: positives.filter((row) => row.auto.hit).length,
      hitRate: round(mean(positives.map((row) => (row.auto.hit ? 1 : 0)))),
      rank1: positives.filter((row) => row.auto.rank === 1).length,
      meanRank: round(
        mean(positives.filter((row) => row.auto.rank != null).map((row) => row.auto.rank)),
        2,
      ),
    },
    falseInjection: {
      controls: negatives.length,
      injected: negatives.filter((row) => row.auto.falseInjection).length,
      rate: negatives.length ? round(negatives.filter((row) => row.auto.falseInjection).length / negatives.length) : 0,
      ids: falseIds,
    },
    staleInjection: {
      entries: rows.filter((row) => row.auto.staleInjection).length,
      ids: staleIds,
    },
    entrypointAgreement: {
      compared,
      agree,
      rate: compared ? round(agree / compared) : 0,
    },
    latency: {
      rest: { p50: percentile(restLatency, 50), p95: percentile(restLatency, 95), max: Math.max(0, ...restLatency) },
      auto: { p50: percentile(autoLatency, 50), p95: percentile(autoLatency, 95), max: Math.max(0, ...autoLatency) },
    },
    byCategory,
  };
}

/** Run the whole fixture sequentially (the gateway is a shared live process). */
async function runEvaluation(options) {
  const {
    fixture,
    baseUrl = DEFAULT_BASE_URL,
    fetchImpl = fetch,
    timeoutMs = DEFAULT_TIMEOUT_MS,
    sessionID = null,
    fixturePath = null,
  } = options || {};
  validateFixture(fixture);
  const corpusTails = new Set();
  const seed = new Map();
  for (const entry of fixture.entries) {
    for (const id of [...entry.must_include, ...entry.must_exclude]) {
      corpusTails.add(tailOf(id));
      seed.set(tailOf(id), id);
    }
  }
  const resolveTail = createTailResolver({ baseUrl, fetchImpl, timeoutMs, seed });
  const rows = [];
  for (const entry of fixture.entries) {
    rows.push(
      await runEntry(entry, {
        baseUrl,
        fetchImpl,
        timeoutMs,
        defaultSessionID: sessionID,
        resolveTail,
        corpusTails,
      }),
    );
  }
  return {
    generatedAt: new Date().toISOString(),
    baseUrl,
    sessionID,
    fixture: {
      path: fixturePath,
      version: fixture.version ?? null,
      createdAt: fixture.createdAt ?? null,
      corpus: fixture.corpus ?? null,
      status: fixture.status ?? null,
      entries: fixture.entries.length,
    },
    summary: summarize(rows),
    rows,
  };
}

function formatSummary(summary) {
  const pct = (value) => (value == null ? 'n/a' : `${(value * 100).toFixed(1)}%`);
  const lines = [];
  lines.push(`entries: ${summary.entries} (positive ${summary.positives}, negative ${summary.negatives})`);
  lines.push(
    `REST   hit@1 ${pct(summary.rest.hit1)}  hit@3 ${pct(summary.rest.hit3)}  MRR ${summary.rest.mrr.toFixed(3)}`,
  );
  lines.push(
    `AUTO   hit ${pct(summary.auto.hitRate)} (${summary.auto.hit}/${summary.auto.positive})  rank1 ${summary.auto.rank1}  meanRank ${summary.auto.meanRank}`,
  );
  lines.push(
    `false-injection ${pct(summary.falseInjection.rate)} (${summary.falseInjection.injected}/${summary.falseInjection.controls})  ` +
      `stale-injection ${summary.staleInjection.entries}`,
  );
  lines.push(`entrypoint agreement ${pct(summary.entrypointAgreement.rate)} (${summary.entrypointAgreement.agree}/${summary.entrypointAgreement.compared})`);
  lines.push(
    `latency REST p50 ${summary.latency.rest.p50}ms p95 ${summary.latency.rest.p95}ms  ` +
      `AUTO p50 ${summary.latency.auto.p50}ms p95 ${summary.latency.auto.p95}ms`,
  );
  for (const [category, value] of Object.entries(summary.byCategory)) {
    lines.push(
      `  ${category.padEnd(13)} n=${value.entries} rest@1 ${pct(value.restHit1)} rest@3 ${pct(value.restHit3)} ` +
        `auto ${pct(value.autoHitRate)} false ${pct(value.falseInjection)} stale ${value.staleInjection}`,
    );
  }
  return lines.join('\n');
}

function writeReport(outPath, report) {
  if (!path.isAbsolute(outPath)) throw new Error(`--out must be an absolute path, got "${outPath}"`);
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, `${JSON.stringify(report, null, 2)}\n`, 'utf-8');
  return outPath;
}

function parseArgs(argv) {
  const args = { out: null, baseUrl: DEFAULT_BASE_URL, fixture: null, timeoutMs: DEFAULT_TIMEOUT_MS, sessionID: null };
  for (let i = 0; i < argv.length; i++) {
    const flag = argv[i];
    const next = () => {
      const value = argv[++i];
      if (value == null) throw new Error(`missing value for ${flag}`);
      return value;
    };
    if (flag === '--out') args.out = next();
    else if (flag === '--base-url') args.baseUrl = next();
    else if (flag === '--fixture') args.fixture = next();
    else if (flag === '--timeout-ms') args.timeoutMs = Number(next());
    else if (flag === '--session') args.sessionID = next();
    else if (flag === '--help' || flag === '-h') args.help = true;
    else throw new Error(`unknown argument: ${flag}`);
  }
  return args;
}

async function main(argv = process.argv.slice(2), deps = {}) {
  const args = parseArgs(argv);
  if (args.help) {
    console.log('usage: node evaluation/personal-recall/run.js --out <absolute-json-path> [--base-url URL] [--fixture PATH]');
    return null;
  }
  if (!args.out) throw new Error('--out <absolute-json-path> is required');
  if (!path.isAbsolute(args.out)) throw new Error(`--out must be an absolute path, got "${args.out}"`);
  const fixturePath = args.fixture ? path.resolve(args.fixture) : path.resolve(__dirname, 'queries.json');
  const fixture = JSON.parse(fs.readFileSync(fixturePath, 'utf-8'));
  validateRealFixture(fixture);
  const fetchImpl = deps.fetchImpl || fetch;
  await verifyFixtureIds(fixture, { baseUrl: args.baseUrl, fetchImpl, timeoutMs: args.timeoutMs });
  const report = await runEvaluation({
    fixture,
    baseUrl: args.baseUrl,
    fetchImpl,
    timeoutMs: args.timeoutMs,
    sessionID: args.sessionID,
    fixturePath,
  });
  writeReport(args.out, report);
  console.log(formatSummary(report.summary));
  console.log(`report written: ${args.out}`);
  return report;
}

module.exports = {
  CATEGORIES,
  DEFAULT_BASE_URL,
  REQUIRED_PER_CATEGORY,
  REQUIRED_TOTAL,
  hitAtK,
  mrr,
  mean,
  percentile,
  parseRecallPointers,
  hasRelatedBody,
  validateFixture,
  validateRealFixture,
  verifyFixtureIds,
  summarize,
  runEntry,
  runEvaluation,
  formatSummary,
  writeReport,
  main,
};

if (require.main === module) {
  main().catch((err) => {
    console.error(err?.stack || err?.message || String(err));
    process.exit(1);
  });
}
