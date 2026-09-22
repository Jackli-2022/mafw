export function tokenize(text: string): string[] {
  const tokens: string[] = [];
  let i = 0;
  while (i < text.length) {
    if (/[\u4e00-\u9fff]/.test(text[i])) {
      if (i + 1 < text.length && /[\u4e00-\u9fff]/.test(text[i + 1])) {
        tokens.push(text[i] + text[i + 1]);
      } else {
        tokens.push(text[i]);
      }
      i++;
    } else if (/[a-zA-Z0-9]/.test(text[i])) {
      let word = '';
      while (i < text.length && /[a-zA-Z0-9]/.test(text[i])) {
        word += text[i];
        i++;
      }
      if (word.length > 0) tokens.push(word.toLowerCase());
      if (word.length > 1) {
        for (let j = 0; j < word.length - 1; j++) {
          tokens.push(word.slice(j, j + 2).toLowerCase());
        }
      }
    } else {
      i++;
    }
  }
  return [...new Set(tokens)];
}

/** ASCII stopwords dropped from auto-extracted anchors. */
const ASCII_STOP = new Set(['with', 'this', 'that', 'from', 'have', 'must', 'should', 'when', 'into', 'will', 'also', 'they', 'them', 'then', 'than', 'which', 'their', 'there']);

/**
 * CJK function characters. A bigram containing any of these is a
 * grammatical fragment, not an entity/aspect term.
 */
const CJK_STOP_CHARS = new Set(
  '的了是在和与及或不没而也就都还把被让使对为以于从到等这那其之则并但因所要能会可需应用个我们你他她它上下前后里外时'.split(''),
);

/**
 * Extract up to 5 cue anchors from a primary abstraction when the writer
 * supplied none.
 *
 * ASCII: most frequent words (len >= 4). CJK: adjacent bigrams (same
 * convention as tokenize()) — single CJK chars are useless as multi-hop
 * anchors because they link every memory that happens to share the character.
 */
export function extractAnchors(abstraction: string): string[] {
  if (!abstraction) return [];
  const anchors: string[] = [];

  const freq = new Map<string, number>();
  for (const w of abstraction.toLowerCase().split(/[^a-z0-9]+/)) {
    if (w.length >= 4) freq.set(w, (freq.get(w) || 0) + 1);
  }
  for (const [w] of [...freq.entries()].sort((a, b) => b[1] - a[1])) {
    if (anchors.length >= 5) break;
    if (!ASCII_STOP.has(w) && !anchors.includes(w)) anchors.push(w);
  }

  const bigrams: string[] = [];
  for (const run of abstraction.match(/[\u4e00-\u9fff]+/g) || []) {
    for (let i = 0; i < run.length - 1; i++) {
      const bg = run.slice(i, i + 2);
      if (CJK_STOP_CHARS.has(bg[0]) || CJK_STOP_CHARS.has(bg[1])) continue;
      if (!bigrams.includes(bg)) bigrams.push(bg);
    }
  }
  for (const bg of bigrams) {
    if (anchors.length >= 5) break;
    if (!anchors.includes(bg)) anchors.push(bg);
  }

  return anchors.slice(0, 5);
}

export function extractDerivedTerms(text: string, topK = 3): string[] {
  const terms: string[] = [];
  const linkRegex = /\[\[([^\]]+)\]\]/g;
  let match: RegExpExecArray | null;
  while ((match = linkRegex.exec(text)) !== null) {
    terms.push(match[1]);
  }
  const entityRegex = /[A-Z][a-z]+[A-Z][a-z]+|[A-Z]{2,}[a-z]+[A-Z]|[a-z]+_[a-z]+/g;
  while ((match = entityRegex.exec(text)) !== null) {
    terms.push(match[0]);
  }
  return [...new Set(terms)].slice(0, topK);
}
