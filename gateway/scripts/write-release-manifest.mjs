import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const gatewayRoot = path.resolve(scriptDir, '..');
const repoRoot = path.resolve(gatewayRoot, '..');
const distDir = path.join(gatewayRoot, 'dist');

const rootPkg = JSON.parse(fs.readFileSync(path.join(repoRoot, 'package.json'), 'utf-8').replace(/^\uFEFF/, ''));
const policy = JSON.parse(fs.readFileSync(path.join(gatewayRoot, 'release-policy.json'), 'utf-8').replace(/^\uFEFF/, ''));
const experience = require(path.join(distDir, 'experience', 'experience-contract.js'));
const releaseInfo = require(path.join(distDir, 'release-info.js'));

const metadata = releaseInfo.composeGatewayReleaseMetadata({
  productVersion: rootPkg.version,
  experienceVersion: experience.EXPERIENCE_VERSION,
  minimumClientExperienceVersion: experience.MIN_CLIENT_EXPERIENCE_VERSION,
  schemaEpoch: policy.schemaEpoch,
});

const target = path.join(distDir, 'release.json');
fs.writeFileSync(target, `${JSON.stringify(metadata, null, 2)}\n`, 'utf-8');
console.log(`[release] wrote ${target} (v${metadata.gatewayVersion}, epoch ${metadata.schemaEpoch})`);
