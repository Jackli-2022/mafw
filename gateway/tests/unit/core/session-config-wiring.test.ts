// 接线契约：thinkingLevelSupported 必须经**契约面**判定（RuntimeAccess.can），
// 不得直接摸 runtime 对象属性（契约隔绝；opencode 的推理档位是 model variant，
// 属于 runtime 内部实现，未实现该 surface → 显式降级为不支持）。
import * as fs from 'fs';
import * as path from 'path';

describe('session-config wiring', () => {
  it('supportsThinkingLevel 走 session.setThinkingLevel 契约面', () => {
    const src = fs.readFileSync(path.join(__dirname, '../../../src/index.ts'), 'utf8');
    const idx = src.indexOf('supportsThinkingLevel:');
    expect(idx).toBeGreaterThan(-1);
    const block = src.slice(idx, idx + 400);
    expect(block).toContain("can('session.setThinkingLevel')");
    expect(block).not.toContain('typeof this.runtime?.session.setThinkingLevel');
  });
});
