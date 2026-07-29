import { spawn, ChildProcess } from 'node:child_process'
import path from 'node:path'

let gatewayProcess: ChildProcess | null = null
let statusListeners: Array<(connected: boolean) => void> = []

function notify(connected: boolean) {
  for (const cb of statusListeners) cb(connected)
}

export function startGateway(gatewayDir: string, port: number): void {
  if (gatewayProcess) return

  const entry = path.join(gatewayDir, 'gateway', 'dist', 'gateway', 'src', 'index.js')
  gatewayProcess = spawn('node', [entry], {
    cwd: gatewayDir,
    stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, MAFW_SERVER_API_PORT: String(port) },
  })

  const origLog = console.log
  gatewayProcess.stdout?.on('data', (data: Buffer) => {
    origLog(`[gateway] ${data.toString().trim()}`)
  })

  gatewayProcess.stderr?.on('data', (data: Buffer) => {
    origLog(`[gateway:err] ${data.toString().trim()}`)
  })

  gatewayProcess.on('exit', (code) => {
    const origLog2 = console.log
    origLog2(`[sidecar] Gateway exited with code ${code}`)
    gatewayProcess = null
    notify(false)
  })

  notify(true)
}

export function stopGateway(): void {
  if (gatewayProcess) {
    gatewayProcess.kill('SIGTERM')
    gatewayProcess = null
    notify(false)
  }
}

export function getGatewayStatus(): boolean {
  return gatewayProcess !== null && gatewayProcess.exitCode === null
}

export function onGatewayStatus(callback: (connected: boolean) => void): () => void {
  statusListeners.push(callback)
  return () => {
    statusListeners = statusListeners.filter(cb => cb !== callback)
  }
}
