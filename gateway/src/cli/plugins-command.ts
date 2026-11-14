/**
 * `mafw plugins ...` — thin CLI over the Phase 6 trust routes.
 *
 * The module takes its HTTP client, human-token reader and printer as deps so
 * the command surface can be unit-tested without spawning the gateway.
 */

export interface PluginsCommandResponse {
  status: number;
  body: any;
}

export interface PluginsCommandDeps {
  request(
    path: string,
    method: 'GET' | 'POST',
    body?: unknown,
    humanToken?: string,
  ): Promise<PluginsCommandResponse>;
  readHumanToken(): string | null;
  print(text: string): void;
}

function takeFlag(args: string[], name: string): string | undefined {
  const index = args.indexOf(name);
  if (index < 0) return undefined;
  const value = args[index + 1];
  args.splice(index, value === undefined ? 1 : 2);
  return value;
}

function takeRepeated(args: string[], name: string): string[] {
  const values: string[] = [];
  for (;;) {
    const value = takeFlag(args, name);
    if (value === undefined) return values;
    values.push(value);
  }
}

function firstPositional(args: string[]): string | undefined {
  return args.find((arg) => !arg.startsWith('--'));
}

async function send(
  deps: PluginsCommandDeps,
  path: string,
  method: 'GET' | 'POST',
  body: unknown,
  humanToken: string | undefined,
  asJson: boolean,
): Promise<number> {
  try {
    const response = await deps.request(path, method, body, humanToken);
    if (response.status >= 400) {
      deps.print(JSON.stringify(response.body, null, 2));
      return 1;
    }
    if (asJson || method !== 'GET') {
      deps.print(JSON.stringify(response.body, null, 2));
    } else {
      const packages = Array.isArray(response.body?.packages) ? response.body.packages : [];
      for (const pkg of packages) {
        deps.print(`${pkg.name}\t${pkg.state ?? pkg.status ?? ''}\t${pkg.version ?? ''}`);
      }
      if (packages.length === 0) deps.print('(no packages)');
    }
    return 0;
  } catch (err: any) {
    deps.print(`API call failed: ${err?.message ?? String(err)}`);
    return 1;
  }
}

function humanTokenOrFail(deps: PluginsCommandDeps): string | null {
  const token = deps.readHumanToken();
  if (!token) {
    deps.print('human token required: set MAFW_HUMAN_TOKEN or create ~/.mafw/human.token');
    return null;
  }
  return token;
}

export async function runPluginsCommand(
  argv: string[],
  deps: PluginsCommandDeps,
): Promise<number> {
  const args = [...argv];
  const command = args.shift();
  const asJson = args.includes('--json');
  args.splice(args.indexOf('--json'), args.includes('--json') ? 1 : 0);

  switch (command) {
    case 'list':
      return send(deps, '/api/plugins', 'GET', undefined, undefined, asJson);
    case 'doctor': {
      const name = firstPositional(args);
      return send(
        deps,
        name ? `/api/plugins/${encodeURIComponent(name)}/doctor` : '/api/plugins/doctor',
        'POST',
        undefined,
        undefined,
        true,
      );
    }
    case 'install': {
      const path = firstPositional(args);
      if (!path) {
        deps.print('usage: mafw plugins install <path> [--overwrite] [--trust trusted|untrusted] [--permission <token>]...');
        return 1;
      }
      const overwrite = args.includes('--overwrite');
      const trust = takeFlag(args, '--trust');
      const permissions = takeRepeated(args, '--permission');
      const token = humanTokenOrFail(deps);
      if (!token) return 1;
      const body = {
        path,
        overwrite,
        ...(trust
          ? { accept: { trust, permissions } }
          : {}),
      };
      return send(deps, '/api/plugins/packages/install', 'POST', body, token, true);
    }
    case 'kill':
      return send(deps, '/api/plugins/kill', 'POST', undefined, undefined, true);
    case 'resume': {
      const token = humanTokenOrFail(deps);
      if (!token) return 1;
      return send(deps, '/api/plugins/resume', 'POST', undefined, token, true);
    }
    case 'quarantine': {
      const name = firstPositional(args);
      const reason = takeFlag(args, '--reason') ?? '';
      if (!name || !reason) {
        deps.print('usage: mafw plugins quarantine <name> --reason <text>');
        return 1;
      }
      return send(
        deps,
        `/api/plugins/${encodeURIComponent(name)}/quarantine`,
        'POST',
        { reason },
        undefined,
        true,
      );
    }
    case 'unquarantine': {
      const name = firstPositional(args);
      if (!name) {
        deps.print('usage: mafw plugins unquarantine <name>');
        return 1;
      }
      const token = humanTokenOrFail(deps);
      if (!token) return 1;
      return send(
        deps,
        `/api/plugins/${encodeURIComponent(name)}/unquarantine`,
        'POST',
        undefined,
        token,
        true,
      );
    }
    case 'rollback': {
      const name = firstPositional(args);
      if (!name) {
        deps.print('usage: mafw plugins rollback <name>');
        return 1;
      }
      const token = humanTokenOrFail(deps);
      if (!token) return 1;
      return send(
        deps,
        `/api/plugins/${encodeURIComponent(name)}/rollback`,
        'POST',
        undefined,
        token,
        true,
      );
    }
    case 'audit': {
      const packageName = takeFlag(args, '--package');
      const limit = takeFlag(args, '--limit');
      const query = new URLSearchParams();
      if (packageName) query.set('package', packageName);
      if (limit) query.set('limit', limit);
      const suffix = query.toString() ? `?${query.toString()}` : '';
      return send(deps, `/api/plugins/audit${suffix}`, 'GET', undefined, undefined, true);
    }
    default:
      deps.print('usage: mafw plugins <list|doctor|install|kill|resume|quarantine|unquarantine|rollback|audit>');
      return 1;
  }
}
