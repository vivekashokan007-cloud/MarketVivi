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

### 2026-05-22 — ML Model Status Regression Found After v2.3.54
- User observed ML tab showing:
  - `Model NOT READY`
  - `Error: too many values to unpack (expected 2)`
- Impact:
  - Affects ML model status / validation.
  - Does not affect live trading decisions because ML is downstream-only.
- Root cause:
  - `RegimeDetector.predict(...)` returns `(label, probs, confidence)`.
  - `MLEngine.predict(...)` still unpacked only `(regime, reg_probs)`.
  - `MLEngine.predict(...)` also referenced `strat` and `ddir` before defining them.
- Fix prepared in `Marketapp`:
  - unpack 3 regime values
  - define `strat` and `ddir` from candidate
  - include `regime_conf` in prediction detail
  - update `ml_engine.self_test()` unpack
  - bump Android version to `2.3.55 (186)`
- Verification:
  - Python compile check passed for `ml_engine.py`, `ml_train.py`, and `brain.py`.
  - `ml_engine.py` self-test passed.

### 2026-05-23 — God Mode Audit Follow-Up
- Reviewed `GOD_MODE_AUDIT_2026_05_21-1.md` against current source.
- Stale/already resolved:
  - candidate IDs exist in generated brain candidates
  - Supabase ML tables and RLS policies are confirmed
  - ML status unpack regression was fixed in `v2.3.55 (186)`
- Safe patch prepared:
  - `brain.py chain_profile()` now guards `step <= 0` to avoid division by zero from duplicate/malformed strike lists.
  - Android version bumped to `2.3.56 (187)`.
  - PWA visible version label updated to `v2.3.56 · b187`.
- Deferred:
  - NSE holiday/margin constants require official/source-confirmed values before changing.
  - `ml_decisions` guard needs an explicit architecture decision.
  - `takeTrade()` NativeBridge caching is performance cleanup.

### 2026-05-23 — Pending Issue Batch
- Issue 1: NSE holiday guard — DONE locally.
  - Official source checked: NSE F&O circular `NSE/FAOP/71777`, dated 2025-12-12.
  - Added 15 weekday F&O trading holidays for calendar year 2026 to `brain.py`.
  - `evening_evaluator()` now skips those dates by returning `[]`.
  - Claude audit holiday list was not used because several dates did not match the official circular.
- Issue 2: margin constants — DONE locally.
  - Mirrored existing PWA protected values into `brain.py`:
    - `BNF_SHORT_MARGIN = 75000`
    - `NF_SHORT_MARGIN = 50000`
  - No candidate-selection behavior changed; existing max-loss/capital risk gates remain authoritative.
- Issue 3: `ml_decisions` guard/architecture — DONE locally.
  - Decision: keep `ml_decisions` active as execution-quality tracking, separate from the V2 brain-snapshot training pipeline.
  - Removed the `cand.p_ml != null` requirement for insert.
  - New behavior: write `ml_decisions` for every saved trade when Supabase is available; ML score fields remain nullable until a model exists.
- Issue 4: `takeTrade()` NativeBridge caching — DONE locally.
  - `takeTradeImpl()` now caches `NativeBridge.getLatestPoll()` once as `latestPoll`.
  - `takeTradeImpl()` now caches `NativeBridge.getPollHistory()` once as `pollHistory` and refreshes that local cache if Kotlin returns a newer history.
  - Trade snapshot and `ml_decisions` insert path now use cached values for the audited hot path.
- Issue 5: market-hours validation checklist/instrumentation — DONE locally.
  - Added `supabase_ml_market_hours_validation.sql`.
  - Script checks current IST session counts for `ml_brain_snapshots`, `ml_option_chain_snapshots`, `ml_decisions`, `ml_recommendation_outcomes`, and `ml_daily_accuracy`.
  - Script also lists recent brain snapshots, chain rows, and daily accuracy rows.
  - Expected use: run after/during the next market session to confirm V2 collection and evening evaluation.
- Release bump for this batch — DONE locally.
  - Android target version: `2.3.57 (188)`.
  - PWA visible label target: `v2.3.57 · b188`.

### 2026-05-23 — God Mode Audit V2 Reply
- Reviewed `GOD_MODE_AUDIT_V2_2026_05_23.md`.
- Audit confirms the critical bug queue is resolved and ML pipeline is structurally ready for first market-hours paper run.
- Stale audit prerequisite:
  - Supabase ML tables/RLS policies are already created and verified.
  - GitHub Actions signed release/debug validation already provide compile evidence; local `compile_errors.txt` in `Marketapp` remains stale.
- Hygiene fixes prepared locally:
  - removed old `MARKET RADAR 05042026.js` snapshot from `MarketVivi`
  - added `.agents/` to `MarketVivi/.gitignore`
  - moved `Marketapp/app/src/main/python/v7_fixtures.json` into `app/src/main/python/tests/fixtures/`
  - replaced remaining render-path `NativeBridge.getPollHistory()` parses with `STATE.pollHistory`
  - bumped Android target to `2.3.58 (189)`
  - bumped PWA visible label to `v2.3.58 · b189`

### 2026-05-23 — Notification Agent Hardening
- Applied Claude directive `DIRECTIVE_NOTIFICATION_AGENT_HARDENING_V2359.md`.
- Android target bumped to `2.3.59 (190)`.
- PWA visible label bumped to `v2.3.59 · b190`.
- `NotificationAgent` now requires `confidence >= 55` before firing `New Setup Ready`.
- Choppy-market alerts now carry the current poll timestamp instead of `0`.
- Kotlin now maps `UPDATE` urgency to the important notification channel.
- Added rationale comment documenting action-level choppy detection.
- Full pytest suite could not run locally because `pytest` is not installed; Python compile and live smoke checks were used instead.

### 2026-05-23 — Notification Sound Architecture Decision
- Separate professional notification sounds are feasible in the Android app.
- Current implementation:
  - `NotificationHelper.kt` has three channels: `trade_urgent`, `trade_important`, `trade_routine`.
  - No custom sound assets exist under `app/src/main/res/raw`.
  - Current behavior uses Android/default channel sounds.
- Android constraint:
  - Android 8+ notification sounds are tied to `NotificationChannel`.
  - Once a channel ID is created on a user's phone, sound changes to that same channel ID may not apply.
  - Use new/versioned channel IDs for custom sounds.
- Recommended channel split:
  - `trade_perfect_v1`: perfect/high-confidence alignment.
  - `trade_entry_v1`: normal confirmed setup.
  - `trade_update_v1`: conviction update.
  - `trade_warning_v1`: choppy/important market warnings.
  - `trade_routine_v1`: routine info.
  - `trade_urgent_v1`: exit-risk, SL/target/book-profit/auth failure.
- Recommended office-suitable sound language:
  - Perfect alignment: short two-note soft chime.
  - Entry setup: single clean bell/pluck.
  - Conviction update: soft rising tick/chime.
  - Warning/choppy: muted low double-tap.
  - Routine: subtle tick or silent by default.
  - Urgent/exit-risk: firm two-pulse tone, not harsh.
- Routing policy:
  - `HIGH` + very strong confidence/perfect alignment -> `trade_perfect_v1`.
  - `HIGH` normal setup -> `trade_entry_v1`.
  - `UPDATE` -> `trade_update_v1`.
  - `WARNING` -> `trade_warning_v1`.
  - `INFO` -> `trade_routine_v1`.
  - `ERROR` and position-risk alerts -> `trade_urgent_v1`.
- Future implementation batch:
  - Add `res/raw/*.wav` or `*.ogg` assets.
  - Update `NotificationHelper.createChannels()` with `AudioAttributes` and `setSound(...)`.
  - Extend `NotificationHelper.send(...)` to route by richer alert type or optional sound class.
  - Keep old channel IDs as compatibility fallback.
  - Bump Android version before push.

### 2026-05-23 — Notification Sounds Implementation
- Applied Claude directive `DIRECTIVE_SOUNDS_IMPLEMENTATION_V2360.md`.
- Android target bumped to `2.3.60 (191)`.
- PWA visible label bumped to `v2.3.60 · b191`.
- Added six OGG sound assets under `Marketapp/app/src/main/res/raw/`:
  - `sound_perfect_alignment.ogg`
  - `sound_entry_setup.ogg`
  - `sound_conviction_update.ogg`
  - `sound_market_warning.ogg`
  - `sound_routine_tick.ogg`
  - `sound_urgent_risk.ogg`
- `NotificationAgent` now emits `sound_class` in alert JSON.
- Sound-class routing:
  - `perfect`: high-confidence setup, confidence `>= 75`
  - `entry`: normal setup, confidence `55-74`
  - `update`: conviction update
  - `warning`: choppy/whipsaw alert
  - `routine`: setup invalidated / low-priority info
  - `urgent`: risk/error alerts
- `NotificationHelper.kt` now creates six versioned Android notification channels:
  - `trade_perfect_v1`
  - `trade_entry_v1`
  - `trade_update_v1`
  - `trade_warning_v1`
  - `trade_routine_v1`
  - `trade_urgent_v1`
- Old channel IDs are intentionally not reused because Android locks channel sound settings once created on-device.
- Routine notifications are silent by default through `IMPORTANCE_LOW` and `setSound(null, null)`.
- Live trading decision logic, two-poll confirmation, confidence floor, choppy cooldown, and position-risk bypass remain unchanged.

### 2026-05-23 — Notification Sounds Release Status
- Push completed after user confirmation.
- Marketapp commit pushed:
  - `1e8d4d5 Add versioned notification sounds`
- MarketVivi commit pushed:
  - `8331cc9 Document notification sounds release`
- GitHub Actions validation for Marketapp commit `1e8d4d5`:
  - `Market Radar Signed Release`: success
  - run ID: `26325647308`
  - `Market Radar Debug APK Validation`: success
  - run ID: `26325647322`
- Latest GitHub release after workflow completion:
  - tag: `v2.3.60`
  - name: `Market Radar v2.3.60`
  - published: `2026-05-23T06:24:55Z`
  - asset: `app-release.apk`
- Expected app behavior after update:
  - update checker should offer `v2.3.60`
  - Android notification settings may show six new channels plus old legacy channels
  - old legacy channels are harmless and are no longer the intended route for new notification sounds
  - routine notifications are silent by default
  - perfect alignment uses a distinct high-confidence sound path
- Local validation performed before push:
  - `python3 -m py_compile` passed for `brain.py`, `ml_engine.py`, `ml_train.py`
  - six sound assets were present under `app/src/main/res/raw/`
  - smoke tests passed:
    - confidence `78` -> `sound_class = perfect`
    - confidence `65` -> `sound_class = entry`
    - confidence `32` -> no setup alert
    - conviction shift -> `sound_class = update`
    - choppy whipsaw -> `sound_class = warning` with non-zero timestamp
    - setup invalidated -> `sound_class = routine`
- Local Gradle build was not run because Java/JDK is not installed in this environment:
  - blocker: `JAVA_HOME is not set`
  - authoritative Android compile/sign validation came from GitHub Actions.

## Future Phase: Upstox Order Execution (Phase 12)

### Source Document And Verification
- Research document read:
  - `UPSTOX_API_ORDER_EXECUTION_RESEARCH_2026_05_21-1.md`
  - `UPSTOX_API_ORDER_EXECUTION_RESEARCH_2026_05_21-2.md`
  - `PHASE12_ORDER_EXECUTION_AND_BRAIN_CORRECTION_BLUEPRINT.md`
  - `DIRECTIVE_INFRASTRUCTURE_BUILD_PHASE12.md`
- Purpose:
  - future broker order execution architecture
  - sandbox testing
  - order placement
  - margin checks
  - position monitoring
  - kill switch
  - schema additions
- Claude's later blueprint splits the work into:
  - Phase 12A: execution engine
  - Phase 12B: brain calibration and correction
  - Phase 12C: trades_v2 schema expansion
- The infrastructure directive treats Phase 12 as a 5-sprint build:
  - Sprint 1: verify ML pipeline and instrument_key flow
  - Sprint 2: sandbox infra and order proxy settings
  - Sprint 3: execution UI and Supabase execution fields
  - later sprints: paper trading gate and live-readiness hardening
- Status:
  - NOT implemented in current app.
  - Current app remains decision/paper-tracking first; real trade button currently records a real-trade log in `trades_v2`, not broker execution.
- Official Upstox docs were rechecked on 2026-05-23 before saving this roadmap.
- Current official confirmations:
  - Place Order V3 exists at `https://api-hft.upstox.com/v3/order/place`.
  - Place Order V3 is sandbox-enabled.
  - Static IP restriction can block order APIs with error `UDAPI1154`.
  - Market orders may be blocked with `UDAPI1158`; limit order / market protection handling must be respected.
  - Get Funds and Margin V3 exists at `https://api.upstox.com/v3/user/get-funds-and-margin`.
  - Static IP management exists under `https://api.upstox.com/v2/user/ip`.
  - Sandbox-enabled APIs include Place Order, Place Order V3, Place Multi Order, Modify Order, Modify Order V3, Cancel Order, and Cancel Order V3.
- Correction recorded:
  - Research document references kill switch as `/v2/trading/kill-switch`.
  - Current Upstox docs show kill switch under `/v2/user/kill-switch`, with segment values such as `NSE_FO`.
  - Reconfirm endpoint from official docs immediately before implementation.

### Current App Gap
- Current `NativeBridge.kt` stores a manually pasted Upstox access token in SharedPreferences as `auth_token`.
- Current Kotlin polling uses Upstox for:
  - index quotes
  - VIX quote
  - option chain
  - option contracts / expiry discovery
  - market quote snapshots
- Current `MarketWatchService.kt` and `NativeBridge.kt` do not place, modify, cancel, or monitor broker orders.
- Current PWA `takeTradeImpl()` builds a `trades_v2` row from a candidate and saves it to Supabase.
- Current candidate/trade capture does not yet persist broker order fields:
  - `instrument_token` / `instrument_key` per leg
  - `order_id` per leg
  - fill status
  - average fill price
  - margin used
  - execution slippage
- The live option-chain payload already carries `instrument_key` per strike, but our Kotlin parser / candidate builder still does not reliably flow it through to the brain candidate payload.

### Phase 12 Must-Have Architecture
- Broker execution must be opt-in and gated behind sandbox first.
- Trading decision logic must remain separate from execution plumbing.
- Required modes:
  - paper-only
  - sandbox execution
  - live execution
- Required build split from Claude's blueprint:
  - 12A = execution engine
  - 12B = brain calibration / correction loop after fills
  - 12C = Supabase execution schema
- Required hard gates before any live order:
  - valid standard Upstox token
  - static IP/proxy path confirmed
  - fresh instrument keys for the current expiry/session
  - margin check passes
  - available funds check passes
  - explicit user confirmation
  - kill switch available
  - order tag generated
- For Phase 12, Kotlin/Android should own broker execution because it already owns Upstox token storage and network access.
- PWA should request execution through `NativeBridge`, not call broker APIs directly.
- The infrastructure directive adds a higher-confidence implementation order:
  - first add `instrument_key` to strike objects
  - then add `sellInstrumentKey` / `buyInstrumentKey` to `_build_candidate()`
  - then add `check_execution_readiness()` in `brain.py`
  - then add sandbox toggle, proxy URL, and order functions
- The ML tab should stop pretending that the model is "ready" during infra work and instead show the actual collection / execution pipeline state:
  - whether `instrument_key` is flowing
  - whether sandbox is enabled
  - whether execution proxy is configured
  - whether paper/sandbox/live readiness checks pass

### Instrument Key Plan
- Upstox order placement requires `instrument_token` such as `NSE_FO|XXXXX`.
- This is not the strike price.
- Preferred source for Market Radar:
  - extract `instrument_key` from the live option-chain response for each leg.
- Fallback sources:
  - Upstox BOD instruments file
  - official instrument search API if available/approved for the account
- Do not cache F&O instrument keys across sessions because weekly expiries create new keys.
- Candidate builder must eventually carry these fields:
  - `sellInstrumentKey`
  - `buyInstrumentKey`
  - `sellInstrumentKey2`
  - `buyInstrumentKey2`
  - trading symbols if available
  - lot size
- The upstream blueprint explicitly requires the Kotlin strike objects to expose the raw `instrument_key` from the live chain response before any execution work can proceed.

### Order Placement Strategy
- Single/two-leg spreads:
  - use limit orders only.
  - prefer hedge BUY first, then SELL leg, unless using a safe multi-order flow.
- Four-leg strategies such as Iron Condor / Iron Butterfly:
  - use Place Multi Order where possible.
  - all legs share one strategy tag.
  - all legs must return order IDs.
  - if any leg fails, cancel all successfully placed legs immediately.
- Tag format:
  - `MR_{STRATEGY}_{INDEX}_{YYYYMMDD}_{SEQ}`
  - example: `MR_BC_BNF_20260521_01`
- Limit order pricing policy must be explicitly designed:
  - SELL legs should not blindly use stale bid.
  - BUY legs should not blindly use stale ask.
  - define acceptable slippage and retry rules before live execution.

### Required NativeBridge / Kotlin Functions
- Future functions needed:
  - `getAvailableFunds()`
  - `checkMargin(legs)`
  - `placeOrder(...)`
  - `placeMultiOrder(legs)`
  - `getOrderStatus(orderId)`
  - `getOrderFillPrice(orderId)`
  - `cancelOrder(orderId)`
  - `getPositions()`
  - `killSwitchFO(...)`
  - `updateStaticIP(...)`
- These must not be mixed into the existing polling path without clear separation.
- Recommended implementation class:
  - `UpstoxOrderClient.kt`
  - keep `MarketWatchService.kt` focused on polling/brain orchestration.
- Claude's phase directive also adds:
  - `check_execution_readiness(candidate, current_result, ctx)`
  - sandbox toggle storage in prefs
  - order proxy URL storage in prefs
  - explicit execution confirmation UI before sending any broker order
- Sandbox/live transport should be different:
  - sandbox can use direct Upstox API calls
  - live orders may need an Oracle Cloud VM or other static-IP proxy path before Upstox will accept them

### Execution State Machine
- Future live execution should follow this sequence:
  1. Brain/PWA surfaces candidate.
  2. User taps execute.
  3. NativeBridge receives candidate execution payload.
  4. Validate fresh candidate age and current market hours.
  5. Resolve instrument keys for all legs.
  6. Check margin for the full spread.
  7. Check available funds.
  8. Generate strategy tag.
  9. Place orders.
  10. Poll order statuses every 3-5 seconds until terminal or timeout.
  11. Capture average fill price and filled quantity.
  12. Write execution details to Supabase `trades_v2`.
  13. If any leg rejects/fails/partially fills unsafely, cancel remaining open legs and alert user.
- The Claude infrastructure directive wants the user-facing flow to include:
  - a readiness check before execution
  - sandbox mode for request/response validation
  - a paper-trading gate dashboard before live use
  - explicit capture of execution mode on every trade row

### Critical Risk Rules
- Never allow naked short exposure from partial leg execution.
- All spread legs must fill to matching quantity, or the app must cancel/alert.
- Sandbox cannot prove real fill behavior; it mainly proves request/response and lifecycle plumbing.
- Real fill testing must start with tiny controlled exposure only after sandbox passes.
- Static IP requirement may force an Oracle VM/proxy execution path rather than direct phone-to-Upstox order placement.
- Standard access token expires daily; execution flow needs reliable token readiness before market open.
- Analytics/read-only token can be considered for market data later, but live order execution still needs standard access token.

### Supabase Phase 12 Schema Additions
- Future `trades_v2` fields needed:
  - `order_id_sell`
  - `order_id_buy`
  - `order_id_sell2`
  - `order_id_buy2`
  - `actual_sell_price`
  - `actual_buy_price`
  - `actual_net_premium`
  - `execution_slippage`
  - `legs_filled`
  - `all_legs_filled`
  - `margin_used`
  - `kill_switch_available`
- Infrastructure directive also calls for:
  - `execution_mode`
  - `execution_status`
  - `execution_error`
  - `order_tag`
- The blueprint treats `trades_v2` as the long-term source of truth for fill quality, slippage, and calibration data.
- Add explicit execution mode/status fields before coding live execution:
  - `execution_mode`: `paper`, `sandbox`, `live`
  - `execution_status`: `not_sent`, `sent`, `partial`, `filled`, `cancelled`, `rejected`, `unknown`
  - `execution_error`
  - `order_tag`

### Open Questions Before Implementation
- Does current Upstox option-chain payload in our Kotlin parser already preserve per-leg `instrument_key`?
- Should all broker order calls go through a static-IP Oracle VM/proxy, or can the phone connection satisfy static IP restrictions?
- What will be the production token-refresh flow:
  - manual daily paste
  - semi-automated OAuth
  - webhook/Supabase function notifier
- Should sandbox and live use fully separate app settings and tokens?
- What is the exact kill-switch endpoint and payload from official docs at implementation time?

### Future Research Notes: API Spectrum And Single-Leg
- Source: `API_SPECTRUM_SINGLE_LEG_RESEARCH_20260525.md` from Claude.
- Status: future-build research only; not an approved implementation plan.
- Highest-value near-term API additions appear to be the new Market Information APIs:
  - FII / DII data
  - PCR data
  - change-in-OI
  - max-pain
- Rationale:
  - these can reduce or remove fragile manual morning Force 1 entry
  - they may provide better institutional/context inputs than our current chain-derived approximations
  - this is a cleaner near-term upgrade than jumping straight into strategy redesign
- If implemented later, the likely first target is `MarketWatchService.kt`, with the goal of:
  - auto-prefilling Force 1 style morning institutional inputs
  - enriching 5-minute polls with official PCR / OI / max-pain data
- Analytics token remains a candidate for read-only GET flows later, but it is not a substitute for the standard OAuth token used in live authenticated execution flow.
- WebSocket V3 remains the long-term path for real-time option monitoring, but it is a later architecture upgrade and not part of the current app observation phase.
- Portfolio stream feed is execution-phase infrastructure, not needed before live order plumbing exists.

### Future Research Notes: Single-Leg Candidate Path
- Single-leg options should be treated as a paper-research branch only.
- Do not treat Claude's single-leg note as validated trading logic.
- No approval exists yet for:
  - `SHORT_CALL`
  - `SHORT_PUT`
  - `LONG_CALL`
  - `LONG_PUT`
  candidate generation in production use.
- The useful part of the note is the implementation framing:
  - candidate generation would need explicit new strategy types
  - naked margin must use a separate estimation path
  - per-leg monitoring logic is more important than combined P&L alone
- The strongest reusable idea is per-leg breach monitoring before full trade stop triggers:
  - sell-leg delta breach
  - premium multiple breach
  - intrinsic / ITM danger
  - sigma-distance danger zone
- If single-leg is explored later, keep this sequence:
  1. current app / spread engine observation first
  2. single-leg candidate generation in paper mode only
  3. collect at least 30-50 paper trades
  4. compare real paper outcomes vs assumptions
  5. only then consider broader implementation
- Important capital-risk note:
  - single-leg naked options are a different risk class from spreads
  - they must not be treated as a lightweight extension of the current engine

### Current Decision Boundary
- Nothing from the API spectrum / single-leg research should interrupt today's live app observation.
- If post-observation implementation work starts, the likely priority order is:
  1. Market Information API integration
  2. continued safe relay / execution validation
  3. single-leg paper-candidate research later

## 2026-05-26 App Runtime Investigation

### Observed app state from screenshots

- Version on device: `v2.3.60 / b191`
- Morning inputs were visible and saved.
- OI tab showed partial derived values such as:
  - PCR
  - max pain
  - call wall / put wall
  - breadth
- But the core live-monitoring state was inconsistent:
  - header still showed `BNF --  NF --  VIX --`
  - footer showed `Polls: 0`
  - ML tab showed:
    - `Service: STOPPED`
    - `Poll #0`
    - `Last poll Never`
    - `Watchlist: 0`
    - `Candidates: 0`
  - Trade tab still showed `Lock & Scan to generate strategies`
- Logs screen proved native activity was happening in the background:
  - `LEASE_HEARTBEAT_WRITTEN`
  - `EVALUATE_JS_CALLED`
  - `[SYNC] Triggered UI sync from native background data`

### Strongest confirmed bug

- After a successful `NativeBridge.setMorningInput(...)` call, the web layer in `MarketVivi/app.js` immediately called `NativeBridge.setBaseline(...)` again with the result of `collectBaselineFromForm()`.
- This second write could overwrite the richer native morning baseline that already contained:
  - current date
  - live BNF / NF / VIX quotes
  - discovered expiries
- This was a real session-state bug and has been fixed locally by removing that redundant overwrite.

### Export diagnostics issue

- TXT / CSV log export failure could not be diagnosed clearly before.
- Added explicit native export lifecycle logging in `NativeBridge.kt` for:
  - `beginExportFile`
  - `appendExportFileChunk`
  - `finishExportFile`
- This does not guarantee export success by itself, but it makes the next failure observable in the in-app log buffer.

### Files changed locally on 2026-05-26

- `MarketVivi/app.js`
  - removed post-lock baseline overwrite via `NativeBridge.setBaseline(...)`
- `Marketapp/app/src/main/java/com/marketradar/app/NativeBridge.kt`
  - added export lifecycle success/failure logging

### Current status after this investigation

- One definite session-state bug is fixed locally.
- There may still be a second issue in watch-loop / service-state reporting, but it was not proven enough yet to patch safely in the same step.
- No push has been done.
- What is the retry policy for unfilled limit orders?
- Should live execution initially be limited to one-lot defined-risk spreads only?
- Should the ML tab become an infrastructure/control dashboard during Phase 12 instead of a pure model-status page?
- Should live order routing go through an Oracle VM proxy even if sandbox can run direct?
- Which settings page will own sandbox mode and proxy URL controls?

### Oracle Relay Progress (2026-05-24)

- Execution-relay architecture is now the working assumption for future mobile-only Upstox live execution:
  - phone stays the UI / brain / market-data client
  - relay owns only the fixed egress path
- Oracle Cloud Infrastructure setup was completed successfully for the relay proof-of-concept:
  - region: `India West (Mumbai)`
  - instance: `VM.Standard.E2.1.Micro`
  - OS: `Oracle Linux 9`
  - boot volume: default Always Free size
  - shielded instance: `OFF`
  - confidential computing: `OFF`
  - new VCN + new public subnet created
  - reserved public IPv4 attached to primary VNIC
  - static IP: `144.24.117.114`
  - estimated cost at creation: `$0.00`
- Relay bring-up status:
  - `mr-relay.service` is running as `opc`
  - external health check is live at:
    - `http://144.24.117.114:8080/health`
  - confirmed response:
    - `{"ok": true, "service": "market-radar-relay"}`
- HTTPS relay status:
  - self-signed certificate generated on the VM
  - relay updated to listen with TLS on `8443`
  - external HTTPS health check is live at:
    - `https://144.24.117.114:8443/health`
  - confirmed response via `curl -k`:
    - `{"ok": true, "service": "market-radar-relay"}`
- First protected upstream relay test status:
  - initial `/live/static-ip` attempt returned Cloudflare `1010` because Python's default upstream client signature was blocked
  - relay was updated to send a browser-style upstream `User-Agent`
  - relay was also updated to log each forwarded request with status and latency
  - retry result:
    - endpoint: `/live/static-ip`
    - transport: HTTPS via relay on `8443`
    - HTTP status: `200`
    - response body:
      - `{"status":"success","data":{}}`
  - this proves:
    - HTTPS relay path works
    - `X-Relay-Token` gate works
    - Bearer token forwarding works
    - Upstox accepts the authenticated request through the relay
    - Cloudflare no longer blocks the relay after the user-agent fix
- Current hard boundary:
  - HTTP on `8080` was used only for initial `/health` bring-up
  - HTTPS on `8443` is now the approved relay path for any future protected tests
  - relay IP has NOT been registered with Upstox yet
  - Android app has NOT been wired to the relay yet
- Deployment bundle prepared locally:
  - `oracle_relay_deploy_2026_05_24/`
  - `oracle_relay_https_phase_bundle.zip`
- Next approved step:
  - continue protected upstream endpoint testing over HTTPS only
  - next likely read-only endpoint: `/live/funds`
  - still no order routes yet
- Not approved yet:
  - `/live/margin`
  - `/live/order`
  - `/live/multi-order`
  - `/sandbox/order`
  - Upstox IP registration
  - app-side `order_proxy_url` integration

## Notification Agent (brain.py — NotificationAgent class)

### Two separate agent concepts

1. **Explanation/Audit Agent** (`build_explanation_audit_agent`)
   - Produces structured JSON inside the brain result for auditability.
   - Does NOT fire Android notifications.

2. **Live NotificationAgent** (`class NotificationAgent`)
   - Rule-based state machine. Not LLM-based.
   - Controls WHEN and WHETHER to send setup/market-state notifications.
   - Position-risk alerts (SL/target/book-profit) BYPASS this agent entirely.
   - Position-risk bypass is intentional because exits should not wait for setup-alert confirmation/cooldown logic.

### State tracked per poll

- `action`: last brain verdict action
- `strategy`: last strategy type
- `confidence`: last confidence value
- `timestamp`: epoch ms of last state update
- `cooldown_until`: epoch ms until alert suppression lifts
- `verdict_history`: last 6 action strings

### Alert types and conditions

**New Setup Ready** (`HIGH` -> important channel)
- Fires when:
  1. `action != 'WAIT'`
  2. `confidence >= 55`
  3. `entry_window_active == True`
  4. Same action appears in 2 consecutive polls
- Two-poll confirmation prevents single-poll false alerts.

**Conviction Update** (`UPDATE` -> important channel)
- Fires when action + strategy are unchanged but confidence shifts by at least 15 points.
- Example: Bear Call at 58% -> Bear Call at 73%.

**Setup Invalidated** (`INFO` -> routine channel)
- Fires when previous action was not WAIT and brain returns to WAIT.
- Requires 2 consecutive WAIT polls before firing.

**Market Whipsawing** (`WARNING` -> important channel)
- Fires when 3+ action-level flips are detected in `verdict_history`.
- Sets a 45-minute cooldown.
- Tracks action-level flips only. Strategy flips within the same action are naturally suppressed by two-poll confirmation.

### State persistence and Kotlin integration

- State is persisted to SharedPreferences after every poll via `notification_agent_state_json()`.
- State is restored on service restart via `reset_notification_agent(state_json)`.
- `MarketWatchService.kt` calls `notification_agent_process(result, ctx)` after every brain analysis with a 3-second timeout guard.
- Alerts are sent via `NotificationHelper.send()` when non-null.
- `NotificationHelper` applies 30-second same-title throttling.
- Channel mapping: `HIGH`/`UPDATE`/`WARNING` -> important, `INFO` -> routine, `ERROR` -> urgent.

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

### 2026-05-26 — Export fix not shipped + stale service status root cause

- User updated to `v2.3.61 / b192` and reported:
  - scanner clearly active (`BNF/NF/VIX` populated, `Scanned ... Poll #21`)
  - Logs tab showed live native poll activity
  - but:
    - TXT / CSV log export still appeared non-working
    - ML tab still showed `Service: STOPPED`
    - footer still showed `Polls: 0`
- Confirmed root cause #1:
  - export fix never reached the phone because `index.html` still loaded the stale log viewer bundle
  - release fix updates cache-busters to `app.js?v=1138` and `log-viewer.js?v=1139`
- Confirmed root cause #2:
  - native `getServiceStatus()` depends on `hasTodayBaseline()`
  - some restored baselines were written without `date`
  - `clearStaleSessionStateIfNeeded()` then treated the session as stale and cleared derived state while the service was still actively polling
  - evidence: `DAILY_RESET_BRIDGE: cleared stale session state for 2026-05-26` appeared during active watch mode
- Local fixes applied:
  - `Marketapp/.../NativeBridge.kt`
    - `setBaseline()` now injects `date=todayIstDate()` when missing
    - export success now triggers Android toast: `Saved to Downloads: <file>`
  - `app.js`
    - Supabase baseline restore now sends `{ ...baseline, date: _date }` into `NativeBridge.setBaseline(...)`
  - `log-viewer.js`
    - save success flash now includes destination when native save returns `location`
  - `index.html`
    - bumped `log-viewer.js` cache-buster so the export fix actually ships
- Release status:
  - prepared for `v2.3.62 / b193`
  - Android release bump: `versionName=2.3.62`, `versionCode=193`
  - Web release label: `v2.3.62 · b193`

### 2026-05-26 — Duplicate chain/ML data investigation

- User asked whether the app can create duplicate chain data and requested a code error check.
- Confirmed duplicate risk:
  - `Marketapp/SupabaseClient.kt::saveChainSnapshot()` used a plain `POST` to `chain_snapshots`.
  - Without a database-level unique constraint on `(date, session)`, repeated 2 PM / 3:15 PM captures can create duplicate rows.
  - `saveBrainSnapshot()` and `saveChainSlice()` also use insert-style writes; duplicate ML rows are possible if the same poll is re-dispatched after service restart or retry.
- Android hardening applied for release `v2.3.63 / b194`:
  - `saveChainSnapshot()` now checks for an existing `chain_snapshots` row by `date + session` and patches it before falling back to insert.
  - `MarketWatchService` now records a stable per-poll ML persistence key: `date | poll_count | poll_time | bnf | nf`.
  - If the same key appears again, ML brain snapshot + option-chain slice persistence is skipped.
  - 2 PM / 3:15 PM snapshot flags are now set before async persistence starts, and cleared only if persistence fails, reducing duplicate launches inside the capture window.
- Verification:
  - `git diff --check` passed.
  - Local Gradle compile could not run because this Codex container has no `java` binary and no `JAVA_HOME`.
- Remaining hardening recommended:
  - Add Supabase unique indexes for durable DB-level protection:
    - `chain_snapshots(date, session)`
    - ML option-chain rows need an agreed deterministic key or uniqueness policy before enforcing DB constraints.
- Release status:
  - prepared for push as `v2.3.63 / b194`.
  - Android release bump: `versionName=2.3.63`, `versionCode=194`.
  - Web release label: `v2.3.63 · b194`.
