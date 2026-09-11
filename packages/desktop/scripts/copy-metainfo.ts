import { resolveChannel } from "./utils"

const arg = process.argv[2]
const channel = arg === "dev" || arg === "beta" || arg === "prod" ? arg : resolveChannel()

const appId = channel === "prod" ? "ai.mafw.desktop" : `ai.mafw.desktop.${channel}`
const productName = channel === "prod" ? "MAFW" : `MAFW ${channel.charAt(0).toUpperCase() + channel.slice(1)}`
const summary = `MAFW desktop app${channel !== "prod" ? ` (${channel})` : ""}`

const xml = `<?xml version="1.0" encoding="UTF-8"?>
<component type="desktop-application">
  <id>${appId}</id>

  <metadata_license>CC0-1.0</metadata_license>
  <project_license>MIT</project_license>

  <name>${productName}</name>
  <summary>${summary}</summary>

  <developer id="Jackli-2022">
    <name>Jackli-2022</name>
  </developer>

  <description>
    <p>
      MAFW is a local agent workspace: harmonic memory, goal orchestration and a desktop shell for your coding agents.
    </p>
  </description>

  <launchable type="desktop-id">${appId}.desktop</launchable>

  <content_rating type="oars-1.1" />

  <url type="bugtracker">https://github.com/Jackli-2022/mafw/issues</url>
  <url type="homepage">https://github.com/Jackli-2022/mafw</url>
  <url type="vcs-browser">https://github.com/Jackli-2022/mafw</url>
</component>
`

await Bun.write(`resources/${appId}.metainfo.xml`, xml)
console.log(`Generated metainfo for ${channel} at resources/${appId}.metainfo.xml`)
