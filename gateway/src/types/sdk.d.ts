declare module '@opencode-ai/sdk' {
  export function createOpencode(options?: {
    port?: number;
    hostname?: string;
  }): Promise<{
    client: any;
    server: { url: string; close(): void };
  }>;
  export function createOpencodeServer(options?: {
    port?: number;
    hostname?: string;
  }): Promise<{ url: string; close(): void }>;
  export function createOpencodeClient(config?: {
    baseUrl?: string;
    directory?: string;
  }): any;
  export function createOpencodeTui(options?: {
    project?: string;
    model?: string;
  }): { close(): void };
}
