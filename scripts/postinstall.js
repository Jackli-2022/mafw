/**
 * postinstall.js — Print configuration guide after npm install
 *
 * Behavior: ONLY prints messages, NEVER modifies any user files
 */

console.log('');
console.log('╔════════════════════════════════════════════════════════════╗');
console.log('║  opencode-plugin-mafw installed                          ║');
console.log('╚════════════════════════════════════════════════════════════╝');
console.log('');
console.log('Next steps:');
console.log('');
console.log('  1. Edit your opencode.json, add "opencode-plugin-mafw" to the plugin array:');
console.log('     {');
console.log('       "plugin": [');
console.log('         "superpowers@latest",');
console.log('         "opencode-plugin-mafw"');
console.log('       ]');
console.log('     }');
console.log('');
console.log('  2. Start the Gateway:');
console.log('     npx mafw-gateway start');
console.log('     Or register as system service: npx mafw-gateway service-register');
console.log('');
console.log('  3. Launch OpenCode: opencode');
console.log('');
console.log('  4. Submit a Goal: /goal design a login system');
console.log('');
