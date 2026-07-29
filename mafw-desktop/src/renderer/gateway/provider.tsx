import { createContext, useContext, createSignal, createEffect, onCleanup, type ParentProps } from 'solid-js'
import { MafwClient } from './client'

interface GatewayContextValue {
  ready: () => boolean
  connected: () => boolean
  client: () => MafwClient
}

const GatewayContext = createContext<GatewayContextValue>()

export function GatewayProvider(props: ParentProps) {
  const [connected, setConnected] = createSignal(false)
  const [client, setClient] = createSignal<MafwClient | null>(null)

  // Resolve gateway URL from preload
  createEffect(() => {
    window.mafwAPI.getPort().then(port => {
      setClient(new MafwClient(`http://localhost:${port}`))
    })
  })

  // Listen for health push from main process
  createEffect(() => {
    const unsub = window.mafwAPI.onHealth(ok => setConnected(ok))
    window.mafwAPI.healthCheck().then(setConnected)
    onCleanup(unsub)
  })

  return (
    <GatewayContext.Provider
      value={{
        ready: () => client() !== null,
        connected,
        client: () => client()!,
      }}
    >
      {props.children}
    </GatewayContext.Provider>
  )
}

export function useGateway() {
  const ctx = useContext(GatewayContext)
  if (!ctx) throw new Error('useGateway() must be used within GatewayProvider')
  return ctx
}
