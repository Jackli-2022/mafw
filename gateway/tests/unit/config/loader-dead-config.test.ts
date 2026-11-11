/**
 * E1-6 死配置清理（spec §E1-6 / A9）：`maxMemoriesPerTier`。
 *
 * 该键只存在于类型与 loader 默认值，零消费者。清理契约：
 *  1. 旧配置里带这个键仍能加载（不报错、邻居字段照常解析）；
 *  2. loader 的**默认配置**不再包含它（不再"提供"死字段）；
 *  3. 代码里 0 命中（类型 + loader；归档文档不算）。
 *
 * 说明（选择记录）：计划原始形态是 `tests/types/no-dead-config.ts` 的
 * `@ts-expect-error` 编译期断言，但 gateway 的 tsc 门 `include: ["src/**\/*"]`
 * 不覆盖 tests/，而 ts-jest 跑测试时 `diagnostics: false` —— 编译期断言在那两
 * 条门里都不会被执行。这里改用**运行时 loader 断言 + 源码 grep 守卫**（计划
 * 允许的替代方案），两条都落在 `npm test` 的默认门内。
 */
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { ConfigLoader } from '../../../src/core/utils/config-loader';

const REPO_ROOT = path.resolve(__dirname, '../../../..');
const CODE_FILES = [
  path.join(REPO_ROOT, 'gateway/src/core/types/config.d.ts'),
  path.join(REPO_ROOT, 'gateway/src/core/utils/config-loader.ts'),
  path.join(REPO_ROOT, 'src/types/config.d.ts'),
];

describe('ConfigLoader: maxMemoriesPerTier 死键（E1-6）', () => {
  const savedHome = process.env.HOME;
  const savedUserProfile = process.env.USERPROFILE;
  let home: string;

  beforeEach(() => {
    home = fs.mkdtempSync(path.join(os.tmpdir(), 'mafw-dead-config-'));
    process.env.HOME = home;
    process.env.USERPROFILE = home;
    ConfigLoader.reset();
  });

  afterEach(() => {
    ConfigLoader.reset();
    if (savedHome === undefined) delete process.env.HOME; else process.env.HOME = savedHome;
    if (savedUserProfile === undefined) delete process.env.USERPROFILE; else process.env.USERPROFILE = savedUserProfile;
    fs.rmSync(home, { recursive: true, force: true });
  });

  it('旧配置含 maxMemoriesPerTier 时仍正常加载（不报错，邻居字段生效）', () => {
    const mafwDir = path.join(home, '.mafw');
    fs.mkdirSync(mafwDir, { recursive: true });
    fs.writeFileSync(
      path.join(mafwDir, 'config.json'),
      JSON.stringify({
        memory: { maxMemoriesPerTier: 1234, mergeSimilarityThreshold: 0.91 },
        logging: { level: 'debug' },
      }),
      'utf8',
    );

    const loader = ConfigLoader.getInstance(path.join(home, 'project'));
    expect(loader.get('memory.mergeSimilarityThreshold')).toBe(0.91);
    expect(loader.get('logging.level')).toBe('debug');
    // 旧键被容忍（深合并原样保留，但没有任何消费者/默认值）。
    expect(loader.get('memory.maxMemoriesPerTier')).toBe(1234);
  });

  it('默认配置不再提供 maxMemoriesPerTier（死键已清除）', () => {
    const loader = ConfigLoader.getInstance(path.join(home, 'project'));
    const memory = loader.getAll().memory as Record<string, unknown>;
    expect(Object.prototype.hasOwnProperty.call(memory, 'maxMemoriesPerTier')).toBe(false);
    expect(loader.get('memory.maxMemoriesPerTier')).toBeUndefined();
  });

  it('代码（类型 + loader）0 命中', () => {
    for (const file of CODE_FILES) {
      expect(fs.existsSync(file)).toBe(true);
      expect(fs.readFileSync(file, 'utf8')).not.toContain('maxMemoriesPerTier');
    }
  });
});
