/**
 * preuninstall.js — Clean up before npm uninstall
 */

const { execSync } = require('child_process');

console.log('[MAFW] Stopping Gateway before uninstall...');
try {
  execSync('npx mafw-gateway stop', { stdio: 'ignore' });
  console.log('[MAFW] Gateway stopped');
} catch {
  console.log('[MAFW] Gateway was not running');
}
