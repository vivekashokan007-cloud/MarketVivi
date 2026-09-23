import assert from 'assert';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const appJs = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8');

assert.ok(!appJs.includes('showing best'), 'must not claim "showing best" without rank provenance');
assert.ok(appJs.includes('by current menu rank'), 'menu rank provenance wording required');
assert.ok(appJs.includes("cand.tDTE == null || cand.tDTE === '' ? '--' : cand.tDTE"), 'zero-DTE must not use truthy ||');
assert.ok(appJs.includes("manual_book_profit_button"), 'Book Profit reason must be honest button provenance');
assert.ok(!appJs.includes("Brain said BOOK"), 'must not store Brain said BOOK as close reason');
assert.ok(appJs.includes('PAPER ANALYSIS'), 'monitor-only Paper alternatives access preserved');

console.log('batch_a_display_wording_ok');
