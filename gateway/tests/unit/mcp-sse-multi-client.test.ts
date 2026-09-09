/**
 * Regression test for the shared-Server response-misrouting bug.
 *
 * Root cause (2026-09-09 investigation): McpSSEEndpoint shared ONE MCP SDK
 * `Server` across all SSE transports. SDK `Protocol` supports a single
 * transport 鈥?each new SSE connection REPLACED `server._transport`, so
 * responses to requests arriving on older connections were pushed onto the
 * most recently connected client's stream (discarded there as unknown ids).
 * The victim client's tool call hangs until the client-side timeout
 * (observed as intermittent "-32001 Request timed out" in opencode sessions,
 * flip-flopping with the ~305s eventsource idle-abort reconnect cycle).
 *
 * Contract: EVERY connected SSE client must receive the response to its own
 * request, regardless of connect order or concurrent sessions.
 */
import * as http from "http";
import * as net from "net";
import { AddressInfo } from "net";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { SSEClientTransport } from "@modelcontextprotocol/sdk/client/sse.js";
import { McpSSEEndpoint } from "../../src/mcp/sse-transport";
import { createToolRegistry } from "../../src/mcp/tool-registry";

// SDK 1.0.0's SSEClientTransport expects a global EventSource; Node 24 has none.
// SDK 1.29+ bundles the `eventsource` package and does not need this, but the
// polyfill is harmless there.
const ESMod = require("eventsource");
if (!(global as any).EventSource) {
  (global as any).EventSource = ESMod.EventSource ?? ESMod.default ?? ESMod;
}

function makeServices(): any {
  return {
    memory: undefined,
    mafwDir: undefined,
  } as any;
}

describe("McpSSEEndpoint multi-client isolation", () => {
  let httpServer: http.Server;
  let endpoint: McpSSEEndpoint;
  let baseUrl: string;
  const sockets = new Set<net.Socket>();

  beforeAll(async () => {
    endpoint = new McpSSEEndpoint(createToolRegistry(), makeServices(), { heartbeatMs: 60000 });
    httpServer = http.createServer((req, res) => {
      const url = req.url || "";
      if (url === "/mcp" && req.method === "GET") {
        void endpoint.handleSSE(req, res);
        return;
      }
      if (url.startsWith("/mcp") && req.method === "POST") {
        void endpoint.handleMessage(req, res);
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

  function connectClient(name: string): Promise<Client> {
    const client = new Client({ name, version: "0.0.1" }, { capabilities: {} });
    const transport = new SSEClientTransport(new URL(`${baseUrl}/mcp`));
    return client.connect(transport).then(() => client);
  }

  test("two concurrent SSE clients each receive their own tools/list response", async () => {
    const clientA = await connectClient("client-a");
    const clientB = await connectClient("client-b");

    // Interleave: A connects first, B second. On the buggy shared-Server
    // implementation B's connect steals server._transport, so A's request
    // response is routed into B's stream and A hangs until timeout.
    const [resA, resB] = await Promise.all([
      clientA.listTools(undefined, { timeout: 8000 }),
      clientB.listTools(undefined, { timeout: 8000 }),
    ]);

    expect(resA.tools.length).toBeGreaterThan(0);
    expect(resB.tools.length).toBeGreaterThan(0);
    expect(resA.tools.map((t) => t.name)).toContain("mafw_get_memory");
    expect(resB.tools.map((t) => t.name)).toContain("mafw_get_memory");

    // Both clients must still be usable after the first round of calls.
    const [resA2, resB2] = await Promise.all([
      clientA.listTools(undefined, { timeout: 8000 }),
      clientB.listTools(undefined, { timeout: 8000 }),
    ]);
    expect(resA2.tools.length).toBe(resA.tools.length);
    expect(resB2.tools.length).toBe(resB.tools.length);

    await clientA.close();
    await clientB.close();
  }, 30000);

  test("a client that connects later does not starve earlier clients", async () => {
    const first = await connectClient("first");
    // First client issues a call BEFORE the second client connects.
    const pendingFirst = first.listTools(undefined, { timeout: 8000 });
    const second = await connectClient("second");
    const pendingSecond = second.listTools(undefined, { timeout: 8000 });

    const [r1, r2] = await Promise.all([pendingFirst, pendingSecond]);
    expect(r1.tools.length).toBeGreaterThan(0);
    expect(r2.tools.length).toBeGreaterThan(0);

    await first.close();
    await second.close();
  }, 30000);

  test("sessions are tracked and cleaned up on disconnect", async () => {
    // Prior tests' sockets may still be draining; wait for the count to settle.
    await new Promise((r) => setTimeout(r, 500));
    const before = endpoint.sessionCount();
    const client = await connectClient("transient");
    // Wait for the server-side session registration to settle.
    await new Promise((r) => setTimeout(r, 300));
    const during = endpoint.sessionCount();
    expect(during).toBeGreaterThan(before);
    await client.close();
    // Poll until the server-side close event fires (TCP teardown is async).
    const deadline = Date.now() + 5000;
    let after = during;
    while (Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 100));
      after = endpoint.sessionCount();
      if (after === during - 1) break;
    }
    expect(after).toBe(during - 1);
  }, 15000);
});
