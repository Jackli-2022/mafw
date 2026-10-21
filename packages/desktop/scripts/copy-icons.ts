import { cpSync, rmSync } from "node:fs"
import { resolveChannel } from "./utils"

const arg = process.argv[2]
const channel = arg === "dev" || arg === "beta" || arg === "prod" ? arg : resolveChannel()

const src = `./icons/${channel}`
const dest = "resources/icons"

rmSync(dest, { recursive: true, force: true })
cpSync(src, dest, { recursive: true })
console.log(`Copied ${channel} icons from ${src} to ${dest}`)
