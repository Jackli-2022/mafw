export interface ScrollPinInput {
  /** scrollTop of the previous scroll event / last programmatic pin write */
  prevScrollTop: number
  scrollTop: number
  scrollHeight: number
  clientHeight: number
  snapThreshold: number
}

export function scrollPinDecision(input: ScrollPinInput): boolean {
  const distFromBottom = input.scrollHeight - input.scrollTop - input.clientHeight
  const scrolledUp = input.scrollTop < input.prevScrollTop
  if (scrolledUp && distFromBottom > 0) return false
  return distFromBottom < input.snapThreshold
}