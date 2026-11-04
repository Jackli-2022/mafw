// 接线契约：thinkingLevelSupported 必须对活 runtime 求值——生产接线永远注入
// setThinkingLevel wrapper（缺 surface 时抛 400），所以不能靠 dep 是否存在判断
// （2026-11-04 终审 Critical：默认 opencode runtime 下菜单 Thinking 行永远可用并在点击后 400）。
import * as fs from 'fs';
import * as path from 'path';

describe('session-config wiring', () => {
  it('supportsThinkingLevel 检查 live runtime 的 setThinkingLevel 表面', () => {
    const src = fs.readFileSync(path.join(__dirname, '../../../src/index.ts'), 'utf8');
    expect(src).toMatch(
      /supportsThinkingLevel:\s*\(\)\s*=>\s*typeof this\.runtime\?\.session\.setThinkingLevel === 'function'/,
    );
  });
});
