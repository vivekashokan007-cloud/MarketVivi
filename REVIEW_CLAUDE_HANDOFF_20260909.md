# Review of Claude's September 8 handoff

Reviewed September 9, 2026 UTC against Marketapp `ff771e9` and MarketVivi `7e82422`. Input: `HANDOFF_to_codex_20260908-1.md`. This is an analysis and documentation update; no runtime policy, model, production data, release or version was changed.

## Conclusion

Claude correctly identifies the September 8 OOD bottleneck and confirms the previous durability/test/release findings. However, **the permanent entry-deadlock conclusion is contradicted by newer production data**, and **the daily-risk telemetry loss is in Kotlin persistence compaction, not an early return when no trades closed**.

Do not implement the proposed soft-OOD relaxation as an emergency restoration of an accidentally missing fix. It was deliberately excluded from the earlier release, and changing it remains a policy decision requiring separate evaluation. Repair daily-risk persistence and pending-close durability first; the historical research path is already available.

## 1. Production evidence: entries are not permanently deadlocked

Read-only queries on September 9, using snapshot evidence through **05:25:59 UTC / 10:55:59 IST**, returned:

| Session | v2.6.17 snapshots | Preserved comparator provenance | Positive eligible-candidate count | Final ACTIONABLE | Daily-risk field present |
|---|---:|---:|---:|---:|---:|
| September 8 | 76 | 75 | 0 | 0 | 0 |
| September 9, partial session | 20 | 19 | 16 | 14 | 0 |

For September 8, all 75 populated primaries were iron butterflies carrying the three reasons Claude identified; their mean persisted net-edge estimate was ₹3,427.83. These later session totals naturally exceed Claude's mid-session counts. His handoff also mixes counts from successive observations, so its 3,000 versus 3,050 generated-row figures should not be treated as one frozen population.

Concrete September 9 counterexample:

- Snapshot **5548**, poll **04:05:48 UTC / 09:35:48 IST**.
- Candidate **IB_NF_23500_W300**, Nifty iron butterfly.
- `entryEligible=true`, eligibility version **v5**, `candidate_ml_ood=false`.
- Entry confidence **63.8**, persisted net-edge estimate **₹1,706**.
- Final action **SELL PREMIUM**, gate **ACTIONABLE / pc2_entry_eligible_primary**.
- Both final execution candidate and PC2 primary equal `IB_NF_23500_W300`.

Snapshot 5549 repeats the pattern for `IB_NF_23550_W300`. This establishes a functioning backend eligibility/selection path without v6. It does **not** prove a GO banner rendered on the phone or an order was submitted: PWA authorization also requires candidate readiness, correct bridge state and matching selection. If GO remains unseen during these polls, investigate that actual UI/bridge state rather than assuming all backend candidates are vetoed.

Generated-row evidence at the initial query cutoff:

| Session/index | Persisted rows | OOD-flagged | Positive gross edge | Positive gross edge and not OOD |
|---|---:|---:|---:|---:|
| Sep 8 BNF | 3,740 | 3,740 | 3,200 | 0 |
| Sep 8 NF | 60 | 0 | 0 | 0 |
| Sep 9 BNF, partial | 427 | 427 | 425 | 0 |
| Sep 9 NF, partial | 523 | 119 | 391 | 273 |

These are persisted rows, not independent trades or necessarily the full generated menu. Gross-positive does not imply net-positive or final eligibility. September 8's bottleneck is real; extrapolating it to every index, every session and indefinitely is not supported.

## 2. Soft OOD was intentionally excluded, not accidentally forgotten

Current source uses `entry_eligibility_v5_quote_friction_fail_closed`; the v6 split is absent. But the September 7 project-knowledge release record explicitly says the safe fixes were separated from the proposed soft-OOD change and that the relaxation was **not included**. The top of Marketapp's `CLAUDE.md` also says no soft-OOD relaxation was included.

Its lower “fixed in v2.6.13” section is a contradictory historical proposal, not evidence that the current release should implement that policy. This review corrects that section's status. The prior agreement to separate the changes remains the relevant recorded release decision.

Direct execution of current entry eligibility confirms the reason cascade:

| Synthetic neutral candidate | Eligible | Entry confidence | Reasons |
|---|---|---:|---|
| OOD, complete suitable regime | No | null | OOD, market-fit unavailable, confidence unavailable |
| Same inputs, not OOD | Yes | 86.0 | None |
| Not OOD, missing regime | No | null | Market-fit unavailable, confidence unavailable |

This proves OOD suppresses the calculation, not that removing the OOD veto would make every real candidate eligible. Market fit, confidence after any de-rating, hard OOD, ML action, executable quotes and economics still matter. Merely clearing flags in this diagnostic is not a tested implementation of the proposed soft-OOD policy.

If evaluating v6, retain the existing final entry authority and hard vetoes; explicitly record soft/hard classification, OOD confidence/warnings, model version, confidence before/after de-rating, and counterfactual eligibility. Fail closed for missing/non-finite/out-of-range confidence. `ml_engine.predict()` already shrinks some OOD probabilities toward the base rate; further confidence multiplication is an additional policy penalty, not simply exposing an unused number. Compare resulting managed-net outcomes in shadow research before changing production eligibility.

## 3. Monthly contracts do not imply permanently high DTE

NSE did discontinue BANKNIFTY weekly options; the official circular lists November 13, 2024 as the last weekly expiry. [NSE circular FAOP64506](https://nsearchives.nseindia.com/content/circulars/FAOP64506.pdf).

That fact does not make remaining time to a monthly expiry constant. The observed BNF contracts expire September 29. The brain feeds `tDTE` into the model and provides a trading-day date calculation; “BNF always has DTE about 26 indefinitely” is not an accurate description of that code or a rolling contract's life.

The bundled model has DTE training bounds `[0,6]`, but `ood_score()` allows an additional half-span before reporting a violation. With other modeled inputs at in-range values and a non-blind BULL_PUT sigma, actual execution returned:

| DTE input | OOD | Hard strategy-blind flag |
|---|---|---|
| 3, 6, 9 | false | false |
| 10, 21, 26 | true | false |

Therefore DTE alone stops triggering this particular check at 9 or below. Other features or strategy-specific bounds can still trigger OOD. This test uses the bundled model; it does not establish that the exact same model artifact is installed on the phone. Aggregate `ml_ood_flag` counts cannot by themselves prove DTE is the sole offending feature or classify every row as soft rather than hard OOD.

## 4. Confirmed root cause of absent daily-risk telemetry

Claude's early-return hypothesis is disproved. `_apply_daily_risk_state()` returns `status=OK` and realized P&L zero for a valid session with an empty ledger. `analyze()` calls it before the low-history return. `take_poll_snapshot(..., 'android_compact_v1')` retains `snapshot_daily_risk_state`.

The next stage loses the field:

1. `MarketWatchService` calls `EvaluationLocalCache.compactBrainSnapshotForPersistence(rawSnapObj)`.
2. `compactBrainSnapshot()` builds a new context from whitelists containing the PC2 summary but omitting `snapshot_daily_risk_state`.
3. That already-compacted object is passed to both the local snapshot cache and `SupabaseClient.saveBrainSnapshot()`.

Executed the exact Kotlin compactor and its JSON/candidate helpers, with only logging stubbed, on actual Python-generated snapshot fixtures:

| Fixture | Python risk state | Kotlin persisted risk field | Comparator summary |
|---|---|---|---|
| No closed trades | OK, realized P&L 0 | **Dropped** | Preserved |
| Pending loss close | OK, realized P&L −3,213.90 | **Dropped** | Preserved |

This explains why the new comparator appears in production while daily-risk telemetry does not. It is a confirmed serialization defect, distinct from the previously demonstrated cloud-bootstrap ledger overwrite. The other summary/research compaction paths in `EvaluationLocalCache`, `NativeBridge` and `MarketMLService` also omit the key and should be covered by round-trip tests when fixing it.

The earlier Python-only persistence test passed because it stopped before the Kotlin stage. Required acceptance tests must cross that boundary, for zero, loss and unavailable state, and through local reload and remote payload construction. The JVM probe does not test device preferences/network I/O or compile the full Android application.

## 5. Guards v3 response and priorities

Claude's acceptance of the previous five findings is constructive; the patch is unchanged, so the prior review and test limitations still apply. Two qualifications remain:

- Restoring two-sided depth is a sensible conservative option, but “DEGRADED while the executable mark may still publish” must not reintroduce an accepted executable mark on rejected valuations. Keep rejected marks in clearly separate raw diagnostics; state precisely whether accepted P&L remains null.
- Requiring structural completeness in `rawMarkComplete` is an actual telemetry behavior change, not only renaming. Preserve diagnostics needed to explain incomplete legs while avoiding a full-position-completeness claim. Neither the absence of historical one-sided quotes nor existing accepted-row counts guarantee future incidence is zero. The handoff's 47,586-leg incidence query was not rerun in this review.

Recommended order:

1. Preserve pending closes through failed/stale bootstrap and distinguish unavailable risk state from a known zero.
2. Fix daily-risk field loss across Kotlin persistence/summary paths and test complete round trips.
3. Repair standalone-test discovery and review its two existing producer-count failures.
4. Finish v3 quote/raw-mark semantics and extrema persistence tests.
5. Release with synchronized brain/Kotlin/PWA identity and a higher build code, after checking current remote state. If 2.6.17/b448 remains current, use 2.6.18/b449; verify the signed artifact and device.
6. Continue the recovered historical ranking study and separately assess soft-OOD counterfactuals. Neither requires forcing authorized entries to generate research outcomes.

The existing evaluator already records monitor/rejected candidate research. A separate research-paper mode could be considered as an explicit product feature with its own labels and accounting, but it is not evidence that the authorized paper/live gate should be bypassed. The absence of a trade is not, on its own, a software failure or a reason to relax safety policy.

## Validation and artifacts

- Existing entry-eligibility tests: **13 passed**; daily-risk tests: **3 passed**. No claim of a fresh full-suite run.
- Additional direct probes: OOD boundary sweep, eligibility reason cascade, zero/loss Python-to-Kotlin compaction.
- Read-only SQL: [REVIEW_CLAUDE_HANDOFF_20260909.sql](REVIEW_CLAUDE_HANDOFF_20260909.sql).
- Compaction output and reproducible extraction probe: [audit/handoff_compaction_20260909.txt](audit/handoff_compaction_20260909.txt), [audit/handoff_compaction_20260909.py](audit/handoff_compaction_20260909.py).

No new guards patch was supplied in this handoff, and no runtime fix was applied or pushed during this review.
