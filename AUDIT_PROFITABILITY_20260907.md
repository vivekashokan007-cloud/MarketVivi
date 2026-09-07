# Market Radar profitability audit — 2026-09-07

## Verdict

The app has useful safety machinery and a small encouraging eligible-signal cohort, but **a repeatable, executable net-profit advantage is not established**. The highest-value work is to make the profit target, valuation, labels, risk inputs, and evaluation agree. More indicators, more trades, larger positions, or weaker OOD guards are not evidence-backed solutions.

This is a targeted audit of the profitability-critical paths, not an exhaustive line-by-line/security audit or a completed portfolio backtest. Recommendations below are proposals, not implemented changes or guarantees.

## Scope and evidence

- Marketapp: `1f928d7389ab89f8d836b9038650ace9d6457105`.
- MarketVivi: `54af42cf1f0d09757ae2406dece64c32804fd8fc`.
- Release identities: Android/Kotlin 2.6.16/build 447, Python 2.6.16, PWA 2.6.16/b447, cache 1323.
- Read-only production SQL on 2026-09-07; latest inspected snapshot 5456, 09:10:45 UTC / 14:40:45 IST. Queries were separate reads, not one frozen transaction.
- Closed-trade cost cohort: entry dates July 20–September 4. Teacher-outcome cohort: August 3–September 4. **These historical results do not establish performance of today's 2.6.16 release.**
- Reproducible queries: [AUDIT_PROFITABILITY_20260907.sql](AUDIT_PROFITABILITY_20260907.sql).
- Standing project history was consulted, including the August 26 retractions. Its historical oracle, calibration, and family-comparison figures were not independently reproduced here.

## 1. Recorded costs erase the matched paper-trade cohort's gross profit

Exactly 94 closed paper trades have net P&L recorded:

| Same 94 trades | Result |
|---|---:|
| Gross P&L | ₹19,393.00 |
| Recorded estimated costs | ₹21,212.21 |
| Net P&L | **−₹1,819.21** |
| Mean net per trade | −₹19.35 |
| Net winners | 43 / 94 |
| Gross winners becoming net non-winners | 10 |

There are 265 closed records overall: 261 with `paper=true`, plus four legacy records with conflicting `execution_mode=paper` / `paper=false`. Thus only 94/265, about 35.5%, have net labels. No verified broker-filled live-profit cohort was established.

Do not compare the ₹399,861 gross total across all 261 paper records against the net total from only 94 records. They are different populations.

Within the 94-record cohort:

| Strategy / classification | Count | Gross ₹ | Costs ₹ | Net ₹ |
|---|---:|---:|---:|---:|
| BEAR_CALL | 40 | 6,103.00 | 8,006.84 | −1,903.84 |
| BEAR_PUT, engine NULL | 8 | 2,752.00 | 1,281.86 | 1,470.14 |
| BEAR_PUT, engine UNKNOWN | 5 | 0.00 | 994.29 | −994.29 |
| BULL_PUT | 5 | 1,850.00 | 945.60 | 904.40 |
| IRON_BUTTERFLY | 30 | 5,627.00 | 8,617.98 | −2,990.98 |
| IRON_CONDOR | 6 | 3,061.00 | 1,365.64 | 1,695.36 |

The six winning condors do **not** justify selecting condors exclusively. These are tiny, non-random, mixed-date samples with manual-close effects and incomplete valuation classification.

All 94 satisfy stored `net = gross - cost` arithmetic. That does not validate the underlying quotes, quantity, fills, or label provenance. Five have engine UNKNOWN; the other 89 have no engine classification. Across the broader 261-record paper history, 55 carry incomplete-structure flags and 29 failed-reconciliation flags; their overlap was not established. Those historical flags require reconciliation, not silent deletion or relabeling.

## 2. Existing eligibility looks more promising than trading every visible candidate

For `teacher_v1`, configuration `tc_2026_07_A`, and `price_integrity=OK`, the database has 1,571 primary and 220,097 secondary simulated outcomes across 25 sessions. Mean managed net P&L is −₹26.81 and −₹137.50 respectively.

But “primary” is not synonymous with “approved entry.” Joining outcomes to the original snapshot materially changes interpretation:

| Snapshot action and explicit entry eligibility | Outcomes | Sessions | Mean net ₹ |
|---|---:|---:|---:|
| SELL PREMIUM / true | 263 | 5 | **52.01** |
| WAIT / false | 168 | 5 | −215.96 |
| WAIT / true | 19 | 5 | 50.99 |
| SELL PREMIUM / missing | 665 | 16 | 50.03 |
| WAIT / missing | 434 | 19 | −85.53 |
| BUY PREMIUM / missing | 22 | 4 | −756.37 |

Missing eligibility must remain unknown, not be treated as false or reconstructed using today's rules. WAIT/true rows must not be counted as authorized entries; other verdict gates may still prohibit them.

The 263 explicitly eligible SELL PREMIUM outcomes break down as:

| Session | Outcomes | Mean net ₹ |
|---|---:|---:|
| August 27 | 14 | −191.19 |
| August 28 | 65 | −126.75 |
| September 2 | 57 | 189.28 |
| September 3 | 60 | −32.05 |
| September 4 | 67 | 234.74 |

Three of five session means are negative. Their equally weighted mean is approximately ₹14.81, versus ₹52.01 when weighting every candidate outcome equally. Neither is a portfolio return.

The candidate-weighted average gross result is ₹296.83 against ₹244.82 estimated costs. An illustrative 25% increase in those costs, with gross results unchanged, reduces mean net to approximately **−₹9.20**. This is sensitivity analysis, not a forecast of actual cost inflation.

**Opportunity to test:** enforce the distinction between authorized entries and monitor candidates, then evaluate the existing eligible selector prospectively with realistic position capacity. The comparison does not prove the gate caused better performance: strategy, date, and regime composition differ.

Hundreds of neighboring strikes and repeated five-minute entries share market paths. They are not hundreds of thousands of independent bets. Never sum all their hypothetical P&Ls into an achievable equity curve.

## 3. The ranking's “net edge” is not a demonstrated expected realized payoff

Source: Marketapp `brain.py`, `_net_probability_2leg`, `_net_probability_range`, `_apply_net_economics`, and `select_pc2_paper_primary`.

The net-economics helper computes:

```text
proxy = P(profit) × maximum net profit
        − (1 − P(profit)) × maximum net loss
```

The probability inputs include chain-delta/Black–Scholes-style breakeven approximations. The selection objective above is distinct from `p_ml`.

A probability of finishing profitable is not the probability of realizing maximum profit. Spreads have intermediate payoffs, and the app manages positions before expiry using exits and targets. Consequently the proxy is not, by construction, the expectation of the managed realized P&L.

A direct call to the existing helper reproduced this synthetic counterexample:

- Maximum profit ₹1,300, maximum loss ₹5,200, probability of profit 85%, zero costs.
- App proxy: **+₹325**.
- A lawful hypothetical payoff distribution within those bounds: 85% of outcomes earn ₹65; 15% lose ₹5,135.
- Actual expectation for that distribution: **−₹715**.

This proves the summary inputs do not identify true expected payoff. It does **not** establish that the app's actual market probability is wrong, nor quantify the bias in production. The August 26 probability-calibration finding and this payoff-target issue are different questions.

**Proposal:** retain the current selector as control. Shadow-test either a distribution-integrated payoff estimate with a matching exit horizon, or a calibrated managed-net-P&L estimate using only pre-entry information. Compare under the same risk/capital limits. Renaming a proxy does not create alpha; predictive improvement must survive held-out sessions.

Do not blindly switch to edge/risk, a percentile-first sort, a family quota, or the hindsight-best candidate. Existing project history already rejects several such shortcuts.

## 4. Model coverage and learning are separate from model confidence

Observed persisted BANKNIFTY candidates on September 2–4 were all OOD-flagged: 1,698/1,698, 1,731/1,731, and 1,776/1,776. At the audit's version-specific query time, 84/84 persisted 2.6.16 BANKNIFTY rows were OOD, versus 14/66 NIFTY rows.

These are capped persisted samples, not a census of the entire generated menu. They show a major support problem; they do not prove all excluded candidates would profit or that monthly DTE alone explains every flag.

The latest inspected BANKNIFTY butterfly had `p_ml=0.99`, `mlAction=TAKE`, and `entryEligible=false` with an OOD reason. High model scores are not reliable profit evidence outside training support.

A misleading diagnostic cascade was reproduced: when OOD is true, eligibility skips the neutral market-fit calculation, then emits `strategy_market_fit_unavailable` and `entry_confidence_unavailable`. The same supplied regime independently computes a market-fit score of 78.64. Thus these three reasons do not establish three independent failures; the latter two can be consequences of OOD. Preserve the block while improving explanatory telemetry.

Both training entry points are intentionally disabled:

- `ml_train.run` returns `retrain_disabled_pending_canonical_won_unification`.
- `ml_train.online_update` returns `online_update_disabled_pending_label_unification`.

Both early returns were executed and confirmed without accessing model files. The database `ml_models` table is empty, but a bundled model exists (artifact version 2.1.1, 8,372 training rows), and device-local models may exist. Artifact version is not the synchronized app release version.

**Proposal:** first unify net-profit labels and provenance, then inspect feature/DTE/VIX/strategy support and the actual device model identity. Validate new training offline with purged chronological splits and probability/payoff calibration. Do not simply turn training back on or relax OOD to increase trade count.

## 5. Profit labels and execution valuation still need one consistent contract

Source: `brain.py:compute_position_live`, `compute_live_friction_bridge`; MarketVivi `app.js:buildPaperPnlBreakdown` and `closeTrade`.

- The main position valuation uses positive leg LTPs; a “full” valuation means required LTPs are present, not that a simultaneous executable fill was available.
- Missing-leg intrinsic fallback is marked degraded, and the PWA blocks paper close for degraded/unavailable valuation. That protection should remain.
- The net bridge subtracts estimated friction from the supplied gross current P&L; it does not turn that P&L into a verified broker fill.
- PWA close stores gross `actual_pnl`, gross `canonical_won` / `outcome_h2`, and separately net `net_pnl` / `net_won`.
- The training label resolver prefers the gross-oriented canonical fields, which is one reason enabling retraining now would be premature.
- The newer tick service's executable-side diagnostics are a separate path. Its guard release does not demonstrate that every PWA close uses that valuation.

**Proposal:** distinguish LTP display marks, executable-side paper marks, and actual fill P&L. Require complete leg roles, correct quantities, synchronized sufficiently fresh quotes, and a versioned cost basis for research labels. When using bid/ask execution prices, charge actual fees and only residual slippage; do not also subtract the same spread twice.

Record both gross and net labels with explicit horizon/exit policy. Preserve historical fields, add a new canonical net-label version, and quarantine unreconciled records.

The code includes a 0.15% options-sale STT rate effective April 1, 2026, matching the current [official NSE STT schedule](https://www.nseindia.com/static/products-services/equity-derivatives-securities-transaction-tax). Therefore “add transaction tax” is not a new fix. Broker-specific fees, real spreads, fill behavior, and cost sensitivity remain to be reconciled.

## 6. Daily-loss protection has an input-wiring risk

Source: `brain.py:synthesize_verdict`, `daily_pnl_check`, and Android `MarketWatchService.kt` context assembly.

The verdict stops when `ctx.dailyPnl < -2000`. Missing daily P&L and trade count default to zero. Repository searches found consumers and test fixtures, but no production writer for these exact inputs in the inspected Python/Kotlin/PWA code.

A direct function test, with other inputs held fixed, produced:

- Empty risk context → preliminary `SELL PREMIUM` / ACTIONABLE.
- `dailyPnl=-2500, dailyTradeCount=2` → STOP / `daily_loss_limit`.

This is a helper-level test, not an end-to-end authorization bypass demonstration. Later gates can still refuse entry.

The latest persisted snapshots omit these inputs, but Android uses compact snapshot payloads; absence in those snapshots alone does not prove absence in device memory. Stored legacy context could also contain values. **The proven issue is permissive missing-input behavior; the missing production wiring needs a device/runtime test.**

**Priority proposal:** recompute session realized net P&L and open-position risk from authoritative trade state, timestamp it, and test the complete entry path after startup, reconnect, close, and restart. Missing/stale risk state should block new risk, not interfere with necessary risk-reducing exits.

Per-candidate max-loss/capital checks are not a substitute for aggregate portfolio exposure, correlated NF/BNF risk, or an executable session-loss limit. Review those together; this audit does not claim that every other portfolio control is absent.

## 7. Observability caps constrain honest evaluation

Latest inspected poll reports:

- 659 ranked candidates, but only 30 generated candidates persisted.
- 200 ranked-evidence candidates retained; 459 truncated.
- Twelve watchlist candidates.

Consequently a database-only replay of “every opportunity” can be selection-biased. Persisted samples must carry inclusion/rank/truncation information; retain all actual chosen candidates and a stable, reproducible comparison sample. Reuse compact records rather than restoring memory-heavy full payloads blindly.

Join outcomes by snapshot/poll identity plus candidate identity, index and expiry as appropriate. Repeated candidate IDs are not unique trades. Preserve model, selector, cost, execution mode and exit-policy versions.

## Recommended sequence and acceptance tests

| Order | Work package | Required evidence before proceeding |
|---|---|---|
| P0 | Net-label/valuation contract and daily-risk input tests | Reproducible complete-leg P&L; no double-counted spread; unknown/stale inputs fail closed for new risk; versioned labels |
| P1 | Chronological, capacity-constrained evaluator | Exact eligible decisions; no hindsight selection; no overlapping impossible positions; missing-data coverage reported; matching cost/exit contracts |
| P2 | Shadow replacement for the EV proxy | Better held-out managed-net expectancy at matched risk, with session-level uncertainty and drawdown reported |
| P3 | Model-support repair and offline retraining | Net-label unification; device model provenance; monthly-DTE/low-VIX support checks; no train/test overlap |
| P4 | Execution and exit-policy optimization | Predeclared comparisons of cost/target filters, fill policy and exits; benefits survive additional costs and removal of best sessions |

For the evaluator:

1. Freeze a control: today's eligible PC2 policy, including existing abstention and OOD guards.
2. Use development sessions to specify a small number of challengers; lock them before an untouched chronological test period. Purge overlapping label horizons at split boundaries.
3. Replay attainable entries with capital, concurrent-position limits, fills, fees, timing, and exit policy. Separate manual closes from mechanically simulated exits.
4. Report portfolio net P&L, drawdown, turnover, tail losses, exposure, net expectancy, calibration, data coverage, and session-level confidence intervals. Use session/block resampling rather than treating candidate rows as independent.
5. Test cost stress, delayed fills, missing data, and leave-best-session-out sensitivity. Repeat across relevant regimes and DTEs; five sessions are insufficient.
6. Run a frozen forward-paper validation before any live deployment. Specify rejection criteria and risk limits in advance. No fixed number of sessions alone guarantees adequate evidence.

A matched two-leg versus four-leg comparison and exit-policy study are worthwhile experiments, not a basis for banning butterflies or declaring a winning family today. Historical “ever profitable” or hindsight-best outcomes are not attainable exit rules.

## What already works and should not be undone

- Positive net-edge entry requirement already exists.
- Menu-level no-positive-effective-edge WAIT gate already exists.
- OOD entry block is active; hard-OOD bundled bounds are not empty.
- Friction and quote-unavailable fail-closed paths already exist.
- Neutral candidates already have a distinct market-fit confidence path.
- Current guard/version release does not itself change strategy selection.

The older backlog's generic “add no-trade gate” item is superseded by implementation. Improving the estimator behind the gate is a separate experiment.

## Verification and change boundary

- Full current Python suite: **358 tests passed** in 4.581 seconds.
- MarketVivi JavaScript syntax check passed.
- Direct diagnostic calls confirmed the EV counterexample, OOD reason cascade, disabled training, and missing-risk-input behavior.
- No new Android build was attempted for this documentation-only audit; no device integration, broker fills, complete portfolio replay, or new strategy backtest was performed.
- Only this audit, its SQL companion, and PROJECT_KNOWLEDGE.md were written. No runtime code, model, database data/schema, release identity, GitHub branch, or live order was changed. No commit/push was requested by this audit turn.

The strongest current route toward profit is **a verifiable net-profit objective, reliable risk/valuation inputs, selective eligible entries, and a falsifiable forward test**. The evidence does not yet justify claiming a profitable strategy.

## Follow-up review of Claude's reply

See [REVIEW_CLAUDE_DUAL_AUDITS_20260907.md](REVIEW_CLAUDE_DUAL_AUDITS_20260907.md).
Direct snapshot tests now confirm that daily-risk input keys are removed by
Android compaction even when supplied; their database absence cannot prove
runtime absence. The missing-writer concern remains open. The fee helper
already charges zero extra slippage, but the live bridge preserves supplied
gross P&L, so equivalent executable valuation is not established. Claude's
new 95-trade totals and flagged-history concentration remain attributed
reported evidence, not replacements for this audit's independently queried cohort.
