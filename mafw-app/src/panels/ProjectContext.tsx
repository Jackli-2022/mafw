import { createSignal } from 'solid-js'
import { useGateway } from '../gateway/provider'

export function ProjectContext() {
  const gw = useGateway()
  const [open, setOpen] = createSignal(false)
  const [projects, setProjects] = createSignal<any[]>([])
  const [current, setCurrent] = createSignal<any>(null)

  if (gw.ready()) {
    gw.client().project.list().then(setProjects).catch(() => {})
    gw.client().project.current().then(setCurrent).catch(() => {})
  }

  return (
    <div class="px-3 py-3 border-b" style="border-color: var(--border-border-secondary)">
      <div class="flex items-center justify-between mb-2">
        <div class="flex items-center gap-1.5 text-xs font-semibold" style="color: var(--text-text-strong)">
          <span>MAFW</span>
          <span class="w-[6px] h-[6px] rounded-full inline-block" classList={{ 'bg-[#2bc94a]': gw.connected(), 'bg-[#e8636b]': !gw.connected() }} />
        </div>
      </div>
      <div class="relative">
        <button onClick={() => setOpen(!open())} class="w-full flex items-center gap-1.5 px-2 h-7 text-sm rounded-md hover:bg-white/10 transition-colors text-left" style="color: var(--text-text-muted)">
          <span class="truncate flex-1">{current()?.worktree || 'No project'}</span>
          <span class="text-xs">{open() ? '▲' : '▼'}</span>
        </button>
        {open() && (
          <div class="absolute top-full left-0 right-0 mt-1 z-10 rounded-md shadow-lg border py-1" style="background: var(--v2-background-bg-elevated); border-color: var(--border-border-secondary)">
            {projects().map(p => (
              <button onClick={() => { gw.client().project.setCurrent(p.worktree); setOpen(false); setCurrent(p) }} class="w-full px-2.5 py-1.5 text-sm text-left hover:bg-white/10 transition-colors" style="color: var(--text-text-muted)}">
                {p.worktree}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
