import { isLoopbackAddr, authorizeRequest, redactLog } from "../../../gateway/src/mobile/auth-helpers";

describe("mobile auth", () => {
  it("空token时非回环应拒绝", () => {
    expect(authorizeRequest({ remoteAddress: "100.64.0.5", headers: {} }, "")).toBe(false);
  });
  it("回环 127.0.0.1/::1/::ffff:127.0.0.1 放行", () => {
    expect(isLoopbackAddr("127.0.0.1")).toBe(true);
    expect(isLoopbackAddr("::1")).toBe(true);
    expect(isLoopbackAddr("::ffff:127.0.0.1")).toBe(true);
  });
  it("127.x 网段放行", () => {
    expect(isLoopbackAddr("127.0.0.2")).toBe(true);
  });
  it("非回环 + 正确 Bearer 放行", () => {
    expect(
      authorizeRequest({ remoteAddress: "100.64.0.5", headers: { authorization: "Bearer tok123" } }, "tok123"),
    ).toBe(true);
  });
  it("非回环 + 错误 token 拒绝", () => {
    expect(
      authorizeRequest({ remoteAddress: "100.64.0.5", headers: { authorization: "Bearer wrong" } }, "tok123"),
    ).toBe(false);
  });
  it("非回环 + x-api-token 放行", () => {
    expect(authorizeRequest({ remoteAddress: "100.64.0.5", headers: { "x-api-token": "tok123" } }, "tok123")).toBe(
      true,
    );
  });
  it("非回环 + ?token= 放行", () => {
    expect(
      authorizeRequest({ remoteAddress: "100.64.0.5", headers: {}, url: "/api/test?token=tok123", host: "localhost" }, "tok123"),
    ).toBe(true);
  });
  it("回环无 token 也放行", () => {
    expect(authorizeRequest({ remoteAddress: "127.0.0.1", headers: {} }, "")).toBe(true);
    expect(authorizeRequest({ remoteAddress: "::1", headers: {} }, "")).toBe(true);
    expect(authorizeRequest({ remoteAddress: "127.0.0.5", headers: {} }, "")).toBe(true);
  });
  it("127.0.0.0/8 全网段放行", () => {
    expect(isLoopbackAddr("127.0.0.10")).toBe(true);
    expect(isLoopbackAddr("127.255.255.255")).toBe(true);
    expect(isLoopbackAddr("192.168.1.1")).toBe(false);
    expect(isLoopbackAddr("10.0.0.1")).toBe(false);
  });

  describe("log redaction", () => {
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
