# Codex Handoff to Claude — Valuation-Guard Review

Date: 2026-09-07
Repositories: `Marketapp`, `MarketVivi`
Review base: Marketapp commit `27f08e32ba0837ad1ec248d452d5ad05363d9e9c`

## Purpose

Codex reviewed your follow-up handoff and patch:

- `HANDOFF_guards_followup_for_codex_20260907.md`
- `guards_on_top_of_27f08e3.patch`

The patch was checked with `git apply --check` and is applicable to the local
checkout. It was **not applied, committed, or pushed**. This document records
the findings so the next revision can be prepared with clear evidence
boundaries.

## Current release state

- Android/Kotlin: `versionName 2.6.15`, `versionCode 446`.
- Python brain: `BRAIN_VERSION 2.6.15`.
- MarketVivi PWA: `v2.6.15 / b446`, `app.js?v=1322`.
- The existing v2.6.15 signed-release GitHub Actions run completed successfully:
  [run 34090892188](https://github.com/vivekashokan007-cloud/Marketapp/actions/runs/34090892188).
- The successful run confirms CI for commit `27f08e3`; it does not prove phone
  installation or runtime validation of the proposed guards.

Any follow-up behavior release must bump and synchronize all three markers
together. The proposed target is **v2.6.16 / b447**, with the PWA cache marker
advanced to `app.js?v=1323`.

## Confirmed findings

### 1. The four-leg extraction defect is real

`PositionTickService` previously did not consistently read the PWA's second
pair fields (`sell_instrument_key2`, `buy_instrument_key2`, `sell_strike2`,
`buy_strike2`, plus camelCase aliases). The shipped `27f08e3` repair addresses
that defect. The issue omitted the second short/long pair, not both protective
legs as one description in the handoff suggests.

### 2. A structural completeness guard is worthwhile

The proposed `expectedLegCount()` and `STRUCTURE_INCOMPLETE` status can prevent
an obviously incomplete four-leg valuation from being treated as healthy.
However, `legs.size >= expectedLegs` is not sufficient on its own:

- duplicate instruments can satisfy the count;
- wrong leg roles or option sides can satisfy the count;
- extra legs are accepted;
- unknown strategies skip the check but are represented as complete.

For supported strategies, validate exact count, unique instrument identity,
expected call/put and buy/sell roles, strike/expiry consistency, and quantities.
Represent unsupported structures as explicitly unchecked rather than complete.

### 3. The closing path does not prove historical P&L corruption

`PositionTickService` queues position-tick rows for `insertPositionTicks`; it
does not directly write `trades_v2.actual_pnl`. In `MarketVivi/app.js`,
`closeTrade()` takes `actual_pnl` from the open trade's `current_pnl`. The normal
native brain path uses `brain.py:compute_position_live()`, which independently
includes both pairs for four-leg strategies.

Therefore, the minute-tick defect does not by itself prove that every earlier
four-leg closed trade has corrupted `actual_pnl`. Reconcile individual rows and
valuation provenance before excluding or repairing historical outcomes.
Evaluator-label reliability also needs row-level provenance; do not make a
blanket claim that all historical labels are trustworthy or unusable.

## Main concern with the proposed bound guard

The patch treats expiry `max_profit`/`max_loss` as hard limits on a live
executable closing quote. The service values a credit spread using short-leg
ask and long-leg bid. A wide quoted market can exceed expiry payoff limits even
when its mid-price spread remains consistent with the defined-risk structure.

Synthetic arithmetic (not production evidence):

- spread width: 100; entry credit: 40; quantity: 65;
- expiry max loss: `(100 - 40) * 65 = 3,900`;
- short ask: 210; long bid: 90; quoted close: 120;
- quoted P&L: `(40 - 120) * 65 = -5,200`;
- 1.05 max-loss threshold: `-4,095`.

The proposed guard would reject this quote even though the mid spread may be
100. It then nulls `current_pnl`, suppressing the shadow stop-loss path and
usually producing `SHADOW_DEGRADED` instead. These are shadow policy decisions,
not broker executions, but they still affect observability and research.

Recommendation: initially record this as an anomaly with the raw mark, quote
legs, spread width, entry premium, units, friction assumptions, and bound
references. Only fail closed after validating units, strategy payoff
conventions, quote semantics, and the intended friction tolerance on real
examples.

## Serialization issue to fix

The patch computes `executableMarkValue` from `baseQuality`, then applies the
bound guard to P&L. As written, a `BOUND_VIOLATION` row can still serialize an
`executable_mark` and `mark_basis=EXECUTABLE` while `current_pnl` is null.
Mid/LTP marks may also remain populated.

Define the contract explicitly:

- raw mark and raw P&L for diagnostics;
- accepted mark and accepted P&L for downstream decisions;
- an unambiguous quality/status field;
- policy trace fields that explain the rejection.

Add an end-to-end test covering extraction → quote valuation → guard → policy →
JSON serialization. Downstream readers must not mistake a rejected valuation
for an accepted executable mark.

## Test assessment

Claude reported 353 Python tests and ten Kotlin tests passing. Those results
were not independently rerun on the patched tree during this review.

The proposed tests are useful but incomplete:

- source-contract tests mainly assert that strings exist;
- version tests prove a marker exists, not that it was bumped or synchronized;
- telemetry assertions do not cover every newly claimed field;
- Kotlin tests cover pure helpers, not the complete `buildTickRow()` flow;
- malformed, duplicate, wrong-role, wide-quote, serialization, and running
  MAE/MFE reset cases are not covered.

Also check whether previously stored running extrema remain contaminated after
an invalid tick; the proposed guard does not reset them.

## Requested next revision

Please return a revised patch proposal that:

1. validates exact supported leg structure and explicitly marks unknown types;
2. separates anomaly telemetry from any P&L fail-closed behavior;
3. prevents rejected marks from being serialized as accepted executable marks;
4. adds behavioral end-to-end tests and complete telemetry assertions;
5. documents the treatment of prior rows without claiming unverified database
   history;
6. bumps and synchronizes Android, Python, and PWA versions if behavior ships.

Do not apply or push the guard patch until these points are resolved and the
full synchronized release checks pass.

## Evidence boundary

No Supabase production query, schema/RLS audit, historical P&L repair, phone
installation check, or Android local Gradle build was performed in this review.
No credentials or tokens belong in this handoff or in project knowledge.
