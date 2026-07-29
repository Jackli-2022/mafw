import { createContext, useContext, createSignal, createEffect, onCleanup, type ParentProps } from 'solid-js'
import { GatewayClient } from './client'

interface GatewayContextValue {
  ready: () => boolean
  connected: () => boolean
  client: () => GatewayClient
}

const GatewayContext = createContext<GatewayContextValue>()

export function GatewayProvider(props: ParentProps) {
  const [connected, setConnected] = createSignal(false)
  const [client] = createSignal(
    new GatewayClient({ baseUrl: 'http://localhost:3000' })
  )

  createEffect(() => {
    const timer = setInterval(async () => {
      try {
        await client().project.current()
        setConnected(true)
      } catch {
        setConnected(false)
      }
    }, 5000)
    onCleanup(() => clearInterval(timer))
  })

  return (
    <GatewayContext.Provider
      value={{
        ready: () => true,
        connected,
        client: () => client(),
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
