/**
 * Phase 6 plugin doctor: read-only diagnostics for one installed package.
 *
 * It never changes package state and never dry-runs activation for a package
 * that is quarantined or running under safe mode. The report is designed for
 * both the desktop Plugins page and `mafw plugins doctor`.
 */
import * as fs from 'fs';
import * as path from 'path';
import type { PluginHost } from './package-host';
import type { NormalizedPackageManifest } from './package-manifest';
import { parsePackageManifest, isHostRangeCompatible } from './package-manifest';
import { fingerprintPackage } from './package-fingerprint';
import { verifyDeclaredIntegrity } from './package-integrity';
import type { PackageStateStore } from './package-state-store';

export interface PluginDoctorCheck {
  id: string;
  status: 'pass' | 'warn' | 'fail';
  message: string;
  fix?: string;
}

export interface PluginDoctorReport {
  name: string;
  version?: string;
  apiVersion: number;
  kind: 'trusted' | 'untrusted' | 'unknown';
  fingerprint?: string;
  ok: boolean;
  checks: PluginDoctorCheck[];
  generatedAt: string;
}

export interface PluginDoctorDeps {
  pluginDir: string;
  host: Pick<PluginHost, 'checkPackage' | 'getState'>;
  state: PackageStateStore;
  hostVersion: string;
  /** Optional override for tests/diagnostics; defaults to the installed contract. */
  contractVersion?: string;
}

const NAME_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

function expectedContractVersion(): string {
  try {
    return String(require('@mafw/plugin-contract/package.json').version ?? '0.0.0');
  } catch {
    return '0.0.0';
  }
}

function check(
  id: string,
  status: PluginDoctorCheck['status'],
  message: string,
  fix?: string,
): PluginDoctorCheck {
  return { id, status, message, ...(fix !== undefined ? { fix } : {}) };
}

export class PluginDoctor {
  constructor(private readonly deps: PluginDoctorDeps) {}

  async check(name: string): Promise<PluginDoctorReport> {
    const checks: PluginDoctorCheck[] = [];
    if (!NAME_PATTERN.test(name) || /[. ]$/.test(name)) {
      return {
        name,
        apiVersion: 0,
        kind: 'unknown',
        ok: false,
        checks: [check('manifest', 'fail', `invalid package name: ${name}`)],
        generatedAt: new Date().toISOString(),
      };
    }

    const dir = path.join(this.deps.pluginDir, name);
    const file = path.join(this.deps.pluginDir, `${name}.js`);
    const isFile = !fs.existsSync(dir) && fs.existsSync(file);
    const isDir = fs.existsSync(dir);

    let raw: unknown;
    let rawReadError: string | undefined;
    if (isDir) {
      try {
        raw = JSON.parse(fs.readFileSync(path.join(dir, 'plugin.json'), 'utf-8'));
      } catch (err: any) {
        rawReadError = err?.code === 'ENOENT'
          ? 'plugin.json not found'
          : `plugin.json is unreadable: ${err?.message ?? String(err)}`;
      }
    } else if (isFile) {
      raw = { name, version: '0.0.0', main: path.basename(file) };
    } else {
      rawReadError = `package not found: ${name}`;
    }

    const parsed = rawReadError === undefined ? parsePackageManifest(raw) : null;
    const manifest: NormalizedPackageManifest | undefined = parsed?.manifest;
    const rawRecord = raw && typeof raw === 'object' && !Array.isArray(raw)
      ? raw as Record<string, unknown>
      : undefined;

    // 1. manifest
    if (isFile) {
      checks.push(check(
        'manifest',
        'warn',
        'legacy single-file package; tools, observers and http are denied without plugin.json',
      ));
    } else if (rawReadError) {
      checks.push(check('manifest', 'fail', rawReadError, 'restore a valid plugin.json'));
    } else if (parsed && !parsed.ok) {
      checks.push(check('manifest', 'fail', parsed.errors.join('; ')));
    } else {
      checks.push(check('manifest', 'pass', 'plugin.json is valid'));
    }

    // 1b. manifest-warnings
    // `parsePackageManifest` keeps non-fatal findings (legacy-permissions /
    // legacy-contributes) out of `errors` so legacy packages still load. They
    // are diagnostic-only: recording them as `warn` keeps `report.ok` untouched
    // (it is derived from `fail` statuses alone) while making them visible.
    if (parsed?.ok && parsed.warnings.length > 0) {
      checks.push(check('manifest-warnings', 'warn', parsed.warnings.join('; ')));
    }

    // 1c. contributes-desktop
    // The contract validates the shape of `contributes.desktop`, but this host
    // has no execution point for it (desktop loads `ui` from the client
    // snapshot). Surface the gap instead of implying it is enforced.
    if (manifest?.contributes?.desktop !== undefined) {
      checks.push(check(
        'contributes-desktop',
        'warn',
        'desktop contributions are declared but not enforced by this host',
      ));
    }

    // 2. api-version
    const rawApiVersion = rawRecord?.apiVersion;
    if (rawApiVersion === undefined || rawApiVersion === 1 || rawApiVersion === 2) {
      checks.push(check('api-version', 'pass', `apiVersion ${rawApiVersion ?? 1}`));
    } else {
      checks.push(check('api-version', 'fail', `unsupported apiVersion: ${String(rawApiVersion)}`));
    }

    // 3. host-range
    if (!manifest?.host) {
      checks.push(check('host-range', 'pass', 'no host range declared'));
    } else if (isHostRangeCompatible(manifest.host, this.deps.hostVersion)) {
      checks.push(check('host-range', 'pass', `host ${manifest.host}`));
    } else {
      checks.push(check('host-range', 'fail', `host range ${manifest.host} does not include ${this.deps.hostVersion}`));
    }

    // 4. entry
    if (!manifest) {
      checks.push(check('entry', 'fail', 'cannot resolve entry without a manifest'));
    } else {
      const entry = isFile ? file : path.join(dir, manifest.main);
      if (fs.existsSync(entry) && fs.statSync(entry).isFile()) {
        checks.push(check('entry', 'pass', manifest.main));
      } else {
        checks.push(check('entry', 'fail', `entry file not found: ${manifest.main}`));
      }
    }

    // 5. permissions
    if (!manifest) {
      checks.push(check('permissions', 'fail', 'cannot resolve permissions without a manifest'));
    } else if (manifest.apiVersion === 1) {
      checks.push(check('permissions', 'warn', 'legacy package: permissions are informational only'));
    } else if (manifest.permissions.length === 0) {
      checks.push(check('permissions', 'warn', 'no permissions declared'));
    } else {
      checks.push(check('permissions', 'pass', manifest.permissions.join(', ')));
    }

    // 6. integrity
    if (manifest?.integrity) {
      const result = verifyDeclaredIntegrity(isFile ? file : dir, manifest.integrity);
      checks.push(result.ok
        ? check('integrity', 'pass', 'declared integrity matches')
        : check('integrity', 'fail', result.errors.join('; '), 'rebuild the package or update plugin.json'));
    } else if (manifest && isDir) {
      const installed = this.deps.state.getInstalled(name);
      if (!installed) {
        checks.push(check('integrity', 'pass', 'no integrity baseline yet'));
      } else {
        try {
          const fingerprint = fingerprintPackage(
            path.join(dir, manifest.main),
            { rootDir: dir },
          );
          const matches = fingerprint === installed.fingerprint;
          if (matches) checks.push(check('integrity', 'pass', 'content fingerprint matches'));
          else if (manifest.kind === 'untrusted') {
            checks.push(check('integrity', 'fail', 'untrusted package changed on disk', 'reinstall or unquarantine explicitly'));
          } else {
            checks.push(check('integrity', 'warn', 'content fingerprint changed (trusted hot reload)'));
          }
        } catch (err: any) {
          checks.push(check('integrity', 'fail', `fingerprint failed: ${err?.message ?? String(err)}`));
        }
      }
    } else {
      checks.push(check('integrity', 'pass', 'no directory integrity baseline'));
    }

    // 7. state
    const quarantine = this.deps.state.getQuarantine(name);
    if (quarantine) {
      checks.push(check('state', 'fail', `quarantined: ${quarantine.reason}`));
    } else if (this.deps.state.isSafeMode()) {
      checks.push(check('state', 'warn', 'safe mode is active'));
    } else if (this.deps.state.isDisabled(name)) {
      checks.push(check('state', 'warn', 'package is disabled'));
    } else {
      checks.push(check('state', 'pass', 'enabled'));
    }

    // 8. collision
    const states = this.deps.host.getState().filter((entry) => entry.name === name);
    const duplicate = states.length > 1;
    checks.push(duplicate
      ? check('collision', 'fail', 'package name collides with another installed entry')
      : check('collision', 'pass', 'no name collision'));

    // 9. activation
    const earlierFailure = checks.some((item) => item.status === 'fail');
    const blocked = this.deps.state.isSafeMode() || Boolean(quarantine);
    if (earlierFailure || blocked || !manifest) {
      checks.push(check('activation', 'warn', 'not checked: fix earlier findings or leave isolation first'));
    } else {
      try {
        const result = await this.deps.host.checkPackage(isFile ? file : dir);
        checks.push(result.ok
          ? check('activation', 'pass', 'activation dry-run succeeded')
          : check('activation', 'fail', result.error ?? 'activation dry-run failed'));
      } catch (err: any) {
        checks.push(check('activation', 'fail', `activation dry-run failed: ${err?.message ?? String(err)}`));
      }
    }

    // 10. last-error
    const lastError = states.find((entry) => entry.status === 'error' || entry.pendingRevision);
    checks.push(lastError
      ? check('last-error', 'warn', lastError.error ?? 'pending candidate revision')
      : check('last-error', 'pass', 'no recorded activation error'));

    // 11. deprecation
    checks.push(manifest?.deprecated
      ? check('deprecation', 'warn', manifest.deprecated)
      : check('deprecation', 'pass', 'not deprecated'));

    // 12. contract-skew
    if (this.deps.contractVersion !== undefined) {
      const expected = expectedContractVersion();
      checks.push(this.deps.contractVersion === expected
        ? check('contract-skew', 'pass', `contract ${expected}`)
        : check('contract-skew', 'warn', `contract ${this.deps.contractVersion} != host ${expected}`));
    } else {
      checks.push(check('contract-skew', 'pass', 'not checked'));
    }

    let fingerprint: string | undefined;
    if (manifest && isDir) {
      try {
        fingerprint = fingerprintPackage(path.join(dir, manifest.main), { rootDir: dir });
      } catch { /* entry failure is already reported */ }
    }

    return {
      name,
      ...(manifest?.version !== undefined ? { version: manifest.version } : {}),
      apiVersion: manifest?.apiVersion ?? (typeof rawApiVersion === 'number' ? rawApiVersion : 0),
      kind: manifest?.kind ?? 'unknown',
      ...(fingerprint !== undefined ? { fingerprint } : {}),
      ok: !checks.some((item) => item.status === 'fail'),
      checks,
      generatedAt: new Date().toISOString(),
    };
  }

  async checkAll(): Promise<PluginDoctorReport[]> {
    let entries: fs.Dirent[] = [];
    try {
      entries = fs.readdirSync(this.deps.pluginDir, { withFileTypes: true });
    } catch {
      return [];
    }
    const names = new Set<string>();
    for (const entry of entries) {
      if (entry.name.startsWith('.')) continue;
      if (entry.isDirectory()) names.add(entry.name);
      else if (entry.isFile() && entry.name.endsWith('.js')) {
        names.add(entry.name.slice(0, -3));
      }
    }
    return Promise.all([...names].sort().map((name) => this.check(name)));
  }
}
