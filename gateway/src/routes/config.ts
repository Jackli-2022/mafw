/**
 * Phase D1 Task H1 — GET/PUT /api/config（gateway effective config / 落盘覆盖）。
 *
 * handler 体从 index.ts legacy 分支逐字迁移；本模块无 deps：config 是模块级
 * import，两个分支都不读实例状态（live getter 无对象）。readBody → readRouteBody
 * （accepted deviation R3）。PUT 的落盘/热重载/restartRequired 语义逐字保留。
 * Spec: 2026-11-09-gateway-kernel-microkernel-design.md §5.2.
 */
import * as fs from 'fs';
import * as path from 'path';
import * as yaml from 'js-yaml';
import type { IncomingMessage, ServerResponse } from 'http';
import { config } from '../config';
import { log } from '../core/utils/logger';
import { readRouteBody } from './cognition';
import type { RouteRegistry } from './registry';

export function attachConfigRoutes(registry: RouteRegistry): void {
  // GET /api/config —gateway effective config
  registry.attachHandler('config.get', async (_req: IncomingMessage, res: ServerResponse) => {
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify(config.raw));
  });

  // PUT /api/config —persist config overrides to the data-root
  // config.yaml (the same file config.reload() reads), then hot-reload.
  registry.attachHandler('config.set', async (req: IncomingMessage, res: ServerResponse) => {
    try {
      const overrides = JSON.parse(await readRouteBody(req));
      const mafwDir = config.resolvePath();
      const configPath = path.join(mafwDir, 'config.yaml');
      if (!fs.existsSync(mafwDir)) fs.mkdirSync(mafwDir, { recursive: true });
      const yamlStr = yaml.dump(overrides, { indent: 2, lineWidth: 120, noRefs: true, sortKeys: true });
      fs.writeFileSync(configPath, yamlStr, 'utf-8');
      const reload = config.reload();
      if (reload.restartRequired.length > 0) {
        log.warn(`[Config] PUT saved, restart required for: ${reload.restartRequired.join(', ')}`);
      }
      res.writeHead(200);
      res.end(JSON.stringify({ success: true, restartRequired: reload.restartRequired }));
    } catch (err: any) {
      log.error('[Config] PUT error:', err.message);
      res.writeHead(400);
      res.end(JSON.stringify({ error: err.message }));
    }
  });
}
