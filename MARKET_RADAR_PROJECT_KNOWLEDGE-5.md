# Market Radar v5.2 — Project Knowledge

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
- NF_MARGIN=97000, BNF_MARGIN=28000, MAX_RISK=5%
- NF_WIDTH/BNF_WIDTH: **DYNAMIC** — NF tries [100,150,200,250,300,400], BNF tries [200,300,400,500,600,800,1000]; scoring engine picks optimal
- Script order: supabase CDN → db.js → bhav.js → bs.js → app.js → upstox.js
- SW registered separately

## File Structure (Phase 5.2 — Mar 17 2026)
| File | Lines | Role |
|------|-------|------|
| app.js | 2640 | Scoring engine, strategy eval, multi-width candidates, range budget filter, adversarial Control Index, expandable Q1 card, FII 2D signal, Upstox Pulse consensus, "I Took This Trade" flow, trade dissection |
| upstox.js | 1039 | API integration, chain fetch, NF50 breadth (50 ISINs), BNF breadth (5 weighted), SYNC positions, auto-fetch position monitor, synthetic futures premium, BNF live weighted breadth for Control Index |
| style.css | 521 | Upstox-inspired purple theme, expandable Q1, collapsible BNF constituent grid, score breakdown table, Control Index bar |
| index.html | 290 | 4-tab layout: SIGNAL (FII Short%, Upstox Pulse, Range Budget), COMMAND, POSITIONS, CLOSE |
| bs.js | 177 | Black-Scholes (secondary — real LTPs from Upstox are primary) |
| bhav.js | 317 | Bhav copy upload + historical OI data |
| db.js | 298 | Supabase CRUD: trades, stats, journal, rich entry snapshot |
| manifest.json | 22 | PWA manifest |
| sw.js | 35 | Service worker for notifications |

## Architecture — Clean Separation (Phase 3.1+)

### 1. Strategy Scanner (SIGNAL tab → FETCH button)
- Fetches: spots, expiries, chains (all expiries), historical, margins, BNF constituent breadth, NF50 breadth
- Calculates: synthetic futures premium from ATM put-call parity, riskCenter for strike selection
- Updates: SIGNAL tab (bias, futures premium, range budget, BNF checkboxes, NF50 count), COMMAND tab (top 5 NF + top 5 BNF strategies)
- Does NOT fetch positions, trade book, or detect trades
- Does NOT start auto-fetch
- Flow: `upstoxAutoFill()` → spots → expiries → chains + historical + margins + BNF breadth + NF50 breadth → `calcScore()` → `buildCommand()` → `renderFuturesPremium()` → `renderRangeBudget()`

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
  - Futures premium (uses correct index — NF or BNF, prefers actual over synthetic)
  - **entry_sell_oi + entry_buy_oi** — for adversarial Control Index tracking
- Inserts to Supabase via `dbInsertTrade()`
- Auto-switches to POSITIONS tab, starts auto-fetch
- Future SYNC will overwrite estimated prices with actual Upstox fill prices (pending)

### 4. Auto-Fetch (runs after SYNC, market hours only)
- Fetches: spots + position-specific chains only (1-2 API calls)
- Reads open trades from Supabase
- Computes live P&L from `_POSITION_CHAINS` strikeLTPs
- **Computes adversarial Control Index** from chain OI, PCR, MaxPain, BNF breadth
- Updates Supabase with P&L, peak, recommendation
- Re-renders POSITIONS cards with Control Index bar
- Fires PWA notifications (urgent = immediate, routine = every 30 min, includes Control score)
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

## Multi-Width Dynamic Candidates (Phase 5.1)
- **Old:** Fixed NF_IC_WIDTH=200, BNF_IC_WIDTH=500 for all strategies
- **New:** `buildCandidates()` generates 6-7 width options per sell strike:
  - NF: [100, 150, 200, 250, 300, 400] (step=50)
  - BNF: [200, 300, 400, 500, 600, 800, 1000] (step=100)
- Each width creates a separate candidate with `.width` property
- `evaluateSetup()` receives `cand.width`, all downstream (maxProfit, maxLoss, margin, payoff chart) use dynamic width
- Scoring engine discovers optimal width per VIX/DTE regime — no magic fractions needed
- Candidate cap: `slice(0, 30)` per strategy type (was 5)
- BULL_CALL/BEAR_PUT search range expanded to ±300 NF / ±800 BNF (was 200/600)
- `detectAndLogPositions` derives width from actual leg strikes using `minGap` (handles IC correctly)
- Strategy card shows `W:250` etc. Drawer shows "Spread Width: 250 pts"

## Range Budget Filter (Phase 5.2)
- **Problem:** App recommended W:400 Bull Call Spread when only 139 pts of 1σ upside remained
- **Solution:** For debit spreads (BULL_CALL, BEAR_PUT), reject if width > remaining 1σ in trade direction
- **Calculation:**
  - `dailyEM = bsExpectedMove(spot, vix, tradingDte)` → 1σ range
  - `moveFromClose = spot - prevClose` → how much already consumed
  - Bull: `remainingUp = max(0, sigma1 - max(0, moveFromClose))`
  - Bear: `remainingDown = max(0, sigma1 - max(0, -moveFromClose))`
  - If `width > remainingRange × 1.2` → reject (20% tolerance)
- **Display on SIGNAL tab:** "NF 1σ: 297 pts · ↑0 / ↓297 remaining (147% consumed up)"
- Uses `nifty_prev` (NF) and `window._BNF_PREV_CLOSE` (BNF) from historical fetch
- Does NOT affect credit spreads (wider = safer for credit)

## Adversarial Control Index (Phase 5.2)
- **Philosophy:** Options trading is zero-sum. For every winner there's a loser. The app should think: "Who is in control of this trade right now?"
- **Score:** -100 (opponent in full control) to +100 (you in full control)
- **4 signals, weighted by Vivek's priority ranking:**

| Signal | Weight | +ve (you winning) | -ve (they winning) |
|--------|--------|-------------------|-------------------|
| Max Pain Migration | 35% | MP moving toward thesis | MP moving against |
| Sell Strike OI | 30% | OI increasing (defending) | OI decreasing (retreating) |
| PCR Shift | 25% | PCR supporting thesis | PCR shifting against |
| Heavyweight Divergence (BNF only) | 10% | Top stocks aligned | Heavyweight fighting thesis |

- **Direction-aware:** Each signal knows if trade is bull/bear/IC and scores accordingly
- **Modifies alerts:**

| P&L | Control Index | Alert |
|-----|---------------|-------|
| Profitable | < -30 | BOOK PROFIT (urgent — they're taking over) |
| Profitable | < -10 + thesis weak | BOOK PROFIT |
| Losing | < -30 | EXIT EARLY |
| Losing | < 10 + thesis severity ≥ 2 | EXIT EARLY |

- **Display:** Expandable position card shows gradient bar + narrative + signal-by-signal breakdown
- **Notifications:** Include `Ctrl: +38` or `Ctrl: -28` in both urgent and routine notifications
- **Data requirements:** `entry_buy_oi` column added to Supabase (ALTER TABLE done Mar 17)
- **BNF Heavyweight:** Uses `window._BNF_LIVE_BREADTH.weightedPct` from BNF constituent auto-fetch

## Scoring Engine
- **9 signals, sum=1.00:** india_vix:0.25, pcr_nf:0.18, fii:0.15, gift_gap:0.15, close_char:0.10, max_pain:0.08, n50adv:0.04, bnfadv:0.03, n50dma:0.02
- **FII signal now 2D:** Cash flow (₹Cr) + FII Short % positioning:
  - >85% short + increasing → strong bear (-0.8 floor)
  - >85% short + decreasing → covering (bear weakening, +0.3 boost)
  - <70% short → bullish positioning (+0.3 floor)
  - Yesterday's short % stored in `localStorage mr_fii_short_prev` on radar lock
- **bnfadv now uses weighted breadth** from top-5 BNF constituent checkboxes
- **n50adv now auto-fetched** from all 50 NF stocks via ISIN
- **calcScore details stored** in `_CALC_SCORE_DETAILS` for expandable Q1 card display
- **Two-stage scoring:** Base score (85pts: EV/rupee×40, Prob×20, CapEff×10, Liq×5, PCR×5, IV×3, DTE×2). Then Varsity multiplier: Tier1×1.0, Tier2×0.65, Tier3×0.35
- **Upstox consensus penalty:** When Upstox bias disagrees with our Q1 bias, Varsity multiplier reduced by 0.10 for ALL strategies
- **VIX fine-tune:** ≥20 credit+0.05, ≥24 extra+0.05, ≤13 long+0.10, ≥20 long-0.10
- **R:R split filter:** Credit strategies: P(Profit)>35% + EV>0. Debit: R:R≥1.5
- **Range budget filter:** Debit spreads rejected if width > remaining 1σ in trade direction
- **Split display:** Top 5 NF + Top 5 BNF on COMMAND tab

## Bias Engine (Q1)
- **7 signals** (was 6): FII Cash (>±500Cr), FII Derivatives (net futures+options), PCR (>1.2 bull/<0.9 bear), Max Pain gravity (spot vs MP, ±100pts), Close Char (≥+1 bull/≤-1 bear), VIX Direction (vs yesterday, ±0.3 threshold), **Futures Premium** (>+0.05% bull/<-0.05% bear — auto from chain)
- Net votes → Strong/Mild BULL/BEAR or NEUTRAL
- **Upstox Pulse on Q1 card:**
  - Consensus badge: "✅ Upstox: Agrees (bearish)" or "⚠️ Upstox: BEARISH — DISAGREES"
  - Key Support OI display: "🛡️ Key Support: 83L @ 23000 PE"
- **Expandable Q1 card** (Phase 5): collapsed shows bias+net+consensus, expanded shows all 7 signals + 9 weighted score breakdown

## Upstox Pulse Section (Phase 5.2)
- **3 new fields on SIGNAL tab** — manual input from Upstox F&O Daily email:
  1. **FII Short %** (number) — e.g. 88. Enhances FII signal from 1D to 2D. Stored in localStorage on radar lock as yesterday's baseline.
  2. **Upstox Bias** (dropdown: Bullish/Bearish/Neutral) — consensus badge on Q1 card, -0.10 Varsity penalty when disagrees.
  3. **Key Support OI** (text) — e.g. "83L @ 23000 PE". Display only on Q1 card.
- **All 3 fields included in radar lock/restore**

## NF50 Breadth Auto-Fetch (Phase 5.1)
- All 50 NF50 constituents with ISINs from official NSE CSV (niftyindices.com)
- One API call: `NSE_EQ|{ISIN}` format, same proven pattern as BNF
- Counts advancing stocks, scales to 50: `Math.round(advancing / matched * 50)`
- Auto-fills `n50adv` input field
- 9:30 IST time gate (same as BNF breadth)
- Debug: `window._NF50_BREADTH_DEBUG` shows keys_sent vs keys_received
- 5 ISINs overlap with BNF (verified): HDFCBANK, ICICIBANK, KOTAKBANK, SBIN, AXISBANK

## Weighted BNF Breadth (Phase 5)
- Top 5 BNF constituents by weight: HDFC Bank (28%), ICICI Bank (22%), Kotak Mah (12%), SBI (9%), Axis Bank (8%) = 79% coverage
- **Auto-fetched from Upstox** using ISIN-based instrument keys (after 9:30 IST)
- **`window._BNF_LIVE_BREADTH`** stored with `weightedPct` for adversarial Control Index heavyweight divergence signal
- Collapsible section: header shows weighted %, tap to expand individual checkboxes
- Feeds into `bnfadv` signal: `(weightedBreadth - 40) / 40` clamped to [-1, +1]

## Futures Premium Signal
- Synthetic futures from ATM put-call parity: `synthFutures = ATM_strike + (CE_ltp - PE_ltp)`
- Premium = `(synthFutures - spot) / spot × 100`
- Displayed on SIGNAL tab. Stored in `window._NF_FUTURES_PREMIUM` / `window._BNF_FUTURES_PREMIUM`
- Phase 5: Feeds into Q1 bias engine as 7th signal
- **riskCenter:** Synthetic futures used for strike selection (ATM + OTM distance)

## Range Budget Display (Phase 5.2)
- Shows on SIGNAL tab after Futures Premium: "NF 1σ: 297 pts · ↑0 / ↓297 remaining (147% consumed up)"
- Uses `bsExpectedMove(spot, vix, 1)` for daily range
- Move from prev close shows directional consumption
- Color-coded: green (plenty of range), neutral, red (almost exhausted)
- BNF uses `window._BNF_PREV_CLOSE` from historical fetch

## Supabase Schema — trade_log
**Core:** id, created_at, updated_at, strategy_type, index_key, expiry, entry_date, entry_spot, entry_vix, entry_premium, max_profit, max_loss, target_profit, stop_loss, lots, status
**Legs:** leg1_strike, leg1_type, leg1_action, leg1_entry_ltp, leg1_qty (×4 legs)
**Tracking:** current_pnl, current_spot, current_premium, recommendation, peak_pnl
**Thesis:** entry_pcr, entry_max_pain, entry_sell_oi, **entry_buy_oi** (added Phase 5.2)
**Rich snapshot (Phase 3.1):** entry_call_wall, entry_put_wall, entry_total_call_oi, entry_total_put_oi, entry_atm_iv, entry_fii_cash, entry_bias, entry_bias_net, entry_score, entry_varsity_tier, entry_close_char, entry_futures_premium
**Exit:** actual_pnl, exit_premium, exit_reason, exit_date

## UI Theme — Upstox-Inspired
- **Dark:** bg #121218, cards #1e1e2d, accent #8b5cf6 (purple)
- **Light:** bg #f5f5f9, cards #ffffff, accent #7c3aed (purple)
- **Font:** system sans-serif (-apple-system, Segoe UI, Roboto)
- **Chart:** orange #ef6c00 (expiry), green #22c55e (current P&L), grey #8a8a9a (spot)
- **Control Index bar:** gradient green→yellow→red based on -100 to +100

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
- **Phase 5 (SEALED Mar 16):** app.js(2230), upstox.js(903). Total 4762 lines.
- **Phase 5.1 (SEALED Mar 16):** app.js(2276), upstox.js(1029). Total 4934 lines.

## Completed Trades
### Trade #1: BNF Bear Put Spread (Mar 13-16 2026)
- Entry: Mar 13, BUY 54200 PE @1049.9, SELL 53700 PE @872.1
- Bias: STRONG BEAR (-3 net, 4 bear signals)
- P&L journey: +₹628 (Fri close) → +₹271 (Mon gap-up) → +₹933 (exit)
- Exit: Mar 16 10:23 AM, BNF at 53,633
- Exit reason: HDFC Bank diverging upward, spotted weighted breadth issue
- Key insight: Unweighted advance/decline masked HDFC Bank's 28% weight impact
- **Adversarial insight:** Control Index would have flagged HDFC divergence BEFORE the P&L dropped

## Institutional Intelligence — Key Insights
1. **Options trading is zero-sum.** MF heavyweights use options to HEDGE equity positions, not as primary trades. Their "loss threshold" on options is virtually infinite compared to retail.
2. **FII selling stocks + covering futures = repositioning, not conviction.** The selling IS the setup for the bounce.
3. **Extreme PCR is contrarian.** PCR 0.5 = institutions buying cheap calls for the bounce. PCR 1.5 = institutions buying cheap puts for the drop.
4. **FII Short % DIRECTION > level.** 90→88% = ₹thousands of crores covering. The aircraft carrier is turning.
5. **Credit spreads inside the pinning zone = riding institutional coattails.** They pin between MaxPain and OI walls. You profit when they succeed.
6. **Smart money enters 1-2 sessions EARLY.** They bought Friday's cheap calls to sell Tuesday at 10x. Retail buys Tuesday's expensive calls. Don't be exit liquidity.
7. **Max Pain works because of hedging.** Institutions with massive equity+options portfolios push index toward settlement levels that minimize COMBINED exposure.
8. **Gap-ups are selling opportunities for institutions.** They sell INTO retail euphoria. Wait 15 minutes for the gap to fill.
9. **Range budget is critical for debit spreads.** If 1σ is consumed, debit spreads in that direction are statistically dead.

## Roadmap
- Phase 1-5 ✅ CLOSED
- Phase 5.1 ✅ CLOSED Mar 16 (multi-width, NF50 breadth)
- **Phase 5.2 ✅ CLOSED Mar 17** (adversarial Control Index, range budget filter, FII 2D signal, Upstox Pulse, range budget display)
- **Next session:** Contrarian PCR flag + FII Short% 3-session trend tracker
- **Phase 6:** Auto-recalibration (needs 10-15 trades)

## Pending Items
1. **Contrarian PCR flag:** PCR < 0.6 → "bounce likely 1-3 sessions", PCR > 1.5 → "drop likely 1-3 sessions". Forward-looking warning, not current bias change.
2. **FII Short% 3-session trend tracker:** Store last 3 values in localStorage, detect covering acceleration (90→88→82 = accelerating), display trend arrow.
3. Auto-exit detection in 5-min auto-fetch (trade book check every 5 min)
4. SYNC overwrites estimated prices with actual Upstox fills
5. Pattern Discovery from trade dissection data (needs more trades)
6. DTE-weighted futures premium signal (near expiry = stronger)
7. Actual futures instrument key discovery (Upstox uses opaque numeric keys like NSE_FO|62277)
8. Signal Recalibration (Phase 6 — needs 10-15 trades)
9. Verify NF50 ISINs — check `_NF50_BREADTH_DEBUG` keys_sent vs keys_received during market hours

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
11. Upstox equity key format: send `NSE_EQ|{ISIN}`, receive `NSE_EQ:{SYMBOL}`
12. Upstox `ohlc.close` updates live during market hours — use `last_price - net_change` for prev close
13. Futures premium gravitational pull strengthens near expiry
14. Synthetic futures from put-call parity is 95% accurate vs actual
15. **147% of 1σ consumed upward = zero remaining upside for debit bull spreads** (Mar 17 live validation)
16. **Multi-width engine discovered W:250 NF, W:300 BNF — context appropriate, not arbitrary**
17. **Upstox DISAGREES badge correctly flagged when our bias flipped to Mild BULL but Upstox said Bearish**
18. **17 DTE is suboptimal for theta capture** — Vivek's own trading insight
