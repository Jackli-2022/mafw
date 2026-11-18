/**
 * Word-level candidate support for boundary recall admission.
 *
 * Why this exists: the boundary FOK gate reads only the raw BM25 `top1/mean`
 * ratio, and BM25 indexes CJK as **unigrams** (`harmonic-index.tokenizeBM25`).
 * A true no-answer query can therefore produce a top-1 candidate that shares
 * only scattered single characters with it — a ratio-dominant but semantically
 * unsupported pool. Frozen 40-query evidence (2026-11-18, candidates checked
 * against title + cue anchors):
 *
 *   堪培拉十二月平均降雨量        7 pointers, 0 shared CJK bigrams, 0 content ASCII words
 *   缝纫机改牛仔裤腰围怎么走线     7 pointers, only the question frame 怎么
 *
 * Positive `inject` turns retained at least one shared word-level unit:
 * an ASCII word (`commit` / `push`, `sidecar` / `http`, `worker` / `transcript`),
 * an identifier echo (`NOTE_BOARD_BUDGET`, `5cd9885f5`), or a topical CJK
 * bigram (`提交`/`本地`, `缺口`, `健康`, `记忆`). That is the smallest unit this
 * guard accepts as "the candidate is lexically connected to the query"; it is a
 * property of the text, not a score threshold, and it never re-ranks.
 *
 * Deliberately NOT admitted as support:
 *   - a bare CJK unigram (the observed failure mode);
 *   - the question frame itself (`怎么` / `什么` / `如何` / `怎样` / `有没有` …);
 *   - common English function words (`the` / `of` / `is` / `how` …), so a pool
 *     that shares only stopwords is not evidence;
 *   - body text (`memory_value`): only metadata (title + cue anchors) counts.
 *
 * Comparison rules (mirroring the retrievers, so support means the same thing):
 *   - ASCII words use BM25's floor (length ≥ 2) and `splitIdentifierParts`
 *     (acronym runs like `HTTPServer → HTTP Server`, snake_case, and the same
 *     ≥2-char part rule — a 1-char camel part never becomes a unit);
 *   - CJK bigrams are built per contiguous CJK run and per field; a bigram is
 *     never assembled across a title/cue boundary or across a space-punctuated
 *     run boundary.
 *
 * Ordering contract: this guard may only act on a turn whose FOK gate actually
 * evaluated. Disabled / missing-scorer / throwing FOK keeps its fail-open
 * `inject` (the route never calls this guard for those turns). It runs *before*
 * exact-evidence admission, so a deterministic exact match (verbatim title /
 * identifier cue / distinctive cue) still rescues the turn. `low-confidence`
 * and `no-memory` turns are never touched.
 */
import { splitIdentifierParts } from '../core/memory/harmonic-index';

export interface LexicalSupportCandidate {
  primary_abstraction?: string;
  cue_anchors?: string[];
  /** Present on `RecallMemory`, deliberately NOT read: the gate is metadata-only. */
  memory_value?: string;
}

/** Candidates that are lexically connected to the query, plus applicability. */
export interface LexicalSupportSelection<T> {
  supported: T[];
  /**
   * False when the query itself has no word-level unit (single CJK character,
   * punctuation, or only stopwords): the gate must not judge anything, so every
   * candidate is kept.
   */
  applicable: boolean;
}

/**
 * CJK bigrams that belong to the question frame rather than the topic. A query
 * and a memory can share one of these while talking about nothing in common.
 *
 * BOUNDED LIST, not a claim about every Chinese question: it enumerates the
 * interrogative / modal / pronoun frames observed in boundary queries. Extend
 * only with grammatical (not topical) bigrams; a topical bigram here would
 * silently remove real evidence.
 */
const QUESTION_FRAME_CJK_BIGRAMS = new Set([
  // 怎么 / 怎样 / 为什么
  '怎么', '么样', '怎样', '什么', '为什', '为何',
  // wh / quantity
  '如何', '多少', '多久', '哪些', '哪个', '哪里', '在哪',
  // polar questions + modals
  '是否', '是不', '不是', '有没', '没有', '能不', '不能', '会不', '不会',
  '可以', '应该', '需不', '不需', '需要',
  // pronoun / demonstrative / informal frame
  '我们', '你们', '他们', '这个', '那个', '这些', '那些', '一下', '干嘛',
]);

/**
 * Common English function words. They are tokenized by BM25 like any other
 * word, so two unrelated English texts always share several of them; matching
 * one is not lexical evidence. Content words and identifiers are unaffected
 * (identifier parts such as `enabled` survive even when `is` does not).
 */
const ENGLISH_STOPWORDS = new Set([
  'a', 'an', 'and', 'are', 'as', 'at', 'be', 'been', 'but', 'by',
  'can', 'could', 'did', 'do', 'does', 'for', 'from', 'had', 'has', 'have',
  'he', 'her', 'here', 'him', 'his', 'how', 'i', 'if', 'in', 'into',
  'is', 'it', 'its', 'me', 'my', 'no', 'not', 'of', 'on', 'or',
  'our', 'she', 'should', 'so', 'than', 'that', 'the', 'their', 'them', 'then',
  'there', 'these', 'they', 'this', 'those', 'to', 'was', 'we', 'were', 'what',
  'when', 'where', 'which', 'who', 'why', 'will', 'with', 'would', 'yes', 'you',
  'your',
]);

const CJK_RUN_RE = /[\u4e00-\u9fff]+/g;
const ASCII_RUN_RE = /[a-z0-9]+/g;
/** Same floor as the BM25 tokenizer: single ASCII characters carry no meaning. */
const MIN_ASCII_TOKEN_LENGTH = 2;

function normalizeText(value: unknown): string {
  return String(value ?? '').normalize('NFKC');
}

/** A support-bearing ASCII token: BM25-length floor plus stopword exclusion. */
function isSupportToken(token: string): boolean {
  return token.length >= MIN_ASCII_TOKEN_LENGTH && !ENGLISH_STOPWORDS.has(token);
}

/**
 * BM25-compatible ASCII token set: literal lowercased words plus
 * `splitIdentifierParts` (the same helper the retriever uses), with stopwords
 * dropped from both the literal and the split forms.
 */
function asciiTokenSet(text: string): Set<string> {
  const out = new Set<string>();
  const raw = normalizeText(text);
  for (const token of raw.toLowerCase().match(ASCII_RUN_RE) ?? []) {
    if (isSupportToken(token)) out.add(token);
  }
  for (const word of raw.split(/[^A-Za-z0-9_]+/)) {
    if (word.length < 3) continue;
    for (const part of splitIdentifierParts(word)) {
      if (isSupportToken(part)) out.add(part);
    }
  }
  return out;
}

/** Contiguous CJK runs of a single field (never joined with another field). */
function cjkRuns(text: string): string[] {
  return normalizeText(text).match(CJK_RUN_RE) ?? [];
}

function queryUnits(query: string): { latin: Set<string>; bigrams: Set<string> } {
  const latin = asciiTokenSet(query);
  const bigrams = new Set<string>();
  for (const run of cjkRuns(query)) {
    for (let i = 0; i + 2 <= run.length; i++) {
      const bigram = run.slice(i, i + 2);
      if (!QUESTION_FRAME_CJK_BIGRAMS.has(bigram)) bigrams.add(bigram);
    }
  }
  return { latin, bigrams };
}

function fieldSupports(field: string, units: { latin: Set<string>; bigrams: Set<string> }): boolean {
  if (!field) return false;
  if (units.latin.size > 0) {
    for (const token of asciiTokenSet(field)) {
      if (units.latin.has(token)) return true;
    }
  }
  if (units.bigrams.size > 0) {
    for (const run of cjkRuns(field)) {
      for (const bigram of units.bigrams) {
        if (run.includes(bigram)) return true;
      }
    }
  }
  return false;
}

/**
 * A candidate is supported when its title or ANY single cue anchor shares a
 * word-level unit with the query. Fields are evaluated independently.
 */
function candidateSupports(
  candidate: LexicalSupportCandidate | null | undefined,
  units: { latin: Set<string>; bigrams: Set<string> },
): boolean {
  if (!candidate) return false;
  if (fieldSupports(candidate.primary_abstraction ?? '', units)) return true;
  const cues = Array.isArray(candidate.cue_anchors) ? candidate.cue_anchors : [];
  for (const cue of cues) {
    if (typeof cue === 'string' && fieldSupports(cue, units)) return true;
  }
  return false;
}

/**
 * Split a candidate list into lexically supported candidates, preserving order.
 * `applicable=false` means the query has no word-level unit at all and the gate
 * must not filter (fail-open); every candidate is returned.
 */
export function selectLexicallySupportedCandidates<T extends LexicalSupportCandidate>(
  candidates: readonly (T | null | undefined)[] | null | undefined,
  query: string,
): LexicalSupportSelection<T> {
  const list = (Array.isArray(candidates) ? candidates : []).filter(
    (candidate): candidate is T => Boolean(candidate),
  );
  const units = queryUnits(query);
  if (units.latin.size === 0 && units.bigrams.size === 0) {
    return { supported: list, applicable: false };
  }
  return {
    supported: list.filter(candidate => candidateSupports(candidate, units)),
    applicable: true,
  };
}

/**
 * True when at least one candidate's metadata shares a word-level unit with the
 * query. Fails open (returns true, i.e. "do not suppress") when the query has
 * no word-level unit at all; returns false for an empty candidate pool that
 * would otherwise be judged.
 */
export function hasCandidateLexicalSupport(
  candidates: readonly (LexicalSupportCandidate | null | undefined)[] | null | undefined,
  query: string,
): boolean {
  const selection = selectLexicallySupportedCandidates(candidates, query);
  return selection.supported.length > 0;
}
