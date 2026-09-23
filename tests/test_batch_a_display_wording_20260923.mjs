import assert from 'assert';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import vm from 'vm';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const appJs = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8');

assert.ok(!appJs.includes('showing best'), 'must not claim "showing best" without rank provenance');
assert.ok(appJs.includes('by current menu rank'), 'menu rank provenance wording required');
assert.ok(appJs.includes("cand.tDTE == null || cand.tDTE === '' ? '--' : cand.tDTE"), 'zero-DTE must not use truthy ||');
assert.ok(appJs.includes("manual_book_profit_button"), 'Book Profit reason must be honest button provenance');
assert.ok(!appJs.includes("Brain said BOOK"), 'must not store Brain said BOOK as close reason');
assert.ok(appJs.includes('PAPER ANALYSIS'), 'monitor-only Paper alternatives access preserved');

console.log('batch_a_display_wording_ok');

assert.ok(appJs.includes('assertPersistedCloseReasonProvenance'), 'save-path provenance helper required');
assert.ok(appJs.includes("manual_book_profit_button"), 'button provenance token required on save path');
assert.ok(!appJs.includes('Brain said BOOK'), 'must not persist Brain said BOOK as close reason');

// R2: provenance must live inside close_trace_json, NOT as a top-level trades_v2 field.
// Detect top-level by requiring the key to appear as a direct closePatch property
// (same indent as status/exit_reason), not nested under close_trace_json.
const closePatchMatch = appJs.match(/const closePatch = \{([\s\S]*?)\n        \};/);
assert.ok(closePatchMatch, 'closePatch object required');
const closePatchBody = closePatchMatch[1];
const topLevelProvenance = /^\s{12}close_reason_provenance\s*:/m.test(closePatchBody);
const nestedInTrace = /close_trace_json:\s*\{[\s\S]*?close_reason_provenance\s*:/.test(closePatchBody);
assert.ok(!topLevelProvenance, 'close_reason_provenance must not be a top-level closePatch field');
assert.ok(nestedInTrace, 'close_reason_provenance must be nested inside close_trace_json');

const helperMatch = appJs.match(/function assertPersistedCloseReasonProvenance\(reason\) \{[\s\S]*?\n    \}/);
assert.ok(helperMatch, 'assertPersistedCloseReasonProvenance function body required');
const sandbox = { Error };
vm.createContext(sandbox);
vm.runInContext(helperMatch[0] + '\n; this.__fn = assertPersistedCloseReasonProvenance;', sandbox);
const fn = sandbox.__fn;
const button = fn('manual_book_profit_button');
assert.strictEqual(button.close_reason, 'manual_book_profit_button');
assert.strictEqual(button.brain_book_event, false);
assert.strictEqual(button.provenance, 'manual_book_profit_button');
assert.throws(() => fn('Brain said BOOK'), /close_reason_must_not_claim_brain_BOOK/);

function buildClosePatchShape(exitReason) {
  const prov = fn(exitReason);
  return {
    status: 'CLOSED',
    exit_reason: prov.close_reason,
    close_trace_json: {
      source: 'manual_close',
      exit_reason: exitReason || 'Manual',
      close_reason_provenance: prov,
    },
  };
}
const patch = buildClosePatchShape('manual_book_profit_button');
assert.ok(!Object.prototype.hasOwnProperty.call(patch, 'close_reason_provenance'));
assert.ok(patch.close_trace_json.close_reason_provenance);
assert.strictEqual(patch.close_trace_json.close_reason_provenance.provenance, 'manual_book_profit_button');
assert.strictEqual(patch.exit_reason, 'manual_book_profit_button');
console.log('batch_a_close_provenance_save_path_ok');
