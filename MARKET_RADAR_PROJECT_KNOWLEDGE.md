# Market Radar v5.0 — Project Knowledge

## Project Overview
- **App:** Market Radar PWA for NSE options trading decisions
- **User:** Vivek — part-time options trader, 1 lot at a time, weekly analysis workflow
- **Live URL:** vivekashokan007-cloud.github.io/MarketVivi
- **Repo:** github.com/vivekashokan007-cloud/MarketVivi
- **Stack:** Static PWA, no backend. localStorage + Supabase + GitHub storage
- **Upstox API Key:** 21504576-c556-46be-8b25-cee6cbfe79e6 (trading account B)
- **Supabase URL:** fdynxkfxohbnlvayouje.supabase.co

## Dev Rules (STRICT)
1. Discuss→Confirm→Implement, never code on suggestion
2. "study/analyse" = discuss only
3. Only deliver changed files
4. Never touch DTE multipliers without calibration data
5. Never touch NSE holidays without official circular
6. No live data feeds, broker order placement, or paid backends
7. BreakoutIQ is separate app
8. Always `node --check` JS files before delivering
9. Bundle multiple fixes into single push — GitHub push is tedious
10. Always push all changed files for clean sync

## Constants
- CAPITAL=110000, NF_LOT=65, BNF_LOT=30
- NF_MARGIN=97000, BNF_MARGIN=28000
- NF_WIDTH=200, BNF_WIDTH=500, MAX_RISK=5%
- Script order: supabase CDN → db.js → bhav.js → bs.js → app.js → upstox.js
- SW registered separately

## File Structure (Phase 5 — Mar 16 2026)
| File | Lines | Role |
|------|-------|------|
| app.js | 2192 | Scoring engine, strategy eval, expandable Q1 card, weighted BNF breadth, futures premium bias, "I Took This Trade" flow, trade dissection |
| upstox.js | 727 | API integration, chain fetch, SYNC positions, auto-fetch position monitor, synthetic futures premium |
| style.css | 511 | Upstox-inspired purple theme, expandable Q1, BNF constituent grid, score breakdown table |
| index.html | 257 | 4-tab layout: SIGNAL (BNF checkboxes), COMMAND, POSITIONS, CLOSE |
| bs.js | 177 | Black-Scholes (secondary — real LTPs from Upstox are primary) |
| bhav.js | 317 | Bhav copy upload + historical OI data |
| db.js | 298 | Supabase CRUD: trades, stats, journal, rich entry snapshot |
| manifest.json | 22 | PWA manifest |
| sw.js | 35 | Service worker for notifications |

## Architecture — Clean Separation (Phase 3.1)

### 1. Strategy Scanner (SIGNAL tab → FETCH button)
- Fetches: spots, expiries, chains (all expiries), historical, margins
- Calculates: synthetic futures premium from ATM put-call parity
- Updates: SIGNAL tab (bias, futures premium), COMMAND tab (top 5 NF + top 5 BNF strategies)
- Does NOT fetch positions, trade book, or detect trades
- Does NOT start auto-fetch
- Flow: `upstoxAutoFill()` → spots → expiries → chains + historical + margins → `calcScore()` → `buildCommand()` → `renderFuturesPremium()`

### 2. Position Tracker (POSITIONS tab → SYNC button)
- SYNC fetches: spots, positions API, trade book, position-specific chains
- Detects new trades from trade book reconstruction
- Matches exits from trade book fills
- Starts auto-fetch (5 min, market hours only)
- Flow: `upstoxSyncPositions()` → spots → positions + tradebook → chains for open trades → `detectAndLogPositions()` → `matchTradeBookExits()` → `renderPositionsTab()` → `startAutoFetch()`

### 3. "I Took This Trade" Flow (COMMAND drawer → POSITIONS)
- User taps strategy card → drawer opens → "📌 I TOOK THIS TRADE" button
- `logTradeFromCommand()` captures FULL market snapshot:
  - All leg execution prices (bid for SELL, ask for BUY)
  - VIX, PCR, Max Pain, OI walls (call + put), ATM IV
  - Total call/put OI, FII cash, Close Char
  - Bias direction + net votes, composite score, Varsity tier
  - Futures premium
- Inserts to Supabase via `dbInsertTrade()`
- Auto-switches to POSITIONS tab, starts auto-fetch
- Future SYNC will overwrite estimated prices with actual Upstox fill prices (pending)

### 4. Auto-Fetch (runs after SYNC, market hours only)
- Fetches: spots + position-specific chains only (1-2 API calls)
- Reads open trades from Supabase
- Computes live P&L from `_POSITION_CHAINS` strikeLTPs
- Updates Supabase with P&L, peak, recommendation
- Re-renders POSITIONS cards
- Fires PWA notifications (urgent = immediate, routine = every 30 min)
- Does NOT touch SIGNAL, COMMAND, `_CHAINS`
- Flow: `upstoxLightFetch()` → spots → chains → `checkThesisAndNotify()` → `renderPositionsTab()`

### Key Separation Rules
- FETCH → strategy scanning only. SYNC → position management only. Auto-fetch → live tracking only.
- `detectAndLogPositions` only called from SYNC
- `matchTradeBookExits` only called from SYNC
- `checkThesisAndNotify` only called from auto-fetch
- `renderPositionsTab` queries Supabase directly (not dependent on `_DETECTED_POSITIONS`)
- Notifications only fire during market hours (9:15-15:30 IST)
- Banner REMOVED — alerts shown via badges on expandable position cards
- `computeLivePnL()` is the single shared P&L calculator

## Scoring Engine
- **9 signals, sum=1.00:** india_vix:0.25, pcr_nf:0.18, fii:0.15, gift_gap:0.15, close_char:0.10, max_pain:0.08, n50adv:0.04, bnfadv:0.03, n50dma:0.02
- **bnfadv now uses weighted breadth** from top-5 BNF constituent checkboxes (Phase 5), not simple count
- **calcScore details stored** in `_CALC_SCORE_DETAILS` for expandable Q1 card display
- **Two-stage scoring:** Base score (85pts: EV/rupee×40, Prob×20, CapEff×10, Liq×5, PCR×5, IV×3, DTE×2). Then Varsity multiplier: Tier1×1.0, Tier2×0.65, Tier3×0.35
- **VIX fine-tune:** ≥20 credit+0.05, ≥24 extra+0.05, ≤13 long+0.10, ≥20 long-0.10
- **R:R split filter:** Credit strategies: P(Profit)>35% + EV>0. Debit: R:R≥1.5
- **Split display:** Top 5 NF + Top 5 BNF on COMMAND tab

## Bias Engine (Q1)
- **7 signals** (was 6): FII Cash (>±500Cr), FII Derivatives (net futures+options), PCR (>1.2 bull/<0.9 bear), Max Pain gravity (spot vs MP, ±100pts), Close Char (≥+1 bull/≤-1 bear), VIX Direction (vs yesterday, ±0.3 threshold), **Futures Premium** (>+0.05% bull/<-0.05% bear — auto from chain)
- Net votes → Strong/Mild BULL/BEAR or NEUTRAL
- **Expandable Q1 card** (Phase 5): collapsed shows bias+net, expanded shows all 7 signals + 9 weighted score breakdown with raw values, weights, and contributions

## Futures Premium Signal
- Synthetic futures from ATM put-call parity: `synthFutures = ATM_strike + (CE_ltp - PE_ltp)`
- Premium = `(synthFutures - spot) / spot × 100`
- Displayed on SIGNAL tab. Stored in `window._NF_FUTURES_PREMIUM` / `window._BNF_FUTURES_PREMIUM`
- Saved in entry snapshot as `entry_futures_premium` (uses correct index — NF or BNF)
- **Phase 5:** Now feeds into Q1 bias engine as 7th signal

## Weighted BNF Breadth (Phase 5)
- Top 5 BNF constituents by weight: HDFC Bank (28%), ICICI Bank (22%), Kotak Mah (12%), SBI (9%), Axis Bank (8%) = 79% coverage
- 5 checkboxes on SIGNAL tab — tap advancing stocks after 9:30 AM
- Weighted % auto-computed: `sum(checked_weight × 100)`
- Feeds into `bnfadv` signal: `(weightedBreadth - 40) / 40` clamped to [-1, +1]
- Replaces old simple `bnfadv` count input (0–12)
- Live readout below checkboxes shows weighted advance %
- Saved/restored via breadth lock

## Supabase Schema — trade_log
**Core:** id, created_at, updated_at, strategy_type, index_key, expiry, entry_date, entry_spot, entry_vix, entry_premium, max_profit, max_loss, target_profit, stop_loss, lots, status
**Legs:** leg1_strike, leg1_type, leg1_action, leg1_entry_ltp, leg1_qty (×4 legs)
**Tracking:** current_pnl, current_spot, current_premium, recommendation, peak_pnl
**Thesis:** entry_pcr, entry_max_pain, entry_sell_oi
**Rich snapshot (Phase 3.1):** entry_call_wall, entry_put_wall, entry_total_call_oi, entry_total_put_oi, entry_atm_iv, entry_fii_cash, entry_bias, entry_bias_net, entry_score, entry_varsity_tier, entry_close_char, entry_futures_premium
**Exit:** actual_pnl, exit_premium, exit_reason, exit_date

## UI Theme — Upstox-Inspired
- **Dark:** bg #121218, cards #1e1e2d, accent #8b5cf6 (purple)
- **Light:** bg #f5f5f9, cards #ffffff, accent #7c3aed (purple)
- **Font:** system sans-serif (-apple-system, Segoe UI, Roboto)
- **Chart:** orange #ef6c00 (expiry), green #22c55e (current P&L), grey #8a8a9a (spot)

## NSE Holidays 2026
15 holidays: Jan-26, Mar-03, Mar-26, Mar-31, Apr-03, Apr-14, May-01, May-28, Jun-26, Sep-14, Oct-02, Oct-20, Nov-10, Nov-24, Dec-25
Source: NSE/CMTR/71775, Dec 12 2025. Do NOT change without new official circular.

## Calibrations — DO NOT CHANGE
- DTE multipliers, getVixMult, NF_PUT_SKEW=1.35, distFactor, winProb formula
- Varsity tier multipliers (1.0/0.65/0.35)
- Calibrated from 274 NF + 134 BNF real observations

## Revert References
- **Phase 2 (SEALED Mar 12):** app.js(1058), upstox.js(437), style.css(338), index.html(220), bs.js(177), bhav.js(317), db.js(171). Total 2740 lines.
- **Phase 3 (SEALED Mar 14):** app.js(1720), upstox.js(668), style.css(371), index.html(246), bs.js(177), bhav.js(317), db.js(285), sw.js(35). Total 3841 lines.
- **Phase 4 (SEALED Mar 16):** app.js(2078), upstox.js(727), style.css(477), index.html(252), bs.js(177), bhav.js(317), db.js(298), sw.js(35). Total 4383 lines.

## Completed Trades
### Trade #1: BNF Bear Put Spread (Mar 13-16 2026)
- Entry: Mar 13, BUY 54200 PE @1049.9, SELL 53700 PE @872.1
- Bias: STRONG BEAR (-3 net, 4 bear signals)
- P&L journey: +₹628 (Fri close) → +₹271 (Mon gap-up) → +₹933 (exit)
- Exit: Mar 16 10:23 AM, BNF at 53,633
- Exit reason: HDFC Bank diverging upward, spotted weighted breadth issue
- Key insight: Unweighted advance/decline masked HDFC Bank's 28% weight impact

## Bugs Fixed (Mar 10-16)
1-24: Prior Phase 2-3 fixes
25: POSITIONS tab empty on weekends → renderPositionsTab now queries Supabase directly
26: FII lock bug → fii_fut and fii_opt added to toggleRadar save array
27: Trade book only returns today's fills → "I Took This Trade" flow solves carry-over

## Roadmap
- Phase 1-3 ✅ CLOSED
- Phase 3.1 ✅ CLOSED Mar 16 2026
- Phase 4 ✅ CLOSED Mar 16 (Trade Dissection Dashboard, dead code cleanup)
- **Phase 5 ✅ CLOSED Mar 16** (Expandable Q1 card, weighted BNF breadth, futures premium as 7th Q1 bias signal)
- **Phase 6:** Auto-recalibration (needs 10-15 trades)

## Pending Items
1. Auto-exit detection in auto-fetch (trade book check every 5 min)
2. SYNC overwrites estimated prices with actual Upstox fills
3. Pattern Discovery from trade dissection data (needs more trades)
4. Signal Recalibration (Phase 6 — needs 10-15 trades)

## Key Insights from Live Trading
1. Bugs only appear with real live positions during market hours
2. NSE holidays break simple date calculations
3. Upstox strategy orders don't appear in positions API
4. Trade book only returns today's fills
5. Use ONE shared function for P&L (`computeLivePnL`)
6. POSITIONS tab must work independently — Supabase is source of truth
7. "Don't just think about money, think about what the winning side is doing"
8. Weighted stocks dominate index direction — HDFC Bank alone is ~28% of BNF
9. Rich entry snapshot enables meaningful post-trade dissection
10. Trade-first → dissect → validate beats traditional backtesting for options
