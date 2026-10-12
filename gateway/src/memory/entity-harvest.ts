// V2 ①c: unified MECHANICAL entity harvest (zero LLM). Merges the regex
// extraction formerly inlined in reflection.ts (camelCase / ALL_CAPS /
// quoted strings) with CJK run extraction, so the write path and the
// reflection prompt share one harvester. GLiNER augmentation
// (gliner-engine) is layered on asynchronously at the write path — this
// module stays dependency-free.

const PASCAL = /\b[A-Z][a-z]+(?:[A-Z][a-z]+)+\b/g;
const CAMEL = /\b[a-z]+(?:[A-Z][a-z]+)+\b/g;
const ALL_CAPS = /\b[A-Z]{2,}[0-9]*\b/g; // BM25, HTTP2, GLM, TDD…
const QUOTED = /['"]([^'"]+)['"]/g;
const CJK_RUN = /[\u4e00-\u9fff]{2,}/g;

export function extractEntities(text: string, opts?: { max?: number }): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  const push = (s: string) => {
    const t = s.trim();
    if (!t || seen.has(t)) return;
    seen.add(t);
    out.push(t);
  };
  for (const m of text.match(PASCAL) ?? []) push(m);
  for (const m of text.match(CAMEL) ?? []) push(m);
  for (const m of text.match(ALL_CAPS) ?? []) if (m.length >= 3) push(m);
  for (const m of text.match(QUOTED) ?? []) push(m.slice(1, -1).trim());
  for (const m of text.match(CJK_RUN) ?? []) push(m);
  return opts?.max ? out.slice(0, opts.max) : out;
}
