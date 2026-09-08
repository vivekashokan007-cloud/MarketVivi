# Remaining Audit — Read-Only Evidence Review

> Follow-up correction (2026-09-08): the checked ±150-second join recovers
> 32,507 one-to-one menu/outcome pairs across ten sessions. Historical analysis
> is runnable; the failed exact join was not a sufficient blocker. The large
> four-leg tick gaps are strongly associated with the known pre-guard missing
> second pair. See [the v3 review](REVIEW_CLAUDE_GUARDS_V3_20260908.md) for
> independently rerun evidence, denominator corrections and remaining controls.

**Date:** 2026-09-07  
**Scope:** valuation/labels, ranking-evaluation evidence, telemetry coverage,
training readiness, and release/runtime verification.  
**Methods:** Marketapp source/tests and read-only aggregates from the connected
Supabase project. No data, model, schema, order, or configuration was changed.

## Executive conclusion

The v2.6.17 control-plane fixes are locally validated but **not yet observed in
production telemetry**. The remaining audit cannot be closed as a profitability
claim: the system still lacks a single canonical executable net outcome for live
trades, a capacity-aware chronological evaluator, and forward device evidence.

The read-only evidence does support keeping retraining disabled. It also shows
that the teacher-evaluation corpus is useful for research, but not sufficient to
prove that PC2 produces attainable net profit.

## Test and source verification

| Check | Result | Interpretation |
|---|---:|---|
| Marketapp Python suite | **364 passed** | Current unit/regression contracts pass. |
| Focused daily-risk, quote-contract, net-economics tests | **8 passed** | Existing fail-closed valuation/risk contracts pass at unit level. |
| PWA JavaScript syntax | Passed | Current UI code parses. |
| `ml_train.run` | Disabled | Returned `retrain_disabled_pending_canonical_won_unification`. |
| `ml_train.online_update` | Disabled | Returned `online_update_disabled_pending_label_unification`. |

## 1. Live-trade valuation and label evidence

`trades_v2` contains **266 closed trades** (262 paper) through
2026-09-07. All 266 have `actual_pnl` and `canonical_won`, but only **95** have
`net_pnl`, `friction_cost`, and `net_won` (35.7%). Among those 95 net-labelled
rows, **10** have a different gross/canonical and net win outcome.

This confirms a mixed label regime: gross canonical labels are complete while
net labels are partial and can disagree. It supports the current disabled
training policy; it does not justify relabelling historical rows automatically.

`position_ticks` contains **23,793** ticks:

- 23,652 are `valuation_quality=OK`, `mark_basis=EXECUTABLE`, with executable
  mark and P&L present.
- 141 are `UNAVAILABLE` / `NONE`, with no executable mark or P&L.

For closed trades, 94 have a preceding tick within ten minutes of close (92
executable), at a mean age of 29.7 seconds. None matched stored gross or net
close P&L within ₹1 under a direct last-tick comparison. This is a
**reconciliation failure to investigate**, not proof that any close is wrong:
the close may use a later quote, a different aggregation basis, or different
quantity/timing. The required missing link is a versioned close record that
references the exact tick/quotes and quantity used for the label.

## 2. Teacher outcomes and ranking evidence

For `teacher_v1` rows with `price_integrity=OK`:

- 1,689 `primary` rows have mean managed P&L **−₹31.13**.
- 235,303 `secondary` rows have mean managed P&L **−₹137.35**.
- 1,681 primary rows share a snapshot with one or more secondaries. Within that
  descriptive pairing, the primary mean is −₹31.13 versus the within-snapshot
  secondary mean −₹162.74; it beats that secondary mean in 874 rows.
- The same comparison's hindsight best secondary average is ₹1,043.60, while
  the primary equals/exceeds it in only 43 rows. That is an **oracle headroom
  diagnostic**, never a deployable strategy or a valid target for tuning.

These are correlated five-minute candidate/evaluation rows, not independent
trades. They omit final entry eligibility, concurrent position capacity, actual
fills, and a frozen policy. Therefore they cannot establish PC2 profitability
or outperformance.

An attempted exact join from evaluation outcomes to `ml_generated_candidates`
by snapshot time and candidate identity returned **zero rows**. This directly
blocks a faithful historical correlation between the active generated-menu
`premium_edge`/rank and teacher outcome. A stable shared snapshot/poll identity
must be persisted across both tables before this test can be completed.

## 3. Telemetry and release deployment evidence

Across 5,467 brain snapshots (2026-05-25 to 2026-09-07):

| Surface | Snapshots with field |
|---|---:|
| Primary `entryEligible` | 443 |
| Primary PC2 rank | 1,201 |
| Primary PC2 sort components | 688 |
| Ranked evidence array | 1,688 |
| PC2 primary summary | 1,232 |
| `snapshot_daily_risk_state` | **0** |

The latest persisted brain version is **2.6.16** at 2026-09-07 10:10:41 UTC.
There are no v2.6.17 snapshots yet, so the new daily-risk provenance and final
authority telemetry have not received device/runtime verification. This is an
expected deployment-evidence gap, not a failure of the local tests.

## Audit closure requirements

1. **Canonical executable net labels:** persist close tick/quote identity,
   leg quantities, freshness, execution basis, residual fee/slippage basis, and
   a versioned canonical net outcome. Classify history as verified/flagged/
   unknown without deleting raw records.
2. **Shared decision identity:** persist the same snapshot/poll ID in generated
   candidates, final selector evidence, and post-close outcome rows. Retain the
   chosen primary, deterministic eligible control, and random control.
3. **Frozen chronological evaluator:** simulate feasible entries with capital,
   concurrency and NF/BNF correlation limits; purge overlapping outcome
   horizons; report coverage, turnover, drawdown, tail loss, and session-level
   uncertainty under cost/delay stress.
4. **Device and forward-paper evidence:** install the signed v2.6.17 build,
   verify startup/reconnect/close/restart daily-loss behavior, then run a
   predeclared forward-paper period with rejection criteria. Keep live ranking,
   OOD guards, and training disabled until that evidence exists.

## What was not done

- No historical record was repaired, quarantined, relabelled, or deleted.
- No ranking threshold, strategy family, OOD policy, or model was changed.
- No claim is made about future profit, real broker fills, or attainable
  portfolio performance.
