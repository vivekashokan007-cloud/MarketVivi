# Review of Claude's September 9 evaluation/notification handoff

Reviewed attachment: `HANDOFF_to_codex_20260909.md`.
Baseline: Marketapp 9c29428 and MarketVivi 2f629d9, v2.6.18/b449.
This is an analysis-only follow-up to AUDIT_EVALUATION_NOTIFICATIONS_20260909.md.

## Decision

Accept the corroboration of E1, E4, E5 and E7 and the new QUOTE_CONTRACT
documentation drift. Record the supplied production counts as Claude-reported
evidence. Do not infer clean device lifecycle or promote soft-OOD entry policy
from those counts. Keep evaluation recovery, label attribution, and notification
correctness ahead of an authoritative eligibility relaxation. Soft-OOD research
can proceed using recorded candidate menus without enabling entry.

## What is confirmed

- E1: checkpoint progress is reset before the resume check.
- E4: Python batch errors advance completion while returning ok=true; Kotlin
  does not accumulate them into the session completion decision.
- E5: an invalid final quote can supply exit timestamp/step while P&L comes
  from the preceding valid quote.
- E7: EVENING_EVAL_TIMEOUT_MS has only its declaration; synchronous Python
  calls do not acquire an interruptible deadline merely from coroutine timeout.
- QUOTE_CONTRACT still says
  `strictly_positive_finite_executable_side_independent_of_ltp`, while v4 requires
  finite bid and ask and rejects crossed books as well. Updating the contract
  string in the next implementation is appropriate. Wording must distinguish
  positivity of the executable side from presence/finiteness of both sides;
  current code does not require both sides to be strictly positive.
- Claude explicitly did not independently reproduce E2/E3/E6/E8/E9/N1–N5.
  That acknowledgment should remain attached to the verification record.

## Production evidence: useful, but narrower than the conclusions

Claude reports 36/77 daily-risk-bearing snapshots, 76 comparator-provenance rows,
53 ACTIONABLE snapshots, two open trades, and daily evaluation outcome counts
from September 1–8. No database query was retried in this turn after the earlier
automatic usage-limit rejection. These numbers are not independently verified here.

If the 36 risk-bearing rows coincide exactly with all v2.6.18 rows, they support
field verification of the compactor fix for the reported OK/zero-P&L state.
They do not verify a losing close, daily STOP after restart, delayed remote
acknowledgment, or the pending-close journal. A grouped version/field-presence
query and loss-state evidence would close those distinct gaps.

The comparator count uses 76 as its denominator while the session elsewhere has
77 snapshots. Reconcile the exclusion/missing row before calling session-wide
coverage complete. Likewise, a source marker for guards v4 proves integration,
not an observed on-device rejection of crossed/one-sided/incomplete structures.

The two quoted trade entry times, 04:12:53Z and 05:36:01Z, precede the recorded
v2.6.18 push/workflow start at approximately 05:58Z and signed-build completion
at 06:02:30Z. They cannot by themselves validate the new signed v2.6.18 entry
path. Earlier local APK installation would require separate evidence. The SQL
shown for these trades also neither selects nor filters the `paper` field;
the paper classification is additional reported information, not established
by that displayed query alone.

“First ACTIONABLE all engagement” is incorrect relative to our own earlier
September 9 partial-session review: it already recorded 14 ACTIONABLE states
in 20 v2.6.17 snapshots. The new 53 count extends that observation. It is not
evidence that v2.6.18 first restored entry eligibility.

## Outcome counts do not prove every evening completed cleanly

The supplied SQL confirms that outcomes exist for the listed dates, assuming
the reported results are accurate. It does not identify retries, process deaths,
job terminal state, report completion, or expected-versus-produced candidate IDs.
Idempotent upserts can leave identical final counts after a failed first attempt
and successful retry. Thus E1–E4 cannot be classified as inactive from this query.

The roughly 15,000-row pattern is especially insufficient as a completion test:
the saved ranked evidence has a 200-candidate cap, and 75 × 200 = 15,000. That
is a plausible explanation for the pattern, not proof of the actual composition.
Expected snapshot/menu identities, role mix, explicit exclusions and errors must
be reconciled. A snapshot with some written candidates may still be incomplete.

Also, `_eval_single_candidate` sets `price_integrity` from the legacy H2
valuation before merging the managed teacher outcome. An OK count does not
establish that every managed exit timestamp has correct E5 attribution or that
Android report generation succeeded.

Our audit ranked these as High; it did not call E1 P0 or assert production
corruption. Unknown incidence should remain unknown. The user's evening issue
still needs phone logs to distinguish automatic-start, compute, save, or report
failure. Label integrity and lost notifications remain correctness work, even
when outputs also exist in the database.

## Soft-OOD priority: proposed rationale is not established

1. The bundled model has DTE bounds [0,6] **plus half-span tolerance**. Fresh
   execution with other inputs in range accepts DTE 5,6,7,8,9 and flags 10,20.
   Therefore “NF unlocked because it reached DTE 6” does not follow from these
   bounds. The next roll does not automatically imply another DTE-only lockout.
   Exact installed model identity and per-row warnings remain unverified here.
2. The displayed SQL selects min(expiry), not the actual model-input tDTE or OOD
   reason. The brain passes candidate tDTE to prediction. A calendar difference
   inferred from expiry is insufficient to establish the specific input/reason.
   The handoff also describes yesterday's NF DTE as 6, which does not by itself
   explain a today-only change based on accepting 6.
3. Aggregate `ml_ood_flag` does not distinguish soft-only from strategy-blind
   hard OOD. The proposed split would not rescue every OOD candidate, and the
   confidence floor and other eligibility conditions would still apply.
4. Mean `premium_edge` over all generated candidates is a model estimate, not
   realized managed-net advantage. Comparing two index-level means does not
   control for risk, family, costs, size or eligibility; averaging repeatedly
   generated candidates does not produce independent trade evidence.
5. The evaluator explicitly retains/evaluates primary, secondary and bounded
   rejected/supply research candidates; its menu evaluation is not conditioned
   on entryEligible. “Nothing else can be measured while half the menu is
   vetoed” is therefore false. Candidate outcome and counterfactual analysis
   remain possible while official entries stay gated.
6. `ml_engine.predict` already shrinks some OOD probabilities toward the base
   win rate. Multiplying entry confidence by ood_conf adds another policy
   penalty. That may be intentional, but requires measuring actual eligibility
   changes and outcomes rather than calling it an unblocking repair.

A useful next soft-OOD deliverable is an offline/shadow comparison recording
the installed model, OOD reasons, hard/soft split, original and proposed
confidence, all remaining vetoes, final counterfactual selection, and managed-net
outcomes. Preserve missing/non-finite/out-of-range confidence rejection, hard OOD,
daily STOP, final primary authority, and executable quote integrity. Five unit
cases alone cannot establish ranking or outcome quality.

## Risk re-entry and verification accounting

A bounded re-alert policy is worth designing. The suggested 30–60 minutes is
not justified by evidence here and should not become a blanket delay for a
new urgent episode. Stable unchanged risk, risk that clears then recurs, and
severity escalation need distinct treatment. Delivery acknowledgment is also
required: a suppressed or failed first post must not consume the episode.

The statement “504 tests passing including six new probes” conflates two runs.
The standard 504-test suite and the six standalone audit probes are separate.
Five probes exercise actual Python behavior; one checks Kotlin source ordering.
They reproduce defects rather than verify corrected behavior.

## Recommendation

Retain the previous implementation order, include the quote-contract text with
the next relevant runtime change, and start OOD research as a separate bounded
analysis. Do not reserve v2.6.19/b450 for an unapproved policy patch or treat this
attachment as user approval to deploy it. No runtime patch was supplied here.
No message was sent to Claude and no code/release/policy change was made.

Validation in this review: all six existing audit probes still reproduce their
cases, and the bundled-model DTE sweep was re-executed. The earlier full-suite
result is retained as 504 passed; no new full-suite run is claimed here.
