import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const appSrc = fs.readFileSync(path.join(root, 'app.js'), 'utf8');

function extractFunction(src, name) {
  const needle = `function ${name}(`;
  const start = src.indexOf(needle);
  assert.ok(start >= 0, `missing ${name}`);
  let i = src.indexOf('{', start);
  let depth = 0, mode = 'code';
  for (; i < src.length; i++) {
    const ch = src[i], nxt = src[i + 1] || '';
    if (mode === 'code') {
      if (ch === "'" ) mode = 'sq';
      else if (ch === '"') mode = 'dq';
      else if (ch === '`') mode = 'tmpl';
      else if (ch === '{') depth++;
      else if (ch === '}') {
        depth--;
        if (depth === 0) return src.slice(start, i + 1);
      } else if (ch === '/' && nxt === '/') {
        while (i < src.length && src[i] !== '\n') i++;
      } else if (ch === '/' && nxt === '*') {
        i += 2;
        while (i + 1 < src.length && !(src[i] === '*' && src[i + 1] === '/')) i++;
        i++;
      }
    } else if (mode === 'sq') {
      if (ch === '\\') { i++; continue; }
      if (ch === "'") mode = 'code';
    } else if (mode === 'dq') {
      if (ch === '\\') { i++; continue; }
      if (ch === '"') mode = 'code';
    } else if (mode === 'tmpl') {
      if (ch === '\\') { i++; continue; }
      if (ch === '`') mode = 'code';
    }
  }
  throw new Error(`unterminated ${name}`);
}

const helpers = [
  'finiteNumberOrNull',
  'readVixPreviousCloseAttribution',
].map((n) => extractFunction(appSrc, n)).join('\n\n');

function runWith(bdObj, today = '2026-10-05') {
  const sandbox = {
    bd: bdObj,
    API: { todayIST: () => today },
    console,
  };
  vm.createContext(sandbox);
  vm.runInContext(helpers + '; globalThis.readVixPreviousCloseAttribution = readVixPreviousCloseAttribution;', sandbox);
  return sandbox.readVixPreviousCloseAttribution(14.5);
}

// Real-mode: regime history_sessions_behind is null, but factual verified close present
{
  const out = runWith({
    vixRegime: {
      decision_scope: 'real_legacy_unchanged',
      history_status: 'LEGACY_UNVERIFIED',
      history_sessions_behind: null,
      previous_close: 13.8,
      previous_close_date: '2026-10-01',
      previous_close_verified: true,
      previous_close_sessions_behind: 0,
    },
  });
  assert.equal(out.previous_close, 13.8);
  assert.equal(out.previous_close_date, '2026-10-01');
}

// Uncertain: verified false → null even if close numbers present
{
  const out = runWith({
    vixRegime: {
      history_sessions_behind: null,
      previous_close: 13.8,
      previous_close_date: '2026-10-01',
      previous_close_verified: false,
      previous_close_sessions_behind: 0,
    },
  });
  assert.equal(out.previous_close, null);
  assert.equal(out.previous_close_date, null);
}

// Stale factual behind
{
  const out = runWith({
    vixRegime: {
      history_sessions_behind: null,
      previous_close: 13.8,
      previous_close_date: '2026-09-30',
      previous_close_verified: true,
      previous_close_sessions_behind: 1,
    },
  });
  assert.equal(out.previous_close, null);
  assert.equal(out.previous_close_date, null);
}

// Same-day date rejected
{
  const out = runWith({
    vixRegime: {
      previous_close: 13.8,
      previous_close_date: '2026-10-05',
      previous_close_verified: true,
      previous_close_sessions_behind: 0,
    },
  });
  assert.equal(out.previous_close, null);
}

// Both entry snapshot spreads use the helper (source contract)
assert.match(appSrc, /readVixPreviousCloseAttribution\(latestPoll\.vix\)/);
assert.match(appSrc, /readVixPreviousCloseAttribution\(poll\?\.vix\)/);
assert.match(appSrc, /previous_close_verified === true/);
assert.doesNotMatch(appSrc, /history_sessions_behind;\s*\n\s*const behindOk/);

console.log('PASS: test_previous_close_attribution_r1_20261005.mjs');
