import { test } from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8")
const component = read("../src/renderer/mafw/components/UpdaterBanner.tsx")
const shell = read("../src/renderer/mafw/MafwShell.tsx")
const updater = read("../src/main/updater.ts")

test("the shell mounts one non-modal updater banner", () => {
  assert.match(shell, /import \{ UpdaterBanner \} from "\.\/components\/UpdaterBanner"/)
  assert.match(shell, /<UpdaterBanner\s*\/>/)
  assert.match(component, /role="status"/)
  assert.match(component, /aria-live="polite"/)
  assert.match(component, /mafw-updater-banner/)
})

test("the banner subscribes to the updater and installs through preload", () => {
  assert.match(component, /window\.api\.updater\.subscribe/)
  assert.match(component, /window\.api\.updater\.install\(\)/)
  assert.match(component, /updaterBannerModel/)
  assert.match(component, /showToastV2/)
  assert.match(component, /重启以更新/)
  assert.doesNotMatch(component, /<button/)
})

test("updater config follows the build channel and forbids downgrade", () => {
  assert.match(updater, /UPDATE_SUPPORT/)
  assert.match(updater, /autoUpdater\.allowDowngrade = false/)
  assert.match(updater, /autoUpdater\.allowPrerelease = false/)
  assert.match(updater, /autoUpdater\.autoDownload = false/)
  assert.match(updater, /autoUpdater\.autoInstallOnAppQuit = false/)
})
