/**
 * One-release re-export shim — Plan 6 Task 5.
 *
 * The opencode Form.Field → canonical question mapping moved to
 * `adapters/opencode/src/form-question.ts` (`@mafw/adapter-opencode`). Gateway
 * call sites keep their old import path until Task 7 removes the shim.
 */
export { expiresAtOf, formAnswerOf, formToQuestion } from '@mafw/adapter-opencode';
export type {
  FormQuestion,
  FormQuestionEnvelope,
  FormQuestionOption,
  FormQuestionWhen,
} from '@mafw/adapter-opencode';
