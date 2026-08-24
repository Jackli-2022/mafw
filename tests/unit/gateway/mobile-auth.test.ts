import { isLoopbackAddr, authorizeRequest, authorizeWsUpgrade, redactLog } from "../../../gateway/src/core/auth";

describe("gateway auth", () => {
  // ── isLoopbackAddr ──────────────────────────────────────────────
  it("回环 127.0.0.1/::1/::ffff:127.0.0.1 放行", () => {
    expect(isLoopbackAddr("127.0.0.1")).toBe(true);
    expect(isLoopbackAddr("::1")).toBe(true);
    expect(isLoopbackAddr("::ffff:127.0.0.1")).toBe(true);
  });
  it("127.x 网段放行", () => {
    expect(isLoopbackAddr("127.0.0.2")).toBe(true);
    expect(isLoopbackAddr("127.255.255.255")).toBe(true);
  });
  it("非回环地址拒绝", () => {
    expect(isLoopbackAddr("192.168.1.1")).toBe(false);
    expect(isLoopbackAddr("10.0.0.1")).toBe(false);
    expect(isLoopbackAddr("")).toBe(false);
  });

  // ── authorizeRequest (HTTP) ─────────────────────────────────────
  describe("authorizeRequest (HTTP)", () => {
    const req = (addr: string, headers: Record<string, string | undefined> = {}, url?: string) =>
      ({ remoteAddress: addr, headers, url, host: "localhost" });

    it("空token时非回环应拒绝", () => {
      expect(authorizeRequest(req("100.64.0.5", {}), "")).toBe(false);
    });
    it("回环无 token 也放行", () => {
      expect(authorizeRequest(req("127.0.0.1"), "")).toBe(true);
      expect(authorizeRequest(req("::1"), "")).toBe(true);
      expect(authorizeRequest(req("127.0.0.5"), "")).toBe(true);
    });
    it("非回环 + 正确 Bearer 放行", () => {
      expect(authorizeRequest(req("100.64.0.5", { authorization: "Bearer tok123" }), "tok123")).toBe(true);
    });
    it("非回环 + 错误 token 拒绝", () => {
      expect(authorizeRequest(req("100.64.0.5", { authorization: "Bearer wrong" }), "tok123")).toBe(false);
    });
    it("非回环 + x-api-token 放行", () => {
      expect(authorizeRequest(req("100.64.0.5", { "x-api-token": "tok123" }), "tok123")).toBe(true);
    });
    it("非回环 + ?token= 放行", () => {
      expect(authorizeRequest(req("100.64.0.5", {}, "/api/test?token=tok123"), "tok123")).toBe(true);
    });
  });

  // ── authorizeWsUpgrade (WebSocket) ──────────────────────────────
  describe("authorizeWsUpgrade (WebSocket)", () => {
    const wsReq = (addr: string, headers: Record<string, string | undefined> = {}, url = "/api/ws") =>
      ({ remoteAddress: addr, headers, url, host: "localhost" });

    it("loopback → ok", () => {
      const r = authorizeWsUpgrade(wsReq("127.0.0.1"), "tok");
      expect(r.ok).toBe(true);
    });
    it("remote + no token configured → reject", () => {
      const r = authorizeWsUpgrade(wsReq("100.64.0.5"), "");
      expect(r.ok).toBe(false);
      expect(r.rejectResponse).toBeDefined();
    });
    it("remote + correct Bearer → ok", () => {
      const r = authorizeWsUpgrade(wsReq("100.64.0.5", { authorization: "Bearer tok" }), "tok");
      expect(r.ok).toBe(true);
    });
    it("remote + correct x-api-token → ok", () => {
      const r = authorizeWsUpgrade(wsReq("100.64.0.5", { "x-api-token": "tok" }), "tok");
      expect(r.ok).toBe(true);
    });
    it("remote + correct ?token= → ok", () => {
      const r = authorizeWsUpgrade(wsReq("100.64.0.5", {}, "/api/ws?token=tok"), "tok");
      expect(r.ok).toBe(true);
    });
    it("remote + wrong token → reject with 401 bytes", () => {
      const r = authorizeWsUpgrade(wsReq("100.64.0.5", { authorization: "Bearer wrong" }), "tok");
      expect(r.ok).toBe(false);
      expect(r.rejectResponse!.toString()).toContain("401 Unauthorized");
    });
  });

  // ── redactLog ───────────────────────────────────────────────────
  describe("redactLog", () => {
    it("Bearer 脱敏", () => {
      expect(redactLog("Authorization: Bearer tok123")).toBe("Authorization: Bearer ***");
      expect(redactLog("Bearer abc.def.ghi")).toBe("Bearer ***");
    });
    it("token= 脱敏", () => {
      expect(redactLog("/api/test?token=secret123")).toBe("/api/test?token=***");
      expect(redactLog("/api/test?foo=1&token=secret&bar=2")).toBe("/api/test?foo=1&token=***&bar=2");
    });
    it("大小写不敏感", () => {
      expect(redactLog("bearer tok123")).toBe("Bearer ***");
    });
  });
});
