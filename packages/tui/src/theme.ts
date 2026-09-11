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
}
