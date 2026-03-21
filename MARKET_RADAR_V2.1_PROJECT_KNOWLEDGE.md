# Market Radar v2.1 — Project Knowledge (Mar 21 2026)

## Project Overview
- **App:** Market Radar v2.1 — Premium-first PWA for NSE options trading decisions
- **User:** Vivek — part-time options trader, 1 lot at a time, BNF primary
- **Live URL:** vivekashokan007-cloud.github.io/MarketVivi
- **Repo:** github.com/vivekashokan007-cloud/MarketVivi
- **Stack:** Static PWA, Upstox API (market data), Supabase (storage), GitHub Pages. Zero backend cost.
- **Upstox API Key:** 21504576-c556-46be-8b25-cee6cbfe79e6
- **Upstox Analytics Token:** Long-lived read-only token (1-year expiry Mar 2027). Stored in localStorage key `mr2_upstox_token`. No daily OAuth needed.
- **Supabase URL:** fdynxkfxohbnlvayouje.supabase.co
- **Supabase Anon Key:** eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...

## Dev Rules (STRICT — NON-NEGOTIABLE)
1. Discuss → Confirm → Implement. Never code on suggestion.
2. "study/analyse" = discuss only, no code.
3. Only deliver changed files (push all for clean sync since pushing is tedious).
4. Always `node --check` JS files before delivering.
5. Never touch DTE multipliers without new calibration data.
6. Never touch NSE holidays without official NSE circular.
7. No live data feeds, broker order placement, or paid backends.
8. BreakoutIQ is a separate app — do not conflate.
9. Before writing ANY new code: check if v1 already solved it.
10. Before changing existing code: read it, identify what works, add alongside not replacing.
11. Check ALL functions for errors before delivering — not grep, READ every line.
12. Flag AFTER success, not before (learned from 2PM/3:15PM capture bug).
13. inputmode="text" for all inputs on Samsung keyboards — inputmode="decimal" lacks minus key.

## Build State — v2.1 ?v=36 (Mar 21 2026)

| File | Lines | Role |
|------|-------|------|
| app.js | 3114 | 3-force scoring, 7 strategy types, multi-position, v1-style cards, GO verdict, bias, control index, signal accuracy, positioning system, notifications |
| api.js | 508 | Upstox API: spots, chains, expiries, OHLC, BNF breadth (5), NF50 breadth (50), Analytics token from localStorage |
| db.js | 243 | Supabase CRUD: premium_history, trades_v2, chain_snapshots |
| bs.js | 146 | Black-Scholes: IV, expected move, sigma scores, IV percentile |
| style.css | 1483 | Light-first Upstox theme, v1 card design, GO banner, Roboto fonts |
| index.html | 128 | 4-tab layout, no token UI, morning inside Market tab, notifications inside Position tab |
| sw.js | 6 | Self-destruct only (killed for cache issues) |
| manifest.json | 17 | PWA manifest |
| **Total** | **5645** | |

## Architecture — Single Loop Design

### Morning Scan (Lock & Scan)
- Enter FII Cash + Short % → Lock & Scan
- Heavy fetch: spots → expiries → BNF chain → NF chain → BNF OHLC → NF OHLC → historical → BNF breadth (5 stocks) → NF50 breadth (50 stocks)
- Auto-computes: gap classification, close char, bias (6 signals), IV percentile, range budget, futures premium
- Generates candidates: 7 strategy types × multi-width × all viable strikes
- Ranks by force alignment → EV within alignment
- Saves morning snapshot to chain_snapshots + premium_history
- Validates yesterday's positioning signal against today's gap
- Checks Supabase for existing 2PM/3:15PM snapshots (survives refresh)
- Auto-starts 5-min watch loop

### Watch Loop (every 5 min, market hours 9:15-15:30 IST)
- Light fetch: spot + VIX + BNF chain + NF chain (3-4 API calls)
- Updates ALL live data: OI walls, PCR, max pain, futures premium, breadth
- σ-based noise filter: only recalculate forces if spot or VIX moved > threshold
- ALL open trade P&Ls updated from chain LTPs (correct chain per trade index)
- Control Index per trade
- savePremiumSnapshot upserts on every poll (last poll = closing data)
- Notification handling: position health, market updates, σ moves

### Afternoon Positioning System
Three chain snapshots per day saved to Supabase:
- **morning:** Lock & Scan (~9:30)
- **2pm:** First poll after 1:45 PM (auto, retries on failure)
- **315pm:** First poll after 3:00 PM (auto, retries on failure)

3:15 PM compares against 2PM baseline → Tomorrow Signal (BEARISH/BULLISH/NEUTRAL 1-5) → Global Context boost → Positioning trades at top of Trade tab.

**Critical fix (Mar 20):** Flag set AFTER successful Supabase save. If fetch fails, next 5-min poll retries. Human-readable error messages in notification log.

### NF Parity (Mar 20 fixes)
- lightFetch fetches BOTH BNF and NF chains every poll
- P&L, Control Index, close trade all use correct chain based on `trade.index_key`
- All entry data (PCR, futures premium, max pain, sell OI, ATM IV) stored per-index
- Range budget uses correct prevClose per index
- Watchlist force updates use correct chain per candidate

## 4-Tab Layout

### Tab 1: 📊 Market (scan + macro)
- Morning input: FII Cash, Short %, Upstox Bias (inputmode="text", no ± toggles)
- Collapses after scan: "☀️ FII ₹-5158Cr · Short 86% · Scanned 9:34 AM"
- Verdict: "Sellers favored — elevated IV, credit spreads preferred"
- Gap classification, VIX/BNF/NF grid
- Force 3 (IV) table: ATM IV, Theta, DTE, Expiry for both indices
- Force 1 (Direction): bias with net votes
- Range Budget table: Daily 1σ/2σ, Trade 1σ for both indices
- Overnight comparison
- Intraday comparison (live after polls)
- Debug (collapsible)

### Tab 2: 🔍 OI (analysis + intelligence)
- BNF vs NF side-by-side table: PCR, Max Pain, Call/Put Wall, OI Split, Fut Prem, Spot
- Market Breadth: BNF 5 stocks (weighted) + NF50 advancing
- Contrarian Alert (PCR extremes)
- FII Short% 3-Session Trend
- Session Trajectory (5 sessions, collapsible)
- Yesterday's Signal validation + accuracy stats
- Afternoon Positioning display

### Tab 3: 🎯 Trade (action)
- GO verdict banner: "✅ GO — 6 executable of 95 viable · VIX 22.8 · Bias: STRONG BEAR"
- Global Context inputs: GIFT %, Europe %, Crude % (inputmode="text", auto-save to localStorage)
- Positioning trades at top (after 3:15 PM)
- "BANK NIFTY — TOP 5" header with v1-style cards
- "NIFTY 50 — TOP 5" header with v1-style cards
- Each card: rank #, strategy name, force dots, index/expiry/DTE, legs with OTM/ATM labels, net premium, 4-metric grid (Max Profit/Max Loss/R:R/P(Profit)), Target/SL, force icons, greeks, EV/W/Margin footer, alignment badge, "I TOOK THIS TRADE" button

### Tab 4: 📌 Position (monitor)
- Signal accuracy card (correct/total with percentage)
- Multi-position: each trade gets its own card with P&L, forces, Control Index bar, Book Profit / Exit buttons
- Total P&L bar when 2+ positions open
- Manual trade form (always visible below positions)
- Notifications section at bottom

## Multi-Position Support (Mar 21)
- `STATE.openTrades` = array (was single `STATE.openTrade`)
- `takeTrade(candidateId)` pushes to array, doesn't block second trade
- `closeTrade(tradeId, exitReason)` removes specific trade by ID
- Ticker shows sum P&L + total margin across all positions
- Health alerts include trade identity (e.g. "BNF Bear Call 53900 P&L Dropping")
- "I TOOK THIS TRADE" button always visible (not blocked by existing trade)
- `loadOpenTrade()` loads ALL open trades from Supabase

## Signal Accuracy Tracking (Mar 21)
- Each morning: `validateYesterdaySignal()` checks predicted vs actual gap
- Result saved to localStorage key `mr2_signal_accuracy` (rolling 30 entries)
- Cumulative stats: correct/total/percentage
- Displayed on Position tab + OI tab Intelligence section

## 7 Strategy Types

| Strategy | Type | Legs | Force 1 best when |
|----------|------|------|-------------------|
| Bear Call | Credit | 2 | Bear + high IV |
| Bull Put | Credit | 2 | Bull + high IV |
| Bear Put | Debit | 2 | Bear + low IV |
| Bull Call | Debit | 2 | Bull + low IV |
| Iron Condor | Credit | 4 | NEUTRAL + high IV |
| Iron Butterfly | Credit | 4 | NEUTRAL + very high IV |
| Double Debit | Debit | 4 | NEUTRAL + low IV |

All candidates have consistent fields: id, type, width, legs (2 or 4), strikes, LTPs, netPremium, maxProfit, maxLoss, probProfit, ev, netTheta, netDelta, margin, riskReward, targetProfit, stopLoss, isCredit, lotSize, forces, index, expiry, tDTE.

## v1-Style Card Design (Mar 21)
Merged v1's information density with v2's force intelligence:
- Rank # in corner
- Force alignment dots (🟢🟢🟢) next to strategy name
- Legs in monospace with OTM/ATM labels
- 4-column metric grid: Max Profit (green), Max Loss (red), R:R, P(Profit)
- Target: ₹X | SL: ₹Y (credit SL = maxProfit, debit SL = maxLoss/2)
- Greeks row: Δ, θ per share, Θ/day
- EV | W | Margin footer in purple accent

## Force Alignment Engine
3 forces on every trade:
- **Force 1 (Direction):** 6 bias signals → bull/bear/neutral
- **Force 2 (Theta):** +1 credit sellers, -1 debit buyers
- **Force 3 (IV):** VIX regime + IV percentile — HIGH = sellers, LOW = buyers

Alignment: 3/3 = Entry Ready, 2/3 = Conditional, 1/3 = Watching, 0/3 = Rejected.

## Bias Engine — 6 Data-Driven Signals

| # | Signal | Source | Bull | Bear |
|---|--------|--------|------|------|
| 1 | FII Cash | Manual | > +500Cr | < -500Cr |
| 2 | FII Short% | Manual vs Supabase yesterday | < 70% or dropping | > 85% + rising |
| 3 | Close Char | AUTO from OHLC | ≥ +1 | ≤ -1 |
| 4 | PCR near-ATM | AUTO (±10 strikes) | > 1.2 | < 0.9 |
| 5 | VIX Direction | AUTO vs yesterday | dropping > 0.3 | rising > 0.3 |
| 6 | Futures Premium | AUTO from chain | > +0.05% | < -0.05% |

Upstox Bias = comparison badge only, NOT a voting signal.

## Adversarial Control Index
Score -100 to +100. Per-trade, updated every poll.
- Max Pain Migration: 35%
- Sell Strike OI: 30% (needs entry_sell_oi stored at trade entry)
- PCR Shift: 25%
- Heavyweight Divergence (BNF only): 10%

## Constants
- CAPITAL=110000, NF_LOT=65, BNF_LOT=30
- MAX_RISK=10%, MIN_PROB=0.50, MIN_CREDIT_RATIO=0.10
- NF_WIDTHS: [100,150,200,250,300,400], BNF_WIDTHS: [200,300,400,500,600,800,1000]
- IV Edge: VIX ≥ 18 → credit prob + min(10%, (VIX-16) × 1.5%)
- POLL_INTERVAL = 5 min, ROUTINE_NOTIFY = 30 min
- SIGMA: entry 1.5σ, exit 1.0σ, important 2.0σ
- Script order: supabase CDN → bs.js → db.js → api.js → app.js

## Supabase Schema

### premium_history
date, session('morning'/'close'), vix, nf_spot, bnf_spot, nf_atm_iv, bnf_atm_iv, pcr, fii_cash, fii_short_pct, futures_premium_bnf, bias, bias_net. UNIQUE(date, session).

### trades_v2
strategy_type, index_key, expiry, width, is_credit, sell_strike, buy_strike, sell_ltp, buy_ltp, entry_premium, max_profit, max_loss, force_alignment/f1/f2/f3, entry_vix, entry_atm_iv, entry_pcr, entry_bias, entry_bias_net, entry_max_pain, entry_sell_oi, current_pnl, peak_pnl, current_premium, current_spot, status('OPEN'/'CLOSED'), exit_pnl, exit_reason, exit_date, exit_vix, exit_atm_iv, exit_force_alignment.

### chain_snapshots
date, session('morning'/'2pm'/'315pm'), all OI data (BNF+NF), tomorrow_signal, signal_strength. UNIQUE(date, session).

## localStorage Keys
- `mr2_upstox_token` — Analytics token (1 year)
- `mr2_morning` — Morning input data (today only)
- `mr2_fii_short_prev` — Yesterday's FII short %
- `mr2_global_context` — GIFT/Europe/Crude % (auto-saved on change)
- `mr2_signal_accuracy` — Rolling 30-day signal validation history
- `mr2_theme` — dark/light

## NSE Holidays 2026
15 holidays: Jan-26, Mar-03, Mar-26, Mar-31, Apr-03, Apr-14, May-01, May-28, Jun-26, Sep-14, Oct-02, Oct-20, Nov-10, Nov-24, Dec-25. Source: NSE/CMTR/71775.

## Calibrations — DO NOT CHANGE
- DTE multipliers, NF_PUT_SKEW=1.35, distFactor, winProb formula
- Calibrated from 274 NF + 134 BNF real observations
- IV Edge formula: min(0.10, (vix - 16) × 0.015)

## Completed Trades
1. **BNF Bear Put Spread Mar 13-16:** +₹933. Exit: HDFC Bank divergence.
2. **BNF Bear Put Spread Mar 19:** ~₹0. Lesson: buying puts after gap-down = inflated IV.
3. **BNF Bear Call Spread Mar 20:** +₹1,129.50. P&L Dropping alert worked. Booked when EU markets turned.

**Running total: 3 trades, +₹2,062.50**

## Key Bugs Found & Fixed (Mar 20-21)
1. NF P&L always used BNF chain → fixed: correct chain per trade index
2. lightFetch never fetched NF chain → fixed: fetches both
3. current_spot always BNF → fixed: uses tradeSpot
4. Control Index used BNF chain for NF → fixed
5. takeTrade/logManualTrade stored BNF data for NF → fixed: index-aware
6. closeTrade stored BNF IV for NF exit → fixed
7. takeTrade couldn't find positioning candidates → fixed: searches 3 arrays
8. Range budget used BNF prevClose for NF → fixed
9. Watchlist forces used BNF chain for NF → fixed
10. entry_max_pain + entry_sell_oi never stored → fixed (65% of Control Index was dead)
11. 2PM/3:15PM flags set BEFORE fetch → fixed: flag AFTER success, retry on failure
12. heavyAfternoonFetch silently returned null → fixed: errors propagate
13. 4-leg candidates (IC/IB/DDS) missing R:R, Target/SL, Delta → fixed
14. Delta display: 0 || '--' = '--' for delta-neutral → fixed: null check
15. SL logic: credit = maxProfit (1:1), debit = maxLoss/2

## Institutional Intelligence — Key Insights
1. Options trading is zero-sum. MF heavyweights HEDGE, not trade.
2. Near-ATM PCR is the REAL signal. Full chain includes far OTM noise.
3. PCR doubling intraday = institutions actively building.
4. FII Short% DIRECTION > level. 90→88% = covering.
5. Credit spreads inside pinning zone = riding institutional coattails.
6. Institutions position at 2-3 PM for TOMORROW.
7. Book profit when external signals contradict position.
8. Buying after gap-down = paying inflated IV.
9. HDFC Bank alone ~28% of BNF.
10. 3 forces on premium: Intrinsic (spot), Theta (time), IV (vol). Credit SELL benefits from all 3 when IV high.
11. NF margin ~₹97K at VIX 20+ blocks all NF credit strategies for ₹1.1L account.

## Phase 7 — Roadmap (Pending)
1. **PCR reversal from extreme detection** — flag when PCR starts returning from >1.3 or <0.8 (Shubham Agarwal thesis). Needs 20+ sessions trajectory data.
2. Auto-recalibration of scoring weights (needs 10-15 trades)
3. Auto-exit detection in 5-min auto-fetch (trade book check)
4. Pattern discovery from trade dissection data
5. Premium-direction scoring (how many of 3 forces aligned per candidate)
6. High Conviction Mode (after 10-15 trades, 4+ aligned signals → boost debit widths)
7. Zerodha execution integration (Kite Personal API free, Upstox=DATA, Zerodha=EXECUTION)
8. Session trajectory from Supabase chain_snapshots (currently localStorage only)

## APK Build (Capacitor — Prepared)
Scaffold ready: package.json, capacitor.config.ts, 3 Java plugins (MarketRadarService foreground service, MarketServicePlugin bridge, TradeAlertPlugin notifications), native-bridge.js (auto-detects APK vs PWA), BUILD_GUIDE.md (11 steps for Windows + Android Studio). Brother has Android Studio on Windows laptop. Build planned for Mar 21 evening.

## Revert References
- v1 Phase 5.2 (SEALED Mar 17): 5339 lines. All v1 code in git history.
- v2.0 initial (Mar 19): ~3284 lines.
- v2.0 (Mar 20 ?v=25): 5002 lines.
- v2.1 (Mar 20 ?v=28): app.js 3070, style.css 1234. Bug fix build.
- v2.1 (Mar 21 ?v=33): app.js 3110. Multi-position + v1 cards + signal accuracy.
- **v2.1 current (Mar 21 ?v=36): app.js 3114, api.js 508, style.css 1483, index.html 128. Total 5645.**
