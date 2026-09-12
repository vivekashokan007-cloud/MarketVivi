# Market Radar: final implementation plan for Grok Bot

**Date:** 12 September 2026  
**Prepared for:** Vivek Ashokan P  
**Purpose:** Convert the Codex audit and Claude's merged review into an ordered, testable implementation programme.  
**Decision:** Repair data integrity and measurement first. Keep predictive training frozen and live execution disabled. Establish a stable paper policy before evaluating model, sizing or automation improvements.

## 1. Grok's assignment and boundaries

When Vivek assigns this plan for implementation, work through the implementation packages below and produce concrete, reviewable commits, tests, migration files and release notes. This document itself records a plan; no implementation, database repair or deployment was performed while preparing it.

Publishing is currently paused at Vivek's request. Prepare changes in isolated local branches/checkouts. Do not push, merge, publish an APK/PWA, run a production migration/backfill, or enable live orders unless Vivek subsequently authorizes that action. Complete the local implementation and available validation before presenting a release decision. Do not ask for confirmation on routine coding choices.

Repositories:

- [Marketapp](https://github.com/vivekashokan007-cloud/Marketapp): Android/Kotlin services, Chaquopy Python brain, evaluator and supporting tools.
- [MarketVivi](https://github.com/vivekashokan007-cloud/MarketVivi): PWA, trade-close persistence and UI.

Fetched origin/main on both repositories while preparing this plan:

| Repository | Reviewed origin/main | Version |
|---|---|---|
| Marketapp | `1d6b7f7504cc92e1157448489dad816d7790443e` | 2.6.35 / b466 |
| MarketVivi | `6533917d8833905f5b5a890654c76684791d0efd` | Labels for 2.6.35 / b466 |

Read applicable repository instructions on the actual checkout. Fetch again at implementation start and inspect any new diff before applying this plan. Do not overwrite other contributors' work. Existing unpublished notification work, including Marketapp commit `11353cb`, is a separate change set: inspect and preserve it, do not blindly cherry-pick or silently include it in a strategy experiment.

## 2. Final adjudication of Claude's merged review

The core ordering is sound. The following refinements are mandatory because otherwise the repair could introduce another unmeasured strategy change.

| Claude proposal or conclusion | Final disposition | Reason / implementation implication |
|---|---|---|
| Secure database permissions first | **Accept, with a coordinated authentication migration** | Both grants and policies permit anonymous writes. A bare revoke would break the APK's legitimate recording. Protect all dependent tables, views and callable functions, not just the five headline tables. |
| Fix archive RLS | **Accept** | A fresh metadata query confirms `ml_recommendation_outcomes_archive.relrowsecurity=false`. Inventory its grants/dependencies and restrict it as archival data. |
| Switch calibration to trustworthy net outcomes | **Accept, across every calibration consumer** | Changing one strategy win counter is insufficient. All buckets, streaks, averages, exit-learning and history-derived risk statistics need the same input contract. |
| Admit only `pnl_engine='RECONCILED'` | **Replace with an explicit eligibility validator** | In the audited inventory, the 60 RECONCILED records have no net labels; the recent 92 net-labelled rows have a null engine flag. Neither flag alone establishes eligibility. Missing-cost legacy rows must not become net winners. |
| Contaminated calibration caused the reported `p_ml` correlation of -0.29 | **Treat as an unproven causal hypothesis** | `p_ml` is produced by `engine.predict`, with an optional temporal blend. Closed-trade calibration influences other decision paths, but a direct causal chain to the reported raw-model correlation has not been demonstrated. Retraining is disabled. Version mixing and trade-selection bias also matter. |
| Remove `p_ml` from entry confidence immediately | **Do not change the active gate on this evidence** | This can admit previously blocked entries. First separate score meanings and compare explicit shadow variants on the same candidate menus. Preserve construction, quote, friction, capital and domain-validity safeguards. |
| Write daily performance metrics | **Accept, after defining metric meaning and grain** | Existing `ml_performance` is not an adequate experiment ledger: it lacks target, policy, evaluation-run and cohort identity. Do not put a new metric into `accuracy_all` under an old meaning. |
| Fix missing top-level `peak_pnl` | **Accept with bounded repair** | All 97 recent net-labelled closed paper trades have top-level peak=0; 64 contain a positive journey peak. Across all 268 closed trades, 98 already have nonzero top-level peaks. Do not overwrite all historical peaks. |
| Sizing arithmetic and backtest are version-independent and safe | **Accept fee decomposition as arithmetic; defer performance claim** | Selection changes, capital, concurrency, margin, fill/slippage, order splitting and sample choice affect sizing returns. The patch, 627-test result and +38,633 backtest were not supplied for independent review. Advisory output can still influence behavior. |
| NF/BNF separation and BNF construction change | **Add measurement dimensions now; defer behavioral change** | Instrument metadata must be correct now. Adding an ML feature changes the feature schema and needs a compatible retrained artifact; a new BNF construction rule needs controlled evidence. |
| Do not revive the failed DTE-scaled target experiment | **Accept for this release scope** | Preserve the negative result and its code/data provenance. It is evidence against that tested variant, not proof that every alternative exit policy is harmful or that BOOK always executes an exit. |

### What the profit reconciliation means

| Paper cohort | Trades | Gross | Recorded friction | Recorded net |
|---|---:|---:|---:|---:|
| Net label present, engine flag null | 92 | Rs 22,025.00 | Rs 20,791.88 | **Rs 1,233.12** |
| Net label present, engine UNKNOWN | 5 | Rs 0.00 | Rs 994.29 | **-Rs 994.29** |
| Combined | 97 | Rs 22,025.00 | Rs 21,786.17 | **Rs 238.83** |

Fresh SQL confirmed the two component cohorts. These are recorded paper costs, not independently verified cash brokerage payments. Keep both cohorts visible in research reports. The five UNKNOWN rows should remain in accounting sensitivity reports while excluded from learning until reconciled. Do not delete losses to improve results, and do not call either cohort certified clean.

The 92-row cohort becomes **-Rs 702.12 without its best trade**, or **-Rs 1,066.88 with another Rs 25 of cost per trade**. Neither headline net figure establishes an edge. Claude's selector, BNF and correlation statistics remain useful hypotheses; their underlying queries, data and variant hashes must be reproduced before they justify a new decision rule.

## 3. Delivery order and dependency gates

Priority expresses risk, not permission to make an unreviewed production change. Security and calibration repair can be developed independently; both must pass before a new measured baseline is released.

| Package | Deliverable | Depends on | Release effect |
|---|---|---|---|
| G0 | Evidence manifest, current baseline and reproduction fixtures | None | Read-only foundation |
| G1 | Authenticated access and staged database permission migration | G0 | P0 data integrity |
| G2 | Validated net calibration and correct cache invalidation | G0; deploy with compatible G1 contracts | P0 learning integrity |
| G3 | Peak/trough persistence fix and dry-run repair tool | G0; production writes through G1 | Recording correction |
| G4 | Versioned net-outcome and executable exit-policy contract | G2, with G3 provenance for extrema | Explicit policy revision |
| G5 | Durable evening-stage ledger, truthful completion and bounded C3 repair | G1, G4 | Reliable learning-data production |
| G6 | Versioned performance ledger and shadow comparisons | G4, G5 | Measurement without automatic promotion |
| G7 | Frozen paper baseline and forward evaluation | G1-G6; selected notification fixes verified | Start a new experiment |
| G8 | Repair dormant training and champion/challenger tooling | G4-G6 | Offline/shadow only; training freeze remains until separate gate |
| G9 | Sizing, NF/BNF and ML-gate research variants | G6, G7; supplied patches reproduced | Separate experiments, no automatic adoption |
| G10 | Broker order manager and independent risk/watchdog | Separate future scope | Required before any live automation |

Each package gets a focused commit or reviewable change set. Infrastructure corrections and strategy changes must have separate release notes and version identity. Do not combine everything into one large patch that makes regression attribution impossible.

## 4. G0 — preserve evidence and reproduce the actual baseline

**Files to inspect:** repository instructions, `brain.py`, `ml_train.py`, `ml_temporal.py`, `MarketMLService.kt`, `SupabaseClient.kt`, `MarketWatchService.kt`, `PositionTickService.kt`, `PositionPolicyV1.kt`, `OrderExecutionService.kt`, `MainActivity.kt`, PWA `app.js`, and `tools/backfill_ml_evaluation.py`.

Deliver an audit manifest containing source SHAs, app/build version, model and teacher-asset hashes, schema/migration version, source-data cutoff, query text and relevant row counts. Explicitly separate recorded decision versions from the version used to re-evaluate them later. Exclude secrets from all artifacts.

Reproduce the critical fixtures and current cohorts before changing behavior. The prior audit ran **605 Python unittest tests successfully** on the pinned baseline. That is a historical baseline result, not a promise that the latest checkout or Claude's unprovided 627-test patch passes.

Useful existing test command from the Marketapp repository root:

```bash
python3 -m unittest discover -s app/src/main/python/tests -q
```

Discover Android/Gradle and PWA checks from the current build and CI configuration. Record actual commands, exits and any blocked dependency/device validation; do not count unrun checks as passed.

**Acceptance:** current SHA and diff are documented; pre-fix probes demonstrate the defects; source-data queries are reproducible; unrelated work is preserved. If Claude's sizing patch or original research queries are unavailable, mark G9 evidence pending and continue G1-G8 preparation.

## 5. G1 — secure the data without breaking recording

**Primary surfaces:** `SupabaseClient.getBaseRequest`, PWA data client/authentication, NativeBridge credential/session handling, database grants/RLS/functions/views, manual evaluator credentials and offline retry queues.

### Required access design

Create an access matrix before writing migrations. Distinguish:

- User/account trades and private decision history: authenticated ownership; server verifies account association. A client-supplied owner ID is not authority.
- Raw device observations: scoped submissions with validated identity and idempotency keys.
- Evaluated outcomes, quality attestations, repair records and model promotion: controlled server-side writers. Do not trust a client merely because it claims an evaluation is verified.
- Global configuration versus per-user settings: separate their mutation rights; do not apply a fictitious owner column to every shared table.
- Archives: restricted read where needed, no public mutation.

Inventory at least all three outcome tables, their archives, snapshots, trades, `app_config`, `ml_models`, `ml_performance`, percentile history, evaluation jobs and sandbox records. Also inspect exposed views, functions/RPCs, role inheritance and default grants. Revoke unnecessary maintenance privileges such as TRUNCATE in addition to ordinary writes. An SQL TRUNCATE grant is a separate privilege; do not describe it as a normal REST DELETE route.

Use real authenticated ownership predicates. `TO authenticated` alone is insufficient. UPDATE needs appropriate SELECT access and both existing-row and new-row ownership checks. Restrict privileged functions, pin their search path and validate authorization if a security-definer function is genuinely required. Avoid using one to bypass a missing policy.

Keep privileged credentials on trusted infrastructure. Do not put a service-role key in APK/PWA configuration, logs or Git. Prefer a narrowly scoped authenticated write API; validate payload shape, account scope, replay identity and permitted state transitions server-side.

### Migration and rollout sequence

1. Prepare versioned migrations and a staging/local copy with representative records. Record ownership mappings explicitly; never infer all historic rows belong to whichever user signs in first.
2. Add the secure ingestion/read path and compatible client session handling. Verify refresh, expiry, restart and account switching.
3. Prove the complete legitimate write cycle: trade open/close, snapshot creation/readback, evaluation persistence, percentile finalization and retries.
4. In staging, revoke broad grants and replace permissive policies. Test both allowed and forbidden access.
5. Prepare a coordinated production cutover plan for the approved client/server pair, including how older clients retain unsynced work safely. Do not leave an undocumented permissive compatibility endpoint.
6. After a separately authorized cutover, verify the new access matrix and legitimate recording immediately.

**Acceptance tests:** unauthenticated reads of private data and writes are denied; another authenticated user cannot read/update/delete another account's rows or reassign ownership; owner operations succeed; trusted evaluator writes succeed; duplicate replay does not duplicate records; 401/403/network failure does not discard queued work or clear risk-relevant local state; archive and alternate RPC/view paths cannot bypass restrictions.

**Rollback:** return to a compatible secure service/client or retain work in the local queue while disabling affected writes. Do not restore anonymous unrestricted writes as the routine rollback. Prepare recovery of business operation separately from reversal of unsafe permissions.

## 6. G2 — one trustworthy input adapter for all calibration

**Primary files:** `brain.py` (`build_calibration`, history-driven risk helpers and calibration consumers), `SupabaseClient.getClosedTradesOrNull`, `ClosedTradeLedger`, NativeBridge closed-trade transport and PWA close writes.

Introduce a shared calibration-input normalization/validation contract. Function/module names are implementation choices; the behavior below is mandatory.

### Eligibility

- Require CLOSED status, a stable trade ID, a coherent execution mode and valid instrument/leg/lot identity.
- Exclude UNTRUSTED_INCOMPLETE_STRUCTURE, PNL_BASIS_DIVERGENT and UNKNOWN from learning until a traceable reconciliation establishes validity. Do not destructively remove their accounting records.
- Require finite, supported net P&L and cost provenance. Where reconstruction is possible, derive `gross - costs` with the correct units, no double subtraction, and a documented rounding tolerance. Reject inconsistent provided net values.
- RECONCILED without validated costs/net remains ineligible. A null flag is neither an automatic pass nor a permanent rejection: validate its structure, valuation and cost evidence and record the result.
- Retain separate populations for live fills, paper/manual closures and counterfactual teacher outcomes. Do not silently combine their win rates. Keep intraday and overnight/manual behavior distinguishable.
- Use only outcomes available before the decision/replay timestamp. Record both trade time and availability time so late backfills cannot leak future knowledge into a historical decision.

### Consumers and caching

Compute wins, averages, streaks, VIX/strategy/width/time buckets and history-derived risk suggestions from the same eligible net series. Trace all uses of `actual_pnl` in these learning paths; do not globally rename the field because accounting and gross diagnostics still need it.

Do not compare net exit P&L to a gross peak in capture statistics. Until compatible net extrema exist, disable that learning statistic or label it as a gross diagnostic. Convert time buckets using Asia/Kolkata, not an unconverted UTC hour from the stored timestamp.

Replace the current `count + sum(gross)` cache signature. Hash stable IDs, revisions, relevant normalized net/quality/context fields, cohort identity and contract version. A change of quality flag, cost or bucket assignment must invalidate the cache even when count and total gross are unchanged.

Prefer enforcement at ingestion/query boundaries **and** in the Python adapter: local pending rows and offline caches can bypass a server-only filter. Do not merely filter after fetching the latest 200 dirty rows and assume that means 200 eligible observations; report eligible coverage and page/select deterministically if more history is required.

If valid support is insufficient, return an explicit unavailable calibration and apply the documented deterministic fallback. Preserve hard entry/risk safeguards. Remove statements such as “Edge confirmed” based on a handful of wins; display sample support and uncertainty instead.

**Acceptance fixtures:** gross +100/cost 200/net -100 counts as a loss; flagged positive rows are excluded; absent costs never become zero costs; valid negative/zero P&L is retained; duplicate IDs are deduplicated; invalid/nonfinite values fail validation; RECONCILED/missing-net is rejected; null-flag rows require evidence; paper/live populations remain separate; late outcomes are excluded from prior replay; changing only a net value, quality flag or bucket field invalidates the cache; empty support never reuses stale calibration. All learning consumers use the same admitted IDs.

**Rollout:** compare old and corrected calibration in replay, document every changed decision and start a new experiment identity when adopting corrected calibration. Fixing a defect still changes behavior.

## 7. G3 — repair peak/trough recording with provenance

**Confirmed source defect:** PWA `closePatch` writes top-level `trough_pnl` but omits top-level `peak_pnl`; it includes peak in nested `journey_stats` and `close_trace_json`. A separate ML outcome update includes a peak field, which does not fix the `trades_v2` omission.

**Fresh measurements:** 97/97 recent net-labelled closed paper trades have top-level peak=0; 64 have a positive journey peak. Across all 268 closed trades, 170 have peak=0, 98 have nonzero peaks, and 110 have a positive journey peak with an empty/zero top-level peak. These are diagnostic counts, not an automatically approved list to backfill.

Implementation:

1. Define gross and net extrema explicitly: unit, lot quantity, price basis, source, observation interval, timestamp and coverage. Preserve the existing top-level field's documented basis; do not overwrite a gross field with a net value.
2. Use one normalized close payload for server writes, native local ledger and queued retries. Include both peak and trough with validity metadata.
3. Audit every close path, not only manual close: tick/shadow close handling, auto paper close if present, native-only path and restart recovery.
4. Preserve valid extrema across reload/retry. Unknown is null/unknown, not a fabricated zero. An actual zero is valid when supported by observed marks.
5. Create a dry-run repair tool listing IDs, old/new values, source/basis and exclusions. Prefer consistent underlying tick evidence when available; otherwise use nested journey values only when identity, units, basis and period are verified. Conflicting evidence goes to review.
6. Future authorized writes must be idempotent and compare the expected old revision/value before updating. Do not overwrite a better valid peak, change actual/net P&L, or automatically activate exit learning from repaired gross extrema.

**Acceptance:** a known positive peak survives close, offline retry and restart at every persistence destination; valid zero remains zero; unknown remains unknown; positive-only copying cannot corrupt a negative-only series under its declared extrema convention; duplicate repair has no further effect; concurrently changed rows are skipped and reported; untrusted structures are not relabelled trustworthy just because their peak was copied.

**Rollback:** keep per-row before/after values and repair identity; restore only unchanged repaired revisions. Reverting client code must not erase successfully captured historical extrema.

## 8. G4 — version the net target and executable exit policy

Create a checked-in policy specification and shared conformance fixtures before wiring consumers. Keep the existing 0.50 target and 0.60 credit-loss multiplier as the initial reference parameters; do not add DTE scaling or optimize thresholds in this package. Net-basis alignment is itself a declared new policy version.

### Required contract fields

| Area | Required definition |
|---|---|
| Identity | Contract/policy version, instrument and expiry, index, strategy, execution mode, decision time and candidate/trade identity |
| Quantity | Effective-date lot metadata; explicit lots and units; no conflation of per-unit premium and total currency |
| Entry | Executable price convention; quote age/quality; complete legs; cost estimate using information available at entry |
| Net target | Net P&L = executable gross P&L minus applicable costs exactly once; win is net > 0, flat is explicit, unavailable is null |
| Exit | Trigger price/P&L basis, stop/target precedence, published-threshold composition, EOD/overnight policy and executable fill assumptions |
| Extrema | Gross/net basis, timestamps, coverage and whether values are post-entry observations or projections |
| Provenance | Data cutoff/availability, input hashes, model/feature/selector versions, evaluator hash and source quality |

For the initial intraday conformance policy, retain the currently declared PositionPolicyV1 **15:15 IST exit intent** as the reference cutoff, and implement it consistently in the new teacher/monitor policy. Do not confuse this voluntary exit time with the exchange close. Prevent new intraday entry at/after its exit cutoff. Overnight/manual holds need their own explicit policy/cohort, not forced same-day labels. A later change to the cutoff is a separately versioned experiment.

Preserve market-open and per-segment close handling separately; current native services use 15:40 while a Python readiness helper uses 15:30. Use shared schedule/status input and documented fallback/holiday handling rather than unrelated hardcoded windows.

Keep legacy `canonical_won`, H2 and TP-hit semantics readable for compatibility. Add/version the new learning target and migrate consumers explicitly; do not silently rewrite the meaning of historical columns. A positive EOD exit can be a net win even if it never hit TP. Teacher outcomes and actual fills can share a policy definition while retaining different evidence grades.

Entry-time thresholds must not use later closing quotes or realized future costs. Monitor decisions must use only data then available. Preserve realized gap/slippage losses when the next executable mark crosses a stop; do not clip losses to the threshold. Do not invent a closing fill when final executable quotes are missing.

**Acceptance:** on the same ordered event/quote stream, Python teacher and Kotlin monitor agree on entry validity, trigger precedence, exit reason, timestamp and P&L within the documented currency tolerance. Cover positive EOD/non-TP, zero net, missing/late quotes, gap through stop, differing lot sizes, incomplete legs, published thresholds, no entry after EOD intent, and explicit overnight policy. A five-minute-only replay is labelled approximate and cannot be certified equivalent to an unobserved tick path.

## 9. G5 — make post-close completion truthful and restartable

**Primary files:** `MarketMLService.runDayEvaluation`, `runC3PercentileFinalization`, Supabase evaluation/percentile helpers, `EvaluationIdentity`, local checkpoint/cache classes, NativeBridge/PWA status displays, and `backfill_ml_evaluation.py`.

Create a durable evaluation-run identity keyed by session, owner/scope, policy/label contract, input manifest and evaluator version. Local preferences can cache status but must not be the only completion record.

Track independent stages:

1. Input coverage and identity reconciliation.
2. Outcome computation.
3. Outcome persistence/readback verification.
4. Research/aggregation output.
5. Percentile finalization and provenance validation.
6. Performance metrics.

Track training and promotion separately as **disabled/not attempted** until enabled by their own gates. Provide stage states such as pending/running/verified/failed/ineligible, reason codes, expected/written/verified counts, start/end times and last error. “Labels saved” must remain visible even when C3 fails, and the UI must not call that “learning complete.”

Preserve the current identity-reconciliation, checkpoint and no-reinsert-on-ambiguous-confirmation protections. Enforce one active run per identity or a safe lease; repeated manual/device/backfill attempts must converge without duplicate or cross-date outcomes. A changed input manifest or evaluator creates a new revision, not an undocumented overwrite of earlier evidence.

### September 10-11 and C3

The prior audit found outcome rows present and no C3 rows for these dates. September 7-9 daily calibration records are provenance-unverified; some poll/supply records have accepted population metadata. Recheck the exact current state before any repair.

Build a stage-specific dry run for the missing C3 work using original captured frames and eligible historical inputs. Never mark a capped/incomplete candidate population as an uncapped verified one merely to make the reader accept it. Do not reconstruct historical inputs using future knowledge. Distinguish historically available context from a later corrected-research replay.

If original evidence is insufficient, record **ineligible/unreconstructable with a reason**, retain the outcome success, and start trustworthy collection prospectively. A missing historical stage is not repaired by fabricated rows. The manual backfill tool should state exactly which stages it ran and verified.

**Acceptance:** crash/restart resumes the right stage; duplicate concurrent request does not duplicate outcomes; failed research/C3 cannot masquerade as full success; valid identity readback does not repost accepted snapshots; nonlabelable snapshots are explicitly accounted for; partial quote coverage is visible; historical seed respects cutoff/availability; capped populations fail provenance validation; no repair changes another session; full completion requires every applicable stage verified or explicitly explained as ineligible.

## 10. G6 — measure actual predictive value and policy economics

Do not remove `p_ml` first and then measure the new trade sample. Log the same menus under controlled variants so the counterfactual is inspectable.

### Performance data contract

Current `ml_performance` contains `date`, legacy accuracy windows, `model_version`, prediction/take/skip counters and drift fields. The dormant writer stores a training accuracy in `accuracy_all`, upserting on date. It does not distinguish policy/target/cohort variants.

Add a properly keyed evaluation-metrics table, or migrate this table only if old consumers remain semantically compatible. Minimum identity: run, session, model hash, feature schema, policy/selector version, net-target version, cohort/execution mode and variant. Retain source counts, exclusions and data availability. Make writes idempotent by this identity; a date-only overwrite is insufficient.

Metrics must separate:

- Raw `p_ml`, deterministic market fit, final entry score, ML action/domain flags and final recommendation. An entry score such as `min(market_fit, p_ml*100)` is not automatically a calibrated probability.
- Prediction calibration: eligible joined count, missing coverage, reliability-bin support, Brier score and a documented classification threshold if accuracy is reported. Missing outcomes are not losses or zeros.
- Policy economics: net expectancy, profit factor, turnover, costs, exposure, closed/open equity drawdown and loss tails under executable constraints.
- Prediction/menu observations versus actually selected entries, paper closures and broker fills. Repeated overlapping candidates are not independent trades.
- NF/BNF, strategy, DTE, regime, execution mode and policy version. Report thin slices as insufficient support.

### Controlled comparisons

Implement feature-flagged **shadow** variants that preserve the active policy initially:

1. Corrected net-calibration baseline with the existing ML entry integration.
2. Remove only the numerical `p_ml` cap from entry confidence, leaving the remaining declared ML action/domain conditions and every non-ML hard guard intact. Log exactly which decisions differ.
3. A fuller ML-free deterministic policy, if investigated, must define independent domain/missing-input validity explicitly; it is a separate research variant, not a blanket removal of all ML-related checks.

Compare identical eligible menus, common capital/concurrency rules and timestamped availability. Hold the sizing rule fixed. Report WAIT quality separately. Use session/time-grouped splits and prevent identical/overlapping decision paths leaking across train/test. Hindsight-best candidates remain diagnostic upper bounds, not the attainable strategy benchmark.

**Acceptance:** daily metrics can be recomputed from immutable inputs; zero eligible predictions yields unavailable metrics with n=0; mixed model/target versions cannot be silently pooled; realized and hypothetical P&L cannot be summed together; retry is idempotent; the active recommendation does not change when shadow variants are enabled; confidence decomposition is visible and correctly named.

**Promotion gate:** the reported -0.29 correlation alone cannot authorize removing an entry gate. Require the corrected, versioned, forward comparison to support the change under realistic costs and drawdown limits.

## 11. G7 — freeze a paper experiment after the repairs

Select and tag one compatible Android/PWA/database/policy/model bundle after G1-G6 and the chosen notification repairs pass. Record configuration and asset hashes, not only an app label. An operationally necessary bug fix creates a documented new experiment segment when it changes data or decisions.

Before observing the test period, write the instrument universe, eligible sessions, entry/exit policy, sizing/capital/concurrency assumptions, costs/slippage stress, benchmarks, metrics and stopping/review criteria. Choose support requirements based on observed variance and a meaningful net effect. Do not promise validation after an arbitrary count of trades or a few profitable days.

Run prospectively in paper mode. Compare the deterministic benchmark and declared shadow variants. Include all eligible sessions and report exclusions; do not change thresholds after seeing an adverse day and continue calling it the same test. Use session/block-aware uncertainty and disclose overnight/overlapping exposure.

**Acceptance:** complete forward lineage; functioning post-close stages; no hidden parameter/version drift; net economics and drawdowns computed under the declared account constraints; sample support sufficient for the conclusion being made. Passing this gate establishes evidence for a specific tested policy, not automatic permission for real trading.

## 12. G8 — repair dormant training without enabling it

After contracts and metrics are ready:

- Repair `exportAppTrades`: `paper=eq.REAL` is incompatible with the boolean column; `date.asc` is not the trade timestamp schema. Use coherent execution-mode/quality filters and the correct timestamp.
- Export by eligible decision/session coverage with deterministic paging and joins. Independent 1,000-row caps on outcomes and snapshots do not guarantee 1,000 usable primary decisions.
- Replace H2-as-net training conversion with the versioned net target; preserve old labels as diagnostics.
- Repair Kotlin's five-argument temporal call versus Python's four-argument function and implement an explicit real-sequence path. Synthetic sequences must be marked synthetic and cannot certify real-path performance.
- Use chronological/session-grouped training, separate probability calibration/threshold selection and untouched test periods. Prevent repeated/overlapping candidates and late-arriving outcomes from crossing boundaries improperly.
- Compare champion and challenger on the same untouched data with the same economics and constraints. Do not compare new validation metadata against an old model's unrelated stored accuracy.
- Produce immutable model artifacts, model cards/manifests, compatibility checks and a tested rollback to the last approved artifact.

**Acceptance:** typed exports return the intended population; real-sequence fixture reaches the real trainer; no known future data enters features; model/feature schemas reject incompatible artifacts; both models are evaluated on a common test; promotion is an explicit separate step.

Keep `ml_train.run` and `online_update` production freeze in place while building/testing this offline path. Re-enabling training and allowing automatic model promotion are separate decisions. A better accuracy score alone is insufficient.

## 13. G9 — queued research, not bundled fixes

### Position sizing

Obtain Claude's exact patch, commit/base, test list, backtest script, input hashes and assumptions before reviewing the +38,633 result. Reproduce the fixed/variable fee calculation separately from the strategy return claim. Test unit/lot conversion, cost caps and per-order effects, minimum lot, margin constraints, concurrent positions, liquidity/slippage scaling, adverse gaps and zero-trade behavior. Use the same data, capital and risk budget for fixed versus proposed sizing.

Keep output shadow-only first. A suggestion visible to the user should be labelled experimental and must not silently change the trade quantity or risk limit. Increased size must not be used to make weak per-trade economics look robust. No patch gets accepted solely because “627 tests pass.”

### NF/BNF and ML schema

Add index/DTE/regime dimensions to observability now. Validate index-specific instrument identity, expiry and lot metadata as correctness work. Evaluate index-specific teacher buckets with adequate support and a documented fallback; sparsely supported buckets must not claim certainty.

A new ML index feature requires a new feature schema and compatible trained artifact. Do not insert it into the current vector while loading an old model. Retest any BNF construction rule and ML-gate change prospectively as separate variants.

### Exit target experiment

Archive the DTE-scaled target patch and reported -7,202 result with provenance if supplied. Do not rebuild it in this implementation programme. Preserve the distinction between a BOOK signal, a recorded close and a verified broker fill.

## 14. G10 — future automation gate

Current `OrderExecutionService` is sandbox-only. Sequential submission does not establish successful hedge fills and does not halt safely on every failed child response. Keep its live path disabled.

A later implementation requires a persistent broker order/position state machine, idempotent recovery after ambiguous timeout, hedge-before-short fill confirmation, partial-fill and rejected-leg recovery, broker reconciliation, margin/exposure checks, account-level realized plus unrealized loss limits, independent heartbeat/feed/auth watchdog and an exercised emergency exit/kill procedure.

LLM assistants may analyze logs, propose experiments and explain decisions. They must not bypass deterministic trading/risk rules or become the only mechanism ensuring a position is protected. Use a reliable supervised execution host with current broker network/API requirements; the phone remains a dashboard/control client.

Fault tests must cover lost feed, stale quotes, token expiry, partial fills, failed hedge, rejected exit, process restart and broker/app position mismatch. These operational gates are independent of profitability. Live trading still requires explicit scope and authorization from Vivek.

## 15. Required review bundle and release report

For each package, Grok must provide:

1. **Why:** defect and affected user/learning behavior.
2. **What:** base SHA, commit/diff, changed files, schema/contract version and dependencies.
3. **Evidence:** pre-fix reproduction, post-fix assertion, actual commands/results, row counts and excluded cases.
4. **Behavior impact:** whether recommendations, risk, sizes, recorded values or only observability change.
5. **Migration:** staging result, dry-run IDs/counts, ownership mapping and retry/idempotency behavior where relevant.
6. **Recovery:** rollback or forward-recovery steps that retain data and secure access.
7. **Status:** ready for review / blocked with exact cause / deferred hypothesis. No “done” label for an unverified downstream stage.

Use staged release candidates so urgent security work does not wait for model research:

- **Release A: secure access.** G1 can be released when its coordinated client/server migration and legitimate-write tests pass. It does not depend on completing G4-G9. G2 can accompany it if ready; otherwise provide explicit calibration containment and its behavior impact for review.
- **Release B: recording and calibration.** G2/G3, with compatible secured writes and reviewed repair manifests. These are correctness fixes, not claims of improved profitability.
- **Release C: measurable paper baseline.** G4-G6 and selected, verified notification fixes, on top of A/B. Start G7 with a complete version manifest.

Every candidate keeps live execution and predictive training frozen. G8/G9 proposals remain separate. Prepare each coordinated deployment sequence and concrete review bundle; request its final publishing/cutover decision only after the authorized preparation is complete. The checklist below is for the complete measured baseline; apply each earlier release's relevant security and compatibility gates without delaying urgent protection for unrelated research.

### Release acceptance checklist

- [ ] Anonymous and cross-account access blocked; legitimate authenticated recording and server evaluation demonstrated.
- [ ] Every calibration consumer uses eligible net inputs; missing evidence is unavailable, not silently profitable.
- [ ] Peak/trough persist across close/restart/offline retry; any historical repair has a reviewed ID manifest.
- [ ] One declared exit/label contract passes Python/Kotlin conformance; legacy metrics remain explicitly identified.
- [ ] Labels, research, C3 and performance have separate truthful, restartable completion states.
- [ ] Historical C3 gaps are either verified from original evidence or explicitly ineligible; no fabricated provenance.
- [ ] Performance metrics have model/policy/target/cohort identity and keep hypothetical versus realized outcomes separate.
- [ ] Existing ML gate remains active unless a separately reviewed controlled comparison justifies a change.
- [ ] New baseline contains exact Android/PWA/schema/model/configuration hashes.
- [ ] Actual Python, relevant Kotlin/PWA integration and device checks are recorded; blocked checks are visible.
- [ ] No live orders, automatic training promotion, sizing adoption or unreviewed strategy changes included.
- [ ] Vivek's publishing pause has been explicitly lifted before any push, deployment or production write.

## 16. Evidence and primary references

Inputs reviewed in full:

- Claude: `MERGED_RECTIFICATION_PLAN_20260912.md`, supplied with this request.
- Codex: `Market_Radar_Full_Audit_2026-09-12.pdf` and its evidence pack from the preceding audit.
- Both fetched repository baselines listed in section 1; focused data-flow and persistence inspection.
- Fresh read-only SQL: archive RLS metadata; 92/5 profit cohort reconciliation; full and recent peak-field composition; `ml_performance` schema.

Important source anchors:

- `brain.py`: `_ml_score` (101), `build_calibration` (1270), `candidate_pattern_match` (1542), `annotate_candidate_entry_eligibility` (14671), enriched `engine.predict`/temporal path (15700s), teacher/evaluator functions (20972/21189).
- `MarketMLService.kt`: training freeze (1782), temporal interface (1954), legacy performance writer (2021), trade export (2065), C3 finalization (2117), evening evaluation (2178).
- `SupabaseClient.kt`: anonymous request authentication (66), latest-200 closed-trade query (997), percentile provenance readers and writes.
- `MarketVivi/app.js`: manual close payload (3440s), journey capture (3529), separate ML outcome payload (3560s), reload path (6550s).
- `PositionTickService.kt` / `PositionPolicyV1.kt`: shadow exit composition and 15:15 policy intent.

Current Supabase documentation confirms that table privileges and row policies are separate checks, authenticated role membership alone does not establish ownership, and privileged keys belong server-side: [Row Level Security](https://supabase.com/docs/guides/database/postgres/row-level-security). The changelog endpoint did not render through the available web reader; verify relevant current SDK/CLI documentation again during implementation before choosing API signatures or migration commands.

### Read-only peak checks used for this review

```sql
SELECT count(*) AS n,
       count(*) FILTER (WHERE peak_pnl = 0) AS peak_zero,
       count(*) FILTER (WHERE peak_pnl <> 0) AS peak_nonzero,
       count(*) FILTER (
         WHERE jsonb_typeof(journey_stats->'peak_pnl') = 'number'
           AND (journey_stats->>'peak_pnl')::numeric > 0
           AND coalesce(peak_pnl, 0) = 0
       ) AS journey_positive_column_empty
FROM trades_v2
WHERE status = 'CLOSED' AND paper = true AND net_pnl IS NOT NULL;
```

Observed: `n=97, peak_zero=97, peak_nonzero=0, journey_positive_column_empty=64`.

These counts are a snapshot taken during review, not hardcoded expected production migration totals. Grok must rerun diagnostics and validate the actual repair population before preparing any write manifest.
