export function matchesSignature(prevFeedback: string, currentFeedback: string): boolean {
  const normalize = (s: string) =>
    s.toLowerCase().trim().replace(/[\s\p{P}]+/gu, ' ').replace(/^\s+|\s+$/g, '');
  return normalize(prevFeedback) === normalize(currentFeedback);
}
