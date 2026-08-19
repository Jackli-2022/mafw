jest.mock('electron', () => ({
  ipcRenderer: {
    invoke: jest.fn().mockResolvedValue({}),
    on: jest.fn(),
    removeListener: jest.fn(),
  },
}))

import { ipcRenderer } from 'electron'
import { createMafwApi } from '../../../opencode-dev/packages/desktop/src/preload/mafw-api'

afterEach(() => { jest.clearAllMocks() })

describe('preload createMafwApi', () => {
  const api = createMafwApi()

  describe('gateway namespace', () => {
    it('info', async () => {
      await api.gateway.info()
      expect(ipcRenderer.invoke).toHaveBeenCalledWith('mafw-gateway-info')
    })

    it('start', async () => {
      await api.gateway.start()
      expect(ipcRenderer.invoke).toHaveBeenCalledWith('mafw-gateway-start')
    })

    it('restart', async () => {
      await api.gateway.restart()
      expect(ipcRenderer.invoke).toHaveBeenCalledWith('mafw-gateway-restart')
    })

    it('onStateChange subscribes and returns unsubscribe', () => {
      const cb = jest.fn()
      const unsub = api.gateway.onStateChange(cb)
      expect(ipcRenderer.on).toHaveBeenCalledWith('mafw-gateway-state', expect.any(Function))
      expect(typeof unsub).toBe('function')
      unsub()
      expect(ipcRenderer.removeListener).toHaveBeenCalledWith('mafw-gateway-state', expect.any(Function))
    })
  })

  describe('sessions namespace', () => {
    it('list', async () => {
      await api.sessions.list()
      expect(ipcRenderer.invoke).toHaveBeenCalledWith('mafw-invoke', 'session', 'list', {})
    })

    it('list with projectID', async () => {
      await api.sessions.list('proj-1')
      expect(ipcRenderer.invoke).toHaveBeenCalledWith('mafw-invoke', 'session', 'list', { query: { projectID: 'proj-1' } })
    })

    it('create', async () => {
      await api.sessions.create({ directory: '/tmp' })
      expect(ipcRenderer.invoke).toHaveBeenCalledWith('mafw-invoke', 'session', 'create', { directory: '/tmp' })
    })

    it('messages with limit', async () => {
      await api.sessions.messages('sid-1', 50)
      expect(ipcRenderer.invoke).toHaveBeenCalledWith('mafw-invoke', 'session', 'messages', { path: { id: 'sid-1' }, query: { limit: 50, before: undefined } })
    })

    it('delete', async () => {
      await api.sessions.delete('sid-1')
      expect(ipcRenderer.invoke).toHaveBeenCalledWith('mafw-invoke', 'session', 'delete', { path: { id: 'sid-1' } })
    })
  })

  describe('projects namespace', () => {
    it('list', async () => {
      await api.projects.list()
      expect(ipcRenderer.invoke).toHaveBeenCalledWith('mafw-invoke', 'project', 'list')
    })

    it('current', async () => {
      await api.projects.current()
      expect(ipcRenderer.invoke).toHaveBeenCalledWith('mafw-invoke', 'project', 'current')
    })

    it('setCurrent', async () => {
      await api.projects.setCurrent('/path')
      expect(ipcRenderer.invoke).toHaveBeenCalledWith('mafw-invoke', 'project', 'setCurrent', '/path')
    })
  })

  describe('goals namespace', () => {
    it('list', async () => {
      await api.goals.list()
      expect(ipcRenderer.invoke).toHaveBeenCalledWith('mafw-invoke', 'goals', 'list')
    })

    it('control with pause', async () => {
      await api.goals.control({ goalId: 'g1', action: 'PAUSE' })
      expect(ipcRenderer.invoke).toHaveBeenCalledWith('mafw-invoke', 'goals', 'control', { goalId: 'g1', action: 'PAUSE' })
    })
  })

  describe('memory namespace', () => {
    it('search', async () => {
      await api.memory.search({ query: 'test' })
      expect(ipcRenderer.invoke).toHaveBeenCalledWith('mafw-invoke', 'memory', 'search', { query: 'test' })
    })

    it('mergedSearch', async () => {
      await api.memory.mergedSearch({ query: 'x', maxFacts: 5 })
      expect(ipcRenderer.invoke).toHaveBeenCalledWith('mafw-invoke', 'memory', 'mergedSearch', { query: 'x', maxFacts: 5 })
    })

    it('delete', async () => {
      await api.memory.delete('mem-1')
      expect(ipcRenderer.invoke).toHaveBeenCalledWith('mafw-invoke', 'memory', 'delete', 'mem-1')
    })
  })

  describe('approvals namespace', () => {
    it('list', async () => {
      await api.approvals.list()
      expect(ipcRenderer.invoke).toHaveBeenCalledWith('mafw-invoke', 'approvals', 'list')
    })

    it('respond', async () => {
      await api.approvals.respond('a1', 'approve')
      expect(ipcRenderer.invoke).toHaveBeenCalledWith('mafw-invoke', 'approvals', 'respond', 'a1', 'approve')
    })
  })

  describe('triage namespace', () => {
    it('list', async () => {
      await api.triage.list()
      expect(ipcRenderer.invoke).toHaveBeenCalledWith('mafw-invoke', 'triage', 'list')
    })

    it('dismiss', async () => {
      await api.triage.dismiss('t1')
      expect(ipcRenderer.invoke).toHaveBeenCalledWith('mafw-invoke', 'triage', 'dismiss', 't1')
    })
  })

  describe('automations namespace', () => {
    it('list', async () => {
      await api.automations.list()
      expect(ipcRenderer.invoke).toHaveBeenCalledWith('mafw-invoke', 'automations', 'list')
    })

    it('toggle', async () => {
      await api.automations.toggle('r1', true)
      expect(ipcRenderer.invoke).toHaveBeenCalledWith('mafw-invoke', 'automations', 'toggle', 'r1', true)
    })
  })

  describe('chat namespace', () => {
    it('send', async () => {
      await api.chat.send('hello')
      expect(ipcRenderer.invoke).toHaveBeenCalledWith('mafw-invoke', 'chat', 'send', 'hello', undefined)
    })

    it('sendEnriched', async () => {
      await api.chat.sendEnriched({ message: 'hi', sessionID: 's-1' })
      expect(ipcRenderer.invoke).toHaveBeenCalledWith('mafw-invoke', 'chat', 'sendEnriched', { message: 'hi', sessionID: 's-1' })
    })
  })

  describe('config namespace', () => {
    it('get', async () => {
      await api.config.get()
      expect(ipcRenderer.invoke).toHaveBeenCalledWith('mafw-invoke', 'config', 'get', undefined)
    })

    it('set', async () => {
      await api.config.set('key', 'val')
      expect(ipcRenderer.invoke).toHaveBeenCalledWith('mafw-invoke', 'config', 'set', 'key', 'val')
    })
  })
})
