import chalk from 'chalk'
export const theme = {
  accent: (s: string) => chalk.cyan(s),
  dim: (s: string) => chalk.gray(s),
  active: (s: string) => chalk.bgCyan.black(` ${s} `),
  inactive: (s: string) => chalk.gray(` ${s} `),
  ok: (s: string) => chalk.green(s),
  warn: (s: string) => chalk.yellow(s),
  err: (s: string) => chalk.red(s),
  border: (s: string) => chalk.gray(s),
  // 弹层浮面背景：pi-tui compositeOverlays 是文本直叠，overlay 组件必须自带
  // 不透明背景，否则下层 transcript 透出（"弹窗背景透明"问题的修复面）。
  floatBg: (s: string) => chalk.bgAnsi256(235)(s),
}
