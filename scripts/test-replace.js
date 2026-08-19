const c = 'console.log("test"); console.warn("test"); console.error("test")';
console.log('before:', c);
const r = c.replace(/console\.log\(/g, 'log.info(');
console.log('after:', r);
