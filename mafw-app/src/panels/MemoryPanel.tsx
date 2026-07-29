import { createSignal } from 'solid-js'
import { useGateway } from '../gateway/provider'

export function MemoryPanel() {
  const gw = useGateway()
  const [collapsed, setCollapsed] = createSignal(false)
  const [query, setQuery] = createSignal('')
  const [results, setResults] = createSignal<any[]>([])
  const [searching, setSearching] = createSignal(false)

  async function handleSearch() {
    if (!query().trim() || !gw.ready()) return
    setSearching(true)
    try { setResults(await gw.client().searchMemory(query())) } catch {}
    setSearching(false)
  }

  return (
    <div class="px-3 py-2 border-b" style="border-color: var(--border-border-secondary)">
      <button onClick={() => setCollapsed(!collapsed())} class="w-full flex items-center justify-between text-xs font-semibold mb-1" style="color: var(--text-text-strong)">
        <span>MEMORY</span>
        <span>{collapsed() ? '▶' : '▼'}</span>
      </button>
      {!collapsed() && (
        <div class="space-y-1">
          <input value={query()} onInput={(e: any) => setQuery(e.currentTarget.value)} onKeyDown={(e: any) => e.key === 'Enter' && handleSearch()} placeholder="Search..." class="w-full h-6 px-2 text-xs rounded outline-1 outline-transparent focus:outline-[var(--accent-9)]" style="background: var(--v2-background-bg-base); color: var(--text-text-strong)" />
          {searching() && <div class="text-xs" style="color: var(--text-text-muted)">Searching...</div>}
          {results().slice(0, 5).map(r => (
            <div class="px-1 py-1 rounded text-xs hover:bg-white/5" style="color: var(--text-text-muted)">
              <div class="truncate">{r.primary_abstraction}</div>
              <div class="text-[10px]" style="color: var(--text-text-muted)">energy: {r.energy?.toFixed(2)}</div>
            </div>
          ))}
          {!searching() && query() && results().length === 0 && <div class="text-xs" style="color: var(--text-text-muted)">No results</div>}
        </div>
      )}
    </div>
  )
}
