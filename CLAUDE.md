# Market Radar v2.1 — CLAUDE.md

> **Build**: b107 · **Last Updated**: April 15, 2026
> **Repo**: github.com/vivekashokan007-cloud/MarketVivi
> **Live**: vivekashokan007-cloud.github.io/MarketVivi

---

## 1. What This Project Is

A **zero-cost, premium-first PWA** for NSE options trading decisions (Nifty 50 + Bank Nifty). Runs on Samsung S23 Ultra as a PWA and Android APK (Kotlin WebView shell). No backend — static site on GitHub Pages.

**User**: Vivek — part-time options trader, 1 lot at a time, NF primary (BNF secondary). Capital: ₹2,50,000.

**Philosophy**: Premium direction is the ONLY thing that matters. Three forces on every trade: Intrinsic (direction), Theta (time decay), IV (volatility). Score by force alignment, not market direction.

---

## 2. Stack

| Layer | Technology | Notes |
|-------|-----------|-------|
| Frontend | Vanilla JS (no framework) | Mobile-first PWA, offline-capable |
| Market Data | Upstox API v2 | Read-only analytics token, 1-year expiry (Mar 2027) |
| Database | Supabase (PostgreSQL + RLS) | Free tier, 4 tables + 1 storage bucket |
| Analysis Engine | Pyodide (Python 3.11 in WebAssembly) | 77 functions, ~3000 lines, pure stdlib (json + math) |
| Math | bs.js (Black-Scholes) | IV solver, delta, theta, sigma — NOW fallback only, chain greeks primary |
| Hosting | GitHub Pages | Zero cost |
| Mobile | Android APK (Kotlin WebView shell) | Optional native bridge for background polling |

---

## 3. File Map

| File | ~Lines | Purpose |
|------|--------|---------|
| **app.js** | 9,982 | Core engine: constants, embedded Python brain, STATE, bias engine, candidate generation, trade lifecycle, rendering, polling, export |
| **brain.py** | 3,089 | Standalone copy of the Python brain (also embedded in app.js as `BRAIN_PYTHON`). Market/position/candidate/timing/risk analysis, learning, verdicts |
| **api.js** | 543 | Upstox API wrapper: spots, option chains, expiries, breadth (BNF 5 + NF 50), OHLC, greeks parsing, DTE, market hours, holidays |
| **db.js** | 394 | Supabase CRUD: premium_history, trades_v2, chain_snapshots, app_config KV store, signal accuracy, poll cleanup |
| **bs.js** | 155 | Black-Scholes: normCDF/PDF, option pricing, IV (Newton-Raphson), delta, theta, daily/intraday sigma, sigma scores, IV percentile |
| **style.css** | ~1,500 | Light-first Upstox-matched theme with dark mode. Roboto font. Flat cards. Mobile-first. |
| **index.html** | 215 | 4-tab layout (Market, OI, Trade, Position), morning inputs, CDN links (Supabase, SheetJS, Pyodide), inline brain CSS |
| **manifest.json** | 17 | PWA manifest (standalone, portrait, MR2 icon) |
| **PROJECT_KNOWLEDGE.md** | 427 | Full project knowledge: backtest findings, calibration, trade history, architecture, constants |
| **SESSION_CONTEXT.md** | 105 | Session context for AI assistants |
| **REVIEW_BRIEF.md** | 80 | Audit brief for code review |
| **VARSITY_COMPARISON.md** | — | Zerodha Varsity alignment analysis (Modules 5, 6, 9, 10) |
| **MARKET RADAR 05042026.js** | 6,899 | Backup snapshot of app.js from Apr 5, 2026 |

### Script Load Order (index.html)
```
Supabase CDN → SheetJS CDN → Pyodide CDN → bs.js → db.js → api.js → app.js
```

---

## 4. Architecture Overview

### 4.1 Data Flow

```
Morning 9:15 AM                    Every 5 Minutes                   3:15 PM
─────────────                      ───────────────                   ────────
User enters FII/Short%     →  lightFetch()                    →  Positioning scan
      ↓                           ↓                                    ↓
Lock & Scan                   Spots + BNF chain                  2PM vs 3:15PM OI delta
      ↓                           ↓                                    ↓
initialFetch()                Bias recompute                     Tomorrow Signal
  ├─ Spots + Chains              ↓                                    ↓
  ├─ 7-signal bias          Drift detection                     Positioning candidates
  ├─ 3 forces                    ↓
  ├─ Varsity filter         P&L update (open trades)
  ├─ Candidates ranked           ↓
  ├─ Save to Supabase       runBrain() (Pyodide)
  └─ Start watch loop            ↓
                            Notifications + Render
```

### 4.2 Single Loop Design

1. **Lock & Scan** → `lockMorningData()` → `initialFetch()` (heavy fetch: chains, spots, breadth, OHLC)
2. **Watch Loop** → `startWatchLoop()` every 5 min → `lightFetch()` (spots + BNF chain only)
3. **Afternoon** → 2PM baseline → 3:15PM comparison → tomorrow signal → positioning candidates
4. **Auto-stop** after 3:35 PM IST
5. **Page Refresh Recovery** → DOMContentLoaded → `DB.getAllConfig()` → restore state → resume polling

### 4.3 Call Hierarchy

```
DOMContentLoaded
├─ initTheme()
├─ restoreMorningData()        ← Supabase app_config
├─ restoreGlobalContext()      ← Dow/Crude/GIFT
├─ loadOpenTrade()             ← Supabase trades_v2
└─ initBrain()                 ← async, 2s deferred

lockMorningData() [button]
└─ initialFetch()
    ├─ API.fetchSpots()
    ├─ API.fetchChain(BNF) + API.fetchChain(NF)
    ├─ API.fetchBnfBreadth() + API.fetchNf50Breadth()
    ├─ computeBias()           ← 7 signals
    ├─ generateCandidates()    ← for BNF + NF
    ├─ rankCandidates()
    ├─ DB.savePremiumSnapshot('morning')
    ├─ DB.saveChainSnapshot('morning')
    ├─ startWatchLoop()
    └─ renderAll()

startWatchLoop() [5-min interval]
└─ lightFetch()
    ├─ API.fetchSpots()
    ├─ API.fetchChain(BNF)
    ├─ computeBias() [live]
    ├─ Drift → regenerate candidates if bias shifted ±2
    ├─ updateOpenTradePnL()
    ├─ handleNotifications()
    ├─ DB.setConfig('poll_history_...')
    ├─ runBrain()              ← Pyodide Python
    └─ renderAll()

takeTrade() → DB.insertTrade() → STATE.openTrades.push()
closeTrade() → STATE.openTrades.filter() → DB.updateTrade() [background]
exportAllData() → Supabase queries → XLSX → upload to Storage bucket
```

---

## 5. app.js Structure (9,982 lines)

### Section Boundaries

| Lines | Section | Key Contents |
|-------|---------|-------------|
| 1–96 | **Constants (C)** | Capital, lots, margins, widths, sigma thresholds, time gates, IV regimes, slippage, costs, strategy categories |
| 99–131 | **CALIBRATION** | Paper trade (25) + backtest (8,372) win rates per strategy, bias outcomes, cost impact |
| 136–2328 | **BRAIN_PYTHON** | Embedded Python code for Pyodide (see brain.py section below) |
| 2330–2431 | **STATE** | Global app state: baseline, live, chains, candidates, trades, brain, loop control |
| 2438–2489 | **Sound Engine** | Web Audio API tones: routine, important, urgent, entry |
| 2496–2698 | **Bias Engine** | `computeBias()` — 7 votes: FII cash, futures premium, PCR, breadth, gap, gap size, close char |
| 2705–2831 | **Forces & Institutional** | `getForceAlignment()` (F1 direction, F2 theta, F3 IV), `computeInstitutionalRegime()`, contrarian PCR |
| 3007–3179 | **Control Index** | `computeControlIndex()` — who's winning? Breadth-weighted delta vs position |
| 3223–3420 | **Afternoon Positioning** | 2PM/3:15PM OI delta comparison → tomorrow signal |
| 3473–3603 | **Varsity Filter** | Strategy selection by bias + IV regime + range detection |
| 3608–3711 | **Market Phase** | GAP_MOMENTUM, REVERSAL, CONSOLIDATION, TRENDING, QUIET |
| 3719–3877 | **Wall/Gamma/Context Scoring** | OI wall distance, gamma risk, sigma sweet spot |
| 3881–4551 | **Candidate Generation** | `generateCandidates()` — strike pairs, BS pricing, forces, all scoring |
| 4556–4633 | **Cost & Margin** | STT, brokerage, slippage, GST estimation |
| 4628–4753 | **Ranking** | `rankCandidates()` — 10-level sort: direction safety → varsity tier → brain → calibration → forces → context → gamma → wall → EV → prob |
| 4772–5145 | **initialFetch()** | One-time morning heavy scan |
| 5146–5511 | **lightFetch()** | 5-min polling update |
| 5512–5659 | **P&L Updates** | `updateOpenTradePnL()`, `updateWatchlistForces()` |
| 5664–5909 | **Notifications** | σ moves, sell strike breach, 4-leg expiry, wall drift, VIX spike |
| 5914–5972 | **Watch Loop** | `startWatchLoop()` / `stopWatchLoop()` |
| 6145–6415 | **Pyodide Init + Chain Profile** | `initBrain()`, `computeChainProfile()` — 10 advanced features (IV smile, gamma clustering, volume ratio, etc.) |
| 6417–6831 | **runBrain()** | Passes polls + trades + context → Python analyze() → store insights |
| 6833–6983 | **Trade Mode & Rescan** | `toggleTradeMode()`, `rescanStrategies()` |
| 6997–7307 | **takeTrade()** | 40+ field trade object → Supabase insert |
| 7309–7465 | **logManualTrade()** | Manual entry when no candidates available |
| 7467–7587 | **closeTrade()** | Immediate UI removal + background DB update |
| 7591–9114 | **Render Functions** | All UI rendering (see below) |
| 9115–9130 | **renderFooter()** | Brain status, poll count |
| 9135–9420 | **Persistence** | Morning restore, evening close, overnight delta |
| 9426–9742 | **exportAllData()** | 6-sheet Excel (trades, premium history, chain snapshots, polls, journeys, strike data) |
| 9742–9982 | **DOMContentLoaded** | Init, tab switching, event listeners, auto-restart |

### Render Functions → Tab Mapping

| Function | Tab | What It Renders |
|----------|-----|----------------|
| `renderMarket()` | Market | Breadth, OI walls, PCR, bias, futures, FII, gap, baseline |
| `renderBrainInsights()` | Market | Python brain market/risk insights |
| `renderIntradayChart()` | Market | SVG chart: spot + VIX from poll history |
| `renderDebug()` | Market | Debug panel: polls, brain status, API stats |
| `renderOI()` | OI | BNF + NF call/put walls, OI velocity, max pain |
| `renderWatchlist()` | Trade | Top 10 candidates with forces, scores, brain insights |
| `renderCandidateCard()` | Trade | Single candidate detail card |
| `renderPosition()` | Position | Open trades, P&L, Control Index, brain verdicts |
| `renderTradeCard()` | Position | Single trade with momentum, wall, VIX alerts |

---

## 6. brain.py Structure (3,089 lines / 77 functions)

The Python brain runs in Pyodide (WebAssembly) every 5 minutes. It receives JSON data and returns JSON with market intelligence, position verdicts, candidate evaluation, and timing/risk insights.

### Main Entry Point: `analyze()`
**Inputs** (11 JSON strings): polls, closed trades, baseline, open trades, candidates, strike OI, context (chain data, breadth, FII, morning bias)
**Output**: `{ verdict, market[], positions{}, candidates{}, timing[], risk[], effective_bias, generated_candidates[], watchlist[] }`

### Function Categories

| Category | Functions | Purpose |
|----------|----------|---------|
| **Utilities** (L40-102) | `lsq_slope`, `pct_change`, `last_n`, `get_time_mins`, `arr_mean`, `arr_std`, `z_score`, `straddle_velocity`, `theta_friction_minutes` | Math, statistics, z-score infrastructure |
| **Regime** (L104-137) | `detect_regime`, `get_pcr_slope`, `get_vix_vals` | Classify range/trend/choppy/mild_trend |
| **Market** (L140-316) | `pcr_velocity`, `oi_wall_shift`, `vix_momentum`, `spot_exhaustion`, `regime_detector`, `futures_premium_trend`, `oi_velocity`, `institutional_clock` | 8 market analysis functions |
| **Position** (L322-528) | `position_wall_proximity`, `position_momentum_threat`, `position_regime_fit`, `position_vix_headwind`, `position_book_signal` | Per-trade health checks |
| **Candidate** (L534-727) | `candidate_flow_alignment`, `candidate_wall_protection`, `candidate_regime_fit`, `evaluate_candidate_risk` | Per-candidate scoring (6 risk dimensions) |
| **Timing** (L733-773) | `timing_entry_window`, `timing_wait_signal` | Sweet spot and momentum detection |
| **Risk** (L779-827) | `risk_kelly_headroom`, `risk_regime_shift` | Portfolio-level alerts |
| **Learning** (L834-1197) | `build_calibration` (15-factor), `candidate_pattern_match`, `risk_exit_analysis`, `risk_factor_importance`, `risk_streak_warning` | Calibration from trade history |
| **Synthesis** (L1203-1575) | `signal_coherence`, `max_pain_gravity`, `fii_trend`, `nf_bnf_divergence`, `day_range_position`, `wall_freshness`, `yesterday_signal_prior`, `dte_urgency`, `compute_effective_bias`, `chain_intelligence`, `daily_pnl_check`, `candidate_liquidity`, `position_gamma_alert` | Context intelligence |
| **Verdicts** (L1626-2107) | `synthesize_verdict`, `position_verdict` | ONE direction + strategy + confidence per market state; ONE action per trade |
| **Candidate Gen** (L2114-2877) | `_bs_delta`, `_daily_sigma`, `_get_varsity_filter`, `_get_forces`, `_build_candidate`, `generate_candidates`, `rank_candidates` | Full candidate pipeline in Python (mirrors JS) |

### Key Innovation: Effective Bias (Bayesian Decay)
- Morning prior starts at 100% weight
- Decays 5% per poll (5 min), floor at 20%
- Replaced by 7 intraday signals: spot σ, VIX σ, PCR change, straddle direction, wall movement, breadth, regime
- Output: `{bias, strength, net, morning_weight, signals[], intraday_net, drift_reasons[]}`

---

## 7. api.js — Upstox API Module

| Function | Purpose |
|----------|---------|
| `fetchSpots()` | NF, BNF, VIX spot prices + OHLC |
| `fetchExpiries(indexKey)` | Available expiry dates |
| `fetchChain(indexKey, expiry)` | Full option chain for one expiry |
| `parseChain(rawChain, spot)` | → strikes, ATM, PCR, nearAtmPCR, maxPain, synthFutures, atmIv, OI walls |
| `fetchBnfBreadth()` | Top 5 BNF constituents (79% weight): HDFC, ICICI, Kotak, SBI, Axis |
| `fetchNf50Breadth()` | All 50 NF constituents: advancing/declining count |
| `fetchHistoricalOHLC(key, date)` | Previous day candle for close character |
| `calcCloseChar(ohlc)` | -2 to +2: where in daily range did market close? |
| `classifyGap(open, close, vix)` | Gap type + σ magnitude |
| `tradingDTE(expiry)` / `calendarDTE(expiry)` | Trading vs calendar days to expiry |
| `isMarketHours()` | Check NSE hours (9:15-15:30) + holidays |
| `todayIST()` / `dateToIST(d)` | IST-safe date strings (fixes UTC bug) |

**Token**: Hardcoded read-only analytics token (1-year, covers market data, cannot place orders). Override via `localStorage.setItem('mr2_upstox_token', '...')`.

**NSE Holidays 2026**: 15 dates hardcoded from official NSE circular.

---

## 8. db.js — Supabase Module

### Tables

| Table | Key | Purpose |
|-------|-----|---------|
| **premium_history** | (date, session) | Daily market snapshots. Sessions: 'morning', 'close' |
| **trades_v2** | id (auto) | Full trade lifecycle: 35+ entry fields, 18 exit fields, JSONB journey |
| **chain_snapshots** | (date, session) | OI structure at morning/2pm/315pm + tomorrow_signal |
| **app_config** | key (unique) | KV store: morning_inputs, morning_bias, global_direction, poll_history_YYYY-MM-DD, settings, evening_close |

### Key Functions
- `savePremiumSnapshot()` / `getPremiumHistory(60)` — IV percentile + yesterday comparison
- `insertTrade()` / `updateTrade()` / `getOpenTrades()` / `getClosedTrades()` — trade CRUD
- `saveChainSnapshot()` / `getChainSnapshot()` — afternoon positioning
- `setConfig()` / `getConfig()` / `getAllConfig()` — state persistence (localStorage cache + Supabase sync)
- `cleanOldPolls(7)` — delete poll_history_* keys older than 7 days

---

## 9. bs.js — Black-Scholes Module

Fallback math engine when Upstox chain greeks are unavailable.

| Function | Purpose |
|----------|---------|
| `normCDF(x)` / `normPDF(x)` | Standard normal distribution (Abramowitz & Stegun) |
| `bsPrice(spot, strike, T, vol, type)` | Option price (CE/PE) |
| `delta(spot, strike, T, vol, type)` | Probability-weighted direction |
| `theta(spot, strike, T, vol, type)` | Time decay per calendar day |
| `impliedVol(spot, strike, T, price, type)` | IV via Newton-Raphson (50 iterations max) |
| `dailySigma(spot, vix)` | 1σ daily move from VIX |
| `sigmaMins(spot, vix, mins)` | σ for N minutes |
| `sigmaDays(spot, vix, days)` | σ for N days |
| `sigmaScore(spot, prevClose, vix, mins)` | How many σ has spot moved (full-day σ, not intraday) |
| `vixSigmaScore(vix, prevVix, mins)` | VIX unusualness (VIX daily σ ≈ VIX × 0.05) |
| `ivPercentile(vix, history)` | Where current VIX sits vs 60-day history |

**Constants**: DAYS_PER_YEAR = 252, RATE = 0.07 (India risk-free ~7%)

---

## 10. Core Concepts

### 10.1 Bias Engine — 7 Signals
| # | Signal | Source | How |
|---|--------|--------|-----|
| 1 | FII Cash | Manual input | > ±500Cr → BULL/BEAR |
| 2 | FII Short% | Manual vs yesterday | > 85% increasing → BEAR |
| 3 | Close Character | Auto (OHLC) | -2 to +2 via day range position |
| 4 | PCR (near-ATM) | Auto (chain ±10 strikes) | > 1.2 BULL, < 0.9 BEAR (contrarian) |
| 5 | VIX Direction | Auto vs yesterday | > ±0.3 |
| 6 | Futures Premium | Auto (synthetic from chain) | > ±0.05% |
| 7 | DII Absorption | Manual + auto | Direction + FII/DII level combined |

### 10.2 Three Forces
| Force | What | Credit | Debit |
|-------|------|--------|-------|
| F1 Direction | Bias alignment | +1 match | +1 match |
| F2 Theta | Time decay | Always +1 | Always -1 |
| F3 IV | VIX regime + IV%ile | +1 HIGH/VERY_HIGH | +1 LOW |

### 10.3 Varsity Filter (Zerodha Modules 5, 6)
| Bias + IV | PRIMARY | ALLOWED | BLOCKED |
|-----------|---------|---------|---------|
| BEAR + HIGH | Bear Call | Bull Put, IC | Bear Put, Bull Call, IB |
| BULL + HIGH | Bull Put | Bear Call, IC | Bull Call, Bear Put, IB |
| NEUTRAL + HIGH | IC | Bear Call, Bull Put | Others |
| BEAR + LOW | Bear Put | Bear Call | Bull Put, Bull Call, IC, IB |
| BULL + LOW | Bull Call | Bull Put | Bear Call, Bear Put, IC, IB |
| NEUTRAL + LOW | Double Debit | IC | Others |

**Overrides**: VIX ≥ 24 → debit co-PRIMARY. Range detected → IC/IB PRIMARY. IB blocked for real trades (margin ₹1.1L).

### 10.4 Strike Selection
- **MIN_SIGMA_OTM = 0.5** — credit sells must be ≥0.5σ from ATM (backtest: ATM = too risky)
- **MAX_SIGMA_OTM = 0.8** — soft cap (backtest: cliff at 0.8σ → win rate drops 32pts)
- **Sweet spot: 0.5–0.8σ** — 66–84% win rate across 8,372 backtested trades
- **MIN_WIDTH**: NF 150, BNF 400 (prevent stop-loss hunting on narrow spreads)

### 10.5 Candidate Ranking (10 levels)
1. Direction safety (F1-against = always last)
2. Varsity tier (PRIMARY > ALLOWED)
3. Brain verdict alignment
4. Calibration win rate
5. Force alignment score
6. Context + brain score
7. Gamma risk (lower = better)
8. Wall score (higher = better)
9. Capital efficiency (EV / margin)
10. Probability of profit

---

## 11. Supabase Schema Detail

### premium_history
```
date TEXT, session TEXT (PK: date+session)
nf_spot, bnf_spot, vix, nf_atm_iv, bnf_atm_iv, pcr NUMERIC
fii_cash, fii_short_pct, dii_cash, fii_idx_fut, fii_stk_fut NUMERIC
futures_premium_bnf NUMERIC, bias TEXT, bias_net NUMERIC
```

### trades_v2
```
id SERIAL PK, status TEXT (OPEN/CLOSED), paper BOOLEAN
type TEXT, index TEXT, expiry TEXT, trade_mode TEXT
sell_strike, buy_strike, sell_type, buy_type, width NUMERIC
sell_ltp, buy_ltp, max_profit, max_loss, is_credit NUMERIC
entry_* (60+ snapshot fields), exit_* (18 fields)
journey_stats JSONB, created_at, updated_at TIMESTAMPTZ
```

### chain_snapshots
```
date TEXT, session TEXT (PK: date+session)
bnf_spot, nf_spot, vix, bnf_pcr, bnf_near_atm_pcr, nf_pcr NUMERIC
bnf_max_pain, nf_max_pain, bnf_call_wall, bnf_put_wall NUMERIC
bnf_total_call_oi, bnf_total_put_oi, nf_total_call_oi, nf_total_put_oi NUMERIC
bnf_atm_iv, bnf_futures_prem, bnf_breadth_pct, nf50_advancing NUMERIC
tomorrow_signal TEXT, signal_strength NUMERIC
signal_correct BOOLEAN, signal_actual_gap NUMERIC
```

### app_config
```
key TEXT PK, value JSONB, updated_at TIMESTAMPTZ
```

---

## 12. Backtest Findings (552 days, 8,372 trades)

### Strategy Robustness
| Strategy | Win Rate Range | Verdict |
|----------|---------------|---------|
| Bull Call | 64–72% | MOST ROBUST (debit, real spot movement) |
| Bear Put | 54–68% | ROBUST (debit) |
| Bear Call | 45–77% | Dampening-sensitive (credit) |
| Bull Put | 46–74% | Dampening-sensitive (credit) |
| Iron Condor | 38–49% | Never above 50% |
| Iron Butterfly | 34–48% | Never above 50% |

### Key Rules (backtest-validated)
1. Credit sells: 0.5–0.8σ OTM sweet spot. Below = risky. Above = thin credit.
2. VIX < 24: credit preferred. VIX ≥ 24: debit preferred (91.7% vs 86.4%).
3. IB/IC: intraday ONLY. 0% overnight survival.
4. Swing momentum: After UP → Bull Call 76%. After DOWN → Bear Put 70%.
5. Day-of-week, chart patterns, consecutive days: NO statistical edge.

---

## 13. Dev Rules (STRICT)

1. **Discuss → Confirm → Implement.** Never code on suggestion alone.
2. **"study/analyse" = discuss only**, no code changes.
3. Only deliver changed files (push all for clean sync).
4. Always `node --check` JS files before delivering.
5. **Never touch DTE multipliers** without new calibration data.
6. **Never touch NSE holidays** without official NSE circular.
7. No live data feeds, broker order placement, or paid backends.
8. Before writing new code: check if v1 already solved it.
9. Before changing existing code: read it, understand what works, add alongside not replace.
10. `inputmode="text"` for all inputs (Samsung keyboard minus key fix).
11. **PREMIUM IS KING** — every feature exists to answer: am I on the right side of the premium?
12. **Varsity-first** strategy selection — market condition → strategy type → rank strikes.
13. **Dynamic — no hardcoded formulas.** Everything computed from real LTPs.
14. Use `??` for numeric values, `||` only for strings — zero is valid data.
15. **EVERY PUSH MUST HAVE NEW VERSION NUMBER.** Cached old code is the #1 deployment bug.
16. **ADVERSARY MODE**: Challenge every assumption, question every profit. No sugarcoating.

---

## 14. Constants (SACRED — don't change without data)

```
CAPITAL=250000, NF_LOT=65, BNF_LOT=30, MAX_RISK=10%
NF_WIDTHS: [100,150,200,250,300,400]
BNF_WIDTHS: [200,300,400,500,600,800,1000]
IV: LOW≤15, NORMAL 16-19, HIGH≥20, VERY_HIGH≥24
PCR: >1.2 BULL, <0.9 BEAR (near-ATM, contrarian)
Strike: MIN_SIGMA_OTM=0.5, MAX_SIGMA_OTM=0.8
Width: MIN_NF=150, MIN_BNF=400
Time: first 15min suppressed, 11:30-14:30 sweet spot
Poll: 5min light, 30min routine notify, auto-stop after market
NSE Holidays 2026 (15): hardcoded from circular NSE/CMTR/71775
BS: DAYS_PER_YEAR=252, RATE=0.07
Slippage: NF 1-2₹/leg, BNF 2-4₹/leg
STT: 0.15% options, 0.05% futures
```

---

## 15. Known Issues

### Critical
- **Excel download fails in APK WebView** — file uploads to Supabase Storage but WebView blocks JS download triggers. Workaround: download from Supabase dashboard.

### Important
- **getAllConfig fetches ALL app_config rows** including poll_history. After ~60 days will slow page load. Fix: filter poll_history_* in query.
- **P(Profit) overestimated** — 4.2× vs Upstox pop on some candidates. IV Edge Boost disabled, calibration pending.

### Minor
- Old export files accumulate in Supabase EXPORTS bucket (no auto-cleanup)
- Some Upstox chain responses return zero greeks — BS fallback handles this but logs as zeros

---

## 16. Git Workflow

```bash
cd "D:/Vivek/ANTIGRAVITY"
git add app.js brain.py style.css   # specific files, not -A
git commit -m "vN+1 · description"
git push origin main
```

- Always bump version in `<span class="version">` (index.html) and `?v=` cache busters
- GitHub Pages auto-deploys from main branch
