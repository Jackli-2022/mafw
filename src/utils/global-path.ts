import * as os from 'os';
import * as path from 'path';

export function findGlobalMafwDir(): string {
  return path.join(os.homedir(), '.mafw');
}
