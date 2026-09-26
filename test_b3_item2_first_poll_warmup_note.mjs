import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

// B3 item 2 (2026-09-26): first-poll Paper monitoring is labelled as warm-up.
const src = fs.readFileSync(new URL('./app.js', import.meta.url), 'utf8');
const start = src.indexOf('function firstPollWarmupNote');
const end = src.indexOf('\nfunction renderBrainForTrade', start);
assert.ok(start > 0 && end > start);
const sandbox = {};
vm.createContext(sandbox);
vm.runInContext(src.slice(start, end), sandbox);

assert.match(sandbox.firstPollWarmupNote({ monitoring_mode: 'FIRST_POLL_WARMUP' }, { paper: true }), /Warm-up monitoring/);
assert.equal(sandbox.firstPollWarmupNote({ verdict: { action: 'HOLD' } }, { paper: true }), '');
assert.equal(sandbox.firstPollWarmupNote(null, { paper: true }), '');
assert.equal(sandbox.firstPollWarmupNote({ monitoring_mode: 'FIRST_POLL_WARMUP' }, { paper: false }), '');
assert.match(src, /\$\{verdictLine\}\$\{firstPollWarmupNote\(data, trade\)\}\$\{detailsHtml\}/);
console.log('B3 item 2 PWA warm-up note checks OK');
