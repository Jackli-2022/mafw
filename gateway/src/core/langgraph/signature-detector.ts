export function matchesSignature(prevFeedback: string, currentFeedback: string): boolean {
  const normalize = (s: string) =>
    s.toLowerCase().trim().replace(/[\s\p{P}]+/gu, ' ').replace(/^\s+|\s+$/g, '');
  
  const a = normalize(prevFeedback);
  const b = normalize(currentFeedback);
  
  // Exact match after normalization
  if (a === b) return true;
  
  // Check if one contains the other (handles minor phrasing differences)
  if (a.includes(b) || b.includes(a)) return true;
  
  // Jaccard similarity on words (handles reordering and minor additions)
  const wordsA = new Set(a.split(/\s+/));
  const wordsB = new Set(b.split(/\s+/));
  const intersection = new Set([...wordsA].filter(w => wordsB.has(w)));
  const union = new Set([...wordsA, ...wordsB]);
  if (union.size === 0) return false;
  const jaccard = intersection.size / union.size;
  
  return jaccard >= 0.7; // 70% word overlap threshold
}
