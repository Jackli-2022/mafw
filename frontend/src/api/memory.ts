export async function searchMemory(query: string, goalId?: string): Promise<any> {
  const params = new URLSearchParams({ q: query });
  if (goalId) params.set('goalId', goalId);
  const res = await fetch(`/api/memory/search?${params}`);
  if (!res.ok) return null;
  return res.json();
}
