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

## File Structure (Phase 3.1 — Mar 14 2026)
| File | Lines | Role |
|------|-------|------|
| app.js | 1746 | Scoring engine, strategy eval, Supabase-first position rendering, expandable thesis cards |
| upstox.js | 725 | API integration, chain fetch, SYNC positions, auto-fetch position monitor |
| style.css | 401 | UI styling, dark/light toggle, expandable cards, SYNC button |
| index.html | 242 | 4-tab layout: SIGNAL, COMMAND, POSITIONS, CLOSE |
| bs.js | 177 | Black-Scholes (secondary — real LTPs from Upstox are primary) |
| bhav.js | 317 | Bhav copy upload + historical OI data |
| db.js | 285 | Supabase CRUD: trades, stats, journal |
| manifest.json | 22 | PWA manifest |
| sw.js | 35 | Service worker for notifications |

## Architecture — Clean Separation (Phase 3.1)

### 1. Strategy Scanner (SIGNAL tab → FETCH button)
- Fetches: spots, expiries, chains (all expiries), historical, margins
- Updates: SIGNAL tab (bias), COMMAND tab (top 5 NF + top 5 BNF strategies)
- Does NOT fetch positions, trade book, or detect trades
- Does NOT start auto-fetch
- Flow: `upstoxAutoFill()` → spots → expiries → chains + historical + margins → `calcScore()` → `buildCommand()`

### 2. Position Tracker (POSITIONS tab → SYNC button)
- SYNC fetches: spots, positions API, trade book, position-specific chains
- Detects new trades from trade book reconstruction
- Matches exits from trade book fills
- Starts auto-fetch (5 min, market hours only)
- Flow: `upstoxSyncPositions()` → spots → positions + tradebook → chains for open trades → `detectAndLogPositions()` → `matchTradeBookExits()` → `renderPositionsTab()` → `startAutoFetch()`

### 3. Auto-Fetch (runs after SYNC, market hours only)
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

### POSITIONS Tab States
1. **No trades:** "No active positions" placeholder
2. **Supabase has OPEN trades, not synced:** Cards with last-known data from DB, SYNC button ready
3. **Synced:** SYNC button shows "🔒 Synced · Auto-tracking" with timestamp, cards show live P&L

### Expandable Position Cards
- Collapsed: strategy name, badge (HOLD/EXIT/TRAIL), legs, P&L, target/SL
- Expanded (tap ▼ Details): thesis health (PCR drift, MaxPain migration, OI buildup), severity score, entry snapshot (spot, VIX, premium, lots, date, entry PCR), leg details with entry prices
- No banner — urgent alerts via PWA notifications only

## Scoring Engine
- **9 signals, sum=1.00:** india_vix:0.25, pcr_nf:0.18, fii:0.15, gift_gap:0.15, close_char:0.10, max_pain:0.08, n50adv:0.04, bnfadv:0.03, n50dma:0.02
- **Two-stage scoring:** Base score (85pts: EV/rupee×40, Prob×20, CapEff×10, Liq×5, PCR×5, IV×3, DTE×2). Then Varsity multiplier: Tier1×1.0, Tier2×0.65, Tier3×0.35
- **VIX fine-tune:** ≥20 credit+0.05, ≥24 extra+0.05, ≤13 long+0.10, ≥20 long-0.10
- **R:R split filter:** Credit strategies: P(Profit)>35% + EV>0. Debit: R:R≥1.5
- **Split display:** Top 5 NF + Top 5 BNF on COMMAND tab

## Bias Engine (Q1)
- 6 signals: FII Cash (>±500Cr), FII Derivatives (net futures+options), PCR (>1.2 bull/<0.9 bear), Max Pain gravity (spot vs MP, ±100pts), Close Char (≥+1 bull/≤-1 bear), VIX Direction (vs yesterday, ±0.3 threshold)
- Net votes → Strong/Mild BULL/BEAR or NEUTRAL

## Position Detection
- **Upstox positions API returns EMPTY for strategy-placed trades** — this is a known Upstox limitation
- **Solution:** Trade book reconstruction. `upstoxFetchTradeBook()` gets fills → `reconstructPositionsFromTrades()` groups by symbol → calculates net qty and avg price → feeds into `detectAndLogPositions()`
- Reconstruction runs AFTER chains are loaded so `parseUpstoxSymbol` can match expiries against `window._CHAINS`
- **ONLY called from SYNC button** — never from SIGNAL FETCH

## Expiry Parsing
- Trade book uses month-name format: `BANKNIFTY26MAR54200PE`
- `parseUpstoxSymbol` handles both `26MAR` (month name) and `26330` (numeric) formats
- For month-name format: looks up `window._CHAINS[indexKey]` to find the actual holiday-adjusted expiry date
- NSE holidays shift expiry dates — can't calculate "last Thursday" alone
- `dbFindOpenTradeByLegs` provides flexible matching without requiring exact expiry, enables auto-correction

## Live P&L Calculation
- `computeLivePnL(trade, legs)` — single shared function
- Checks `_POSITION_CHAINS` first (fresh, from auto-fetch), then `_CHAINS` (from last manual fetch)
- Falls back to Supabase stored `current_pnl` if no chain data available
- Calculates: `sum(action_mult × (currentLTP - entryLTP)) × lotSize × lots`

## Smart Alert System (5 states)
| State | Trigger | Color | Priority |
|-------|---------|-------|----------|
| EXIT_NOW | SL hit, spot breach, DTE≤3 losing | Red | 5 |
| EXIT_EARLY | P&L dropping + thesis breaking | Orange | 4 |
| BOOK_PROFIT | P&L≥35% target+DTE≤5, or profitable+thesis breaking | Green | 3 |
| TRAIL | P&L>30% DTE 4-10 | Yellow | 2 |
| HOLD | Default | Blue (#6bc5ff) | 0 |

Alerts shown as badges on expandable position cards. PWA notifications for urgent states (priority ≥ 3).

## Chain-Aware Thesis Checks
- `checkThesis(trade)` compares current chain vs entry snapshot
- **Check 1: PCR drift** — >0.15 against position direction
- **Check 2: Max Pain migration** — moved against thesis (NF ±100, BNF ±300 threshold)
- **Check 3: OI buildup at sell strikes** — >50% increase = adversary pressure
- Returns severity 0-3. Exit matrix:
  - P&L dropping + thesis intact → HOLD (noise)
  - P&L dropping + thesis breaking → EXIT EARLY
  - Profitable + thesis breaking → BOOK PROFIT

## Supabase Schema — trade_log
Core: id, created_at, updated_at, strategy_type, index_key, expiry, entry_date, entry_spot, entry_vix, entry_premium, max_profit, max_loss, target_profit, stop_loss, lots, status
Legs: leg1_strike, leg1_type, leg1_action, leg1_entry_ltp, leg1_qty (×4 legs)
Tracking: current_pnl, current_spot, current_premium, recommendation, peak_pnl
Thesis: entry_pcr, entry_max_pain, entry_sell_oi
Exit: actual_pnl, exit_reason, exit_date

## NSE Holidays 2026
15 holidays: Jan-26, Mar-03, Mar-26, Mar-31, Apr-03, Apr-14, May-01, May-28, Jun-26, Sep-14, Oct-02, Oct-20, Nov-10, Nov-24, Dec-25
Source: NSE/CMTR/71775, Dec 12 2025. Do NOT change without new official circular.

## Calibrations — DO NOT CHANGE
- DTE multipliers, getVixMult, NF_PUT_SKEW=1.35, distFactor, winProb formula
- Varsity tier multipliers (1.0/0.65/0.35)
- Calibrated from 274 NF + 134 BNF real observations

## Phase 2 Revert Reference (SEALED Mar 12 2026)
app.js(1058), upstox.js(437), style.css(338), index.html(220), bs.js(177), bhav.js(317), db.js(171), manifest.json(22). Total 2740 lines. If Phase 3 breaks anything critically, revert all files to this snapshot.

## Phase 3 Revert Reference (SEALED Mar 14 2026)
app.js(1720), upstox.js(668), style.css(371), index.html(246), bs.js(177), bhav.js(317), db.js(285), manifest.json(22), sw.js(35). Total 3841 lines. Pre-separation snapshot — banner still present, FETCH handles both SIGNAL and POSITIONS.

## Roadmap
- Phase 1 ✅ (core scoring + bias engine)
- Phase 2 ✅ (positions tracking + HOLD/EXIT/TRAIL + Varsity multiplier + split display)
- Phase 3 ✅ CLOSED Mar 14 2026 (auto-expire + trade journal + trade book exit matching + chain-aware thesis checks + smart notifications + auto-fetch position monitor)
- Phase 3.1 🔧 IN PROGRESS (clean SIGNAL/POSITIONS separation + Supabase-first rendering + expandable thesis cards + banner removed + SYNC button)
- Phase 4: Backtest engine
- Phase 5: Recalibration dashboard (refine Varsity thresholds with real trade data)
- Phase 6: Auto-recalibration

## Bugs Fixed (Mar 10-14)
1-16: Prior Phase 2 fixes (margin, R:R filter, gamma display, etc.)
17: Positions API empty for strategy trades → reconstruct from Trade Book
18: Expiry NaN → parse month names (26MAR) + match against chain expiries
19: P&L=₹0 → race condition: reconstruction ran before chains loaded → moved to post-allSettled
20: P&L=₹0 in render → added render-time `computeLivePnL` using chain LTPs
21: Banner shows ₹0 → `checkAndNotify` was overwriting correct banner from `renderPositionsTab`. Removed `checkAndNotify`, banner only from `renderPositionsTab`
22: Notifications at 10 PM → added `isMarketHours()` guard
23: `autoCloseGonePositions` with empty array was closing all Supabase trades — destructive bug. Fixed: positions API no longer triggers `detectAndLogPositions` directly
24: `upstoxFetchPositions` was calling `detectAndLogPositions` with empty data before trade book reconstruction — removed, detection now only in post-fetch
25: POSITIONS tab empty on weekends — `renderPositionsTab` depended on `_DETECTED_POSITIONS` (memory-only). Fixed: now queries Supabase directly, always shows stored trades.

## Phase 3.1 Changes (Mar 14 2026)
- **Clean separation:** FETCH = SIGNAL+COMMAND only. SYNC = POSITIONS only. No overlap.
- **Supabase-first rendering:** POSITIONS tab always queries `dbGetOpenTrades()`, renders even on weekends/holidays with last-known data
- **Expandable position cards:** Collapsed shows key metrics, tap ▼ Details for thesis health + entry snapshot + leg prices
- **Banner removed:** No more stacked banner. Alerts via card badges + PWA push notifications
- **SYNC button:** On POSITIONS tab, fetches trade book + positions, detects new trades, starts auto-fetch
- **Auto-fetch only from SYNC:** FETCH button no longer triggers position monitoring
- Files changed: app.js (1720→1746), upstox.js (668→725), style.css (371→401), index.html (246→242)

## First Live Trade (Mar 13 2026)
- BNF Bear Put Spread 54200/53700 PE, expiry Mar-30
- Entry: BUY 54200 PE @1049.9, SELL 53700 PE @872.1
- Bias: STRONG BEAR (-3 net, 4 bear signals)
- Close P&L: +₹628 (13% of ₹4,833 target)
- Peak: ₹1,323 at 2:08 PM
- Card P&L matches Upstox exactly
- Target ₹4,800, SL ₹2,700 set in Upstox
- Trade carries over weekend, 17 DTE
- Upstox shows +₹628.50 on Sat Mar 14 (market closed)

## Upstox API Fields
- Chain: `data.data[]` has expiry, strike_price, underlying_key, underlying_spot_price, call_options, put_options
- Each option: `{instrument_key, market_data:{ltp, volume, oi, close_price, bid_price, ask_price, prev_oi}, option_greeks:{vega, theta, gamma, delta, iv, pop}}`
- Flexible parsing tries multiple field name patterns as fallback
- Positions API (`/portfolio/short-term-positions`) returns empty for strategy orders — use trade book instead
- Trade book: `/order/trades/get-trades-for-day` — returns actual fills with tradingsymbol, quantity, price, transaction_type

## Key Insights from Live Testing
1. Pre-market testing is insufficient — bugs only appear with real live positions during market hours
2. Race conditions in async code are invisible until real data flows
3. NSE holidays break simple date calculations — always match against actual chain data
4. Upstox strategy orders don't appear in positions API — must reconstruct from trade book
5. Multiple code paths computing the same thing → overwrites → use ONE shared function (`computeLivePnL`)
6. Manual fetch and auto-fetch must be completely independent — one scans strategies, other monitors positions
7. POSITIONS tab must work independently of SIGNAL/COMMAND — Supabase is the source of truth, not in-memory state
8. "In option trading, one's loss is someone else's profit. Smart money creates noise to shake out retail. If we only think about money, stop loss will always hit. We need to think about what the winning side is doing — not just amounts." — Vivek's thesis insight
