import { ipcRenderer } from "electron"
import type { MafwAPI } from "./mafw-types"

function invoke<T = unknown>(namespace: string, method: string, ...args: unknown[]): Promise<T> {
  return ipcRenderer.invoke("mafw-invoke", namespace, method, ...args) as Promise<T>
}

export function createMafwApi(): MafwAPI {
  return {
    gateway: {
      info: () => ipcRenderer.invoke("mafw-gateway-info"),
      start: () => ipcRenderer.invoke("mafw-gateway-start"),
      restart: () => ipcRenderer.invoke("mafw-gateway-restart"),
      logsPath: () => ipcRenderer.invoke("mafw-gateway-logs-path"),
      onStateChange: (cb) => {
        const handler = (_event: any, status: any) => cb(status)
        ipcRenderer.on("mafw-gateway-state", handler)
        return () => ipcRenderer.removeListener("mafw-gateway-state", handler)
      },
    },

    sessions: {
      list: (projectID?) => invoke("session", "list", projectID ? { query: { projectID } } : {}),
      create: (opts?) => invoke("session", "create", opts || {}),
      get: (id) => invoke("session", "get", { path: { id } }),
      messages: (sessionID, limit?, before?) => invoke("session", "messages", { path: { id: sessionID }, query: { limit, before } }),
      todo: (sessionID) => invoke("session", "todo", { path: { id: sessionID } }),
      abort: (sessionID) => invoke("session", "abort", { path: { id: sessionID } }),
      delete: (id) => invoke("session", "delete", { path: { id } }),
      promptAsync: ({ sessionID, message }) => invoke("session", "promptAsync", { path: { id: sessionID }, body: { message } }),
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
      sendEnriched: (message, sessionID?) => invoke("chat", "sendEnriched", message, sessionID),
    },

    config: {
      get: (key?) => invoke("config", "get", key),
      set: (key, value) => invoke("config", "set", key, value),
    },

    invoke: (namespace, method, ...args) => invoke(namespace, method, ...args),
  }
}
