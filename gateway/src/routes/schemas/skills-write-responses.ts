/**
 * E10h-R6：skills 写接口（1 个 op）的 200 响应 schema（`RouteDef.response`）。
 *
 * 只声明 OpenAPI 元数据，不做运行时校验；handler 是事实源：
 * `routes/skills.ts` `skills.deopt`。
 *
 * 错误体（404 `{deopted:false,error}` / 500）不属于 200 形态，不在此建模——
 * 注意 404 也带 `deopted:false`，所以 200 上的 `deopted` 是字面量 `true`。
 */
import { Type } from '@sinclair/typebox'

/**
 * `POST /api/skills/:name/deopt`（handler：`routes/skills.ts` `skills.deopt`）。
 *
 * 把已安装 playbook 移出发现范围并暂停 registry 行：效果在下一个发现边界
 * 生效（**不**声称撤回已注入的指令）。`archivedTo` 是归档目录（单文件
 * playbook 没有归档目录时该键被丢掉 → optional）；`reason` 缺省 `manual`。
 */
export const SkillsDeoptResponse = Type.Object({
  deopted: Type.Literal(true),
  archivedTo: Type.Optional(Type.String({ description: 'Archive directory for the deoptimized playbook (absent when nothing was archived).' })),
})
