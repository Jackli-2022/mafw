import { execFileSync } from "node:child_process"

import { resolveChannel } from "./utils"

const channel = resolveChannel()
const run = (script: string, arg: string) =>
  execFileSync(process.execPath, ["--import", "tsx", script, arg], { stdio: "inherit" })

run("./scripts/copy-icons.ts", channel)
run("./scripts/copy-metainfo.ts", channel)
