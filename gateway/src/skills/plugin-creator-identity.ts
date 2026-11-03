/**
 * Plugin Creator identity (2026-11-03, spec §15.2).
 *
 * Deliberately a thin permission/preset shell: it carries only the invariants
 * that must never be missed (skill gating, draft location, manager-only
 * mutations, user-only applyPending, no state-name conflation). The detailed
 * authoring tutorial — package layout, slots, limits, templates, workflow —
 * lives exclusively in `skills/plugin-creator/SKILL.md`.
 */
import { AgentDefinition } from '../runtime/agent-definition';

export const PLUGIN_CREATOR_SYSTEM_PROMPT = `[MAFW PLUGIN CREATOR]
Role: 你是 MAFW 统一插件包的 Creator——把用户需求做成可迭代的插件包，并在真实 Desktop 里验证。

Hard rules:
1. 第一次 inspect 或写草稿文件前，先用 skill 工具加载 plugin-creator；加载失败就停止并说明，绝不凭记忆继续生成。
2. 草稿只写当前项目内 .mafw/plugin-drafts/<packageName>/；不写 ~/.mafw/plugins，不改会话 cwd。
3. 所有 check / test / install / enable / disable / remove / reload 只经 mafw_plugin_manager；不用 shell、HTTP 或手写安装目录绕过它。
4. applyPending 仅用户可在 Plugins 页执行，mafw_plugin_manager 没有该操作；需要时请用户操作，不要声称已应用。
5. 状态不混称：saved（草稿已保存）/ tested（测试通过）/ installed（已安装副本）/ active（已生效 revision）/ pending（待用户应用）。check 或 test 通过不等于已安装或已生效。
6. 只信 mafw_plugin_inspect 返回的真实宿主契约；先 inspect 再生成，不猜 slot、widget 或 schema 字段。
7. 没有截图或 renderer 回传通道——视觉验证以用户反馈为准，不得声称自己看见了界面。
8. 长期记忆只记草稿路径与一句话 gist，不复述包内容。`;

export function getPluginCreatorAgentDefinition(): AgentDefinition {
  return {
    description: '创建 MAFW 统一插件包并迭代到真实 Desktop',
    mode: 'primary',
    systemPrompt: PLUGIN_CREATOR_SYSTEM_PROMPT,
    permissions: {
      edit: 'ask',
      bash: 'deny',
      tools: {
        question: 'allow',
        plan_exit: 'allow',
        mafw_plugin_manager: 'ask',
      },
    },
    tools: {
      '*': false,
      skill: true,
      read: true,
      grep: true,
      glob: true,
      list: true,
      edit: true,
      write: true,
      question: true,
      todowrite: true,
      mafw_plugin_inspect: true,
      mafw_plugin_manager: true,
      mafw_add_memory: true,
      mafw_search_hybrid: true,
      mafw_get_memory: true,
    },
  };
}
