import { createSignal, createEffect } from 'solid-js'
import { useGateway } from '../gateway/provider'

export function ConfigPage() {
  const gw = useGateway()
  const [config, setConfig] = createSignal('')
  const [loading, setLoading] = createSignal(true)

  createEffect(() => {
    if (!gw.ready()) return
    gw.client().getConfig().then(data => { setConfig(JSON.stringify(data, null, 2)); setLoading(false) })
  })

  async function handleSave() {
    try {
      await gw.client().saveConfig(JSON.parse(config()))
    } catch { /* ignore */ }
  }

  return (
    <div>
      <h2 class="text-13 font-medium mb-5" style="color: var(--text-strong)">Configuration</h2>
      {loading() ? (
        <div class="text-13" style="color: var(--text-muted)">Loading...</div>
      ) : (
        <>
          <textarea
            value={config()}
            onInput={e => setConfig(e.currentTarget.value)}
            class="input-base w-full min-h-[60vh] p-3 text-13 font-mono leading-5 resize-none"
            spellcheck={false}
          />
          <div class="flex gap-2 mt-3">
            <button onClick={handleSave} class="btn btn-primary">Save</button>
            <button onClick={() => client.getConfig().then(d => setConfig(JSON.stringify(d, null, 2)))} class="btn btn-secondary">Reset</button>
          </div>
        </>
      )}
    </div>
  )
}
