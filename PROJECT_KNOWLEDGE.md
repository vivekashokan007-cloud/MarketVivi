# Market Radar v2.1 — Project Knowledge (Apr 4 2026, b70)

## Project Overview
- **App:** Market Radar v2.1 — Premium-first PWA for NSE options trading decisions
- **User:** Vivek — part-time options trader, 1 lot at a time, NF primary (BNF secondary)
- **Live URL:** vivekashokan007-cloud.github.io/MarketVivi
- **Repo:** github.com/vivekashokan007-cloud/MarketVivi
- **Stack:** Static PWA + Android APK (Kotlin WebView shell), Upstox API (market data), Supabase (storage + config), GitHub Pages. Zero backend cost.
- **Upstox Analytics Token:** Hardcoded in api.js as fallback. 1-year expiry Mar 2027. Read-only.
- **Supabase URL:** fdynxkfxohbnlvayouje.supabase.co

---

## Dev Rules (STRICT — NON-NEGOTIABLE)
1. Discuss → Confirm → Implement. Never code on suggestion.
2. "study/analyse" = discuss only, no code.
3. Only deliver changed files (push all for clean sync).
4. Always `node --check` JS files before delivering.
5. Never touch DTE multipliers without new calibration data.
6. Never touch NSE holidays without official NSE circular.
7. No live data feeds, broker order placement, or paid backends.
8. BreakoutIQ is a separate app.
9. Before writing ANY new code: check if v1 already solved it.
10. Before changing existing code: read it, identify what works, add alongside not replacing.
11. Flag AFTER success, not before (2PM/3:15PM capture lesson).
12. inputmode="text" for all inputs (Samsung keyboard minus key fix).
13. **PREMIUM IS KING — every feature exists to answer: am I on the right side of the premium?**
14. **Varsity-first strategy selection — market condition → strategy type → then rank strikes.**
15. **Dynamic island — no hardcoded formulas. Everything computed from real LTPs.**
16. **Use `??` for numeric values, `||` only for strings — zero is valid data for calibration.**
17. **EVERY PUSH MUST HAVE NEW VERSION NUMBER.** Multiple updates on same v=N causes browser to serve cached old code.
18. **ADVERSARY MODE: Challenge every assumption, question every profit, only admire when genuinely earned. No sugarcoating.**

---

## Build State — v2.1 b70 (Apr 4 2026)

| File | Lines | Role |
|------|-------|------|
| app.js | 5678 | Full engine: 7 bias signals, 3 forces, Varsity filter, contextScore, paper trading, JSONB snapshots, per-strike poll data, Excel export, intraday chart, range detection, backtest-informed strike selection |
| api.js | 529 | Upstox API: spots, chains, expiries, OHLC, BNF breadth (5), NF50 breadth (50), near-ATM OI walls |
| db.js | 366 | Supabase CRUD: premium_history, trades_v2, chain_snapshots, app_config, signal accuracy |
| bs.js | 146 | Black-Scholes: IV, expected move, sigma scores, IV percentile |
| style.css | 1539 | Light-first Upstox theme, Upstox-style cards |
| index.html | 203 | 4-tab layout, morning inputs, paper trade CSS, SheetJS CDN, export button |
| sw.js | 6 | Self-destruct only |
| manifest.json | 17 | PWA manifest |
| **Total** | **~5678+529+366+146+1539+203=8461** | |

---

## b70 Changes (Apr 4 2026) — Backed by 8,372 trades across 552 days

### Change 1: MAX_SIGMA_OTM = 0.8 cap
- **Source:** Backtest Table 5 — credit sweet spot 0.5-0.8σ (66-84% win). CLIFF at 0.8σ → drops to 52%.
- **Implementation:** New constant `MAX_SIGMA_OTM: 0.8`. contextScore penalizes >0.8σ (-0.15) and >1.0σ (-0.3). Bonus for sweet spot 0.5-0.8σ (+0.2).
- **NOT a hard filter** — candidates beyond 0.8σ still generated but ranked lower.

### Change 2: Bull Put kill switch REMOVED
- **Source:** b68 killed Bull Put based on 0/6 paper losses. Backtest shows BP 54.7-65.5% across all presets.
- **Root cause of 0/6:** ATM narrow strikes — now prevented by MIN_SIGMA_OTM (0.5σ) + MIN_WIDTH (NF:150, BNF:400).
- **Implementation:** Kill switch code replaced with comment explaining why removed. BP returns to its natural Varsity position (PRIMARY for BULL+HIGH IV).

### Change 3: VERY_HIGH VIX → debit co-PRIMARY
- **Source:** Backtest Table 3 — VIX ≥24: debit 91.7% vs credit 86.4%.
- **Varsity alignment:** M5 Ch19 says buy options when expecting vol decrease. At VERY_HIGH, VIX mean-reverts.
- **Implementation:** When VIX ≥ C.IV_VERY_HIGH (24): BEAR bias adds BEAR_PUT to primary alongside BEAR_CALL; BULL bias adds BULL_CALL alongside BULL_PUT; NEUTRAL adds both debit to allowed.

### Change 4: IB/IC EXIT TODAY tag + 3PM alert
- **Source:** Backtest Table 6 — IB 0%, IC 0-4% overnight survival across 1,400+ swing trades.
- **Implementation:** Red "⏱ EXIT TODAY" badge on IC/IB candidate cards. At 2:45 PM (330 min after open), urgent notification fires for any open IC/IB position. Only triggers for IRON_BUTTERFLY and IRON_CONDOR (not DOUBLE_DEBIT).

### Change 5: Sigma sweet spot indicator on credit cards
- **Source:** Backtest Table 5 — 0.5-0.8σ confirmed as Varsity's OTM sweet zone.
- **Implementation:** New `sigmaOTM` field in evaluateCandidate return object. Card shows: green "● SWEET SPOT" for 0.5-0.8σ, yellow "● thin credit zone" for >0.8σ.

### Change 6: CALIBRATION updated with backtest sweep ranges
- **Source:** 3-preset sweep (conservative/moderate/aggressive), 8,372 trades each.
- **Implementation:** Each strategy in CALIBRATION now has `bt_range` and `bt_note` fields alongside paper trade data.

---

## NSE Bhavcopy Backtest — Complete Findings

### Data
- **552 trading days:** Jan 1 2024 → Mar 30 2026
- **21,200,295 rows** of option data (bhavcopy UDIFF format)
- **Supporting data:** 557 VIX days, 558 NF OHLC, 558 BNF OHLC
- **6 strategies:** Bear Call, Bull Put, Iron Condor, Iron Butterfly, Bear Put, Bull Call
- **2 modes:** Intraday (dampened option OHLC) and Swing (next-day spot data)

### Backtest Engine
- **Location:** `C:\Users\HP\OneDrive\Desktop\market_radar_backtest\market_radar_backtest\`
- **9 Python files:** config.py, run_backtest.py, verify_data.py, merge_data.py, engine/bs_model.py, engine/data_loader.py, engine/chain_builder.py, engine/trade_simulator.py, engine/deep_analysis.py
- **Features:** 3-preset sweep mode (`--sweep`), tweakable dampening constants, strategy × market condition tables, per-strategy CSV export
- **Dampening model:** Close-based P&L as anchor + dampened OHLC extremes. Prevents false target hits from uncorrelated leg extremes.

### 3-Preset Sweep Results (8,372 trades each)

| Metric | Conservative | Moderate | Aggressive |
|--------|-------------|----------|------------|
| Dampening (2-leg/IB/IC) | 0.35/0.25/0.30 | 0.50/0.35/0.45 | 0.65/0.50/0.60 |
| Swing theta/day | 12% | 18% | 22% |
| Win rate | 47.1% | 58.8% | 64.3% |
| Net P&L | Rs.8.9M | Rs.12.9M | Rs.16.1M |
| Avg/trade | Rs.1,058 | Rs.1,542 | Rs.1,929 |
| Costs % of paper | 42.6% | 33.8% | 29.0% |
| Max Drawdown | Rs.-51,107 | Rs.-14,166 | Rs.-1,749 |
| Losing days | 68/459 (15%) | 17/459 (4%) | 2/459 (0.4%) |

### Strategy Win Rates Across All 3 Presets

| Strategy | Conservative | Moderate | Aggressive | Range | Verdict |
|----------|-------------|----------|------------|-------|---------|
| **Bull Call** | **64.0%** | **69.6%** | **72.2%** | 8pt | 🔥 MOST ROBUST |
| **Bear Put** | **54.4%** | **62.8%** | **67.5%** | 13pt | 🔥 ROBUST |
| Bear Call | 44.7% | 66.8% | 77.1% | 32pt | ⚠️ Dampening-sensitive |
| Bull Put | 45.7% | 65.5% | 74.4% | 29pt | ⚠️ Dampening-sensitive |
| IB | 34.1% | 43.0% | 48.0% | 14pt | ❌ Never above 50% |
| IC | 37.5% | 46.0% | 49.1% | 12pt | ❌ Never above 50% |

**Key insight:** Debit strategies are ROBUST because their P&L comes from real spot movement. Credit strategies are dampening-sensitive because their P&L depends on simulated option OHLC assumptions. Reality is between conservative and moderate.

### Strategy × Mode (Intraday vs Swing at Moderate)

| Strategy | Intraday Win% | Intraday Avg | Swing Win% | Swing Avg |
|----------|--------------|--------------|------------|-----------|
| IB | 85.9% | 2,835 | **0.0%** | -1,744 |
| IC | 88.4% | 2,055 | **3.6%** | -1,901 |
| Bear Call | 81.4% | 2,771 | 52.2% | -122 |
| Bull Put | 91.1% | 2,556 | 39.8% | -363 |
| Bear Put | 71.7% | 1,918 | **53.9%** | 3,746 |
| Bull Call | 79.6% | 2,087 | **59.5%** | 4,039 |

**Finding: Intraday >> Swing for ALL strategies. IB/IC NEVER overnight.**

### Table 3: VIX Regime × Credit vs Debit (Intraday)

| VIX Regime | Credit Win% | Credit Avg | Debit Win% | Debit Avg | Winner |
|-----------|------------|------------|-----------|-----------|--------|
| LOW (<15) | 86.9% | 2,596 | 74.3% | 1,942 | CREDIT |
| NORMAL (15-20) | 86.5% | 2,538 | 76.0% | 2,019 | CREDIT |
| HIGH (20-25) | 89.5% | 2,455 | 78.8% | 2,054 | CREDIT |
| **VERY_HIGH (24+)** | 86.4% | 2,023 | **91.7%** | 2,871 | **DEBIT** |

**Confirms Varsity:** Sell premium in normal conditions. Buy premium only in extreme VIX.

### Table 5: Credit Strike Sweet Spot (Intraday, BC+BP only)

| Sigma | Trades | Win% | Avg P&L | Verdict |
|-------|--------|------|---------|---------|
| 0.3-0.5σ | 517 | 99.0% | 2,118 | SWEET (inflated — near ATM) |
| **0.5-0.6σ** | **316** | **94.9%** | **1,793** | **SWEET** |
| **0.6-0.7σ** | **72** | **83.3%** | **3,240** | **SWEET** |
| **0.7-0.8σ** | **32** | **84.4%** | **3,916** | **SWEET** |
| 0.8-1.0σ | 50 | 52.0% | 2,924 | **CLIFF — 32pt drop** |
| 1.0-1.5σ | 78 | 42.3% | 1,772 | AVOID |

**MIN_SIGMA_OTM = 0.5 (floor) and MAX_SIGMA_OTM = 0.8 (soft cap) are correct.**

### Table 6: Swing — What Survives Overnight (dampening-independent, MOST TRUSTWORTHY)

| Strategy | After UP | After DOWN | After FLAT | Overall |
|----------|---------|-----------|------------|---------|
| **Bull Call** | **76%** | 35% | 66% | **60%** |
| **Bear Put** | 25% | **70%** | 62% | **54%** |
| Bear Call | 56% | 42% | 55% | 52% |
| Bull Put | 28% | 48% | 39% | 40% |
| IC | 2% | 2% | 5% | 4% |
| IB | 0% | 0% | 0% | **0%** |

**These are the most trustworthy numbers in the entire backtest — no dampening, pure next-day spot data.**
- After UP day → Bull Call swing 76% (momentum continues)
- After DOWN day → Bear Put swing 70% (momentum continues)
- IB/IC 0% → NEVER hold overnight

---

## Update Note (May 22 2026) — Batch 2 IV Edge Calibration

- `brain.py` now applies bounded IV Edge calibration by blending internal `probProfit` toward Upstox POP.
- Added constants:
  - `IV_EDGE_MIN_POP = 35`
  - `IV_EDGE_MAX_POP = 95`
  - `IV_EDGE_BLEND = 0.35`
  - `IV_EDGE_MAX_SHIFT = 0.08`
- Added helpers:
  - `_normalize_pop_pct(pop_value)`
  - `_apply_iv_edge_boost(prob, upstox_pop)`
- Applied in:
  - `_build_candidate(...)` (2-leg spreads)
  - Iron Condor candidate generation
  - Iron Butterfly candidate generation
- Candidate payload now includes:
  - `probProfit` (calibrated)
  - `rawProbProfit` (original model value)
  - `ivEdgeBoost` (applied signed shift)
- UI can now consistently show `P(Range)` vs `P(Profit)` divergence using real calibrated values.
- Pending follow-up: live-day tuning of blend/clamp values and threshold validation against outcome labels.

## Update Note (May 22 2026) — Batch 3 OI Velocity Wiring

- Live poll payload now carries total OI fields required by `brain.py` OI velocity logic:
  - `bnfCOI`, `bnfPOI`
  - `nfCOI`, `nfPOI`
- ML poll snapshot persistence now records OI velocity telemetry inside `market_forces_json`:
  - BNF/NF total call and put OI
  - rolling poll-window OI velocity %
  - profile-level `oiVelocity` values
- This closes the end-to-end OI velocity data gap from Kotlin poll capture to Python brain to ML snapshot storage.

## Update Note (May 22 2026) — Batch 4 Export Retention Cleanup

- Added automatic retention cleanup for Supabase Storage bucket `EXPORTS` in `app.js` export workflow.
- Cleanup executes after successful upload and does not fail the export if cleanup encounters errors.
- Retention policy:
  - keep at most 30 recent export files
  - keep files not older than 14 days
  - never delete the file uploaded in the current export run
- Export success text now includes cleanup deletion count when applicable.

## Update Note (May 22 2026) — Batch 5 Timeout Hardening

- Added timeout protections on high-impact Python bridge paths:
  - `MarketWatchService.kt`
    - `take_poll_snapshot` guarded (4s)
    - `notification_agent_process` guarded (3s)
  - `MarketMLService.kt`
    - `evening_evaluator` guarded (45s)
  - `NativeBridge.kt`
    - `validate_model` guarded (8s)
    - `ml_score_bridge` guarded (2.5s)
- Added explicit timeout log markers for easier production diagnostics.
- Behavior now degrades safely on slow Python calls (timeouts + warning logs), reducing risk of service thread blockage.

## Update Note (May 22 2026) — Batch 6 ML Aggregation Loop

- Added post-evaluation aggregation pipeline in Android `MarketMLService`:
  - daily rollup from evaluator outcomes (primary + labelable)
  - weekly rollup on Saturday
  - monthly rollup on last Friday
- Daily summary writes to:
  - `ml_daily_accuracy` (fallback `ml_accuracy_daily`)
- Weekly summary writes to:
  - `ml_weekly_accuracy` (fallback `ml_accuracy_weekly`)
- Monthly summary writes to:
  - `ml_monthly_summary` (fallback `ml_accuracy_monthly`)
- Month-end hard gate:
  - sets `hard_gate_triggered` when labeled rows >= 500
  - triggers retrain-readiness check/notification when gate is hit
- Current implementation is H2-primary based because `evening_evaluator` currently labels H2 outcomes.

## Update Note (May 22 2026) — Push & Signed Release Procedure

- Mandatory for every `Marketapp` push:
  - bump `versionCode` and `versionName` in `app/build.gradle.kts`
  - commit bump before push
- Release workflow trigger:
  - `.github/workflows/release.yml` runs on push to `main` only when `app/build.gradle.kts` changed
- Update detection behavior:
  - app checks GitHub `releases/latest`, not raw commits
  - if signed release publish fails, app will still show “up to date”
- Failure triage sequence:
  1. Open failed Actions run
  2. Expand `Build Signed APK`
  3. Fix compile/signing issue
  4. Bump version again and push
- Known regression fixed:
  - `NativeBridge.kt` unresolved reference to `selectAppConfigLite`
  - fixed by restoring `selectAppConfigLite()` in `SupabaseClient.kt`
  - then version bumped and workflow re-triggered.

## Update Note (May 22 2026) — ML Tab Visibility Fix

- Problem: UI build `v2.1 · b169` had no visible ML tab even though ML render logic existed.
- Root cause: `index.html` tab bar/container did not include ML tab nodes.
- Fix:
  - Added `🧠 ML` tab button (`data-tab="ml"`)
  - Added `tab-ml` with `ml-content` container
  - Bumped visible web build label to `b170`
- Functional verification:
  - Tab reads real native bridge data (`getMLModelStatus`, `getMLDecisions`, `getSignalAccuracyStats`, `getBrainResult`, `getPollHistory`, `getServiceStatus`)
  - Retrain control triggers native ML retrain readiness flow.

### Findings That DON'T Matter (no edge found)

| Factor | Result |
|--------|--------|
| Shijumon Mon-Wed sell vs Thu-Fri buy | NO DIFFERENCE (39-60% across presets) |
| Day of week | Flat across all days (57-61%) |
| Chart patterns (inside day, uptrend, etc.) | NO edge (66% vs 66%) |
| VIX regime on overall win rate | Surprisingly flat (46-67% across LOW/NORMAL/HIGH) |
| Consecutive direction days | No consistent edge |
| DTE (days to expiry) | Flat (57-61%) |

### Backtest Limitations (Adversary Notes)

1. **OHLC dampening is a guess.** We use 35-65% dampening on option OHLC extremes. Real dampening depends on intraday option tick data we don't have.
2. **Intraday win rates are inflated.** The simulation can't tell WHEN during the day price extremes occurred. A day that gapped up then crashed shows both high and low — benefiting both bull and bear strategies simultaneously.
3. **Tables 1, 2, 4 are NOT directionally reliable.** Strategy × day direction shows credit strategies winning on DOWN days (should be opposite for Bull Put). This is the OHLC timing artifact.
4. **Table 3 (credit vs debit by VIX) and Table 6 (swing) ARE reliable.** Both use relative comparisons (same OHLC limitation affects both sides) or pure spot data (no OHLC involved).
5. **Only 248 trades in HIGH VIX.** Most of our 2026 paper trading was VIX 24+, which is barely represented.
6. **No FII/DII data in backtest.** Optional — doesn't affect strategy simulation.

---

## Completed Trades (39+ total)

### Real Trades (5)
| # | Strategy | Index | Date | P&L | Key Lesson |
|---|----------|-------|------|-----|-----------|
| 1 | BPS | BNF | Mar 13-16 | +₹933 | HDFC 28% weight masked by breadth |
| 2 | BPS | BNF | Mar 19 | ~₹0 | Buying puts after gap-down = inflated IV |
| 3 | BCS | BNF | Mar 20 | +₹1,130 | P&L Dropping alert worked |
| 4 | BCS | BNF | Mar 23 | +₹1,118 | 3/3 aligned, VIX 25.3 |
| 5 | BCS | NF | Mar 25 | -₹1,537 | ATM sell on 1.47σ gap-up. 9 lessons → b53 fixes |

**Running total: +₹1,643 from 5 trades, 3 winners. Kelly%=31%.**

### Paper Day 1 (Mar 27, b55) — 4 trades, all BULL_PUT, all lost
- Total: -₹4,026. Root cause: 3 stale BULL signals dominated despite bearish reality. Led to Phase 10 (Chain Validation).

### Paper Day 2 (Mar 30, b56-b58) — 5 trades: 4 BEAR_CALL + 1 IRON_CONDOR, all won
- Total: +₹9,834. Chain validation correctly showed STRONG BEAR.

### Paper Day 3 (Apr 2, b67-b68) — 6+ trades
- BNF IB +₹11,706, NF IB +₹7,865, NF IC +₹1,417, BNF BC -₹455. Total +₹20,533 paper.
- Upstox cross-verification: prices match within ₹3-9/leg. P(Profit) 4.2x overestimated.

---

## Architecture — Single Loop Design

### Morning Scan (Lock & Scan)
Enter FII Cash + Short% + optional fields → Lock & Scan → Heavy fetch → 7-signal bias → Varsity filter → candidates. Morning bias saved to Supabase (first scan only).

### Watch Loop (5 min)
Light fetch → bias recompute → drift detection → forces update → P&L update → CI update → journey tracking → poll history snapshot (28 market fields + per-strike ATM±10) → save to Supabase → notifications → render. **AUTO-STOPS when market closes (after 3:35 PM IST).**

### Afternoon Positioning (Phase 8)
2PM baseline → 3:15PM comparison → Tomorrow Signal → positioning candidates.

### Page Refresh Recovery
DOMContentLoaded → DB.getAllConfig() → restore morning/evening/polls → loadOpenTrade() → renderAll.

---

## Bias Engine — 7 Signals

| # | Signal | Source | Threshold |
|---|--------|--------|-----------|
| 1 | FII Cash | Manual | > ±500Cr |
| 2 | FII Short% | Manual vs yesterday | > 85% increasing = BEAR |
| 3 | Close Char | Auto OHLC | ≥ ±1 |
| 4 | PCR near-ATM | Auto chain (±10 strikes) | > 1.2 BULL, < 0.9 BEAR |
| 5 | VIX Direction | Auto vs yesterday | > ±0.3 |
| 6 | Futures Premium | Auto chain (synthetic) | > ±0.05% |
| 7 | DII Absorption | Manual + auto compare | Direction + level combined |

**Chain Validation (Phase 10):** Overnight delta (Dow, Crude, GIFT) + gap direction → CONFIRMED/LIKELY/UNCERTAIN → neutralize stale signals.

## 3 Forces on Every Trade

| Force | What | Credit | Debit |
|-------|------|--------|-------|
| F1 Direction | Bias alignment | +1 if matches | +1 if matches |
| F2 Theta | Time decay | Always +1 | Always -1 |
| F3 IV | VIX regime + IV%ile | +1 if HIGH/VERY_HIGH | +1 if LOW |

## Varsity Filter (b70 — updated with backtest findings)

### Base Filter (Zerodha Varsity Modules 5, 6)
| Bias + IV | PRIMARY | ALLOWED | BLOCKED |
|-----------|---------|---------|---------|
| BEAR + HIGH | Bear Call | Bull Put, IC | Bear Put, Bull Call, IB |
| BULL + HIGH | Bull Put | Bear Call, IC | Bull Call, Bear Put, IB |
| NEUTRAL + HIGH | IC | Bear Call, Bull Put | Others |
| BEAR + LOW | Bear Put | Bear Call | Bull Put, Bull Call, IC, IB |
| BULL + LOW | Bull Call | Bull Put | Bear Call, Bear Put, IC, IB |
| NEUTRAL + LOW | Double Debit | IC | Others |

### b70 Overrides
1. **Bull Put kill switch REMOVED** — BP stays in natural Varsity position. 0/6 paper failure was ATM narrow strikes, now prevented by MIN_SIGMA_OTM + MIN_WIDTH.
2. **VERY_HIGH VIX (≥24) → debit co-PRIMARY** — Bear Put joins BEAR_CALL as co-PRIMARY when BEAR+VERY_HIGH. Bull Call joins BULL_PUT when BULL+VERY_HIGH.
3. **Range detection → IB/IC PRIMARY** (b68, unchanged) — when range-bound + after 10:30 + high VIX.
4. **IB always blocked for real trades** (margin concern at ₹1.1L).
5. **Paper mode unlocks ALL strategies** when no real trades open.

---

## Strike Selection (b69 → b70)

### Hard Filters (reject candidates)
- `MIN_SIGMA_OTM: 0.5` — credit BC/BP must sell ≥0.5σ from ATM. IB/IC exempt.
- `MIN_WIDTH_NF: 150, MIN_WIDTH_BNF: 400` — narrow directional credit spreads rejected.
- `MIN_CREDIT_RATIO: 0.10` — credit/width must be ≥10%.
- `MIN_PROB: 0.50` — P(Profit) must be ≥50%.

### Soft Scoring (contextScore, affects ranking)
- **Sweet spot bonus (+0.2):** 0.5-0.8σ OTM — backtest confirmed
- **Cliff penalty (-0.15 to -0.3):** beyond 0.8σ — backtest Table 5 cliff
- **ATM penalty (-0.25 to -0.5):** below 0.5σ — calibration + backtest
- **Width bonus (+0.1):** width ≥ 2× minimum
- **VIX direction penalty (-0.1 to -0.3):** swing mode + falling VIX for credit
- **Gap conflict penalty (-0.4 to -0.7):** trading against >0.8σ gap

### Card Indicators
- **Sigma badge:** Green "● SWEET SPOT" for 0.5-0.8σ, Yellow "● thin credit zone" for >0.8σ
- **EXIT TODAY badge:** Red tag on IB/IC candidate cards
- **Track Record:** Paper + backtest range display

---

## Supabase Schema (4 tables + 1 storage bucket)

### premium_history
(date, session) unique. Sessions: 'morning', 'close'. Fields: nf_spot, bnf_spot, vix, nf_atm_iv, bnf_atm_iv, pcr, fii_cash, fii_short_pct, dii_cash, fii_idx_fut, fii_stk_fut, futures_premium_bnf, bias, bias_net.

### trades_v2
Full trade lifecycle: entry conditions (35+ fields), exit conditions (18 fields), journey timeline (JSONB), paper boolean, trade_mode.

### chain_snapshots
(date, session) unique for morning/2pm/315pm. Full OI structure + tomorrow_signal.

### app_config
Key-value store: evening_close, global_direction, morning_bias, morning_inputs, poll_history_YYYY-MM-DD, settings.

### Storage: EXPORTS bucket
Public bucket for Excel export files.

---

## Constants (SACRED — don't change without data)
- CAPITAL=110000, NF_LOT=65, BNF_LOT=30, MAX_RISK=10%
- NF_WIDTHS: [100,150,200,250,300,400], BNF_WIDTHS: [200,300,400,500,600,800,1000]
- IV regimes: LOW≤15, NORMAL 16-19, HIGH≥20, VERY_HIGH≥24
- PCR thresholds: >1.2 BULL, <0.9 BEAR (near-ATM, contrarian)
- **Strike: MIN_SIGMA_OTM=0.5, MAX_SIGMA_OTM=0.8** (b70, backtest-confirmed)
- **Strike: MIN_WIDTH_NF=150, MIN_WIDTH_BNF=400** (b69)
- Time gates: first 15min suppressed, 11:30-14:30 sweet spot
- Poll: 5min light, 30min routine notify. Auto-stop after market hours.
- NSE Holidays 2026 (15): Jan-26, Mar-03, Mar-26, Mar-31, Apr-03, Apr-14, May-01, May-28, Jun-26, Sep-14, Oct-02, Oct-20, Nov-10, Nov-24, Dec-25
- DTE multipliers, getVixMult, NF_PUT_SKEW=1.35, distFactor, winProb formula, Varsity tier multipliers (1.0/0.65/0.35) — CALIBRATED, do NOT change.

## Script Load Order
supabase CDN → SheetJS CDN → bs.js → db.js → api.js → app.js

---

## Premium Thesis (evolved Apr 4 2026)
"Premium direction is the ONLY thing that matters — BOTH sides. Credit SELL when premium will shrink (intraday, 0.5-0.8σ OTM). Debit BUY when premium will explode (VERY_HIGH VIX, momentum swings). App must recommend BEST side based on data, not default to selling."

**Backtest-validated rules:**
1. Credit sells: 0.5-0.8σ OTM sweet spot (66-84%). Below = too risky. Above = too thin.
2. VIX < 24: credit preferred (86-90% vs 74-79% debit). VIX ≥ 24: debit preferred (92% vs 86%).
3. IB/IC: intraday ONLY. 0% overnight survival. EXIT before 3:20 PM.
4. Swing momentum: After UP day → Bull Call 76%. After DOWN day → Bear Put 70%.
5. Day-of-week, chart patterns, consecutive days: NO EDGE. Don't trade on these signals.

---

## Known Issues (b70)

### CRITICAL
1. **Excel download doesn't work in APK WebView.** File uploads to Supabase Storage but WebView blocks all JS download triggers. Workaround: download from Supabase dashboard. Fix: add DownloadListener to APK Kotlin code.

### IMPORTANT
2. **api.js parseChain may not pass iv/delta/volume/pop** from Upstox greeks. Verify on next trading day.
3. **getAllConfig fetches ALL `app_config` rows** including poll_history. After 60 days (~15MB) will slow load. Fix: filter poll_history_* out.

### MINOR
4. Old export files accumulate in EXPORTS bucket — no cleanup.
5. P(Profit) 4.2x overestimated vs Upstox pop — IV Edge Boost disabled (b67), calibration pending.

---

## Phase 11 Remaining Scope
- [ ] OI velocity tracking (wall building/crumbling speed)
- [ ] Day-of-week buy/sell preference → CANCELLED (backtest: no edge)
- [ ] IV Edge Boost validation (compare P(Profit) vs Upstox pop vs actual)
- [ ] Dynamic strike distance: VIX>25 + DTE≤1 → min 0.5σ OTM → DONE (b69/b70)
- [ ] Fix APK WebView download (Kotlin DownloadListener)
- [ ] Fix api.js parseChain to pass through iv/delta/volume/pop
- [ ] Fix getAllConfig scaling — filter out poll_history_* keys

## Phase 12+ Roadmap
- [ ] **Swing momentum signal** (yesterday UP → suggest Bull Call next morning) — b71 candidate
- [ ] Calibration Engine Phase A after 50 trades
- [ ] Sigma-based widths
- [ ] Live Dow/Brent API
- [ ] High Conviction Mode after 50+ trades
- [ ] Compact waterfall visible on cards + morning bias drift detection
- [ ] Zerodha Kite Connect Personal API for order execution (Upstox=DATA, Zerodha=EXECUTION)

---

## Key Insights (31 total)
1-18: See v1 archive.
19. Don't sell ATM credit on gap-up against gap direction.
20. OI walls shift on gap-up >1σ.
21. Position forces show entry thesis, not live danger. CI is the live warning.
22. P(Profit) must use breakeven, not sell strike.
23. Swing mode should sell OTM near walls. Intraday can sell ATM for max theta.
24. 17 DTE is suboptimal for theta capture. Sweet spot: 3-7 DTE.
25. Stale data is #1 enemy. Phase 10 Chain Validation fixed Day 1 paper failure.
26. Android WebView blocks ALL file downloads.
27. **Debit strategies are most ROBUST in backtest** — Bull Call 64-72%, Bear Put 54-68% barely change across dampening presets. Credit strategies swing ±30pts depending on assumptions.
28. **0.5-0.8σ is the credit sell sweet spot** — Varsity's predicted 66% confirmed. Cliff at 0.8σ drops to 52%.
29. **IB/IC have 0% overnight survival** — NEVER hold 4-leg positions overnight. Intraday only.
30. **Swing momentum is real** — After UP: Bull Call 76%. After DOWN: Bear Put 70%. Most trustworthy backtest numbers.
31. **Day-of-week, chart patterns, consecutive days: NO statistical edge** across 8,372 trades. Don't trade on these signals.

---

## Revert References
v1: Phase 2(2740) → Phase 3(3841) → Phase 4(4383) → Phase 5(4762) → Phase 5.1(4934) → Phase 5.2(5339)
v2: b46(6234) → b50(3954) → b51(4033) → b52(4052) → b53(4106) → b53b(4119) → b54(~4238) → b55(4596) → b56(~4700) → b57(5173) → b58-b64(download fixes only) → b65(5221) → b66(5221) → b67(5305) → b68(5563) → b69(5641) → **b70(5678) CURRENT**

## Transcript References
- `/mnt/transcripts/2026-04-02-05-08-02-market-radar-b66-b67-phase12.txt` — Days 3-4 paper, calibration design
- `/mnt/transcripts/2026-04-03-03-42-06-market-radar-b66-b69-full-session.txt` — Day 4 paper, 25-trade calibration, b69 code
- `/mnt/transcripts/2026-04-03-13-37-24-market-radar-b68-b69-backtest-engine.txt` — Backtest engine creation, 552 days, Python setup, 3 runs
- Current session (Apr 4): Backtest fixes, dampening, sweep, conditional analysis, b70 implementation

## Next Trading Day
**April 7, 2026 (Monday)**
- Apr 3 = Mahavir Jayanti holiday (today)
- Apr 4 = Friday (today — session day, not trading)
- First live day with b70
- Watch: Bull Put candidates appearing (kill switch removed)
- Watch: VERY_HIGH VIX debit co-PRIMARY (if VIX stays elevated)
- Watch: Sigma sweet spot indicator on credit cards
- Watch: EXIT TODAY tags on IB/IC
- Continue paper trading to 50 trades (~11 more needed)

---

## Latest Fix Log

### 2026-05-22 — ML V2 Supabase and Directive Fixes
- Supabase schema gate confirmed complete:
  - `chain_slices`
  - `ml_brain_snapshots`
  - `ml_decisions`
  - `ml_evaluation_outcomes`
  - `ml_recommendation_outcomes`
  - `ml_option_chain_snapshots`
  - `ml_daily_accuracy`
  - `ml_weekly_accuracy`
  - `ml_monthly_summary`
- `ml_decisions.outcome_pct_of_max` confirmed present as `double precision`.
- RLS policies confirmed for the five new ML V2 tables:
  - `ml_daily_accuracy.allow_anon_ml_daily_accuracy`
  - `ml_monthly_summary.allow_anon_ml_monthly_summary`
  - `ml_option_chain_snapshots.allow_anon_ml_option_chain_snapshots`
  - `ml_recommendation_outcomes.allow_anon_ml_recommendation_outcomes`
  - `ml_weekly_accuracy.allow_anon_ml_weekly_accuracy`
- Each policy grants `ALL` to `{anon,authenticated}`.
- Important Supabase compatibility note:
  - `chain_slices` is a BASE TABLE in this project, not a view.
  - `ml_evaluation_outcomes` is also a BASE TABLE in this project, not a view.
  - Do not run `CREATE OR REPLACE VIEW` against either name.
- PWA `app.js`:
  - `closeTrade()` now writes `outcome_pct_of_max` for future ML training quality.
  - old manual `Retrain ML` behavior is retired; the UI now shows `ML Status` and does not call `NativeBridge.triggerMLRetrain()`.
  - visible web build label bumped to `v2.1 · b171`.
- Android `MarketMLService.kt`:
  - retrain readiness filter fixed from `outcome=not.is.null` to `won=not.is.null`.
  - Android version target for this directive is `versionName = "2.3.54"`, `versionCode = 185`.
- `brain.py` remains unchanged:
  - MD5 `4d3605e65eb1a279d6086a1a5dfb741b`
  - required functions still present: `_is_labelable`, `_bridge_json_obj`, `take_poll_snapshot`, `evening_evaluator`.
- Push / release result:
  - `MarketVivi` pushed to `main` through commit `7bf5231`.
  - `Marketapp` pushed to `main` through commit `b630b94`.
  - GitHub Actions signed release and debug validation both completed successfully.
  - Latest release is `v2.3.54` / `Market Radar v2.3.54`.
  - Release asset present: `app-release.apk`.

### 2026-05-15 — Save Evening Close error (`getVarsityFilter is not defined`)
- Symptom:
  - On Market tab, after entering evening values and tapping **Save**, UI showed:
    - `Save failed: getVarsityFilter is not defined`
- Root cause:
  - `renderAll()` path used `getVarsityFilter(...)` in watchlist/positioning rendering.
  - Function definition was missing in `app.js`.
  - `saveEveningClose()` executes `renderAll()` post-save, so render exception appeared as save failure.
- Fix applied:
  - Added `getVarsityFilter(biasObj, vix)` helper in `/root/MarketVivi/app.js`.
  - Returns stable object with:
    - `primary` strategy order,
    - `allowed` strategies,
    - `rangeDetected` flag.
  - Includes range-aware fallback when `STATE.rangeSigma < 0.3`, plus bull/bear/neutral handling.
- Status:
  - Fixed locally, pending your confirmation before push.
