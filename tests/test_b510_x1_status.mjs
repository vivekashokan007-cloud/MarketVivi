// b510 Batch C: PWA X1 research status card. Runs the REAL app.js helper block in a VM.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const src = readFileSync(new URL('../app.js', import.meta.url), 'utf8');
const block = src.slice(src.indexOf('// ═══ B510 X1 PAPER BUYING RESEARCH STATUS ═══'), src.indexOf('// ═══ END B510 X1 STATUS ═══'));
const escSrc = src.slice(src.indexOf('function escapeHtml(value)'), src.indexOf('function evaluatorStatusLabel'));
const ctx = { Number, String, Object, Array, Math };
vm.createContext(ctx);
vm.runInContext(block + '\n' + escSrc, ctx);
const html = s => ctx.b510X1StatusHtml(s, ctx.escapeHtml);

const status = {
  status: 'OK', session_date: '2026-10-19', target_resolved_per_index: 60, record_count: 7, max_records: 800,
  protocol_id: 'X1_gap_continuation_v2_causal_paper_20261017',
  counts: { NF: { resolved: 12, unresolved: 2, skip: 5, open: 1, delayed: { resolved: 10 } },
            BNF: { resolved: 9, unresolved: 0, skip: 8, open: 0, delayed: { resolved: 9 } } },
  today: [{ index: 'NF', arm: 'primary', status: 'OPEN', side: 'CE', strike: 24550 }],
};

test('card shows simulation-only label, collection session, per-index progress', () => {
  const h = html(status);
  assert.match(h, /Quote simulation only; no trade recommendation\./);
  assert.match(h, /Collection session: 2026-10-19 · Status: Collecting/);
  assert.match(h, /<b>NF<\/b> primary resolved 12\/60 · unresolved 2 · skipped 5 · open 1 · delayed control resolved 10/);
  assert.match(h, /<b>BNF<\/b> primary resolved 9\/60 · unresolved 0 · skipped 8 · delayed/);
  assert.match(h, /NF primary OPEN CE 24550/);
});

test('no buy/order affordance; only the export action', () => {
  const h = html(status);
  const onclicks = [...h.matchAll(/onclick="([^"]+)"/g)].map(m => m[1]);
  assert.deepEqual(onclicks, ['exportX1ResearchJournal()']);
  assert.doesNotMatch(h, /\b(Buy|BUY|Place|Execute|Take trade)\b/);
  assert.doesNotMatch(h, /evaluation date/i);
});

test('missing / malformed status is bounded and escaped', () => {
  for (const s of [null, undefined, 'x', [], {}, { counts: 'bad', today: 'bad' }]) {
    const h = html(s);
    assert.match(h, /Status: UNAVAILABLE/);
    assert.match(h, /primary resolved 0\/60/);
  }
  assert.match(html({ status: 'NOT_STARTED' }), /Not started/);
  const evil = html({ status: '<img src=x onerror=1>', session_date: '<b>', protocol_id: '"><script>',
                      today: [{ index: '<i>', arm: 'primary', status: 'SKIP', reason: '<svg>' }] });
  assert.doesNotMatch(evil, /<img|<script|<svg|<i>/);
  assert.match(evil, /Collection session: — /);
});

test('rendered from the native status method inside renderML, not from the ML evaluation date', () => {
  assert.match(src, /html \+= b510X1StatusHtml\(readNativeJson\('getPaperBuyingResearchStatus'/);
  assert.match(src, /readNativeJson\('exportPaperBuyingResearchJournal'/);
  assert.doesNotMatch(block, /evaluationTargetDate/);
});
