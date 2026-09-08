# Review of Claude's remaining-audit reply and guards v3

Reviewed 7–8 September 2026 UTC. Marketapp baseline: `ff771e9f638aa1c6289ebc6ac0b79e1eecd9c197`; MarketVivi baseline: `16c9d84218e7ab253442fb37f71809ea0ba66c91`.

Inputs: `REPLY_to_codex_remaining_audits_20260907.md` and `guards_v3_on_top_of_ff771e9.patch`. Patch SHA-256: `c074b97c6347a106fdc2b0ea0ab785da4e3a10bc1e75473a66edff8a74b29378`.

## Decision

The v3 extraction and guard improvements are useful, and its supplied valuation tests pass when executed. Claude is right that historical generated-menu/outcome analysis is runnable now. Our earlier description of that analysis as blocked was too strong.

However, neither this patch nor the existing release closes the entire audit. A reproducible daily-loss reset, incomplete CI test discovery, a signed-release trigger issue, and quote/diagnostic contract details remain. The recommendation to fold the patch into the already-pushed 2.6.17 identity should not be followed without resolving the release process.

The patch was applied only to a detached review worktree. Marketapp main, application versions, production data, models and deployment were not changed. The knowledge and review documents were updated locally.

## 1. Important remaining findings

### P1 — A failed or stale cloud refresh can erase local daily-loss protection

This is an existing `ff771e9` problem, not a regression introduced by v3. Claude correctly identified the new daily-P&L producer, but calling the complete durability path fixed is premature. Our own earlier knowledge entry overstated that closure too.

The source chain is concrete:

1. `NativeBridge.recordClosedTrade()` commits the close to `closed_trades` before remote acknowledgement.
2. `SupabaseClient.getClosedTrades()` returns an empty array on fetch failure or invalid JSON. A successful but stale response can also omit the pending close.
3. `MarketWatchService.bootstrapFromSupabase()` replaces `closed_trades` with that response without merging pending local closes or distinguishing failure from an authoritative empty ledger.
4. `_apply_daily_risk_state()` treats an empty ledger with a session date as `OK`, overwrites `dailyPnl` with zero, and clears the loss condition.

Direct execution of the actual Python functions gave:

| Input transition | Daily P&L | Final gate |
|---|---:|---|
| Same-session pending close, net loss ₹3,213.90 | −3,213.90 | STOP / daily_loss_limit |
| Same context, closed ledger replaced with `[]` | 0.00 | ACTIONABLE / market_thesis_actionable |

This establishes the state-transition defect; the Android restart/network sequence has not been executed on a device. Fix with a durable pending-close journal, merge/deduplication until server acknowledgement, explicit fetch success/freshness, and an unavailable-risk policy that does not silently replace known losses with zero. Verify failed fetch, stale successful fetch, restart and retry. Preserve the complete close record, not only risk fields.

### P1 — “Complete Python suite” omits 134 standalone tests

The patched tree's configured `unittest discover` gate passes **369 tests**. Its five additional cases are Python source-contract checks, not Kotlin execution.

AST inspection found another **134 top-level `test_*` functions across 11 modules**, which this unittest command does not collect. Direct invocation, with each module isolated in a separate process, produced **132 passes and 2 failures**:

| Test | Actual result |
|---|---|
| `test_gamma_a4.test_three_call_sites_after_a4a` | Expected 3 producers; found `shadow_candidate`, `cand`, `ic`, `ib` |
| `test_wall_a5.test_three_wall_sites_after_a5` | Expected 3 producers; found the same 4 |

Both failures reproduce on unpatched `ff771e9`. They appear to be outdated producer-count assertions after the shadow-candidate path was added; they do not demonstrate a new v3 valuation defect. Review their intended coverage and repair discovery rather than suppressing them or calling the broader suite green. All 12 standalone net-economics/backtest tests pass; they are included in the 132, not additional to it.

Combined Python result: **503 invoked cases, 501 passed, 2 failed**. This is not an assertion that every possible project test or integration path was exercised.

### P1 for release — Pushing this patch alone does not publish a signed APK

The actual supplied patch touches only `PositionTickService.kt` and two test files. It applies cleanly to `ff771e9` and contains no version edits. This supersedes the reply's references to the older `dd94176` patch and separate version alignment.

`.github/workflows/release.yml` triggers on pushes to main only when `app/build.gradle.kts` changes. This patch alone triggers the broader debug workflow, but not the signed-release workflow. Thus “push v3 into the same release” is not a complete deployment procedure.

For a subsequent release, use a new synchronized identity across Gradle/Kotlin, Python and PWA, with a higher Android build code and PWA cache-buster. If 2.6.17/b448 remains the latest identity, the next would be 2.6.18/b449; recheck remote state when implementing. Verify the resulting signed artifact and installed device, not just matching strings.

### P2 — Quote acceptance changes beyond the advertised fixes

V2 rejected a leg when either bid or ask was missing. V3 checks only whether the required closing side exists. A direct Kotlin probe with short `(bid=null, ask=105)` and long `(bid=40, ask=null)` returns:

```text
quality=OK accepted=true pnl=-450.0 statuses=[NO_DEPTH, NO_DEPTH]
```

This can be a deliberate executable-side-only contract and is consistent with the written v3 contract. It is nevertheless a relaxation of the previous tick requirement and needs an explicit regression test and agreed status semantics. A downstream reader must not interpret overall `OK` as complete two-sided depth or a fully checked non-crossed book. Crossed-book detection requires both sides to be available. The Python fee path requires positive executable sides but does not itself enforce the identical crossed-book rule, so this does not unify every valuation path.

### P2 — Raw completeness and extrema assertions need narrower claims

With an iron butterfly containing only two resolved legs, the Kotlin probe returns:

```text
quality=STRUCTURE_INCOMPLETE accepted=false rawComplete=true raw=65.0
```

Accepted P&L correctly stays null. However, `rawMarkComplete` means all *resolved* legs supplied a raw price, not that all required strategy legs were valued. Either name/document it that way or include structural completeness in that flag. Do not let researchers treat this diagnostic as a full-position mark.

The new extrema test asserts that anomalous P&L is non-null; it does not execute `updateRunningState()` or read persisted extrema. The source adapter visibly feeds every accepted P&L into running state, but that persistence path still needs a behavioral test. Raw observed extrema are a coherent convention; they must remain distinguishable from cleaned research extrema and from historical values written by older guard versions.

## 2. Historical ranking join: independently recovered

Read-only database queries reproduced **32,507 one-to-one pairs** over the ten sessions below at a ±150-second tolerance, with equal counts of pairs, distinct generated IDs and distinct evaluation IDs. Strategy, index and trade mode have **zero mismatches**. **32,471** pairs have `teacher_v1`, `price_integrity=OK` and non-null managed net outcomes.

| Session | Generated | 60s pairs | 150s pairs | 150s coverage | 300s pairs |
|---|---:|---:|---:|---:|---:|
| Aug 25 | 1,734 | 1,610 | 1,610 | 92.8% | 2,912 |
| Aug 26 | 3,800 | 3,750 | 3,750 | 98.7% | 7,320 |
| Aug 27 | 3,800 | 3,750 | 3,750 | 98.7% | 7,369 |
| Aug 28 | 3,550 | 3,500 | 3,500 | 98.6% | 6,798 |
| Aug 31 | 3,800 | 3,750 | 3,750 | 98.7% | 7,338 |
| Sep 1 | 1,398 | 1,197 | 1,197 | 85.6% | 2,061 |
| Sep 2 | 3,750 | 3,700 | 3,700 | 98.7% | 6,897 |
| Sep 3 | 3,800 | 3,400 | 3,750 | 98.7% | 7,161 |
| Sep 4 | 3,800 | 3,750 | 3,750 | 98.7% | 7,222 |
| Sep 7 | 3,800 | 3,700 | 3,750 | 98.7% | 7,136 |

At 60 seconds, 400 pairs are lost relative to 150 seconds: 350 on September 3 and 50 on September 7. At 300 seconds, duplicate pairing appears in every session. Do not use that wider join directly for performance statistics. At 150 seconds, the maximum observed offset is 97 seconds.

The apparent disagreement about the exact join is also resolved: the unrestricted exact join returns **9 rows**, all with `price_integrity=LEGACY_PRE_S1`. The earlier clean-teacher analysis filtered those out and returned **zero**. Neither query was numerically wrong; the population definitions differed.

Historical correlation and menu comparisons can proceed using the checked 150-second cohort, reporting uncovered rows and join sensitivity. One-to-one matching and matching categorical identity do not prove exact event identity. Persisted shared IDs remain desirable. Final eligibility, same-menu controls, chronological validation, position overlap/capital constraints and fill assumptions remain necessary before treating results as achievable returns. Those experiments were not completed in this patch review.

## 3. Tick-versus-close differences: Claude's main explanation holds

All **36** matched iron-butterfly/iron-condor ticks have `leg_count=2`, two JSON legs, and no guard-version marker. This strongly supports the known missing-second-pair defect as the explanation of the large historical four-leg gaps. It does not establish every stored close as correct.

| Strategy | Matched rows / non-null tick P&L | Mean signed tick-minus-close gap | Mean absolute gap |
|---|---:|---:|---:|
| BEAR_CALL | 41 / 39 | −₹16.07 | ₹79.80 |
| BEAR_PUT | 12 / 12 | −₹75.97 | ₹203.35 |
| BULL_PUT | 5 / 5 | −₹153.55 | ₹164.55 |
| IRON_BUTTERFLY | 30 / 30 | +₹5,002.87 | ₹5,002.87 |
| IRON_CONDOR | 6 / 6 | +₹905.21 | ₹905.21 |

Claude's BEAR_CALL means use different denominators: mean close across all 41 is ₹152.59, whereas mean close among the 39 with tick P&L is ₹123.85. The paired mean tick is ₹107.78, giving the reported −₹16.07 gap. Means should use the same paired population.

“Two-leg differences are acceptable ordinary staleness” is not established by these aggregates. Absolute errors are larger than signed means, and actual quote/quantity/basis alignment has not been reconstructed. Under strict opposite-sign comparison (`tick_pnl * actual_pnl < 0`), counts are 1 for BEAR_PUT and 9 for butterflies; zero-versus-positive classifications must be reported separately rather than called opposite signs without definition.

Re-run stratified comparisons after fresh guarded ticks arrive, but a smaller average gap alone does not close canonical-label correctness. Preserve exact close/tick identity, quantity, all legs, timestamps and fee basis, with explicit handling of missing evidence. No historical trade label was changed in this review.

## 4. Friction matters; the role means do not prove selector skill

Claude's corpus aggregates reproduce exactly:

| Role | Rows | Mean managed gross | Mean managed net | Mean friction |
|---|---:|---:|---:|---:|
| Primary | 1,689 | ₹201.53 | −₹31.13 | ₹232.66 |
| Secondary | 235,303 | ₹8.23 | −₹137.35 | ₹145.58 |

The gross-to-net sign reversal is real in this teacher corpus. The “24×” gross ratio is descriptive, not causal proof that current PC2 ranks usefully: populations differ in session, structure, eligibility, quantity/risk and repeated-candidate weighting. ₹232.66 is a sample mean, not a universal cost threshold. The current selector already uses net premium edge where required, and `_build3_candidate_ev` uses net values when present; the proposal should not be framed as adding friction awareness for the first time.

Keep managed net as the evaluation objective, compare eligible alternatives in the same menu and session, and distinguish a payoff-bound EV proxy from an empirically validated managed-outcome expectation. No new profit claim or threshold change follows from these role averages.

## 5. Verification and deployment evidence

- Patch applicability and whitespace checks pass in the detached worktree.
- Configured Python unittest discovery: **369 passed**.
- Additional standalone sweep: **132 passed, 2 failed**, both failures also on baseline.
- Actual extracted file-scope Kotlin, Kotlin 1.9.22 / JUnit 4.13.2: **20/20 passed**.
- Independent mutation checks: disabling positivity gives **2 expected test failures**; disabling crossed-book detection gives **1**; disabling unsupported-strategy rejection gives **1**. Thus these guards have behavioral regression protection. The patch's claim that each mutation fails exactly one test is too specific for the positivity mutation used here.
- Extraction preserves the actual top-level valuation source and JSON helpers. Only the Service version constant is stubbed. This does **not** compile the Android Service adapter, test preferences/networking, or replace the full Android build/device gate.
- Latest snapshot version by actual timestamp remains **2.6.16**, with last poll `2026-09-07 10:10:41 UTC`. The latest version groups contain no daily-risk state. This is absence of observed 2.6.17 telemetry, not proof that the device has never installed it.
- Comparator field checks should be scoped to the relevant deployed version and records containing a selector summary. `changed_from_deterministic > 0` is not a required invariant: genuine agreement is possible. A synthetic disagreement case plus preserved provenance is the software acceptance test; production disagreement frequency is evidence to measure.

## Reproduction

Read-only aggregates: [REVIEW_CLAUDE_GUARDS_V3_20260908.sql](REVIEW_CLAUDE_GUARDS_V3_20260908.sql).

Kotlin baseline/mutations and standalone Python sweep: [audit/guards_v3_review_20260908.py](audit/guards_v3_review_20260908.py). Run against a detached worktree with the supplied patch applied. Its exit code is deliberately nonzero while the two pre-existing standalone assertions fail. Run the standard unittest discovery command separately.

Recorded validation output: [audit/guards_v3_validation_20260908.txt](audit/guards_v3_validation_20260908.txt).

Recommended next implementation: preserve pending closes through failed/stale bootstrap, repair test collection and its two stale assertions, settle the two v3 contract details above, then release all version surfaces together and verify the signed build and device. The recovered historical cohort permits the ranking study to proceed without waiting for a database migration.
