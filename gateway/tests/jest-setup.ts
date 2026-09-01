// Runs before each test file's imports — the logger module evaluates its log
// directory at import time, so this must redirect before it loads. Keeps test
// output (console.* via the gateway logger) out of the production
// ~/.mafw/logs/mafw.log.
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

process.env.MAFW_LOG_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'mafw-test-logs-'));
