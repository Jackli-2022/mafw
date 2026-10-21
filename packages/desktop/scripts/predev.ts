import { execFileSync } from "node:child_process"

execFileSync(
  process.execPath,
  ["--import", "tsx", "./scripts/copy-icons.ts", process.env.OPENCODE_CHANNEL ?? "dev"],
  { stdio: "inherit" },
)
