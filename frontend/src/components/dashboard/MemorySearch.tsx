import { useState } from 'react';
import { searchMemory } from '../../api/memory';
import { useGoalStore } from '../../stores/goalStore';

export function MemorySearch() {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<any[] | null>(null);
  const [loading, setLoading] = useState(false);
  const currentGoalId = useGoalStore((s) => s.currentGoalId);

  const handleSearch = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!query.trim()) return;
    setLoading(true);
    const data = await searchMemory(query, currentGoalId || undefined);
    setResults(data?.entries || []);
    setLoading(false);
  };

  return (
    <div className="bg-gray-900/50 border border-gray-800 rounded-xl p-4">
      <h3 className="text-sm font-semibold text-gray-300 mb-3">Memory Search</h3>
      <form onSubmit={handleSearch} className="flex gap-2 mb-3">
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="搜索记忆..."
          className="flex-1 bg-gray-800 border border-gray-700 rounded-lg px-3 py-1.5 text-sm text-gray-200 placeholder-gray-500 focus:outline-none"
        />
        <button type="submit" disabled={loading} className="px-4 py-1.5 bg-blue-500/20 text-blue-400 rounded-lg text-sm">
          {loading ? '...' : '搜索'}
        </button>
      </form>
      {results && results.length === 0 && <div className="text-sm text-gray-500">无结果</div>}
      {results?.map((r: any, i: number) => (
        <div key={i} className="text-xs text-gray-400 py-1.5 border-b border-gray-800 last:border-0">
          <span className="text-gray-500">{r.tier}</span> {r.memory_value?.slice(0, 100) || r.primary_abstraction?.slice(0, 100)}
        </div>
      ))}
    </div>
  );
}
