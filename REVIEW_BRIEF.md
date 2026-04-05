# Market Radar v2.1 b71 — Review Brief for Code Audit

## What is this?
A zero-cost PWA for NSE options trading decisions. Runs on phone (Samsung S23 Ultra). Static site on GitHub Pages, no backend.

## Stack
- **Frontend:** Single-page PWA (vanilla JS, no framework)
- **Data:** Upstox API v2 (option chains, spots, VIX, breadth, greeks)
- **Storage:** Supabase (3 tables: premium_history, trades_v2, chain_snapshots + app_config KV)
- **Analysis:** Pyodide (Python 3.11 in WebAssembly) — 33 functions, 858 lines, pure stdlib
- **Math:** bs.js (Black-Scholes: IV, delta, theta, sigma scores — NOW fallback only, chain greeks are primary)
- **Hosting:** GitHub Pages. Zero cost.

## Files to review
| File | Lines | Role |
|------|-------|------|
| app.js | 6873 | Full engine: bias, forces, Varsity filter, candidates, paper trading, Pyodide brain, learning |
| api.js | 529 | Upstox API: spots, chains, expiries, breadth, OHLC, greeks parsing |
| db.js | 366 | Supabase CRUD: premium_history, trades_v2, chain_snapshots, app_config |
| bs.js | 146 | Black-Scholes: IV (Newton-Raphson), delta, theta, sigma scores — NOW fallback only |
| index.html | 215 | 4-tab layout, Pyodide CDN (async), brain CSS |
| style.css | 1539 | Upstox-themed, light-first, mobile-first |

## Architecture Flow
1. **Morning 9:15:** User enters FII Cash + FII Short% → Lock & Scan → heavy fetch (chains, spots, VIX, breadth) → 7-signal bias → 3 forces → Varsity filter → candidates ranked
2. **Every 5 min:** Light fetch → bias recompute → drift detection → P&L update → poll snapshot saved → **Python brain runs** → brain re-ranks candidates → render
3. **11:00 AM:** User opens Trade tab. #1 candidate reflects 90min of brain intelligence, not just morning data
4. **2:00 PM / 3:15 PM:** Automatic institutional positioning scans → tomorrow signal

## b71 Changes (what's new — audit these)

### 1. Pyodide Copilot Brain (biggest change)
- `BRAIN_PYTHON` constant: 858 lines of Python embedded in app.js
- `initBrain()`: Loads Pyodide async, 2s deferred from DOMContentLoaded
- `runBrain()`: Runs every 5-min poll. Passes 6 data objects via `pyodide.globals.set()`
- Output: `{ market: [], positions: {tradeId: []}, candidates: {candId: []}, timing: [], risk: [] }`
- 5 categories rendered across ALL tabs (not just Market)

### 2. Learning Module (PART 6 in Python)
- `build_calibration()`: Builds from closed trades. Cached — only recomputes when trade count changes
- 8 calibration tables: strategy rates, VIX regime rates, credit/debit, multi-factor (strategy×VIX), force importance, exit capture %, loss streaks, trade mode
- `candidate_pattern_match()`: "Your BEAR_CALL: 5/7 (71%)" on candidate cards
- `risk_exit_analysis()`: "Capturing only 60% of peaks"
- `risk_factor_importance()`: "Direction (F1) is your edge"
- `risk_streak_warning()`: "Max losing streak: 6"

### 3. Chain-First Greeks
- `chainDeltaAtPrice()`: Reads per-strike delta from Upstox chain, interpolates at breakeven, BS fallback only if null
- `chainTheta()` / `chainDelta()`: Direct chain read at exact strikes, BS fallback
- P(Profit) now uses IV smile from actual market data, not flat ATM IV
- All 6 P(Profit) calculation points fixed (directional credit/debit, IC upper/lower, IB upper/lower)

### 4. Brain-Informed Ranking
- `applyBrainScores()`: Converts brain insights → numeric score per candidate
- `rankCandidates()` now uses `contextScore + brainScore` in sort
- 🧠 BRAIN PICK badge on #1 when brainScore > 0
- Brain score displayed on each candidate card

## What to look for in audit
1. **Data flow correctness:** Does runBrain() pass the right data? Are per-strike arrays stripped correctly?
2. **Python safety:** All try/except wrapped? Calibration cache logic sound?
3. **Graceful degradation:** Does app work perfectly if Pyodide fails to load?
4. **P(Profit) interpolation:** Is chainDeltaAtPrice mathematically correct for IV smile?
5. **Brain ranking:** Does applyBrainScores produce sensible adjustments? Are the weights balanced?
6. **Memory/performance:** 858 lines of Python running every 5 min on mobile — any concerns?
7. **Learning module:** Does build_calibration handle edge cases (0 trades, 1 trade, all wins, all losses)?
8. **Security:** Supabase anon key exposed (RLS controls access). Upstox analytics token hardcoded (read-only, 1-year expiry). Any concerns?

## Trading Context
- Capital: ₹1,10,000. Trades 1 lot at a time.
- 5 real trades (+₹1,643), 25 paper trades (calibration dataset)
- All paper trades from VIX 24+ war period — zero normal VIX data
- NF primary (lot 65), BNF secondary (lot 30)
- Backtest: 552 days, 21M rows, 8,372 trades across 3 dampening presets

## Known Issues
- api.js may not pass Upstox greeks fields (iv/delta/volume/pop) — verified per-strike data shows zeros on some days. chainDeltaAtPrice falls back to BS in this case.
- getAllConfig fetches all app_config rows — will slow after ~60 days of poll_history keys
- APK WebView blocks JS file downloads
