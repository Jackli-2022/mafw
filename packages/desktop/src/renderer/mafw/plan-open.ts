export type PlanOpenRequest = {
  nonce: number
  goalId: string
}

/** 决定板的“批准计划”只对目标 Goal 生效，且同一 nonce 只消费一次。 */
export function shouldOpenPlan(
  request: PlanOpenRequest | null | undefined,
  goalId: string | null,
  lastNonce: number,
): boolean {
  return !!request && !!goalId && request.goalId === goalId && request.nonce !== lastNonce
}
