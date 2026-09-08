import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

export type WiringResult = 'wired' | 'present' | 'skipped' | 'failed';

export function resolveGatewayApiUrl(): string {
  const port = process.env.MAFW_SERVER_API_PORT || process.env.MAFW_GATEWAY_PORT || '3000';
  return `http://127.0.0.1:${port}`;
}

/**
 * Self-wiring: ensure the global opencode config has an `mcp.mafw` section so
 * gateway MCP tools are mounted in every session. Opencode reads global config
 * from ~/.config/opencode/opencode.jsonc (or opencode.json). The plugin config
 * hook cannot inject mcp (notification-only), so we patch the file directly.
 *
 * Fail-open: any error leaves the config untouched (returns 'failed'); callers
 * must not let this block plugin activation.
 */
export function ensureMcpWiring(gatewayUrl: string, configPath?: string): WiringResult {
  try {
    const dir = configPath
      ? path.dirname(configPath)
      : path.join(process.env.XDG_CONFIG_HOME || path.join(os.homedir(), '.config'), 'opencode');
    const candidates = configPath
      ? [configPath]
      : ['opencode.jsonc', 'opencode.json'].map((f) => path.join(dir, f));
    const target = candidates.find((p) => fs.existsSync(p));
    // No global config file — skip silently rather than create one the user never had.
    if (!target) return 'skipped';

    const raw = fs.readFileSync(target, 'utf-8');
    // Any existing "mcp" key (ours or the user's) — leave the file alone.
    if (/"mcp"\s*:/.test(raw)) return 'present';

    const backup = `${target}.bak-mafw-${Date.now()}`;
    fs.writeFileSync(backup, raw, 'utf-8');

    const block = [
      '  "mcp": {',
      '    "mafw": {',
      '      "type": "remote",',
      `      "url": "${gatewayUrl}/mcp",`,
      '      "enabled": true,',
      '      "oauth": false',
      '    }',
      '  },',
    ].join('\n');
    const open = raw.indexOf('{');
    if (open < 0) return 'failed';
    const wired = raw.slice(0, open + 1) + '\n' + block + raw.slice(open + 1);

    // Sanity: insertion must only add our block (length grows by block size).
    if (wired.length !== raw.length + block.length + 1) return 'failed';
    fs.writeFileSync(target, wired, 'utf-8');
    return 'wired';
  } catch {
    return 'failed';
  }
}
