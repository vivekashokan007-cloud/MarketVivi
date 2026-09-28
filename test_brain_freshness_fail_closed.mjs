import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const src = fs.readFileSync(new URL('./app.js', import.meta.url), 'utf8');

function extractFunction(name) {
  const start = src.indexOf(`function ${name}(`);
  assert.ok(start >= 0, `${name} missing`);
  const body = src.indexOf('{', start);
  let depth = 0;
  let quote = null;
  for (let i = body; i < src.length; i += 1) {
    const ch = src[i];
    if (quote) {
      if (ch === '\\') i += 1;
      else if (ch === quote) quote = null;
      continue;
    }
    if (ch === "'" || ch === '"' || ch === '`') { quote = ch; continue; }
    if (ch === '{') depth += 1;
    if (ch === '}' && --depth === 0) return src.slice(start, i + 1);
  }
  throw new Error(`${name} unterminated`);
}

const now = Date.now();
const sandbox = {
  Date,
  Number,
  Math,
  BRAIN_RESULT_STALE_MS: 12 * 60 * 1000,
  bd: {},
};
vm.createContext(sandbox);
vm.runInContext(
  `${extractFunction('brainResultTimestampMs')}\n${extractFunction('brainFreshnessStatus')}`,
  sandbox,
);

assert.equal(sandbox.brainFreshnessStatus({ brain_result_completed_at_ms: now - 60_000 }, now).fresh, true);
assert.equal(sandbox.brainFreshnessStatus({ brain_result_completed_at_ms: now - 13 * 60_000 }, now).fresh, false);
assert.match(sandbox.brainFreshnessStatus({ brain_result_completed_at_ms: now - 13 * 60_000 }, now).reason, /stale/i);
assert.equal(sandbox.brainFreshnessStatus({}, now).fresh, false);
assert.match(sandbox.brainFreshnessStatus({}, now).reason, /timestamp unavailable/i);
assert.equal(sandbox.brainFreshnessStatus({ brain_result_completed_at_ms: now + 61_000 }, now).fresh, false);

const adoptStart = src.indexOf('function adoptBrainResult');
const adoptEnd = src.indexOf('\nfunction parseMLStatus', adoptStart);
const adoptSource = src.slice(adoptStart, adoptEnd);
assert.doesNotMatch(adoptSource, /STATE\.brainLastRun\s*=\s*Date\.now\(\)/);
assert.match(adoptSource, /STATE\.brainLastRun\s*=\s*completedAtMs/);
assert.match(src, /Trade blocked: \$\{freshness\.reason\}/);
assert.match(src, /Old recommendations are display-only and cannot authorize a trade/);
assert.match(src, /Saved position verdicts are display-only until a successful poll completes/);

console.log('PWA Brain freshness fail-closed checks OK');
