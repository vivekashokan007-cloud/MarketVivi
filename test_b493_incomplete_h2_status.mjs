import assert from 'node:assert/strict';
import fs from 'node:fs';

const app = fs.readFileSync(new URL('./app.js', import.meta.url), 'utf8');
const index = fs.readFileSync(new URL('./index.html', import.meta.url), 'utf8');

assert.match(app, /evaluationPhaseRaw === 'INCOMPLETE_H2_MARKET_DATA'/);
assert.match(app, /Closing-window option marks are incomplete/);
assert.match(app, /Labels are not saved, C3 is not started, and no price is fabricated/);
assert.match(index, /v2\.6\.62 · b493/);

console.log('b493 incomplete H2 status contract: OK');
