# Ruling — D4 clarification and notification-track status (post b465)

**To:** Chief of Staff / Vivek · **From:** Claude · **Date:** 2026-09-12
**Verified against:** Marketapp `0457698` (origin/main, v2.6.34 / b465) and live Supabase — not from memory of what I wrote.

Your summary table of what D4 + the port now do is **correct as shipped**. I checked each row against tip. One clarification: `SHADOW_DEGRADED` is routed to the `routine` channel, so it is silent *and* on a 60-minute per-class cooldown; the exit classes use 10 minutes on a separate anchor.

---

## Q1 — Is D4 final, or interim?

**Interim by design, and a defensible resting point.** Not something to leave unexamined forever.

The split is not arbitrary: the tick service owns every condition it can *compute* (P&L against a level), and the brain keeps the one it cannot — `POS_BOOK` needs force alignment, which the tick service has no access to. That is a real capability boundary, not a compromise.

What would make me move `POS_BOOK` across: **if you want a single owner for "close this position now."** The publish/consume pattern already works — force alignment could be published into prefs exactly as the thresholds are. I did not do it in this pack for a specific reason worth stating: `force_alignment` is **frozen at trade entry**. Nothing updates it after the trade opens — brain attaches `forces` to candidates and the watchlist only, and the `position_live` write-back does not touch it. So publishing it would move a *stale* signal into the fast path and make it look live.

**The honest sequencing is: fix the staleness first, then move ownership.** Porting it now would dress up a two-day-old reading as a 60-second one. If you want the single-owner model, the prerequisite patch is "recompute forces for open positions each poll", not "publish forces to tick".

---

## Q2 — Threshold semantics under composition

One sentence each, as asked:

1. **Effective TP fires earlier or equal.** `min(constantTp, publishedTp)` selects the lower profit level, and a lower target level is reached sooner as P&L rises.
2. **Effective SL fires earlier or equal.** `max(constantSl, publishedSl)` with both values negative selects the level nearer zero, which is crossed sooner as P&L falls.
3. **Absent or stale publication is exactly b462 behaviour.** `listOfNotNull(...)` collapses to the constant alone, so the fixed `TP_MULT` / `SL_MULT` path is unchanged.

**Is there any case where publication makes SL/TP later? No — and I checked the one mechanism that could have caused it.**

The worry worth ruling out is a *basis mismatch*: published levels are absolute rupees computed by brain against its `max_profit` / `max_loss`, while the constants are computed by the tick service against its own. If the two engines resolved those differently, comparing the resulting levels would be comparing different scales. They do not — both read the same fields off the same `open_trades` blob (`PositionTickService.kt:262-263` reads `max_loss`/`maxLoss` and `max_profit`/`maxProfit`; `brain.py:3144-3145` reads `max_profit`/`max_loss`). Same source, same values.

And even under a hypothetical mismatch the composition is self-protecting: if brain's base were smaller the published level lands nearer the trigger and is selected (earlier); if larger, the constant wins and nothing changes. `min`/`max` cannot produce a later level in either direction.

**The one residual, stated plainly:** a published level can be up to 20 minutes old. If `max_profit`/`max_loss` changed on the trade inside that window, the level is computed against a superseded base. Bounded by `POSITION_EXIT_THRESHOLD_MAX_AGE_MS`, and it can only misplace the level — it cannot disable the constant, which is always in the composition.

---

## Q3 — Double-notify residual risk

**Yes. One residual, and you named it: Book Profit + Target Near.**

D4 deduplicated *identical* conditions. It did not deduplicate *overlapping* ones. `POS_BOOK` fires on `t_aligned <= 1 and current_pnl > 0` (`brain.py:3225`) — there is **no upper bound on P&L**. So a position at 85% of max profit whose entry forces were weak satisfies both the brain's Book Profit and the tick's Target Near. Two OS notifications, different titles, same economic instruction: close it.

How likely in practice: it needs entry `force_alignment <= 1`. All four of your recent open trades were opened at `force_alignment = 2`, so none of them would have hit it. It is a real hole, not a common one.

Two things that are **not** double-notifies, to be precise:
- Brain still *generates* `POS_TARGET_*` for the UI and the evidence trail. That is screen text plus one notification, not two notifications.
- `SHADOW_EOD` near close alongside a still-live `POS_BOOK` is the same overlap class as above.

**Log lines that prove "single Target Near, brain suppressed" in one window** — tick emits, brain records its abstention:

```
PositionTickService  SHADOW_EXIT_NOTIFY: trade=<id> action=SHADOW_TP class=exit outcome=POSTED_TO_OS
MarketWatchService   BRAIN_NOTIFICATION_CONTRACT: type=POSITION_EXIT notify=false
                     reason=POSITION_ALERT_OWNED_BY_TICK_SERVICE key=POS_TARGET_<id>
```

Both present for the same `<id>` in the same poll window is the pass. A second `SHADOW_EXIT_NOTIFY` with `action=SHADOW_TP` for that trade inside 10 minutes, or a `BRAIN_NOTIFICATION_CONTRACT` with `notify=true` on a `POS_TARGET_`/`POS_STOP_`/`POS_DATA_QUALITY_` key, is a fail.

---

## Q4 — Minimal field pass for Monday

**Must pass — 4 checks.** Exact strings from tip:

| # | check | exact marker |
|---|---|---|
| 1 | thresholds publish each poll with a position open | `POSITION_EXIT_THRESHOLDS_PUBLISHED: trades=N` with N ≥ 1 |
| 2 | tick delivers exit alerts, class-tagged | `SHADOW_EXIT_NOTIFY: trade=… action=SHADOW_… class=exit outcome=POSTED_TO_OS` |
| 3 | brain abstains on the same condition | `BRAIN_NOTIFICATION_CONTRACT: … notify=false reason=POSITION_ALERT_OWNED_BY_TICK_SERVICE` |
| 4 | no alert storm | **at most one** `SHADOW_EXIT_NOTIFY` per `(trade, class)` per 10 min; repeats appear as `SHADOW_EXIT_NOTIFY_THROTTLED: … sinceMs=…` |

Check 4 is the one that would have failed on b460 and could not even be observed then — the throttle was unreachable, so `SHADOW_EXIT_NOTIFY_THROTTLED` appearing at all is itself evidence D1 took.

**Nice to have:** `SHADOW_NOTIFY_STATE_PRUNED: removed=N liveTrades=M` after closing a position (D7); `ENTRY_ALERTS_OFF: … outcome=POSTED_TO_OS` at most once on a no-morning-input session (D6); `POSITION_EXIT_THRESHOLDS_STALE` should be absent on a healthy session.

**Is `constant_only` all session a fail? No — expected, and not evidence of a broken port.** `target_threshold_basis` reads `constant_only` whenever the percentile arm lacked authority, which needs support ≥ the minimum, diversity, and stability to all pass. In a quiet regime with little P&L-capture history that is the normal outcome, and the fallback working is the design. **What would be a fail is check 1 failing** — if `POSITION_EXIT_THRESHOLDS_PUBLISHED` never appears, publication is broken rather than merely unqualified. Treat basis as a *diagnostic to read*, not a gate: a full session of `constant_only` tells you the percentile context has no purchase yet on this data, which is worth knowing before you assume the port is doing work.

**Open a paper position deliberately — yes.** Waiting for a natural 273–276-style crossing could take days, and checks 2–4 cannot be exercised without one. A paper Iron Butterfly with a small `max_profit` reaches 50% capture quickly and exercises `SHADOW_TP` the same way a real one does; nothing in the tick path distinguishes paper from real. Just be aware `SHADOW_EOD` fires for every open position after 15:15 regardless, so it will exercise check 2 on its own even if no threshold is crossed.

---

## Q5 — Process complete?

| item | your guess | **ruling** |
|---|---|---|
| F1 Book Profit forces shape | done b460 | **done** — negative-controlled; all three read sites fixed |
| F2 60s notify + authority | done D4+port | **done** |
| F3 re-entry / prune | done b464 | **done** |
| F4 entry window + morning notice | done F4+D6 | **done** |
| F5 stability gate / choppy mute | not touched | **OPEN — and now the binding constraint** |
| F6 `trades_v2` live P&L stale | not touched | **open** — not a notification defect |
| F7 paper P&L basis mismatch | not touched | **open** — low severity |
| F8 CLAUDE.md channel docs | not touched | **open** — see Q6 |
| N1 append guard | corrected | **done** |
| N4 rejected keying | corrected | **done** |
| N3 `snapshot_id` NOT NULL asymmetry | open? | **OPEN — verified still nullable today** |
| N5 identity aborts whole session | open? | **open** |

### The notification P0 track is **not** complete. One patch I would insist on: **F5.**

Your original complaint had two halves. The position half is closed. The entry half is not, and **F4 made F5 more important, not less.**

Before F4, entry alerts were blocked by the 11:00 window — that was the dominant cause, and it is fixed. Now that the window opens at 09:15, every eligible poll reaches the *next* gate, and that gate is F5: `two_poll_stability = stable_action and stable_best` (`brain.py:23322`, gate at `:23579`) requires the **same candidate id** on two consecutive polls, and `_is_market_choppy()` (`:23665`, `flips >= 3`) mutes all entry alerts for 45 minutes (`:23499`). Both are untouched on tip.

Measured on 09-11 production: only **35 of 76 polls** had same-candidate + same-action + non-WAIT. Candidate ids encode the strike (`IB_NF_23300_W250`), so a single strike-step move in spot churns the id and resets stability even when the setup is economically identical. That is the mechanism most likely to still be eating your "conditions were perfect and nothing came" cases.

I am not asking to build it now. I am saying: **do not record the notification track as closed while F5 is open**, because the thing you originally complained about may still be happening for a reason we have identified and not addressed.

F6/F7/F8 and N3/N5 I am content to leave on the separate backlog — with one exception noted below.

---

## Q6 — Anything wrong in how you applied / shipped?

**The application is clean. I verified it rather than taking the commit titles for it:**

- `git diff 77795b3 origin/main` — **empty**. Tip is byte-identical to my tree.
- Per-commit `patch-id` comparison across all five — **all MATCH**. No silent edits during `git am`.
- Full gate on a clean clone of `origin/main` — **589 tests OK**.
- Version markers consistent: `465` / `2.6.34` / `BRAIN_VERSION 2.6.34`; MarketVivi labels synced.

Nothing to diff. Not squashing was the right call — the five commits are separable and each carries its own rationale.

**Three post-ship items, one of which I would not leave long:**

1. **`ml_recommendation_outcomes.snapshot_id` is still nullable — confirmed live today.** `ml_evaluation_outcomes.snapshot_id` is `NOT NULL`; the reco table is `YES`. That asymmetry is precisely what let 8,296 unkeyable rows land in one table while the other correctly refused them. The archive ran cleanly — **0 null rows live, archive table present** — so the cleanup is done, but **the door that let them in is still open.** This is a one-line migration and I would elevate it above the rest of the backlog, because the next identity failure will silently refill the table.

2. **CLAUDE.md is seven builds stale** — still reads `2.6.27 / versionCode 458`. The notification architecture changed materially: ownership split, published thresholds, and three new version constants (`POSITION_ALERT_OWNERSHIP_VERSION`, `POSITION_EXIT_THRESHOLD_PUBLISH_VERSION`, `POSITION_ALERT_REENTRY_COOLDOWN_MS`). That file has its own rule about keeping version markers current, and it drifted for four days once before and had to be caught by grep rather than by reading the log. Its "Notifications" section also still describes three channels; there are six.

3. **PROJECT_KNOWLEDGE** — worth recording the b460→b465 sequence and the D1 finding specifically (a cooldown that was structurally unreachable, measured against production ticks rather than reasoned about), since it is the kind of defect that recurs.

---

## Summary

- D4 as shipped is **correct and interim**; moving `POS_BOOK` requires fixing frozen `force_alignment` first.
- Composition is **provably never less sensitive** than constants, on a verified-common base.
- **One residual double-notify** exists: Book Profit + Target Near, requiring entry `force_alignment <= 1`.
- Field pass is **4 checks**; `constant_only` is not a fail; open a paper position.
- **Notification P0 is not complete — F5 is the one remaining patch I would insist on**, and F4 promoted it to the binding constraint.
- Application was clean. Elevate the **`snapshot_id` NOT NULL migration** out of the backlog; CLAUDE.md needs a doc pass.

No ship defect blocks field use of b465.
