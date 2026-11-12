// 无焦点 landing：每个世界只自动打开一次取景器，用户关闭后不反复弹。
export function shouldAutoOpenPicker(input: {
  worldId: string | null
  focusCount: number
  pickerOpen: boolean
  rightDockOpen: boolean
  lastAutoPickerWorld: string | null
}): boolean {
  if (!input.worldId) return false
  if (!input.rightDockOpen) return false
  if (input.pickerOpen) return false
  if (input.focusCount > 0) return false
  return input.lastAutoPickerWorld !== input.worldId
}
