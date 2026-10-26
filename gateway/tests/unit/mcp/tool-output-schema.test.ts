import { createToolRegistry } from '../../../src/mcp/tool-registry';

describe('MCP tool outputSchema coverage', () => {
  it('every exposed tool has an object outputSchema', () => {
    const { definitions } = createToolRegistry();
    expect(definitions.length).toBeGreaterThan(30);
    for (const d of definitions) {
      expect(d.outputSchema).toBeDefined();
      expect(d.outputSchema!.type).toBe('object');
    }
  });

  it('first-batch tools keep bespoke schemas', () => {
    const { definitions } = createToolRegistry();
    for (const name of ['mafw_search_hybrid', 'mafw_get_memory', 'mafw_list_goals']) {
      const d = definitions.find((x) => x.name === name)!;
      expect(d.outputSchema).toBeDefined();
      expect((d.outputSchema as any).additionalProperties).not.toBe(true);
    }
  });
});
