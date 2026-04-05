# Zerodha Varsity vs Market Radar v2.1 — Complete Comparison
## Extracted from Modules 5, 6, 9, 10 (662 pages, 20,535 lines)

---

## SECTION 1: WHAT WE'RE DOING RIGHT ✅

### 1.1 Delta = Probability (M5 Ch 11)
**Varsity:** "The delta of an option is also the probability for the option to expire ITM."
- Delta 0.3 = 30% chance of expiring ITM
- "There is 90% chance for the option to expire OTM. With such a huge probability favoring the seller, one should go ahead and take the trade with conviction!"

**Our app:** Uses `1 - |delta(breakeven)|` for P(Profit) on credit spreads.
**Verdict: ✅ ALIGNED** — b53b breakeven fix makes this even more accurate than raw delta.

### 1.2 Theta Favors Sellers (M5 Ch 14)
**Varsity:** "Theta is a friendly Greek to the option seller." "A short option will have a positive theta."
- Options lose money daily due to theta
- Selling near expiry = lower premium but FASTER decay
- Selling at start = higher premium but SLOWER decay

**Our app:** Force 2 (Theta) = always +1 for credit sellers, -1 for debit buyers.
**Verdict: ✅ PERFECTLY ALIGNED**

### 1.3 Credit Preferred Over Debit (M6 Ch 3, 8)
**Varsity:** "Personally I do prefer strategies which offer net credit rather than strategies which offer net debit." (Said for both Bull Put and Bear Call chapters)

**Our app:** Varsity filter gives PRIMARY to credit strategies in HIGH IV environments.
**Verdict: ✅ ALIGNED**

### 1.4 Max Pain Theory (M6 Ch 13)
**Varsity:** "Option Pain identifies the price at which the market is likely to expire considering least amount of pain to option writers." Step-by-step calculation method provided.

**Our app:** Computes and displays Max Pain for both BNF and NF. Shows distance from spot.
**Verdict: ✅ ALIGNED**

### 1.5 PCR as Contrarian Indicator (M6 Ch 13)
**Varsity:** "PCR is usually considered a contrarian indicator." 
- PCR > 1.3 = extreme bearishness → market likely to reverse UP (bullish signal)
- PCR < 0.5 = extreme bullishness → market likely to reverse DOWN (bearish signal)
- All values 0.5 to 1 = regular activity, ignore

**Our app:** PCR > 1.2 = BULL vote, PCR < 0.9 = BEAR vote (contrarian, same direction as Varsity)
**Verdict: ✅ ALIGNED** — Our thresholds are more conservative (1.2 vs 1.3, 0.9 vs 0.5). Consider widening?

### 1.6 Near-ATM PCR Over Full Chain (M6 Ch 13)
**Varsity:** "What would really make sense is to historically plot the daily PCR values."

**Our app:** Uses near-ATM PCR (±10 strikes) not full chain. Full chain includes far OTM noise.
**Verdict: ✅ BETTER THAN VARSITY** — We improved on their basic approach.

### 1.7 Gamma Risk ATM Near Expiry (M5 Ch 12)
**Varsity:** "Large Gamma can translate to large gamma risk (directional risk)." "As we approach expiry, the gamma values of ATM options spike."

**Our app:** ⚠️ High γ warning on ATM credit sells. Gamma risk = f(moneyness, DTE).
**Verdict: ✅ ALIGNED** (especially after b53 fix making it a visible warning)

### 1.8 Vega — Sell When Vol High, Buy When Low (M5 Ch 19)
**Varsity:** "Buy options when you expect volatility to increase and short options when you expect the volatility to decrease."
- When VIX high, premiums are rich → good time to sell
- When VIX low, premiums are cheap → good time to buy

**Our app:** Force 3 (IV): HIGH/VERY_HIGH → credit +1, LOW → debit +1.
**Verdict: ✅ ALIGNED** on level. See Section 2 for direction nuance.

### 1.9 Strategy Selection by Market Condition (M6 all chapters)
**Varsity:** Each chapter starts with "when to invoke" based on market outlook:
- Moderately bearish + high vol → Bear Call (credit)
- Moderately bearish + low vol → Bear Put (debit)
- Moderately bullish + high vol → Bull Put (credit)
- Moderately bullish + low vol → Bull Call (debit)

**Our app:** Varsity filter table maps bias + IV to PRIMARY strategy type.
**Verdict: ✅ PERFECTLY ALIGNED** — This IS the Varsity framework implemented.

### 1.10 Recovery Trauma (M9 Ch 11)
**Varsity:** "If you risk too much on any one trade, the climb back is Herculean."
- 5% loss needs 5.3% to recover
- 10% loss needs 11.1%
- 60% loss needs 150%
- "Never risk too much on any one trade, especially with small capital"

**Our app:** MAX_RISK_PCT = 10%, maxLoss filter blocks candidates exceeding this.
**Verdict: ✅ ALIGNED** — Though Varsity implies 5% is safer than 10%. See Section 3.

---

## SECTION 2: WHAT WE'RE MISSING ❌

### 2.1 ❌ Volatility DIRECTION vs LEVEL (CRITICAL)
**Varsity (M6 Ch 8.4):** "It is advisable to take the bear call spread only when the volatility is EXPECTED TO INCREASE."
**Varsity (M6 Ch 11):** For short straddle: "The volatility should be relatively HIGH at the time of strategy execution. The volatility should DECREASE during the holding period."

**Key insight:** Varsity distinguishes WHEN TO ENTER vs WHEN TO HOLD:
- CREDIT SPREADS: Enter when vol is HIGH *and still rising* (to get maximum credit). During holding, vol decrease is good (premiums shrink, you keep credit).
- DEBIT SPREADS: Enter when vol is LOW (cheap premiums). During holding, vol increase is good.

**Our app:** Force 3 only checks VIX LEVEL (HIGH/LOW). VIX DIRECTION is in Force 1 (bias signal #5) but it votes on market direction, not on strategy timing.

**Trade #5 example:** VIX was 24.8 (HIGH → Force 3 = +1 for credit). But VIX direction was FLAT to falling (-0.1%). Varsity would say: "vol not expected to increase, avoid bear call spread" or at minimum "you won't get the best credit."

**FIX NEEDED:** Force 3 should consider both VIX LEVEL and VIX DIRECTION:
- HIGH VIX + VIX rising → credit sellers STRONG +1
- HIGH VIX + VIX flat/falling → credit sellers WEAK +1 or 0
- LOW VIX + VIX falling → debit buyers STRONG +1
- LOW VIX + VIX flat/rising → debit buyers WEAK +1 or 0

### 2.2 ❌ Strike Selection by DTE (CRITICAL)
**Varsity (M5 Ch 22):** Detailed tables for strike selection based on time to expiry:

**For BUYING options (1st half of series, 15+ DTE):**
| Target timeframe | Best strike |
|-----------------|-------------|
| 5 days | Far OTM (2-3 strikes from ATM) |
| 15 days | ATM or slightly OTM (1 strike) |
| 25 days | Slightly ITM |
| At expiry | ITM |

**For BUYING options (2nd half of series, <15 DTE):**
| Target timeframe | Best strike |
|-----------------|-------------|
| Same day | Far OTM (2-3 strikes) |
| 5 days | Slightly OTM (1 strike) |
| 10 days | ATM or slightly ITM |
| At expiry | ITM |

**Key rule:** "People end up buying OTM options simply because the premiums are lower. Do not fall for this."

**For SELLING credit spreads (M6 Ch 8.4):**
| Series half | DTE | Sell strike | Buy strike |
|------------|-----|------------|------------|
| 1st half | 25 days | OTM | ATM+2 strikes |
| 1st half | 15 days | OTM | ATM+1 strike |
| 2nd half | 5 days | Slightly OTM | ATM |
| At expiry | 0-1 days | ATM/ITM | ATM |

**Our app:** No DTE-based strike selection. generateCandidates tries ALL width combinations without considering which strikes are optimal for the current DTE.

**FIX NEEDED:** This is exactly the Intraday vs Swing toggle design:
- Intraday (0-1 DTE): Sell ATM to slightly OTM
- Swing (3-7 DTE): Sell OTM near wall, avoid ATM
- Map Varsity's 1st/2nd half to our DTE ranges

### 2.3 ❌ Iron Condor and Iron Butterfly Not in Varsity
**Varsity:** Does NOT cover Iron Condor or Iron Butterfly at all. Module 6 covers 2-leg strategies + straddles/strangles only.

**Our app:** Generates IC and IB candidates. IB is always blocked (correct for ₹1.1L account). IC is ALLOWED in some conditions.

**Implication:** Our IC implementation is beyond Varsity's scope. We're on our own for IC logic. This is fine — IC is essentially two credit spreads combined, which Varsity does cover individually.

### 2.4 ❌ Trading Journal (M9 Ch 16)
**Varsity (M9 Ch 16.4):** "One way to overcome the attribution bias is to maintain a trading journal and make entries which reason outs why you've entered into a trade and why you decided to close the trade."

**Our app:** We log trades to Supabase with entry snapshot, but no free-text journal field for "why I took this trade" and "why I exited."

**FIX:** Add optional journal text field to takeTrade and closeTrade. Even 1-2 sentences per trade.

### 2.5 ❌ Kelly's Criterion for Position Sizing (M9 Ch 14)
**Varsity:** Kelly % = W - [(1-W)/R]
- W = winning probability (winners / total trades)
- R = win/loss ratio (avg gain / avg loss)
- Output = % of capital to expose

**Our app:** Fixed 1 lot per trade. No dynamic position sizing.

**With our 5 trades:**
- W = 3/5 = 0.60
- R = avg gain / avg loss = ((933+1130+1118)/3) / ((0+1537)/2) = 1060 / 768 = 1.38
- Kelly % = 0.60 - [(1-0.60)/1.38] = 0.60 - 0.29 = 0.31 (31%)

31% of ₹1.1L = ₹34,100 max exposure per trade. Currently we're exposing ₹6-10K maxLoss which is 5-9% — well WITHIN Kelly's suggestion.

**FIX:** After 10-15 trades, implement Kelly % display as confidence indicator. Not for auto-sizing (we trade 1 lot always) but as "how confident should I be" gauge.

---

## SECTION 3: POTENTIAL MISMATCHES ⚠️

### 3.1 ⚠️ MAX_RISK_PCT = 10% vs Varsity's 5% Rule
**Varsity (M9 Ch 12):** "The 5% rule does not permit you to risk more than 5% of the capital on a given trade."
**Our app:** MAX_RISK_PCT = 10%

**Analysis:** With ₹1.1L capital and 10% max risk, we can lose up to ₹11,000 per trade. At 5%, max loss would be ₹5,500. Trade #5 lost ₹1,537 — well within both limits. But wider spreads (W:500+) could hit the 10% cap.

**Recommendation:** KEEP at 10% for now. With 1-lot trades, our actual losses are typically ₹1-2K (1-2% of capital). The 10% cap is a safety net, not a target. Revisit after 15 trades.

### 3.2 ⚠️ PCR Thresholds
**Varsity:** PCR > 1.3 = bearish extreme (→ bullish contrarian). PCR < 0.5 = bullish extreme (→ bearish contrarian). 0.5-1.0 = ignore.
**Our app:** PCR > 1.2 = BULL, PCR < 0.9 = BEAR

**Analysis:** Our BULL threshold (1.2) triggers earlier than Varsity's (1.3) — we're more sensitive. Our BEAR threshold (0.9) triggers much earlier than Varsity's (0.5) — we call bearish signal when Varsity would still say "normal range."

**Risk:** We may generate false BEAR signals from PCR 0.7-0.9 which Varsity considers normal. However, we use near-ATM PCR which is inherently higher than full-chain PCR, so our 0.9 threshold may correspond to Varsity's 0.5 on full chain.

**Recommendation:** KEEP current thresholds. Near-ATM PCR runs higher than full-chain PCR. Our empirical data from 102+ days will eventually tell us optimal thresholds.

### 3.3 ⚠️ Bear Call + Falling Volatility
**Varsity (M6 Ch 8.4):** "Avoid the bear call spread if you expect volatility to decrease."
**Our app:** Bear Call is PRIMARY when bias is BEAR and VIX is HIGH — regardless of VIX direction.

**Trade #5:** VIX 24.8 (HIGH) but direction flat/falling (-0.1%). Varsity would caution against Bear Call here because vol wasn't expected to increase.

**This is subtle:** Varsity is talking about getting MAXIMUM credit. If vol is falling, the credit you receive today will be lower than yesterday. You're selling at a worse price. But the spread still works if spot stays below breakeven.

**Recommendation:** Don't change Force 3 logic. Instead, add a VIX DIRECTION qualifier on candidate cards: "⚠️ VIX falling — credit narrowing" as informational warning, not a blocking signal. Collect data for 20+ trades then evaluate.

---

## SECTION 4: NEW IDEAS FROM VARSITY

### 4.1 Volatility-Based Strategy Timing
**Varsity (M5 Ch 22):** "Buy options when you expect volatility to increase. Sell options when you expect volatility to decrease."

**Applied to our system:**
- VIX 24→26 (rising) + BEAR bias → Bear Call (SELL credit) is PERFECT timing
- VIX 26→24 (falling) + BEAR bias → Bear Call still works but credit is shrinking
- VIX 24→22 (falling fast) + BEAR bias → Consider Bear Put (debit) if VIX is heading to LOW regime
- VIX 15→13 (falling) + BULL bias → Bull Call (debit) is PERFECT timing

### 4.2 The "2nd Half Acceleration" Rule
**Varsity (M5 Ch 14, 22):** Theta decay accelerates in the 2nd half of the expiry series (last 15 days). "The effect of theta is low at the start of the series but accelerates towards expiry."

**Our DTE system already knows this** — we compute tradingDTE. But we don't USE it to adjust strike selection or warn about theta acceleration.

**FIX for Intraday/Swing:** In swing mode (3-7 DTE), we're in the "2nd half" where theta accelerates. This HELPS credit sellers (faster decay) but HURTS debit buyers. Swing mode should strongly prefer credit.

### 4.3 "Smart Money" Exits via Attribution Bias
**Varsity (M9 Ch 16.4):** Traders blame brokers for losses instead of analyzing their entry logic.

**Applied:** Our closeTrade should capture exit reasoning. Was the exit due to thesis break? Stop loss? Profit target? Panic? Over time, this reveals patterns in our own trading behavior.

### 4.4 Confirmation Bias Warning
**Varsity (M9 Ch 16.3):** "When you form a trading opinion, you only look for information that supports your view."

**Applied to Trade #5:** Bias said MILD BEAR, 3/3 forces aligned → confirmed our bearish view. But the gap-up +1.47σ was screaming the opposite. We looked at forces (confirming) and ignored the gap (contradicting). The gap conflict warning in b53 directly addresses this bias.

### 4.5 Recency Bias Warning
**Varsity (M9 Ch 15.3):** "Recency bias gets you carried away with the latest information/event."

**Applied:** After 3 winning trades, we felt confident taking an aggressive ATM sell. The recency of wins made us overconfident. Kelly's Criterion (31%) would have told us "your edge is modest, don't overextend."

---

## SECTION 5: SUMMARY — ACTION ITEMS

### Immediate (b54 weekend build):
1. **Intraday vs Swing toggle** — implements Varsity's DTE-based strike selection
2. **VIX direction qualifier** on credit strategy cards (informational, not blocking)

### Near-term (after 10 trades):
3. **Kelly % display** — confidence gauge from trade history
4. **Journal field** in trade entry/exit — overcome attribution bias
5. **VIX direction in Force 3** — level + direction combined assessment

### Data collection (ongoing):
6. **PCR threshold validation** — compare our 1.2/0.9 vs Varsity's 1.3/0.5 with accumulated data
7. **Volatility direction correlation** — track: when we entered with VIX rising vs falling, which trades won?
8. **MAX_RISK evaluation** — are we ever hitting 10%? Is 5% more appropriate?

---

## SECTION 6: VARSITY PRINCIPLES WE ALREADY EXCEED

| Principle | Varsity | Our App | Why we're better |
|-----------|---------|---------|-----------------|
| PCR | Full chain | Near-ATM ±10 strikes | Filters institutional noise |
| Max Pain | Static calculation | Live display with spot distance | Updates every 5 min |
| Delta/Probability | Raw delta at strike | Delta at BREAKEVEN (b53b) | More accurate for credit spreads |
| Strategy selection | Manual decision | Automated Varsity filter + 3 forces | Removes human bias |
| Position monitoring | Manual | Control Index + 5-min auto-poll | Real-time thesis validation |
| Institutional flow | Not covered | FII/DII absorption + near-ATM PCR direction | Deeper institutional insight |
| Risk management | Generic 5% rule | Dynamic peakCash + maxLoss + capital blocks | Tailored to spread mechanics |
