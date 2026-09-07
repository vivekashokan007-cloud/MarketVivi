# Remaining Audit Findings — Verification Run

**Date:** 2026-09-07  
**Release inspected:** Marketapp `ff771e9` / MarketVivi `9273b69`  
**Purpose:** distinguish implemented audit controls from findings that remain
unimplemented or require live evidence. This is not a profitability claim.

## Tests run

| Check | Result | What it establishes |
|---|---|---|
| Marketapp full Python suite | **364 passed** | Current guard, selector, snapshot, valuation-guard, and notification tests remain green. |
| Focused daily-risk, evaluation quote-contract, and net-economics tests | **8 passed** | Same-day local-loss STOP, quote fail-closed behavior, and current net-economics gate behavior pass their unit contracts. |
| MarketVivi JavaScript syntax | **Passed** | The PWA parses after the final-verdict and close-ledger changes. |
| `ml_train.run(...)` direct call | **Blocked by design** | Returns `retrain_disabled_pending_canonical_won_unification`. |
| `ml_train.online_update(...)` direct call | **Blocked by design** | Returns `online_update_disabled_pending_label_unification`. |

The Python suite emitted existing synthetic-fixture warnings about intentionally
missing chain quotes and missing `GEMINI_API_KEY`; no test failed.

## Completed audit controls

- Comparator provenance persists the original deterministic order across PC2
  reselection, and the comparator uses the top final-entry-eligible deterministic
  candidate.
- Final verdict controls the PWA GO state and both real/paper entry paths.
- Daily-loss state is rebuilt from local closed/open trades, persisted in compact
  snapshots, and updated by the native bridge before the PWA's remote close call.
- Compact ranked evidence preserves active PC2 sort inputs.

## Findings still left out

| Priority | Finding | Verification evidence | Required next work |
|---|---|---|---|
| P0 | **Executable valuation is not the canonical close label.** | The PWA derives `netIfClosedNow` by subtracting friction from `current_pnl`; `compute_live_friction_bridge` similarly computes `net_pnl = supplied gross − friction`. The close persists gross `actual_pnl`, `canonical_won`, and `outcome_h2` separately from net fields. | Create a versioned canonical net-label contract with complete leg quantities, synchronized executable bid/ask marks, quote freshness, and a residual-only cost basis. Preserve gross display marks separately. |
| P0 | **Training remains intentionally disabled and brain outcome helpers prefer gross canonical fields.** | Both actual training entry points returned their label-unification block. `brain._trade_outcome_bool` checks `canonical_won` before gross `actual_pnl`; current PWA writes `canonical_won` from gross P&L. | Define the canonical net outcome version, provenance classes (`verified`, `flagged`, `unknown`), and a migration-free resolver. Then add purged chronological training tests before enabling either trainer. |
| P1 | **No capacity-constrained chronological policy evaluator is established.** | The available `net_objective_backtest.py` is explicitly a read-only historical candidate-menu comparison and documents proxy limitations. Repository inspection found no implementation/tests for concurrent-position capacity, overlap purging, or an attainable portfolio equity curve. | Build a frozen-policy evaluator with timing, capital, NF/BNF correlation/concurrency, overlap-horizon purge, cost/exit versions, drawdown, and coverage reporting. Compare PC2, deterministic eligible control, and recorded random control on untouched sessions. |
| P1 | **Historical full-menu and matched-outcome proof remains coverage-limited.** | Current telemetry now preserves active sort fields, but legacy records were truncated and the earlier same-poll database comparisons did not run because account usage limits blocked them. | Run the saved read-only SQL when database capacity is available; report menu, comparator, and outcome-match coverage before comparing performance. Do not reconstruct missing historical values from current code. |
| P2 | **EV proxy has not been replaced or validated as a managed-net objective.** | Existing net-economics tests validate the gate contract, not predictive superiority of its objective. The remaining backtest tool itself labels its net edge as a historical proxy. | Predeclare a small challenger set, validate held-out managed-net expectancy with session-level uncertainty and cost stress, and leave the live selector unchanged until it wins prospectively. |
| P3/P4 | **No device restart/reconnect test or forward-paper validation was run.** | The daily-risk unit path passes, but this environment cannot launch the Android Gradle build or exercise a device, broker fills, Supabase persistence, or a market session. | Run Android signed workflow, then test startup, reconnect, close, and restart on-device. Follow with frozen forward-paper validation and predeclared rejection/risk limits. |

## Boundaries

- The earlier four-leg valuation and notification-audit defects were addressed
  in prior guard releases; this run does not reopen historical rows or assert
  that every historical close is clean.
- The reported performance cohorts remain observational and incomplete. None of
  the passing unit tests proves that any strategy is profitable or that PC2
  outperforms eligible alternatives.
- No database queries, schema changes, model changes, orders, or production
  settings were made during this verification run.
