export function createQuitCoordinator(input: {
  stopGateway(): Promise<void>
  getUpdateReady(): boolean
  installUpdate(): Promise<void>
  quit(): void
  onError?(error: unknown): void
}): {
  requestQuit(): Promise<void>
  isQuitting(): boolean
} {
  let quitting = false
  let pending: Promise<void> | null = null

  const run = async (): Promise<void> => {
    try {
      if (input.getUpdateReady()) {
        // The updater controller already owns stop-then-quitAndInstall. Calling
        // it here keeps the managed child stopped before the installer runs.
        await input.installUpdate()
      } else {
        await input.stopGateway()
        input.quit()
      }
      quitting = true
    } catch (error) {
      input.onError?.(error)
    }
  }

  return {
    requestQuit() {
      if (quitting) return Promise.resolve()
      if (pending) return pending
      pending = run().finally(() => {
        pending = null
      })
      return pending
    },
    isQuitting: () => quitting,
  }
}
