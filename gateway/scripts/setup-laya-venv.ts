// Provision ~/.mafw/laya: venv + pip install laya + sidecar copy + selftest.
// Run: npx ts-node scripts/setup-laya-venv.ts   (from gateway/)
import { execSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

const home = path.join(os.homedir(), '.mafw', 'laya');
const venvPy = path.join(home, '.venv', 'Scripts', 'python.exe');
const srcScript = path.join(__dirname, 'laya-serve-conflict.py');
const dstScript = path.join(home, 'laya-serve-conflict.py');

function run(cmd: string, opts: { env?: NodeJS.ProcessEnv } = {}): void {
  console.log(`> ${cmd}`);
  execSync(cmd, { stdio: 'inherit', env: { ...process.env, ...opts.env } });
}

fs.mkdirSync(home, { recursive: true });
if (!fs.existsSync(venvPy)) {
  console.log('[1/4] creating venv (torch download is ~2GB, first run takes minutes)...');
  run(`python -m venv "${path.join(home, '.venv')}"`);
} else {
  console.log('[1/4] venv exists');
}
console.log('[2/4] pip install laya (tuna mirror primary, direct PyPI fallback)...');
const pip = path.join(home, '.venv', 'Scripts', 'pip.exe');
const mirror = process.env.PIP_INDEX_URL || 'https://pypi.tuna.tsinghua.edu.cn/simple';
try {
  run(`"${pip}" install laya -i ${mirror}`);
} catch {
  console.log('mirror failed, retrying via direct PyPI...');
  run(`"${pip}" install laya`);
}
console.log('[3/4] copying sidecar script...');
fs.copyFileSync(srcScript, dstScript);
console.log('[4/4] selftest (downloads checkpoint via hf-mirror on first run)...');
run(`"${venvPy}" "${dstScript}" --selftest`, { env: { HF_ENDPOINT: 'https://hf-mirror.com' } });
console.log(`\nDone. Gateway will auto-spawn the sidecar on next start (~/.mafw/laya).`);
