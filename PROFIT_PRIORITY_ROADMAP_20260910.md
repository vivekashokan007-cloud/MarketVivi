# Profit-first roadmap — September 10, 2026

Baseline: Marketapp `c826b26`, MarketVivi `ce24a65`, v2.6.19/b450.

## Decision rule

The app should improve real-money decisions only after the same policy has been
observed and measured in Paper mode. Paper mode is the single experimental lane;
there will be no additional user-facing shadow mode. Real mode retains the current
proven policy while Paper produces the evidence required for promotion.

Correctness fixes apply to both modes because they protect the truth of all
records. A rule that changes candidate generation, ranking, entry, sizing, holding,
or exit starts in Paper only. Every paper trade must retain its policy version,
selection reason, entry vetoes, executable quote state, friction and managed-net
outcome so results can be compared without guessing.

## Immediate Paper-mode defect

The Paper button is incorrectly governed by real-entry authority in two places:

1. `renderCandidateCard` renders `PAPER LOCKED` unless `finalEntryAuthorization`
   approves the candidate.
2. `takeTradeImpl` calls the same authorization before checking `isPaper`.

This prevents the operator from paper-testing a candidate that is deliberately
outside the current final selection, including soft-OOD candidates and ranking
alternatives. It makes Paper mode unable to answer whether the final selection is
better.

### Required Paper behavior

- Show **PAPER TEST** for every structurally recordable candidate, including
  WAIT, monitor-only, non-primary and soft-OOD candidates.
- Keep Real/Sandbox buttons bound to final authority, entry eligibility, execution
  readiness, capital and risk controls.
- On Paper TEST, show the current block reasons and ask for a confirmation. Save
  `paper_selection_source=operator_test`, `paper_policy_version`, final rank,
  deterministic/research rank, and every current veto.
- Keep hard data-integrity checks: valid strategy legs, expiry, strikes, lot size
  and required executable entry quote fields. A candidate missing these cannot
  produce a meaningful managed-net paper label; explain the missing data instead
  of creating a misleading trade.
- Retain an explicit active-paper-position cap per index to avoid overlapping,
  unmanageable paper positions. Show the count and allow the operator to close a
  prior paper trade; this is capacity control, not a brain-policy lock.

## Priority order

| Priority | Work | Why it comes here | Release scope |
|---|---|---|---|
| P0 | Unlock PAPER TEST with complete provenance | Creates the controlled observations needed to judge alternatives and lets the operator analyse candidates rejected by the current final gate. | PWA/UI + trade record; Paper only. |
| P0 | Fix E5: bind managed P&L, friction, timestamp and quote identity to one valued point | A ranking or policy cannot be called profitable if its outcome label uses a timestamp from a quote it did not value. | Evaluation correctness, both modes. |
| P0 | Fix E3: atomic, bounded evaluation output and streaming finalization | An interrupted or out-of-memory evaluator can silently erase the evidence needed for decisions. | Evaluation correctness, both modes. |
| P1 | Fix E6–E8: evening reminder recovery, real liveness/heartbeats, separate upload/report completion | Ensures Paper evidence is complete, retryable and attributable to the exact run. | Evaluation correctness, both modes. |
| P1 | Fix N1, N3–N5: deferred setup events, per-event acknowledgement, delivery/status evidence | Missed position or evaluation alerts reduce the operator's ability to enter, manage and learn from Paper trades. | Notification correctness, both modes. |
| P2 | Paper ranking study | Compare the chosen primary with recordable alternatives, using managed net after friction and capacity controls. Proves whether the ranker selects better opportunities. | Paper only. |
| P2 | Paper soft-OOD study | Let soft-only candidates be tested through PAPER TEST or a paper policy version; hard strategy-blind OOD stays blocked. Measure selection changes and managed-net outcomes. | Paper only. |
| P3 | Canonical executable net labels and training eligibility | Re-enable retraining only when close P&L, costs and labels are one trustworthy contract. | Research/data; no automatic training. |
| P3 | Validate predicted EV and probability against realised managed-net outcomes | Prevents high model scores or win rates from being mistaken for profit after friction. | Paper evidence first. |
| P4 | Multi-session holding-period evaluator | Tests whether exits/holds improve risk-adjusted net outcomes; requires stale/impossible long-horizon print filtering. | Offline then Paper. |
| P4 | N2 risk recurrence policy | Define re-alert after clear/re-entry and escalation; it needs an explicit operator policy, not an arbitrary timer. | Notification policy. |

## Research sequence that leads to profit evidence

1. Repair data and evaluation truth through P0/P1, then verify on the phone over
   normal market close, restart, delayed network and notification-permission cases.
2. Use PAPER TEST to build a labelled cohort that includes the brain primary and
   clearly identified alternatives. Do not call repeated candidates independent
   trades and do not mix policies without their version stamp.
3. Evaluate ranking by session chronology and simultaneous-position capacity, not
   by selecting the eventual historical winner. Compare realised managed-net P&L,
   drawdown, friction, stop behaviour and availability of executable quotes.
4. Test one policy change at a time in Paper: first ranking evidence, then soft
   OOD, then any entry/exit change. Hard OOD, missing quote and daily-risk guards
   remain in force.
5. Promote a paper policy to Real only after enough multi-session, correctly
   labelled, friction-inclusive observations show an improvement over the current
   policy without worse drawdown or operational failures. Define the sample and
   promotion threshold before examining its outcome.

## What is already complete

v2.6.19/b450 corrected checkpoint loss (E1), duplicate in-process evaluator
launches/foreground ownership (E2), and false completion after snapshot crashes
(E4). It does not change ranking, OOD eligibility, training or real-entry policy.

## Explicit non-goals for the next change

Do not relax Real-mode gates, enable retraining, change live order behavior, or
declare a profitable strategy from a model score, gross P&L, one day, or a small
set of overlapping paper candidates.
