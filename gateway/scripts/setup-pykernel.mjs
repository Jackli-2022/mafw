#!/usr/bin/env node
/**
 * Provision the MAFW Python kernel venv with office-editing dependencies.
 *
 * Usage:
 *   node gateway/scripts/setup-pykernel.mjs [--dir <path>] [--python <exe>]
 *
 * - Idempotent: creates ~/.mafw/pykernel once, then refreshes packages.
 * - Installs: ipykernel, numpy, pandas, matplotlib, python-pptx, openpyxl,
 *   python-docx, Pillow.
 * - Copies gateway/scripts/office/mafw_office.py into site-packages so the
 *   persistent kernel can `import mafw_office`.
 * - Print the resulting interpreter path; export it as MAFW_PYTHON_BIN or let
 *   the gateway pick it automatically (default resolution prefers this venv).
 */
import { spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const argOf = (name) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};

const targetDir = argOf('--dir') || process.env.MAFW_PYKERNEL_DIR || path.join(homedir(), '.mafw', 'pykernel');
const isWin = process.platform === 'win32';
const venvPython = isWin ? path.join(targetDir, 'Scripts', 'python.exe') : path.join(targetDir, 'bin', 'python');

function run(cmd, argv, label) {
  process.stderr.write(`[setup-pykernel] ${label ?? `${cmd} ${argv.join(' ')}`}\n`);
  const r = spawnSync(cmd, argv, { stdio: 'inherit', windowsHide: false });
  if (r.error) throw r.error;
  if (r.status !== 0) throw new Error(`${label ?? cmd} exited ${r.status}`);
}

function probe(cmd, argv) {
  const r = spawnSync(cmd, argv, { encoding: 'utf8' });
  return r.status === 0 ? (r.stdout || '').trim() : null;
}

function basePython() {
  if (process.env.MAFW_SYSTEM_PYTHON) return process.env.MAFW_SYSTEM_PYTHON;
  const candidates = isWin
    ? [['python', ['--version']], ['py', ['-3', '--version']]]
    : [['python3', ['--version']], ['python', ['--version']]];
  for (const [cmd, argv] of candidates) {
    if (probe(cmd, argv)) return cmd === 'py' ? 'py' : cmd;
  }
  throw new Error('No Python 3 interpreter found. Set MAFW_SYSTEM_PYTHON to a Python 3.10+ executable.');
}

if (!existsSync(venvPython)) {
  mkdirSync(path.dirname(targetDir), { recursive: true });
  const base = basePython();
  const argv = base === 'py' ? ['-3', '-m', 'venv', targetDir] : ['-m', 'venv', targetDir];
  run(base, argv, `create venv at ${targetDir}`);
}

const version = probe(venvPython, ['-c', 'import sys; print(sys.version.split()[0])']);
process.stderr.write(`[setup-pykernel] venv python ${venvPython} (${version})\n`);

const officePackages = ['python-pptx', 'openpyxl', 'python-docx', 'Pillow', 'pypdfium2'];
// pywin32 powers the optional PowerPoint COM render QA on Windows.
if (isWin) officePackages.push('pywin32');
run(venvPython, [
  '-m', 'pip', 'install', '--disable-pip-version-check',
  'ipykernel', 'numpy', 'pandas', 'matplotlib',
  ...officePackages,
], 'install kernel + office packages');

const site = probe(venvPython, ['-c', "import sysconfig; print(sysconfig.get_paths()['purelib'])"]);
if (site) {
  const src = path.join(here, 'office', 'mafw_office.py');
  if (existsSync(src)) {
    const dest = path.join(site, 'mafw_office.py');
    copyFileSync(src, dest);
    process.stderr.write(`[setup-pykernel] installed helper: ${dest}\n`);
  }
}

process.stdout.write(`${venvPython}\n`);
process.stderr.write('[setup-pykernel] done. Gateway default resolution prefers ~/.mafw/pykernel when present; restart the gateway to pick it up.\n');
