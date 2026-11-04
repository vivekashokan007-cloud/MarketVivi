// G3 (handoff 3 Nov 2026 s6): ML dashboard meanings. Renders the REAL renderML + the REAL
// buildCandidatePipelineDiagnostics / mlTrainingLabelProgressView from app.js after market close, with
// snapshot-shaped evidence (authority constructions + retired legacy generator rejections, mixed build
// segments, a post-15:15 snapshot) and the 2 Nov research-only service status fixture.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import fs from 'node:fs';
import vm from 'node:vm';

const SRC = fs.readFileSync(new URL('../app.js', import.meta.url), 'utf8');
const FIX = JSON.parse(fs.readFileSync(new URL('./fixtures/ml_eval_count_20261102.json', import.meta.url), 'utf8'));

function extractFrom(src, a, b) {
  const s = src.indexOf(a); assert.ok(s >= 0, a);
  const e = src.indexOf(b, s + a.length); assert.ok(e > s, b);
  return src.slice(s, e);
}

function makeRenderer() {
  const helpers = [
    extractFrom(SRC, 'function topCounterEntries(', '\nfunction refreshBrainData('),
    extractFrom(SRC, 'function mlEvaluationAttemptState(', '\nfunction renderML('),
    extractFrom(SRC, 'function deriveHoldingHorizon', '\nfunction filterPaperRowsForSameSessionTeacherComparison'),
    extractFrom(SRC, 'function filterPaperRowsForSameSessionTeacherComparison', '\nfunction buildTeacherLaneStatsFromOutcomes'),
  ].join('\n');
  const rs = SRC.indexOf('function renderML');
  const renderFn = SRC.slice(rs, SRC.indexOf('\nfunction ', rs + 10));
  const mlEl = { innerHTML: '' };
  const lanes = () => ({
    NF_intraday: { index: 'NF', mode: 'intraday', rows: 0, labeled: 0, wins: 0 }, NF_swing: { index: 'NF', mode: 'swing', rows: 0, labeled: 0, wins: 0 },
    BNF_intraday: { index: 'BNF', mode: 'intraday', rows: 0, labeled: 0, wins: 0 }, BNF_swing: { index: 'BNF', mode: 'swing', rows: 0, labeled: 0, wins: 0 },
  });
  const base = {
    console, Intl, Date, Number, String, Array, Object, Math, Boolean, JSON, Set, Map, RegExp,
    parseFloat, parseInt, isNaN, Infinity, undefined,
    escapeHtml: (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])),
    formatSessionDateLabel: (d) => d || '',
    STATE: { mlEvaluationOutcomes: [], mlEvaluationLaneSummary: {}, mlTeacherResearchReport: {}, mlStatusRefreshAt: 0, evaluatorJob: null, evaluatorProposals: [], approvedBranchProposals: [] },
    document: {
      getElementById: (id) => (id === 'ml-content' ? mlEl : { innerHTML: '', style: {}, disabled: false, textContent: '', value: '', classList: { add() {}, remove() {}, contains() { return false; } }, addEventListener() {}, removeEventListener() {}, querySelectorAll() { return []; } }),
      querySelectorAll: () => [],
    },
    window: {}, alert() {}, confirm() { return true; },
    localStorage: { getItem() { return null; }, setItem() {}, removeItem() {} },
    readNativeJson: (_m, fb) => fb, readNativeValue: (_m, fb = '') => fb,
    renderSnapshot: (snapshot) => snapshot || {},
    maybeAutoRefreshMlStatus() {},
    getMLModelStatusCached: () => ({}),
    getMLDecisionsCached: () => [],
    getMLEvaluationOutcomesCached: () => [],
    getMLEvaluationLaneSummaryCached: () => ({}),
    getMLTeacherResearchReportCached: () => ({}),
    getMLBrainSnapshotsCached: () => [],
    safeParseNB: (v, fb) => { if (v && typeof v === 'object') return v; if (typeof v === 'string') { try { return JSON.parse(v); } catch { return fb; } } return fb; },
    isLiveRecommendationWindow: () => false,
    evaluatorStatusLabel: () => '', formatCompactTs: () => '', resolveDecisionWon: () => null,
    buildMlLaneStatsFromOutcomes: lanes, buildMlLaneStats: lanes,
    buildTeacherLaneStatsFromOutcomes: () => ({ NF_intraday: { rows: 0, successes: 0 }, NF_swing: { rows: 0, successes: 0 }, BNF_intraday: { rows: 0, successes: 0 }, BNF_swing: { rows: 0, successes: 0 } }),
    localeNumberOrFallback: (n) => (n == null ? '--' : String(n)),
  };
  const sandbox = new Proxy(base, {
    get(t, prop, r) {
      if (prop in t) return Reflect.get(t, prop, r);
      if (typeof prop === 'symbol') return undefined;
      const n = String(prop);
      if (n.endsWith('Cached') || n.startsWith('get')) return () => (/(outcome|decision|history|proposal|snapshot)/i.test(n) ? [] : {});
      if (n.startsWith('build')) return t.buildMlLaneStats;
      if (n.startsWith('is') || n.startsWith('maybe')) return () => false;
      if (n.startsWith('format') || n.startsWith('evaluator') || n.startsWith('resolve')) return (v) => String(v ?? '');
      return () => '';
    },
  });
  vm.createContext(sandbox);
  vm.runInContext(helpers, sandbox);
  vm.runInContext(renderFn, sandbox);
  return { sandbox, mlEl, base };
}

// ---- snapshot-shaped evidence -------------------------------------------------------------
const cand = (ix, type, lineage = true) => ({
  id: `${type}_${ix}_X_index_construction_v1`, index: ix, type,
  ...(lineage ? { constructionVersion: 'index_construction_v1', authorityPolicyVersion: 'index_direction_v1', policySelectorVersion: 'index_managed_v1' } : {}),
});
const legacyRejectedStats = { total: 24, by_stage: { capital: 14, ev_floor: 10 }, by_reason: { capital_blocked: 14, ev_below_floor: 10 } };
const snap = (t, gen, version, extra = {}) => ({
  poll_ts: `2026-11-02T${t}:00+05:30`,
  context_json: {
    snapshot_brain_version: version,
    snapshot_generated_candidates: gen,
    snapshot_rejected_candidate_stats: legacyRejectedStats,
    snapshot_latest_poll: { t },
    ...extra,
  },
});
const AUTH_REC = { record_schema: 'mr.snapshot_primary.index_direction_v1', primary_policy: null, primary_reason: 'NO_MANAGED_SELECTION' };
// newest first; 15:20 is after the 15:15 cutoff; 13:20 is 2.6.88 with lineage, 11:00 is 2.6.87 (pre-G1: id only)
const AUTH_SNAPS = [
  snap('15:20', [], '2.6.89', { snapshot_index_authority_primary: AUTH_REC }),
  snap('13:20', [cand('NF', 'BEAR_PUT'), cand('NF', 'BEAR_CALL'), cand('BNF', 'IRON_CONDOR'), cand('BNF', 'IRON_BUTTERFLY')], '2.6.88', { snapshot_index_authority_primary: AUTH_REC }),
  snap('11:00', [cand('NF', 'BEAR_PUT', false), cand('NF', 'BEAR_CALL', false)], '2.6.87'),
];
const LEGACY_SNAPS = [snap('15:20', [], '2.6.40')];

const report = (gate, integrity = { counts: { OK: 71 }, gradeable_teacher_rows: 71, gradeable_primary_rows: 0 }) => ({
  ok: true, session_date: '2026-11-02', outcome_count: 1878, class_a_gate: gate, integrity_summary: integrity,
});
const NO_PRIMARY_GATE = { status: 'FAIL', blocked_reasons: ['no_primary_teacher_rows_were_available'], primary_snapshot_count: 0, primary_outcome_count: 0, outcome_count: 1878 };

function render(r, { status = FIX.state_1803.serviceStatus, snaps = AUTH_SNAPS, rep = report(NO_PRIMARY_GATE), model = { ok: true, version: 'v-old' } } = {}) {
  r.mlEl.innerHTML = '';
  r.base.getMLEvaluationLaneSummaryCached = () => FIX.state_1803.laneSummary;
  r.base.getMLBrainSnapshotsCached = () => snaps;
  r.base.getMLTeacherResearchReportCached = () => rep;
  r.base.getMLModelStatusCached = () => model;
  r.sandbox.renderML({ serviceStatus: { ...status, marketReason: 'CLOSED' }, brainResult: {}, executionInfraStatus: {}, pollHistory: [], signalStats: {}, orderProxyUrl: '' });
  return r.mlEl.innerHTML;
}
const strip = (h) => h.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ');
const section = (t, a, b) => { const i = t.indexOf(a); assert.ok(i >= 0, a); const j = b ? t.indexOf(b, i) : -1; return t.slice(i, j > i ? j : undefined); };
const R = makeRenderer();

test('closed market: authority menu by index separate from legacy evidence-only waterfall; 15:15 stated', () => {
  const t = strip(render(R));
  const d = section(t, 'Candidate Pipeline Diagnostics', 'Teacher v1 Shadow Review');
  assert.match(d, /Index authority menu \(decides admission\) · latest: NF 0 · BNF 0 · day \(3 loaded saved snapshots\): NF 4 · BNF 2 \(NF and BNF separate, not pooled\)/);
  assert.match(d, /New entries stop after 15:15 IST/);
  assert.match(d, /Legacy generator · evidence only \(retired; it neither builds nor blocks the authority menu\): Watchlist 0 · Rejected 24/);
  assert.match(d, /Legacy rejection stages \(evidence only\): capital 14 · ev_floor 10/);
  assert.doesNotMatch(d, /none survived the gate waterfall/);
});

test('pre-authority (legacy-only) session keeps the original legacy wording', () => {
  const d = section(strip(render(R, { snaps: LEGACY_SNAPS })), 'Candidate Pipeline Diagnostics', 'Teacher v1 Shadow Review');
  assert.doesNotMatch(d, /Index authority menu/);
  assert.match(d, /none survived the gate waterfall/);
});

test('Class A: zero chosen primaries + readback/integrity pass -> NO_BASELINE (comparison status only)', () => {
  const c = section(strip(render(R)), 'Class A Correctness Gate', 'Stage 2A Shadow Audit');
  assert.match(c, /Status: NO_BASELINE · comparison unavailable/);
  assert.match(c, /not a profitability result and not a training success/);
  assert.doesNotMatch(c, /Status: FAIL/);
});

test('Class A: genuine integrity failure keeps FAIL', () => {
  const rep = report(NO_PRIMARY_GATE, { counts: { OK: 46, FAIL: 25 }, gradeable_teacher_rows: 46, gradeable_primary_rows: 0 });
  const c = section(strip(render(R, { rep })), 'Class A Correctness Gate', 'Stage 2A Shadow Audit');
  assert.match(c, /Status: FAIL/);
  assert.match(c, /25 outcome rows failed integrity/);
});

test('Class A: unverified outcome readback keeps FAIL; other blocked reasons keep FAIL; PASS unchanged', () => {
  const noReadback = { ...FIX.state_1803.serviceStatus, lastEvaluationOutcomeCount: 0 };
  assert.match(section(strip(render(R, { status: noReadback })), 'Class A Correctness Gate', 'Stage 2A'), /Status: FAIL.*outcome readback is not verified/);
  const other = { ...NO_PRIMARY_GATE, blocked_reasons: ['no_primary_teacher_rows_were_available', 'rejected_menu_missing_on_1_primary_snapshots'] };
  assert.match(section(strip(render(R, { rep: report(other) })), 'Class A Correctness Gate', 'Stage 2A'), /Status: FAIL/);
  const pass = { status: 'PASS', blocked_reasons: [], primary_snapshot_count: 3, primary_outcome_count: 3, outcome_count: 900 };
  assert.match(section(strip(render(R, { rep: report(pass) })), 'Class A Correctness Gate', 'Stage 2A'), /Status: PASS/);
});

test('READY badge names the existing model when not trained this run; no readiness implied', () => {
  const t = strip(render(R));
  assert.match(t, /Existing model READY v-old/);
  assert.match(t, /READY refers to the existing model already on the device\. Model trained this run: NO\./);
  assert.match(t, /Model trained this run: NO/);
  assert.match(t, /Green here refers to research persistence only, not training readiness/);
  assert.match(t, /C3: INELIGIBLE/);
  const trained = strip(render(R, { status: { ...FIX.state_1803.serviceStatus, modelTrained: true } }));
  assert.match(trained, /Model READY v-old/);
  assert.doesNotMatch(trained, /Existing model READY/);
});

test('training progress: rejected count scope named; menu / rejected / chosen labels stay separate; session identity kept', () => {
  const t = strip(render(R));
  const p = section(t, 'Paper Training Progress', '4-Lane Teacher Matrix');
  assert.match(p, /Verified chosen training labels \(this session\): 0/);
  assert.match(p, /Secondary\/alternative research rows: 78 \(71 with outcomes; not training labels\)/);
  assert.match(p, /Rejected-role rows in recommendation\/evaluation outcome tables: 0 \(narrow scope: legacy rejected research lives in ml_rejected_candidate_outcomes, which this count does not read\)/);
  assert.doesNotMatch(p, /Rejected research rows: 0/);
  assert.match(p, /session 2026-11-02 · session_attributed · RESEARCH_ONLY/);
});

test('phone width: new lines contain no unbreakable long tokens (wrap at 360px)', () => {
  const t = strip(render(R));
  for (const word of t.split(' ')) assert.ok(word.length <= 48, `unbreakable token: ${word}`);
});

// Optional evidence dump for a phone-width visual check (not run in CI): G3_DUMP_DIR=/tmp/x node --test ...
if (process.env.G3_DUMP_DIR) {
  const states = {
    no_baseline_closed: render(R),
    integrity_fail: render(R, { rep: report(NO_PRIMARY_GATE, { counts: { OK: 46, FAIL: 25 }, gradeable_teacher_rows: 46, gradeable_primary_rows: 0 }) }),
    legacy_only: render(R, { snaps: LEGACY_SNAPS }),
  };
  for (const [k, html] of Object.entries(states)) fs.writeFileSync(`${process.env.G3_DUMP_DIR}/${k}.html`, html);
}
