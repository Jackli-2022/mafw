import { ipcRenderer } from "electron"
import type { MafwAPI } from "./mafw-types"
import type { PluginEntry, RenderRequest, RenderResponse } from "../shared/ui-plugins"

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

  const healthCallbacks = new Set<(health: { healthy: boolean; failures: number }) => void>()
  let healthChannelActive = false
  const healthRelay = (_event: any, health: { healthy: boolean; failures: number }) => {
    for (const cb of healthCallbacks) cb(health)
  }

  return {
    notify: (opts: { title: string; body: string }) => ipcRenderer.invoke("mafw-notify", opts) as Promise<boolean>,

    gateway: {
      info: () => ipcRenderer.invoke("mafw-gateway-info"),
      start: () => ipcRenderer.invoke("mafw-gateway-start"),
      restart: () => ipcRenderer.invoke("mafw-gateway-restart"),
      update: () => ipcRenderer.invoke("mafw-gateway-update") as Promise<{ ok: boolean; error?: string }>,
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
      onHealthChange: (cb) => {
        healthCallbacks.add(cb)
        if (!healthChannelActive) {
          ipcRenderer.on("mafw-gateway-health", healthRelay)
          healthChannelActive = true
        }
        return () => {
          healthCallbacks.delete(cb)
          if (healthCallbacks.size === 0 && healthChannelActive) {
            ipcRenderer.removeListener("mafw-gateway-health", healthRelay)
            healthChannelActive = false
          }
        }
      },
    },

    files: {
      list: () => ipcRenderer.invoke("mafw-list-files") as Promise<string[]>,
    },

    windows: {
      create: () => ipcRenderer.invoke("mafw-new-window") as Promise<{ ok: boolean; error?: string }>,
    },

    exportSession: (opts: { filename: string; markdown: string }) => ipcRenderer.invoke("mafw-export-session", opts) as Promise<{ ok: boolean; path?: string; canceled?: boolean; error?: string }>,

    sessions: {
      list: (projectID?) => invoke("session", "list", projectID ? { query: { projectID } } : {}),
      create: (opts?) => invoke("session", "create", opts || {}),
      get: (id) => invoke("session", "get", { path: { id } }),
      messages: (sessionID, limit?, before?) => invoke("session", "messages", { path: { id: sessionID }, query: { limit, before } }),
      todo: (sessionID) => invoke("session", "todo", { path: { id: sessionID } }),
      children: (sessionID) => invoke("session", "children", { path: { id: sessionID } }),
      abort: (sessionID) => invoke("session", "abort", { path: { id: sessionID } }),
      fork: (sessionID, messageID?) => invoke("session", "fork", { path: { id: sessionID }, body: { messageID } }),
      revert: (sessionID, messageID) => invoke("session", "revert", { path: { id: sessionID }, body: { messageID } }),
      unrevert: (sessionID) => invoke("session", "unrevert", { path: { id: sessionID } }),
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
      list: () => invoke("mafwCommands", "list"),
    },

    manager: {
      session: (projectDir?) => invoke("manager", "session", projectDir),
      rotate: (projectDir, reason?) => invoke("manager", "rotate", projectDir, reason),
    },

    projects: {
      list: () => invoke("project", "list"),
      current: () => invoke("project", "current"),
      setCurrent: (path) => invoke("project", "setCurrent", path),
      openDirectory: () => ipcRenderer.invoke("mafw-open-directory") as Promise<{ ok: boolean; canceled?: boolean; path?: string; error?: string }>,
    },

    goals: {
      list: () => invoke("goals", "list"),
      get: (id) => invoke("goals", "get", id),
      validate: (input) => invoke("goals", "validate", input),
      control: (action) => invoke("goals", "control", action),
      sessions: (id) => invoke("goals", "sessions", id),
      respondQuestion: (goalId, questionId, input) => invoke("goals", "respondQuestion", goalId, questionId, input),
    },

    memory: {
      search: (opts) => invoke("memory", "search", opts),
      mergedSearch: (opts) => invoke("memory", "mergedSearch", opts),
      delete: (id) => invoke("memory", "delete", id),
      getEnergyDistribution: () => invoke("memory", "getEnergyDistribution"),
      getL5Axioms: (topK) => invoke("memory", "getL5Axioms", topK),
      listSticky: () => invoke("memory", "listSticky"),
      setSticky: (id, sticky, stickyDays?) => invoke("memory", "setSticky", { id, sticky, stickyDays }),
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
      reply: (id, reply, message?, persist?) => invoke("permissions", "reply", id, reply, message, persist),
      getMode: (sid) => invoke("permissions", "getMode", sid),
      setMode: (sid, mode) => invoke("permissions", "setMode", sid, mode),
      listAllowlist: () => invoke("permissions", "listAllowlist"),
      addAllowlist: (entry) => invoke("permissions", "addAllowlist", entry),
      removeAllowlist: (entry) => invoke("permissions", "removeAllowlist", entry),
    },

    triage: {
      list: () => invoke("triage", "list"),
      dismiss: (id) => invoke("triage", "dismiss", id),
      confirm: (id) => invoke("triage", "confirm", id),
      reject: (id) => invoke("triage", "reject", id),
      propose: (id, suggestion, reason, priority?) => invoke("triage", "propose", id, suggestion, reason, priority),
    },

    automations: {
      list: () => invoke("automations", "list"),
      toggle: (id, enabled) => invoke("automations", "toggle", id, enabled),
      draft: (input) => invoke("automations", "draft", input),
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
      // Artifact URL helper（SDK 纯函数，经 main 的 mafwClient 取值）。
      artifactUrl: (id) => invoke("media", "artifactUrl", id),
    },

    tts: {
      speak: (opts) => invoke("tts", "speak", opts),
      voices: () => invoke("tts", "voices"),
      // 流式 TTS 端点 URL（SSE 流经 renderer 原生 fetch，IPC 无法克隆）。
      streamUrl: () => invoke("tts", "streamUrl"),
      // barge-in 打断：取消该 session 在途 TTS 合成
      interrupt: (sessionId) => invoke("tts", "interrupt", sessionId),
    },

    event: {
      // SSE 端点 URL（带/不带 sessionID），renderer 直连 EventSource 用。
      url: (sessionID?) => invoke("event", "url", sessionID),
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

    plugins: {
      list: () => invoke("plugins", "list"),
      install: (input) => invoke("plugins", "install", input),
      enable: (type, filename) => invoke("plugins", "enable", type, filename),
      disable: (type, filename) => invoke("plugins", "disable", type, filename),
      delete: (type, filename) => invoke("plugins", "delete", type, filename),
    },

    opencodeConfig: {
      get: () => invoke("opencodeConfig", "get"),
      update: (config) => invoke("opencodeConfig", "update", config),
    },

    uiPlugins: {
      list: () => ipcRenderer.invoke("mafw-ui-plugins-list") as Promise<PluginEntry[]>,
      render: (req: RenderRequest) => ipcRenderer.invoke("mafw-ui-plugins-render", req) as Promise<RenderResponse>,
      status: () => ipcRenderer.invoke("mafw-ui-plugins-status") as Promise<{ entries: PluginEntry[]; dir?: string; lastLoad: { loaded: string[]; failed: Record<string, string> } }>,
      reload: () => ipcRenderer.invoke("mafw-ui-plugins-reload") as Promise<{ loaded: string[]; failed: Record<string, string> }>,
      onChange: (cb: () => void) => {
        const handler = () => cb()
        ipcRenderer.on("mafw-ui-plugins-changed", handler)
        return () => ipcRenderer.removeListener("mafw-ui-plugins-changed", handler)
      },
    },

    invoke: (namespace, method, ...args) => invoke(namespace, method, ...args),
  }
}
