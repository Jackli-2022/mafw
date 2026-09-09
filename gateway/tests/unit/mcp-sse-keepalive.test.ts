/**
 * SSE keep-alive heartbeat tests.
 *
 * Idle MCP SSE streams were silently killed by client-side idle timeouts
 * (~305s aborts observed in production), which drove the reconnect churn
 * that made the shared-Server misrouting bug flip-flop between clients.
 * The endpoint now writes `: ping` comment frames on every open stream 鈥? * comments are ignored by all SSE parsers but keep the connection fresh and
 * surface dead sockets via write failures.
 */
import * as http from "http";
import * as net from "net";
import { AddressInfo } from "net";
import { McpSSEEndpoint } from "../../src/mcp/sse-transport";
import { createToolRegistry } from "../../src/mcp/tool-registry";

describe("McpSSEEndpoint keep-alive", () => {
  let httpServer: http.Server;
  let endpoint: McpSSEEndpoint;
  let baseUrl: string;
  const sockets = new Set<net.Socket>();

  beforeAll(async () => {
    endpoint = new McpSSEEndpoint(createToolRegistry(), { memory: undefined, mafwDir: undefined } as any, {
      heartbeatMs: 60,
    });
    httpServer = http.createServer((req, res) => {
      if (req.url === "/mcp" && req.method === "GET") {
        void endpoint.handleSSE(req, res);
        return;
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

  test("open streams receive : ping comment frames while idle", async () => {
    // Raw socket so we observe the exact byte stream (comment frames are
    // invisible to SSE client libraries 鈥?that is the point).
    const socket = net.connect(new URL(baseUrl).port, "127.0.0.1");
    const received: string[] = [];
    let buffer = "";
    socket.on("data", (d) => {
      buffer += d.toString("utf8");
      let idx;
      while ((idx = buffer.indexOf("\n\n")) >= 0) {
        received.push(buffer.slice(0, idx));
        buffer = buffer.slice(idx + 2);
      }
    });
    socket.write(`GET /mcp HTTP/1.1\r\nHost: 127.0.0.1\r\nAccept: text/event-stream\r\n\r\n`);

    const deadline = Date.now() + 3000;
    while (Date.now() < deadline && !received.some((f) => f.includes(": ping"))) {
      await new Promise((r) => setTimeout(r, 50));
    }
    socket.destroy();

    const pings = received.filter((f) => f.includes(": ping"));
    expect(pings.length).toBeGreaterThan(0);
    // The endpoint event (sessionId announcement) must also be present 鈥?    // heartbeats must not interfere with the legacy handshake.
    expect(received.some((f) => f.includes("event: endpoint"))).toBe(true);
  }, 10000);
});
