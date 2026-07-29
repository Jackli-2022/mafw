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
