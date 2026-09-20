import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { pathToFileURL } from 'node:url';

const src = fs.readFileSync(new URL('./app.js', import.meta.url), 'utf8');
const start = src.indexOf('function deriveHoldingHorizon');
const end = src.indexOf('function summarizeTeacherReportingMetrics');
const end2 = src.indexOf('\nfunction ', end + 10);
assert.ok(start > 0 && end > start && end2 > end, 'helpers not found');
const helpers = src.slice(start, end2);
const sandbox = { console, Intl, Date, Number, String, Array, Object, Math, Boolean };
vm.createContext(sandbox);
vm.runInContext(helpers, sandbox);

// Batch E
const same = sandbox.deriveHoldingHorizon({
  entry_date: '2026-09-08T10:15:00+05:30',
  exit_date: '2026-09-08T14:50:00+05:30',
  trade_mode: 'intraday',
  status: 'CLOSED'
});
assert.equal(same.holding_horizon, 'SAME_SESSION');

const overnight = sandbox.deriveHoldingHorizon({
  entry_date: '2026-09-08T14:50:00+05:30',
  exit_date: '2026-09-09T10:05:00+05:30',
  trade_mode: 'intraday',
  status: 'CLOSED'
});
assert.equal(overnight.holding_horizon, 'OVERNIGHT');
assert.equal(overnight.intraday_carried_beyond_session, true);
assert.equal(overnight.comparable_for_teacher_pool, false);

const openPos = sandbox.deriveHoldingHorizon({
  entry_date: '2026-09-08T10:15:00+05:30',
  status: 'OPEN',
  trade_mode: 'intraday'
});
assert.equal(openPos.holding_horizon, 'OPEN');

// Batch D
const summary = sandbox.summarizeTeacherReportingMetrics([
  { session_date: '2026-09-08', is_success: false, exit_reason: 'EOD', managed_pnl: 1200 },
  { session_date: '2026-09-09', is_success: true, exit_reason: 'TP', managed_pnl: -50 },
]);
assert.equal(summary.teacher_target_hit_count, 1);
assert.equal(summary.net_profitable_count, 1);
assert.equal(summary.distinct_session_count, 2);
assert.equal(summary.sample_uncertain, false);

// Batch B: failure detection contract (pure predicate replica)
const c3FailedOnlyOnPhase = (phase, error) => String(phase || '') === 'FAILED';
assert.equal(c3FailedOnlyOnPhase('INELIGIBLE', 'NO_C3_FRAMES'), false);
assert.equal(c3FailedOnlyOnPhase('FAILED', 'boom'), true);
assert.equal(c3FailedOnlyOnPhase('DONE', ''), false);

console.log('PWA B/D/E helper checks OK');
