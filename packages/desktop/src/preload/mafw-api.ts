import { ipcRenderer } from "electron"
import type { MafwAPI } from "./mafw-types"
import type { PluginEntry, RenderRequest, RenderResponse } from "../shared/ui-plugins"
import type { TerminalEvent, TerminalProbe, TerminalSessionInfo } from "../shared/terminal-session"
import type { SshHostProfile, SshHostProfileInput, SshSecretInput } from "../shared/ssh-host"

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

  // 终端事件（spec 2026-10-26）：同样单监听器多播，防 HMR remount 堆监听器。
  ipcRenderer.removeAllListeners("mafw-terminal-event")
  const terminalCallbacks = new Set<(ev: { directory: string; type: 'data' | 'closed' | 'gone'; data?: string }) => void>()
  let terminalChannelActive = false
  const terminalRelay = (_event: any, ev: any) => {
    for (const cb of terminalCallbacks) cb(ev)
  }

  // v2 terminal session events (local + SSH); separate channel from the
  // legacy bottom-strip event until Task 13 removes it.
  ipcRenderer.removeAllListeners("mafw-terminal-v2-event")
  const sessionCallbacks = new Set<(ev: TerminalEvent) => void>()
  let sessionChannelActive = false
  const sessionRelay = (_event: any, ev: TerminalEvent) => {
    for (const cb of sessionCallbacks) cb(ev)
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
      switchAgent: (id, agent) => invoke("session", "switchAgent", { path: { id }, body: { agent } }),
      switchModel: (id, model) => invoke("session", "switchModel", { path: { id }, body: { model } }),
      abort: (sessionID) => invoke("session", "abort", { path: { id: sessionID } }),
      queueList: (sessionID) => invoke("session", "queueList", { path: { id: sessionID } }),
      queueCancel: (sessionID, itemId) => invoke("session", "queueCancel", { path: { id: sessionID, itemId } }),
      queueClear: (sessionID) => invoke("session", "queueClear", { path: { id: sessionID } }),
      config: (sessionID) => invoke("session", "config", { path: { id: sessionID } }),
      setConfig: (sessionID, body) => invoke("session", "setConfig", { path: { id: sessionID }, body }),
      fork: (sessionID, messageID?) => invoke("session", "fork", { path: { id: sessionID }, body: { messageID } }),
      revert: (sessionID, messageID) => invoke("session", "revert", { path: { id: sessionID }, body: { messageID } }),
      unrevert: (sessionID) => invoke("session", "unrevert", { path: { id: sessionID } }),
      background: (sessionID) => invoke("session", "background", { path: { id: sessionID } }),
      diff: (sessionID, messageID?) => invoke("session", "diff", { path: { id: sessionID }, query: { messageID } }),
      revertDiff: (sessionID, patches) => invoke("session", "revertDiff", { path: { id: sessionID }, body: { patches } }),
      checkpoint: (sessionID, messageID?) => invoke("session", "checkpoint", { path: { id: sessionID }, body: { messageID } }),
      checkpoints: (sessionID) => invoke("session", "checkpoints", { path: { id: sessionID } }),
      restoreCheckpoint: (sessionID, checkpointId, scope) => invoke("session", "restoreCheckpoint", {
        path: { id: sessionID, checkpointId }, body: { scope, confirm: true },
      }),
      suspend: (sessionID, reason?) => invoke("session", "suspend", { path: { id: sessionID }, body: { reason } }),
      resume: (sessionID, runId?) => invoke("session", "resume", { path: { id: sessionID }, body: { runId } }),
      run: (sessionID) => invoke("session", "run", { path: { id: sessionID } }),
      discardRun: (sessionID, runId?) => invoke("session", "discardRun", { path: { id: sessionID }, body: { runId } }),
      data: (sessionID, body) => invoke("session", "data", { path: { id: sessionID }, body }),
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
      promptAsync: ({ sessionID, message, parts, agent, model, delivery, idempotencyKey, expectReply, thinkingLevel, variant }) => invoke("session", "promptAsync", { path: { id: sessionID }, body: { message, parts, agent, model, delivery, idempotencyKey, expectReply, thinkingLevel, variant } }),
      command: ({ sessionID, command, arguments: args, agent, model }) => invoke("session", "command", { path: { id: sessionID }, body: { command, arguments: args, agent, model } }),
    },

    command: {
      list: (directory?) => invoke("command", "list", directory),
    },

    skill: {
      list: (directory?) => invoke("skill", "list", directory),
      content: (id, directory?) => invoke("skill", "content", id, directory),
    },

    // W4 v1：MCP 服务器状态（CLI 解析）
    mcp: {
      servers: () => invoke("mcp", "servers"),
      connect: (name) => invoke("mcp", "connect", name),
      disconnect: (name) => invoke("mcp", "disconnect", name),
      previewServer: (input) => invoke("mcp", "previewServer", input),
      previewRemoveServer: (name) => invoke("mcp", "previewRemoveServer", name),
      applyServer: (input) => invoke("mcp", "applyServer", input),
      removeServer: (name, opts) => invoke("mcp", "removeServer", name, opts),
      restoreConfig: (opts) => invoke("mcp", "restoreConfig", opts),
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
      timeline: (id) => invoke("goals", "timeline", id),
      plan: (id) => invoke("goals", "plan", id),
      approvePlan: (goalId) => invoke("goals", "approvePlan", goalId),
      rejectPlan: (goalId, feedback) => invoke("goals", "rejectPlan", goalId, feedback),
      retryNode: (goalId, runId, opts) => invoke("goals", "retryNode", goalId, runId, opts),
    },

    memory: {
      search: (opts) => invoke("memory", "search", opts),
      mergedSearch: (opts) => invoke("memory", "mergedSearch", opts),
      delete: (id) => invoke("memory", "delete", id),
      getEnergyDistribution: () => invoke("memory", "getEnergyDistribution"),
      getL5Axioms: (topK) => invoke("memory", "getL5Axioms", topK),
      listSticky: () => invoke("memory", "listSticky"),
      setSticky: (id, sticky, stickyDays?) => invoke("memory", "setSticky", id, sticky, stickyDays),
      setPinned: (id, pinned) => invoke("memory", "setPinned", id, pinned),
      stats: () => invoke("memory", "stats"),
    },

    approvals: {
      list: () => invoke("approvals", "list"),
      respond: (id, decision) => invoke("approvals", "respond", id, decision),
    },

    questions: {
      list: (directory?: string) => invoke("questions", "list", directory),
      reply: (id, answers) => invoke("questions", "reply", id, answers),
      reject: (id) => invoke("questions", "reject", id),
    },

    tasks: {
      submit: (input) => invoke("tasks", "submit", input),
      list: (query) => invoke("tasks", "list", query),
      get: (id) => invoke("tasks", "get", id),
      cancel: (id) => invoke("tasks", "cancel", id),
      message: (id, message) => invoke("tasks", "message", id, message),
      output: (id, query) => invoke("tasks", "output", id, query),
    },

    permissions: {
      list: () => invoke("permissions", "list"),
      reply: (id, reply, message?, persist?) => invoke("permissions", "reply", id, reply, message, persist),
      getMode: (sid) => invoke("permissions", "getMode", sid),
      setMode: (sid, mode) => invoke("permissions", "setMode", sid, mode),
      listRules: () => invoke("permissions", "listRules"),
      addRule: (rule) => invoke("permissions", "addRule", rule),
      removeRule: (rule) => invoke("permissions", "removeRule", rule),
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
      remove: (id) => invoke("automations", "remove", id),
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

    // opencode v2 原生 shell 命令（经 gateway 兜底反代；location-scoped，不可达时调用方 fail-open）
    shells: {
      list: (directory?: string) => invoke("shells", "list", { ...(directory ? { directory } : {}) }),
      get: (id: string, directory?: string) => invoke("shells", "get", { path: { id }, ...(directory ? { directory } : {}) }),
      output: (id: string, opts?: { directory?: string; cursor?: number; limit?: number }) => invoke("shells", "output", { path: { id }, ...(opts || {}) }),
      remove: (id: string, directory?: string) => invoke("shells", "remove", { path: { id }, ...(directory ? { directory } : {}) }),
    },

    plugins: {
      list: () => invoke("plugins", "list"),
      install: (input) => invoke("plugins", "install", input),
      enable: (type, filename) => invoke("plugins", "enable", type, filename),
      disable: (type, filename) => invoke("plugins", "disable", type, filename),
      delete: (type, filename) => invoke("plugins", "delete", type, filename),
    },

    runtimeConfig: {
      get: () => invoke("runtimeConfig", "get"),
      update: (config) => invoke("runtimeConfig", "update", config),
    },
    /** @deprecated 使用 runtimeConfig */
    opencodeConfig: {
      get: () => invoke("runtimeConfig", "get"),
      update: (config) => invoke("runtimeConfig", "update", config),
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

    terminal: {
      // ── legacy bottom-strip API (removed in Task 13) ──
      probe: () => ipcRenderer.invoke("mafw-terminal-probe") as Promise<{ available: boolean; serveUrl?: string; reason?: string }>,
      attach: (directory: string, opts?: { reopen?: boolean }) => ipcRenderer.invoke("mafw-terminal-attach", { directory, reopen: opts?.reopen === true }) as Promise<{ ok: true; ptyId: string; replayed: boolean } | { ok: false; reason: 'gone' | 'unavailable' | 'closed' }>,
      detach: (directory: string) => ipcRenderer.invoke("mafw-terminal-detach", { directory }) as Promise<void>,
      input: (directory: string, data: string) => ipcRenderer.invoke("mafw-terminal-input", { directory, data }) as Promise<void>,
      resize: (directory: string, cols: number, rows: number) => ipcRenderer.invoke("mafw-terminal-resize", { directory, cols, rows }) as Promise<void>,
      kill: (directory: string) => ipcRenderer.invoke("mafw-terminal-kill", { directory }) as Promise<void>,
      openExternal: (directory: string) => ipcRenderer.invoke("mafw-terminal-open-external", { directory }) as Promise<void>,
      onLegacyEvent: (cb: (ev: { directory: string; type: 'data' | 'closed' | 'gone'; data?: string }) => void) => {
        terminalCallbacks.add(cb)
        if (!terminalChannelActive) {
          ipcRenderer.on("mafw-terminal-event", terminalRelay)
          terminalChannelActive = true
        }
        return () => {
          terminalCallbacks.delete(cb)
          if (terminalCallbacks.size === 0 && terminalChannelActive) {
            ipcRenderer.removeListener("mafw-terminal-event", terminalRelay)
            terminalChannelActive = false
          }
        }
      },

      // ── v2 session surface ──
      probeV2: () => ipcRenderer.invoke("mafw-terminal-v2-probe") as Promise<TerminalProbe>,
      sessions: {
        list: () => ipcRenderer.invoke("mafw-terminal-v2-list") as Promise<TerminalSessionInfo[]>,
        attachLocal: (directory: string) => ipcRenderer.invoke("mafw-terminal-v2-local-attach", { directory }) as Promise<TerminalSessionInfo>,
        createSsh: (input: { id?: string; hostId: string }) => ipcRenderer.invoke("mafw-terminal-v2-ssh-create", input) as Promise<TerminalSessionInfo>,
        restore: (input: { id: string; hostId: string }) => ipcRenderer.invoke("mafw-terminal-v2-ssh-restore", input) as Promise<TerminalSessionInfo>,
        attach: (sessionId: string, key: string) => ipcRenderer.invoke("mafw-terminal-v2-attach", { sessionId, key }) as Promise<{ ok: boolean; replayed: boolean }>,
        detach: (sessionId: string, key: string) => ipcRenderer.invoke("mafw-terminal-v2-detach", { sessionId, key }) as Promise<void>,
        input: (sessionId: string, data: string) => ipcRenderer.invoke("mafw-terminal-v2-input", { sessionId, data }) as Promise<void>,
        resize: (sessionId: string, cols: number, rows: number) => ipcRenderer.invoke("mafw-terminal-v2-resize", { sessionId, cols, rows }) as Promise<void>,
        close: (sessionId: string) => ipcRenderer.invoke("mafw-terminal-v2-close", { sessionId }) as Promise<void>,
        kill: (sessionId: string) => ipcRenderer.invoke("mafw-terminal-v2-kill", { sessionId }) as Promise<void>,
        reconnect: (sessionId: string) => ipcRenderer.invoke("mafw-terminal-v2-reconnect", { sessionId }) as Promise<void>,
      },
      hosts: {
        list: () => ipcRenderer.invoke("mafw-terminal-v2-hosts-list") as Promise<SshHostProfile[]>,
        save: (profile: SshHostProfileInput, secret?: SshSecretInput) => ipcRenderer.invoke("mafw-terminal-v2-hosts-save", { profile, secret }) as Promise<SshHostProfile>,
        remove: (id: string) => ipcRenderer.invoke("mafw-terminal-v2-hosts-remove", { id }) as Promise<void>,
        test: (profile: SshHostProfileInput, secret?: SshSecretInput) => ipcRenderer.invoke("mafw-terminal-v2-hosts-test", { profile, secret }) as Promise<{ ok: boolean; error?: string }>,
      },
      hostkey: {
        respond: (input: { requestId: string; action: "trust" | "trust-and-save" | "replace" | "reject" }) =>
          ipcRenderer.invoke("mafw-terminal-v2-hostkey-respond", input) as Promise<void>,
      },
      prompt: {
        respond: (input: { requestId: string; answers?: string[] }) =>
          ipcRenderer.invoke("mafw-terminal-v2-prompt-respond", input) as Promise<void>,
      },
      onEvent: (cb: (ev: TerminalEvent) => void) => {
        sessionCallbacks.add(cb)
        if (!sessionChannelActive) {
          ipcRenderer.on("mafw-terminal-v2-event", sessionRelay)
          sessionChannelActive = true
        }
        return () => {
          sessionCallbacks.delete(cb)
          if (sessionCallbacks.size === 0 && sessionChannelActive) {
            ipcRenderer.removeListener("mafw-terminal-v2-event", sessionRelay)
            sessionChannelActive = false
          }
        }
      },
    },

    invoke: (namespace, method, ...args) => invoke(namespace, method, ...args),
  }
}
