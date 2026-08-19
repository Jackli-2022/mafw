export class ModelRuntime {
  static async create(_opts?: { signal?: AbortSignal }): Promise<ModelRuntime> {
    return new ModelRuntime();
  }
  async setRuntimeApiKey(_provider: string, _key: string): Promise<void> {}
  getModel(provider: string, model: string): { id: string; provider: string } | undefined {
    return { id: model, provider };
  }
  async complete(_model: unknown, _context: unknown, _options?: unknown): Promise<{ content: Array<{ type: string; text?: string }>; stopReason: string; errorMessage?: string }> {
    return { content: [{ type: 'text', text: 'mocked reply' }], stopReason: 'stop' };
  }
}
