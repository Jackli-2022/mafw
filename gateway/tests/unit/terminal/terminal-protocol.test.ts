/**
 * Task 4：MAFW terminal 帧协议（版本化、runtime 中立）。
 *
 * 协议是中性词汇：input / resize / output / meta / close。原生 opencode 帧
 * （原始文本 + 0x00 前缀 meta）只允许出现在 adapter 里，不得进入本协议。
 */
import {
  MAFW_TERMINAL_PROTOCOL,
  MAFW_TERMINAL_VERSION,
  TERMINAL_CLOSE_CODES,
  decodeTerminalFrame,
  encodeTerminalFrame,
  matchTerminalConnectUrl,
  terminalConnectPath,
} from '../../../src/terminal/terminal-protocol';

describe('MAFW terminal frame protocol', () => {
  it('declares the versioned protocol id', () => {
    expect(MAFW_TERMINAL_PROTOCOL).toBe('mafw-terminal/1');
    expect(MAFW_TERMINAL_VERSION).toBe(1);
  });

  it('encodes and decodes MAFW terminal frames', () => {
    const encoded = encodeTerminalFrame({ v: 1, type: 'input', data: 'ls\r' });
    expect(decodeTerminalFrame(encoded)).toEqual({ v: 1, type: 'input', data: 'ls\r' });
  });

  it('round-trips resize, output, meta and close frames', () => {
    const frames = [
      { v: 1 as const, type: 'resize' as const, cols: 120, rows: 30 },
      { v: 1 as const, type: 'output' as const, data: 'hello' },
      { v: 1 as const, type: 'meta' as const, event: 'cursor', payload: { cursor: 42 } },
      { v: 1 as const, type: 'close' as const, code: 1000, reason: 'done' },
    ];
    for (const frame of frames) {
      expect(decodeTerminalFrame(encodeTerminalFrame(frame))).toEqual(frame);
    }
  });

  it('normalizes a client close frame without code', () => {
    expect(decodeTerminalFrame('{"v":1,"type":"close"}')).toEqual({ v: 1, type: 'close', code: 1000 });
  });

  it('rejects malformed, foreign-version and wrongly typed frames', () => {
    expect(decodeTerminalFrame('not json')).toBeNull();
    expect(decodeTerminalFrame('null')).toBeNull();
    expect(decodeTerminalFrame('[]')).toBeNull();
    expect(decodeTerminalFrame('{"v":2,"type":"input","data":"x"}')).toBeNull();
    expect(decodeTerminalFrame('{"type":"input","data":"x"}')).toBeNull();
    expect(decodeTerminalFrame('{"v":1,"type":"nope"}')).toBeNull();
    expect(decodeTerminalFrame('{"v":1,"type":"input"}')).toBeNull();
    expect(decodeTerminalFrame('{"v":1,"type":"resize","cols":0,"rows":30}')).toBeNull();
    expect(decodeTerminalFrame('{"v":1,"type":"resize","cols":120,"rows":-1}')).toBeNull();
    expect(decodeTerminalFrame(Buffer.from('{"v":1,"type":"input","data":"ok"}'))).toEqual({
      v: 1,
      type: 'input',
      data: 'ok',
    });
  });

  it('builds the neutral connect path and parses upgrade URLs', () => {
    expect(terminalConnectPath('p 1')).toBe('/api/terminal/sessions/p%201/connect');
    expect(matchTerminalConnectUrl('/api/terminal/sessions/p1/connect?ticket=tk_1')).toEqual({
      id: 'p1',
      ticket: 'tk_1',
    });
    expect(matchTerminalConnectUrl('/api/terminal/sessions/p1/connect')).toBeNull();
    expect(matchTerminalConnectUrl('/api/terminal/sessions/p1/connect?ticket=')).toBeNull();
    expect(matchTerminalConnectUrl('/api/ws')).toBeNull();
    expect(matchTerminalConnectUrl('/api/terminal/sessions/p1')).toBeNull();
  });

  it('exposes stable close codes for clients', () => {
    expect(TERMINAL_CLOSE_CODES).toEqual({
      badFrame: 4400,
      unauthorized: 4401,
      unsupported: 4503,
      upstream: 4502,
    });
  });
});
