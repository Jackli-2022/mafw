import { TitlebarTabStrip } from './titlebar-tab-strip'

export function Titlebar() {
  return (
    <header
      class="flex items-center h-9 shrink-0 border-b select-none"
      style={{
        background: 'var(--v2-background-bg-base)',
        borderColor: 'var(--border-border-secondary)',
        WebkitAppRegion: 'drag',
      }}
    >
      <div class="flex items-center gap-2 px-3 min-w-0" style={{ WebkitAppRegion: 'no-drag' }}>
        <span class="text-xs font-semibold" style="color: var(--text-text-strong)">MAFW</span>
      </div>
      <div class="flex-1 min-w-0" style={{ WebkitAppRegion: 'no-drag' }}>
        <TitlebarTabStrip />
      </div>
    </header>
  )
}
