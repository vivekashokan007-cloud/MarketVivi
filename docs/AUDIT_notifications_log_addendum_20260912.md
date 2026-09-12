# Addendum — what the six phone logs actually prove

**Companion to:** `AUDIT_notifications_20260912.md`
**Logs supplied:** 6 captures spanning 2026-08-25 → 2026-09-11

---

## First, the disappointing part: these logs cannot settle either complaint

I have to tell you this straight rather than dress it up.

Android's logcat ring buffer holds roughly 15–30 minutes of this app's output. Every capture is a short window:

| capture | window (IST) | market hours? |
|---|---|---|
| 2026-08-25 | 11:30 – 11:57 | **yes** |
| 2026-09-08 | 13:55 – 14:22 | **yes** |
| 2026-09-10 | 18:37 – 18:54 | no (post-close) |
| 2026-09-10 | 21:17 – 21:47 | no |
| 2026-09-10 | 22:10 – 22:35 | no |
| 2026-09-11 | 06:32 – 06:38 | no (pre-open) |
| 2026-09-11 | 17:10 – 17:26 | no (post-close) |

**Neither 09-10 nor 09-11 has a single minute of market-hours coverage** — those are the two days you're complaining about. The two market-hours windows are 08-25 and 09-08.

And on both of those days, the notifier behaved **correctly**:

- 09-08, polls 57–62 — every poll logged `BRAIN_NOTIFICATION_CONTRACT: type=WAIT notify=false reason=UNCHANGED_SETUP`. I checked those exact polls in `ml_brain_snapshots`: action was `WAIT`, `entryEligible` was `false`, confidence `0` on all seven. There was genuinely nothing to notify. Silence was right.
- 09-08 also logged `POSITION_LIVE_APPLIED: live=0 open=0 updated=0` on every poll. Before treating that as a smoking gun I checked `trades_v2`: **there were no open positions at all during that window.** `open=0` was accurate, not a data-loss bug. I am explicitly retracting that as evidence — it proves nothing.
- 08-25, 11:30–11:57 (inside the 11:00–15:15 entry window): same picture, all `WAIT` / `UNCHANGED_SETUP`.

**One thing they do prove, and it matters:** the transport works end to end. On 08-25 at 11:50 and 09-08 at 14:10 a routine alert went all the way through — `notify=true` → `dispatched=true count=1` → `BRAIN_NOTIFICATION_SEND: 📈 Market Update`. `mode=live` on every poll, never shadow. So this is **not** a permissions problem, not a disabled-channel problem, and not transport-mode misconfiguration. Whatever is wrong is upstream, in contract *production* — which is where the audit's F1/F4/F5 live.

Note also the 09-08 log format (`dispatched= count=`) is the older telemetry; current builds log `selected= attempted= posted= outcomes={}`, which is strictly more useful for this question.

## To actually close this, I need a capture taken *during* the failure

Not after close. Specifically:

1. When the app shows **Book Profit / Exit** on a position and your phone stays silent — capture within ~10 minutes, while the evidence is still in the buffer.
2. Or on any day you'd call "perfect conditions," capture between **11:00 and 15:15 IST**.

`BRAIN_NOTIFICATION_CONTRACT` prints `reason=` on every poll and will name the gate directly: `SETUP_NOT_STABLE`, `COOLDOWN_ACTIVE`, `UNCHANGED_SETUP`, or `NO_ACTIONABLE_STATE_CHANGE`. One such capture settles F4/F5 permanently. `POSITION_LIVE_APPLIED` taken while a position is open settles the Target/Stop question I left open.

---

## What the logs *did* prove — five findings, all new

These are all on the evaluation side rather than notifications, but three of them are serious and one closes an open question from yesterday's ruling.

### N1 · The malformed-outcomes crash has a **second, still-unguarded call site** — CONFIRMED LIVE

2026-09-10 21:17:37 IST:

```
EVAL_FAIL[RUNNING]: Evaluation output outcomes_2026-09-10.json is malformed
  at countJsonArrayFile(MarketMLService.kt:797)
  at appendJsonArrayFile(MarketMLService.kt:842)
  at runDayEvaluation(MarketMLService.kt:2353)
```

That is the **RUNNING-phase append**, not the PREPARING resume check at `:2269`. Codex's `29c2008` — and my superseded patch — guarded only the resume branch. I checked current `origin/main` (`a712c78`): `appendJsonArrayFile` still calls `countJsonArrayFile(file)` completely unguarded at line 843.

`8607a57` ("preserve multi-batch output prefix") fixed the *cause* of this particular corruption — `temp.outputStream()` was truncating the prefix that `copyFilePrefix` had just written, leaving a file that starts with `,`, which is exactly `Expected literal value at line 1 column 1`. Good fix, and it landed 09-10 22:02 IST, 45 minutes *after* this crash (device was on v456 at the time; v457 arrived next morning).

But the cause being fixed is not the same as the path being safe. Any other route to a malformed file — process death mid-append, storage error — still crashes the evaluator here, with no recovery, exactly as it did that evening. The defence belongs at both sites, not one.

### N2 · Codex's malformed-recovery fix fired in the field — FIRST FIELD CONFIRMATION

2026-09-10 22:11:03 IST:

```
W MarketMLService  EVAL_RESUME_DISCARDED_MALFORMED_OUTPUTS: date=2026-09-10
                   file=outcomes_2026-09-10.json bytes=1562121
```

That is the exact log line the fix was built to emit, on a real 1.5 MB corrupt file, followed by a clean restart (`teacher research outcome payload compacted input=0 output=0`). That fix is now field-verified, not just test-verified. Worth recording in PROJECT_KNOWLEDGE.

### N3 · The origin of the 8,296 null-`snapshot_id` rows — question closed

2026-09-10 22:21:06 → 22:21:09 IST, nine consecutive failures:

```
CHUNKED_POST_FAILED: table=ml_evaluation_outcomes?on_conflict=snapshot_id,candidate_id,role
  chunk=1/34 rows=250 status=400
  {"code":"23502","message":"null value in column \"snapshot_id\" ... violates not-null constraint"}
```

So the device tried to upload evaluation outcomes carrying **null snapshot_id**. `ml_evaluation_outcomes` has a NOT NULL constraint and rejected all 34 chunks — which is why that table sat at 0. `ml_recommendation_outcomes` has **no** NOT NULL on that column, so the same defective rows landed there and stayed.

That settles the open mechanism question from yesterday's handoff ruling: those 8,296 rows are the residue of an upload the canonical table *correctly refused*. They were never valid. It strengthens the archive-then-delete ruling — this is not evidence anyone will want to reconstruct analytics from, it's a rejection artifact. The asymmetric constraint between the two tables is itself worth fixing.

### N4 · Rejected-research saves fail wholesale on duplicate ids

2026-09-10 22:21:26 IST:

```
POST_ARRAY_FAILED: table=ml_rejected_candidate_outcomes?on_conflict=id status=500
  {"code":"21000","message":"ON CONFLICT DO UPDATE command cannot affect row a second time"}
REJECTED_RESEARCH_SAVE_FAILED expected=158 persisted=0
```

The batch contains the same `id` twice, so Postgres refuses the entire command — 158 rows in, **0 persisted**. Not a partial failure, a total one. The payload audit immediately before it (`keys=66/66 unknown=[] missingRequired=[] keysetMismatches=0`) passes cleanly, because it validates shape but never checks for duplicate conflict keys. Needs de-duplication on `id` before the post.

### N5 · The new identity reconciliation aborts a whole day on one unresolvable poll

2026-09-11 06:37:40 and 06:38:00 IST (twice):

```
EVAL_FAIL[PREPARING]: EVAL_IDENTITY_UNRESOLVED: poll=2026-09-10T07:20:55Z matches=0; local data retained
  at EvaluationIdentity$SnapshotIndex.resolve(EvaluationIdentity.kt:48)
  at reconcileEvaluationSnapshotIds(MarketMLService.kt:1388)
```

This is Codex's `a712c78`/`c458b64` identity work. It is fail-closed by design and it does retain local data — that part is right. But a *single* snapshot it cannot match kills the entire session's evaluation, twice in a row, with no partial progress. That is what blocked the 09-10 retry that morning, and it's why the day ultimately needed the server-side backfill.

Worth noting the design tension against N1: the evaluator is strict-and-abort in one place (identity) and unguarded-and-crash in another (append). Neither degrades.

### N6 · Not a bug: the 45-minute budget did its job

09-11 17:26 IST logged `EVAL_FAIL[RUNNING]: EVALUATION_TIME_BUDGET_EXCEEDED ... during batch_result_24`. That reads alarming but the checkpoint held — `ml_evaluation_outcomes` for 09-11 now has **18,474 rows across 74 snapshots** (last write 09-12 03:02 UTC), and `ml_daily_accuracy` for 09-11 is populated (49 labeled, 9 wins, 18.37%). The cooperative yield and resume worked exactly as designed. Both 09-10 and 09-11 are now complete.

---

## Revised picture

Nothing in the logs contradicts the audit. Nothing in them confirms F1/F4/F5 either — they simply don't cover the right minutes. The audit's findings still rest on source proof (the nested-vs-flat `forces` mismatch, the 11:00 window, the stability gate), which the logs neither strengthen nor weaken.

What changed: I'm withdrawing the `open=0` observation as notification evidence (it was correct behaviour on a no-position day), the transport layer is now positively cleared, and there are five new evaluation-side findings of which **N1 and N4 are unfixed live defects** and **N3 closes yesterday's open question.**

Suggested order, merged with the audit's:

1. **N1** — guard `appendJsonArrayFile`'s `countJsonArrayFile` call the same way the resume branch is guarded. Small, and the 09-10 log is the proof it's needed.
2. **F1** — the `force_alignment` fallback (audit P0).
3. **N4** — de-duplicate on `id` before posting rejected research.
4. **F4** — the entry-window decision.
5. **N3** — add the NOT NULL constraint on `ml_recommendation_outcomes.snapshot_id` so the two tables fail the same way, then run the archive.
6. **N5** — let identity reconciliation skip and report unresolvable snapshots rather than aborting the session.

Say the word on any of these and I'll build it against `a712c78` with tests and a byte-verified patch.
