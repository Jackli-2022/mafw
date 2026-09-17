/**
 * 自定义命令执行：渲染模板 → promptAsync 到指定会话（或 manager 兜底）。
 * registerCustomCommands 供 loader 重扫后全量替换（先 unregister 旧 custom 再注册新）。
 */
import type { MafwCommandRegistry, MafwCommandHandler } from './registry';
import { renderTemplate, type CustomCommandSpec } from './custom-commands';

export interface CustomCommandExecDeps {
  promptAsync(sessionID: string, text: string): Promise<void>;
  ensureManagerSession(projectDir: string): Promise<string>;
  llmAvailable(): boolean;
  exec(cmd: string): Promise<string>;
  readFile(relPath: string): Promise<string>;
}

export function registerCustomCommands(
  registry: MafwCommandRegistry,
  specs: CustomCommandSpec[],
  deps: CustomCommandExecDeps,
): void {
  // 先清掉旧的 custom 条目（重扫全量替换语义）
  for (const def of registry.list()) {
    if (def.kind === 'custom') registry.unregister(def.name);
  }
  for (const spec of specs) {
    const handler: MafwCommandHandler = async (ctx) => {
      const rendered = await renderTemplate(spec.template, ctx.args, {
        exec: deps.exec,
        readFile: deps.readFile,
      });
      const target = ctx.sessionID || (await deps.ensureManagerSession(ctx.projectDir).catch(() => ''));
      if (!target || !deps.llmAvailable()) {
        return { ok: false, error: 'LLM client not available' };
      }
      await deps.promptAsync(target, rendered);
      return { ok: true, message: `已发送到会话 ${target.slice(0, 12)}（/${spec.name}）` };
    };
    registry.register({
      name: spec.name,
      description: spec.description,
      argumentHint: spec.argumentHint,
      category: 'custom',
      kind: 'custom',
      source: spec.sourceFile,
    }, handler);
  }
}
