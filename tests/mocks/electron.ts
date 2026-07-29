export const ipcMain = {
  handle: jest.fn(),
} as any

export const BrowserWindow = {
  getAllWindows: jest.fn().mockReturnValue([]),
} as any

export const ipcRenderer = {
  invoke: jest.fn().mockResolvedValue({}),
  on: jest.fn(),
  removeListener: jest.fn(),
} as any
