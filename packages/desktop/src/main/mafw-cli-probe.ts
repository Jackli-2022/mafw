import { execFile } from "node:child_process"

export type CliProbe = { available: true; version: string } | { available: false; reason: string }

export type CliVersionRunner = (cmd: string, args: string[]) => Promise<string>

const PROBE_TIMEOUT_MS = 5000

export function defaultCliVersionRunner(): CliVersionRunner {
  return (cmd, args) =>
    new Promise((resolve, reject) => {
      // shell:true resolves .cmd/.ps1 shims on Windows PATH; windowsHide is
      // mandatory for spawns from the detached desktop main process.
      execFile(cmd, args, { shell: true, windowsHide: true, timeout: PROBE_TIMEOUT_MS }, (err, stdout) => {
        if (err) reject(err)
        else resolve(String(stdout))
      })
    })
}

export function parseMafwVersion(output: string): string | null {
  const match = output.match(/v?(\d+\.\d+\.\d+(?:[-.][0-9A-Za-z.-]+)?)/)
  return match ? match[1] : null
}

export async function probeMafwCli(run: CliVersionRunner = defaultCliVersionRunner()): Promise<CliProbe> {
  try {
    const stdout = await run("mafw", ["version"])
    const version = parseMafwVersion(stdout)
    if (!version) {
      return { available: false, reason: `unparseable 'mafw version' output: ${stdout.trim().slice(0, 80)}` }
    }
    return { available: true, version }
  } catch (err) {
    return { available: false, reason: err instanceof Error ? err.message : String(err) }
  }
}
