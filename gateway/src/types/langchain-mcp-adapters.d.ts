declare module 'langchain-mcp-adapters' {
  export class MultiServerMCPClient {
    static fromSSE(url: string): MultiServerMCPClient;
    getTools(): Promise<any[]>;
  }
}
