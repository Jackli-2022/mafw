import { buildMafwToolFactory } from '../../../src/runtime/mafw-tools';
import { MAFW_TOOL_ANNOTATIONS } from '../../../src/runtime/tool-classes';

describe('六件套 factory 注解物化（spec G1/G3，§5.5）', () => {
  it('六件套全部携带 annotations（factory 构造期，单源 = MAFW_TOOL_ANNOTATIONS）', () => {
    const factory = buildMafwToolFactory({ baseUrl: 'http://127.0.0.1:3000' });
    const regs = factory('ses_test');
    expect(regs).toHaveLength(6);
    for (const r of regs) {
      expect(r.annotations).toBeDefined();
      expect(r.annotations).toEqual(MAFW_TOOL_ANNOTATIONS[r.name]);
    }
  });
  it('六件套名字全部登记在注解表（覆盖门）', () => {
    for (const name of ['mafw_add_memory', 'mafw_python', 'mafw_python_restart', 'mafw_media_ask', 'mafw_media_upload', 'mafw_media_speak']) {
      expect(MAFW_TOOL_ANNOTATIONS).toHaveProperty(name);
    }
  });
  it('注册形状不破坏既有消费方（name/description/parameters/execute 仍在）', () => {
    const regs = buildMafwToolFactory({ baseUrl: 'http://127.0.0.1:3000' })('ses_x');
    for (const r of regs) {
      expect(typeof r.name).toBe('string');
      expect(typeof r.description).toBe('string');
      expect(r.parameters).toBeDefined();
      expect(typeof r.execute).toBe('function');
    }
  });
});
