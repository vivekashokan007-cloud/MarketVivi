import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const src = fs.readFileSync(new URL('./app.js', import.meta.url), 'utf8');
const start = src.indexOf('function deriveHoldingHorizon');
const end = src.indexOf('\nfunction buildTeacherLaneStatsFromOutcomes', start);
assert.ok(start > 0 && end > start, 'holding/comparison helpers not found');
const helpers = src.slice(start, end);
const sandbox = { console, Intl, Date, Number, String, Array, Object, Math, Boolean };
vm.createContext(sandbox);
vm.runInContext(helpers, sandbox);

const same = sandbox.deriveHoldingHorizon({
  entry_date: '2026-09-08T10:15:00+05:30',
  exit_date: '2026-09-08T14:50:00+05:30',
  trade_mode: 'intraday', status: 'CLOSED'
});
assert.equal(same.holding_horizon, 'SAME_SESSION');
assert.equal(same.comparable_for_teacher_pool, true);

const overnight = sandbox.deriveHoldingHorizon({
  entry_date: '2026-09-08T14:50:00+05:30',
  exit_date: '2026-09-09T10:05:00+05:30',
  trade_mode: 'intraday', status: 'CLOSED'
});
assert.equal(overnight.holding_horizon, 'OVERNIGHT');
assert.equal(overnight.intraday_carried_beyond_session, true);
assert.equal(overnight.comparable_for_teacher_pool, false);

const openPos = sandbox.deriveHoldingHorizon({
  entry_date: '2026-09-08T10:15:00+05:30', status: 'OPEN', trade_mode: 'intraday'
});
assert.equal(openPos.holding_horizon, 'OPEN');

const filtered = sandbox.filterPaperRowsForSameSessionTeacherComparison([
  { entry_date: '2026-09-08T10:15:00+05:30', exit_date: '2026-09-08T14:50:00+05:30', status: 'CLOSED' },
  { entry_date: '2026-09-08T14:50:00+05:30', exit_date: '2026-09-09T10:05:00+05:30', status: 'CLOSED' },
]);
assert.equal(filtered.kept_count, 1);
assert.equal(filtered.excluded_counts.OVERNIGHT, 1);

// Batch D runtime is native teacher_summary only; the unsafe all-row JS duplicate is gone.
assert.doesNotMatch(src, /function summarizeTeacherReportingMetrics/);
assert.match(src, /chosen reporting comes only from native teacher_summary/);
assert.match(src, /summaryTeacher\?\.netProfitableRatePct/);

// Batch C runtime contract is exact native boolean only.
assert.match(src, /const labelsSaved = service\.labelsSaved === true;/);
assert.doesNotMatch(src, /lastEvaluationOutcomeCount \|\| 0\) >= 0/);

console.log('PWA B/D/E helper checks OK');
