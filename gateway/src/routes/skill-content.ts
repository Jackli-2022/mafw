// gateway/src/routes/skill-content.ts
// B3（W4 v1）：技能详情（SKILL.md 内容）——只读列表白名单内的 location。
// GET /api/skill/content?directory=&id=<skillId>
// 安全边界：id 必须命中 listSkills() 结果；不存在 → 404（绝不按任意路径读盘）。
import * as http from 'http';

export const SKILL_CONTENT_MAX_BYTES = 256 * 1024;

export interface SkillContentDeps {
  listSkills(directory?: string): Promise<Array<{ id: string; name?: string; location?: string; contentLength?: number }>>;
  readFile(path: string): string;
}

function json(res: http.ServerResponse, status: number, payload: any): void {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(payload));
}

export async function handleSkillContent(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  url: string,
  deps: SkillContentDeps,
): Promise<boolean> {
  const m = url.match(/^\/api\/skill\/content(?:\?|$)/);
  if (!m || req.method !== 'GET') return false;
  const u = new URL(url, 'http://localhost');
  const id = (u.searchParams.get('id') ?? '').trim();
  const directory = u.searchParams.get('directory') ?? undefined;
  if (!id) { json(res, 400, { error: 'id is required' }); return true; }
  try {
    const skills = await deps.listSkills(directory);
    const hit = skills.find((s) => s.id === id);
    if (!hit || !hit.location) { json(res, 404, { error: `skill not found: ${id}` }); return true; }
    const content = deps.readFile(hit.location);
    if (Buffer.byteLength(content, 'utf-8') > SKILL_CONTENT_MAX_BYTES) {
      json(res, 413, { error: 'skill content too large' });
      return true;
    }
    json(res, 200, { id: hit.id, name: hit.name ?? hit.id, location: hit.location, content });
  } catch (err: any) {
    json(res, 500, { error: err?.message ?? String(err) });
  }
  return true;
}
