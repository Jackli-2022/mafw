import path from "node:path"
import { fileURLToPath } from "node:url"

import type { Configuration } from "electron-builder"

const packageDir = path.dirname(fileURLToPath(import.meta.url))
const channel = (() => {
  const raw = process.env.OPENCODE_CHANNEL
  if (raw === "dev" || raw === "beta" || raw === "prod") return raw
  return "dev"
})()

const APP_IDS = {
  dev: "ai.mafw.desktop.dev",
  beta: "ai.mafw.desktop.beta",
  prod: "ai.mafw.desktop",
} as const

const getBase = (appId: string): Configuration => ({
  artifactName: "mafw-desktop-${os}-${arch}.${ext}",
  directories: {
    output: "dist",
    buildResources: "resources",
  },
  // Linux launchers are .desktop files, so this is the desktop file name,
  // not just the app id. For prod, app id "ai.mafw.desktop" becomes
  // "ai.mafw.desktop.desktop".
  // https://developer.gnome.org/documentation/guidelines/maintainer/integrating.html
  // https://www.electron.build/docs/linux/
  extraMetadata: {
    desktopName: `${appId}.desktop`,
  },
  files: ["out/**/*", "resources/**/*"],
  // Silero VAD assets (onnx model + onnxruntime wasm) are binary fetch targets
  // for the renderer — they cannot live inside asar (fetch can't resolve the
  // virtual path), so unpack them next to the app.
  asarUnpack: ["**/*.onnx", "**/*.wasm"],
  extraResources: [
    {
      from: "native/",
      to: "native/",
      filter: ["index.js", "index.d.ts", "build/Release/mac_window.node", "swift-build/**"],
    },
    // Self-sufficient gateway (mode A): staged by scripts/stage-gateway.ts —
    // dist + production node_modules, with native modules rebuilt for the
    // Electron runtime. Spawned via ELECTRON_RUN_AS_NODE when no gateway is
    // already running (see src/main/mafw-sidecar.ts).
    {
      from: "gateway-bundle/",
      to: "gateway/",
    },
    // electron-builder's copy filter hard-excludes a root-level `node_modules`
    // directory (app-builder-lib util/filter.js), so copy it as its own entry —
    // then `node_modules` never appears as the relative path of a copy root.
    {
      from: "gateway-bundle/node_modules/",
      to: "gateway/node_modules/",
    },
  ],
  mac: {
    category: "public.app-category.developer-tools",
    icon: `resources/icons/icon.icns`,
    hardenedRuntime: true,
    gatekeeperAssess: false,
    entitlements: "resources/entitlements.plist",
    entitlementsInherit: "resources/entitlements.plist",
    notarize: true,
    target: ["dmg", "zip"],
  },
  dmg: {
    sign: true,
  },
  protocols: {
    name: "MAFW",
    schemes: ["mafw"],
  },
  win: {
    icon: `resources/icons/icon.ico`,
    target: ["nsis"],
    verifyUpdateCodeSignature: false,
  },
  nsis: {
    oneClick: true,
    perMachine: false,
    installerIcon: `resources/icons/icon.ico`,
    installerHeaderIcon: `resources/icons/icon.ico`,
  },
  linux: {
    icon: `resources/icons`,
    category: "Development",
    executableName: appId,
    desktop: {
      entry: {
        // Match the installed .desktop file and hicolor icon basename so
        // Linux shells can associate the running Electron window with its launcher.
        StartupWMClass: appId,
      },
    },
    target: ["AppImage", "deb", "rpm"],
  },
})

function getConfig() {
  const appId = APP_IDS[channel]
  const base = getBase(appId)

  switch (channel) {
    case "dev": {
      return {
        ...base,
        appId,
        productName: "MAFW Dev",
        rpm: { packageName: "mafw-dev" },
      }
    }
    case "beta": {
      return {
        ...base,
        appId,
        productName: "MAFW Beta",
        protocols: { name: "MAFW Beta", schemes: ["mafw"] },
        publish: { provider: "github", owner: "Jackli-2022", repo: "mafw", channel: "beta" },
        rpm: { packageName: "mafw-beta" },
      }
    }
    case "prod": {
      return {
        ...base,
        appId,
        productName: "MAFW",
        protocols: { name: "MAFW", schemes: ["mafw"] },
        publish: { provider: "github", owner: "Jackli-2022", repo: "mafw", channel: "latest" },
        rpm: { packageName: "mafw" },
      }
    }
  }
}

export default getConfig()
