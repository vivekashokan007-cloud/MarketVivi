# Review of Claude's corrected evaluation reply

Date: 2026-09-09. Attachment: `REPLY_to_codex_eval_review_20260909.md`.
Baseline: Marketapp `9c29428`, MarketVivi `2f629d9`, v2.6.18/b449.
Scope: analysis and documentation only; no runtime, eligibility, model, version,
database, or remote repository changes.

## Conclusion

Accept the corrections and revised priority order. The reply resolves the main
disagreement: outcome-row totals do not establish clean evaluation completion,
and soft-OOD research does not require changing entry eligibility. Keep the
model-versus-entry-gate difference open as a policy research finding, not a
demonstrated profitability defect or an urgent unblocking repair.

## Evidence now reconciled

The following are Claude's newly reported database results, not independently
queried in this review. No database access was retried after the earlier
automatic usage-limit rejection.

- Of 77 snapshots, one warm-up row has no selector summary. The remaining 76
  reportedly carry comparator provenance: 40 v2.6.17 snapshots with 32 ACTIONABLE,
  then 36 v2.6.18 snapshots with 21 ACTIONABLE. This reconciles the denominator
  and withdraws attribution of the first ACTIONABLE states to v2.6.18.
- Trades 271 and 272 precede v2.6.18's reported first poll; Claude now reports
  explicitly checking `paper=true`, `execution_mode=paper`, and `lots=1`.
  These observations do not alone establish which earlier change caused entry.
- The approximately 15,000 daily outcome rows are consistent with capped
  evidence. They do not prove absence of retries, complete reports, or correct
  managed-exit attribution. Claude withdraws the resulting "latent, not active"
  classification; production incidence remains unknown.
- Claude withdraws the DTE-6 mechanism, priority-0 soft-OOD proposal, unapproved
  release numbering, and unsupported 30–60 minute risk notification cooldown.

## Soft/hard breakdown: useful new evidence, with a narrower conclusion

| Reported September 9 cohort | BNF | NF |
|---|---:|---:|
| Generated candidate rows | 1,738 | 2,062 |
| OOD rows | 1,738 | 459 |
| OOD with action BLOCKED | 608 | 459 |
| OOD with non-BLOCKED action | 1,130 | 0 |
| OOD with action TAKE | 1,096 | 0 |

Source inspection supports this proxy for the current pipeline: `predict`
assigns BLOCKED when `is_strategy_blind` is true, brain copies the action to
`mlAction`, and the generated-candidate overlay persists it as `ml_action`.
The SQL's non-BLOCKED predicate excludes NULL actions; keep an explicit missing
action count in future cohort checks. The supplied numbers reconcile arithmetically.

The query does **not** select OOD reasons, confidence, bounded inputs, or installed
model identity. It therefore does not establish that all 1,130 BNF soft cases
are single-DTE violations at confidence 0.909. Nor does TAKE mean all other
entry checks pass or that relaxing OOD changes the selected primary.

The conditional code claim is correct. Fresh execution of the bundled
`FeatureEngine.ood_score` with all nine bounded inputs present and otherwise
in range gives no OOD at DTE 6/9 and soft OOD at DTE 10/20, confidence
0.9090909. Removing one/two bounded inputs produces 0.9/0.8888889 respectively.
The live enrichment path normally supplies these nine keys, but that does not
establish their validity or violation count for every reported row. Source
inspection confirms no probability shrink for confidence >=0.9; other action
guards, including trend and threshold ambiguity, remain applicable.

`ood_conf` is a heuristic based on violation counts, not a calibrated probability
that a prediction is correct or profitable. The shared entry veto for soft and
hard OOD is real. Its economic merit remains an empirical policy question.

## Two remaining precision corrections

1. Daily rows divided by snapshots are an average, not per-snapshot coverage.
   September 8 is 14,799/74 = 199.986486, not exactly 200. The reply acknowledges
   the missing row, but its "exactly 200 on every session" statement is still
   too strong. Group by snapshot and compare expected retained candidate IDs
   against outcomes and run/error state to establish completion.
2. The ranked evidence cap is applied upstream (`ranked[:cap]`, cap 200).
   Evaluating all retained evidence can coexist with an omitted larger menu;
   omission is not evidence that the evaluator abandoned that menu after 250.
   The supplied aggregates distinguish neither completion nor interruption.

## Recommended next implementation and research

Keep evaluation recovery/concurrency/memory (E1/E2/E3), then label and failure
accounting (E5/E4), then notification correctness (N1–N5) as the implementation
order. Scheduling, timeout, upload verification and aggregate-report findings
(E6–E9) also remain open; the priority list does not close them. The proposed
quote-contract wording accurately separates executable-side positivity from
finite, present, uncrossed bid and ask and can accompany a runtime fix.

The proposed shadow comparison is useful. The existing knowledge record already
documents 32,507 one-to-one historical pairs at ±150 seconds, including 32,471
clean teacher managed-net rows. Reuse that recovery work with pairing sensitivity
and coverage reported, but reassess label validity after E5: an existing integrity
tag does not certify the managed exit timestamp. Do not assume that historical
cohort contains the newly reported September 9 candidates or their installed model.

Record actual OOD reasons/confidence/model identity, all other vetoes, and primary
selection changes. Report simulated managed-net outcomes with costs, sizing,
overlapping positions and daily STOP respected. Repeated candidate rows are not
independent trades; a one-session comparison cannot demonstrate durable advantage.
No entry-policy relaxation or training activation is justified by this reply alone.

## Validation in this review

- All six standalone characterization probes reproduced the existing gaps:
  N1 setup collision, N2 risk recurrence suppression, N3 consumed warnings,
  E4 swallowed snapshot errors, E1 checkpoint reset ordering, and E5 wrong exit
  timestamp. E1 is source-order evidence, not JVM/device execution.
- Bundled-model DTE and missing-input probes confirmed the conditional OOD math.
- The earlier 504-test suite was not rerun; its result remains separate from
  these defect reproductions. Runtime files remain unchanged.
