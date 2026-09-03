import { ipcRenderer } from "electron"
import type { MafwAPI } from "./mafw-types"

function invoke<T = unknown>(namespace: string, method: string, ...args: unknown[]): Promise<T> {
  return ipcRenderer.invoke("mafw-invoke", namespace, method, ...args) as Promise<T>
}

export function createMafwApi(): MafwAPI {
  // Clean up orphaned listeners from previous preload executions.
  // ipcRenderer listeners survive page reloads (win.reload(), Vite full-reload)
  // but the old stateCallbacks/stateRelay are garbage-collected without cleanup.
  ipcRenderer.removeAllListeners("mafw-gateway-state")

  // Gateway state is multiplexed over ONE ipc listener: renderer components
  // (MafwShell/Rail/Config + HMR remounts) subscribe freely without piling
  // ipcRenderer listeners up against the default 10-listener warning limit.
  const stateCallbacks = new Set<(status: any) => void>()
  let stateChannelActive = false
  const stateRelay = (_event: any, status: any) => {
    for (const cb of stateCallbacks) cb(status)
  }

  return {
    gateway: {
      info: () => ipcRenderer.invoke("mafw-gateway-info"),
      start: () => ipcRenderer.invoke("mafw-gateway-start"),
      restart: () => ipcRenderer.invoke("mafw-gateway-restart"),
      logsPath: () => ipcRenderer.invoke("mafw-gateway-logs-path"),
      onStateChange: (cb) => {
        stateCallbacks.add(cb)
        if (!stateChannelActive) {
          ipcRenderer.on("mafw-gateway-state", stateRelay)
          stateChannelActive = true
        }
        return () => {
          stateCallbacks.delete(cb)
          if (stateCallbacks.size === 0 && stateChannelActive) {
            ipcRenderer.removeListener("mafw-gateway-state", stateRelay)
            stateChannelActive = false
          }
        }
      },
    },

    sessions: {
      list: (projectID?) => invoke("session", "list", projectID ? { query: { projectID } } : {}),
      create: (opts?) => invoke("session", "create", opts || {}),
      get: (id) => invoke("session", "get", { path: { id } }),
      messages: (sessionID, limit?, before?) => invoke("session", "messages", { path: { id: sessionID }, query: { limit, before } }),
      todo: (sessionID) => invoke("session", "todo", { path: { id: sessionID } }),
      children: (sessionID) => invoke("session", "children", { path: { id: sessionID } }),
      abort: (sessionID) => invoke("session", "abort", { path: { id: sessionID } }),
      delete: (id) => invoke("session", "delete", { path: { id } }),
      rename: (id, title) => invoke("session", "rename", { path: { id }, body: { title } }),
      trajectory: (sessionID, query?) => invoke("session", "trajectory", { path: { id: sessionID }, query: query || {} }),
      tokenSummary: (sessionID) => invoke("session", "tokenSummary", { path: { id: sessionID } }),
      usageSummary: (sessionID?, projectID?) => invoke("session", "usageSummary", { query: { sessionID, projectID } }),
      usage: (sessionID?, projectID?) => invoke("session", "usage", { sessionID, projectID }),
      usagePlugins: () => invoke("session", "usagePlugins"),
      usagePluginsReload: () => invoke("session", "usagePluginsReload"),
      usagePluginsCreate: (body) => invoke("session", "usagePluginsCreate", body),
      usagePluginSource: (name) => invoke("session", "usagePluginSource", name),
      usagePluginSourceSave: (name, source) => invoke("session", "usagePluginSourceSave", name, source),
      usagePluginDelete: (name) => invoke("session", "usagePluginDelete", name),
      usagePluginTest: (name) => invoke("session", "usagePluginTest", name),
      openUsagePluginsDir: () => ipcRenderer.invoke("mafw-openUsagePluginsDir"),
      promptAsync: ({ sessionID, message, parts, agent, model }) => invoke("session", "promptAsync", { path: { id: sessionID }, body: { message, parts, agent, model } }),
      command: ({ sessionID, command, arguments: args, agent, model }) => invoke("session", "command", { path: { id: sessionID }, body: { command, arguments: args, agent, model } }),
    },

    command: {
      list: (directory?) => invoke("command", "list", directory),
    },

    skill: {
      list: (directory?) => invoke("skill", "list", directory),
    },

    mafwCommands: {
      run: (opts) => invoke("mafwCommands", "run", opts),
    },

    manager: {
      session: (projectDir?) => invoke("manager", "session", projectDir),
      rotate: (projectDir, reason?) => invoke("manager", "rotate", projectDir, reason),
    },

    projects: {
      list: () => invoke("project", "list"),
      current: () => invoke("project", "current"),
      setCurrent: (path) => invoke("project", "setCurrent", path),
    },

    goals: {
      list: () => invoke("goals", "list"),
      get: (id) => invoke("goals", "get", id),
      validate: (input) => invoke("goals", "validate", input),
      control: (action) => invoke("goals", "control", action),
    },

    memory: {
      search: (opts) => invoke("memory", "search", opts),
      mergedSearch: (opts) => invoke("memory", "mergedSearch", opts),
      delete: (id) => invoke("memory", "delete", id),
      getEnergyDistribution: () => invoke("memory", "getEnergyDistribution"),
      getL5Axioms: (topK) => invoke("memory", "getL5Axioms", topK),
    },

    approvals: {
      list: () => invoke("approvals", "list"),
      respond: (id, decision) => invoke("approvals", "respond", id, decision),
    },

    questions: {
      list: () => invoke("questions", "list"),
      reply: (id, answers) => invoke("questions", "reply", id, answers),
      reject: (id) => invoke("questions", "reject", id),
    },

    permissions: {
      list: () => invoke("permissions", "list"),
      reply: (id, reply, message?) => invoke("permissions", "reply", id, reply, message),
    },

    triage: {
      list: () => invoke("triage", "list"),
      dismiss: (id) => invoke("triage", "dismiss", id),
      confirm: (id) => invoke("triage", "confirm", id),
      reject: (id) => invoke("triage", "reject", id),
    },

    automations: {
      list: () => invoke("automations", "list"),
      toggle: (id, enabled) => invoke("automations", "toggle", id, enabled),
    },

    chat: {
      send: (message, sessionID?) => invoke("chat", "send", message, sessionID),
      sendEnriched: (opts) => invoke("chat", "sendEnriched", opts),
    },

    media: {
      createTask: (opts) => invoke("media", "createTask", opts),
      // Binary upload through the main process (Node network stack) — the
      // renderer's fetch can hang on proxy interception; main goes direct.
      uploadBinary: (bytes, mediaType) => ipcRenderer.invoke("mafw-media-upload", bytes, mediaType),
      // Combined upload + createTask in a single IPC call (saves one round-trip).
      uploadAndCreate: (opts) => ipcRenderer.invoke("mafw-media-upload-and-create", opts.bytes, opts.mediaType, opts.question),
      plugins: () => invoke("media", "plugins"),
      switch: (opts) => invoke("media", "switch", opts),
    },

    tts: {
      speak: (opts) => invoke("tts", "speak", opts),
      voices: () => invoke("tts", "voices"),
    },

    providers: {
      list: () => invoke("providers", "list"),
    },

    agents: {
      list: () => invoke("agents", "list"),
    },

    config: {
      get: (key?) => invoke("config", "get", key),
      set: (key, value) => invoke("config", "set", key, value),
    },

    models: {
      get: () => invoke("models", "get"),
      update: (opts) => invoke("models", "update", opts),
    },

    embedding: {
      get: () => invoke("embedding", "get"),
      update: (opts) => invoke("embedding", "update", opts),
    },

    runtime: {
      get: () => invoke("runtime", "get"),
      switch: (plugin: string) => invoke("runtime", "switch", plugin),
      restartAgent: () => invoke("runtime", "restartAgent"),
    },

    opencodeConfig: {
      get: () => invoke("opencodeConfig", "get"),
      update: (config) => invoke("opencodeConfig", "update", config),
    },

    invoke: (namespace, method, ...args) => invoke(namespace, method, ...args),
  }
}
