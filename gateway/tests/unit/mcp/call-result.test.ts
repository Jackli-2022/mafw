import { toCallToolResult } from '../../../src/mcp/call-result';

describe('toCallToolResult（CallTool 出口单一映射，spec G4）', () => {
  it('纯 content 恒等透传（今日行为不变）', () => {
    const r = { content: [{ type: 'text', text: 'ok' }] };
    expect(toCallToolResult(r)).toEqual(r);
  });
  it('structuredContent 透传（MCP 双载荷：content + structuredContent）', () => {
    const r = { content: [{ type: 'text', text: '{}' }], structuredContent: { success: true } };
    const out = toCallToolResult(r);
    expect(out.structuredContent).toEqual({ success: true });
    expect(out.content).toEqual(r.content); // content 不丢
  });
  it('isError 透传', () => {
    const r = { content: [{ type: 'text', text: 'e' }], isError: true };
    expect(toCallToolResult(r).isError).toBe(true);
  });
  it('无 structuredContent 时输出无该键（老消费方形状不变）', () => {
    const out = toCallToolResult({ content: [{ type: 'text', text: 'x' }] });
    expect('structuredContent' in out).toBe(false);
  });
  it('JSON object text 自动提升 structuredContent（同源）', () => {
    const out = toCallToolResult({ content: [{ type: 'text', text: '{"success":true,"count":2}' }] });
    expect(out.structuredContent).toEqual({ success: true, count: 2 });
  });
  it('JSON array/primitive 包成 object 形 structuredContent', () => {
    expect(toCallToolResult({ content: [{ type: 'text', text: '[1,2]' }] }).structuredContent).toEqual({ items: [1, 2] });
    expect(toCallToolResult({ content: [{ type: 'text', text: '42' }] }).structuredContent).toEqual({ value: 42 });
  });
});
