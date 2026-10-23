// M0 full-day research collector panel (Codex M0 brief B6). Renders the real m0ResearchView/renderResearchCollector.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import fs from 'node:fs';
import vm from 'node:vm';

const src = fs.readFileSync(new URL('../app.js', import.meta.url), 'utf8');
const start = src.indexOf('// ── M0 full-day research collector');
const end = src.indexOf("const EV12_SET_ACK_SCHEMA = 'ev_set_ack_v1';");
assert.ok(start > 0 && end > start);
const code = src.slice(start, end);

function load(native) {
  const el = { innerHTML: '' };
  const ctx = { JSON, Object, Array, String, document: { getElementById: (id) => (id === 'research-m0' ? el : null) } };
  if (native !== undefined) ctx.NativeBridge = native;
  vm.createContext(ctx);
  vm.runInContext(code + '\nthis.m0ResearchView = m0ResearchView; this.renderResearchCollector = renderResearchCollector; this.m0ResearchStatus = m0ResearchStatus;', ctx);
  return { ctx, el };
}

const counts = (o) => Object.assign({ available: true, reason: null, expected: 78, pending: 0, captured: 0, late: 0, partial: 0, missing: 0, unavailable: 0, chain_durable_acked: 0, chain_local_or_failed: 0 }, o);
const status = (label, nf, bnf, extra = {}) => Object.assign({
  schema: 'research_m0_collector_v1:status', enabled: label !== 'DISABLED', collection_start: '2026-10-22',
  calendar_version: 'research_m0_cal_v1', label, sessions: [{ session_date: '2026-10-22', NF: counts(nf), BNF: counts(bnf) }],
  envelopes_today: { VALID: 3, NEUTRAL: 5, MISSING: 1, MALFORMED: 0, FORECAST_UNAVAILABLE: 1 }, envelopes_upload: 'LOCAL_ONLY_UPLOAD_NOT_DEPLOYED',
  protection: { integrity: 'OK', STAGED: 0, LAG_EXCEEDED: 0, CAPACITY_REJECTED: 0 }, conflicts_total: 0, failures: {},
}, extra);

export const FIXTURES = {
  incomplete: status('ENABLED_NOT_CAPTURING', { pending: 40, captured: 20, missing: 18, chain_durable_acked: 20 }, { pending: 40, captured: 30, missing: 8, chain_durable_acked: 30 }),
  partial: status('COLLECTING', { pending: 30, captured: 40, late: 2, partial: 4, missing: 2, chain_durable_acked: 44, chain_local_or_failed: 2 }, { pending: 30, captured: 46, partial: 2, chain_durable_acked: 48 }),
  complete: status('COLLECTING', { captured: 78, chain_durable_acked: 78 }, { captured: 78, chain_durable_acked: 78 }),
};
fs.writeFileSync(new URL('./fixtures/m0/status_fixtures.json', import.meta.url), JSON.stringify(FIXTURES, null, 1));

test('collecting wording only when native label is COLLECTING', () => {
  const { ctx } = load();
  for (const [name, st] of Object.entries(FIXTURES)) {
    const html = ctx.m0ResearchView(Object.assign({ available: true }, st));
    assert.equal(html.includes('Full-day research — collecting'), st.label === 'COLLECTING', name);
    assert.match(html, /Collection start: 2026-10-22/);
    assert.match(html, /<td>78<\/td>/);
    assert.match(html, /stored on device only/);
    assert.match(html, /no winner, profitability, validated EV/);
    assert.match(html, /Observe is a separate label, not an execution mode/);
    assert.doesNotMatch(html, /profitable|winner:|validated EV:/i);
  }
});

test('disabled, unknown calendar and missing bridge never claim collection', () => {
  const { ctx } = load();
  const off = ctx.m0ResearchView(Object.assign({ available: true }, status('DISABLED', {}, {})));
  assert.match(off, /collector off/); assert.doesNotMatch(off, /— collecting/);
  const cal = status('CALENDAR_UNAVAILABLE', {}, {});
  cal.sessions = [{ session_date: '2027-01-04', NF: { available: false, reason: 'CALENDAR_YEAR_NOT_COVERED' }, BNF: { available: false, reason: 'CALENDAR_YEAR_NOT_COVERED' } }];
  const ch = ctx.m0ResearchView(Object.assign({ available: true }, cal));
  assert.match(ch, /coverage unknown \(CALENDAR_YEAR_NOT_COVERED\)/); assert.doesNotMatch(ch, /— collecting/);
  assert.match(ctx.m0ResearchView({ available: false, reason: 'OLDER_APK_NO_STATUS' }), /status unknown/);
  assert.match(ctx.m0ResearchView({ available: true, label: 'BOGUS' }), /status unknown/);
});

test('native status: missing bridge, old APK, malformed and throwing are unavailable', () => {
  assert.equal(load().ctx.m0ResearchStatus().reason, 'NO_NATIVE_BRIDGE');
  assert.equal(load({}).ctx.m0ResearchStatus().reason, 'OLDER_APK_NO_STATUS');
  assert.equal(load({ getResearchCollectorStatus: () => '{"x":1}' }).ctx.m0ResearchStatus().reason, 'MALFORMED');
  assert.equal(load({ getResearchCollectorStatus: () => { throw new Error('x'); } }).ctx.m0ResearchStatus().reason, 'STATUS_ERROR');
  const { ctx, el } = load({ getResearchCollectorStatus: () => JSON.stringify(FIXTURES.complete) });
  ctx.renderResearchCollector();
  assert.match(el.innerHTML, /— collecting/);
});

test('escapes native strings', () => {
  const { ctx } = load();
  const st = Object.assign({ available: true }, FIXTURES.complete, { collection_start: '<img src=x onerror=alert(1)>' });
  assert.doesNotMatch(ctx.m0ResearchView(st), /<img/);
});

test('panel is wired into the page and boot render', () => {
  const html = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  assert.match(html, /<div id="research-m0"><\/div>/);
  assert.match(src, /try \{ renderResearchCollector\(\); \} catch/);
});
