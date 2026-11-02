// ML eval count correction (2 Nov 2026): Paper Training Progress must not count
// persisted outcomes (16:43 state, 19053/500) or secondary rows (18:03 state, 71/500).
// Renders the REAL renderML from both the old main app.js and the corrected app.js.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import fs from 'node:fs';
import vm from 'node:vm';

const NEW_SRC = fs.readFileSync(new URL('../app.js', import.meta.url), 'utf8');
const FIX = JSON.parse(fs.readFileSync(new URL('./fixtures/ml_eval_count_20261102.json', import.meta.url), 'utf8'));
const OLD_PATH = process.env.ML_EVAL_OLD_APP_JS;

function extractFrom(src, startMarker, endMarker) {
  const start = src.indexOf(startMarker);
  assert.ok(start >= 0, `missing ${startMarker}`);
  const end = src.indexOf(endMarker, start + startMarker.length);
  assert.ok(end > start, `missing end ${endMarker}`);
  return src.slice(start, end);
}

function makeRenderer(src) {
const helpers = [
  extractFrom(src, 'function mlEvaluationAttemptState(', '\nfunction renderML('),
  extractFrom(src, 'function deriveHoldingHorizon', '\nfunction filterPaperRowsForSameSessionTeacherComparison'),
  extractFrom(src, 'function filterPaperRowsForSameSessionTeacherComparison', '\nfunction buildTeacherLaneStatsFromOutcomes'),
].join('\n');

const renderStart = src.indexOf('function renderML');
const renderEnd = src.indexOf('\nfunction ', renderStart + 10);
const renderFn = src.slice(renderStart, renderEnd);

const mlEl = { innerHTML: '' };
const base = {
  console, Intl, Date, Number, String, Array, Object, Math, Boolean, JSON, Set, Map,
  parseFloat, parseInt, isNaN, Infinity, undefined,
  escapeHtml: (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])),
  formatSessionDateLabel: (d) => d || '',
  STATE: {
    mlEvaluationOutcomes: [],
    mlEvaluationLaneSummary: {},
    mlTeacherResearchReport: {},
    mlStatusRefreshAt: 0,
    evaluatorJob: null,
    evaluatorProposals: [],
    approvedBranchProposals: [],
  },
  document: {
    getElementById: (id) => (id === 'ml-content' ? mlEl : {
      innerHTML: '', style: {}, disabled: false, textContent: '', value: '',
      classList: { add(){}, remove(){}, contains(){ return false; } },
      addEventListener(){}, removeEventListener(){}, querySelectorAll(){ return []; },
    }),
    querySelectorAll: () => [],
  },
  window: {},
  alert() {},
  confirm() { return true; },
  localStorage: { getItem(){ return null; }, setItem(){}, removeItem(){} },
  readNativeJson: (_m, fb) => fb,
  readNativeValue: (_m, fb='') => fb,
  renderSnapshot: (snapshot) => snapshot || {},
  maybeAutoRefreshMlStatus() {},
  getMLModelStatusCached: () => ({}),
  getMLDecisionsCached: () => [],
  getMLEvaluationOutcomesCached: () => [],
  getMLEvaluationLaneSummaryCached: () => ({}),
  getMLTeacherResearchReportCached: () => ({}),
  getTeacherResearchReportCached: () => ({}),
  getBrainSnapshotsCached: () => [],
  safeParseNB: (v, fb) => (v && typeof v === 'object' ? v : fb),
  isLiveRecommendationWindow: () => false,
  evaluatorStatusLabel: () => '',
  formatCompactTs: () => '',
  resolveDecisionWon: () => null,
  buildMlLaneStatsFromOutcomes: () => ({
    NF_intraday:{index:'NF',mode:'intraday',rows:0,labeled:0,wins:0},
    NF_swing:{index:'NF',mode:'swing',rows:0,labeled:0,wins:0},
    BNF_intraday:{index:'BNF',mode:'intraday',rows:0,labeled:0,wins:0},
    BNF_swing:{index:'BNF',mode:'swing',rows:0,labeled:0,wins:0},
  }),
  buildMlLaneStats: () => ({
    NF_intraday:{index:'NF',mode:'intraday',rows:0,labeled:0,wins:0},
    NF_swing:{index:'NF',mode:'swing',rows:0,labeled:0,wins:0},
    BNF_intraday:{index:'BNF',mode:'intraday',rows:0,labeled:0,wins:0},
    BNF_swing:{index:'BNF',mode:'swing',rows:0,labeled:0,wins:0},
  }),
  buildTeacherLaneStatsFromOutcomes: () => ({
    NF_intraday:{rows:0,successes:0}, NF_swing:{rows:0,successes:0},
    BNF_intraday:{rows:0,successes:0}, BNF_swing:{rows:0,successes:0},
  }),
  buildCandidatePipelineDiagnostics: () => ({
    stageEntries: [], reasonEntries: [], indexSummaries: [],
    totalCandidates: 0, acceptedCandidates: 0, rejectedCandidates: 0,
  }),
  localeNumberOrFallback: (n) => (n == null ? '--' : String(n)),
};

const sandbox = new Proxy(base, {
  get(target, prop, receiver) {
    if (prop in target) return Reflect.get(target, prop, receiver);
    if (typeof prop === 'symbol') return undefined;
    const name = String(prop);
    if (name.endsWith('Cached') || name.startsWith('get')) {
      return () => (/(outcome|decision|history|proposal|snapshot)/i.test(name) ? [] : {});
    }
    if (name.startsWith('build')) return target.buildMlLaneStats;
    if (name.startsWith('is') || name.startsWith('maybe')) return () => false;
    if (name.startsWith('format') || name.startsWith('evaluator') || name.startsWith('resolve')) return (v) => String(v ?? '');
    return () => '';
  }
});

vm.createContext(sandbox);
vm.runInContext(helpers, sandbox);
vm.runInContext(renderFn, sandbox);
return { sandbox, mlEl, base };
}


function renderWith(r, fixture) {
  r.mlEl.innerHTML = '';
  r.base.getMLEvaluationLaneSummaryCached = () => fixture.laneSummary;
  r.sandbox.renderML({ serviceStatus: fixture.serviceStatus, brainResult: {}, executionInfraStatus: {}, pollHistory: [], signalStats: {}, orderProxyUrl: '' });
  return r.mlEl.innerHTML;
}
const strip = (h) => h.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ');
function progressText(html) {
  const t = strip(html);
  const i = t.indexOf('Paper Training Progress');
  return t.slice(i, t.indexOf('4-Lane Teacher Matrix', i));
}
const NEW = makeRenderer(NEW_SRC);

for (const key of ['state_1643', 'state_1803']) {
  test(`${key}: no training readiness, no fabricated win rate, no 'chosen evaluated outcomes'`, () => {
    const html = renderWith(NEW, FIX[key]);
    const p = progressText(html);
    if (process.env.ML_EVAL_SNAPSHOT_DIR) fs.writeFileSync(`${process.env.ML_EVAL_SNAPSHOT_DIR}/new_${key}.txt`, p + '\n');
    assert.match(p, /Verified chosen training labels \(this session\): 0 · /);
    assert.doesNotMatch(p, /\/500|Remaining to target/);
    assert.match(p, /Win rate: UNKNOWN/);
    assert.doesNotMatch(p, /READY FOR RETRAIN GATE/);
    assert.doesNotMatch(p, /0\.0%/);
    assert.doesNotMatch(p, /chosen evaluated outcomes/);
    assert.doesNotMatch(p, /19053\/500|71\/500/);
    assert.match(p, /NF: 0 labels · win rate UNKNOWN · BNF: 0 labels · win rate UNKNOWN/);
  });
}

test('state_1803 shows research completion wording and secondary rows as research only', () => {
  const html = renderWith(NEW, FIX.state_1803);
  const t = strip(html);
  assert.match(t, /Day evaluation: RESEARCH EVALUATION COMPLETE · 0 training labels/);
  assert.match(t, /Labels saved: NO/);
  assert.match(t, /Model trained this run: NO/);
  assert.match(t, /C3: INELIGIBLE/);
  const p = progressText(html);
  assert.match(p, /RESEARCH ONLY · 0 new training labels/);
  assert.match(p, /Secondary\/alternative research rows: 78 \(71 with outcomes; not training labels\)/);
  assert.match(p, /Rejected research rows: 0/);
});

test('state_1643 without contract: no fallback to persisted outcome count', () => {
  const p = progressText(renderWith(NEW, FIX.state_1643));
  assert.match(p, /training label contract unavailable/);
  assert.match(p, /persisted-outcome counter \(research, not labels\): 19053 · run date: 2026-10-30 \(may belong to a prior run\)/);
});

function eligibleFixture() {
  const fixture = JSON.parse(JSON.stringify(FIX.state_1803));
  fixture.serviceStatus.evaluationPhase = 'LABELS_SAVED';
  fixture.serviceStatus.labelsSaved = true;
  Object.assign(fixture.laneSummary.training_label_progress, {
    eligible: true, ineligible_reason: null, ledger_phase: 'LABELS_SAVED', ledger_labels_saved: true, ledger_run_id: 'run-x',
    verified_training_labels: 600, verified_training_wins: 300,
    index_totals: { NF: { verified_training_labels: 400, verified_training_wins: 100 }, BNF: { verified_training_labels: 200, verified_training_wins: 200 } },
  });
  return fixture;
}

test('verified chosen labels: this session only, per index, no /500, never READY FOR RETRAIN GATE', () => {
  const p = progressText(renderWith(NEW, eligibleFixture()));
  assert.match(p, /Verified chosen training labels \(this session\): 600 · Win rate: 50\.0%/);
  assert.match(p, /NF: 400 labels · win rate 25\.0% · BNF: 200 labels · win rate 100\.0%/);
  assert.match(p, /THIS SESSION ONLY · not a cumulative retrain count/);
  assert.match(p, /run run-x/);
  assert.doesNotMatch(p, /READY FOR RETRAIN GATE|\/500|Remaining to target|TARGET COUNT/);
});

test('R2: stale cached session count is not shown beside a different displayed session', () => {
  const f = eligibleFixture();
  f.laneSummary.training_label_progress.session_date = '2026-10-30'; // cached prior session
  const p = progressText(renderWith(NEW, f));
  assert.match(p, /Verified chosen training labels \(this session\): 0 · Win rate: UNKNOWN/);
  assert.match(p, /CACHED_SESSION_MISMATCH/);
  assert.doesNotMatch(p, /600/);
});

test('R2: transition to RESEARCH_ONLY with a cached eligible count shows no eligible count', () => {
  const f = eligibleFixture();
  f.serviceStatus.evaluationPhase = 'RESEARCH_ONLY'; // status moved on; cached contract still says eligible
  f.serviceStatus.labelsSaved = false;
  const html = renderWith(NEW, f);
  const p = progressText(html);
  assert.match(p, /Verified chosen training labels \(this session\): 0 · Win rate: UNKNOWN/);
  assert.match(p, /RESEARCH ONLY · 0 new training labels/);
  assert.doesNotMatch(p, /600/);
  assert.match(strip(html), /RESEARCH EVALUATION COMPLETE · 0 training labels/);
});

test('R2: same session and LABELS_SAVED shows the count (transition back is honest)', () => {
  const p = progressText(renderWith(NEW, eligibleFixture()));
  assert.match(p, /\(this session\): 600/);
});

test('old main reproduces the false 19053/500 and 71/500 claims', { skip: !OLD_PATH }, () => {
  const OLD = makeRenderer(fs.readFileSync(OLD_PATH, 'utf8'));
  const a = progressText(renderWith(OLD, FIX.state_1643));
  const b = progressText(renderWith(OLD, FIX.state_1803));
  if (process.env.ML_EVAL_SNAPSHOT_DIR) {
    fs.writeFileSync(`${process.env.ML_EVAL_SNAPSHOT_DIR}/old_state_1643.txt`, a + '\n');
    fs.writeFileSync(`${process.env.ML_EVAL_SNAPSHOT_DIR}/old_state_1803.txt`, b + '\n');
  }
  assert.match(a, /19053\/500 \(100%\) · Win rate: 0\.0%/);
  assert.match(a, /READY FOR RETRAIN GATE/);
  assert.match(a, /persisted outcomes need attribution backfill/);
  assert.match(b, /71\/500 \(14%\) · Win rate: 15\.5%/);
  assert.match(b, /chosen evaluated outcomes/);
});
