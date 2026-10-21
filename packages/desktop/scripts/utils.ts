import { execFileSync, execSync } from "node:child_process"

export type Channel = "dev" | "beta" | "prod"

export function resolveChannel(): Channel {
  const raw = process.env.OPENCODE_CHANNEL
  if (raw === "dev" || raw === "beta" || raw === "prod") return raw
  return "dev"
}

/** Run a CLI with inherited stdio. Windows: single command string through cmd.exe
 *  (npm/npx are .cmd shims; avoids DEP0190 from args+shell:true). */
export function run(cmd: string, args: string[], opts: { cwd?: string } = {}): void {
  if (process.platform === "win32") {
    const quoted = [cmd, ...args].map((a) => (/\s/.test(a) ? `"${a}"` : a)).join(" ")
    execSync(quoted, { ...opts, stdio: "inherit" })
  } else {
    execFileSync(cmd, args, { ...opts, stdio: "inherit" })
  }
}
