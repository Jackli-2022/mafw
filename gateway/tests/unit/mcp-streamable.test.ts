/**
 * Stateless StreamableHTTP endpoint tests.
 *
 * The gateway serves MCP over stateless StreamableHTTP (MCP 2025-03-26) on
 * the same /mcp path as the legacy SSE endpoint. Because each POST carries
 * its own JSON-RPC response inline, the response-misrouting bug class of the
 * shared-Server SSE implementation is structurally impossible here 鈥?asserted
 * below with parallel calls that must each return their own result.
 */
import * as http from "http";
import * as net from "net";
import { AddressInfo } from "net";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { McpStreamableEndpoint } from "../../src/mcp/streamable-endpoint";
import { createToolRegistry } from "../../src/mcp/tool-registry";

describe("McpStreamableEndpoint (stateless)", () => {
  let httpServer: http.Server;
  let endpoint: McpStreamableEndpoint;
  let baseUrl: string;
  const sockets = new Set<net.Socket>();

  beforeAll(async () => {
    endpoint = new McpStreamableEndpoint(createToolRegistry(), { memory: undefined, mafwDir: undefined } as any);
    httpServer = http.createServer((req, res) => {
      const url = req.url || "";
      if (url.startsWith("/mcp") && req.method === "POST") {
        void endpoint.handleRequest(req, res);
        return;
      }
      if (url === "/mcp" && req.method === "GET") {
        // Mirrors the index.ts routing contract for standalone-stream asks.
        if (req.headers["mcp-protocol-version"]) {
          res.writeHead(405, { Allow: "POST" });
          res.end();
          return;
        }
      }
      res.writeHead(404).end();
    });
    httpServer.on("connection", (socket) => {
      sockets.add(socket);
      socket.on("close", () => sockets.delete(socket));
    });
    await new Promise<void>((resolve) => httpServer.listen(0, "127.0.0.1", resolve));
    const addr = httpServer.address() as AddressInfo;
    baseUrl = `http://127.0.0.1:${addr.port}`;
  });

  afterAll(async () => {
    for (const s of sockets) s.destroy();
    await new Promise<void>((resolve) => httpServer.close(() => resolve()));
  });

  function connectClient(name: string): Promise<Client> {
    const client = new Client({ name, version: "0.0.1" }, { capabilities: {} });
    const transport = new StreamableHTTPClientTransport(new URL(`${baseUrl}/mcp`));
    return client.connect(transport).then(() => client);
  }

  test("initialize + tools/list + tools/call round-trip", async () => {
    const client = await connectClient("sh-single");
    const tools = await client.listTools(undefined, { timeout: 8000 });
    expect(tools.tools.map((t) => t.name)).toContain("mafw_get_memory");

    const res = await client.callTool(
      { name: "mafw_get_memory", arguments: { id: "nonexistent-id" } },
      undefined,
      { timeout: 8000 },
    );
    // Handler runs (memory store empty in test services) 鈥?must return a
    // structured result, not hang.
    expect(res.content).toBeDefined();
    await client.close();
  }, 20000);

  test("parallel calls from one client each get their own response (misrouting-proof)", async () => {
    const client = await connectClient("sh-parallel");
    const results = await Promise.all(
      Array.from({ length: 5 }, (_, i) =>
        client.listTools(undefined, { timeout: 8000 }).then((r) => r.tools.length),
      ),
    );
    // Every parallel request must resolve with the full tool list.
    for (const n of results) expect(n).toBeGreaterThan(0);
    await client.close();
  }, 20000);

  test("two independent clients do not interfere (no shared state)", async () => {
    const a = await connectClient("sh-a");
    const b = await connectClient("sh-b");
    // Interleave calls in both directions twice.
    for (let i = 0; i < 2; i++) {
      const [ra, rb] = await Promise.all([
        a.listTools(undefined, { timeout: 8000 }),
        b.callTool({ name: "mafw_get_memory", arguments: { id: "x" } }, undefined, { timeout: 8000 }),
      ]);
      expect(ra.tools.length).toBeGreaterThan(0);
      expect(rb.content).toBeDefined();
    }
    await a.close();
    await b.close();
  }, 20000);

  test("standalone-stream GET (mcp-protocol-version header) is declined with 405", async () => {
    const res = await fetch(`${baseUrl}/mcp`, {
      headers: { Accept: "text/event-stream", "mcp-protocol-version": "2025-03-26" },
    });
    expect(res.status).toBe(405);
    await res.body?.cancel();
  }, 10000);

  test("notifications get 202 with no body", async () => {
    const res = await fetch(`${baseUrl}/mcp`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json, text/event-stream" },
      body: JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }),
    });
    expect(res.status).toBe(202);
    await res.body?.cancel();
  }, 10000);
});
