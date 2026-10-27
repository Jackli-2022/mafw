// 预览批注锚点纯逻辑（spec 2026-10-27 预览批注）：卡片标签 / 发送文本块 / JSON 路径 / A1 单元格 / 坐标换算。
import type { AnnotationAnchor } from "../../shared/annotation-types"

const pct = (n: number): number => Math.round(n * 100)
const fmtPct = (n: number): string => `${pct(n)}%`

/** 批注卡上的位置标签（行号锚不走这里）。 */
export function describeAnchor(a: AnnotationAnchor): string {
  switch (a.kind) {
    case "cell":
      return a.ref
    case "jsonPath":
      return a.path
    case "region":
      return `区域 ${pct(a.x)}%,${pct(a.y)}%`
    case "quote": {
      const q = a.quote.slice(0, 9)
      return `节选「${q}${a.quote.length > 9 ? "…" : ""}」`
    }
  }
}

/** 发送打包时的位置描述行（不含「我的批注」）。 */
export function anchorBlockLines(rel: string, a: AnnotationAnchor, opts?: { hasImage?: boolean }): string[] {
  switch (a.kind) {
    case "quote":
      return [`文件 \`${rel}\` 节选（渲染预览）：`, "", `> ${a.quote.replace(/\r?\n/g, "\n> ")}`]
    case "jsonPath":
      return [`文件 \`${rel}\` 路径 \`${a.path}\`（当前值：\`${a.valueSummary}\`）：`]
    case "cell":
      return [
        a.sheet
          ? `文件 \`${rel}\` 工作表「${a.sheet}」单元格 \`${a.ref}\`（当前值：\`${a.value}\`）：`
          : `文件 \`${rel}\` 单元格 \`${a.ref}\`（当前值：\`${a.value}\`）：`,
      ]
    case "region": {
      const size = a.w > 0 || a.h > 0 ? `, ${fmtPct(a.w)}×${fmtPct(a.h)}` : ""
      const pos = `(${fmtPct(a.x)}, ${fmtPct(a.y)}${size})`
      if (a.slide) return [`文件 \`${rel}\` 第 ${a.slide} 页 ${pos}：`]
      // I5：草稿重启后截图不落盘——没图就不能声称「见附件」。
      if (opts?.hasImage === false) return [`图片 \`${rel}\` 区域 ${pos}：（截图未保存，仅坐标）`]
      return [`图片 \`${rel}\` 区域 ${pos}：截图见附件`]
    }
  }
}

const IDENT = /^[A-Za-z_$][A-Za-z0-9_$]*$/

/** 数组/对象路径 → `$.a.b[0]`；特殊键走 JSON 字符串转义。 */
export function jsonPathOf(path: (string | number)[]): string {
  let out = "$"
  for (const seg of path) {
    if (typeof seg === "number") {
      out += `[${seg}]`
    } else if (IDENT.test(seg)) {
      out += `.${seg}`
    } else {
      out += `.${JSON.stringify(seg)}`
    }
  }
  return out
}

/** 1-based 行列 → A1 引用（col 27 → AA）。 */
export function a1Ref(row: number, col: number): string {
  let n = Math.max(1, Math.floor(col))
  let letters = ""
  while (n > 0) {
    const rem = (n - 1) % 26
    letters = String.fromCharCode(65 + rem) + letters
    n = Math.floor((n - 1) / 26)
  }
  return `${letters}${Math.max(1, Math.floor(row))}`
}
