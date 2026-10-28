/** Result text for a tool part across live and history wire shapes.
 *
 * live (gateway 2.1 translation): state.output is a string.
 * history (opencode 2.1): result text lives in state.content[].text and there
 * is no state.output. Cards should not have to know which path produced it.
 */
export function partOutputText(state: any): string | undefined {
  if (!state) return
  if (typeof state.output === "string" && state.output) return state.output
  if (!Array.isArray(state.content)) return
  const text = state.content
    .filter((part: any) => part && part.type === "text" && typeof part.text === "string")
    .map((part: any) => part.text as string)
    .join("\n")
  return text.trim() ? text : undefined
}
