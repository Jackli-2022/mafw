import * as fs from 'fs';
import * as path from 'path';
import { DEFINITIONS, createToolRegistry } from '../../../src/mcp/tool-registry';
import { MAFW_TOOL_ANNOTATIONS } from '../../../src/runtime/tool-classes';
import { getManagerAgentDefinition } from '../../../src/skills/manager-agent-config';

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

describe('human-only 面：MCP 不提供代答工具（E7 review）', () => {
  it('mafw_answer_question 不在定义面 / handler 表', () => {
    const registry = createToolRegistry();
    expect(DEFINITIONS.map(d => d.name)).not.toContain('mafw_answer_question');
    expect(registry.definitions.map(d => d.name)).not.toContain('mafw_answer_question');
    expect(registry.handlers).not.toHaveProperty('mafw_answer_question');
  });

  it('handler 源文件已删除（防止重新接线 impersonation 路径）', () => {
    const handlerPath = path.resolve(__dirname, '../../../src/mcp/handlers/manager-answer-question.ts');
    expect(fs.existsSync(handlerPath)).toBe(false);
  });

  it('manager agent allowlist 不再放行该工具', () => {
    const def = getManagerAgentDefinition();
    expect(def.permissions?.tools).not.toHaveProperty('mafw_answer_question');
  });
});
