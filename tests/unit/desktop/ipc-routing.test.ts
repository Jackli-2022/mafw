jest.mock('../../../opencode-dev/packages/desktop/src/main/mafw-sidecar', () => ({
  getGatewayStatus: jest.fn().mockReturnValue({ state: 'ready', port: 3000, url: 'http://localhost:3000', error: null }),
  getGatewayPort: jest.fn().mockReturnValue(3000),
  onGatewayStateChange: jest.fn(),
  startGateway: jest.fn(),
  stopGateway: jest.fn(),
}))

jest.mock('../../../opencode-dev/packages/desktop/src/main/logging', () => ({
  write: jest.fn(),
}))

import { ipcMain, BrowserWindow } from 'electron'
import { registerMafwIpcHandlers } from '../../../opencode-dev/packages/desktop/src/main/mafw-ipc'

let handleCalls: Map<string, jest.Mock> = new Map()

beforeEach(() => {
  handleCalls = new Map()
  ;(ipcMain.handle as jest.Mock).mockImplementation((channel: string, handler: (...args: any[]) => any) => {
    handleCalls.set(channel, jest.fn(handler))
  })
  ;(BrowserWindow.getAllWindows as jest.Mock).mockReturnValue([])
})

afterEach(() => { jest.clearAllMocks() })

describe('registerMafwIpcHandlers', () => {
  it('registers mafw-gateway-info handler', () => {
    registerMafwIpcHandlers()
    expect(ipcMain.handle).toHaveBeenCalledWith('mafw-gateway-info', expect.any(Function))
  })

  it('registers mafw-gateway-start handler', () => {
    registerMafwIpcHandlers()
    expect(ipcMain.handle).toHaveBeenCalledWith('mafw-gateway-start', expect.any(Function))
  })

  it('registers mafw-gateway-restart handler', () => {
    registerMafwIpcHandlers()
    expect(ipcMain.handle).toHaveBeenCalledWith('mafw-gateway-restart', expect.any(Function))
  })

  it('registers mafw-invoke handler', () => {
    registerMafwIpcHandlers()
    expect(ipcMain.handle).toHaveBeenCalledWith('mafw-invoke', expect.any(Function))
  })
})
