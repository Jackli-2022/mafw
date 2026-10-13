/**
 * SessionStrip 溢出检测纯逻辑——⋯ 溢出菜单（Chrome/VS Code「list all tabs」）
 * 只在 tab 条真的溢出时出现；1px 容差吸收子像素取整。
 */
export function stripOverflowed(el: { scrollWidth: number; clientWidth: number } | null | undefined): boolean {
  if (!el) return false
  return el.scrollWidth > el.clientWidth + 1
}
