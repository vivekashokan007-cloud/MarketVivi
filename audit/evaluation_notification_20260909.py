"""Read-only audit checks against the sibling Marketapp checkout.

Some probes reproduce remaining defects; others assert the v2.6.19 recovery
contract. No database or Android writes occur.
Run from any directory: python3 <this-file>
"""
import json
import sys
from pathlib import Path
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / 'Marketapp/app/src/main/python'))
import brain


def call(result, poll):
    return json.loads(brain.brain_notification_process(result, {
        'now_ms': 1000000 + poll * 300000,
        'poll_id': poll, 'session_date': '2026-09-09',
        'entry_window_active': True,
    }))


def emitted(payload):
    contracts = payload['brain_notifications'] or [payload['brain_notification']]
    return [c['title'] for c in contracts if c['notify_user']]


def setup(alerts=None):
    return {
        'verdict': {'action': 'SELL PREMIUM', 'strategy': 'BULL_PUT', 'confidence': 66},
        'watchlist': [{'id': 'audit-c1', 'type': 'BULL_PUT', 'index': 'NF',
                       'executionReady': True, 'entryEligible': True,
                       'capitalBlocked': False, 'directionSafe': True}],
        'alerts': alerts or [],
    }


RISK = {'key': 'POS_STOP_audit-trade', 'category': 'POSITION', 'priority': 'urgent',
        'title': 'Stop Loss Near', 'body': 'Audit fixture risk'}


def record(name, evidence, defect_reproduced=True):
    print(json.dumps({'probe': name, 'defect_reproduced': defect_reproduced, 'evidence': evidence}))


brain.reset_notification_agent()
call(setup(), 1)
collision = call(setup([RISK]), 2)
following = call(setup(), 3)
assert emitted(collision) == ['Stop Loss Near']
assert collision['agent_state']['best_candidate_id'] == 'audit-c1'
assert emitted(following) == []
record('N1_setup_consumed_by_position_collision', {
    'collision_emitted': emitted(collision), 'next_poll_emitted': emitted(following),
    'next_reason': following['brain_notification']['reason_code'],
})

brain.reset_notification_agent()
wait = {'verdict': {'action': 'WAIT', 'confidence': 0}, 'watchlist': [], 'alerts': [RISK]}
first = call(wait, 1)
call({**wait, 'alerts': []}, 2)
returned = call(wait, 3)
assert emitted(first) == ['Stop Loss Near'] and emitted(returned) == []
record('N2_same_risk_after_clear_remains_suppressed', {
    'first_emitted': emitted(first), 'after_clear_emitted': emitted(returned),
    'retained_states': returned['agent_state']['position_alert_states'],
})

brain.reset_notification_agent()
alerts = [
    {'key': 'MARKET_A', 'category': 'MARKET', 'priority': 'important', 'title': 'Warning A', 'body': 'A'},
    {'key': 'MARKET_B', 'category': 'MARKET', 'priority': 'important', 'title': 'Warning B', 'body': 'B'},
]
first = call({**wait, 'alerts': alerts}, 1)
following = call({**wait, 'alerts': alerts}, 2)
assert emitted(first) == ['Warning A'] and emitted(following) == []
record('N3_undispatched_operational_warning_marked_seen', {
    'first_emitted': emitted(first), 'next_emitted': emitted(following),
    'seen_keys': first['agent_state']['operational_alert_keys'],
})

# A snapshot exception must leave the failed snapshot unadvanced. Kotlin uses the
# returned fatal count to persist the successful prefix and mark the job FAILED.
run_id = 'audit-failure-injection'
brain._EVAL_JOB_CACHE[run_id] = {'snapshots': [{'id': 1}, {'id': 2}], 'chain_rows': []}
try:
    with patch.object(brain, '_evaluate_snapshot_outcomes', side_effect=ValueError('audit malformed row')):
        result = json.loads(brain.evaluation_job_run_batch(run_id, 0, 4))
    assert result['ok'] is True and result['error_count'] == 1
    assert result['fatal_snapshot_error_count'] == 1
    assert result['end'] == 0 and result['outcomes'] == []
    record('E4_snapshot_error_stops_checkpoint', {
        k: result[k] for k in ('ok', 'end', 'error_count', 'fatal_snapshot_error_count', 'produced_count')
    }, defect_reproduced=False)
finally:
    brain.evaluation_job_finalize(run_id)

# Source-order verification of the Kotlin checkpoint repair; not JVM execution.
source = (ROOT / 'Marketapp/app/src/main/java/com/marketradar/app/MarketMLService.kt').read_text()
run = source[source.index('private suspend fun runDayEvaluation('):]
initial_state = run[:run.index('val py = Python.getInstance()')]
assert 'totalSnapshots = 0,' not in initial_state
assert 'completedSnapshots = 0,' not in initial_state
assert '(prefs.getInt("evaluation_total_snapshots", 0) == totalSnapshots)' in run
record('E1_checkpoint_preserved_before_resume_source_check', {
    'method': 'Kotlin source ordering, not JVM execution',
    'initial_preparing_write_resets_progress': False,
    'resume_requires_matching_saved_total': True,
}, defect_reproduced=False)

# Source-level guard for the in-process evaluator claim and shared foreground
# lifetime. Device/process-death behavior remains a release validation task.
assert 'claimEvaluationSession(sessionDate)' in source
assert 'DAY_EVAL_DUPLICATE_IGNORED' in source
assert 'finishServiceAction(startId)' in source
record('E2_single_evaluator_and_shared_foreground_source_check', {
    'method': 'Kotlin source inspection, not Android lifecycle execution',
    'duplicate_launch_claim': True,
    'foreground_actions_reference_counted': True,
}, defect_reproduced=False)

sys.path.insert(0, str(ROOT / 'Marketapp/app/src/main/python/tests'))
from test_evaluation_chain_quote_contract import candidate, snapshot, chain_rows
cand = candidate()
snap = snapshot(cand)
rows = chain_rows(True)
last_ts = max(row['poll_ts'] for row in rows)
config = brain._teacher_default_config()
# Deliberately distant thresholds isolate the EOD branch from TP/SL branches.
config.update(tp_capture_pct=100, sl_loss_multiple=100)
for row in rows:
    if row['poll_ts'] == last_ts:
        row.pop('bid')
        row.pop('ask')
with_tail = brain._managed_teacher_outcome(rows, snap, cand, config)
without_tail = brain._managed_teacher_outcome(
    [row for row in rows if row['poll_ts'] != last_ts], snap, cand, config)
assert with_tail['exit_reason'] == 'EOD'
assert with_tail['managed_pnl'] == without_tail['managed_pnl']
assert with_tail['exit_ts'] == without_tail['exit_ts'] != last_ts
assert with_tail['exit_valuation_status'] == 'EOD_LAST_EXECUTABLE'
record('E5_EOD_timestamp_uses_last_executable_quote', {
    'reported_exit': with_tail['exit_ts'], 'last_valued_ts': without_tail['exit_ts'],
    'unvalued_terminal_ts': last_ts,
    'same_pnl': with_tail['managed_pnl'],
}, defect_reproduced=False)
