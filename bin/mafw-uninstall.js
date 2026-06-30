#!/usr/bin/env node

/**
 * mafw-uninstall CLI — Project-level uninstall helper
 *
 * Usage: npx mafw-uninstall
 */

const fs = require('fs');
const path = require('path');

console.log(`
╔════════════════════════════════════════════════════════════╗
║  MAFW Plugin Uninstall Helper                              ║
╚════════════════════════════════════════════════════════════╝

This script helps clean up MAFW artifacts from your project.

Manual steps:
1. Remove "opencode-plugin-mafw" from your opencode.json plugin array
2. Delete the .opencode/mafw/ directory if you no longer need the data
3. Run: npm uninstall opencode-plugin-mafw (or npm uninstall -g opencode-plugin-mafw)

To also stop the Gateway:
  npx mafw-gateway stop

To unregister system service:
  npx mafw-gateway service-unregister
`);

const projectDir = process.cwd();
const mafwDir = path.join(projectDir, '.opencode', 'mafw');

if (fs.existsSync(mafwDir)) {
  console.log(`Found MAFW data directory: ${mafwDir}`);
  console.log('Run the following to delete it:');
  console.log(`  rm -rf "${mafwDir}"`);
}
