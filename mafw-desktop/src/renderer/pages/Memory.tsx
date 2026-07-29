import { createSignal } from 'solid-js'
import { useGateway } from '../gateway/provider'

export function MemoryPage() {
  const gw = useGateway()
  const [query, setQuery] = createSignal('')
  const [results, setResults] = createSignal<any[]>([])
  const [searching, setSearching] = createSignal(false)

  async function handleSearch() {
    if (!query().trim() || !gw.ready()) return
    setSearching(true)
    const items = await gw.client().searchMemory(query())
    setResults(items)
    setSearching(false)
  }

  return (
    <div>
      <h2 class="text-13 font-medium mb-5" style="color: var(--text-strong)">Memory</h2>
      <div class="flex gap-2 mb-5">
        <input
          type="text"
          value={query()}
          onInput={e => setQuery(e.currentTarget.value)}
          onKeyDown={e => e.key === 'Enter' && handleSearch()}
          placeholder="Search memories..."
          class="input-base flex-1 h-7 px-2.5 text-13"
        />
        <button onClick={handleSearch} disabled={searching()} class="btn btn-primary">
          {searching() ? 'Searching...' : 'Search'}
        </button>
      </div>
      <div class="space-y-1.5">
        {results().map(unit => (
          <div class="memory-card">
            <div class="flex items-center justify-between mb-1.5">
              <div class="text-13 font-medium truncate mr-3" style="color: var(--text-strong)">{unit.primary_abstraction}</div>
              <div class="flex items-center gap-2 shrink-0">
                <span class="badge" style={{
                  background: unit.type === 'semantic' ? 'var(--accent-bg)' : unit.type === 'episodic' ? 'var(--success-bg)' : 'rgba(168,85,247,0.15)',
                  border: '0.5px solid rgba(255,255,255,0.08)',
                  color: unit.type === 'semantic' ? 'var(--accent)' : unit.type === 'episodic' ? 'var(--success)' : '#a855f7',
                }}>{unit.type}</span>
                <span class="text-11" style="color: var(--text-muted)">{unit.energy}</span>
              </div>
            </div>
            <div class="text-13 leading-5 line-clamp-2" style="color: var(--text-muted)">{unit.memory_value}</div>
          </div>
        ))}
        {results().length === 0 && query() && !searching() && (
          <div class="text-13" style="color: var(--text-muted)">No memories found</div>
        )}
      </div>
    </div>
  )
}
