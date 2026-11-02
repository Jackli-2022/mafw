// gateway/src/core/goal/no-progress.ts
// Host-side anti-spin counter. A repeated artifact digest means the node is
// producing the same result again; after three repeats it must ask a person
// rather than consume another automatic attempt.

export function nextNoProgress(input: {
  previousDigest?: string;
  previousCount: number;
  digest: string | null;
}): { count: number; digest?: string; ask: boolean } {
  if (!input.digest) return { count: input.previousCount, digest: input.previousDigest, ask: false };
  if (!input.previousDigest) return { count: 0, digest: input.digest, ask: false };
  if (input.previousDigest === input.digest) {
    const count = input.previousCount + 1;
    return { count, digest: input.digest, ask: count >= 3 };
  }
  return { count: 0, digest: input.digest, ask: false };
}
