# Handoff to Claude — D4 clarification (post b465 ship)

**From:** Chief of Staff / Vivek  
**Date:** 2026-09-12  
**Repos:** Marketapp `0457698` (origin/main) · **Release:** v2.6.34 / b465  
**APK:** https://github.com/vivekashokan007-cloud/Marketapp/releases/tag/v2.6.34  
**Prior:** your 5-commit pack applied via `git am` onto `5bb2118` (589 tests OK; signed release green). MarketVivi labels synced to `v2.6.34 · b465`.

We are **not** asking for more code yet. We want your clarification on D4 as shipped, then a clear “process complete / still open” ruling so we can close the notification track or queue exact follow-ups.

---

## What we believe D4 + percentile port now do

Ownership split (your D4 table), as we understand it on tip:

| condition | owner now | mechanism |
|---|---|---|
| Target Near | **tick (60s)** | `SHADOW_TP` + published `target_pnl_at` composed with `TP_MULT=0.50` via `min` |
| Stop Loss Near | **tick (60s)** | `SHADOW_SL` + published `stop_pnl_at` composed with `SL_MULT=0.60` via `max` (nearer-zero wins) |
| Position Data Incomplete | **tick (60s)** | `SHADOW_DEGRADED` (silent / routine after D1) |
| Exit — EOD | **tick (60s)** | `SHADOW_EOD` |
| Book Profit (forces weak + PnL>0) | **brain (5min)** | `POS_BOOK_*` still notifies; F1 flat `force_alignment` intact |

Brain side (shipped):
- `POSITION_ALERT_OWNERSHIP_VERSION = 'position_alert_ownership_v1_tick_service_authoritative'`
- `POSITION_ALERT_PREFIXES_OWNED_BY_TICK_SERVICE` covers `POS_TARGET_` / `POS_STOP_` / `POS_DATA_QUALITY_`
- `_position_alert_to_contract` → `notify_user=False`, `reason_code=POSITION_ALERT_OWNED_BY_TICK_SERVICE` for tick-owned keys
- Alerts still generated for UI/evidence; `process_contract` partitions notifying vs suppressed so a suppressed position contract cannot shadow an entry contract
- Percentile levels published for tick consumption when `live_percentile_authority` holds; stale (>20 min) → constants

Tick side (shipped):
- Consumes published levels; constants remain safety floor / least-sensitive case
- `policy_trace_json` records basis (`constant_only` / `published_*` / safety-floor cases)
- D1 class-keyed cooldown + D7 prune already on tip

---

## Clarifications we need from you

### Q1 — Is D4 “done” as designed, or is this an interim?
Vivek’s call was “60s path authoritative for position exits.” You kept `POS_BOOK` on brain because tick has no force alignment.  
**Please confirm:** is the dual-engine, disjoint-ownership model the **final** architecture, or should Book Profit eventually move (e.g. publish force/alignment into tick prefs the same way thresholds are published)?

### Q2 — Threshold semantics under composition
Please confirm in one sentence each:
1. Effective TP fires **earlier or equal** vs constants-only (`min(constantTp, publishedTp)`).
2. Effective SL fires **earlier or equal** vs constants-only (`max(constantSl, publishedSl)` with both negative).
3. If publication is absent/stale, behaviour equals pre-percentile tick constants (b462 era).

Any case where publication could make SL/TP **later** than constants? If yes, name it.

### Q3 — Double-notify residual risk
After D4, can the user still get two OS notifications for the “same economic event” in any scenario (including Book Profit + Target Near the same minute, or brain UI text vs tick notify)?  
What log lines prove “single Target Near from tick, brain suppressed” in one poll+tick window?

### Q4 — Field verification: minimal pass/fail for Monday market hours
We will install b465 and clear cache only. Please rank a **minimal** D4 pass criteria (3–5 checks) vs nice-to-have. Especially:
- Exact strings for `SHADOW_EXIT_NOTIFY` / `POSITION_ALERT_OWNED_BY_TICK_SERVICE` / `POSITION_EXIT_THRESHOLDS_PUBLISHED`
- Whether `constant_only` all session is a **fail** or an expected quiet-regime outcome
- Whether we should open a paper position deliberately to force a crossing, or wait for live trades 273–276 style

### Q5 — Process complete?
Relative to the original notification audit (F1–F8) + b460 review (D1–D7, F3, percentile port):

| item | our status guess | your ruling (done / open / wontfix) |
|---|---|---|
| F1 Book Profit forces shape | done in b460 | |
| F2 60s notify + authority | done D4+port | |
| F3 re-entry / prune | done b464 | |
| F4 entry window 09:15 + morning notice | done F4+D6 | |
| F5 stability / choppy mute | **not touched** | |
| F6 trades_v2 live PnL stale | **not touched** | |
| F7 paper PnL basis mismatch | **not touched** | |
| F8 CLAUDE.md channel docs | **not touched** | |
| N1/N3/N4/N5 eval side | N1+N4 corrected; N3 NOT NULL / N5 skip-unresolvable still open? | |

**Ask:** After your answers, is the **notification P0 track complete**, or is there one more patch you would still insist on before calling notifications “closed”?

### Q6 — Anything wrong in how we applied / shipped?
Applied all 5 commits via `git am` (no squash) onto `5bb2118` → tip `0457698`. CI signed release green.  
Any mismatch vs your local `77795b3` tree we should diff, or any post-ship config/docs step we missed (PROJECT_KNOWLEDGE, CLAUDE.md, asymmetric `ml_recommendation_outcomes.snapshot_id` NOT NULL)?

---

## What we will do with your reply

1. Record your rulings in MarketVivi docs.  
2. If you mark notification P0 **complete** → stop coding; only run your field checklist.  
3. If you name a **single next patch** → we will treat that as the next go/no-go (analysis-first unless Vivek says proceed).  
4. F5/F6/F7/F8 and eval N3/N5 stay on a separate backlog unless you elevate them.

Please answer Q1–Q6 directly. No code required unless you find a ship defect that must block field use of b465.
