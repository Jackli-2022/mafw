export function createOpencodeClient(_config?: Record<string, any>): any {
  return {
    session: {
      promptAsync: async (_opts: { sessionID: string; message: string }): Promise<void> => {},
      prompt: async (_opts: any): Promise<any> => ({ parts: [] }),
      create: async (_opts: any): Promise<any> => ({ id: 'mock-session' }),
      delete: async (_opts: any): Promise<void> => {},
    },
    event: {
      subscribe: async (_opts: any): Promise<any> => ({ on: () => {} }),
    },
    global: {
      health: async (): Promise<any> => ({ status: 'ok' }),
    },
  };
}
