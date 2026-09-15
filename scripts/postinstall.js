/**
 * postinstall.js — Print configuration guide after npm install
 *
 * Behavior: ONLY prints messages, NEVER modifies any user files
 */

console.log('');
console.log('╔════════════════════════════════════════════════════════════╗');
console.log('║  mafw installed                                          ║');
console.log('╚════════════════════════════════════════════════════════════╝');
console.log('');
console.log('Next steps:');
console.log('');
console.log('  1. Edit your opencode.json, add "mafw" to the plugin array:');
console.log('     {');
console.log('       "plugin": [');
console.log('         "superpowers@latest",');
console.log('         "mafw"');
console.log('       ]');
console.log('     }');
console.log('');
console.log('  2. Start the Gateway daemon:');
console.log('     mafw daemon        (background)');
console.log('     mafw status        (health check)');
console.log('');
console.log('  3. Launch OpenCode: opencode');
console.log('');
console.log('  4. Submit a Goal: /goal design a login system');
console.log('');
