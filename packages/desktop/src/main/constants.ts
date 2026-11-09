import { app } from "electron"
import { resolveUpdateSupport } from "./updater-policy"

type Channel = "dev" | "beta" | "prod"
const raw = import.meta.env.OPENCODE_CHANNEL
export const CHANNEL: Channel = raw === "dev" || raw === "beta" || raw === "prod" ? raw : "dev"

export const UPDATE_SUPPORT = resolveUpdateSupport({
  packaged: app.isPackaged,
  channel: CHANNEL,
  platform: process.platform,
  appImagePath: process.env.APPIMAGE ?? null,
})

/** @deprecated Use UPDATE_SUPPORT.enabled. Kept for the native menu binding. */
export const UPDATER_ENABLED = UPDATE_SUPPORT.enabled
