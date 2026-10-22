import { DEFINITIONS, createToolRegistry } from '../../../src/mcp/tool-registry';
import { MAFW_TOOL_ANNOTATIONS } from '../../../src/runtime/tool-classes';

describe('MCP 定义面注解物化（spec G2/G3）', () => {
  it('覆盖门：每个 registry 工具都登记在 MAFW_TOOL_ANNOTATIONS（新工具漏登记即 fail）', () => {
    for (const def of DEFINITIONS) {
      expect(MAFW_TOOL_ANNOTATIONS).toHaveProperty(def.name);
    }
  });
  it('每个定义携带 annotations（构造期物化）', () => {
    for (const def of DEFINITIONS) {
      expect(def.annotations).toBeDefined();
    }
  });
  it('内部一致性：definitions 与 handlers 一一对应（防掉工具/掉 handler）', () => {
    const registry = createToolRegistry();
    const defNames = new Set(DEFINITIONS.map(d => d.name));
    const handlerNames = new Set(Object.keys(registry.handlers));
    expect([...handlerNames].sort()).toEqual([...defNames].sort());
  });
});
