# God-mode audit — notification system, 2026-09-10 / 09-11

**Scope:** every path that can raise a user-facing notification, entry and position.
**Baseline:** Marketapp `6fad471` (origin/main, v2.6.28/b459) · MarketVivi `5a0efe9` · Supabase `fdynxkfxohbnlvayouje`
**Method:** full read of `NotificationHelper.kt`, `PositionTickService.kt`, the notification paths in `MarketWatchService.kt` / `NativeBridge.kt`, `NotificationAgent` + `evaluate_alerts` in `brain.py`, and the position/alert paths in MarketVivi `app.js`; cross-checked against 147 production polls and 2,652 position ticks across the two sessions.

---

## Verdict

You are right, and it is worse than "not near what we expect." This is not tuning. There are **two structurally dead notification paths** — code that cannot fire under any market condition — plus a timing gate that silently disqualifies your best setups of the day.

Your two complaints have **two different root causes**. They are not the same bug.

I have separated what I proved from what still needs your phone log. I am not going to tell you the position bug is 100% closed when one link in that chain lives only on the device.

---

## The architecture, as actually built

Worth stating plainly, because one part of it surprised me:

**The PWA cannot raise any trade notification at all.** Both sides block it. `app.js:2301` refuses any `sendNotification` whose type doesn't start with `ops_`, and `NativeBridge.kt:742-748` refuses it again on the Kotlin side (`JS_NOTIFICATION_BLOCKED`). So every real alert must be produced by `brain.py`'s `NotificationAgent` as a *contract*, during the 5-minute poll, and delivered by `MarketWatchService.dispatchUnifiedBrainNotification`.

That means: **whatever the screen says, if the brain didn't emit a contract that poll, no notification exists.** The UI text and the notification engine are two separate computations. That gap is where both of your complaints live.

---

# PROVEN — dead code, no market condition can trigger it

## F1 · `⚡ Book Profit` can never fire. Not once. Ever.

`brain.py:3215`:

```python
t_forces = trade.get('forces') or {}
t_aligned = t_forces.get('aligned')
...
if t_aligned is not None and t_aligned <= 1 and current_pnl > 0:
    alerts.append({'key': f"POS_BOOK_{t_id}", 'title': '⚡ Book Profit', ...})
```

It reads a **nested** `forces.aligned` off the trade. Nothing anywhere writes that field onto a trade:

- `brain.py` sets `forces` in exactly 6 places (`3996`, `13086`, `13120`, `13508`, `13701`, and `update_watchlist_forces`) — **all of them on candidates or the watchlist, never on an open trade.**
- The PWA writes the trade with **flat** fields: `force_alignment`, `force_f1/f2/f3` (`app.js:2920-2923`).
- `trades_v2` confirms the flat shape in production — the only columns that exist are `force_alignment`, `force_f1`, `force_f2`, `force_f3`, `exit_force_alignment`. There is no nested `forces` anywhere in the schema.
- The PWA's own UI handles this correctly with a fallback (`app.js:5231`): `t.forces || { aligned: t.force_alignment || 0, ... }`. **brain.py has no such fallback.**

So `t_aligned` is permanently `None`, the guard `t_aligned is not None` is permanently false, and the Book Profit alert is unreachable code. The screen shows you a Book Profit button driven by `t.force_alignment`; the notifier looks for `t.forces.aligned`, finds nothing, and stays silent. **That is your "app says book profit, phone stays quiet," exactly.**

Same bug, second consumer: `brain.py:3395` (`forces = trade.get("forces") or {}`) feeds the position verdict/control-index score. With `aligned is None` it silently substitutes `forces_component = 20` out of 40 and sets `forces_ok = True`. So your position scoring has been running on a hardcoded default, not a signal, for as long as this mismatch has existed.

**Fix:** one line, read both shapes, exactly as the PWA already does:
```python
t_forces = trade.get('forces') or {}
t_aligned = t_forces.get('aligned', trade.get('force_alignment'))
```
Apply at `3141` and `3395`. But see F2 before assuming this alone restores Book Profit.

## F2 · A 60-second position evaluator exists, computes exits correctly, and is forbidden from notifying

`PositionTickService` runs every 60s with jitter and evaluates real exit logic (`evaluateShadowPolicy`, line 301) producing `SHADOW_SL` / `SHADOW_TP` / `SHADOW_EOD` / `SHADOW_DEGRADED`. It writes them to `position_ticks` and **notifies nothing** — its only notification is the silent `IMPORTANCE_LOW` foreground-service icon. It contains zero calls to `NotificationHelper.send`.

Meanwhile the live alert path is the 5-minute brain poll, using **completely different thresholds**:

| | Kotlin `PositionPolicyV1` (60s, shadow) | brain.py (5min, live alerts) |
|---|---|---|
| Take profit | `TP_MULT = 0.50` | `TARGET_NEAR_RATIO = 0.8` + percentile |
| Stop loss | `SL_MULT = 0.60` | `STOP_LOSS_RATIO = 0.7` + percentile |
| EOD | `15:15` | separate policy |

Two exit policies that disagree with each other, and the faster, more responsive one is muted by design. Production proof from `position_ticks`, 09-11:

| trade | ticks | P&L range | max_loss |
|---|---|---|---|
| 274 | 385 | **−4,327.50** → +457.50 | 10,497 |
| 276 | 233 | −1,728.00 → +270.00 | 10,076 |
| 275 | 233 | −1,228.50 → +666.25 | 8,170 |
| 273 | 385 | −65.00 → +1,205.75 | 7,641 |

Trade 274 went **41% of the way to max loss** with 385 ticks recorded at `valuation_quality = OK / mark_basis = EXECUTABLE`. The system watched that happen once a minute, all day, and had no mechanism to tell you.

## F3 · Position-alert dedupe never resets — one alert per trade per state, forever

`brain.py:23366-23373`, with the intent stated in the comment:

```python
self.position_alert_keys = current_position_keys
self.operational_alert_keys.intersection_update(current_operational_keys)
# position_alert_states is deliberately NOT pruned
```

Operational alerts get pruned to what's currently live, so they can re-fire later. `position_alert_states` is **never** pruned. Once `POS_TARGET_273` is delivered and acked, `273:POS_TARGET` sits in the persisted agent state permanently — the alert can never fire again for that trade for the life of that state blob.

That is defensible for a trade opened and closed the same day. It is **not** defensible here: trades 273 and 274 have been open since 2026-09-10 and are still open. A position that approaches target on day 1, retreats, and approaches again on day 2 gets exactly one notification, on day 1. There is no episode/cooldown policy — the comment calls it "a separate explicit cooldown/episode policy (N2)" that has not been built.

---

# PROVEN — the entry gate disqualifies your best setups

## F4 · The entry window is 11:00–15:15 IST, and your strongest signals occur before 11:00

`MarketWatchService.kt:2379-2381`:

```kotlin
val hasMorningInput = !morningInputStr.isNullOrBlank()
val wallClockMinutes = cal.get(Calendar.HOUR_OF_DAY) * 60 + cal.get(Calendar.MINUTE)
val entryWindowActive = hasMorningInput && wallClockMinutes in 660..915   // 11:00–15:15 IST
```

`entry_window_active` is a hard condition in the SETUP_READY branch (`brain.py:23302`). Here is 09-11 from production (`ml_brain_snapshots`, times converted to IST):

| IST | action | candidate | eligible | conviction | window? |
|---|---|---|---|---|---|
| 09:50 | SELL PREMIUM | IB_NF_23250_W300 | true | 75.42 | ✗ closed |
| 09:55 | SELL PREMIUM | IB_NF_23250_W300 | true | 79.86 | ✗ closed |
| 10:00 | SELL PREMIUM | IB_NF_23250_W250 | true | 76.97 | ✗ closed |
| 10:30 | SELL PREMIUM | IB_NF_23250_W300 | true | **83.01** | ✗ closed |
| 10:35 | SELL PREMIUM | IB_NF_23300_W250 | true | **84.68** | ✗ closed |
| 10:40 | SELL PREMIUM | IB_NF_23300_W250 | true | **84.68** | ✗ closed |
| 10:55 | SELL PREMIUM | IB_NF_23300_W250 | true | **85.41** | ✗ closed |
| 11:00 | SELL PREMIUM | IB_NF_23300_W250 | true | 84.27 | ✓ open |

At 10:35 and 10:40 you had the *same* candidate, the *same* action, entry-eligible, at 84.68% conviction — every condition the notifier wants, including two-poll stability — and it was categorically ineligible because the clock said 10:40. The day's peak conviction (85.41% at 10:55) missed the window by five minutes.

Across both sessions: 09-10 had 59/71 non-WAIT polls and 61 entry-eligible primaries; 09-11 had 54/76 and 54. There was no shortage of signal.

**Also in that same line:** if `morning_input` is unset for the day, `entryWindowActive` is false for the **entire session** and you get no entry notification at all, with nothing on screen telling you why. I cannot verify from here whether it was set on those days — see "what I need from you."

## F5 · Two-poll stability + a whipsaw mute that is easy to trip

The SETUP_READY branch additionally requires the **same candidate id** on two consecutive polls (`brain.py:23306-23307`). Measured on 09-11: only **35 of 76 polls** had same-candidate + same-action + non-WAIT. Candidate ids encode the strike (`IB_NF_23300_W250`), so a single strike-step move in spot churns the id and resets stability even when the setup is economically identical.

Worse, `_is_market_choppy()` (`brain.py:23381`) counts transitions into non-WAIT across a 6-poll history and mutes **all** entry alerts for 45 minutes at 3 flips. The observed WAIT↔SELL PREMIUM alternation on both days (09-11: WAIT 09:45–10:25, SELL 10:30–11:10, WAIT 11:15–11:35, SELL 11:40…) is exactly the pattern that trips it. When it trips, branch 1 swallows every subsequent poll as `COOLDOWN_ACTIVE` with no user-visible trace.

Position alerts correctly bypass this cooldown — that part is built right.

---

# Secondary, real, worth fixing

## F6 · `trades_v2` is never updated for open positions

`updated_at` for all four open trades is ~1 second after `entry_date` and has not moved since:

| trade | entry_date | updated_at |
|---|---|---|
| 273 | 09-10 04:20:09 | 09-10 04:20:10 |
| 274 | 09-10 04:20:25 | 09-10 04:20:26 |
| 275 | 09-11 06:17:30 | 09-11 06:17:31 |
| 276 | 09-11 06:17:45 | 09-11 06:17:46 |

`current_pnl = 0`, `peak_pnl = 0`, `trough_pnl = null` on every one — while `position_ticks` for those same trades holds the real numbers. Any consumer reading `trades_v2` for live position state is reading stale zeros. (This does **not** by itself prove the brain saw zero — see below. It does mean your cloud record of an open position is fiction until it closes.)

## F7 · Paper trades: the screen and the notifier compute different P&L

`app.js:5236` — `const headlinePnl = isPaper ? paperPnl.netIfClosedNow : currentPnlValue(t);`

For paper trades the number you see is `netIfClosedNow` (gross MTM **minus** estimated round-trip cost). The brain's position alerts threshold on `trade['current_pnl']` from `compute_position_live`. Those are different quantities. All four of your open trades are `paper: true`. Near a threshold, the screen and the notifier will disagree about whether you've crossed it.

## F8 · Minor: `NotificationHelper` throttle and doc drift

The 30s throttle keys on `"$type|$title|$body"` — exact string match, so two different positions hitting "Stop Loss Near" with different bodies both get through. Correct as designed. Note `CLAUDE.md` still documents "three channels — urgent / important / routine"; there are six (`trade_perfect_v1`, `trade_entry_v1`, `trade_update_v1`, `trade_warning_v1`, `trade_routine_v1`, `trade_urgent_v1`). Cosmetic, but this file is supposed to be current.

---

# What I could NOT determine from here — and exactly what I need

Being straight with you about the boundary of this audit:

**The delivery-side outcome lives only on your device.** `brain_notification_meta` is written to SharedPreferences, never to Supabase. So I can prove a contract *should* or *cannot* have been produced, but I cannot see whether one was produced and then dropped by the OS.

Specifically unresolved:

1. **Was `morning_input` set on 09-10 and 09-11?** If not, F4 alone explains zero entry notifications on both days, full stop.
2. **Did `compute_position_live` actually return values in-poll?** brain.py enriches `t['current_pnl']` at line 15134 *before* `evaluate_alerts` runs, so the in-poll value may well be correct even though `trades_v2` shows 0. I explicitly am **not** claiming POS_TARGET/POS_STOP are dead — only that POS_BOOK is. If `compute_position_live` returned `None` (it bails early on `lot_size <= 0` or missing `strategy_type`), then all three position alerts were dead too.
3. **Did the whipsaw mute actually trip,** and how often.

**Send me the phone log covering 09-10 and 09-11** and I can close all three within the hour. The lines that settle it:

- `BRAIN_NOTIFICATION_MODE: mode= selected= attempted= posted= outcomes={...}` — selected-vs-posted is the whole delivery story
- `BRAIN_NOTIFICATION_CONTRACT: type= notify= reason= key=` — `reason_code` will literally say `SETUP_NOT_STABLE`, `COOLDOWN_ACTIVE`, `UNCHANGED_SETUP` or `NO_ACTIONABLE_STATE_CHANGE` per poll
- `POSITION_LIVE_APPLIED: live= open= updated=` — answers (2) directly (note: this is `Log.d`, so I need a debug-level capture, not filtered)
- `JS_NOTIFICATION_BLOCKED` — how often the PWA is trying and being refused

---

# Recommended fix order

**P0 — restores capability that does not exist today**

1. **F1** — read `force_alignment` as a fallback in `brain.py:3141` and `3395`. One line each. Restores Book Profit and un-stubs position scoring.
2. **F4** — decide deliberately what the entry window should be. My read: the 11:00 floor is costing you your best setups, and it should either start at market open or be justified by evidence. Separately, `hasMorningInput` silently killing the whole day needs to surface in the UI — a blocked day should be visible, not silent.
3. **F2** — give `PositionTickService` a live alert path, or move position alerting onto its 60s cadence. A once-a-minute evaluator that cannot speak is the single biggest structural gap here. This also requires reconciling the two threshold sets — one of them has to be authoritative.

**P1 — correctness**

4. **F3** — build the N2 episode policy: re-arm a position alert state after a cooldown, or on re-crossing, rather than one-per-trade-forever.
5. **F5** — make stability economic, not string-identity. Same structure and strike ±1 step should count as stable. Re-examine whether the 45-minute whipsaw mute is worth its cost, and log when it engages.
6. **F6** — update `trades_v2` for open positions on each poll, or stop treating it as a position-state source.

**P2**

7. **F7** — align the paper P&L basis between UI and notifier.
8. **F8** — update `CLAUDE.md` channel docs.

---

## What I did not do

No code changed, nothing pushed, nothing written to the database — read-only source reading plus read-only production queries throughout. I did not fix F1 even though it is one line, because I want your call on F2/F4 first: if position alerting moves to the 60s service, the fix lands in a different place, and I would rather build it once, correctly, than ship a one-liner that a bigger change immediately reworks.

Say which of the P0 items you want built and I will build it against `6fad471` with tests and a byte-verified patch, same as the last handoffs.
