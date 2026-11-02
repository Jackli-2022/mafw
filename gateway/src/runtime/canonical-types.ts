/**
 * canonical v3 flat 消息/部件类型 —— 兼容导入路径。
 *
 * 事实源已迁至 MAFW View DTO：`packages/gateway-sdk/src/view-dto.ts`
 * （gateway 侧逐字镜像 `./view-dto.generated.ts`，由 `npm run sync:view-dto`
 * 生成，禁止手改）。
 *
 * 本文件只保留既有导入路径的再导出，不再维护第二份接口定义：
 *  - 类型：MafwMessage / MafwPart / MafwPartBase / StopReason 等；
 *  - 守卫：isMafwMessage / isMafwPart（结构校验，非语义校验）。
 *
 * spec: docs/superpowers/specs/2026-11-02-runtime-experience-full-migration-design.md §5
 * 历史 spec: docs/superpowers/specs/2026-10-21-runtime-canonical-v3-design.md §3.1
 */

export type {
  StopReason,
  MafwModelRef,
  MafwPartTime,
  MafwToolClass,
  MafwTokenUsage,
  MafwToolStatus,
  MafwToolState,
  MafwFileSource,
  MafwPartBase,
  MafwPart,
  MafwMessageError,
  MafwDiffStatus,
  MafwDiff,
  MafwMessage,
  MafwSessionStatus,
  MafwSessionRevert,
  MafwSession,
  MafwModel,
  MafwProvider,
  MafwAgentSource,
  MafwAgent,
  MafwSuggestedRule,
  MafwPermissionRequest,
  MafwQuestionOption,
  MafwQuestionInfo,
  MafwQuestionRequest,
  MafwBackgroundJobSource,
  MafwBackgroundJobStatus,
  MafwBackgroundJob,
} from './view-dto.generated';

export { VIEW_DTO_CONTRACT_VERSION, VIEW_DTO_REQUIRED_FIELDS } from './view-dto.generated';
export { isMafwMessage, isMafwPart } from './view-dto.generated';
