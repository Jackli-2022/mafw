// Task 19：Lead 会话里「与 Tech Lead 讨论」邀请条（Goal 处于 discussing 阶段时出现）。
//
// 位置：composer 上方（ChatPane 渲染），只在当前会话是项目 Lead 时由 shell 计算出来。
// 设计契约：按钮/输入一律用 @mafw/ui/v2 组件（不用原生控件与 title 属性）。
import { ButtonV2 } from "@mafw/ui/v2/button-v2"
import { TECH_LEAD_INVITE_LABEL } from "../pod-store"

/**
 * 邀请卡：标题是 Goal 标题（唯一来源），动作打开该 Goal 的 Tech Lead 隐藏会话。
 * 卡片本身不持有 session id——runtime 会话对用户不可见，也不该出现在卡片里。
 */
export function PodTechLeadInvite(props: {
  goalId: string
  title: string
  onOpen: (goalId: string) => void
}) {
  return (
    <div class="mafw-queue-bar mafw-tech-lead-invite" data-goal-id={props.goalId}>
      <span class="mafw-run-count">{props.title}</span>
      <ButtonV2
        variant="outline"
        size="small"
        class="mafw-tech-lead-invite-open"
        onClick={() => props.onOpen(props.goalId)}
      >
        {TECH_LEAD_INVITE_LABEL}
      </ButtonV2>
    </div>
  )
}
