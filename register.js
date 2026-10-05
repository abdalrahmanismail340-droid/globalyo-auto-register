#!/usr/bin/env node
/** CLI wrapper: node register.js [firstName] [lastName] */
const { registerAccount } = require('./lib');

(async () => {
  const acc = await registerAccount({
    firstName: process.argv[2] || 'Abood',
    lastName: process.argv[3] || 'Test',
    onProgress: console.log,
  });
  console.log('DONE:', JSON.stringify(acc, null, 2));
})().catch(e => { console.error('FAILED:', e.message); process.exit(1); });
