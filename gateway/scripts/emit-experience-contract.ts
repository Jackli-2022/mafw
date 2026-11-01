/**
 * Experience Contract JSON emitter（GET /api/experience/actions 的静态契约面）。
 * 生成物只由本脚本更新；禁止手改。
 */
import * as fs from 'fs';
import * as path from 'path';
import { buildExperienceContractManifest } from '../src/experience/experience-contract';

const out = path.resolve(__dirname, '..', '..', 'packages', 'gateway-sdk', 'contract', 'experience-contract.json');
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, JSON.stringify(buildExperienceContractManifest(), null, 2) + '\n');
console.log(`[emit-experience-contract] ${out}`);
