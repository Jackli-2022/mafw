// gateway/tests/unit/skill-content-route.test.ts
// B3（W4 v1）：技能详情——GET /api/skill/content?directory=&id=（白名单：只读列表内的 location）。
import * as http from 'http';
import { handleSkillContent } from '../../src/routes/skill-content';

function makeRes() {
  const out = { status: 0, body: '' as any };
  const res = {
    writeHead(status: number) { out.status = status; },
    end(body?: string) { out.body = body ? JSON.parse(body) : null; },
    setHeader() {},
  } as unknown as http.ServerResponse;
  return { res, out };
}

const SKILLS = [
  { id: 'vision-tools', name: 'vision-tools', description: 'd', scope: 'user', location: 'C:/skills/vision-tools/SKILL.md', contentLength: 10 },
  { id: 'typesafe-ai', name: 'typesafe-ai', description: 'd', scope: 'user', location: 'C:/skills/typesafe-ai/SKILL.md', contentLength: 20 },
];

function makeDeps() {
  const reads: string[] = [];
  return {
    reads,
    deps: {
      listSkills: async (_dir?: string) => SKILLS,
      readFile: (p: string) => { reads.push(p); return `CONTENT:${p}`; },
    },
  };
}

describe('GET /api/skill/content', () => {
  it('runtime discovery 通道可用 → 优先用 runtime 内容（不读文件）', async () => {
    const { deps, reads } = makeDeps();
    const { res, out } = makeRes();
    const handled = await handleSkillContent(
      { method: 'GET' } as http.IncomingMessage,
      res,
      '/api/skill/content?directory=D%3A%5Cp&id=vision-tools',
      {
        ...deps,
        loadSkill: async (opts) => ({
          id: opts.key,
          name: opts.key,
          description: 'd',
          contentLength: 12,
          location: 'runtime://vision-tools',
          content: 'RUNTIME-CONTENT',
        }),
      },
    );
    expect(handled).toBe(true);
    expect(out.status).toBe(200);
    expect(out.body.content).toBe('RUNTIME-CONTENT');
    expect(out.body.location).toBe('runtime://vision-tools');
    expect(reads).toHaveLength(0);
  });

  it('runtime 返回 null / 抛错 → 回退白名单文件读取', async () => {
    const { deps, reads } = makeDeps();
    const r1 = makeRes();
    await handleSkillContent(
      { method: 'GET' } as http.IncomingMessage,
      r1.res,
      '/api/skill/content?directory=D%3A%5Cp&id=vision-tools',
      { ...deps, loadSkill: async () => null },
    );
    expect(r1.out.body.content).toBe('CONTENT:C:/skills/vision-tools/SKILL.md');
    const r2 = makeRes();
    await handleSkillContent(
      { method: 'GET' } as http.IncomingMessage,
      r2.res,
      '/api/skill/content?directory=D%3A%5Cp&id=vision-tools',
      { ...deps, loadSkill: async () => { throw new Error('404'); } },
    );
    expect(r2.out.body.content).toBe('CONTENT:C:/skills/vision-tools/SKILL.md');
    expect(reads).toHaveLength(2);
  });

  it('已知 id → 返回内容 + location', async () => {
    const { deps, reads } = makeDeps();
    const { res, out } = makeRes();
    const handled = await handleSkillContent({ method: 'GET' } as http.IncomingMessage, res, '/api/skill/content?directory=D%3A%5Cp&id=vision-tools', deps);
    expect(handled).toBe(true);
    expect(out.status).toBe(200);
    expect(out.body.id).toBe('vision-tools');
    expect(out.body.content).toBe('CONTENT:C:/skills/vision-tools/SKILL.md');
    expect(reads).toEqual(['C:/skills/vision-tools/SKILL.md']);
  });
  it('未知 id → 404（绝不按路径直读）', async () => {
    const { deps, reads } = makeDeps();
    const { res, out } = makeRes();
    await handleSkillContent({ method: 'GET' } as http.IncomingMessage, res, '/api/skill/content?id=../etc/passwd', deps);
    expect(out.status).toBe(404);
    expect(reads).toHaveLength(0);
  });
  it('缺 id → 400', async () => {
    const { deps } = makeDeps();
    const { res, out } = makeRes();
    await handleSkillContent({ method: 'GET' } as http.IncomingMessage, res, '/api/skill/content?directory=x', deps);
    expect(out.status).toBe(400);
  });
  it('读失败 → 500', async () => {
    const { deps } = makeDeps();
    const depsBad = { ...deps, readFile: () => { throw new Error('EACCES'); } };
    const { res, out } = makeRes();
    await handleSkillContent({ method: 'GET' } as http.IncomingMessage, res, '/api/skill/content?id=vision-tools', depsBad);
    expect(out.status).toBe(500);
  });
  it('不匹配路径 → handled=false', async () => {
    const { deps } = makeDeps();
    const { res } = makeRes();
    expect(await handleSkillContent({ method: 'GET' } as http.IncomingMessage, res, '/api/skill/other', deps)).toBe(false);
  });
});
