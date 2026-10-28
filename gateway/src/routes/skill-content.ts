// gateway/src/routes/skill-content.ts
// B3（W4 v1）：技能详情（SKILL.md 内容）——只读。
// GET /api/skill/content?directory=&id=<skillId>
//
// 分层（2026-10-28 架构修正）：
//   1) 优先走 runtime discovery 通道（RuntimeDiscoveryChannel.loadSkill）——
//      runtime 自己知道技能如何读取（opencode /api/skill/:key 等），gateway 不碰格式。
//   2) 回退：id 必须命中 listSkills() 结果，再按 location 读文件（MAFW 本地技能、
//      以及 runtime 未提供 loadSkill 的情况）。不存在 → 404，绝不按任意路径读盘。
import * as http from 'http';
import type { RuntimeSkillContent } from '../runtime/contract';

export const SKILL_CONTENT_MAX_BYTES = 256 * 1024;

export interface SkillContentDeps {
  /** 可选：runtime discovery 通道（缺失/false → 回退文件读取）。 */
  loadSkill?(opts: { directory: string; key: string }): Promise<RuntimeSkillContent | null>;
  listSkills(directory?: string): Promise<Array<{ id: string; name?: string; location?: string; contentLength?: number }>>;
  readFile(path: string): string;
}

function json(res: http.ServerResponse, status: number, payload: any): void {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(payload));
}

function tooLarge(content: string): boolean {
  return Buffer.byteLength(content, 'utf-8') > SKILL_CONTENT_MAX_BYTES;
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
    // 1) runtime 通道（需要 directory 才能定位技能域）
    if (deps.loadSkill && directory) {
      try {
        const viaRuntime = await deps.loadSkill({ directory, key: id });
        if (viaRuntime?.content) {
          if (tooLarge(viaRuntime.content)) { json(res, 413, { error: 'skill content too large' }); return true; }
          json(res, 200, {
            id: viaRuntime.id ?? id,
            name: viaRuntime.name ?? id,
            location: viaRuntime.location ?? '',
            content: viaRuntime.content,
          });
          return true;
        }
      } catch { /* fall through to whitelist file read */ }
    }

    // 2) 白名单回退（MAFW 本地技能 / runtime 无 loadSkill）
    const skills = await deps.listSkills(directory);
    const hit = skills.find((s) => s.id === id);
    if (!hit || !hit.location) { json(res, 404, { error: `skill not found: ${id}` }); return true; }
    const content = deps.readFile(hit.location);
    if (tooLarge(content)) { json(res, 413, { error: 'skill content too large' }); return true; }
    json(res, 200, { id: hit.id, name: hit.name ?? hit.id, location: hit.location, content });
  } catch (err: any) {
    json(res, 500, { error: err?.message ?? String(err) });
  }
  return true;
}
