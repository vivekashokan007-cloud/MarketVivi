/* ═══════════════════════════════════════════════════════════════
   Market Radar v2.0 — Premium-First Trading Engine
   
   Philosophy: Premium direction is the ONLY thing that matters.
   Three forces on every trade: Intrinsic (Δspot), Theta (Δtime), IV (Δvol)
   Score by force alignment, not market direction.
   
   Single continuous loop. σ-based adaptive noise filtering.
   ═══════════════════════════════════════════════════════════════ */

// ═══ CONSTANTS ═══
const C = {
    CAPITAL: 250000,
    MAX_RISK_PCT: 10,
    NF_LOT: 65,
    BNF_LOT: 30,
    NF_MARGIN_EST: 97000,
    BNF_MARGIN_EST: 28000,

    // b91: Broker margin estimates per lot for short options (SPAN approximate)
    // Based on Upstox screenshot: BNF IB W:1000 = ₹1,50,738 margin
    BNF_SHORT_MARGIN: 75000,   // ~₹75K per BNF ATM short option lot
    NF_SHORT_MARGIN: 50000,    // ~₹50K per NF ATM short option lot

    // Width options for candidate generation
    NF_WIDTHS: [100, 150, 200, 250, 300, 400],
    BNF_WIDTHS: [200, 300, 400, 500, 600, 800, 1000],

    NF_MARGIN_THRESHOLD: 0.7,

    // Polling intervals
    POLL_INTERVAL_MS: 5 * 60 * 1000,
    ROUTINE_NOTIFY_MS: 30 * 60 * 1000,

    // σ thresholds
    SIGMA_ENTRY_THRESHOLD: 1.5,
    SIGMA_EXIT_THRESHOLD: 1.0,
    SIGMA_IMPORTANT_THRESHOLD: 2.0,

    // Time gates
    NOISE_WINDOW: 15,
    SWEET_SPOT_START: 135,
    SWEET_SPOT_END: 315,
    LAST_ENTRY_CUTOFF: 345,

    FORCE_LABELS: { 1: '✅', 0: '⚠️', '-1': '❌' },

    // IV regime thresholds
    IV_LOW: 15,
    IV_NORMAL_LOW: 16,
    IV_NORMAL_HIGH: 19,
    IV_HIGH: 20,
    IV_VERY_HIGH: 24,

    // Filters
    MIN_PROB: 0.50,          // allow 50%+ through, ranking by EV picks sweet spot
    MIN_CREDIT_RATIO: 0.10,  // credit/width must be ≥10%

    // Strike selection — from calibration v1 (25 trades) + backtest v2 (8372 trades, 552 days)
    // Calibration: ATM sells (<0.2σ) lose on reversals. OTM sells (>0.5σ) win.
    // Backtest Table 5: 0.5-0.8σ = 66-84% win. CLIFF at 0.8σ → drops to 52%.
    // IB exempt — ATM correct for IB (profits from vol crush, not direction).
    MIN_SIGMA_OTM: 0.5,          // credit sells must be ≥0.5σ from ATM
    MAX_SIGMA_OTM: 0.8,          // credit sells should be ≤0.8σ — beyond this, credit too thin
    MIN_WIDTH_BNF: 400,           // BNF minimum width (narrow = stop loss hunting)
    MIN_WIDTH_NF: 150,            // NF minimum width

    // Realistic slippage — from Upstox cross-verification (Apr 2 2026)
    // Paper P&L overstates by 40-60% on 4-leg trades due to sequential execution
    SLIPPAGE: {
        NF_2LEG: 1.0,    // ₹1.0 per unit per leg — NF has tighter spreads
        NF_4LEG: 2.0,    // ₹2.0 per unit per leg — more time to leg in
        BNF_2LEG: 2.0,   // ₹2.0 per unit per leg — BNF wider spreads
        BNF_4LEG: 4.0    // ₹4.0 per unit per leg — maximum slippage
    },

    // Transaction costs (effective Apr 1, 2026 — Budget 2026 STT hike)
    STT_OPTIONS: 0.0015,     // 0.15% on options sell side
    STT_FUTURES: 0.0005,     // 0.05% on futures sell side
    BROKERAGE_PER_ORDER: 20, // ₹20 flat per order (Zerodha)
    EXCHANGE_PER_LEG: 15,    // ~₹15 exchange charges per leg
    GST_RATE: 0.18,          // 18% GST on brokerage + exchange
    SLIPPAGE_PER_UNIT: 1.5,  // ₹1.5 per unit per leg (conservative bid-ask spread estimate)
    MIN_PROFIT_COST_PCT: 8,  // block trades where cost > 8% of max profit (raised from 5% — 5% was blocking valid trades)

    // Strategy categories
    CREDIT_TYPES: ['BEAR_CALL', 'BULL_PUT', 'IRON_CONDOR', 'IRON_BUTTERFLY'],
    DEBIT_TYPES: ['BEAR_PUT', 'BULL_CALL', 'DOUBLE_DEBIT'],
    NEUTRAL_TYPES: ['IRON_CONDOR', 'IRON_BUTTERFLY', 'DOUBLE_DEBIT'],
    DIRECTIONAL_BULL: ['BULL_CALL', 'BULL_PUT'],
    DIRECTIONAL_BEAR: ['BEAR_CALL', 'BEAR_PUT'],

    // Global direction thresholds (CALIBRATION PENDING — refine after 20+ observations)
    DOW_THRESHOLD: 0.5,     // % change to count as signal (derived: Dow -1.5% → NF -500pts, halved)
    CRUDE_THRESHOLD: 1.5,   // % change to count as signal (crude avg daily range ~1-2%)
    GIFT_THRESHOLD: 0.3     // % change to count as GIFT signal (direct NF correlation, ~75pts)
};

// ═══ CALIBRATION DATA — paper trades (25) + backtest (8372 trades, 552 days, Apr 2026) ═══
const CALIBRATION = {
    // Win rates per strategy type — paper trades + [backtest range across 3 dampening presets]
    win_rates: {
        IRON_BUTTERFLY: { wins: 6, total: 6, rate: 1.00, avg_pnl: 10787, verdict: '🔥',
                          bt_range: '34-48%', bt_note: 'dampening-sensitive, intraday only' },
        IRON_CONDOR:    { wins: 4, total: 4, rate: 1.00, avg_pnl: 3500,  verdict: '✅',
                          bt_range: '38-49%', bt_note: 'dampening-sensitive, intraday only' },
        BEAR_CALL:      { wins: 7, total: 9, rate: 0.78, avg_pnl: 1683,  verdict: '⚠️',
                          bt_range: '45-77%', bt_note: 'OTM 0.5-0.8σ sweet spot' },
        BULL_PUT:       { wins: 0, total: 6, rate: 0.00, avg_pnl: -1414, verdict: '❌',
                          bt_range: '46-74%', bt_note: '0/6 was ATM narrow, OTM works' },
        BEAR_PUT:       { wins: 0, total: 0, rate: null, avg_pnl: null,  verdict: '?',
                          bt_range: '54-68%', bt_note: 'ROBUST — swing 54% after DOWN' },
        BULL_CALL:      { wins: 0, total: 0, rate: null, avg_pnl: null,  verdict: '?',
                          bt_range: '64-72%', bt_note: 'MOST ROBUST — swing 60% after UP' }
    },
    // Directional vs non-directional
    directional:     { wins: 7,  total: 15, rate: 0.47, avg_pnl: 356 },
    non_directional: { wins: 10, total: 10, rate: 1.00, avg_pnl: 7872 },
    // Bias outcomes
    bias_rates: {
        'STRONG BEAR': { wins: 7, total: 7, rate: 1.00 },
        'MILD BULL':   { wins: 8, total: 10, rate: 0.80 },
        'MILD BEAR':   { wins: 2, total: 4, rate: 0.50 },
        'STRONG BULL': { wins: 0, total: 4, rate: 0.00 }
    },
    // Cost impact
    avg_cost_pct: 21.4,  // costs eat 21.4% of paper P&L
    // Meta
    last_updated: '2026-04-02',
    total_trades: 25,
    note: 'Update after every 10 new closed trades via radar_analysis.py'
};

// ═══ PYODIDE BRAIN — Full Copilot Engine in WebAssembly ═══
// Pure Python (json + math), no pandas/numpy. Runs every 5-min poll on S23 Ultra.
// Output: { market, positions, candidates, timing, risk } — rendered across ALL tabs.
const BRAIN_PYTHON = `
import json, math

# ─── UTILITIES ───

def lsq_slope(values):
    n = len(values)
    if n < 2: return 0.0
    xm = (n - 1) / 2.0
    ym = sum(values) / n
    num = sum((i - xm) * (v - ym) for i, v in enumerate(values))
    den = sum((i - xm) ** 2 for i in range(n))
    return num / den if den != 0 else 0.0

def pct_change(old, new):
    if not old or old == 0 or new is None: return 0.0
    return (new - old) / abs(old) * 100

def last_n(polls, n=6):
    return polls[-n:] if len(polls) >= n else polls

def get_time_mins(t_str):
    try:
        parts = t_str.split(':')
        return int(parts[0]) * 60 + int(parts[1])
    except: return 0

# ─── SHARED REGIME DETECTOR ───

# ═══ b93: DYNAMIC THRESHOLD INFRASTRUCTURE ═══
# Z-scores replace ALL hardcoded thresholds. (value - mean) / stddev
# If stddev is 0 (constant data), returns 0. Needs minimum 10 samples.

def arr_mean(arr):
    return sum(arr) / len(arr) if arr else 0

def arr_std(arr):
    if len(arr) < 2: return 0
    m = arr_mean(arr)
    variance = sum((x - m) ** 2 for x in arr) / len(arr)
    return math.sqrt(variance) if variance > 0 else 0

def z_score(val, arr):
    """How many standard deviations is val from the mean of arr?"""
    if len(arr) < 10 or val is None: return 0
    m = arr_mean(arr)
    s = arr_std(arr)
    return (val - m) / s if s > 0 else 0

def straddle_velocity(polls, n=4):
    """Is ATM straddle premium expanding or contracting?
    Returns: (current_straddle, z_score_of_change, is_expanding)"""
    straddles = [p.get('straddle') for p in last_n(polls, n) if p.get('straddle')]
    if len(straddles) < 3: return 0, 0, False
    changes = [straddles[i] - straddles[i-1] for i in range(1, len(straddles))]
    avg_change = arr_mean(changes)
    # Expanding = straddle growing while spot may be flat
    return straddles[-1], avg_change, avg_change > 0

def theta_friction_minutes(est_cost, net_theta):
    """How many minutes of theta decay to pay for entry/exit friction?
    Returns minutes. >60 = trade is mathematically dead."""
    if not net_theta or net_theta <= 0 or not est_cost or est_cost <= 0:
        return 999
    theta_per_min = (net_theta * 0.65) / 375  # Gemini fix: only ~65% of daily theta decays during market hours
    return est_cost / theta_per_min if theta_per_min > 0 else 999

def detect_regime(polls, baseline):
    """Returns dict: {type: range|trend|choppy, sigma, direction, trend_pct}"""
    recent = last_n(polls, 6)
    bnfs = [p.get('bnf') for p in recent if p.get('bnf')]
    if len(bnfs) < 3:
        return {"type": "unknown", "sigma": 0, "direction": 0, "trend_pct": 0}
    hi, lo = max(bnfs), min(bnfs)
    rng = hi - lo
    base_vix = baseline.get('vix', 15)
    base_spot = baseline.get('bnfSpot', bnfs[0])
    daily_sigma = base_spot * (base_vix / 100) / math.sqrt(252) if base_spot > 0 else 300
    range_sigma = rng / daily_sigma if daily_sigma > 0 else 0
    direction_votes = 0
    for i in range(1, len(bnfs)):
        if bnfs[i] > bnfs[i-1]: direction_votes += 1
        elif bnfs[i] < bnfs[i-1]: direction_votes -= 1
    trend_pct = abs(direction_votes) / (len(bnfs) - 1) if len(bnfs) > 1 else 0
    if range_sigma < 0.25 and trend_pct < 0.6:
        rtype = "range"
    elif range_sigma > 0.6 and trend_pct > 0.6:
        rtype = "trend"
    elif range_sigma > 0.8:
        rtype = "choppy"
    else:
        rtype = "mild_trend"
    return {"type": rtype, "sigma": range_sigma, "direction": direction_votes, "trend_pct": trend_pct}

def get_pcr_slope(polls):
    pcrs = [p.get('pcr') for p in last_n(polls, 6) if p.get('pcr')]
    if len(pcrs) < 3: return 0, 0
    return lsq_slope(pcrs), pcrs[-1] - pcrs[0]

def get_vix_vals(polls):
    return [p.get('vix') for p in last_n(polls, 6) if p.get('vix')]

# ═══════════════════════════════════════════
# PART 1: MARKET ANALYSES (shown in Market tab)
# ═══════════════════════════════════════════

def pcr_velocity(polls, baseline):
    window = last_n(polls, 6)
    pcrs = [p.get('pcr') for p in window if p.get('pcr') is not None and p.get('pcr') > 0]
    if len(pcrs) < 3: return None
    total_change = pcrs[-1] - pcrs[0]
    if abs(total_change) < 0.08: return None
    mins = len(pcrs) * 5
    if total_change > 0.25:
        return {"type": "pcr", "icon": "📈", "label": "PCR surging",
                "detail": f"{pcrs[0]:.2f} → {pcrs[-1]:.2f} in {mins}min. Puts building — institutional hedging.",
                "impact": "bullish", "strength": min(5, int(abs(total_change) * 12))}
    elif total_change < -0.25:
        return {"type": "pcr", "icon": "📉", "label": "PCR collapsing",
                "detail": f"{pcrs[0]:.2f} → {pcrs[-1]:.2f} in {mins}min. Puts unwinding or calls loading.",
                "impact": "bearish", "strength": min(5, int(abs(total_change) * 12))}
    else:
        d = "rising" if total_change > 0 else "falling"
        imp = "bullish" if total_change > 0 else "bearish"
        return {"type": "pcr", "icon": "🔄", "label": f"PCR {d}",
                "detail": f"{pcrs[0]:.2f} → {pcrs[-1]:.2f} ({mins}min). Gradual shift.",
                "impact": imp, "strength": 2}

def oi_wall_shift(polls, baseline):
    if len(polls) < 3: return None
    first, last = polls[max(0, len(polls)-6)], polls[-1]
    cw0, cw1 = first.get('cw'), last.get('cw')
    pw0, pw1 = first.get('pw'), last.get('pw')
    if cw0 and cw1 and cw0 != cw1:
        moved = cw1 - cw0
        d = "UP" if moved > 0 else "DOWN"
        return {"type": "oi_wall", "icon": "🧱", "label": f"Call wall shifted {d}",
                "detail": f"BNF call wall {cw0} → {cw1} ({'+' if moved > 0 else ''}{moved}). {'Resistance rising.' if moved > 0 else 'Sellers tightening.'}",
                "impact": "bullish" if moved > 0 else "bearish", "strength": 3}
    if pw0 and pw1 and pw0 != pw1:
        moved = pw1 - pw0
        d = "UP" if moved > 0 else "DOWN"
        return {"type": "oi_wall", "icon": "🧱", "label": f"Put wall shifted {d}",
                "detail": f"BNF put wall {pw0} → {pw1} ({'+' if moved > 0 else ''}{moved}). {'Support rising.' if moved > 0 else 'Support crumbling.'}",
                "impact": "bullish" if moved > 0 else "bearish", "strength": 3}
    cwOI0, cwOI1 = first.get('cwOI'), last.get('cwOI')
    if cwOI0 and cwOI1 and cw0 == cw1 and cwOI0 > 0:
        chg = pct_change(cwOI0, cwOI1)
        if abs(chg) > 15:
            return {"type": "oi_wall", "icon": "🏗️" if chg > 0 else "💨",
                    "label": f"Call wall {'strengthening' if chg > 0 else 'weakening'}",
                    "detail": f"OI at {cw1}: {'+' if chg > 0 else ''}{chg:.0f}%. {'Resistance hardening.' if chg > 0 else 'Breakout possible.'}",
                    "impact": "bearish" if chg > 0 else "bullish", "strength": 3 if abs(chg) > 20 else 2}
    return None

def vix_momentum(polls, baseline):
    vixs = get_vix_vals(polls)
    if len(vixs) < 3: return None
    total = vixs[-1] - vixs[0]
    if abs(total) < 0.3: return None
    curr = vixs[-1]
    if curr >= 24 and total < -0.5:
        return {"type": "vix", "icon": "🌊", "label": "VIX mean-reverting DOWN",
                "detail": f"VIX {vixs[0]:.1f} → {curr:.1f}. Extreme vol unwinding — credit shrinking, debit cheaper.",
                "impact": "neutral", "strength": 3}
    elif curr < 16 and total > 0.3:
        return {"type": "vix", "icon": "⚡", "label": "VIX waking up",
                "detail": f"VIX {vixs[0]:.1f} → {curr:.1f}. Vol expanding — premiums inflating.",
                "impact": "neutral", "strength": 2}
    elif total > 0.5:
        return {"type": "vix", "icon": "🔺", "label": "VIX climbing",
                "detail": f"VIX {vixs[0]:.1f} → {curr:.1f} (+{total:.1f}). Fear rising.",
                "impact": "caution", "strength": min(4, int(abs(total) * 2))}
    elif total < -0.5:
        return {"type": "vix", "icon": "🔻", "label": "VIX falling",
                "detail": f"VIX {vixs[0]:.1f} → {curr:.1f} ({total:.1f}). Vol crush — credit positions profit.",
                "impact": "bullish", "strength": min(4, int(abs(total) * 2))}
    return None

def spot_exhaustion(polls, baseline):
    if len(polls) < 6: return None
    recent = polls[-8:] if len(polls) >= 8 else polls
    mid = len(recent) // 2
    def avg_abs_move(seg, key='bnf'):
        moves = []
        for i in range(1, len(seg)):
            v0, v1 = seg[i-1].get(key), seg[i].get(key)
            if v0 and v1: moves.append(abs(v1 - v0))
        return sum(moves) / len(moves) if moves else 0
    m1 = avg_abs_move(recent[:mid])
    m2 = avg_abs_move(recent[mid:])
    if m1 < 30: return None
    ratio = m2 / m1 if m1 > 0 else 1
    if ratio < 0.4:
        return {"type": "exhaustion", "icon": "😤", "label": "Momentum exhausting",
                "detail": f"BNF avg move {m1:.0f} → {m2:.0f} pts/poll. Range-bound ahead?",
                "impact": "neutral", "strength": 3}
    elif ratio > 2.0 and m2 > 50:
        return {"type": "exhaustion", "icon": "🚀", "label": "Momentum accelerating",
                "detail": f"BNF avg move {m1:.0f} → {m2:.0f} pts/poll. Breakout underway.",
                "impact": "caution", "strength": 4}
    return None

def regime_detector(polls, baseline):
    r = detect_regime(polls, baseline)
    if r["type"] == "range":
        return {"type": "regime", "icon": "📦", "label": f"Range-bound ({r['sigma']:.2f}σ)",
                "detail": f"IB/IC candidates favored. Vol crush likely.",
                "impact": "neutral", "strength": 3}
    elif r["type"] == "trend":
        d = "bullish" if r["direction"] > 0 else "bearish"
        arrow = "↗" if r["direction"] > 0 else "↘"
        strat = "Bull Call" if d == "bullish" else "Bear Put"
        return {"type": "regime", "icon": arrow, "label": f"Trending {d} ({r['sigma']:.2f}σ)",
                "detail": f"Directional: {strat} favored.",
                "impact": d, "strength": min(5, int(r['sigma'] * 4))}
    elif r["type"] == "choppy":
        return {"type": "regime", "icon": "⚡", "label": f"Choppy ({r['sigma']:.2f}σ)",
                "detail": f"No clear direction. Widen stops or wait.",
                "impact": "caution", "strength": 4}
    return None

def futures_premium_trend(polls, baseline):
    fps = [p.get('fp') for p in last_n(polls, 6) if p.get('fp') is not None]
    if len(fps) < 3: return None
    total = fps[-1] - fps[0]
    if abs(total) < 0.02: return None
    if total > 0.03:
        return {"type": "futures", "icon": "📊", "label": "Futures premium widening",
                "detail": f"{fps[0]:.3f} → {fps[-1]:.3f}. Longs building — bullish.",
                "impact": "bullish", "strength": 2}
    elif total < -0.03:
        return {"type": "futures", "icon": "📊", "label": "Futures premium narrowing",
                "detail": f"{fps[0]:.3f} → {fps[-1]:.3f}. Longs exiting — bearish.",
                "impact": "bearish", "strength": 2}
    return None

def oi_velocity(polls, baseline):
    if len(polls) < 4: return None
    first, last = polls[max(0, len(polls)-6)], polls[-1]
    t0 = (first.get('bnfCOI', 0) or 0) + (first.get('bnfPOI', 0) or 0)
    t1 = (last.get('bnfCOI', 0) or 0) + (last.get('bnfPOI', 0) or 0)
    if t0 == 0: return None
    chg = pct_change(t0, t1)
    if abs(chg) < 5: return None
    if chg > 10:
        return {"type": "oi_vel", "icon": "🏗️", "label": "OI building fast",
                "detail": f"Total BNF OI +{chg:.0f}%. Expect vol expansion.",
                "impact": "caution", "strength": 3}
    elif chg < -10:
        return {"type": "oi_vel", "icon": "🏚️", "label": "OI unwinding",
                "detail": f"Total BNF OI {chg:.0f}%. Vol crush likely — credit profits.",
                "impact": "bullish", "strength": 3}
    elif abs(chg) >= 5:
        d = "expanding" if chg > 0 else "contracting"
        return {"type": "oi_vel", "icon": "📈" if chg > 0 else "📉", "label": f"OI {d}",
                "detail": f"BNF OI {'+' if chg > 0 else ''}{chg:.0f}%.",
                "impact": "neutral", "strength": 1}
    return None

def institutional_clock(polls, baseline):
    if len(polls) < 2: return None
    last_t = polls[-1].get('t', '')
    mins = get_time_mins(last_t)
    if mins < 825 or mins > 915: return None  # 13:45 to 15:15
    post_2pm = [p for p in polls if get_time_mins(p.get('t', '')) >= 825]
    if len(post_2pm) < 2: return None
    pcr_s, pcr_e = post_2pm[0].get('pcr'), post_2pm[-1].get('pcr')
    if pcr_s and pcr_e and abs(pcr_e - pcr_s) > 0.1:
        d = "bullish" if pcr_e > pcr_s else "bearish"
        return {"type": "inst_clock", "icon": "🏛️", "label": f"Institutional {d} shift",
                "detail": f"2PM→now PCR {pcr_s:.2f} → {pcr_e:.2f}. Tomorrow's intent revealed.",
                "impact": d, "strength": 4}
    cw_s, cw_e = post_2pm[0].get('cw'), post_2pm[-1].get('cw')
    if cw_s and cw_e and cw_s != cw_e:
        d = "bullish" if cw_e > cw_s else "bearish"
        return {"type": "inst_clock", "icon": "🏛️", "label": "Late-day call wall move",
                "detail": f"Call wall {cw_s} → {cw_e} after 2PM.",
                "impact": d, "strength": 3}
    return None

# ═══════════════════════════════════════════
# PART 2: POSITION ANALYSES (shown on each trade card)
# ═══════════════════════════════════════════

def position_wall_proximity(trade, polls, baseline, regime, strike_oi):
    """b96: Is sell strike near a wall? Checks correct wall for each strategy type.
    Bear Call: sell CE vs call wall. Bull Put: sell PE vs put wall.
    IC: sell CE vs call wall AND sell PE (sell_strike2) vs put wall."""
    sell = trade.get('sell_strike', 0)
    sell2 = trade.get('sell_strike2', 0)  # PE sell for IC
    idx = trade.get('index_key', 'BNF')
    stype = trade.get('strategy_type', '')
    last = polls[-1] if polls else {}
    cw = last.get('cw' if idx == 'BNF' else 'nfCW')
    pw = last.get('pw' if idx == 'BNF' else 'nfPW')
    is_bear = 'BEAR' in stype
    is_ic = stype in ('IRON_CONDOR', 'IRON_BUTTERFLY')
    is_bull = 'BULL' in stype
    
    # IC/IB: check BOTH sides
    if is_ic:
        insights = []
        # CE side: call wall should be ABOVE sell CE
        if cw and sell:
            dist = cw - sell
            if dist < 0:
                insights.append(f"CE sell {sell} above call wall {cw}")
            elif 0 <= dist <= 200:
                insights.append(None)  # protected, mark as OK
        # PE side: put wall should be ABOVE sell PE (between spot and sell)
        if pw and sell2:
            dist2 = pw - sell2  # positive = wall above sell PE = protected
            if dist2 < 0:
                insights.append(f"PE sell {sell2} below put wall {pw}")
            elif 0 <= dist2 <= 200:
                insights.append(None)  # protected
        exposed = [i for i in insights if i is not None]
        if len(exposed) == 2:
            return {"icon": "🚨", "label": "Past the wall",
                    "detail": f"{exposed[0]}. {exposed[1]}. Both sides exposed.",
                    "impact": "caution", "strength": 5}
        if len(exposed) == 1:
            return {"icon": "⚠️", "label": "Past the wall",
                    "detail": f"{exposed[0]}. One side unprotected.",
                    "impact": "caution", "strength": 4}
        if len(insights) >= 2 and all(i is None for i in insights):
            return {"icon": "🛡️", "label": "Wall-protected",
                    "detail": f"CE: wall {cw} above sell. PE: wall {pw} above sell.",
                    "impact": "bullish", "strength": 4}
        return None
    
    # Bear Call: call wall should be ABOVE sell CE
    if is_bear and cw:
        dist = cw - sell
        if dist < 0:
            return {"icon": "⚠️", "label": "Past the wall",
                    "detail": f"Sell {sell} is ABOVE call wall {cw}. No OI protection.",
                    "impact": "caution", "strength": 4}
        if 0 <= dist <= 200:
            return {"icon": "🛡️", "label": "Wall-protected",
                    "detail": f"Call wall {cw} {'AT' if dist == 0 else f'{dist}pts above'} sell {sell}.",
                    "impact": "bullish", "strength": 4 if dist == 0 else 3}
    
    # Bull Put: put wall should be ABOVE sell PE (between spot and sell)
    if is_bull and pw:
        dist = pw - sell  # positive = wall above sell = protected
        if dist < 0:
            return {"icon": "⚠️", "label": "Past the wall",
                    "detail": f"Sell {sell} is BELOW put wall {pw}. No OI support above sell.",
                    "impact": "caution", "strength": 4}
        if 0 <= dist <= 200:
            return {"icon": "🛡️", "label": "Wall-protected",
                    "detail": f"Put wall {pw} {'AT' if dist == 0 else f'{dist}pts above'} sell {sell}.",
                    "impact": "bullish", "strength": 4 if dist == 0 else 3}
    
    # OI trend at sell strike
    if len(strike_oi) >= 3:
        oi_field = 'sellCOI' if is_bear else 'sellPOI'
        ois = [s.get(oi_field) for s in strike_oi if s.get(oi_field) is not None]
        if len(ois) >= 3 and ois[0] > 0:
            chg = pct_change(ois[0], ois[-1])
            if chg < -15:
                return {"icon": "💨", "label": "OI at sell strike fading",
                        "detail": f"OI at {sell}: {chg:.0f}%. Protection weakening.",
                        "impact": "caution", "strength": 3}
            elif chg > 15:
                return {"icon": "🏗️", "label": "OI at sell strike building",
                        "detail": f"OI at {sell}: +{chg:.0f}%. Protection strengthening.",
                        "impact": "bullish", "strength": 2}
    return None

def position_momentum_threat(trade, polls, baseline, regime, strike_oi):
    """Is spot accelerating toward OR already past the sell strike?"""
    sell = trade.get('sell_strike', 0)
    idx = trade.get('index_key', 'BNF')
    spot_key = 'bnf' if idx == 'BNF' else 'nf'
    is_bear = 'BEAR' in trade.get('strategy_type', '')
    recent = last_n(polls, 4)
    spots = [p.get(spot_key) for p in recent if p.get(spot_key)]
    if len(spots) < 3: return None
    curr = spots[-1]
    cushion = (sell - curr) if is_bear else (curr - sell)  # positive = safe
    # b96: BREACH — spot already at or past sell strike
    if cushion <= 0:
        breach = abs(cushion)
        return {"icon": "🚨", "label": f"Spot PAST sell strike by {breach:.0f}pts",
                "detail": f"Spot {curr:.0f} {'above' if is_bear else 'below'} sell {sell}. Position in maximum danger.",
                "impact": "caution", "strength": 5}
    # Velocity toward sell strike
    if is_bear:
        velocity = spots[-1] - spots[-2] if len(spots) >= 2 else 0
    else:
        velocity = spots[-2] - spots[-1] if len(spots) >= 2 else 0
    # velocity > 0 means approaching sell
    if velocity > 0 and cushion < 300:
        polls_to_hit = cushion / velocity if velocity > 0 else 999
        if polls_to_hit <= 3:
            return {"icon": "🚨", "label": f"Sell strike in {polls_to_hit:.0f} polls",
                    "detail": f"Spot {curr:.0f} → sell {sell}. {cushion:.0f}pts at {velocity:.0f}pts/poll.",
                    "impact": "caution", "strength": 5}
        elif polls_to_hit <= 6:
            return {"icon": "⚡", "label": "Spot approaching sell",
                    "detail": f"{cushion:.0f}pts cushion, moving {velocity:.0f}pts/poll.",
                    "impact": "caution", "strength": 3}
    return None

def position_regime_fit(trade, polls, baseline, regime, strike_oi):
    """Does current regime match the trade's strategy type?"""
    stype = trade.get('strategy_type', '')
    rtype = regime.get('type', 'unknown')
    is_4leg = stype in ('IRON_CONDOR', 'IRON_BUTTERFLY')
    is_directional = stype in ('BEAR_CALL', 'BULL_PUT', 'BEAR_PUT', 'BULL_CALL')
    if is_4leg and rtype == 'trend':
        d = "up" if regime["direction"] > 0 else "down"
        return {"icon": "⚠️", "label": "4-leg in trending market",
                "detail": f"Market trending {d} ({regime['sigma']:.2f}σ). One leg under pressure.",
                "impact": "caution", "strength": 3}
    if is_directional and rtype == 'range':
        return {"icon": "📦", "label": "Directional in range",
                "detail": f"Market range-bound ({regime['sigma']:.2f}σ). Theta helps but no directional edge.",
                "impact": "neutral", "strength": 2}
    if is_directional and rtype == 'trend':
        is_bear = 'BEAR' in stype
        trend_dir = regime["direction"]
        # Only flag trend conflict when direction is definitive (not neutral/zero)
        if abs(trend_dir) < 0.01:
            return None
        trend_bull = trend_dir > 0
        if (is_bear and trend_bull) or (not is_bear and not trend_bull):
            return {"icon": "🔴", "label": "Against the trend",
                    "detail": f"Your {'bearish' if is_bear else 'bullish'} trade vs {'bullish' if trend_bull else 'bearish'} trend.",
                    "impact": "caution", "strength": 4}
        else:
            return {"icon": "🟢", "label": "With the trend",
                    "detail": f"Trend confirming your position.",
                    "impact": "bullish", "strength": 2}
    return None

def position_vix_headwind(trade, polls, baseline, regime, strike_oi):
    """Did VIX regime shift unfavorably since entry?"""
    vixs = get_vix_vals(polls)
    if len(vixs) < 2: return None
    curr_vix = vixs[-1]
    entry_vix = trade.get('entry_vix')
    stype = trade.get('strategy_type', '')
    is_credit = stype in ('BEAR_CALL', 'BULL_PUT', 'IRON_CONDOR', 'IRON_BUTTERFLY')
    # Credit trade entered below 24, VIX now above 24
    if is_credit and entry_vix and entry_vix < 24 and curr_vix >= 24:
        return {"icon": "🔥", "label": "VIX crossed VERY_HIGH since entry",
                "detail": f"Entry VIX {entry_vix:.1f} → now {curr_vix:.1f}. Backtest: debit > credit at VIX≥24.",
                "impact": "caution", "strength": 4}
    # Debit trade entered above 24, VIX now below 20
    if not is_credit and entry_vix and entry_vix >= 24 and curr_vix < 20:
        return {"icon": "💨", "label": "Vol crushed since entry",
                "detail": f"Entry VIX {entry_vix:.1f} → now {curr_vix:.1f}. Premium evaporating.",
                "impact": "caution", "strength": 3}
    return None

def position_book_signal(trade, polls, baseline, regime, strike_oi):
    """Combine P&L + CI + brain factors → book / hold / exit."""
    pnl = trade.get('current_pnl', 0)
    max_p = trade.get('max_profit', 1)
    ci = trade.get('controlIndex')
    pnl_pct = pnl / max_p if max_p > 0 else 0
    _, pcr_chg = get_pcr_slope(polls)
    is_credit = trade.get('is_credit', True)
    # Strong book signal: > 50% profit + positive CI + exhausting momentum
    if pnl_pct >= 0.5 and (ci is None or ci > 0):
        # Check if momentum is fading
        rtype = regime.get('type', '')
        if rtype == 'range' or rtype == 'mild_trend':
            return {"icon": "💰", "label": f"BOOK — {pnl_pct*100:.0f}% profit in range",
                    "detail": f"P&L ₹{pnl:.0f} ({pnl_pct*100:.0f}%). Range = theta in your favor. Lock it in.",
                    "impact": "bullish", "strength": 4}
    # Hold signal: good P&L + strong trend in your favor
    if pnl_pct >= 0.3 and pnl_pct < 0.5 and ci and ci > 20:
        return {"icon": "🔒", "label": "Hold — trend + control",
                "detail": f"P&L ₹{pnl:.0f} ({pnl_pct*100:.0f}%). CI {ci}. Let it run.",
                "impact": "bullish", "strength": 2}
    # Danger: losing + against trend
    if pnl < 0 and regime.get('type') == 'trend':
        is_bear = 'BEAR' in trade.get('strategy_type', '')
        trend_bull = regime["direction"] > 0
        if (is_bear and trend_bull) or (not is_bear and not trend_bull):
            max_l = trade.get('max_loss', 1)
            loss_pct = abs(pnl) / max_l if max_l > 0 else 0
            if loss_pct > 0.3:
                return {"icon": "🛑", "label": f"EXIT — against trend, {loss_pct*100:.0f}% of max loss",
                        "detail": f"P&L ₹{pnl:.0f}. Trend working against you.",
                        "impact": "caution", "strength": 5}
    return None

# ═══════════════════════════════════════════
# PART 3: CANDIDATE ANALYSES (shown on each candidate card)
# ═══════════════════════════════════════════

def candidate_flow_alignment(cand, polls, baseline, regime):
    """Does PCR velocity support this candidate's direction?"""
    _, pcr_chg = get_pcr_slope(polls)
    if abs(pcr_chg) < 0.08: return None
    ctype = cand.get('type', '')
    is_bear = 'BEAR' in ctype
    pcr_bull = pcr_chg > 0  # rising PCR = puts building = contrarian bullish
    if is_bear and pcr_bull and pcr_chg > 0.15:
        return {"icon": "⚠️", "label": "Against institutional flow",
                "detail": f"PCR rising ({pcr_chg:+.2f}) = bullish flow vs your bearish trade.",
                "impact": "caution", "strength": 3}
    elif not is_bear and not pcr_bull and pcr_chg < -0.15:
        return {"icon": "⚠️", "label": "Against institutional flow",
                "detail": f"PCR falling ({pcr_chg:+.2f}) = bearish flow vs your bullish trade.",
                "impact": "caution", "strength": 3}
    elif (is_bear and not pcr_bull) or (not is_bear and pcr_bull):
        return {"icon": "✅", "label": "Flow-aligned",
                "detail": f"PCR {'rising' if pcr_bull else 'falling'} confirms {'bullish' if pcr_bull else 'bearish'} flow.",
                "impact": "bullish", "strength": 2}
    return None

def candidate_wall_protection(cand, polls, baseline, regime):
    """b92: Full wall protection check — both sides for IC/IB, exposed detection."""
    sell = cand.get('sellStrike', 0)
    sell2 = cand.get('sellStrike2', 0)  # PE side for IC/IB
    idx = cand.get('index', 'BNF')
    ctype = cand.get('type', '')
    is_bear = 'BEAR' in ctype
    is_4leg = ctype in ('IRON_CONDOR', 'IRON_BUTTERFLY')
    last = polls[-1] if polls else {}
    cw = last.get('cw' if idx == 'BNF' else 'nfCW')
    pw = last.get('pw' if idx == 'BNF' else 'nfPW')
    
    # 4-leg: check BOTH sides independently
    if is_4leg and cw and pw:
        ce_exposed = cw < sell if sell else False  # call wall below CE sell = exposed
        pe_exposed = sell2 > pw if sell2 else False  # sell PE above put wall = no support = exposed
        if ce_exposed and pe_exposed:
            return {"icon": "🚨", "label": "BOTH sides exposed",
                    "detail": f"CE sell {sell} above call wall {cw}. PE sell {sell2} above put wall {pw}. No protection.",
                    "impact": "caution", "strength": 5}
        if ce_exposed:
            return {"icon": "⚠️", "label": f"CE side past call wall",
                    "detail": f"Sell CE {sell} > call wall {cw}. Upside unprotected.",
                    "impact": "caution", "strength": 4}
        if pe_exposed:
            return {"icon": "⚠️", "label": f"PE side past put wall",
                    "detail": f"Sell PE {sell2} > put wall {pw}. No support above sell.",
                    "impact": "caution", "strength": 4}
        # Both protected — wall is between spot and sell on each side
        ce_dist = cw - sell if cw and sell else 999
        pe_dist = pw - sell2 if sell2 and pw else 999  # positive = wall above sell PE = protected
        if ce_dist >= 0 and ce_dist <= 300 and pe_dist >= 0 and pe_dist <= 300:
            return {"icon": "🛡️", "label": "Both sides wall-backed",
                    "detail": f"CE: wall {cw} ({ce_dist}pts above). PE: wall {pw} ({pe_dist}pts above sell).",
                    "impact": "bullish", "strength": 4}
        return None
    
    # 2-leg directional: check relevant wall
    if is_bear and cw:
        dist = cw - sell
        if dist < 0:
            return {"icon": "⚠️", "label": f"Sell ABOVE call wall",
                    "detail": f"Sell {sell} > call wall {cw}. No OI ceiling. Today's rally can hit you.",
                    "impact": "caution", "strength": 5}
        if 0 <= dist <= 300:
            return {"icon": "🛡️", "label": f"Wall at {cw} ({dist}pts above)",
                    "detail": f"Call wall OI protects your sell.",
                    "impact": "bullish", "strength": 3}
    elif not is_bear and not is_4leg and pw:
        dist = sell - pw  # positive = sell ABOVE wall = exposed; negative = sell BELOW wall = protected
        if dist > 0:
            return {"icon": "⚠️", "label": f"Sell ABOVE put wall",
                    "detail": f"Sell {sell} > put wall {pw}. No OI floor. Breakdown can hit you.",
                    "impact": "caution", "strength": 5}
        if -300 <= dist < 0:
            return {"icon": "🛡️", "label": f"Wall at {pw} ({abs(dist)}pts above sell)",
                    "detail": f"Put wall OI protects your sell.",
                    "impact": "bullish", "strength": 3}
    return None

def candidate_regime_fit(cand, polls, baseline, regime):
    """Does this strategy fit the current regime?"""
    ctype = cand.get('type', '')
    rtype = regime.get('type', 'unknown')
    is_4leg = ctype in ('IRON_CONDOR', 'IRON_BUTTERFLY')
    is_directional = ctype in ('BEAR_CALL', 'BULL_PUT', 'BEAR_PUT', 'BULL_CALL')
    if is_4leg and rtype == 'range':
        return {"icon": "✅", "label": "Regime fit: range confirmed",
                "detail": f"Range ({regime['sigma']:.2f}σ). 4-leg profits from vol crush.",
                "impact": "bullish", "strength": 3}
    if is_4leg and rtype == 'trend':
        return {"icon": "⚠️", "label": "Regime mismatch: trending",
                "detail": f"Market trending ({regime['sigma']:.2f}σ). 4-leg has a losing side.",
                "impact": "caution", "strength": 3}
    if is_directional and rtype == 'range':
        return {"icon": "📦", "label": "Range — theta helps, direction doesn't",
                "detail": f"Range ({regime['sigma']:.2f}σ). Credit OK for theta. IB/IC may be better.",
                "impact": "neutral", "strength": 2}
    if is_directional and rtype == 'trend':
        is_bear = 'BEAR' in ctype
        trend_bull = regime["direction"] > 0
        if (is_bear and not trend_bull) or (not is_bear and trend_bull):
            return {"icon": "✅", "label": "Trend-aligned entry",
                    "detail": f"Trend confirms your direction.",
                    "impact": "bullish", "strength": 3}
        else:
            return {"icon": "🔴", "label": "Against the trend",
                    "detail": f"Trend is {'up' if trend_bull else 'down'}, your trade is {'bearish' if is_bear else 'bullish'}.",
                    "impact": "caution", "strength": 4}
    return None

def evaluate_candidate_risk(cand, ctx, open_trades, regime):
    """b92: Function #48 — deep per-candidate risk evaluation.
    Returns LIST of insights. Uses enriched candidate data (20+ fields).
    Checks: cost trap, R:R sanity, open trade conflict, width adequacy, force coherence."""
    insights = []
    ctype = cand.get('type', '')
    idx = cand.get('index', 'BNF')
    max_p = cand.get('maxProfit', 0)
    max_l = cand.get('maxLoss', 0)
    est_cost = cand.get('estCost', 0)
    est_cost_pct = cand.get('estCostPct', 0)
    realistic_mp = cand.get('realisticMaxProfit')
    prob = cand.get('probProfit', 0)
    forces = cand.get('forces') or {}
    ctx_score = cand.get('contextScore', 0)
    
    # 1. COST TRAP — est. cost eats too much of realistic profit
    effective_max = realistic_mp if realistic_mp else max_p
    if effective_max > 0 and est_cost > 0:
        cost_ratio = est_cost / effective_max
        if cost_ratio > 0.30:
            net = effective_max - est_cost
            insights.append({"icon": "💸", "label": f"Cost trap ({cost_ratio*100:.0f}% of profit)",
                    "detail": f"Net after cost: ₹{net:.0f}. Risk ₹{max_l:.0f} for ₹{net:.0f}.",
                    "impact": "caution", "strength": 5 if cost_ratio > 0.5 else 4})
    
    # 2. R:R SANITY — maxLoss > 2× maxProfit is dangerous
    if max_p > 0 and max_l > 0:
        rr = max_p / max_l
        if rr < 0.5 and prob < 0.85:
            insights.append({"icon": "⚖️", "label": f"Poor R:R (1:{1/rr:.1f})",
                    "detail": f"Risk ₹{max_l:.0f} to make ₹{max_p:.0f}. Need {1/(rr+0.001):.0f}x wins per loss.",
                    "impact": "caution", "strength": 3})
    
    # 3. OPEN TRADE CONFLICT — already have a struggling position in same type/index?
    for t in (open_trades or []):
        if t.get('index_key') != idx: continue
        if t.get('paper'): continue
        t_type = t.get('strategy_type', '')
        t_pnl = t.get('current_pnl', 0)
        t_ci = t.get('controlIndex')
        # Same strategy type and struggling
        if t_type == ctype and (t_pnl < 0 or (t_ci is not None and t_ci < -20)):
            insights.append({"icon": "🔄", "label": f"Open {t_type} struggling",
                    "detail": f"Existing {idx} {t_type} at P&L ₹{t_pnl:.0f}, CI {t_ci}. Don't double down.",
                    "impact": "caution", "strength": 4})
            break
        # Any open real trade in same index (overexposure)
        if not t.get('paper') and t.get('index_key') == idx:
            insights.append({"icon": "📋", "label": f"Already in {idx}",
                    "detail": f"Open {t_type} in {idx}. Adding = double exposure.",
                    "impact": "neutral", "strength": 2})
            break
    
    # 4. FORCE COHERENCE — forces say one thing, context says another
    aligned = forces.get('aligned', 0)
    if aligned >= 3 and ctx_score < -0.3:
        insights.append({"icon": "⚠️", "label": "Forces aligned but context negative",
                "detail": f"3/3 forces but contextScore {ctx_score:.2f}. Gap/VIX conflict?",
                "impact": "caution", "strength": 3})
    
    # 5. WIDTH ADEQUACY — narrow widths at high VIX = stop loss hunting
    width = cand.get('width', 0)
    profile = ctx.get('bnfProfile' if idx == 'BNF' else 'nfProfile') or {}
    if width and width > 0:
        min_w = 400 if idx == 'BNF' else 200
        if cand.get('isCredit') and width < min_w:
            insights.append({"icon": "📏", "label": f"Narrow width ({width})",
                    "detail": f"Width {width} < recommended {min_w}. Stop-loss hunting risk.",
                    "impact": "caution", "strength": 2})
    
    # 6. THETA-TO-FRICTION — b93: how long to break even on costs?
    net_theta = cand.get('netTheta', 0)
    if not net_theta or net_theta <= 0:
        net_theta = max_p * 0.01  # fallback rough estimate only if no real theta
    be_mins = theta_friction_minutes(est_cost, net_theta)
    if be_mins > 120 and cand.get('isCredit'):
        insights.append({"icon": "⏳", "label": f"Slow payback ({be_mins:.0f}min to break even)",
                "detail": f"Cost ₹{est_cost:.0f} takes {be_mins:.0f}min of theta to recover. Trade may be dead.",
                "impact": "caution", "strength": 4 if be_mins > 180 else 3})
    
    return insights

# ═══════════════════════════════════════════
# PART 4: TIMING (shown in Market + Trade tabs)
# ═══════════════════════════════════════════

def timing_entry_window(polls, baseline, regime):
    """Is the sweet spot window open?"""
    if not polls: return None
    mins = get_time_mins(polls[-1].get('t', ''))
    if mins == 0: return None
    # Convert to minutes since 9:15
    market_mins = mins - 555
    if 135 <= market_mins <= 315:  # 11:30 to 14:30
        return {"type": "timing", "icon": "🟢", "label": "Sweet spot window OPEN",
                "detail": f"11:30–14:30 zone. Best entries. Noise settled, thesis clear.",
                "impact": "bullish", "strength": 2}
    elif market_mins < 15:
        return {"type": "timing", "icon": "🔇", "label": "Opening noise — wait",
                "detail": f"First 15min. Gap-driven volatility. Don't enter.",
                "impact": "caution", "strength": 3}
    elif market_mins > 345:
        return {"type": "timing", "icon": "🔒", "label": "Last entry window closed",
                "detail": f"After 3:00 PM. No new entries. Manage existing positions only.",
                "impact": "neutral", "strength": 2}
    elif market_mins > 315:
        return {"type": "timing", "icon": "🏛️", "label": "Institutional positioning window",
                "detail": f"2:30–3:15. Watch for tomorrow signal. Position if signal strong.",
                "impact": "neutral", "strength": 2}
    return None

def timing_wait_signal(polls, baseline, regime):
    """Should the trader wait before entering?"""
    if not polls: return None
    rtype = regime.get('type', 'unknown')
    # Momentum accelerating — don't chase
    recent = polls[-6:] if len(polls) >= 6 else polls
    spots = [p.get('bnf') for p in recent if p.get('bnf')]
    if len(spots) >= 4:
        mid = len(spots) // 2
        m1 = sum(abs(spots[i] - spots[i-1]) for i in range(1, mid)) / max(1, mid-1) if mid > 1 else 0
        m2 = sum(abs(spots[i] - spots[i-1]) for i in range(mid+1, len(spots))) / max(1, len(spots)-mid-1) if len(spots) > mid+1 else 0
        if m1 > 0 and m2 / m1 > 2 and m2 > 50:
            return {"type": "timing", "icon": "⏳", "label": "Wait — momentum accelerating",
                    "detail": f"Moves growing ({m1:.0f} → {m2:.0f} pts/poll). Enter on exhaustion, not chase.",
                    "impact": "caution", "strength": 3}
    return None

# ═══════════════════════════════════════════
# PART 5: RISK (portfolio-level)
# ═══════════════════════════════════════════

def risk_kelly_headroom(polls, baseline, open_trades, closed_trades):
    """Kelly % vs current exposure."""
    if len(closed_trades) < 5: return None
    wins = [t for t in closed_trades if (t.get('actual_pnl') or 0) > 0]
    losses = [t for t in closed_trades if (t.get('actual_pnl') or 0) <= 0]
    w = len(wins) / len(closed_trades)
    avg_w = sum(t['actual_pnl'] for t in wins) / len(wins) if wins else 0
    avg_l = abs(sum(t['actual_pnl'] for t in losses) / len(losses)) if losses else 1
    r = avg_w / avg_l if avg_l > 0 else 1
    kelly = max(0, w - ((1 - w) / r)) if r > 0 else 0
    kelly_pct = kelly * 100
    capital = _capital  # set from context in analyze()
    optimal = kelly * capital
    current_exposure = sum(abs(t.get('max_loss', 0)) for t in open_trades if not t.get('paper'))
    headroom = optimal - current_exposure
    if headroom > 5000:
        return {"type": "risk", "icon": "🎰", "label": f"Kelly {kelly_pct:.0f}% — room for entry",
                "detail": f"Optimal: ₹{optimal:.0f}. Used: ₹{current_exposure:.0f}. Headroom: ₹{headroom:.0f}.",
                "impact": "neutral", "strength": 2}
    elif headroom < 0:
        return {"type": "risk", "icon": "🎰", "label": f"Kelly {kelly_pct:.0f}% — overexposed",
                "detail": f"Optimal: ₹{optimal:.0f}. Used: ₹{current_exposure:.0f}. Over by ₹{abs(headroom):.0f}.",
                "impact": "caution", "strength": 4}
    return None

def risk_regime_shift(polls, baseline, open_trades, closed_trades):
    """VIX crossed a regime threshold mid-session."""
    vixs = get_vix_vals(polls)
    if len(vixs) < 3: return None
    morning_vix = vixs[0]
    curr_vix = vixs[-1]
    # Check for regime boundary crossings: 15, 20, 24
    for threshold in [24, 20, 15]:
        if (morning_vix < threshold and curr_vix >= threshold) or (morning_vix >= threshold and curr_vix < threshold):
            crossed_up = curr_vix >= threshold
            has_credit = any(t.get('is_credit') for t in open_trades if not t.get('paper'))
            has_debit = any(not t.get('is_credit') for t in open_trades if not t.get('paper'))
            label = f"VIX crossed {threshold} {'↑' if crossed_up else '↓'}"
            detail = f"Morning {morning_vix:.1f} → now {curr_vix:.1f}."
            if threshold == 24 and crossed_up and has_credit:
                detail += " Backtest: debit > credit at VIX≥24. Open credit trades face headwind."
                return {"type": "risk", "icon": "🔥", "label": label, "detail": detail, "impact": "caution", "strength": 5}
            elif threshold == 24 and not crossed_up:
                detail += " VIX normalizing. Credit strategies favored."
                return {"type": "risk", "icon": "📉", "label": label, "detail": detail, "impact": "bullish", "strength": 3}
            else:
                detail += " Regime boundary crossed — review strategy alignment."
                return {"type": "risk", "icon": "⚡", "label": label, "detail": detail, "impact": "caution", "strength": 3}
    return None

# ═══════════════════════════════════════════
# PART 6: LEARNING — builds knowledge from YOUR trade history
# Cached: recomputes only when trade count changes
# ═══════════════════════════════════════════

_calibration = None
_cal_count = 0
_capital = 110000

def build_calibration(closed_trades):
    global _calibration, _cal_count
    trades = [t for t in closed_trades if t.get('status') == 'CLOSED' and t.get('actual_pnl') is not None]
    if len(trades) == _cal_count and _calibration:
        return _calibration
    _cal_count = len(trades)
    if len(trades) < 5:
        _calibration = None
        return None

    cal = {}

    # 1. Strategy win rates
    cal['strategy'] = {}
    for t in trades:
        st = t.get('strategy_type', 'UNKNOWN')
        if st not in cal['strategy']:
            cal['strategy'][st] = {'wins': 0, 'total': 0, 'pnls': []}
        cal['strategy'][st]['total'] += 1
        if t['actual_pnl'] > 0:
            cal['strategy'][st]['wins'] += 1
        cal['strategy'][st]['pnls'].append(t['actual_pnl'])
    for st in cal['strategy']:
        s = cal['strategy'][st]
        s['rate'] = s['wins'] / s['total'] if s['total'] > 0 else 0
        s['avg_pnl'] = sum(s['pnls']) / len(s['pnls']) if s['pnls'] else 0

    # 2. VIX regime rates
    cal['vix_regime'] = {}
    for t in trades:
        vix = t.get('entry_vix') or 20
        regime = 'VH' if vix >= 24 else 'H' if vix >= 20 else 'N' if vix >= 16 else 'L'
        if regime not in cal['vix_regime']:
            cal['vix_regime'][regime] = {'wins': 0, 'total': 0}
        cal['vix_regime'][regime]['total'] += 1
        if (t.get('actual_pnl') or 0) > 0:
            cal['vix_regime'][regime]['wins'] += 1
    for r in cal['vix_regime']:
        s = cal['vix_regime'][r]
        s['rate'] = s['wins'] / s['total'] if s['total'] > 0 else 0

    # 3. Credit vs debit
    cal['side'] = {'credit': {'wins': 0, 'total': 0}, 'debit': {'wins': 0, 'total': 0}}
    for t in trades:
        key = 'credit' if t.get('is_credit') else 'debit'
        cal['side'][key]['total'] += 1
        if (t.get('actual_pnl') or 0) > 0:
            cal['side'][key]['wins'] += 1
    for k in cal['side']:
        s = cal['side'][k]
        s['rate'] = s['wins'] / s['total'] if s['total'] > 0 else 0

    # 4. Multi-factor: strategy + VIX regime
    cal['multi'] = {}
    for t in trades:
        st = t.get('strategy_type', 'UNKNOWN')
        vix = t.get('entry_vix') or 20
        regime = 'VH' if vix >= 24 else 'H' if vix >= 20 else 'N' if vix >= 16 else 'L'
        key = f"{st}|{regime}"
        if key not in cal['multi']:
            cal['multi'][key] = {'wins': 0, 'total': 0, 'pnls': []}
        cal['multi'][key]['total'] += 1
        if (t.get('actual_pnl') or 0) > 0:
            cal['multi'][key]['wins'] += 1
        cal['multi'][key]['pnls'].append(t.get('actual_pnl', 0))
    for k in cal['multi']:
        s = cal['multi'][k]
        s['rate'] = s['wins'] / s['total'] if s['total'] > 0 else 0
        s['avg_pnl'] = sum(s['pnls']) / len(s['pnls']) if s['pnls'] else 0

    # 5. Force alignment impact
    cal['forces'] = {}
    for fname in ['force_f1', 'force_f2', 'force_f3']:
        pos = {'wins': 0, 'total': 0}
        neg = {'wins': 0, 'total': 0}
        for t in trades:
            fval = t.get(fname, 0)
            bucket = pos if fval and fval > 0 else neg
            bucket['total'] += 1
            if (t.get('actual_pnl') or 0) > 0:
                bucket['wins'] += 1
        pr = pos['wins'] / pos['total'] if pos['total'] > 0 else 0
        nr = neg['wins'] / neg['total'] if neg['total'] > 0 else 0
        cal['forces'][fname] = {'pos_rate': pr, 'neg_rate': nr, 'spread': pr - nr, 'n': pos['total'] + neg['total']}

    # 6. Exit analysis — are you capturing peak profit?
    winners = [t for t in trades if (t.get('actual_pnl') or 0) > 0 and t.get('peak_pnl')]
    if len(winners) >= 3:
        peaks = [t['peak_pnl'] for t in winners]
        exits = [t['actual_pnl'] for t in winners]
        cal['exit'] = {
            'avg_peak': sum(peaks) / len(peaks),
            'avg_exit': sum(exits) / len(exits),
            'capture_pct': sum(exits) / sum(peaks) * 100 if sum(peaks) > 0 else 0,
            'left_on_table': sum(p - e for p, e in zip(peaks, exits)) / len(peaks),
            'n': len(winners)
        }
    else:
        cal['exit'] = None

    # 7. Consecutive losses — max streak
    streak = 0
    max_streak = 0
    for t in sorted(trades, key=lambda x: x.get('exit_date', '')):
        if (t.get('actual_pnl') or 0) <= 0:
            streak += 1
            max_streak = max(max_streak, streak)
        else:
            streak = 0
    cal['max_loss_streak'] = max_streak

    # 8. Trade mode rates
    cal['mode'] = {}
    for t in trades:
        mode = t.get('trade_mode', 'unknown')
        if mode not in cal['mode']:
            cal['mode'][mode] = {'wins': 0, 'total': 0}
        cal['mode'][mode]['total'] += 1
        if (t.get('actual_pnl') or 0) > 0:
            cal['mode'][mode]['wins'] += 1
    for m in cal['mode']:
        s = cal['mode'][m]
        s['rate'] = s['wins'] / s['total'] if s['total'] > 0 else 0

    cal['total_trades'] = len(trades)

    # ═══ b92: LEARNING — what made trades WIN or LOSE? ═══

    # 9. Wall protection correlation — were wall-backed trades more successful?
    cal['wall'] = {'backed': {'wins': 0, 'total': 0}, 'exposed': {'wins': 0, 'total': 0}}
    for t in trades:
        snap = t.get('entry_snapshot') or {}
        sell = t.get('sell_strike', 0)
        stype = t.get('strategy_type', '')
        cw = snap.get('call_wall')
        pw = snap.get('put_wall')
        ws = snap.get('wall_score', 0)
        # Determine if wall-backed at entry
        backed = False
        if 'BEAR' in stype and cw and sell and cw >= sell:
            backed = True
        elif 'BULL' in stype and 'CALL' not in stype and pw and sell and pw <= sell:
            backed = True
        elif stype in ('IRON_CONDOR', 'IRON_BUTTERFLY') and ws and ws > 0:
            backed = True
        elif ws and ws > 0:
            backed = True
        bucket = cal['wall']['backed'] if backed else cal['wall']['exposed']
        bucket['total'] += 1
        if (t.get('actual_pnl') or 0) > 0:
            bucket['wins'] += 1
    for k in cal['wall']:
        s = cal['wall'][k]
        s['rate'] = s['wins'] / s['total'] if s['total'] > 0 else 0

    # 10. Multi-factor: strategy + VIX + wall protection
    for t in trades:
        st = t.get('strategy_type', 'UNKNOWN')
        vix = t.get('entry_vix') or 20
        regime = 'VH' if vix >= 24 else 'H' if vix >= 20 else 'N' if vix >= 16 else 'L'
        snap = t.get('entry_snapshot') or {}
        ws = snap.get('wall_score', 0)
        wall_key = 'wall' if ws and ws > 0 else 'nowall'
        key = f"{st}|{regime}|{wall_key}"
        if key not in cal['multi']:
            cal['multi'][key] = {'wins': 0, 'total': 0, 'pnls': []}
        cal['multi'][key]['total'] += 1
        if (t.get('actual_pnl') or 0) > 0:
            cal['multi'][key]['wins'] += 1
        cal['multi'][key]['pnls'].append(t.get('actual_pnl', 0))
    # Recompute rates for new multi keys
    for k in cal['multi']:
        s = cal['multi'][k]
        s['rate'] = s['wins'] / s['total'] if s['total'] > 0 else 0
        s['avg_pnl'] = sum(s['pnls']) / len(s['pnls']) if s['pnls'] else 0

    # 11. Exit reason patterns — why do you close trades?
    cal['exit_reasons'] = {}
    for t in trades:
        reason = t.get('exit_reason', 'unknown') or 'unknown'
        if reason not in cal['exit_reasons']:
            cal['exit_reasons'][reason] = {'wins': 0, 'total': 0, 'avg_pnl': 0, 'pnls': []}
        cal['exit_reasons'][reason]['total'] += 1
        pnl = t.get('actual_pnl', 0)
        if pnl > 0: cal['exit_reasons'][reason]['wins'] += 1
        cal['exit_reasons'][reason]['pnls'].append(pnl)
    for k in cal['exit_reasons']:
        s = cal['exit_reasons'][k]
        s['rate'] = s['wins'] / s['total'] if s['total'] > 0 else 0
        s['avg_pnl'] = sum(s['pnls']) / len(s['pnls']) if s['pnls'] else 0

    # ═══ b93: 4 NEW CALIBRATION DIMENSIONS ═══

    # 12. Time-of-day win rates — morning vs afternoon entries
    cal['time_of_day'] = {}
    for t in trades:
        entry = t.get('entry_date', '')
        try:
            hour = int(entry.split('T')[1].split(':')[0]) if 'T' in entry else 0
        except: hour = 0
        bucket = 'morning' if hour < 12 else 'afternoon' if hour < 15 else 'late'
        if bucket not in cal['time_of_day']:
            cal['time_of_day'][bucket] = {'wins': 0, 'total': 0, 'pnls': []}
        cal['time_of_day'][bucket]['total'] += 1
        if (t.get('actual_pnl') or 0) > 0:
            cal['time_of_day'][bucket]['wins'] += 1
        cal['time_of_day'][bucket]['pnls'].append(t.get('actual_pnl', 0))
    for k in cal['time_of_day']:
        s = cal['time_of_day'][k]
        s['rate'] = s['wins'] / s['total'] if s['total'] > 0 else 0
        s['avg_pnl'] = sum(s['pnls']) / len(s['pnls']) if s['pnls'] else 0

    # 13. Width bucket win rates — which widths actually perform?
    cal['width'] = {}
    for t in trades:
        w = t.get('width', 0)
        if not w: continue
        bucket = f"W{w}"
        if bucket not in cal['width']:
            cal['width'][bucket] = {'wins': 0, 'total': 0, 'pnls': []}
        cal['width'][bucket]['total'] += 1
        if (t.get('actual_pnl') or 0) > 0:
            cal['width'][bucket]['wins'] += 1
        cal['width'][bucket]['pnls'].append(t.get('actual_pnl', 0))
    for k in cal['width']:
        s = cal['width'][k]
        s['rate'] = s['wins'] / s['total'] if s['total'] > 0 else 0
        s['avg_pnl'] = sum(s['pnls']) / len(s['pnls']) if s['pnls'] else 0

    # 14. VIX change during trade — did vol crush or expand while holding?
    cal['vix_change'] = {'crush': {'wins': 0, 'total': 0}, 'expand': {'wins': 0, 'total': 0}, 'flat': {'wins': 0, 'total': 0}}
    for t in trades:
        entry_v = t.get('entry_vix')
        snap = t.get('exit_snapshot') or {}
        exit_v = snap.get('vix') or snap.get('exit_vix')
        if entry_v and exit_v:
            diff = exit_v - entry_v
            bucket = 'crush' if diff < -0.5 else 'expand' if diff > 0.5 else 'flat'
            cal['vix_change'][bucket]['total'] += 1
            if (t.get('actual_pnl') or 0) > 0:
                cal['vix_change'][bucket]['wins'] += 1
    for k in cal['vix_change']:
        s = cal['vix_change'][k]
        s['rate'] = s['wins'] / s['total'] if s['total'] > 0 else 0

    # 15. Sigma OTM at entry — does distance from ATM predict success?
    cal['sigma_otm'] = {}
    for t in trades:
        snap = t.get('entry_snapshot') or {}
        sigma = snap.get('sigma_otm') or snap.get('sigmaOTM')
        if sigma is not None:
            bucket = 'close' if sigma < 0.4 else 'sweet' if sigma <= 0.8 else 'far'
            if bucket not in cal['sigma_otm']:
                cal['sigma_otm'][bucket] = {'wins': 0, 'total': 0, 'pnls': []}
            cal['sigma_otm'][bucket]['total'] += 1
            if (t.get('actual_pnl') or 0) > 0:
                cal['sigma_otm'][bucket]['wins'] += 1
            cal['sigma_otm'][bucket]['pnls'].append(t.get('actual_pnl', 0))
    for k in cal['sigma_otm']:
        s = cal['sigma_otm'][k]
        s['rate'] = s['wins'] / s['total'] if s['total'] > 0 else 0
        s['avg_pnl'] = sum(s['pnls']) / len(s['pnls']) if s['pnls'] else 0

    _calibration = cal
    return cal

def candidate_pattern_match(cand, polls, baseline, regime):
    """b92: Score candidate from YOUR trade history in similar conditions.
    Now uses 3-factor key: strategy + VIX + wall protection."""
    if not _calibration:
        return None
    ctype = cand.get('type', '')
    # Current VIX regime
    vixs = [p.get('vix') for p in polls[-3:] if p.get('vix')]
    vix = vixs[-1] if vixs else 20
    vr = 'VH' if vix >= 24 else 'H' if vix >= 20 else 'N' if vix >= 16 else 'L'
    # b92: Wall status from enriched candidate data
    wall_key = 'wall' if (cand.get('wallScore') or 0) > 0 else 'nowall'
    # Try 3-factor key first: strategy + VIX + wall
    key3 = f"{ctype}|{vr}|{wall_key}"
    match3 = _calibration.get('multi', {}).get(key3)
    if match3 and match3['total'] >= 3:
        rate = match3['rate']
        wall_label = "wall-backed" if wall_key == 'wall' else "unprotected"
        return {"icon": "📊", "label": f"Your data: {match3['wins']}/{match3['total']} ({rate*100:.0f}%)",
                "detail": f"{ctype} at {vr} VIX, {wall_label}. Avg P&L ₹{match3['avg_pnl']:.0f}.",
                "impact": "bullish" if rate >= 0.6 else "caution" if rate < 0.4 else "neutral",
                "strength": 4 if match3['total'] >= 5 else 3}
    # Fall back to 2-factor: strategy + VIX
    key2 = f"{ctype}|{vr}"
    match2 = _calibration.get('multi', {}).get(key2)
    if match2 and match2['total'] >= 3:
        rate = match2['rate']
        return {"icon": "📊", "label": f"Your data: {match2['wins']}/{match2['total']} ({rate*100:.0f}%)",
                "detail": f"{ctype} at {vr} VIX. Avg P&L ₹{match2['avg_pnl']:.0f}.",
                "impact": "bullish" if rate >= 0.6 else "caution" if rate < 0.4 else "neutral",
                "strength": 4 if match2['total'] >= 5 else 3}
    # Fall back to strategy-only
    strat = _calibration.get('strategy', {}).get(ctype)
    if strat and strat['total'] >= 2:
        rate = strat['rate']
        return {"icon": "📊", "label": f"Your {ctype}: {strat['wins']}/{strat['total']} ({rate*100:.0f}%)",
                "detail": f"Avg P&L ₹{strat['avg_pnl']:.0f}. {'Edge confirmed.' if rate > 0.6 else 'Needs more data.' if rate >= 0.4 else 'Below 40% — paper first.'}",
                "impact": "bullish" if rate >= 0.6 else "caution" if rate < 0.4 else "neutral",
                "strength": 3 if strat['total'] >= 5 else 2}
    # b92: Wall protection aggregate insight
    wall_cal = _calibration.get('wall', {})
    if wall_cal.get('backed', {}).get('total', 0) >= 3 and wall_cal.get('exposed', {}).get('total', 0) >= 3:
        b_rate = wall_cal['backed']['rate']
        e_rate = wall_cal['exposed']['rate']
        if abs(b_rate - e_rate) > 0.15:
            better = "wall-backed" if b_rate > e_rate else "unprotected"
            return {"icon": "📊", "label": f"Wall data: {'backed' if wall_key == 'wall' else 'exposed'}",
                    "detail": f"Backed: {b_rate*100:.0f}% win. Exposed: {e_rate*100:.0f}% win. {better} performs better.",
                    "impact": "bullish" if (wall_key == 'wall' and b_rate > e_rate) or (wall_key == 'nowall' and e_rate > b_rate) else "caution",
                    "strength": 3}
    # Never traded this type
    if ctype not in _calibration.get('strategy', {}):
        return {"icon": "🆕", "label": f"No history for {ctype}",
                "detail": "First time. Consider paper trade.", "impact": "caution", "strength": 2}
    return None

def risk_exit_analysis(polls, baseline, open_trades, closed_trades):
    if not _calibration or not _calibration.get('exit'):
        return None
    ex = _calibration['exit']
    cap = ex['capture_pct']
    if cap < 60:
        return {"type": "risk", "icon": "💸", "label": f"Capturing only {cap:.0f}% of peaks",
                "detail": f"Avg peak ₹{ex['avg_peak']:.0f} → exit ₹{ex['avg_exit']:.0f}. Book at 50% more often.",
                "impact": "caution", "strength": 3}
    elif cap > 80:
        return {"type": "risk", "icon": "🎯", "label": f"Exit discipline: {cap:.0f}% captured",
                "detail": f"Strong execution. Avg ₹{ex['left_on_table']:.0f} left per trade.", "impact": "bullish", "strength": 2}
    return None

def risk_factor_importance(polls, baseline, open_trades, closed_trades):
    if not _calibration or not _calibration.get('forces'):
        return None
    best_name, best_spread = None, 0
    for fname, fdata in _calibration['forces'].items():
        if fdata['n'] >= 10 and fdata['spread'] > best_spread:
            best_name, best_spread = fname, fdata['spread']
    if best_name and best_spread > 0.15:
        nice = {'force_f1': 'Direction (F1)', 'force_f2': 'Theta (F2)', 'force_f3': 'IV (F3)'}
        return {"type": "risk", "icon": "🔑", "label": f"{nice.get(best_name, best_name)} is your edge",
                "detail": f"Win rate +{best_spread*100:.0f}% when aligned. Most predictive force.",
                "impact": "neutral", "strength": 3}
    return None

def risk_streak_warning(polls, baseline, open_trades, closed_trades):
    if not _calibration:
        return None
    streak = _calibration.get('max_loss_streak', 0)
    if streak >= 3:
        return {"type": "risk", "icon": "📉", "label": f"Max losing streak: {streak}",
                "detail": f"Worst run was {streak} consecutive losses. Size accordingly.",
                "impact": "caution", "strength": 3 if streak >= 4 else 2}
    return None

# ═══════════════════════════════════════════
# PART 7: SYNTHESIS — ONE answer, not 14 whispers
# Uses ALL signals + context + calibration
# ═══════════════════════════════════════════

def signal_coherence(polls, ctx):
    """Are VIX, spot, breadth telling the same story?"""
    vixs = get_vix_vals(polls)
    spots = [p.get('bnf') for p in last_n(polls, 4) if p.get('bnf')]
    if len(vixs) < 3 or len(spots) < 3: return None
    vix_dir = 1 if vixs[-1] > vixs[0] + 0.3 else -1 if vixs[-1] < vixs[0] - 0.3 else 0
    spot_dir = 1 if spots[-1] > spots[0] + 30 else -1 if spots[-1] < spots[0] - 30 else 0
    breadth = ctx.get('bnfBreadth') or {}
    b_dir = 1 if breadth.get('pct', 50) > 60 else -1 if breadth.get('pct', 50) < 40 else 0
    # Normal: VIX opposes spot. Abnormal: same direction
    vix_spot_coherent = (vix_dir * spot_dir) <= 0  # opposite or flat = coherent
    breadth_spot_coherent = (b_dir == spot_dir) or b_dir == 0 or spot_dir == 0
    if not vix_spot_coherent:
        return {"type": "coherence", "icon": "⚠️", "label": "VIX-Spot divergence",
                "detail": f"VIX {'rising' if vix_dir>0 else 'falling'} WITH spot {'rising' if spot_dir>0 else 'falling'}. Unusual — proceed with caution.",
                "impact": "caution", "strength": 4}
    if not breadth_spot_coherent:
        return {"type": "coherence", "icon": "⚠️", "label": f"Narrow {'rally' if spot_dir>0 else 'decline'}",
                "detail": f"Spot moving {'up' if spot_dir>0 else 'down'} but breadth {'bearish' if b_dir<0 else 'neutral'}. Move may reverse.",
                "impact": "caution", "strength": 3}
    if vix_spot_coherent and breadth_spot_coherent and spot_dir != 0:
        return {"type": "coherence", "icon": "✅", "label": "Signals aligned",
                "detail": f"VIX, spot, breadth all consistent. Move is real.", "impact": "bullish" if spot_dir > 0 else "bearish", "strength": 3}
    return None

def max_pain_gravity(polls, ctx):
    """Max pain as magnet — strongest on DTE 0-1."""
    dte = ctx.get('bnfDTE', 5)
    profile = ctx.get('bnfProfile') or {}
    mp = profile.get('maxPain')
    spot = profile.get('spot')
    if not mp or not spot: return None
    dist = spot - mp
    if dte <= 1 and abs(dist) > 50:
        d = "DOWN" if dist > 0 else "UP"
        return {"type": "maxpain", "icon": "🧲", "label": f"Max pain pull {d} ({abs(dist):.0f}pts)",
                "detail": f"DTE {dte}. Spot {spot:.0f}, max pain {mp:.0f}. Expiry day magnet.",
                "impact": "bearish" if dist > 0 else "bullish", "strength": 4}
    elif dte <= 3 and abs(dist) > 100:
        return {"type": "maxpain", "icon": "🧲", "label": f"Max pain at {mp:.0f} ({abs(dist):.0f}pts away)",
                "detail": f"DTE {dte}. Gravitational pull building.", "impact": "neutral", "strength": 2}
    return None

def fii_trend(polls, ctx):
    """5-day FII trend from premiumHistory."""
    hist = ctx.get('fiiHistory', [])
    if len(hist) < 3: return None
    fii_vals = []
    for h in hist:
        v = h.get('fiiCash')
        if v is not None:
            try: fii_vals.append(float(v))
            except (ValueError, TypeError): pass
    if len(fii_vals) < 3: return None
    total = sum(fii_vals)
    avg = total / len(fii_vals)
    if total < -3000:
        return {"type": "fii", "icon": "🏦", "label": f"FII selling {len(fii_vals)} days (₹{total:.0f}Cr)",
                "detail": f"Sustained institutional selling. Bearish conviction.", "impact": "bearish", "strength": 4}
    elif total > 3000:
        return {"type": "fii", "icon": "🏦", "label": f"FII buying {len(fii_vals)} days (₹{total:.0f}Cr)",
                "detail": f"Sustained institutional buying. Bullish conviction.", "impact": "bullish", "strength": 4}
    elif total < -1000:
        return {"type": "fii", "icon": "🏦", "label": f"FII net sellers (₹{total:.0f}Cr/{len(fii_vals)}d)",
                "detail": f"Mild selling pressure.", "impact": "bearish", "strength": 2}
    return None

def nf_bnf_divergence(polls, ctx):
    """NF and BNF moving in different directions?"""
    bnf_pct = (ctx.get('bnfProfile') or {}).get('pctFromOpen', 0)
    nf_pct = (ctx.get('nfProfile') or {}).get('pctFromOpen', 0)
    if abs(bnf_pct - nf_pct) > 0.3:
        leader = "BNF" if abs(bnf_pct) > abs(nf_pct) else "NF"
        return {"type": "diverge", "icon": "↔️", "label": f"NF-BNF divergence",
                "detail": f"BNF {bnf_pct:+.1f}% vs NF {nf_pct:+.1f}%. {leader} leading. Watch for convergence.",
                "impact": "caution", "strength": 2}
    return None

def day_range_position(polls, ctx):
    """Where in today's range — near high (caution for bears) or low?"""
    profile = ctx.get('bnfProfile') or {}
    pos = profile.get('dayRange', 0.5)
    if pos > 0.85:
        return {"type": "range_pos", "icon": "📍", "label": "At day HIGH",
                "detail": f"BNF at {pos*100:.0f}% of day range. Breakout or reversal zone.",
                "impact": "caution", "strength": 2}
    elif pos < 0.15:
        return {"type": "range_pos", "icon": "📍", "label": "At day LOW",
                "detail": f"BNF at {pos*100:.0f}% of day range. Bounce or breakdown zone.",
                "impact": "caution", "strength": 2}
    return None

def wall_freshness(polls, ctx):
    """Are OI walls actively defended today or stale from yesterday?"""
    profile = ctx.get('bnfProfile') or {}
    cwF = profile.get('cwFresh', 0)
    pwF = profile.get('pwFresh', 0)
    cwChg = profile.get('cwOiChg')
    insights = []
    if cwF > 0.25 and cwChg and cwChg > 0:
        insights.append({"type": "fresh", "icon": "🏗️", "label": "Call wall FRESH — actively built today",
                "detail": f"Volume/OI ratio {cwF:.1%}. +{cwChg:,.0f} new OI. Resistance is real.",
                "impact": "bearish", "strength": 3})
    elif cwF < 0.05 and cwChg is not None and cwChg <= 0:
        insights.append({"type": "fresh", "icon": "💨", "label": "Call wall STALE — no fresh defense",
                "detail": f"Volume/OI {cwF:.1%}. May not hold if tested.", "impact": "caution", "strength": 2})
    return insights[0] if insights else None

def yesterday_signal_prior(polls, ctx):
    """Yesterday's positioning signal as morning prior."""
    sig = ctx.get('yesterdaySignal')
    acc = ctx.get('signalAccuracy')
    if not sig: return None
    pct = acc.get('pct', 0) if acc else 0
    return {"type": "prior", "icon": "📡", "label": f"Yesterday: {sig['signal']} ({sig['strength']}/5)",
            "detail": f"Signal accuracy: {pct}% over {acc.get('total',0) if acc else 0} signals.",
            "impact": "bearish" if sig['signal']=='BEARISH' else "bullish" if sig['signal']=='BULLISH' else "neutral",
            "strength": 2 if pct < 60 else 3}

def dte_urgency(polls, ctx):
    """DTE-aware urgency for timing."""
    dte = ctx.get('bnfDTE', 5)
    if dte <= 1:
        return {"type": "timing", "icon": "⏰", "label": "EXPIRY DAY — theta maximum",
                "detail": "Credit sellers: theta melting fastest. Debit buyers: theta death zone. IB/IC exit by 3PM.",
                "impact": "neutral", "strength": 4}
    elif dte == 2:
        return {"type": "timing", "icon": "⏰", "label": "DTE 2 — theta accelerating",
                "detail": "Credit favored. Debit positions lose value rapidly.", "impact": "neutral", "strength": 2}
    return None

def compute_effective_bias(polls, baseline, ctx, regime):
    """b97: Bayesian effective bias — morning prior decays as intraday evidence accumulates.
    Morning data = where we came from (context). Intraday polls = what's happening now.
    By sweet spot (11 AM), intraday dominates 80%. Morning never disappears (20% floor).
    Returns: {bias, strength, net, morning_weight, signals, drift_reasons}"""
    
    morning_bias = ctx.get('morningBias') or {}
    morning_net = morning_bias.get('net', 0)
    poll_count = len(polls)
    TOTAL_SIGNALS = 7
    
    # ═══ MORNING WEIGHT DECAY ═══
    # 100% at poll 0, decays 5%/poll, floor 20%. Sweet spot ~poll 16-20.
    morning_weight = max(0.20, 1.0 - poll_count * 0.05)
    intraday_weight = 1.0 - morning_weight
    
    # ═══ FIRST 15 MINUTES SUPPRESSION ═══
    # Opening noise — gap repricing, market maker activity. Signals unreliable.
    if poll_count < 3:
        return {
            'bias': 'BULL' if morning_net >= 1 else 'BEAR' if morning_net <= -1 else 'NEUTRAL',
            'strength': 'STRONG' if abs(morning_net) >= 2 else 'MILD' if abs(morning_net) >= 1 else '',
            'net': morning_net,
            'morning_weight': 1.0,
            'signals': [0] * TOTAL_SIGNALS,
            'drift_reasons': ['Too early — morning dominant']
        }
    
    # ═══ 7 INTRADAY SIGNALS (each -2/-1/0/+1/+2) ═══
    signals = []
    drift_reasons = []
    last = polls[-1] if polls else {}
    first = polls[0] if polls else {}
    
    # --- 1. Spot σ from morning (3-poll smoothed) ---
    base_spot = baseline.get('bnfSpot', 0)
    base_vix = baseline.get('vix', 18)
    daily_sigma = base_spot * (base_vix / 100) / math.sqrt(252) if base_spot > 0 else 300
    recent_spots = [p.get('bnf') for p in polls[-4:] if p.get('bnf')]
    if len(recent_spots) >= 3 and daily_sigma > 0:
        spot_avg = sum(recent_spots[-3:]) / 3  # 3-poll smoothed
        spot_move_sigma = (spot_avg - base_spot) / daily_sigma
        if spot_move_sigma > 0.8: signals.append(2); drift_reasons.append(f"Spot +{spot_move_sigma:.1f}σ")
        elif spot_move_sigma > 0.3: signals.append(1); drift_reasons.append(f"Spot +{spot_move_sigma:.1f}σ")
        elif spot_move_sigma < -0.8: signals.append(-2); drift_reasons.append(f"Spot {spot_move_sigma:.1f}σ")
        elif spot_move_sigma < -0.3: signals.append(-1); drift_reasons.append(f"Spot {spot_move_sigma:.1f}σ")
        else: signals.append(0)
    else:
        signals.append(0)
    
    # --- 2. VIX from morning (3-poll smoothed) ---
    recent_vix = [p.get('vix') for p in polls[-4:] if p.get('vix')]
    if len(recent_vix) >= 3:
        vix_avg = sum(recent_vix[-3:]) / 3
        vix_change = vix_avg - base_vix
        if vix_change < -1.5: signals.append(2); drift_reasons.append(f"VIX {vix_change:+.1f}")
        elif vix_change < -0.5: signals.append(1)
        elif vix_change > 1.5: signals.append(-2); drift_reasons.append(f"VIX {vix_change:+.1f}")
        elif vix_change > 0.5: signals.append(-1)
        else: signals.append(0)
    else:
        signals.append(0)
    
    # --- 3. PCR from morning (3-poll smoothed) ---
    recent_pcr = [p.get('pcr') for p in polls[-4:] if p.get('pcr')]
    pcr_morning = first.get('pcr', 0) if first else 0
    if len(recent_pcr) >= 3 and pcr_morning > 0:
        pcr_avg = sum(recent_pcr[-3:]) / 3
        pcr_change = pcr_avg - pcr_morning
        if pcr_change > 0.2: signals.append(2); drift_reasons.append(f"PCR +{pcr_change:.2f}")
        elif pcr_change > 0.1: signals.append(1)
        elif pcr_change < -0.2: signals.append(-2); drift_reasons.append(f"PCR {pcr_change:.2f}")
        elif pcr_change < -0.1: signals.append(-1)
        else: signals.append(0)
    else:
        signals.append(0)
    
    # --- 4. Straddle direction (last 4 polls) ---
    straddles = [p.get('straddle') for p in polls[-4:] if p.get('straddle')]
    if len(straddles) >= 3:
        straddle_chg = straddles[-1] - straddles[0]
        if straddle_chg < -50: signals.append(2)  # shrinking fast → range/BULL
        elif straddle_chg < -20: signals.append(1)
        elif straddle_chg > 50: signals.append(-2)  # expanding fast → fear/BEAR
        elif straddle_chg > 20: signals.append(-1)
        else: signals.append(0)
    else:
        signals.append(0)
    
    # --- 5. Wall movement from morning ---
    cw_now = last.get('cw', 0)
    pw_now = last.get('pw', 0)
    cw_morning = baseline.get('bnfCallWall', 0)
    pw_morning = baseline.get('bnfPutWall', 0)
    wall_signal = 0
    if cw_now and cw_morning:
        cw_move = cw_now - cw_morning
        if cw_move > 200: wall_signal = 2; drift_reasons.append(f"CW +{cw_move}")
        elif cw_move > 100: wall_signal = 1
        elif cw_move < -200: wall_signal = -2; drift_reasons.append(f"CW {cw_move}")
        elif cw_move < -100: wall_signal = -1
    if pw_now and pw_morning:
        pw_move = pw_now - pw_morning
        if pw_move > 200: wall_signal = max(wall_signal, 1)  # put wall rising = BULL
        elif pw_move < -200: wall_signal = min(wall_signal, -1)
    signals.append(wall_signal)
    
    # --- 6. Breadth ---
    breadth_pct = (ctx.get('bnfBreadth') or {}).get('pct', 50)
    if breadth_pct > 65: signals.append(2); drift_reasons.append(f"Breadth {breadth_pct:.0f}%")
    elif breadth_pct > 55: signals.append(1)
    elif breadth_pct < 35: signals.append(-2); drift_reasons.append(f"Breadth {breadth_pct:.0f}%")
    elif breadth_pct < 45: signals.append(-1)
    else: signals.append(0)
    
    # --- 7. Regime (range pushes opposite to morning direction) ---
    regime_type = regime.get('type', 'unknown') if regime else 'unknown'
    regime_dir = regime.get('direction', 0) if regime else 0
    if regime_type == 'range':
        # Range contradicts directional bias — push toward NEUTRAL
        morning_sign = 1 if morning_net > 0 else -1 if morning_net < 0 else 0
        signals.append(-morning_sign)  # push opposite
        if morning_sign != 0: drift_reasons.append("Range → push NEUTRAL")
    elif regime_type == 'trend':
        if abs(regime_dir) >= 3:
            signals.append(2 if regime_dir > 0 else -2)
            drift_reasons.append(f"Strong trend {'↑' if regime_dir > 0 else '↓'}")
        elif abs(regime_dir) >= 1:
            signals.append(1 if regime_dir > 0 else -1)
        else:
            signals.append(0)
    else:
        signals.append(0)
    
    # ═══ BLEND: morning prior × intraday evidence ═══
    intraday_net = sum(signals)
    # Normalize to -3..+3 (same scale as morning). /TOTAL_SIGNALS so 1 signal is weak.
    intraday_normalized = (intraday_net / TOTAL_SIGNALS) * 3
    
    effective_net = morning_net * morning_weight + intraday_normalized * intraday_weight
    
    # Classify
    if effective_net >= 2: bias, strength = 'BULL', 'STRONG'
    elif effective_net >= 1: bias, strength = 'BULL', 'MILD'
    elif effective_net <= -2: bias, strength = 'BEAR', 'STRONG'
    elif effective_net <= -1: bias, strength = 'BEAR', 'MILD'
    else: bias, strength = 'NEUTRAL', ''
    
    return {
        'bias': bias,
        'strength': strength,
        'net': round(effective_net, 2),
        'morning_weight': round(morning_weight, 2),
        'signals': signals,
        'intraday_net': intraday_net,
        'drift_reasons': drift_reasons[:5]
    }

def chain_intelligence(polls, ctx):
    """b92: Deep chain analysis — returns LIST of ALL qualifying insights (was single-return).
    Uses 10 computed features from computeChainProfile."""
    profile = ctx.get('bnfProfile') or {}
    insights = []
    
    # 1. IV Smile Slope — steepness indicates fear/hedging
    iv_slope = profile.get('ivSlope', 0)
    if iv_slope > 3:
        insights.append({"type": "market", "icon": "📉", "label": f"Fear skew steep ({iv_slope:.1f})",
                "detail": "Put IV higher than call. Institutions hedging downside.",
                "impact": "bearish", "strength": 3})
    elif iv_slope < -2:
        insights.append({"type": "market", "icon": "📈", "label": f"Call skew unusual ({iv_slope:.1f})",
                "detail": "Call IV higher than put. Unusual bullish positioning.",
                "impact": "bullish", "strength": 2})
    
    # 2. Gamma Clustering — market coiled for move
    gamma_c = profile.get('gammaCluster', 0)
    if gamma_c > 0.6:
        insights.append({"type": "market", "icon": "⚡", "label": f"Gamma concentrated ({gamma_c:.0%} near ATM)",
                "detail": "High gamma at ATM. Coiled for sharp move.",
                "impact": "caution", "strength": 4})
    
    # 3. Volume Ratio — real-time institutional flow
    vol_r = profile.get('volRatio', 1.0)
    if vol_r > 2.0:
        insights.append({"type": "market", "icon": "📞", "label": f"Call buying surge ({vol_r:.1f}x)",
                "detail": "Call volume 2x put. Aggressive bullish flow.",
                "impact": "bullish", "strength": 3})
    elif vol_r < 0.5:
        insights.append({"type": "market", "icon": "📉", "label": f"Put buying surge ({vol_r:.1f}x)",
                "detail": "Put volume 2x call. Aggressive bearish flow.",
                "impact": "bearish", "strength": 3})
    
    # 4. OI Velocity — wall building speed
    oi_vel = profile.get('oiVelocity', 0)
    if abs(oi_vel) > 5:
        direction = "building" if oi_vel > 0 else "unwinding"
        insights.append({"type": "market", "icon": "🏗️", "label": f"OI {direction} fast ({oi_vel:.1f}L)",
                "detail": f"Institutional {'conviction' if oi_vel > 0 else 'exit'}.",
                "impact": "neutral", "strength": 3})
    
    # 5. Bid-Ask Quality — liquidity warning
    baq = profile.get('bidAskQuality', 0)
    if baq > 15:
        insights.append({"type": "market", "icon": "⚠️", "label": f"Poor liquidity ({baq:.1f}% spread)",
                "detail": "Wide spreads. Entry/exit costly.",
                "impact": "caution", "strength": 3})
    
    # 6. Net Delta — institutional directional bias
    nd = profile.get('netDelta', 0)
    if nd > 3.0:
        insights.append({"type": "market", "icon": "📊", "label": f"Net delta bullish ({nd:.1f})",
                "detail": "OI weighted bullish. Institutions positioned for up.",
                "impact": "bullish", "strength": 2})
    elif nd < -3.0:
        insights.append({"type": "market", "icon": "📊", "label": f"Net delta bearish ({nd:.1f})",
                "detail": "OI weighted bearish. Institutions positioned for down.",
                "impact": "bearish", "strength": 2})
    
    # 7. Wall Cluster Depth — fortress vs fragile walls
    cc_depth = profile.get('callClusterDepth', 0)
    pc_depth = profile.get('putClusterDepth', 0)
    if cc_depth >= 3 and pc_depth >= 3:
        insights.append({"type": "market", "icon": "🏰", "label": f"Both walls fortified (C:{cc_depth} P:{pc_depth})",
                "detail": "Heavy OI clusters on both sides. Strong range — IC/IB favorable.",
                "impact": "neutral", "strength": 4})
    elif cc_depth >= 3:
        insights.append({"type": "market", "icon": "🏰", "label": f"Call wall fortress ({cc_depth} deep)",
                "detail": "Multiple heavy resistance strikes. Hard ceiling above.",
                "impact": "bearish", "strength": 3})
    elif pc_depth >= 3:
        insights.append({"type": "market", "icon": "🏰", "label": f"Put wall fortress ({pc_depth} deep)",
                "detail": "Multiple heavy support strikes. Strong floor below.",
                "impact": "bullish", "strength": 3})
    elif cc_depth <= 1 or pc_depth <= 1:
        fragile = "call" if cc_depth <= 1 else "put"
        depth = cc_depth if fragile == "call" else pc_depth
        insights.append({"type": "market", "icon": "⚠️", "label": f"Fragile {fragile} wall (depth {depth})",
                "detail": f"Single-strike {fragile} wall. One unwind breaks it.",
                "impact": "caution", "strength": 3})
    
    return insights  # LIST — can be empty, 1, or multiple

def daily_pnl_check(polls, ctx):
    """Prevent overtrading and chasing losses."""
    pnl = ctx.get('dailyPnl', 0)
    count = ctx.get('dailyTradeCount', 0)
    if count >= 3:
        return {"type": "risk", "icon": "🛑", "label": f"3+ trades today — slow down",
                "detail": f"Net today: ₹{pnl:.0f} from {count} trades. Overtrading risk. Stop if losing.",
                "impact": "caution", "strength": 4}
    if pnl < -2000 and count >= 2:
        return {"type": "risk", "icon": "🛑", "label": f"Down ₹{abs(pnl):.0f} today — STOP trading",
                "detail": f"Chasing losses kills capital. Walk away.", "impact": "caution", "strength": 5}
    if pnl > 3000:
        return {"type": "risk", "icon": "💰", "label": f"Up ₹{pnl:.0f} today — protect gains",
                "detail": f"Good day. Only high-confidence entries from here.", "impact": "neutral", "strength": 2}
    return None

def candidate_liquidity(cand, ctx):
    """Bid-ask spread assessment from chain profile."""
    profile = ctx.get('bnfProfile' if cand.get('index')=='BNF' else 'nfProfile') or {}
    spread = profile.get('atmSpread', 0)
    if spread > 8:
        return {"icon": "⚠️", "label": f"Wide spreads (₹{spread:.0f})",
                "detail": "Slippage will eat into profits. Use limit orders.", "impact": "caution", "strength": 2}
    elif spread < 2:
        return {"icon": "✅", "label": "Tight spreads",
                "detail": "Good liquidity. Entry/exit efficient.", "impact": "bullish", "strength": 1}
    return None

def position_gamma_alert(trade, polls, strike_oi):
    """Track gamma acceleration at traded strikes across polls."""
    soi = strike_oi if isinstance(strike_oi, list) else []
    if len(soi) < 3: return None
    is_bear = 'BEAR' in trade.get('strategy_type', '')
    field = 'sellCOI' if is_bear else 'sellPOI'
    # Check if OI at sell strike is rapidly changing
    ois = [s.get(field) for s in soi if s.get(field) is not None]
    if len(ois) < 3: return None
    # Compute acceleration (rate of change of rate of change)
    changes = [ois[i] - ois[i-1] for i in range(1, len(ois))]
    if len(changes) < 2: return None
    accel = changes[-1] - changes[0]
    if abs(accel) > 5000:
        d = "building" if accel > 0 else "unwinding"
        return {"icon": "⚡", "label": f"OI {d} at sell strike",
                "detail": f"Acceleration detected. Position dynamics shifting.", "impact": "caution" if accel < 0 else "bullish", "strength": 3}
    return None

# ═══ THE VERDICT ═══

def synthesize_verdict(all_insights, regime, ctx, polls, baseline, candidates=None, cand_insights=None):
    """THE function. All intelligence in. ONE answer out.
    b92: Now receives candidates + their insights for menu awareness."""
    bull = bear = 0.0
    cautions = 0
    for ins in all_insights:
        w = (ins.get('strength', 1)) / 5.0
        imp = ins.get('impact', 'neutral')
        if imp == 'bullish': bull += w
        elif imp == 'bearish': bear += w
        elif imp == 'caution': cautions += 1

    # Context signals (numeric, not insights)
    profile = ctx.get('bnfProfile') or {}
    breadth = ctx.get('bnfBreadth') or {}
    b_pct = breadth.get('pct', 50)
    if b_pct > 65: bull += 0.4
    elif b_pct < 35: bear += 0.4
    skew = profile.get('ivSkew', 0)
    if skew > 3: bear += 0.2
    elif skew < -2: bull += 0.2
    cwF = profile.get('cwFresh', 0)
    pwF = profile.get('pwFresh', 0)
    if cwF > 0.25: bear += 0.15
    if pwF > 0.25: bull += 0.15
    fii_hist = ctx.get('fiiHistory', [])
    fii_sum = 0
    for h in fii_hist[:5]:
        v = h.get('fiiCash', 0)
        try: fii_sum += float(v) if v is not None else 0
        except (ValueError, TypeError): pass
    if fii_sum < -3000: bear += 0.3
    elif fii_sum > 3000: bull += 0.3

    # Direction
    if bull > bear + 0.4: direction = 'BULL'
    elif bear > bull + 0.4: direction = 'BEAR'
    else: direction = 'NEUTRAL'

    # Confidence
    total = bull + bear + 0.001
    dominant = max(bull, bear)
    confidence = int(dominant / total * 80)  # base max 80
    if cautions >= 3: confidence -= 15
    if bull > 0.5 and bear > 0.5: confidence -= 20  # conflicting
    rtype = regime.get('type', 'unknown')
    if rtype in ('range', 'trend'): confidence += 10  # clear regime = higher confidence
    if rtype == 'choppy': confidence -= 10

    # Personal calibration boost/penalty
    vixs = get_vix_vals(polls)
    vix = vixs[-1] if vixs else 20
    dte = ctx.get('bnfDTE', 5)

    # b93: Z-SCORE VIX REGIME — dynamic, not hardcoded
    vix_hist = ctx.get('vixHistory', [])
    vix_z = z_score(vix, vix_hist) if len(vix_hist) >= 10 else (1.5 if vix >= 24 else 0.5 if vix >= 20 else -0.5 if vix >= 16 else -1.5)
    # vix_z > 1.5 = extreme high (was vix>=24), vix_z > 0.5 = high (was vix>=20)
    # vix_z < -1.0 = low VIX regime, negative = cheap premiums

    # b93: STRADDLE VETO — Premium is King
    _, straddle_chg, straddle_expanding = straddle_velocity(polls)
    
    # Strategy selection
    conflicts = []
    if rtype == 'range':
        action = 'SELL PREMIUM'
        # Straddle expanding in range = market makers pricing in breakout — don't sell
        if straddle_expanding and straddle_chg > 5:
            conflicts.append(f"Straddle expanding +₹{straddle_chg:.0f} — breakout priced in")
            action = 'WAIT'
            strategy = None
        elif vix_z >= 0.5 and dte <= 1:
            strategy = 'IRON_BUTTERFLY'
        else:
            strategy = 'IRON_CONDOR'
        if direction != 'NEUTRAL' and strategy:
            conflicts.append(f"Range but bias {direction}")
    elif direction == 'BULL':
        if vix_z >= 1.5: action, strategy = 'BUY PREMIUM', 'BULL_CALL'
        elif vix_z >= 0.5: action, strategy = 'SELL PREMIUM', 'BULL_PUT'
        else: action, strategy = 'BUY PREMIUM', 'BULL_CALL'  # low VIX = cheap options, buy
    elif direction == 'BEAR':
        if vix_z >= 1.5: action, strategy = 'BUY PREMIUM', 'BEAR_PUT'
        elif vix_z >= 0.5: action, strategy = 'SELL PREMIUM', 'BEAR_CALL'
        else: action, strategy = 'BUY PREMIUM', 'BEAR_PUT'
    else:
        if rtype == 'choppy' or cautions >= 3:
            action, strategy = 'WAIT', None
        elif vix_z >= 0.5:
            action, strategy = 'SELL PREMIUM', 'IRON_CONDOR'
        else:
            action, strategy = 'WAIT', None

    # b93: HARD VETO — calibration kill switch (0% win rate = never recommend)
    vetoed_strategy = None
    if _calibration and strategy:
        cal = _calibration.get('strategy', {}).get(strategy, {})
        n = cal.get('total', 0)
        rate = cal.get('rate', 0.5)
        if n >= 5 and rate < 0.15:
            conflicts.append(f"VETO: {strategy} wins {cal.get('wins',0)}/{n} ({rate*100:.0f}%). Brain refuses.")
            vetoed_strategy = strategy
            strategy = None
            action = 'WAIT'
        elif n >= 5 and rate < 0.3:
            confidence -= 20
            conflicts.append(f"Your {strategy}: {cal.get('wins',0)}/{n} ({rate*100:.0f}%)")
        elif n >= 5 and rate > 0.7:
            confidence += 10

    # b92: Candidate menu awareness — does recommended strategy have viable candidates?
    if strategy and candidates and cand_insights is not None:
        strat_cands = [c for c in (candidates or []) if c.get('type') == strategy]
        if not strat_cands:
            conflicts.append(f"No {strategy} candidates generated")
            confidence -= 10
        elif strat_cands:
            # Check if ALL candidates of this type have caution insights
            all_cautioned = True
            for sc in strat_cands:
                cid = sc.get('id', '')
                c_ins = cand_insights.get(cid, [])
                has_severe = any(i.get('strength', 0) >= 4 and i.get('impact') == 'caution' for i in c_ins)
                if not has_severe:
                    all_cautioned = False
                    break
            if all_cautioned and len(strat_cands) > 0:
                conflicts.append(f"All {strategy} candidates have risk warnings")
                confidence -= 15

    # b95: SMART FALLBACK — if recommended strategy is dead, find best available alternative
    # Triggers when: (a) no candidates generated, (b) calibration <30%, OR (c) strategy was VETOED
    needs_fallback = False
    original_strategy = strategy or vetoed_strategy  # capture even if vetoed to None
    if candidates:
        if vetoed_strategy:
            needs_fallback = True  # veto killed it — MUST find alternative
        elif strategy:
            has_cands = any(c.get('type') == strategy for c in candidates)
            cal_dead = False
            if _calibration:
                cal_check = _calibration.get('strategy', {}).get(strategy, {})
                cal_dead = cal_check.get('total', 0) >= 5 and cal_check.get('rate', 0.5) < 0.3
            if not has_cands or cal_dead:
                needs_fallback = True

    if needs_fallback and candidates:
        # Score each available strategy type by: calibration win rate × number of candidates
        available_types = {}
        for c in candidates:
            ct = c.get('type', '')
            if ct not in available_types:
                available_types[ct] = {'count': 0, 'best_score': 0}
            available_types[ct]['count'] += 1
            available_types[ct]['best_score'] = max(available_types[ct]['best_score'], c.get('contextScore', 0))

        best_alt = None
        best_alt_score = -999
        for ct, info in available_types.items():
            if info['count'] == 0: continue
            # Calibration rate (default 0.5 if unknown)
            cal_rate = 0.5
            if _calibration:
                cal_s = _calibration.get('strategy', {}).get(ct, {})
                if cal_s.get('total', 0) >= 3:
                    cal_rate = cal_s.get('rate', 0.5)
            # Score = calibration × log(count+1) × context quality
            score = cal_rate * math.log(info['count'] + 1) * (1 + info['best_score'])
            # Bonus for IC/IB in range regime
            if ct in ('IRON_CONDOR', 'IRON_BUTTERFLY') and rtype == 'range':
                score *= 1.5
            if score > best_alt_score:
                best_alt_score = score
                best_alt = ct

        if best_alt and best_alt != original_strategy:
            # Determine action from strategy type
            credit_types = ['BEAR_CALL', 'BULL_PUT', 'IRON_CONDOR', 'IRON_BUTTERFLY']
            alt_action = 'SELL PREMIUM' if best_alt in credit_types else 'BUY PREMIUM'
            conflicts.append(f"Fallback: {original_strategy} → {best_alt} (available + proven)")
            strategy = best_alt
            action = alt_action
            # Restore some confidence — we found a viable alternative
            confidence = max(confidence, 30)

    # ═══ b92: FULL OMNISCIENCE CHECKS — use all 12 new data streams ═══

    # Trade mode conflict — brain recommends IC/IB but user is in SWING
    tm = ctx.get('tradeMode', 'swing')
    if strategy in ('IRON_CONDOR', 'IRON_BUTTERFLY') and tm == 'swing':
        conflicts.append(f"{strategy} is intraday only — switch to INTRADAY")
        confidence -= 20

    # Overnight delta conflict — brain says BULL but overnight is BEAR
    od = ctx.get('overnightDelta')
    if od and od.get('summary'):
        if 'BEARISH' in od['summary'] and direction == 'BULL':
            conflicts.append("Overnight BEARISH vs brain BULL")
            confidence -= 10
        elif 'BULLISH' in od['summary'] and direction == 'BEAR':
            conflicts.append("Overnight BULLISH vs brain BEAR")
            confidence -= 10

    # Institutional regime — low credit confidence but selling premium
    ir = ctx.get('institutionalRegime')
    if ir and ir.get('creditConfidence') == 'LOW' and action == 'SELL PREMIUM':
        conflicts.append("Low institutional credit confidence")
        confidence -= 10

    # Bias drift — morning thesis no longer holds
    drift = ctx.get('biasDrift', 0)
    if abs(drift) >= 2:
        conflicts.append(f"Bias drifted {drift:+d} from morning")
        confidence -= 10

    # Scan freshness — stale data
    scan_age = ctx.get('scanAgeMin')
    if scan_age and scan_age >= 30:
        conflicts.append(f"Data is {scan_age}min stale — rescan first")
        confidence -= 15

    # Global direction conflict — Dow/Crude/GIFT contradict brain direction
    gd = ctx.get('globalDirection') or {}
    gd_conflicts = 0
    if gd.get('dowPct') is not None and abs(gd['dowPct']) >= 0.5:
        dow_bull = gd['dowPct'] > 0
        if (dow_bull and direction == 'BEAR') or (not dow_bull and direction == 'BULL'):
            gd_conflicts += 1
    if gd.get('crudePct') is not None and abs(gd['crudePct']) >= 1.5:
        crude_bull = gd['crudePct'] < 0  # crude up = bearish for India
        if (crude_bull and direction == 'BEAR') or (not crude_bull and direction == 'BULL'):
            gd_conflicts += 1
    if gd.get('giftPct') is not None and abs(gd['giftPct']) >= 0.3:
        gift_bull = gd['giftPct'] > 0
        if (gift_bull and direction == 'BEAR') or (not gift_bull and direction == 'BULL'):
            gd_conflicts += 1
    if gd_conflicts >= 2:
        conflicts.append(f"Global direction contradicts ({gd_conflicts}/3 against)")
        confidence -= 15

    # Brain flip-flop detection — prior verdict contradicts current
    prior = ctx.get('priorVerdict')
    if prior and prior.get('direction') and prior['direction'] != direction:
        if prior.get('confidence', 0) >= 40:
            conflicts.append(f"Flip: was {prior['direction']} {prior.get('confidence',0)}% → now {direction}")
            confidence -= 10

    # Varsity alignment — brain strategy vs Varsity PRIMARY
    vf = ctx.get('varsityFilter')
    if vf and strategy:
        if strategy in (vf.get('primary') or []):
            confidence += 5  # brain agrees with Varsity
        elif strategy not in (vf.get('allowed') or []) and strategy not in (vf.get('primary') or []):
            conflicts.append(f"Brain picks {strategy} but Varsity doesn't allow it")
            confidence -= 10

    # Urgency
    mins = get_time_mins(polls[-1].get('t', '')) - 555 if polls else 0
    if 135 <= mins <= 315: urgency = 'ENTER NOW'
    elif mins < 15: urgency = 'WAIT — opening noise'
    elif mins > 345: urgency = 'WINDOW CLOSED'
    else: urgency = 'READY'

    # Daily P&L gate
    if ctx.get('dailyPnl', 0) < -2000:
        action, strategy, urgency = 'STOP', None, 'DONE FOR TODAY'
        confidence = 0
    elif ctx.get('dailyTradeCount', 0) >= 3:
        confidence -= 15
        if confidence < 50: urgency = 'CAUTION — 3+ trades today'

    confidence = max(0, min(100, confidence))
    if action == 'WAIT' or action == 'STOP':
        confidence = 0

    # Build reasoning
    reasons = []
    if rtype != 'unknown': reasons.append(f"{'Range' if rtype=='range' else 'Trend' if rtype=='trend' else rtype.title()} {regime.get('sigma',0):.1f}σ")
    if vix_z >= 1.5: reasons.append(f"VIX {vix:.1f} (Z:{vix_z:+.1f} EXTREME)")
    elif vix_z >= 0.5: reasons.append(f"VIX {vix:.1f} (Z:{vix_z:+.1f} HIGH)")
    elif vix_z <= -1.0: reasons.append(f"VIX {vix:.1f} (Z:{vix_z:+.1f} LOW)")
    if abs(b_pct - 50) > 10: reasons.append(f"Breadth {'strong' if b_pct>60 else 'weak'} ({b_pct:.0f}%)")
    if abs(fii_sum) > 1000: reasons.append(f"FII {'+' if fii_sum>0 else ''}₹{fii_sum:.0f}Cr/5d")
    if abs(skew) > 2: reasons.append(f"Skew {'steep' if skew>0 else 'flat'} ({skew:.0f})")
    if dte <= 1: reasons.append(f"EXPIRY (DTE {dte})")
    if _calibration and strategy:
        cal = _calibration.get('strategy', {}).get(strategy, {})
        if cal.get('total', 0) >= 3:
            reasons.append(f"Your {strategy}: {cal.get('wins',0)}/{cal['total']}")
    # b92: Context-aware reasoning
    if ctx.get('tradeMode') == 'intraday': reasons.append("Mode: INTRADAY")
    if od and 'BEARISH' in od.get('summary', ''): reasons.append("Overnight: BEAR")
    elif od and 'BULLISH' in od.get('summary', ''): reasons.append("Overnight: BULL")
    if gd_conflicts >= 2: reasons.append(f"Global: {gd_conflicts}/3 against")
    if abs(drift) >= 2: reasons.append(f"Drift: {drift:+d}")
    if straddle_expanding and straddle_chg > 3: reasons.append(f"Straddle expanding +₹{straddle_chg:.0f}")
    reasons.append(f"Bull {bull:.1f} vs Bear {bear:.1f}")

    return {
        "action": action, "strategy": strategy, "direction": direction,
        "confidence": confidence, "urgency": urgency,
        "reasoning": " · ".join(reasons[:8]),
        "conflicts": conflicts, "bull": round(bull, 2), "bear": round(bear, 2)
    }

def position_verdict(trade, insights, regime, ctx):
    """ONE action per trade: BOOK / HOLD / EXIT + urgency + reason.
    b89: Now receives wallDrift, vixChange, peakErosion from JS poll loop.
    Brain is the SINGLE decision maker — weighs ALL signals together."""
    pnl = trade.get('current_pnl', 0)
    max_p = trade.get('max_profit', 1)
    max_l = trade.get('max_loss', 1)
    ci = trade.get('controlIndex')
    pnl_pct = pnl / max_p if max_p > 0 else 0
    loss_pct = abs(pnl) / max_l if max_l > 0 and pnl < 0 else 0
    stype = trade.get('strategy_type', '')
    is_4leg = stype in ('IRON_CONDOR', 'IRON_BUTTERFLY')
    is_ib = stype == 'IRON_BUTTERFLY'
    is_credit = trade.get('is_credit', False)
    dte = ctx.get('bnfDTE' if trade.get('index_key') == 'BNF' else 'nfDTE', 5)
    phase = ctx.get('marketPhase', 'UNKNOWN')

    # b89: New signals from poll loop
    wall = trade.get('wallDrift') or {}
    wall_sev = wall.get('severity', 0)
    vix_chg = trade.get('vixChange', 0)
    peak_erosion = trade.get('peakErosion', 0)  # % of peak lost
    peak_pnl = trade.get('peak_pnl', 0)

    # Check insights for strong signals
    has_wall = any(i.get('label', '').startswith('Wall') for i in insights)
    against_trend = any('Against' in i.get('label', '') for i in insights)
    momentum_threat = any('sell strike' in i.get('label', '').lower() for i in insights)

    # ═══ DANGER SCORE — compound risk assessment ═══
    danger = 0
    reasons = []

    # Wall drift
    if wall_sev >= 2:
        danger += 40
        reasons.append(f"Wall EXPOSED ({wall.get('warning', '')[:50]})")
    elif wall_sev == 1:
        danger += 15
        reasons.append("Wall weakened")

    # VIX spike (worst for credit sellers)
    if is_credit and vix_chg >= 2.0:
        danger += 35
        reasons.append(f"VIX spiked +{vix_chg:.1f} — premiums expanding")
    elif is_credit and vix_chg >= 1.0:
        danger += 15
        reasons.append(f"VIX rising +{vix_chg:.1f}")

    # Peak erosion — SCALED (b104 fix: 864% got same score as 51%)
    # Debit trades: premium decay from theta is EXPECTED, halve the impact
    erosion_mult = 0.5 if not is_credit else 1.0
    if peak_pnl >= 500 and peak_erosion > 0:  # Gemini fix: ignore tiny peaks (<₹500)
        if peak_erosion > 500:
            danger += int(40 * erosion_mult)
            reasons.append(f"Peak erosion {peak_erosion:.0f}% (was ₹{peak_pnl:.0f})")
        elif peak_erosion > 200:
            danger += int(30 * erosion_mult)
            reasons.append(f"Peak erosion {peak_erosion:.0f}% (was ₹{peak_pnl:.0f})")
        elif peak_erosion > 50:
            danger += int(20 * erosion_mult)
            reasons.append(f"Peak erosion {peak_erosion:.0f}% (was ₹{peak_pnl:.0f})")
        elif peak_erosion > 30:
            danger += int(10 * erosion_mult)
            reasons.append(f"Profit fading ({peak_erosion:.0f}% from peak)")

    # Profit-to-loss flip — was making money, now losing (b104 fix: NOT CHECKED before)
    if peak_pnl > 0 and pnl < 0:
        danger += 15
        reasons.append(f"Flipped from +₹{peak_pnl:.0f} to -₹{abs(pnl):.0f}")

    # CI — RELAXED thresholds (b104 fix: CI -5 got ZERO before)
    # Gemini fix: IB not totally exempt — check for extreme degradation beyond baseline
    # IB baseline CI is ~-50 (ATM sell). Only danger if it drops much further.
    if ci is not None:
        if is_ib:
            # IB: normal CI is -40 to -60. Only panic below -75
            if ci < -75:
                danger += 20
                reasons.append(f"IB CI collapsed to {ci} (beyond normal ATM range)")
        else:
            if ci < -40:
                danger += 25
                reasons.append(f"Opponent in control (CI {ci})")
            elif ci < -20:
                danger += 15
                reasons.append(f"Opponent gaining (CI {ci})")
            elif ci < 0:
                danger += 5

    # b115: Breakeven cushion — the REAL danger line, not sell strike
    # be_upper = upper breakeven (IC/IB/Bear Call), be_lower = lower breakeven (IC/IB/Bull Put)
    be_upper = trade.get('be_upper') or trade.get('beUpper')
    be_lower = trade.get('be_lower') or trade.get('beLower')
    sell_strike = trade.get('sell_strike', 0)
    spot = trade.get('current_spot', 0)
    if spot and (be_upper or be_lower):
        vix = ctx.get('vix', 20)
        daily_sigma = spot * (vix / 100) / 15.87 if spot > 0 else 300
        if is_4leg and be_upper and be_lower:
            upper_cushion = be_upper - spot
            lower_cushion = spot - be_lower
            near_cushion = min(upper_cushion, lower_cushion)
            near_label = f"upper BE {be_upper}" if upper_cushion < lower_cushion else f"lower BE {be_lower}"
        elif be_upper:
            near_cushion = be_upper - spot
            near_label = f"BE {be_upper}"
        else:
            near_cushion = spot - be_lower
            near_label = f"BE {be_lower}"
        if daily_sigma > 0:
            cushion_sigma = near_cushion / daily_sigma
            if near_cushion <= 0:
                danger += 40
                reasons.append(f"BREACHED — spot past {near_label}")
            elif cushion_sigma < 0.15:
                danger += 30
                reasons.append(f"Only {near_cushion:.0f}pts to {near_label} ({cushion_sigma:.2f}σ)")
            elif cushion_sigma < 0.30:
                danger += 20
                reasons.append(f"Thin BE cushion {near_cushion:.0f}pts to {near_label}")
            elif cushion_sigma < 0.50:
                danger += 10
                reasons.append(f"Approaching {near_label} ({near_cushion:.0f}pts)")
        # b115: Early BOOK — profitable + near breakeven = take money now
        if pnl > 0 and near_cushion > 0 and daily_sigma > 0 and near_cushion / daily_sigma < 0.20:
            return {"action": "BOOK", "urgency": "NOW",
                    "reason": f"₹{pnl:.0f} profit but only {near_cushion:.0f}pts to {near_label}. Premium at risk — lock in now."}
    elif sell_strike and spot and is_credit and not is_ib:
        # Fallback: use sell_strike if no breakeven stored (old trades)
        cushion = abs(sell_strike - spot)
        vix = ctx.get('vix', 20)
        daily_sigma = spot * (vix / 100) / 15.87 if spot > 0 else 300
        if daily_sigma > 0:
            cushion_sigma = cushion / daily_sigma
            if cushion_sigma < 0.25:
                danger += 25
                reasons.append(f"Only {cushion:.0f}pts ({cushion_sigma:.2f}σ) from sell strike")

    # Momentum threat
    if momentum_threat:
        danger += 30
        reasons.append("Spot approaching sell strike")

    # Phase mismatch (credit in trending phase = danger)
    if is_credit and phase == 'TRENDING':
        danger += 10
        reasons.append("Trending market — credit at risk")

    # b96: "Past the wall" insight — position_wall_proximity detected exposure
    past_wall = any('Past the wall' in i.get('label', '') for i in insights)
    if past_wall:
        danger += 35
        reasons.append("Sell past OI wall — no protection")

    # b96: Loss magnitude — deep loss even with stable danger should escalate
    if pnl < 0:
        if loss_pct > 0.5:
            danger += 30
            reasons.append(f"Deep loss ({loss_pct*100:.0f}% of max)")
        elif loss_pct > 0.3:
            danger += 15
            reasons.append(f"Significant loss ({loss_pct*100:.0f}% of max)")

    # ═══ EXIT — compound danger high ═══
    if danger >= 60:
        urgency = 'NOW' if danger >= 80 else 'SOON'
        return {"action": "EXIT", "urgency": urgency,
                "reason": f"Danger {danger}/100. {'. '.join(reasons[:3])}"}

    # ═══ b114: THESIS_BROKEN — entry bias contradicts current effective bias ═══
    # Directional credit spreads need bias alignment to survive. If bias flips, exit.
    entry_bias = trade.get('entry_bias', '')
    current_bias = (ctx.get('effective_bias') or {}).get('bias', '') or ''
    thesis_broken = False
    if is_credit and not is_4leg and entry_bias and current_bias:
        bull_entry = 'BULL' in entry_bias.upper()
        bear_entry = 'BEAR' in entry_bias.upper()
        bull_now = 'BULL' in current_bias.upper()
        bear_now = 'BEAR' in current_bias.upper()
        if (bull_entry and bear_now) or (bear_entry and bull_now):
            thesis_broken = True
    if thesis_broken and pnl < 0:
        return {"action": "EXIT", "urgency": "SOON",
                "reason": f"Thesis broken. Entered {entry_bias}, market now {current_bias}. Credit spread fighting the trend."}
    if thesis_broken and pnl >= 0:
        return {"action": "BOOK", "urgency": "NOW",
                "reason": f"Thesis broken — market flipped {entry_bias}→{current_bias}. Lock in ₹{pnl:.0f} before it reverses."}

    # ═══ EXIT — structural threats (independent of danger score) ═══
    if is_4leg and dte <= 1:
        if pnl > 0:
            return {"action": "BOOK", "urgency": "NOW", "reason": "4-leg + expiry day. 0% overnight survival."}
        else:
            return {"action": "EXIT", "urgency": "NOW", "reason": "4-leg + expiry. Cut loss, don't hold overnight."}

    # ═══ BOOK — profitable + reasons to take money ═══
    if pnl_pct >= 0.5:
        book_reasons = []
        if danger >= 30: book_reasons.append(f"rising danger ({danger})")
        if peak_erosion > 20: book_reasons.append(f"peak fading {peak_erosion:.0f}%")
        if regime.get('type') == 'range': book_reasons.append("range — theta captured")
        if vix_chg < -1.0 and is_credit: book_reasons.append(f"VIX crushed {vix_chg:.1f} — lock gains")
        urgency = 'NOW' if pnl_pct >= 0.7 or danger >= 30 else 'SOON'
        reason = f"{pnl_pct*100:.0f}% of max."
        if book_reasons: reason += f" {'. '.join(book_reasons[:2])}"
        return {"action": "BOOK", "urgency": urgency, "reason": reason}

    if pnl_pct >= 0.3 and (against_trend or danger >= 25):
        return {"action": "BOOK", "urgency": "SOON",
                "reason": f"{pnl_pct*100:.0f}% profit + {'risk building' if danger >= 25 else 'against trend'}. Don't give it back."}

    # ═══ HOLD — positive conditions ═══
    if pnl > 0 and danger < 20:
        hold_reasons = []
        if ci and ci > 20: hold_reasons.append(f"CI {ci}")
        if has_wall and wall_sev == 0: hold_reasons.append("wall protecting")
        if regime.get('type') == 'range': hold_reasons.append("range — theta working")
        if vix_chg < 0 and is_credit: hold_reasons.append("VIX falling — good for credit")
        reason = f"P&L ₹{pnl:.0f} ({pnl_pct*100:.0f}%)."
        if hold_reasons: reason += f" {'. '.join(hold_reasons[:2])}"
        return {"action": "HOLD", "urgency": "WATCH", "reason": reason}

    # ═══ DEFAULT ═══
    if pnl >= 0:
        return {"action": "HOLD", "urgency": "WATCH", "reason": f"P&L ₹{pnl:.0f}. Danger {danger}/100."}
    else:
        return {"action": "HOLD", "urgency": "MONITOR",
                "reason": f"Loss ₹{pnl:.0f} ({loss_pct*100:.0f}%). Danger {danger}/100. {'. '.join(reasons[:2]) if reasons else 'Watch CI.'}"}

# ═══════════════════════════════════════════
# PHASE 3 — BRAIN CANDIDATE GENERATION
# ═══════════════════════════════════════════

def _ltp(sd, strike, ot):
    k = str(int(strike))
    return ((sd.get(k) or sd.get(int(strike)) or {}).get(ot) or {}).get('ltp', 0) or 0

def _delta_val(sd, strike, ot):
    k = str(int(strike))
    d = ((sd.get(k) or sd.get(int(strike)) or {}).get(ot) or {}).get('delta', None)
    return d

def _oi_val(sd, strike, ot):
    k = str(int(strike))
    return ((sd.get(k) or sd.get(int(strike)) or {}).get(ot) or {}).get('oi', 0) or 0

def _forces_py(stype, bias, iv_pctl):
    credit = stype in ('BULL_PUT', 'BEAR_CALL', 'IRON_CONDOR', 'IRON_BUTTERFLY')
    debit = stype in ('BULL_CALL', 'BEAR_PUT')
    bull_dir = stype in ('BULL_CALL', 'BULL_PUT')
    bear_dir = stype in ('BEAR_CALL', 'BEAR_PUT')
    f1 = 0
    if bull_dir: f1 = 1 if bias in ('BULL', 'MILD_BULL', 'STRONG_BULL') else (-1 if bias in ('BEAR', 'MILD_BEAR', 'STRONG_BEAR') else 0)
    if bear_dir: f1 = 1 if bias in ('BEAR', 'MILD_BEAR', 'STRONG_BEAR') else (-1 if bias in ('BULL', 'MILD_BULL', 'STRONG_BULL') else 0)
    f2 = 1 if credit else -1
    iv_high = iv_pctl is None or iv_pctl >= 25
    if iv_high: f3 = 1 if credit else 0
    else: f3 = 1 if debit else -1
    return {'f1': f1, 'f2': f2, 'f3': f3, 'aligned': f1 + f2 + f3}

def _varsity_py(bias, iv_pctl, vix):
    iv_high = vix >= 20 or (iv_pctl is not None and iv_pctl >= 25)
    if 'BULL' in (bias or ''):
        return ['BULL_PUT', 'BULL_CALL', 'IRON_CONDOR', 'IRON_BUTTERFLY'] if iv_high else ['BULL_CALL', 'BULL_PUT', 'IRON_BUTTERFLY', 'IRON_CONDOR']
    elif 'BEAR' in (bias or ''):
        return ['BEAR_CALL', 'BEAR_PUT', 'IRON_CONDOR', 'IRON_BUTTERFLY'] if iv_high else ['BEAR_PUT', 'BEAR_CALL', 'IRON_BUTTERFLY', 'IRON_CONDOR']
    else:
        return ['IRON_BUTTERFLY', 'IRON_CONDOR', 'BULL_PUT', 'BEAR_CALL']

def _closest(all_s, target):
    return min(all_s, key=lambda x: abs(x - target))

def _build_cand_py(stype, atm, width, step, all_s, sd, spot, lot, daily_sig, idx, expiry, dte, forces, capital, chain):
    try:
        sell_k = sell_t = buy_k = buy_t = None
        sell_k2 = sell_t2 = buy_k2 = buy_t2 = None

        if stype == 'BULL_CALL':
            buy_k, sell_k, buy_t, sell_t = atm, _closest(all_s, atm + width), 'CE', 'CE'
        elif stype == 'BEAR_PUT':
            buy_k, sell_k, buy_t, sell_t = atm, _closest(all_s, atm - width), 'PE', 'PE'
        elif stype == 'BULL_PUT':
            sell_k = _closest(all_s, atm - round(0.5 * daily_sig / step) * step)
            buy_k = _closest(all_s, sell_k - width)
            buy_t = sell_t = 'PE'
        elif stype == 'BEAR_CALL':
            sell_k = _closest(all_s, atm + round(0.5 * daily_sig / step) * step)
            buy_k = _closest(all_s, sell_k + width)
            buy_t = sell_t = 'CE'
        elif stype == 'IRON_BUTTERFLY':
            sell_k, buy_k, sell_t, buy_t = atm, _closest(all_s, atm + width), 'CE', 'CE'
            sell_k2, buy_k2, sell_t2, buy_t2 = atm, _closest(all_s, atm - width), 'PE', 'PE'
        elif stype == 'IRON_CONDOR':
            sell_k = _closest(all_s, atm + round(0.5 * daily_sig / step) * step)
            buy_k = _closest(all_s, sell_k + width)
            sell_k2 = _closest(all_s, atm - round(0.5 * daily_sig / step) * step)
            buy_k2 = _closest(all_s, sell_k2 - width)
            sell_t = buy_t = 'CE'; sell_t2 = buy_t2 = 'PE'

        if sell_k is None or buy_k is None: return None

        sl = _ltp(sd, sell_k, sell_t); bl = _ltp(sd, buy_k, buy_t)
        if sl <= 0 or bl <= 0: return None

        sl2 = bl2 = 0
        if sell_k2 is not None:
            sl2 = _ltp(sd, sell_k2, sell_t2); bl2 = _ltp(sd, buy_k2, buy_t2)
            if sl2 <= 0 or bl2 <= 0: return None

        credit = stype in ('BULL_PUT', 'BEAR_CALL', 'IRON_CONDOR', 'IRON_BUTTERFLY')
        if stype in ('IRON_BUTTERFLY', 'IRON_CONDOR'):
            net = (sl + sl2) - (bl + bl2)
        elif credit: net = sl - bl
        else: net = bl - sl

        if net <= 0: return None

        if credit: mp = round(net * lot); ml = round((width - net) * lot)
        else: mp = round((width - net) * lot); ml = round(net * lot)

        if ml <= 0 or mp <= 0: return None
        if ml > capital * 0.10: return None

        sd_val = _delta_val(sd, sell_k, sell_t)
        prob = max(0.50, min(0.97, (1 - abs(sd_val)) if sd_val is not None else 0.65))

        ev = prob * mp - (1 - prob) * ml
        if ev <= 0: return None

        cand = {
            'id': f"{idx}_{stype}_{sell_k}_{width}_py",
            'index': idx, 'type': stype, 'expiry': expiry, 'tDTE': dte,
            'sellStrike': sell_k, 'sellType': sell_t, 'sellLTP': round(sl, 2),
            'buyStrike': buy_k, 'buyType': buy_t, 'buyLTP': round(bl, 2),
            'width': width, 'netPremium': round(net, 2), 'isCredit': credit,
            'maxProfit': mp, 'maxLoss': ml, 'riskReward': round(mp/ml, 2),
            'probProfit': round(prob, 3), 'pRange': round(prob, 3),
            'ev': round(ev), 'ev1k': round(ev / (ml / 1000)) if ml > 0 else 0,
            'forces': forces, 'varsityTier': 1 if forces['aligned'] == 3 else 2,
            'source': 'brain'
        }
        if sell_k2 is not None:
            cand.update({'sellStrike2': sell_k2, 'sellType2': sell_t2, 'sellLTP2': round(sl2, 2),
                         'buyStrike2': buy_k2, 'buyType2': buy_t2, 'buyLTP2': round(bl2, 2)})
        # b115: Breakeven — real danger lines
        if stype in ('IRON_BUTTERFLY', 'IRON_CONDOR'):
            cand['beUpper'] = round(sell_k + net)
            cand['beLower'] = round((sell_k2 if sell_k2 else sell_k) - net)
        elif credit:
            if sell_t == 'CE': cand['beUpper'] = round(sell_k + net)
            else: cand['beLower'] = round(sell_k - net)
        else:
            if buy_t == 'CE': cand['beUpper'] = round(buy_k + net)
            else: cand['beLower'] = round(buy_k - net)
        return cand
    except: return None

def generate_candidates_py(ctx, effective_bias):
    """Phase 3: Brain generates trade candidates directly from chain data."""
    eb = effective_bias or {}
    bias = eb.get('bias', 'NEUTRAL')
    iv_pctl = ctx.get('ivPercentile', None)
    vix = ctx.get('vix', 18) or 18
    capital = ctx.get('capital', 250000)
    trade_mode = ctx.get('tradeMode', 'intraday')
    allowed = _varsity_py(bias, iv_pctl, vix)

    candidates = []
    for idx in ['NF', 'BNF']:
        chain = ctx.get('bnfChain' if idx == 'BNF' else 'nfChain', {})
        if not chain: continue
        atm = chain.get('atm')
        sd = chain.get('strikes', {})
        all_s_raw = chain.get('allStrikes', list(sd.keys()))
        if not atm or not sd or not all_s_raw: continue
        try:
            all_s = sorted([int(k) for k in all_s_raw])
        except: continue
        if len(all_s) < 4: continue
        step = all_s[1] - all_s[0] if len(all_s) > 1 else (100 if idx == 'BNF' else 50)
        spot = chain.get('spot', atm)
        lot = 30 if idx == 'BNF' else 65
        atm_iv = chain.get('atmIv', 0) or 0
        daily_sig = (atm_iv / 100) * spot / 15.87 if atm_iv > 0 else step * 3
        expiry = chain.get('expiry', ctx.get('bnfExpiry' if idx == 'BNF' else 'nfExpiry', ''))
        dte = ctx.get('bnfDTE' if idx == 'BNF' else 'nfDTE', 4)
        widths = [400, 500, 600, 800, 1000] if idx == 'BNF' else [100, 150, 200, 250, 300, 400]

        for stype in allowed:
            if stype in ('IRON_CONDOR', 'IRON_BUTTERFLY') and trade_mode == 'swing' and (dte or 0) > 2:
                continue
            forces = _forces_py(stype, bias, iv_pctl)
            if forces['aligned'] < 1: continue
            for width in widths:
                c = _build_cand_py(stype, atm, width, step, all_s, sd, spot, lot,
                                   daily_sig, idx, expiry, dte, forces, capital, chain)
                if c: candidates.append(c)

    candidates.sort(key=lambda c: c.get('ev', 0), reverse=True)
    return candidates[:25]

# ═══════════════════════════════════════════
# MAIN ENTRY POINT
# ═══════════════════════════════════════════

def analyze(poll_json, trades_json, baseline_json, open_trades_json, candidates_json, strike_oi_json, context_json='{}'):
    polls = json.loads(poll_json)
    closed_trades = json.loads(trades_json) if trades_json else []
    baseline = json.loads(baseline_json) if baseline_json else {}
    open_trades = json.loads(open_trades_json) if open_trades_json else []
    candidates = json.loads(candidates_json) if candidates_json else []
    strike_oi = json.loads(strike_oi_json) if strike_oi_json else {}
    ctx = json.loads(context_json) if context_json else {}

    result = {"verdict": None, "market": [], "positions": {}, "candidates": {}, "timing": [], "risk": []}
    if len(polls) < 3:
        return json.dumps(result)

    # Set capital from JS context (single source of truth: C.CAPITAL)
    global _capital
    _capital = ctx.get('capital', 110000)

    build_calibration(closed_trades)
    regime = detect_regime(polls, baseline)

    # Market (existing 8 + new 7)
    for fn in [pcr_velocity, oi_wall_shift, vix_momentum, spot_exhaustion,
               regime_detector, futures_premium_trend, oi_velocity, institutional_clock]:
        try:
            r = fn(polls, baseline)
            if r: result["market"].append(r)
        except: pass
    # New context-aware market functions
    for fn in [signal_coherence, max_pain_gravity, fii_trend, nf_bnf_divergence,
               day_range_position, wall_freshness, yesterday_signal_prior]:
        try:
            r = fn(polls, ctx)
            if r: result["market"].append(r)
        except: pass
    # b92: chain_intelligence returns LIST (was single dict)
    try:
        ci_insights = chain_intelligence(polls, ctx)
        if ci_insights:
            result["market"].extend(ci_insights)
    except: pass

    # Positions — verdict + insights
    for t in open_trades:
        tid = t.get("id", "")
        ins = []
        soi = strike_oi.get(tid, [])
        for fn in [position_wall_proximity, position_momentum_threat,
                   position_regime_fit, position_vix_headwind, position_book_signal]:
            try:
                r = fn(t, polls, baseline, regime, soi)
                if r: ins.append(r)
            except: pass
        try:
            r = position_gamma_alert(t, polls, soi)
            if r: ins.append(r)
        except: pass
        pv = position_verdict(t, ins, regime, ctx)
        result["positions"][tid] = {"verdict": pv, "insights": ins}

    # Candidates — existing + liquidity + pattern match + b92 risk evaluation
    for c in candidates:
        cid = c.get("id", "")
        ins = []
        for fn in [candidate_flow_alignment, candidate_wall_protection, candidate_regime_fit, candidate_pattern_match]:
            try:
                r = fn(c, polls, baseline, regime)
                if r: ins.append(r)
            except: pass
        try:
            r = candidate_liquidity(c, ctx)
            if r: ins.append(r)
        except: pass
        # b92: Deep risk evaluation (returns LIST) — cost trap, conflict, R:R, force coherence
        try:
            risk_ins = evaluate_candidate_risk(c, ctx, open_trades, regime)
            if risk_ins: ins.extend(risk_ins)
        except: pass
        if ins: result["candidates"][cid] = ins

    # Timing — existing + DTE urgency
    for fn in [timing_entry_window, timing_wait_signal]:
        try:
            r = fn(polls, baseline, regime)
            if r: result["timing"].append(r)
        except: pass
    try:
        r = dte_urgency(polls, ctx)
        if r: result["timing"].append(r)
    except: pass

    # Risk — existing + daily PnL
    for fn in [risk_kelly_headroom, risk_regime_shift, risk_exit_analysis, risk_factor_importance, risk_streak_warning]:
        try:
            r = fn(polls, baseline, open_trades, closed_trades)
            if r: result["risk"].append(r)
        except: pass
    try:
        r = daily_pnl_check(polls, ctx)
        if r: result["risk"].append(r)
    except: pass

    # ═══ THE VERDICT ═══
    all_insights = result["market"] + result["timing"] + result["risk"]
    try:
        result["verdict"] = synthesize_verdict(all_insights, regime, ctx, polls, baseline, candidates, result.get("candidates", {}))
    except: pass

    # b97: Effective bias — Bayesian decay of morning prior with intraday evidence
    try:
        result["effective_bias"] = compute_effective_bias(polls, baseline, ctx, regime)
    except: pass

    # Phase 3: Brain candidate generation using effective_bias
    try:
        result["generated_candidates"] = generate_candidates_py(ctx, result.get("effective_bias"))
    except Exception as e:
        result["generated_candidates"] = []
        result["candidate_error"] = str(e)

    return json.dumps(result)
`;

// ═══ APP STATE ═══
const STATE = {
    // Morning baseline (locked on user input)
    baseline: null,     // { timestamp, nfSpot, bnfSpot, vix, nfAtmIv, bnfAtmIv, pcr, maxPain, futuresPremBnf }
    morningInput: null, // { fiiCash, fiiShortPct, closeChar, upstoxBias }

    // Live data (updated every poll)
    live: null,         // same shape as baseline + candidates

    // Chains (from initial fetch)
    bnfChain: null,
    nfChain: null,
    bnfExpiry: null,
    nfExpiry: null,

    // Candidates (generated from initial fetch, force-scored on every poll)
    candidates: [],
    watchlist: [],      // top candidates being tracked

    // Open trades (multiple positions supported)
    openTrades: [],

    // Premium history (from Supabase, for IV percentile)
    premiumHistory: [],

    // Direction intelligence
    bnfBreadth: null,
    nf50Breadth: null,
    contrarianPCR: [],      // legacy — kept for compatibility
    pcrContext: null,       // Phase 8.1: dynamic institutional PCR read
    fiiTrend: null,
    trajectory: null,
    controlIndex: null,
    gapInfo: null,
    nfGapInfo: null,
    marketPhase: null,
    yesterdayHistory: [],
    morningBias: null,      // Morning plan bias (persisted to localStorage)
    biasDrift: 0,           // live.biasNet - morningBias.net
    driftOverridden: false, // true when ±2 drift auto-switched to live bias
    _notified2pm: false,
    _notified315pm: false,
    _captured2pm: false,
    _captured315pm: false,
    afternoonBaseline: null,   // 2PM snapshot
    positioningResult: null,   // 3:15PM comparison result
    tomorrowSignal: null,      // BEARISH/BULLISH/NEUTRAL + strength
    signalAccuracy: null,      // { correct, total, history }
    signalAccuracyStats: null,  // { correct, total, pct }
    positioningCandidates: [],  // strategies aligned with tomorrow signal
    positioningBias: null,      // bias derived from tomorrow signal

    // Loop control
    pollTimer: null,
    routineTimer: null,
    isWatching: false,
    lastPollTime: null,
    pollCount: 0,

    // Notification tracking
    lastRoutineNotify: 0,
    lastForceState: {},  // candidateId → alignment string, to detect changes

    // σ tracking for noise filter (per-poll confirmations)
    sigmaTracking: {
        spotDirection: [],    // last N polls: +1 / -1 / 0
        vixDirection: [],
        confirmed: false
    },

    // Audio context (initialized on first user tap)
    audioCtx: null,

    // Global direction (morning reference + 3:15 PM live → auto-computed direction)
    globalDirection: { dowClose: null, crudeSettle: null, dowNow: null, crudeNow: null, giftNow: null },

    // Evening close reference (stored at 6 AM, compared with morning inputs for overnight delta)
    eveningClose: null,  // { dow, crude, gift, date }
    overnightDelta: null, // { signals, summary } — computed on morning scan

    // Phase 11: Poll history — every 5-min snapshot for intraday pattern matching
    pollHistory: [],  // [{t, nf, bnf, vix, pcr, nfPcr, callWall, callWallOI, putWall, putWallOI, maxPain, futPrem, breadth}]
    _chartIndex: 'NF',  // chart toggle: NF or BNF
    rangeDetected: false,  // b68: true when last 3 polls show ±0.3σ range
    rangeSigma: 0,         // b68: actual range in σ (for display)

    // Trade mode: 'swing' (default, 3-7 DTE, OTM near wall) or 'intraday' (0-1 DTE, ATM OK)
    tradeMode: 'swing',

    // Phase 12: Pyodide Brain — Python analysis in WebAssembly
    brainReady: false,        // true after Pyodide loaded + Python code initialized
    brainInsights: { verdict: null, market: [], positions: {}, candidates: {}, timing: [], risk: [] },
    effectiveBias: null,  // b97: Bayesian-decayed bias from brain (replaces morning bias for candidates)
    brainLastRun: 0,          // timestamp of last brain run
    brainError: null,         // last error (for debug)
    _brainLoading: false,     // prevents double-init race condition
    brainLoadStart: 0,        // perf tracking
    _pyodide: null,           // Pyodide runtime reference

    // Active tab
    activeTab: 'market'
};


// ═══════════════════════════════════════════════════════════════
// SOUND ENGINE — Corporate-subtle Web Audio notifications
// ═══════════════════════════════════════════════════════════════

/* F.2 helpers — bridge to Kotlin/brain.py single source of truth */

// `bd` is the latest brain_result snapshot. Refreshed inside renderAll() and
// any other function that needs fresh data. Defined at module-top so all
// downstream code can read bd.effective_bias, bd.candidates, etc. without
// having to call getBrainData() repeatedly per render.
let bd = {};

function getBrainData() {
    try {
        return JSON.parse(NativeBridge.getBrainResult() || '{}');
    } catch (e) {
        console.error('getBrainData failed:', e);
        return {};
    }
}

function refreshBrainData() {
    bd = getBrainData();
    return bd;
}

// collectBaselineFromForm — lifted from former initialFetch.
// Reads morning input fields and assembles the baseline JSON for Kotlin.
function collectBaselineFromForm() {
    const get = (id) => {
        const el = document.getElementById(id);
        return el ? el.value : '';
    };
    const num = (id, dflt = 0) => {
        const v = parseFloat(get(id));
        return isNaN(v) ? dflt : v;
    };
    let latestPoll = {};
    try {
        latestPoll = JSON.parse((NativeBridge && NativeBridge.getLatestPoll && NativeBridge.getLatestPoll()) || '{}');
    } catch (e) {
        latestPoll = {};
    }
    let eveningClose = null;
    try {
        eveningClose = JSON.parse(localStorage.getItem('mr2_evening_close') || 'null');
    } catch (e) {
        eveningClose = null;
    }
    return {
        date: API.todayIST(),
        bnfSpot: parseFloat(latestPoll.bnfSpot ?? latestPoll.bnf ?? 0) || 0,
        nfSpot: parseFloat(latestPoll.nfSpot ?? latestPoll.nf ?? 0) || 0,
        vix: parseFloat(latestPoll.vix ?? 0) || 0,
        bnfCallWall: parseFloat(latestPoll.bnfCallWall ?? latestPoll.cw ?? 0) || 0,
        bnfPutWall: parseFloat(latestPoll.bnfPutWall ?? latestPoll.pw ?? 0) || 0,
        fiiCash: num('in-fii-cash'),
        fiiShortPct: num('in-fii-short'),
        fiiIdxFut: num('in-fii-idx-fut'),
        fiiStkFut: num('in-fii-stk-fut'),
        diiCash: num('in-dii-cash'),
        dowClose: num('in-dow-close'),
        crudeSettle: num('in-crude-settle'),
        upstoxBias: get('in-upstox-bias'),
        eveningClose: eveningClose || undefined,
    };
}


function initAudio() {
    if (!STATE.audioCtx) {
        STATE.audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    }
    // Resume if suspended (autoplay policy)
    if (STATE.audioCtx.state === 'suspended') STATE.audioCtx.resume();
}

function playTone(freq, startTime, duration, volume = 0.08) {
    const ctx = STATE.audioCtx;
    if (!ctx) return;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(freq, startTime);
    gain.gain.setValueAtTime(volume, startTime);
    gain.gain.exponentialRampToValueAtTime(0.001, startTime + duration);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(startTime);
    osc.stop(startTime + duration + 0.05);
}

function playSound(type) {
    initAudio();
    const ctx = STATE.audioCtx;
    if (!ctx) return;
    const now = ctx.currentTime;

    switch (type) {
        case 'routine':
            // Soft single ding — like a Slack notification
            playTone(880, now, 0.12, 0.05);
            break;
        case 'important':
            // Two-tone ascending chime — opportunity detected
            playTone(660, now, 0.15, 0.08);
            playTone(880, now + 0.18, 0.2, 0.08);
            break;
        case 'urgent':
            // Three-tone ascending — exit signal
            playTone(587, now, 0.12, 0.1);
            playTone(740, now + 0.15, 0.12, 0.1);
            playTone(988, now + 0.3, 0.25, 0.12);
            break;
        case 'entry':
            // Warm two-tone — 3/3 alignment detected
            playTone(523, now, 0.2, 0.1);
            playTone(784, now + 0.25, 0.3, 0.1);
            break;
    }
}


// ═══════════════════════════════════════════════════════════════
// BIAS ENGINE — Direction from morning inputs + live chain data
// ═══════════════════════════════════════════════════════════════



// ═══════════════════════════════════════════════════════════════
// INSTITUTIONAL REGIME CLASSIFIER — Phase 7
// Uses FII Cash, DII Cash, FII Idx Fut, FII Stk Fut to classify
// market regime. This does NOT add bias votes — it adds CONFIDENCE
// to existing forces. Premium is king; this tells us how safely.
// ═══════════════════════════════════════════════════════════════



// ═══════════════════════════════════════════════════════════════
// FORCE ALIGNMENT ENGINE — The heart of v2
// ═══════════════════════════════════════════════════════════════






// ═══════════════════════════════════════════════════════════════
// DIRECTION INTELLIGENCE — v1 knowledge carried forward
// ═══════════════════════════════════════════════════════════════

// 3. Contrarian PCR Flag — extreme readings = reversal warning

// 3b. Dynamic Institutional PCR — context-aware, 3 phases
// Phase A (9:15→2PM): PCR level + VIX + gap → context
// Phase B (2PM→3:15PM): + live OI delta vs 2PM baseline → transitional
// Phase C (3:15PM+): merged into positioning signal

// 4. FII Short% 3-Session Trend Tracker

// 7. Adversarial Control Index — who controls your open position?

// ═══ WALL DRIFT MONITOR — detects when OI wall moves away from your sell strike ═══
// Walls are institutional defense lines. If the wall retreats, your sell strike is exposed.
// Entry wall saved in trade.entry_snapshot. Current wall from live chain.


// ═══════════════════════════════════════════════════════════════
// AFTERNOON POSITIONING SYSTEM — Detect institutional last-hour moves
// ═══════════════════════════════════════════════════════════════

// Build snapshot data from current state (used for morning, 2pm, 3:15pm)

// Heavy afternoon fetch — full chains + breadth (same as morning)

// Compare 2PM vs 3:15PM snapshots → detect positioning

// ═══ GLOBAL DIRECTION BOOST — Dow, Crude, GIFT direction agreement ═══

// Validate yesterday's signal against today's gap

// Render positioning section on DATA tab
function renderPositioning() {
    if (!bd.positioning && !STATE._captured2pm) return '';

    let html = '<div class="env-section-title">🔍 Afternoon Positioning</div>';

    // 2PM baseline status
    if (STATE._captured2pm && !STATE._captured315pm) {
        html += `<div class="env-row"><span class="env-row-label">2:00 PM Baseline</span><span class="env-row-value" style="color:var(--green)">✅ Captured</span></div>`;
        html += `<div class="env-row"><span class="env-row-label">3:15 PM Scan</span><span class="env-row-value" style="color:var(--text-muted)">⏳ Pending...</span></div>`;
    }

    // Full comparison after 3:15PM
    if (bd.positioning) {
        const r = bd.positioning;
        const d = r.delta;
        const fmtOI = (v) => { const l = Math.abs(v) / 100000; return `${v > 0 ? '+' : ''}${l.toFixed(1)}L`; };

        html += `
        <div class="env-row"><span class="env-row-label">BNF Call OI change</span>
            <span class="env-row-value" style="color:${d.callOiDelta > 0 ? 'var(--danger)' : 'var(--green)'}">${fmtOI(d.callOiDelta)} ${d.callOiDelta > d.putOiDelta * 1.3 ? '(heavy call writing)' : ''}</span></div>
        <div class="env-row"><span class="env-row-label">BNF Put OI change</span>
            <span class="env-row-value" style="color:${d.putOiDelta > 0 ? 'var(--green)' : 'var(--danger)'}">${fmtOI(d.putOiDelta)} ${d.putOiDelta > d.callOiDelta * 1.3 ? '(heavy put defense)' : ''}</span></div>
        <div class="env-row"><span class="env-row-label">PCR shift</span>
            <span class="env-row-value">${d.snap2pm.bnf_near_atm_pcr?.toFixed(2) || '--'} → ${d.snap315pm.bnf_near_atm_pcr?.toFixed(2) || '--'} (${d.nearPcrChange > 0 ? '+' : ''}${d.nearPcrChange.toFixed(2)})</span></div>
        <div class="env-row"><span class="env-row-label">VIX shift</span>
            <span class="env-row-value" style="color:${d.vixChange > 0.2 ? 'var(--danger)' : d.vixChange < -0.2 ? 'var(--green)' : 'var(--text-muted)'}">${d.snap2pm.vix?.toFixed(1)} → ${d.snap315pm.vix?.toFixed(1)} (${d.vixChange > 0 ? '+' : ''}${d.vixChange.toFixed(1)})</span></div>
        <div class="env-row"><span class="env-row-label">MaxPain shift</span>
            <span class="env-row-value">${d.snap2pm.bnf_max_pain || '--'} → ${d.snap315pm.bnf_max_pain || '--'} (${d.maxPainShift > 0 ? '+' : ''}${d.maxPainShift})</span></div>
        <div class="env-row"><span class="env-row-label">BNF Breadth</span>
            <span class="env-row-value">${d.snap2pm.bnf_breadth_pct?.toFixed(2) || '--'}% → ${d.snap315pm.bnf_breadth_pct?.toFixed(2) || '--'}%</span></div>
        `;

        // Tomorrow Signal
        const sigColor = r.signal === 'BEARISH' ? 'var(--danger)' : r.signal === 'BULLISH' ? 'var(--green)' : 'var(--warn)';
        html += `<div class="tomorrow-signal" style="border-color:${sigColor}">
            <div class="signal-label">⚡ TOMORROW SIGNAL</div>
            <div class="signal-value" style="color:${sigColor}">${r.signal} (${r.strength}/5)</div>
            <div class="signal-detail">${r.signal === 'BEARISH' ? 'Institutions positioned for gap-down. Sell call premium above resistance.' : r.signal === 'BULLISH' ? 'Institutions positioned for gap-up. Sell put premium below support.' : 'No clear positioning. Range likely. Iron Condor favorable.'}</div>
            ${bd.tomorrow_signal?.globalBoost ? `<div class="signal-detail" style="color:var(--accent)">🌍 Global direction: ${bd.tomorrow_signal.globalBoost > 0 ? '+' : ''}${bd.tomorrow_signal.globalBoost} strength</div>` : ''}
        </div>`;
    }

    return html;
}


// ═══════════════════════════════════════════════════════════════
// CANDIDATE GENERATION
// ═══════════════════════════════════════════════════════════════

// ═══════════════════════════════════════════════════════════════
// VARSITY STRATEGY FILTER — Market condition → Strategy type
// This is the FIRST decision. Premium is king, Varsity picks
// which premium side to be on. Then we find the best strike.
// Iron Butterfly ALWAYS blocked for ₹1.1L account.
// ═══════════════════════════════════════════════════════════════


// ═══ RANGE DETECTION — "Is the gap move done?" (b68) ═══
// If last 3 polls (15 min) show spot within ±0.3σ, market is range-bound.
// This is the signal to switch from directional to non-directional strategies.

// ═══ MARKET PHASE DETECTION — "What is the market doing RIGHT NOW?" (b89) ═══
// Combines gap info, range detection, time of day, and spot momentum
// Returns phase label + strategy hint for Trade tab GO banner

// ═══════════════════════════════════════════════════════════════
// WALL PROXIMITY + GAMMA RISK — Premium safety scores
// Wall = institutional bodyguards on your sell strike
// Gamma = how fast your premium can turn against you
// ═══════════════════════════════════════════════════════════════



// ═══ CONTEXT SCORE — Varsity rules as invisible ranking penalties ═══
// Negative = penalty (candidate drops). Positive = bonus (candidate rises). Zero = neutral.
// All dynamic from live data. tradeMode switches behavior.

// ═══ CHAIN DELTA — use Upstox per-strike delta (includes IV smile) instead of flat ATM IV ═══
// Falls back to BS.delta if chain delta unavailable (Upstox didn't provide greeks)

// Read ANY greek at an exact chain strike. Falls back to BS computation if chain value is null.





// ═══════════════════════════════════════════════════════════════
// CANDIDATE RANKING — Force-first, then EV/risk quality
// ═══════════════════════════════════════════════════════════════

// Dynamic peak cash — what actually leaves your account to enter (buy leg first)
function peakCash(c) {
    const buyLeg = (c.buyLTP || 0) + (c.legs === 4 ? (c.buyLTP2 || 0) : 0);
    return Math.round(buyLeg * (c.lotSize || 30));
}

// b91: Broker margin estimate — real SPAN margin, not just maxLoss
// 2-leg spreads: margin ≈ maxLoss (spread benefit applies)
// 4-leg IC/IB: SPAN on 2 short legs, ~90% after spread benefit from long legs
function estimateBrokerMargin(c) {
    if (c.legs === 4) {
        // IC/IB = defined risk spread. Broker charges ~maxLoss, not naked short.
        // Buffer 1.3x for slippage + exchange margin rounding
        return Math.round((c.maxLoss || 0) * 1.3);
    }
    // 2-leg defined-risk spread: margin ≈ maxLoss
    return c.maxLoss;
}

// b92: Same estimate for OPEN TRADES (different field names: strategy_type, index_key, max_loss)
function estimateTradeMargin(t) {
    const is4Leg = t.strategy_type === 'IRON_CONDOR' || t.strategy_type === 'IRON_BUTTERFLY';
    if (is4Leg) {
        return Math.round((t.max_loss || 0) * 1.3);
    }
    return t.max_loss || 0;
}

// ═══ TRANSACTION COST ESTIMATOR — real-world cost per trade (STT + brokerage + slippage) ═══
function estimateCost(cand) {
    const legs = cand.legs || 2;
    const lotSize = cand.lotSize || (cand.index === 'NF' ? C.NF_LOT : C.BNF_LOT);
    const sellLegs = Math.ceil(legs / 2);

    // Sell premiums at entry (rough estimate from candidate data)
    const entrySellPrem = ((cand.sellLTP || 0) + (cand.sellLTP2 || 0)) * lotSize;
    // Sell premiums at exit (estimate: ~50% of entry for profitable trades)
    const exitSellPrem = entrySellPrem * 0.3;

    // STT: 0.15% on sell side only
    const sttEntry = entrySellPrem * C.STT_OPTIONS;
    const sttExit = exitSellPrem * C.STT_OPTIONS;

    // Brokerage: ₹20 per order × legs × 2 (entry + exit)
    const brokerage = C.BROKERAGE_PER_ORDER * legs * 2;

    // Exchange charges: ~₹15 per leg × 2
    const exchange = C.EXCHANGE_PER_LEG * legs * 2;

    // GST: 18% on brokerage + exchange
    const gst = (brokerage + exchange) * C.GST_RATE;

    // Slippage: bid-ask spread reality — b69: per-strategy from Upstox cross-verification
    // BNF 4-leg has widest spreads + sequential execution delay = highest slippage
    const isBNF = cand.index === 'BNF' || lotSize === C.BNF_LOT;
    const slippagePerUnit = legs === 4
        ? (isBNF ? C.SLIPPAGE.BNF_4LEG : C.SLIPPAGE.NF_4LEG)
        : (isBNF ? C.SLIPPAGE.BNF_2LEG : C.SLIPPAGE.NF_2LEG);
    const slippage = slippagePerUnit * lotSize * legs * 2; // entry + exit

    // Stamp duty + SEBI (minor)
    const misc = 3;

    const total = Math.round(sttEntry + sttExit + brokerage + exchange + gst + slippage + misc);
    const pctOfMax = cand.maxProfit > 0 ? +(total / cand.maxProfit * 100).toFixed(1) : 0;
    const costExceedsThreshold = pctOfMax > C.MIN_PROFIT_COST_PCT;

    return { total, pctOfMax, costExceedsThreshold, stt: Math.round(sttEntry + sttExit), brokerage, slippage: Math.round(slippage) };
}

// ═══ DIRECTION SAFETY — directional trades with F1 against bias must NEVER rank #1 ═══
// IB/IC are exempt (non-directional, F1 doesn't apply)
// This prevents: STRONG BULL bias → Bear Call #1 (the Trade #5 trap)
function isDirectionSafe(candidate) {
    if (candidate.legs === 4) return true; // IB/IC are non-directional
    return candidate.forces.f1 >= 0; // F1 must be aligned or neutral
}

// ═══ BRAIN VERDICT BOOST — aligns strategy ranking with brain's market call (b89) ═══
// When brain says BUY PREMIUM → debit strategies boosted, IC/IB penalized
// When brain says SELL PREMIUM → IC/IB boosted, debit penalized
// Only applies when brain confidence > 30% (meaningful signal)


// ═══ BRAIN SCORING — converts copilot insights into ranking adjustments ═══
// Runs after every brain cycle. Re-sorts watchlist so #1 at 11:00 reflects 90min of reality.

// ═══ Free capital filter — check peakCash (buy leg cost) + margin against available capital ═══
function applyFreeCapitalFilter(candidates) {
    let marginUsed = 0;
    for (const t of (JSON.parse(NativeBridge.getOpenTrades() || '[]'))) {
        if (!t.paper) marginUsed += estimateTradeMargin(t); // b92: real broker margin, not just maxLoss
    }
    const freeCapital = C.CAPITAL - marginUsed;
    return candidates.filter(c => {
        // Gemini fix: use broker margin estimate, not just peakCash (buy leg)
        // Credit spreads have tiny peakCash but require large SPAN margin
        const margin = estimateBrokerMargin(c);
        return margin <= freeCapital * 0.9;
    });
}


// ═══════════════════════════════════════════════════════════════
// WATCH LOOP — Single continuous loop, σ-filtered
// ═══════════════════════════════════════════════════════════════

async function initialFetch() {
    // F.2 reduced: read form fields, push baseline to Kotlin, trigger render.
    // All chain fetching now done by Kotlin service.
    try {
        const baseline = collectBaselineFromForm();  // reads input fields
        if (typeof NativeBridge !== 'undefined' && NativeBridge.setBaseline) {
            NativeBridge.setBaseline(JSON.stringify(baseline));
        }
        renderAll();
    } catch (e) {
        console.error('initialFetch failed:', e);
        STATE.brainError = e.message;
    }
}






// ═══════════════════════════════════════════════════════════════
// NOTIFICATION MANAGER
// ═══════════════════════════════════════════════════════════════

async function handleNotifications(absSpotSigma, absVixSigma, significantMove) {
    const now = Date.now();
    const elapsed = API.minutesSinceOpen();

    // Time gates
    if (elapsed < C.NOISE_WINDOW) return; // first 15 min = noise

    // ═══ IMPORTANT NOTIFICATIONS (σ-triggered, between routine cycles) ═══
    if (significantMove) {

        // Check for force alignment changes on watchlist
        for (const cand of (bd.watchlist || [])) {
            if (!cand._alignmentChanged) continue;

            if (cand.forces.aligned === 3 && cand._prevAlignment < 3) {
                // 🟢 New 3/3 alignment — entry window opening
                if (elapsed < C.LAST_ENTRY_CUTOFF) {
                    sendNotification(
                        '🎯 Entry Window',
                        `${cand.index} ${friendlyType(cand.type)} ${cand.sellStrike}/${cand.buyStrike} — 3/3 aligned. ${cand.isCredit ? 'Credit' : 'Debit'} ₹${cand.netPremium}`,
                        'entry'
                    );
                }
            } else if (cand._prevAlignment === 3 && cand.forces.aligned < 3) {
                // 🔶 Lost 3/3 — window closing
                sendNotification(
                    '⚠️ Window Closing',
                    `${cand.index} ${friendlyType(cand.type)} ${cand.sellStrike}/${cand.buyStrike} — dropped to ${cand.forces.aligned}/3`,
                    'important'
                );
            }
        }

        // Check position exit signals (all open trades)
        for (const trade of (JSON.parse(NativeBridge.getOpenTrades() || '[]'))) {
            const tradeLabel = `${trade.index_key} ${friendlyType(trade.strategy_type)} ${trade.sell_strike}`;

            // Target hit
            if (trade.current_pnl >= trade.max_profit * 0.8) {
                sendNotification(
                    '💰 Target Near',
                    `${tradeLabel} P&L ₹${trade.current_pnl} (${Math.round(trade.current_pnl / trade.max_profit * 100)}% of max). Book profit.`,
                    'urgent'
                );
            }

            // Stop loss
            if (trade.current_pnl <= -trade.max_loss * 0.7) {
                sendNotification(
                    '🛑 Stop Loss Near',
                    `${tradeLabel} P&L ₹${trade.current_pnl}. Cut position.`,
                    'urgent'
                );
            }

            // Force deterioration
            if (trade.forces && trade.forces.aligned <= 1 && trade.current_pnl > 0) {
                sendNotification(
                    '⚡ Book Profit',
                    `${tradeLabel} Forces ${trade.forces.aligned}/3 but profitable ₹${trade.current_pnl}. Take it.`,
                    'urgent'
                );
            }
        }

        // Very large σ move = immediate alert regardless
        if (absSpotSigma > C.SIGMA_IMPORTANT_THRESHOLD || absVixSigma > C.SIGMA_IMPORTANT_THRESHOLD) {
            sendNotification(
                '📊 Significant Move',
                `BNF ${(JSON.parse(NativeBridge.getLatestPoll() || '{}')).bnfSpot?.toFixed(0)} (${(JSON.parse(NativeBridge.getLatestPoll() || '{}')).spotSigma}σ) VIX ${(JSON.parse(NativeBridge.getLatestPoll() || '{}')).vix?.toFixed(1)} (${(JSON.parse(NativeBridge.getLatestPoll() || '{}')).vixSigma}σ)`,
                'important'
            );
        }
    }

    // ═══ ROUTINE NOTIFICATIONS (every 30 min) ═══
    if (now - STATE.lastRoutineNotify >= C.ROUTINE_NOTIFY_MS) {
        STATE.lastRoutineNotify = now;

        let body = `BNF ${(JSON.parse(NativeBridge.getLatestPoll() || '{}')).bnfSpot?.toFixed(0)} | VIX ${(JSON.parse(NativeBridge.getLatestPoll() || '{}')).vix?.toFixed(1)}`;
        if ((JSON.parse(NativeBridge.getOpenTrades() || '[]')).length > 0) {
            const totalPnL = (JSON.parse(NativeBridge.getOpenTrades() || '[]')).reduce((s, t) => s + (t.current_pnl || 0), 0);
            body += ` | ${(JSON.parse(NativeBridge.getOpenTrades() || '[]')).length} pos P&L ₹${totalPnL}`;
        }
        const top = (bd.watchlist || [])[0];
        if (top && (JSON.parse(NativeBridge.getOpenTrades() || '[]')).length === 0) {
            body += ` | Top: ${top.forces.aligned}/3 ${friendlyType(top.type)}`;
        }

        sendNotification('📈 Market Update', body, 'routine');
    }

    // ═══ AFTERNOON POSITIONING SCANS (2:00 PM and 3:15 PM) ═══
    const mins = API.minutesSinceOpen();

    // 2PM capture: FIRST poll after 1:45 PM. Retries on failure.
    if (mins >= 270 && mins < 345 && !STATE._captured2pm) {
        try {
            addNotificationLog('📊 2:00 PM Scan', 'Capturing institutional baseline...', 'important');
            const result = await heavyAfternoonFetch();
            if (!result) throw new Error('Chain fetch failed — token may have expired');
            const snapData = buildChainSnapshotData();
            if (!snapData.bnfPcr && !snapData.bnfMaxPain) throw new Error('Snapshot data is empty — chains not loaded');
            await DB.saveChainSnapshot(snapData, '2pm');
            STATE._captured2pm = true;  // Flag AFTER success
            STATE.afternoonBaseline = snapData;
            addNotificationLog('✅ 2:00 PM Baseline Saved', 'Waiting for 3:15 PM comparison.', 'important');
        } catch (e) {
            // DON'T set flag — will retry next 5-min poll
            addNotificationLog('⚠️ 2:00 PM Scan Failed', `${e.message}. Will retry in 5 min.`, 'urgent');
            console.error('2PM capture error:', e);
        }
        renderAll();
    }

    // 3:15PM capture: FIRST poll after 3:00 PM. Retries on failure.
    if (mins >= 345 && !STATE._captured315pm) {
        try {
            addNotificationLog('⚡ 3:15 PM Scan', 'Final positioning scan...', 'urgent');
            const result = await heavyAfternoonFetch();
            if (!result) throw new Error('Chain fetch failed — token may have expired');
            const snapData315 = buildChainSnapshotData();
            if (!snapData315.bnfPcr && !snapData315.bnfMaxPain) throw new Error('Snapshot data is empty');

            // Load 2PM snapshot from Supabase. Fallback to morning if 2PM missing.
            const today = API.todayIST();
            let baselineSnap = await DB.getChainSnapshot(today, '2pm');
            let baselineLabel = '2:00 PM';
            if (!baselineSnap) {
                baselineSnap = await DB.getChainSnapshot(today, 'morning');
                baselineLabel = 'morning';
            }

            if (!baselineSnap) {
                addNotificationLog('⚠️ No Baseline Found', 'Neither 2PM nor morning snapshot exists. Cannot compare.', 'urgent');
            } else {
                addNotificationLog('⚡ Comparing', `Using ${baselineLabel} baseline for positioning analysis.`, 'important');
                // Compare
                const posResult = computePositioning(baselineSnap, {
                    ...snapData315,
                    bnf_total_call_oi: snapData315.bnfTotalCallOi,
                    bnf_total_put_oi: snapData315.bnfTotalPutOi,
                    bnf_pcr: snapData315.bnfPcr,
                    bnf_near_atm_pcr: snapData315.bnfNearAtmPcr,
                    vix: snapData315.vix,
                    bnf_max_pain: snapData315.bnfMaxPain,
                    bnf_breadth_pct: snapData315.bnfBreadthPct,
                    bnf_spot: snapData315.bnfSpot
                });
                STATE.positioningResult = posResult;
                STATE.tomorrowSignal = posResult ? { signal: posResult.signal, strength: posResult.strength } : null;

                // ═══ GLOBAL DIRECTION BOOST — auto-computed from Dow, Crude, GIFT ═══
                computeGlobalBoost(bd.tomorrow_signal, bd.positioning);

                // Save with tomorrow signal
                snapData315.tomorrowSignal = posResult?.signal;
                snapData315.signalStrength = posResult?.strength;

                sendNotification(
                    `⚡ Tomorrow Signal: ${posResult?.signal || 'NEUTRAL'} (${posResult?.strength || 0}/5)`,
                    posResult?.signal === 'BEARISH' ? 'Sell call premium now. Enter Bear Call Spread.' :
                    posResult?.signal === 'BULLISH' ? 'Sell put premium now. Enter Bull Put Spread.' :
                    'No clear direction. Consider Iron Condor.',
                    'urgent'
                );
            }

            await DB.saveChainSnapshot(snapData315, '315pm');
            STATE._captured315pm = true;  // Flag AFTER success
            addNotificationLog('✅ 3:15 PM Scan Complete', `Tomorrow Signal: ${bd.tomorrow_signal?.signal || 'NEUTRAL'} (${bd.tomorrow_signal?.strength || 0}/5)`, 'urgent');

            // ═══ GENERATE POSITIONING TRADES ═══
            const tSignal = bd.tomorrow_signal?.signal || 'NEUTRAL';
            const positioningBias = {
                bias: tSignal === 'BEARISH' ? 'BEAR' : tSignal === 'BULLISH' ? 'BULL' : 'NEUTRAL',
                strength: bd.tomorrow_signal?.strength >= 3 ? 'STRONG' : 'MILD',
                net: tSignal === 'BEARISH' ? -3 : tSignal === 'BULLISH' ? 3 : 0,
                votes: { bull: tSignal === 'BULLISH' ? 3 : 0, bear: tSignal === 'BEARISH' ? 3 : 0 },
                signals: [{ name: 'Tomorrow Signal', value: `${tSignal} (${bd.tomorrow_signal?.strength}/5)`, dir: tSignal === 'BEARISH' ? 'BEAR' : tSignal === 'BULLISH' ? 'BULL' : 'NEUTRAL' }],
                label: `${bd.tomorrow_signal?.strength >= 3 ? 'STRONG' : 'MILD'} ${tSignal === 'BEARISH' ? 'BEAR' : tSignal === 'BULLISH' ? 'BULL' : 'NEUTRAL'}`.trim()
            };

            const vixHistory = (JSON.parse(NativeBridge.getPremiumHistory(7) || '[]')).map(p => p.vix).filter(Boolean);
            const ivPctl = (vixHistory && vixHistory.length >= 5) ? BS.ivPercentile((JSON.parse(NativeBridge.getLatestPoll() || '{}')).vix, vixHistory) : 50; // Gemini fix
            const spots = { bnfSpot: (JSON.parse(NativeBridge.getLatestPoll() || '{}')).bnfSpot, nfSpot: (JSON.parse(NativeBridge.getLatestPoll() || '{}')).nfSpot, vix: (JSON.parse(NativeBridge.getLatestPoll() || '{}')).vix };

            const posBnfCands = generateCandidates((JSON.parse(NativeBridge.getBnfChain() || '{}')), spots.bnfSpot, 'BNF', STATE.bnfExpiry, spots.vix, positioningBias, ivPctl);
            const posNfCands = generateCandidates((JSON.parse(NativeBridge.getNfChain() || '{}')), spots.nfSpot, 'NF', STATE.nfExpiry, spots.vix, positioningBias, ivPctl);
            const allPosCands = rankCandidates([...posBnfCands, ...posNfCands]);

            STATE.positioningCandidates = applyFreeCapitalFilter(allPosCands).slice(0, 10);
            STATE.positioningBias = positioningBias;

            addNotificationLog('🎯 Positioning Trades Ready',
                `${STATE.positioningCandidates.length} trades aligned with ${tSignal} signal. Check Trade tab.`, 'entry');

        } catch (e) {
            // DON'T set flag — will retry next 5-min poll
            addNotificationLog('⚠️ 3:15 PM Scan Failed', `${e.message}. Will retry in 5 min.`, 'urgent');
            console.error('3:15PM capture error:', e);
        }
        renderAll();
    }
}

function sendNotification(title, body, type) {
    // Play sound
    playSound(type);

    // Native APK notification (if running in APK)
    if (window.NativeBridge && window.NativeBridge.isNative()) {
        try { window.NativeBridge.sendNotification(title, body, type); } catch(e) {}
    }
    // PWA notification fallback
    else if ('Notification' in window && Notification.permission === 'granted') {
        try {
            new Notification(title, {
                body,
                icon: '/favicon.ico',
                tag: type + '_' + Date.now(),
                vibrate: type === 'urgent' ? [200, 100, 200] : [200],
                silent: false
            });
        } catch (e) { /* mobile may block this */ }
    }

    // Log to UI
    addNotificationLog(title, body, type);
}

function addNotificationLog(title, body, type) {
    const log = document.getElementById('notif-log');
    if (!log) return;
    const time = API.istNow();
    const colors = { routine: '#64748b', important: '#f59e0b', urgent: '#ef4444', entry: '#00d4aa' };
    const div = document.createElement('div');
    div.className = 'notif-entry';
    div.style.borderLeft = `3px solid ${colors[type] || '#64748b'}`;
    div.innerHTML = `<span class="notif-time">${time}</span> <strong>${title}</strong><br><span class="notif-body">${body}</span>`;
    log.prepend(div);
    // Keep last 20
    while (log.children.length > 20) log.removeChild(log.lastChild);
}


// ═══════════════════════════════════════════════════════════════
// LOOP CONTROL
// ═══════════════════════════════════════════════════════════════

function startWatchLoop() {
    // F.2 reduced: delegate to Kotlin service.
    if (typeof NativeBridge !== 'undefined' && NativeBridge.startMarketService) {
        NativeBridge.startMarketService();
    }
    renderAll();
}


function stopWatchLoop() {
    // F.2 reduced: delegate to Kotlin service.
    if (typeof NativeBridge !== 'undefined' && NativeBridge.stopMarketService) {
        NativeBridge.stopMarketService();
    }
    renderAll();
}


// ═══ b99: NATIVE BRIDGE SYNC — push app state to Kotlin for background polling ═══
// Without these calls, Kotlin service has no token, no baseline, no trades.

// Also sync from Kotlin when app resumes from background
// Kotlin pushes latest polls via evaluateJavascript → window.syncFromNative(data)
window.syncFromNative = function(dataJson) {
    try {
        const data = typeof dataJson === 'string' ? JSON.parse(dataJson) : dataJson;

        // b106 null-guard: Kotlin may push empty/null before first poll runs
        if (!data || typeof data !== 'object') return;

        // Poll history — only update if Kotlin has more polls than we do
        if (data.pollHistory && Array.isArray(data.pollHistory)) {
            if (data.pollHistory.length > (JSON.parse(NativeBridge.getPollHistory() || '[]')).length) {
                STATE.pollHistory = data.pollHistory;
                // b121: Use pollHistory length directly — it's the true running total
                STATE.pollCount = data.pollHistory.length;
            }
        }
        // b121: Kotlin may send a separate pollCount (its service counter, starts fresh each restart)
        // Only use it if pollHistory wasn't already set above
        if (data.pollCount && data.pollCount > 0 && !data.pollHistory) {
            const base = STATE._restoredPollBase || 0;
            const totalCount = base + data.pollCount;
            if (totalCount > STATE.pollCount) STATE.pollCount = totalCount;
        }
        
        // Phase 4: Full brain result from Kotlin
        if (data.brainResult) {
            STATE.brainInsights = data.brainResult;
            STATE.brainLastRun = Date.now();
            STATE.brainError = null;
            STATE._nativeBrainAlerts = data.brainResult.alerts || [];
            
            // Effective bias from Kotlin brain
            const eb = data.brainResult.effective_bias;
            if (eb && eb.bias) {
                STATE.effectiveBias = {
                    bias: eb.bias, strength: eb.strength || '',
                    net: eb.net, morning_weight: eb.morning_weight,
                    drift_reasons: eb.drift_reasons || [],
                    label: `${eb.strength ? eb.strength + ' ' : ''}${eb.bias}`
                };
            }
        }
        
        // Phase 3: Use brain-generated candidates if available (b114)
        if (data.brainResult?.generated_candidates?.length > 0) {
            const brainCands = data.brainResult.generated_candidates;
            STATE.candidates = rankCandidates(brainCands);
            STATE.watchlist = (bd.generated_candidates || []).slice(0, 6);
            const seenIds = new Set((bd.watchlist || []).map(c => c.id));
            for (const idx of ['BNF', 'NF']) {
                const seen = new Set();
                for (const c of (bd.generated_candidates || []).filter(c => c.index === idx && !c.capitalBlocked)) {
                    if (!seen.has(c.type) && !seenIds.has(c.id)) { seen.add(c.type); seenIds.add(c.id); (bd.watchlist || []).push(c); }
                    if (seen.size >= 5) break;
                }
            }
            STATE._lastCandidateBias = bd.effective_bias?.bias || bd.morningBias?.bias;
        }

        // Phase 4: Candidates from Kotlin
        if (data.candidates && Array.isArray(data.candidates) && data.candidates.length > 0) {
            STATE.candidates = data.candidates;
            STATE.watchlist = data.candidates.slice(0, 6);
            const seenIds = new Set((bd.watchlist || []).map(c => c.id));
            for (const idx of ['BNF', 'NF']) {
                const seen = new Set();
                for (const c of data.candidates.filter(c => c.index === idx && !c.capitalBlocked)) {
                    if (!seen.has(c.type) && !seenIds.has(c.id)) { seen.add(c.type); seenIds.add(c.id); (bd.watchlist || []).push(c); }
                    if (seen.size >= 5) break;
                }
            }
            STATE._lastCandidateBias = bd.effective_bias?.bias || bd.morningBias?.bias;
        }
        
        // Phase 4: Live spots from Kotlin
        if (data.spots) {
            if ((JSON.parse(NativeBridge.getLatestPoll() || '{}'))) {
                if (data.spots.bnfSpot) (JSON.parse(NativeBridge.getLatestPoll() || '{}')).bnfSpot = data.spots.bnfSpot;
                if (data.spots.nfSpot) (JSON.parse(NativeBridge.getLatestPoll() || '{}')).nfSpot = data.spots.nfSpot;
                if (data.spots.vix) (JSON.parse(NativeBridge.getLatestPoll() || '{}')).vix = data.spots.vix;
            }
            // Update header display
            const bnfEl = document.querySelector('.spot-bnf, [data-spot="bnf"]');
            const nfEl = document.querySelector('.spot-nf, [data-spot="nf"]');
            const vixEl = document.querySelector('.spot-vix, [data-spot="vix"]');
        }
        
        // Phase 4: Updated trade P&L from Kotlin
        if (data.openTrades && Array.isArray(data.openTrades)) {
            for (const nt of data.openTrades) {
                const existing = (JSON.parse(NativeBridge.getOpenTrades() || '[]')).find(t => String(t.id) === String(nt.id));
                if (existing) {
                    if (nt.current_pnl !== undefined) existing.current_pnl = nt.current_pnl;
                    if (nt.current_spot !== undefined) existing.current_spot = nt.current_spot;
                    if (nt.peak_pnl !== undefined) existing.peak_pnl = Math.max(existing.peak_pnl || 0, nt.peak_pnl);
                }
            }
        }
        
        renderAll();
    } catch(e) {
        console.warn('[b108] syncFromNative error:', e.message);
    }
};

// ═══════════════════════════════════════════════════════════════
// PYODIDE BRAIN — Python analysis engine in WebAssembly
// Loads async (non-blocking). Runs every poll. Graceful degradation.
// ═══════════════════════════════════════════════════════════════


// ═══ CHAIN PROFILE — compress per-strike intelligence into ~25 numbers for Python ═══


// ═══ TRADE MODE TOGGLE — Intraday vs Swing ═══
function toggleTradeMode() {
    STATE.tradeMode = STATE.tradeMode === 'swing' ? 'intraday' : 'swing';
    // Persist mode
    const currentTheme = document.body.classList.contains('dark') ? 'dark' : 'light';
    DB.setConfig('settings', { theme: currentTheme, tradeMode: STATE.tradeMode });
    // Regenerate candidates with new mode (contextScore + gamma block change)
    if ((JSON.parse(NativeBridge.getBnfChain() || '{}')) && (JSON.parse(NativeBridge.getNfChain() || '{}')) && (JSON.parse(NativeBridge.getLatestPoll() || '{}'))?.bias) {
        const vix = (JSON.parse(NativeBridge.getLatestPoll() || '{}')).vix;
        const ivPctl = (JSON.parse(NativeBridge.getLatestPoll() || '{}')).ivPercentile;
        // b99: Use effective bias if brain has computed one
        const biasForCands = bd.effective_bias
            ? { bias: bd.effective_bias.bias, strength: bd.effective_bias.strength, net: bd.effective_bias.net, label: bd.effective_bias.label, votes: bd.morningBias?.votes || {bull:0, bear:0} }
            : (JSON.parse(NativeBridge.getLatestPoll() || '{}')).bias;
        const bnfCands = generateCandidates((JSON.parse(NativeBridge.getBnfChain() || '{}')), (JSON.parse(NativeBridge.getLatestPoll() || '{}')).bnfSpot, 'BNF', STATE.bnfExpiry, vix, biasForCands, ivPctl);
        const nfCands = (JSON.parse(NativeBridge.getNfChain() || '{}')) ? generateCandidates((JSON.parse(NativeBridge.getNfChain() || '{}')), (JSON.parse(NativeBridge.getLatestPoll() || '{}')).nfSpot, 'NF', STATE.nfExpiry, vix, biasForCands, ivPctl) : [];
        STATE.candidates = rankCandidates([...bnfCands, ...nfCands]);
        STATE.lastScanTime = Date.now(); // Track when candidates were rescanned
        STATE.watchlist = (bd.generated_candidates || []).filter(c => c.forces.aligned >= 2 && !c.capitalBlocked);
        addNotificationLog('Mode Switch', `Switched to ${STATE.tradeMode.toUpperCase()} mode. ${(bd.generated_candidates || []).filter(c => !c.capitalBlocked).length} candidates.`, 'info');
    }
    renderWatchlist();
    renderFooter();
}

// ═══ RESCAN STRATEGIES — fetch fresh chains + regenerate candidates ═══
async function rescanStrategies() {
    // F.2 reduced: brain.py generates candidates inside analyze().
    // PWA only triggers a refresh and re-renders.
    try {
        renderAll();
    } catch (e) {
        console.error('rescanStrategies render failed:', e);
    }
}



// ═══════════════════════════════════════════════════════════════
// TRADE MANAGEMENT
// ═══════════════════════════════════════════════════════════════

// ═══ PAPER TRADE LIMIT — max 2 per index (2 NF + 2 BNF = 4 total) ═══
function canPaperTrade(indexKey) {
    const paperCount = (JSON.parse(NativeBridge.getOpenTrades() || '[]')).filter(t => t.paper && t.index_key === indexKey).length;
    return paperCount < 5; // 5 per index, 10 total — calibration needs data
}
function paperTradeCount() {
    return (JSON.parse(NativeBridge.getOpenTrades() || '[]')).filter(t => t.paper).length;
}

async function takeTrade(candidateId, isPaper = false) {
    const cand = (bd.watchlist || []).find(c => c.id === candidateId)
        || (bd.generated_candidates || []).find(c => c.id === candidateId)
        || STATE.positioningCandidates.find(c => c.id === candidateId);
    if (!cand) { console.warn('takeTrade: candidate not found:', candidateId); return; }

    // b105: Pull fresh poll history from Kotlin before snapshotting.
    // Covers the case where user returns from background and takes a trade
    // before the next poll fires — (JSON.parse(NativeBridge.getPollHistory() || '[]')) could otherwise be stale.
    if (window.NativeBridge?.getPollHistory) {
        try {
            const fresh = JSON.parse(window.NativeBridge.getPollHistory());
            if (Array.isArray(fresh) && fresh.length > (JSON.parse(NativeBridge.getPollHistory() || '[]')).length) {
                STATE.pollHistory = fresh;
            }
        } catch(e) {}
    }

    // Stale scan warning — candidates may be outdated
    if (STATE.lastScanTime) {
        const scanAgeMin = Math.floor((Date.now() - STATE.lastScanTime) / 60000);
        if (scanAgeMin >= 30) {
            if (!confirm(`⚠️ Candidates are ${scanAgeMin}m old (scanned at ${new Date(STATE.lastScanTime).toLocaleTimeString('en-IN', {hour:'2-digit', minute:'2-digit'})}).\n\nPremiums and walls may have changed.\nRescan first for fresh data?\n\n[OK] = Trade anyway · [Cancel] = Go back`)) {
                return;
            }
        }
    }

    // Paper trade limit enforcement
    if (isPaper && !canPaperTrade(cand.index)) {
        alert(`❌ Paper trade limit reached for ${cand.index} (max 5). Close one first.`);
        return;
    }
    // Real trade: confirm
    if (!isPaper && !confirm(`📌 REAL TRADE: ${cand.index} ${friendlyType(cand.type)} ${cand.sellStrike}/${cand.buyStrike}\nThis will count as a real trade. Proceed?`)) {
        return;
    }

    // Determine candidate rank
    const rankList = (bd.generated_candidates || []).filter(c => c.index === cand.index && !c.capitalBlocked && c.forces.aligned >= 2);
    const candRank = rankList.findIndex(c => c.id === cand.id) + 1;

    const isBNF = cand.index === 'BNF';
    const chain = isBNF ? (JSON.parse(NativeBridge.getBnfChain() || '{}')) : (JSON.parse(NativeBridge.getNfChain() || '{}'));
    const spot = isBNF ? (JSON.parse(NativeBridge.getLatestPoll() || '{}')).bnfSpot : (JSON.parse(NativeBridge.getLatestPoll() || '{}')).nfSpot;
    const daily1Sigma = spot * ((JSON.parse(NativeBridge.getLatestPoll() || '{}')).vix / 100) / 15.8745  /* √252 */;

    const trade = {
        strategy_type: cand.type,
        index_key: cand.index,
        expiry: cand.expiry,
        entry_date: new Date().toISOString(),
        entry_spot: spot,
        entry_vix: (JSON.parse(NativeBridge.getLatestPoll() || '{}')).vix,
        entry_atm_iv: isBNF ? (JSON.parse(NativeBridge.getLatestPoll() || '{}')).bnfAtmIv : (JSON.parse(NativeBridge.getLatestPoll() || '{}')).nfAtmIv,
        entry_premium: cand.netPremium,
        width: cand.width,
        sell_strike: cand.sellStrike,
        sell_type: cand.sellType,
        sell_ltp: cand.sellLTP,
        buy_strike: cand.buyStrike,
        buy_type: cand.buyType,
        buy_ltp: cand.buyLTP,
        // 4-leg second side (IC/IB put side)
        sell_strike2: cand.sellStrike2 ?? null,
        sell_type2: cand.sellType2 ?? null,
        sell_ltp2: cand.sellLTP2 ?? null,
        buy_strike2: cand.buyStrike2 ?? null,
        buy_type2: cand.buyType2 ?? null,
        buy_ltp2: cand.buyLTP2 ?? null,
        max_profit: cand.maxProfit,
        max_loss: cand.maxLoss,
        is_credit: cand.isCredit,
        force_alignment: cand.forces.aligned,
        force_f1: cand.forces.f1,
        force_f2: cand.forces.f2,
        force_f3: cand.forces.f3,
        entry_pcr: isBNF ? (JSON.parse(NativeBridge.getLatestPoll() || '{}')).pcr : ((JSON.parse(NativeBridge.getLatestPoll() || '{}')).nfPcr || (JSON.parse(NativeBridge.getNfChain() || '{}'))?.pcr),
        entry_futures_premium: isBNF ? (JSON.parse(NativeBridge.getLatestPoll() || '{}')).futuresPremBnf : ((JSON.parse(NativeBridge.getLatestPoll() || '{}')).futuresPremNf || (JSON.parse(NativeBridge.getNfChain() || '{}'))?.futuresPremium),
        entry_max_pain: isBNF ? ((JSON.parse(NativeBridge.getLatestPoll() || '{}')).maxPainBnf ?? (JSON.parse(NativeBridge.getBnfChain() || '{}'))?.maxPain) : ((JSON.parse(NativeBridge.getNfChain() || '{}'))?.maxPain ?? (JSON.parse(NativeBridge.getBaseline() || '{}'))?.maxPainNf),
        entry_sell_oi: (() => { return chain?.strikes[cand.sellStrike]?.[cand.sellType]?.oi ?? null; })(),
        entry_bias: (JSON.parse(NativeBridge.getLatestPoll() || '{}')).bias?.label,
        entry_bias_net: (JSON.parse(NativeBridge.getLatestPoll() || '{}')).bias?.net,
        entry_regime: bd.institutionalRegime?.regime || null,
        entry_credit_confidence: bd.institutionalRegime?.creditConfidence || null,
        entry_wall_score: cand.wallScore ?? null,
        entry_gamma_risk: cand.gammaRisk ?? null,
        entry_dii_cash: parseFloat((JSON.parse(NativeBridge.getMorningSnapshot(API.todayIST()) || '{}'))?.diiCash) || null,
        entry_absorption_ratio: bd.institutionalRegime?.absorptionRatio ?? null,
        // b115: Real breakeven lines — used by brain for position monitoring
        be_upper: cand.beUpper ?? null,
        be_lower: cand.beLower ?? null,
        entry_gap_sigma: bd.gapInfo?.sigma ?? null,
        entry_gap_type: bd.gapInfo?.type || null,
        prob_profit: cand.probProfit,
        // b105: ML fields on trades_v2 (lightweight — 5 columns for quick querying)
        p_ml:      cand.p_ml ?? null,
        ml_action: cand.mlAction ?? null,
        ml_regime: cand.mlRegime ?? null,
        ml_edge:   cand.mlEdge ?? null,
        ml_ood:    cand.mlOod ?? false,
        status: 'OPEN',
        current_pnl: 0,
        peak_pnl: 0,
        lots: 1,
        paper: isPaper,
        // b91: IC/IB always intraday — 0% overnight survival (backtest confirmed)
        trade_mode: (cand.type === 'IRON_CONDOR' || cand.type === 'IRON_BUTTERFLY') ? 'intraday' : (STATE.tradeMode || 'swing'),

        // ═══ RICH SNAPSHOT — everything for calibration (JSONB) ═══
        entry_snapshot: {
            // Candidate quality
            candidate_rank: candRank || null,
            varsity_tier: cand.varsityTier || null,
            // App vs trader tracking — was this the app's #1 pick?
            app_top_strategy: rankList[0]?.type || null,
            app_top_strike: rankList[0]?.sellStrike || null,
            followed_app: candRank === 1,
            context_score: cand.contextScore ?? 0,
            ev: cand.ev ?? null,
            net_theta: cand.netTheta ?? null,
            net_delta: cand.netDelta ?? null,
            risk_reward: cand.riskReward || null,
            target_profit: cand.targetProfit ?? null,
            stop_loss: cand.stopLoss ?? null,
            sell_oi: chain?.strikes[cand.sellStrike]?.[cand.sellType]?.oi ?? null,
            sell_oi2: cand.sellStrike2 ? (chain?.strikes[cand.sellStrike2]?.[cand.sellType2]?.oi ?? null) : null,
            buy_oi: chain?.strikes[cand.buyStrike]?.[cand.buyType]?.oi ?? null,
            sigma_from_atm: daily1Sigma > 0 ? +((Math.abs(cand.sellStrike - spot)) / daily1Sigma).toFixed(2) : null,
            // Market environment
            near_atm_pcr: isBNF ? (JSON.parse(NativeBridge.getLatestPoll() || '{}')).nearAtmPCR : ((JSON.parse(NativeBridge.getLatestPoll() || '{}')).nfNearAtmPCR || (JSON.parse(NativeBridge.getNfChain() || '{}'))?.nearAtmPCR),
            iv_percentile: (JSON.parse(NativeBridge.getLatestPoll() || '{}')).ivPercentile ?? null,
            spot_sigma: (JSON.parse(NativeBridge.getLatestPoll() || '{}')).spotSigma ?? null,
            vix_sigma: (JSON.parse(NativeBridge.getLatestPoll() || '{}')).vixSigma ?? null,
            vix_direction: (JSON.parse(NativeBridge.getYesterdayHistory(7) || '[]'))?.[0]?.vix ? +((JSON.parse(NativeBridge.getLatestPoll() || '{}')).vix - (JSON.parse(NativeBridge.getYesterdayHistory(7) || '[]'))[0].vix).toFixed(2) : null,
            // OI structure
            call_wall: isBNF ? (JSON.parse(NativeBridge.getLatestPoll() || '{}')).bnfCallWall : ((JSON.parse(NativeBridge.getNfChain() || '{}'))?.callWallStrike ?? null),
            call_wall_oi: isBNF ? (JSON.parse(NativeBridge.getLatestPoll() || '{}')).bnfCallWallOI : ((JSON.parse(NativeBridge.getNfChain() || '{}'))?.callWallOI ?? null),
            put_wall: isBNF ? (JSON.parse(NativeBridge.getLatestPoll() || '{}')).bnfPutWall : ((JSON.parse(NativeBridge.getNfChain() || '{}'))?.putWallStrike ?? null),
            put_wall_oi: isBNF ? (JSON.parse(NativeBridge.getLatestPoll() || '{}')).bnfPutWallOI : ((JSON.parse(NativeBridge.getNfChain() || '{}'))?.putWallOI ?? null),
            max_pain_dist: (() => {
                const mp = isBNF ? ((JSON.parse(NativeBridge.getLatestPoll() || '{}')).maxPainBnf || (JSON.parse(NativeBridge.getBnfChain() || '{}'))?.maxPain) : ((JSON.parse(NativeBridge.getNfChain() || '{}'))?.maxPain || null);
                return mp ? Math.round(spot - mp) : null;
            })(),
            total_call_oi: isBNF ? (JSON.parse(NativeBridge.getLatestPoll() || '{}')).bnfTotalCallOI : ((JSON.parse(NativeBridge.getNfChain() || '{}'))?.totalCallOI ?? null),
            total_put_oi: isBNF ? (JSON.parse(NativeBridge.getLatestPoll() || '{}')).bnfTotalPutOI : ((JSON.parse(NativeBridge.getNfChain() || '{}'))?.totalPutOI ?? null),
            // Institutional
            regime: bd.institutionalRegime?.regime || null,
            regime_detail: bd.institutionalRegime?.regimeDetail || null,
            fii_deriv_net: bd.institutionalRegime ? (parseFloat((JSON.parse(NativeBridge.getMorningSnapshot(API.todayIST()) || '{}'))?.fiiIdxFut || 0) + parseFloat((JSON.parse(NativeBridge.getMorningSnapshot(API.todayIST()) || '{}'))?.fiiStkFut || 0)) : null,
            absorption_ratio: bd.institutionalRegime?.absorptionRatio ?? null,
            contrarian_pcr: STATE.contrarianPCR?.signal || null,
            // Bias detail — all 7 signal votes
            bias_signals: (JSON.parse(NativeBridge.getLatestPoll() || '{}')).bias?.signals?.map(s => ({ n: s.name, d: s.dir, v: s.value })) || [],
            morning_bias: bd.morningBias?.label || null,
            bias_drift: STATE.biasDrift ?? 0,
            upstox_agrees: (JSON.parse(NativeBridge.getLatestPoll() || '{}')).bias?.upstoxAgrees ?? null,
            // Breadth
            bnf_breadth_pct: (JSON.parse(NativeBridge.getBnfBreadth() || '{}'))?.pct ?? null,
            nf50_advancing: (JSON.parse(NativeBridge.getNf50Breadth() || '{}'))?.advancing ?? null,
            // Global
            dow_close: (JSON.parse(NativeBridge.getGlobalDirection() || '{}'))?.dowClose ?? null,
            crude_settle: (JSON.parse(NativeBridge.getGlobalDirection() || '{}'))?.crudeSettle ?? null,
            gap_type: bd.gapInfo?.type || null,
            gap_pts: bd.gapInfo?.points ?? null,
            gap_sigma: bd.gapInfo?.sigma ?? null,
            // Timing
            minutes_since_open: API.minutesSinceOpen() ?? null,
            trading_dte: API.tradingDTE(cand.expiry) ?? null,
            // Cost & calibration
            est_cost: cand.estCost ?? null,
            est_cost_pct: cand.estCostPct ?? null,
            net_max_profit: cand.netMaxProfit ?? null,
            upstox_pop: cand.upstoxPop ?? null,
            event_driven: false  // default false — trader marks manually if event-driven
        }
    };

    const saved = await DB.insertTrade(trade);
    if (saved) {
        trade.id = saved.id;
        (JSON.parse(NativeBridge.getOpenTrades() || '[]')).push(trade);
        playSound('entry');
        syncToNative(); // b99: sync new trade to Kotlin
        switchTab('positions');
        renderAll();

        // b105: Write full ML decision record for calibration tracking
        if (cand.p_ml != null) {
            const pollSeq = (JSON.parse(NativeBridge.getPollHistory() || '[]')).slice(-6).map(p => ({
                vix:           p.vix ?? null,
                pcr:           p.pcr ?? p.nearAtmPcr ?? null,
                bias_net:      p.biasNet ?? p.bias_net ?? null,
                breadth:       p.breadth ?? null,
                spot_move_pct: p.spotMovePct ?? null,
                futures_prem:  p.futuresPremBnf ?? p.futuresPrem ?? null,
            }));
            const last = (JSON.parse(NativeBridge.getPollHistory() || '[]'))[(JSON.parse(NativeBridge.getPollHistory() || '[]')).length - 1] || {};
            const mlDoc = {
                trade_id:   saved.id,
                date:       API.todayIST(),
                entry_time: new Date().toLocaleTimeString('en-IN', {hour:'2-digit', minute:'2-digit', hour12: false}),
                strategy:   cand.type,
                index_name: cand.index,
                mode:       trade.trade_mode,
                paper:      isPaper,
                vix:        (JSON.parse(NativeBridge.getLatestPoll() || '{}'))?.vix ?? null,
                sigma_away: cand.sigmaOTM ?? null,
                gap_sigma:  bd.gapInfo?.sigma ?? null,
                entry_credit: cand.netPremium ?? null,
                width:      cand.width ?? null,
                dte:        cand.tDTE ?? null,
                max_profit: cand.maxProfit ?? null,
                max_loss:   cand.maxLoss ?? null,
                vix_regime: ((JSON.parse(NativeBridge.getLatestPoll() || '{}'))?.vix >= 20 ? 'HIGH (20-25)' : (JSON.parse(NativeBridge.getLatestPoll() || '{}'))?.vix < 15 ? 'LOW (<15)' : 'NORMAL (15-20)'),
                day_direction: last.dayDirection ?? null,
                day_range:  last.dayRange ?? null,
                market_snapshot: {
                    vix:          (JSON.parse(NativeBridge.getLatestPoll() || '{}'))?.vix,
                    pcr:          (JSON.parse(NativeBridge.getLatestPoll() || '{}'))?.pcr,
                    near_atm_pcr: (JSON.parse(NativeBridge.getLatestPoll() || '{}'))?.nearAtmPCR,
                    breadth:      (JSON.parse(NativeBridge.getLatestPoll() || '{}'))?.breadth,
                    futures_prem: (JSON.parse(NativeBridge.getLatestPoll() || '{}'))?.futuresPremBnf,
                    spot:         isBNF ? (JSON.parse(NativeBridge.getLatestPoll() || '{}'))?.bnfSpot : (JSON.parse(NativeBridge.getLatestPoll() || '{}'))?.nfSpot,
                    iv_percentile:(JSON.parse(NativeBridge.getLatestPoll() || '{}'))?.ivPercentile,
                    bias_net:     (JSON.parse(NativeBridge.getLatestPoll() || '{}'))?.bias?.net,
                    gap_sigma:    bd.gapInfo?.sigma,
                    weekday:      new Date().getDay(),
                },
                candidate_snap: {
                    sigma_away:    cand.sigmaOTM,
                    width:         cand.width,
                    entry_credit:  cand.netPremium,
                    ev:            cand.ev,
                    force_alignment: cand.forces?.aligned,
                    varsity_tier:  cand.varsityTier,
                    wall_score:    cand.wallScore,
                    gamma_risk:    cand.gammaRisk,
                    context_score: cand.contextScore,
                    prob_profit:   cand.probProfit,
                    rr:            cand.riskReward,
                    net_theta:     cand.netTheta,
                    est_cost:      cand.estCost,
                    est_cost_pct:  cand.estCostPct,
                    net_delta:     cand.netDelta,
                    upstox_pop:    cand.upstoxPop,
                },
                poll_sequence: pollSeq,
                seq_length:    pollSeq.length,
                p_final:       cand.p_ml,
                ml_action:     cand.mlAction,
                ml_regime:     cand.mlRegime,
                ml_edge:       cand.mlEdge,
                ood:           cand.mlOod ?? false,
                ood_conf:      cand.mlOodConf ?? 1.0,
                ood_warn:      (cand.mlOodWarn || []).join('; ') || null,
                ood_blocked:   cand.mlOodBlocked ?? false,
                model_version: '2.1.1',
            };
            DB.supabase.from('ml_decisions').insert(mlDoc)
              .then(({error}) => { if (error) console.warn('[ML] ml_decisions insert failed:', error.message); });
        }
    } else {
        // Retry with essential fields only (some columns may not exist in Supabase)
        console.warn('[TAKE_TRADE] Full insert failed. Retrying with essential fields...');
        const essentialTrade = {
            strategy_type: trade.strategy_type,
            index_key: trade.index_key,
            expiry: trade.expiry,
            entry_date: trade.entry_date,
            entry_spot: trade.entry_spot,
            entry_vix: trade.entry_vix,
            entry_premium: trade.entry_premium,
            width: trade.width,
            sell_strike: trade.sell_strike,
            sell_type: trade.sell_type,
            sell_ltp: trade.sell_ltp,
            buy_strike: trade.buy_strike,
            buy_type: trade.buy_type,
            buy_ltp: trade.buy_ltp,
            max_profit: trade.max_profit,
            max_loss: trade.max_loss,
            is_credit: trade.is_credit,
            force_alignment: trade.force_alignment,
            entry_bias: trade.entry_bias,
            status: 'OPEN',
            current_pnl: 0,
            peak_pnl: 0,
            lots: 1,
            paper: isPaper,
            trade_mode: trade.trade_mode,
            be_upper: trade.be_upper ?? null,
            be_lower: trade.be_lower ?? null
        };
        const retry = await DB.insertTrade(essentialTrade);
        if (retry) {
            trade.id = retry.id;
            (JSON.parse(NativeBridge.getOpenTrades() || '[]')).push(trade);
            playSound('entry');
            switchTab('positions');
            renderAll();
            // Now try to update with full context (non-blocking)
            DB.updateTrade(retry.id, {
                force_f1: trade.force_f1, force_f2: trade.force_f2, force_f3: trade.force_f3,
                entry_atm_iv: trade.entry_atm_iv, entry_pcr: trade.entry_pcr,
                entry_bias_net: trade.entry_bias_net, prob_profit: trade.prob_profit,
                entry_regime: trade.entry_regime, entry_wall_score: trade.entry_wall_score,
                entry_gamma_risk: trade.entry_gamma_risk, entry_dii_cash: trade.entry_dii_cash,
                entry_absorption_ratio: trade.entry_absorption_ratio,
                entry_snapshot: trade.entry_snapshot
            }).catch(() => {});
        } else {
            alert('❌ Trade log failed! Use Manual Log on Position tab.\nCheck Debug panel for error details.');
        }
    }
}

async function logManualTrade() {
    const type = document.getElementById('mt-type').value;
    const indexKey = document.getElementById('mt-index').value;
    const sellStrike = parseFloat(document.getElementById('mt-sell').value);
    const buyStrike = parseFloat(document.getElementById('mt-buy').value);
    const sellLTP = parseFloat(document.getElementById('mt-sell-ltp').value);
    const buyLTP = parseFloat(document.getElementById('mt-buy-ltp').value);
    const isPaper = document.getElementById('mt-paper')?.checked || false;
    const tradeMode = document.getElementById('mt-mode')?.value || STATE.tradeMode || 'swing';

    if (!sellStrike || !buyStrike || !sellLTP || !buyLTP) {
        alert('Please fill all fields');
        return;
    }

    // Paper trade limit
    if (isPaper && !canPaperTrade(indexKey)) {
        alert(`❌ Paper trade limit reached for ${indexKey} (max 2). Close one first.`);
        return;
    }

    const isCredit = C.CREDIT_TYPES.includes(type);
    const width = Math.abs(sellStrike - buyStrike);
    const netPremium = isCredit ? +(sellLTP - buyLTP).toFixed(2) : +(buyLTP - sellLTP).toFixed(2);
    const lotSize = indexKey === 'BNF' ? C.BNF_LOT : C.NF_LOT;
    const maxProfit = isCredit ? Math.round(netPremium * lotSize) : Math.round((width - netPremium) * lotSize);
    const maxLoss = isCredit ? Math.round((width - netPremium) * lotSize) : Math.round(netPremium * lotSize);

    // Determine sell/buy types from strategy
    const sellType = (type === 'BEAR_CALL' || type === 'BULL_CALL') ? 'CE' : 'PE';
    const buyType = sellType;

    const trade = {
        strategy_type: type,
        index_key: indexKey,
        expiry: indexKey === 'BNF' ? STATE.bnfExpiry : STATE.nfExpiry,
        entry_date: new Date().toISOString(),
        entry_spot: indexKey === 'BNF' ? ((JSON.parse(NativeBridge.getLatestPoll() || '{}'))?.bnfSpot || (JSON.parse(NativeBridge.getBaseline() || '{}'))?.bnfSpot) : ((JSON.parse(NativeBridge.getLatestPoll() || '{}'))?.nfSpot || (JSON.parse(NativeBridge.getBaseline() || '{}'))?.nfSpot),
        entry_vix: (JSON.parse(NativeBridge.getLatestPoll() || '{}'))?.vix || (JSON.parse(NativeBridge.getBaseline() || '{}'))?.vix,
        entry_atm_iv: indexKey === 'BNF' ? ((JSON.parse(NativeBridge.getLatestPoll() || '{}'))?.bnfAtmIv || (JSON.parse(NativeBridge.getBaseline() || '{}'))?.bnfAtmIv) : ((JSON.parse(NativeBridge.getLatestPoll() || '{}'))?.nfAtmIv || (JSON.parse(NativeBridge.getBaseline() || '{}'))?.nfAtmIv),
        entry_premium: netPremium,
        width,
        sell_strike: sellStrike,
        sell_type: sellType,
        sell_ltp: sellLTP,
        buy_strike: buyStrike,
        buy_type: buyType,
        buy_ltp: buyLTP,
        max_profit: maxProfit,
        max_loss: maxLoss,
        is_credit: isCredit,
        force_alignment: (JSON.parse(NativeBridge.getLatestPoll() || '{}'))?.bias ? getForceAlignment(type, (JSON.parse(NativeBridge.getLatestPoll() || '{}')).bias, (JSON.parse(NativeBridge.getLatestPoll() || '{}')).vix, (JSON.parse(NativeBridge.getLatestPoll() || '{}')).ivPercentile).aligned : 0,
        force_f1: (JSON.parse(NativeBridge.getLatestPoll() || '{}'))?.bias ? getForceAlignment(type, (JSON.parse(NativeBridge.getLatestPoll() || '{}')).bias, (JSON.parse(NativeBridge.getLatestPoll() || '{}')).vix, (JSON.parse(NativeBridge.getLatestPoll() || '{}')).ivPercentile).f1 : 0,
        force_f2: (JSON.parse(NativeBridge.getLatestPoll() || '{}'))?.bias ? getForceAlignment(type, (JSON.parse(NativeBridge.getLatestPoll() || '{}')).bias, (JSON.parse(NativeBridge.getLatestPoll() || '{}')).vix, (JSON.parse(NativeBridge.getLatestPoll() || '{}')).ivPercentile).f2 : 0,
        force_f3: (JSON.parse(NativeBridge.getLatestPoll() || '{}'))?.bias ? getForceAlignment(type, (JSON.parse(NativeBridge.getLatestPoll() || '{}')).bias, (JSON.parse(NativeBridge.getLatestPoll() || '{}')).vix, (JSON.parse(NativeBridge.getLatestPoll() || '{}')).ivPercentile).f3 : 0,
        entry_pcr: indexKey === 'BNF' ? ((JSON.parse(NativeBridge.getLatestPoll() || '{}'))?.pcr || (JSON.parse(NativeBridge.getBaseline() || '{}'))?.pcr) : ((JSON.parse(NativeBridge.getNfChain() || '{}'))?.pcr || null),
        entry_futures_premium: indexKey === 'BNF' ? ((JSON.parse(NativeBridge.getLatestPoll() || '{}'))?.futuresPremBnf || (JSON.parse(NativeBridge.getBaseline() || '{}'))?.futuresPremBnf) : ((JSON.parse(NativeBridge.getNfChain() || '{}'))?.futuresPremium || null),
        entry_max_pain: indexKey === 'BNF' ? ((JSON.parse(NativeBridge.getLatestPoll() || '{}'))?.maxPainBnf ?? (JSON.parse(NativeBridge.getBnfChain() || '{}'))?.maxPain) : ((JSON.parse(NativeBridge.getNfChain() || '{}'))?.maxPain ?? null),
        entry_sell_oi: (() => { const ch = indexKey === 'BNF' ? (JSON.parse(NativeBridge.getBnfChain() || '{}')) : (JSON.parse(NativeBridge.getNfChain() || '{}')); return ch?.strikes[sellStrike]?.[sellType]?.oi ?? null; })(),
        entry_bias: (JSON.parse(NativeBridge.getLatestPoll() || '{}'))?.bias?.label || (JSON.parse(NativeBridge.getBaseline() || '{}'))?.bias?.label,
        entry_bias_net: (JSON.parse(NativeBridge.getLatestPoll() || '{}'))?.bias?.net || (JSON.parse(NativeBridge.getBaseline() || '{}'))?.bias?.net,
        entry_regime: bd.institutionalRegime?.regime || null,
        entry_credit_confidence: bd.institutionalRegime?.creditConfidence || null,
        entry_wall_score: null, // manual trade — no candidate wall score
        entry_gamma_risk: null, // manual trade — no candidate gamma
        entry_dii_cash: parseFloat((JSON.parse(NativeBridge.getMorningSnapshot(API.todayIST()) || '{}'))?.diiCash) || null,
        entry_absorption_ratio: bd.institutionalRegime?.absorptionRatio ?? null,
        entry_gap_sigma: bd.gapInfo?.sigma ?? null,
        entry_gap_type: bd.gapInfo?.type || null,
        status: 'OPEN',
        current_pnl: 0,
        peak_pnl: 0,
        lots: 1,
        paper: isPaper,
        // b91: IC/IB always intraday — 0% overnight survival
        trade_mode: (type === 'IRON_CONDOR' || type === 'IRON_BUTTERFLY') ? 'intraday' : tradeMode,

        // ═══ MANUAL TRADE SNAPSHOT — market environment (no candidate data) ═══
        entry_snapshot: {
            candidate_rank: null,
            varsity_tier: null,
            context_score: null,
            ev: null,
            manual_entry: true,
            near_atm_pcr: indexKey === 'BNF' ? (JSON.parse(NativeBridge.getLatestPoll() || '{}'))?.nearAtmPCR : ((JSON.parse(NativeBridge.getNfChain() || '{}'))?.nearAtmPCR ?? null),
            iv_percentile: (JSON.parse(NativeBridge.getLatestPoll() || '{}'))?.ivPercentile ?? null,
            spot_sigma: (JSON.parse(NativeBridge.getLatestPoll() || '{}'))?.spotSigma ?? null,
            vix_direction: (JSON.parse(NativeBridge.getYesterdayHistory(7) || '[]'))?.[0]?.vix ? +((JSON.parse(NativeBridge.getLatestPoll() || '{}'))?.vix - (JSON.parse(NativeBridge.getYesterdayHistory(7) || '[]'))[0].vix).toFixed(2) : null,
            call_wall: indexKey === 'BNF' ? (JSON.parse(NativeBridge.getLatestPoll() || '{}'))?.bnfCallWall : ((JSON.parse(NativeBridge.getNfChain() || '{}'))?.callWallStrike ?? null),
            put_wall: indexKey === 'BNF' ? (JSON.parse(NativeBridge.getLatestPoll() || '{}'))?.bnfPutWall : ((JSON.parse(NativeBridge.getNfChain() || '{}'))?.putWallStrike ?? null),
            bias_signals: (JSON.parse(NativeBridge.getLatestPoll() || '{}'))?.bias?.signals?.map(s => ({ n: s.name, d: s.dir, v: s.value })) || [],
            morning_bias: bd.morningBias?.label || null,
            bias_drift: STATE.biasDrift ?? 0,
            regime: bd.institutionalRegime?.regime || null,
            bnf_breadth_pct: (JSON.parse(NativeBridge.getBnfBreadth() || '{}'))?.pct ?? null,
            dow_close: (JSON.parse(NativeBridge.getGlobalDirection() || '{}'))?.dowClose ?? null,
            crude_settle: (JSON.parse(NativeBridge.getGlobalDirection() || '{}'))?.crudeSettle ?? null,
            gap_sigma: bd.gapInfo?.sigma ?? null,
            minutes_since_open: API.minutesSinceOpen() ?? null,
            // Cost & calibration
            event_driven: document.getElementById('mt-event')?.checked || false
        }
    };

    const saved = await DB.insertTrade(trade);
    if (saved) {
        trade.id = saved.id;
        (JSON.parse(NativeBridge.getOpenTrades() || '[]')).push(trade);
        playSound('entry');
        switchTab('positions');
        renderAll();
        if (!(JSON.parse(NativeBridge.getServiceStatus() || '{}').running)) startWatchLoop();
    } else {
        // Retry with essential fields only
        const essentialTrade = {
            strategy_type: trade.strategy_type,
            index_key: trade.index_key,
            expiry: trade.expiry,
            entry_date: trade.entry_date,
            entry_spot: trade.entry_spot,
            entry_vix: trade.entry_vix,
            entry_premium: trade.entry_premium,
            width: trade.width,
            sell_strike: trade.sell_strike,
            sell_type: trade.sell_type,
            sell_ltp: trade.sell_ltp,
            buy_strike: trade.buy_strike,
            buy_type: trade.buy_type,
            buy_ltp: trade.buy_ltp,
            max_profit: trade.max_profit,
            max_loss: trade.max_loss,
            is_credit: trade.is_credit,
            force_alignment: trade.force_alignment,
            entry_bias: trade.entry_bias,
            status: 'OPEN',
            current_pnl: 0,
            peak_pnl: 0,
            lots: 1,
            paper: isPaper,
            trade_mode: tradeMode
        };
        const retry = await DB.insertTrade(essentialTrade);
        if (retry) {
            trade.id = retry.id;
            (JSON.parse(NativeBridge.getOpenTrades() || '[]')).push(trade);
            playSound('entry');
            switchTab('positions');
            renderAll();
            if (!(JSON.parse(NativeBridge.getServiceStatus() || '{}').running)) startWatchLoop();
            // Try to add full snapshot (non-blocking)
            DB.updateTrade(retry.id, {
                force_f1: trade.force_f1, force_f2: trade.force_f2, force_f3: trade.force_f3,
                entry_pcr: trade.entry_pcr, entry_bias_net: trade.entry_bias_net,
                entry_snapshot: trade.entry_snapshot
            }).catch(() => {});
        } else {
            alert('❌ Manual trade log failed! Check Debug panel for error.');
        }
    }
}

async function closeTrade(tradeId, exitReason) {
    const trade = (JSON.parse(NativeBridge.getOpenTrades() || '[]')).find(t => String(t.id) === String(tradeId));
    if (!trade) { console.warn('closeTrade: trade not found:', tradeId); alert('Trade not found. Try refreshing.'); return; }

    // Confirmation
    const isPaper = trade.paper;
    const prefix = isPaper ? '📋 Paper' : '📌 Real';
    const confirmMsg = `${prefix}: Close ${trade.index_key} ${friendlyType(trade.strategy_type)} ${trade.sell_strike}?\nP&L: ₹${trade.current_pnl ?? 'unknown'}`;
    if (!confirm(confirmMsg)) return;

    try {
        // Calculate hold duration
        let holdDuration = '';
        if (trade.entry_date) {
            const mins = Math.floor((Date.now() - new Date(trade.entry_date).getTime()) / 60000);
            if (mins < 60) holdDuration = `${mins}m`;
            else if (mins < 1440) holdDuration = `${Math.floor(mins / 60)}h ${mins % 60}m`;
            else holdDuration = `${Math.floor(mins / 1440)}d ${Math.floor((mins % 1440) / 60)}h`;
        }

        const isBNF = trade.index_key === 'BNF';
        const chain = isBNF ? (JSON.parse(NativeBridge.getBnfChain() || '{}')) : (JSON.parse(NativeBridge.getNfChain() || '{}'));
        const minsOpen = typeof API?.minutesSinceOpen === 'function' ? API.minutesSinceOpen() : null;

        // b108: Remove from STATE and re-render IMMEDIATELY — don't wait for Supabase
        // Trade disappears from Position tab right away regardless of network
        STATE.openTrades = (JSON.parse(NativeBridge.getOpenTrades() || '[]')).filter(t => String(t.id) !== String(tradeId));
        syncToNative(); // push removal to Kotlin now
        renderAll();    // re-render immediately — card gone from UI

        // Now update Supabase in background (non-blocking)
        DB.updateTrade(trade.id, {
            status: 'CLOSED',
            exit_date: new Date().toISOString(),
            actual_pnl: trade.current_pnl ?? 0,
            exit_premium: trade.current_premium ?? null,
            exit_reason: exitReason || 'Manual',
            exit_vix: (JSON.parse(NativeBridge.getLatestPoll() || '{}'))?.vix ?? trade.current_vix ?? null,
            exit_atm_iv: isBNF ? ((JSON.parse(NativeBridge.getLatestPoll() || '{}'))?.bnfAtmIv ?? null) : ((JSON.parse(NativeBridge.getLatestPoll() || '{}'))?.nfAtmIv ?? (JSON.parse(NativeBridge.getNfChain() || '{}'))?.atmIv ?? null),
            exit_force_alignment: trade.forces?.aligned ?? trade.force_alignment ?? null,
            exit_hold_minutes: trade.entry_date ? Math.floor((Date.now() - new Date(trade.entry_date).getTime()) / 60000) : null,
            exit_spot: trade.current_spot ?? null,
            exit_pcr: isBNF ? ((JSON.parse(NativeBridge.getLatestPoll() || '{}'))?.nearAtmPCR ?? (JSON.parse(NativeBridge.getLatestPoll() || '{}'))?.pcr ?? null) : ((JSON.parse(NativeBridge.getLatestPoll() || '{}'))?.nfNearAtmPCR ?? (JSON.parse(NativeBridge.getNfChain() || '{}'))?.nearAtmPCR ?? null),
            exit_bias: (JSON.parse(NativeBridge.getLatestPoll() || '{}'))?.bias?.label ?? null,
            trough_pnl: trade.trough_pnl ?? null,
            poll_count: trade.poll_count ?? null,

            // ═══ EXIT SNAPSHOT — full market state at close (JSONB) ═══
            exit_snapshot: {
                spot: trade.current_spot ?? null,
                vix: (JSON.parse(NativeBridge.getLatestPoll() || '{}'))?.vix ?? trade.current_vix ?? null,
                atm_iv: isBNF ? ((JSON.parse(NativeBridge.getLatestPoll() || '{}'))?.bnfAtmIv ?? null) : ((JSON.parse(NativeBridge.getLatestPoll() || '{}'))?.nfAtmIv ?? null),
                near_atm_pcr: isBNF ? ((JSON.parse(NativeBridge.getLatestPoll() || '{}'))?.nearAtmPCR ?? null) : ((JSON.parse(NativeBridge.getLatestPoll() || '{}'))?.nfNearAtmPCR ?? (JSON.parse(NativeBridge.getNfChain() || '{}'))?.nearAtmPCR ?? null),
                futures_premium: isBNF ? ((JSON.parse(NativeBridge.getLatestPoll() || '{}'))?.futuresPremBnf ?? null) : ((JSON.parse(NativeBridge.getLatestPoll() || '{}'))?.futuresPremNf ?? null),
                iv_percentile: (JSON.parse(NativeBridge.getLatestPoll() || '{}'))?.ivPercentile ?? null,
                call_wall: isBNF ? ((JSON.parse(NativeBridge.getLatestPoll() || '{}'))?.bnfCallWall ?? null) : ((JSON.parse(NativeBridge.getNfChain() || '{}'))?.callWallStrike ?? null),
                put_wall: isBNF ? ((JSON.parse(NativeBridge.getLatestPoll() || '{}'))?.bnfPutWall ?? null) : ((JSON.parse(NativeBridge.getNfChain() || '{}'))?.putWallStrike ?? null),
                max_pain: isBNF ? ((JSON.parse(NativeBridge.getLatestPoll() || '{}'))?.maxPainBnf ?? null) : ((JSON.parse(NativeBridge.getNfChain() || '{}'))?.maxPain ?? null),
                sell_oi: chain?.strikes?.[trade.sell_strike]?.[trade.sell_type]?.oi ?? null,
                bias: (JSON.parse(NativeBridge.getLatestPoll() || '{}'))?.bias?.label ?? null,
                bias_net: (JSON.parse(NativeBridge.getLatestPoll() || '{}'))?.bias?.net ?? null,
                bias_signals: (JSON.parse(NativeBridge.getLatestPoll() || '{}'))?.bias?.signals?.map(s => ({ n: s.name, d: s.dir })) || [],
                force_f1: trade.forces?.f1 ?? trade.force_f1 ?? null,
                force_f2: trade.forces?.f2 ?? trade.force_f2 ?? null,
                force_f3: trade.forces?.f3 ?? trade.force_f3 ?? null,
                regime: bd.institutionalRegime?.regime ?? null,
                spot_sigma: (JSON.parse(NativeBridge.getLatestPoll() || '{}'))?.spotSigma ?? null,
                minutes_since_open: minsOpen,
                premium: trade.current_premium ?? null,
                drift_from_morning: STATE.biasDrift ?? 0
            },

            // ═══ JOURNEY STATS — aggregated metrics during holding (JSONB) ═══
            journey_stats: {
                spot_high: trade._journey?.spot_high ?? null,
                spot_low: trade._journey?.spot_low ?? null,
                spot_range: (trade._journey?.spot_high && trade._journey?.spot_low) ? Math.round(trade._journey.spot_high - trade._journey.spot_low) : null,
                max_ci: trade._journey?.max_ci ?? null,
                min_ci: trade._journey?.min_ci ?? null,
                forces_changed_count: trade._journey?.forces_changed_count ?? 0,
                peak_pnl: trade.peak_pnl ?? 0,
                trough_pnl: trade.trough_pnl ?? 0,
                drawdown_from_peak: (trade.peak_pnl > 0 && trade.trough_pnl < trade.peak_pnl) ? trade.peak_pnl - trade.trough_pnl : 0,
                recovery: (trade.trough_pnl < 0 && trade.current_pnl > 0),
                poll_count: trade.poll_count ?? 0,
                pnl_per_poll: trade.poll_count > 0 ? Math.round(trade.current_pnl / trade.poll_count) : 0,
                timeline: trade._journey?.timeline || []
            }
        });

        addNotificationLog(`${prefix} Trade Closed`, `${trade.index_key} ${friendlyType(trade.strategy_type)} ${trade.sell_strike} ${trade.trade_mode ? `[${trade.trade_mode}]` : ''} P&L: ₹${trade.current_pnl}.${holdDuration ? ` Held: ${holdDuration}.` : ''} Reason: ${exitReason || 'Manual'}`, trade.current_pnl >= 0 ? 'entry' : 'urgent');

        // b105: Fill ML outcome for calibration tracking
        if (trade.id) {
            DB.supabase.from('ml_decisions').update({
                won:          (trade.current_pnl ?? 0) > 0,
                actual_pnl:   trade.current_pnl ?? 0,
                peak_pnl:     trade.peak_pnl ?? null,
                trough_pnl:   trade.trough_pnl ?? null,
                hold_minutes: trade.entry_date ? Math.floor((Date.now() - new Date(trade.entry_date).getTime()) / 60000) : null,
                exit_reason:  exitReason || 'Manual',
                exit_vix:     (JSON.parse(NativeBridge.getLatestPoll() || '{}'))?.vix ?? null,
                exit_pcr:     (JSON.parse(NativeBridge.getLatestPoll() || '{}'))?.pcr ?? null,
                ci_min:       trade._journey?.min_ci ?? null,
                ci_max:       trade._journey?.max_ci ?? null,
                closed_at:    new Date().toISOString(),
            }).eq('trade_id', trade.id)
              .then(({error}) => { if (error) console.warn('[ML] ml_decisions outcome fill failed:', error.message); });
        }
    } catch (err) {
        console.error('closeTrade error:', err);
        // Even if something fails, ensure trade is removed from UI
        STATE.openTrades = (JSON.parse(NativeBridge.getOpenTrades() || '[]')).filter(t => String(t.id) !== String(tradeId));
        syncToNative();
        renderAll();
        alert(`Exit logged locally. Supabase sync may have failed: ${err.message}`);
    }
}


// ═══════════════════════════════════════════════════════════════
// UI RENDERING
// ═══════════════════════════════════════════════════════════════

function friendlyType(type) {
    return {
        BEAR_CALL: 'Bear Call',
        BULL_PUT: 'Bull Put',
        BEAR_PUT: 'Bear Put',
        BULL_CALL: 'Bull Call',
        IRON_CONDOR: 'Iron Condor',
        IRON_BUTTERFLY: 'Iron Butterfly',
        DOUBLE_DEBIT: 'Double Debit'
    }[type] || type;
}

function forceIcon(val) {
    if (val === 1) return '<span class="force-pos">✅</span>';
    if (val === -1) return '<span class="force-neg">❌</span>';
    return '<span class="force-neutral">⚠️</span>';
}

function alignmentDots(aligned) {
    const on = '🟢';
    const off = '⚫';
    return on.repeat(aligned) + off.repeat(3 - aligned);
}

// ═══ BRAIN RENDERING — shared helpers + per-tab rendering ═══

const BRAIN_COLORS = {
    bullish: 'var(--green)', bearish: 'var(--danger)',
    caution: '#f59e0b', neutral: 'var(--text-muted)'
};

function renderBrainCard(ins) {
    const color = BRAIN_COLORS[ins.impact] || BRAIN_COLORS.neutral;
    const filled = Math.min(5, Math.max(0, ins.strength || 0));
    const dots = '●'.repeat(filled) + '○'.repeat(5 - filled);
    return `<div class="brain-card" style="border-left-color:${color}">
        <div class="brain-card-header">
            <span class="brain-icon">${ins.icon || '🧠'}</span>
            <span class="brain-label">${ins.label}</span>
            <span class="brain-strength" style="color:${color}">${dots}</span>
        </div>
        <div class="brain-detail">${ins.detail}</div>
    </div>`;
}

function renderBrainInsights() {
    const bi = bd;
    const verdict = bi?.verdict;
    const market = bi?.market || [];
    const timing = bi?.timing || [];
    const risk = bi?.risk || [];
    const all = [...market, ...timing, ...risk];

    if (!all.length && !verdict && !STATE.brainReady && !STATE.brainError) {
        if (STATE.pollCount > 0 && typeof loadPyodide === 'function') {
            return `<div class="brain-section"><div class="brain-header">🧠 Brain</div><div class="brain-loading">Loading Python engine...</div></div>`;
        }
        return '';
    }

    const age = STATE.brainLastRun > 0 ? Math.round((Date.now() - STATE.brainLastRun) / 1000) : null;
    const ageText = age !== null ? (age < 60 ? `${age}s ago` : `${Math.round(age/60)}m ago`) : '';

    // VERDICT CARD — the ONE answer
    let verdictHtml = '';
    if (verdict && verdict.action) {
        const vColor = verdict.action === 'WAIT' || verdict.action === 'STOP' ? 'var(--warn)' :
            verdict.direction === 'BULL' ? 'var(--green)' : verdict.direction === 'BEAR' ? 'var(--danger)' : 'var(--accent)';
        const confBar = verdict.confidence > 0 ? `<div style="height:3px;background:var(--border);border-radius:2px;margin-top:4px"><div style="height:100%;width:${verdict.confidence}%;background:${vColor};border-radius:2px"></div></div>` : '';
        verdictHtml = `<div class="brain-card" style="border-left-color:${vColor};border-left-width:4px;padding:10px 12px">
            <div style="font-size:14px;font-weight:700;color:${vColor}">${verdict.action}${verdict.strategy ? ' — ' + verdict.strategy.replace('_', ' ') : ''}</div>
            <div style="font-size:12px;font-weight:600;margin-top:2px">${verdict.urgency || ''} ${verdict.confidence > 0 ? '· Confidence: ' + verdict.confidence + '%' : ''}</div>
            ${confBar}
            <div class="brain-detail" style="margin-top:4px">${verdict.reasoning || ''}</div>
            ${verdict.conflicts?.length ? `<div style="font-size:10px;color:var(--warn);margin-top:3px">⚠️ ${verdict.conflicts.join(' · ')}</div>` : ''}
        </div>`;
    }

    // Details — collapsible
    const sorted = [...risk, ...market.filter(i => i.strength >= 3), ...timing, ...market.filter(i => i.strength < 3)];
    const detailsHtml = sorted.length ? `<details style="margin-top:4px"><summary style="font-size:11px;color:var(--text-muted);cursor:pointer">▸ ${sorted.length} signals</summary>${sorted.map(renderBrainCard).join('')}</details>` : '';

    return `<div class="brain-section">
        <div class="brain-header">🧠 Copilot <span class="brain-meta">${ageText}</span></div>
        ${verdictHtml}
        ${detailsHtml}
    </div>`;
}

function renderBrainForTrade(tradeId) {
    const data = bd?.positions?.[tradeId];
    if (!data) return '';
    const v = data.verdict;
    const insights = data.insights || [];
    if (!v && !insights.length) return '';
    const vColor = v?.action === 'EXIT' ? 'var(--danger)' : v?.action === 'BOOK' ? 'var(--green)' : 'var(--text-muted)';
    const verdictLine = v ? `<div style="font-size:12px;font-weight:700;color:${vColor};padding:4px 0">🧠 ${v.action} ${v.urgency ? '· ' + v.urgency : ''}</div><div style="font-size:11px;color:var(--text-secondary)">${v.reason || ''}</div>` : '';
    const detailsHtml = insights.length ? `<details style="margin-top:2px"><summary style="font-size:10px;color:var(--text-muted);cursor:pointer">▸ ${insights.length} factors</summary>${insights.map(renderBrainCard).join('')}</details>` : '';
    return `<div class="brain-section" style="margin:6px 0 2px">${verdictLine}${detailsHtml}</div>`;
}

function renderBrainForCandidate(candId) {
    const insights = bd?.candidates?.[candId];
    if (!insights || !insights.length) return '';
    return `<div class="brain-section" style="margin:4px 0 2px">${insights.map(renderBrainCard).join('')}</div>`;
}

function renderAll() {
    refreshBrainData();  // F.2: keep bd fresh for all render functions
    renderTicker();
    renderMarket();
    renderOI();
    renderWatchlist();
    renderPosition();
    renderDebug();
    renderFooter();
}

function renderTicker() {
    const ticker = document.getElementById('live-ticker');
    if (!ticker) return;

    const l = (JSON.parse(NativeBridge.getLatestPoll() || '{}')) || (JSON.parse(NativeBridge.getBaseline() || '{}'));
    if (!l) { ticker.style.display = 'none'; return; }

    ticker.style.display = 'flex';

    // Spots
    const bnfEl = document.getElementById('tk-bnf');
    const nfEl = document.getElementById('tk-nf');
    const vixEl = document.getElementById('tk-vix');
    if (bnfEl && l.bnfSpot) bnfEl.textContent = `BNF ${l.bnfSpot.toFixed(0)}`;
    if (nfEl && l.nfSpot) nfEl.textContent = `NF ${l.nfSpot.toFixed(0)}`;
    if (vixEl && l.vix) {
        vixEl.textContent = `VIX ${l.vix.toFixed(1)}`;
        vixEl.className = 'ticker-item ' + (l.vix > 22 ? 'down' : l.vix < 18 ? 'up' : '');
    }

    // Capital & margin
    const capEl = document.getElementById('tk-capital');
    const marginEl = document.getElementById('tk-margin');
    const pnlEl = document.getElementById('tk-pnl');

    let marginUsed = 0;
    for (const t of (JSON.parse(NativeBridge.getOpenTrades() || '[]'))) {
        if (!t.paper) marginUsed += estimateTradeMargin(t); // b92: real broker margin
    }
    const available = C.CAPITAL - marginUsed;

    if (capEl) capEl.textContent = `₹${(C.CAPITAL / 1000).toFixed(1)}K`;
    if (marginEl) marginEl.textContent = marginUsed > 0 ? `Blocked: ₹${(marginUsed / 1000).toFixed(1)}K · Free: ₹${(available / 1000).toFixed(1)}K` : `Free: ₹${(C.CAPITAL / 1000).toFixed(1)}K`;

    if (pnlEl && (JSON.parse(NativeBridge.getOpenTrades() || '[]')).length > 0) {
        const realTrades = (JSON.parse(NativeBridge.getOpenTrades() || '[]')).filter(t => !t.paper);
        const paperTrades = (JSON.parse(NativeBridge.getOpenTrades() || '[]')).filter(t => t.paper);
        let pnlText = '';
        if (realTrades.length > 0) {
            const realPnl = realTrades.reduce((s, t) => s + (t.current_pnl || 0), 0);
            pnlText += `📌${realPnl >= 0 ? '+' : ''}₹${realPnl}`;
            pnlEl.className = realPnl >= 0 ? 'ticker-pnl-pos' : 'ticker-pnl-neg';
        }
        if (paperTrades.length > 0) {
            const paperPnl = paperTrades.reduce((s, t) => s + (t.current_pnl || 0), 0);
            pnlText += `${pnlText ? ' ' : ''}📋${paperPnl >= 0 ? '+' : ''}₹${paperPnl}`;
            if (realTrades.length === 0) pnlEl.className = paperPnl >= 0 ? 'ticker-pnl-pos' : 'ticker-pnl-neg';
        }
        pnlEl.textContent = pnlText;
    } else if (pnlEl) {
        pnlEl.textContent = '';
    }
}

// ── b105: ML manual retrain + calibration helpers ────────────────────────

async function triggerMLRetrain() {
    if (!window.NativeBridge?.triggerMLRetrain) {
        alert('Native bridge not available. Use APK version.');
        return;
    }
    // Check trade count first
    try {
        const { data, error } = await DB.supabase
            .from('ml_decisions')
            .select('id', { count: 'exact', head: true })
            .not('won', 'is', null);
        const n = data?.length ?? 0;
        const msg = n < 20
            ? `Only ${n} closed trades recorded.\nML retraining needs 20+ for meaningful improvement.\n\nTrain anyway? (will use backtest data only)`
            : `${n} closed trades ready.\nRetraining will mix backtest + live data.\n\nProceed?`;
        if (!confirm(msg)) return;
    } catch(e) {}
    window.NativeBridge.triggerMLRetrain();
    alert('ML retraining started. Check Logcat for progress. Takes 4-6 minutes.');
}

async function checkMLDecisions() {
    try {
        const { data, error } = await DB.supabase
            .from('ml_decisions')
            .select('ml_action, won, p_final')
            .not('won', 'is', null);
        if (error || !data?.length) {
            alert('No closed ML decisions yet. Take and close some trades first.');
            return;
        }
        const byAction = {};
        for (const r of data) {
            const a = r.ml_action || 'UNKNOWN';
            if (!byAction[a]) byAction[a] = { n: 0, wins: 0 };
            byAction[a].n++;
            if (r.won) byAction[a].wins++;
        }
        let msg = `ML Calibration Report (${data.length} closed trades)\n\n`;
        for (const [action, s] of Object.entries(byAction)) {
            msg += `${action}: ${s.wins}/${s.n} won (${(s.wins/s.n*100).toFixed(0)}%)\n`;
        }
        msg += `\nTarget: TAKE ≥ 70%, SKIP ≤ 40%`;
        alert(msg);
    } catch(e) {
        alert('Could not fetch calibration data: ' + e.message);
    }
}

function renderDebug() {
    const el = document.getElementById('debug-log');
    if (!el) return;

    // ── b105: ML status + manual retrain button ─────────────────────────
    const mlReady = window.NativeBridge?.isMLModelReady?.() === true;
    const mlSection = `
        <div style="background:var(--surface);border-radius:8px;padding:8px 10px;margin-bottom:8px;border-left:3px solid ${mlReady ? 'var(--green)' : 'var(--text-muted)'}">
            <div style="font-size:11px;font-weight:600;color:var(--text-primary);margin-bottom:6px">
                🧠 ML Engine — ${mlReady ? '<span style="color:var(--green)">Model loaded</span>' : '<span style="color:var(--text-muted)">Model not loaded</span>'}
            </div>
            ${mlReady ? (() => {
                try {
                    const s = JSON.parse(window.NativeBridge.getMLModelStatus());
                    return `<div style="font-size:10px;color:var(--text-muted);margin-bottom:6px">
                        v${s.version} · n=${s.n_train} · TAKE≥${s.thr_take} · base WR=${(s.base_wr*100).toFixed(1)}%
                    </div>`;
                } catch(e) { return ''; }
            })() : '<div style="font-size:10px;color:var(--text-muted);margin-bottom:6px">Install APK and open fresh to load model</div>'}
            <div style="display:flex;gap:8px;flex-wrap:wrap">
                ${mlReady ? `<button onclick="triggerMLRetrain()" style="background:var(--accent);color:#fff;border:none;border-radius:6px;padding:6px 12px;font-size:11px;font-weight:600;cursor:pointer">🔄 Retrain ML</button>` : ''}
                ${mlReady ? `<button onclick="checkMLDecisions()" style="background:transparent;color:var(--accent);border:1.5px solid var(--accent);border-radius:6px;padding:6px 12px;font-size:11px;font-weight:600;cursor:pointer">📊 Calibration</button>` : ''}
            </div>
        </div>`;
    const debugEntries = window._API_DEBUG || [];
    if (debugEntries.length === 0) {
        el.innerHTML = mlSection + '<div class="empty-state">Debug data appears after scan</div>';
        return;
    }

    // Also add app-level state debug
    const stateInfo = [];
    if ((JSON.parse(NativeBridge.getBaseline() || '{}'))) {
        stateInfo.push({
            time: '', label: 'APP_STATE',
            baseline: 'SET',
            candidates: (bd.generated_candidates || []).length,
            watchlist: (bd.watchlist || []).length,
            openTrades: (JSON.parse(NativeBridge.getOpenTrades() || '[]')).length,
            premiumHistoryDays: (JSON.parse(NativeBridge.getPremiumHistory(7) || '[]')).length,
            ivPercentile: (JSON.parse(NativeBridge.getBaseline() || '{}')).ivPercentile,
            isWatching: (JSON.parse(NativeBridge.getServiceStatus() || '{}').running),
            pollCount: STATE.pollCount
        });
    }
    // Brain debug
    const bdi = bd || {};
    const bdiTotal = (bdi.market || []).length + (bdi.timing || []).length + (bdi.risk || []).length
        + Object.values(bdi.positions || {}).reduce((s, p) => s + (p?.insights?.length || 0), 0)
        + Object.values(bdi.candidates || {}).reduce((s, a) => s + a.length, 0);
    const v = bdi.verdict;
    stateInfo.push({
        time: '', label: 'BRAIN',
        ready: STATE.brainReady,
        verdict: v ? `${v.action} ${v.strategy || ''} ${v.confidence}% ${v.urgency || ''}` : 'none',
        insights: `${bdiTotal} (mkt:${(bdi.market||[]).length} pos:${Object.keys(bdi.positions||{}).length} cand:${Object.keys(bdi.candidates||{}).length} time:${(bdi.timing||[]).length} risk:${(bdi.risk||[]).length})`,
        lastRun: STATE.brainLastRun > 0 ? new Date(STATE.brainLastRun).toLocaleTimeString('en-IN', { timeZone: 'Asia/Kolkata', hour: '2-digit', minute: '2-digit' }) : 'never',
        error: STATE.brainError || 'none',
        loadTime: STATE.brainLoadStart > 0 && STATE.brainReady ? ((performance.now() - STATE.brainLoadStart) / 1000).toFixed(1) + 's' : 'n/a'
    });

    const allEntries = [...stateInfo, ...debugEntries].reverse(); // newest first

    el.innerHTML = mlSection + allEntries.map(entry => {
        const isError = entry.label === 'ERROR';
        const label = entry.label || '';
        const time = entry.time || '';

        // Format the rest of the entry (excluding label and time)
        const data = { ...entry };
        delete data.label;
        delete data.time;
        const dataStr = Object.entries(data)
            .map(([k, v]) => {
                const val = typeof v === 'object' ? JSON.stringify(v) : v;
                return `<span style="color:var(--text-muted)">${k}:</span> ${val}`;
            })
            .join(' · ');

        return `<div class="debug-entry ${isError ? 'error' : ''}">
            <span class="debug-time">${time}</span>
            <span class="debug-label"> ${label}</span><br>
            ${dataStr}
        </div>`;
    }).join('');
}

// ═══ INTRADAY CHART — SVG spot + VIX from poll history (b68) ═══
function renderIntradayChart(index = 'NF') {
    const polls = (JSON.parse(NativeBridge.getPollHistory() || '[]'));
    if (!polls || polls.length < 2) return '<div style="text-align:center;font-size:11px;color:var(--text-muted);padding:8px">Chart appears after 2+ polls</div>';

    const spotKey = index === 'NF' ? 'nf' : 'bnf';
    // Use only polls where BOTH spot and vix are valid (consistent indices)
    const validPolls = polls.filter(p => p[spotKey] > 0 && p.vix > 0);
    if (validPolls.length < 2) return '';

    const spots = validPolls.map(p => p[spotKey]);
    const vixVals = validPolls.map(p => p.vix);
    const times = validPolls.map(p => p.t);

    // Chart dimensions — mobile-first
    const W = 340, H = 110, PAD_L = 42, PAD_R = 8, PAD_T = 12, PAD_B = 20;
    const plotW = W - PAD_L - PAD_R;
    const plotH = H - PAD_T - PAD_B;

    // Spot scale
    const spotMin = Math.min(...spots);
    const spotMax = Math.max(...spots);
    const spotRange = Math.max(spotMax - spotMin, 10);  // min 10 pts range
    const spotPad = spotRange * 0.1;
    const yMin = spotMin - spotPad;
    const yMax = spotMax + spotPad;

    // Map spot to Y coordinate
    const yScale = (v) => PAD_T + plotH - ((v - yMin) / (yMax - yMin)) * plotH;
    const xScale = (i) => PAD_L + (i / (spots.length - 1)) * plotW;

    // Spot line path
    let spotPath = spots.map((v, i) => `${i === 0 ? 'M' : 'L'}${xScale(i).toFixed(1)},${yScale(v).toFixed(1)}`).join(' ');
    const spotColor = spots[spots.length - 1] >= spots[0] ? 'var(--green)' : 'var(--danger)';

    // Spot fill (gradient area under line)
    const fillPath = spotPath + ` L${xScale(spots.length - 1).toFixed(1)},${(PAD_T + plotH).toFixed(1)} L${xScale(0).toFixed(1)},${(PAD_T + plotH).toFixed(1)} Z`;

    // VIX line (scaled to its own range, drawn as secondary)
    let vixPath = '';
    if (vixVals.length >= 2) {
        const vMin = Math.min(...vixVals) - 0.5;
        const vMax = Math.max(...vixVals) + 0.5;
        const vRange = Math.max(vMax - vMin, 0.5);
        vixPath = vixVals.map((v, i) => {
            const vy = PAD_T + plotH - ((v - vMin) / vRange) * plotH;
            return `${i === 0 ? 'M' : 'L'}${xScale(i).toFixed(1)},${vy.toFixed(1)}`;
        }).join(' ');
    }

    // Sell strike reference lines (from open trades)
    let strikeLines = '';
    for (const t of (JSON.parse(NativeBridge.getOpenTrades() || '[]'))) {
        if (t.index_key !== index) continue;
        const strike = t.sell_strike;
        if (strike >= yMin && strike <= yMax) {
            const sy = yScale(strike);
            strikeLines += `<line x1="${PAD_L}" y1="${sy.toFixed(1)}" x2="${W - PAD_R}" y2="${sy.toFixed(1)}" stroke="var(--danger)" stroke-width="0.8" stroke-dasharray="4,3" opacity="0.7"/>`;
            strikeLines += `<text x="${W - PAD_R - 2}" y="${(sy - 3).toFixed(1)}" fill="var(--danger)" font-size="8" text-anchor="end">${strike}</text>`;
        }
    }

    // Range detection — if last 3 polls within ±0.3σ, highlight green
    let rangeIndicator = '';
    if (spots.length >= 3) {
        const last3 = spots.slice(-3);
        const range3 = Math.max(...last3) - Math.min(...last3);
        const spot = spots[spots.length - 1];
        const dailySigma = spot * (((JSON.parse(NativeBridge.getLatestPoll() || '{}'))?.vix || 20) / 100) / 15.8745  /* √252 */;
        const rangeSigma = range3 / dailySigma;
        if (rangeSigma < 0.3) {
            rangeIndicator = `<rect x="${xScale(spots.length - 3).toFixed(1)}" y="${PAD_T}" width="${(xScale(spots.length - 1) - xScale(spots.length - 3)).toFixed(1)}" height="${plotH}" fill="var(--green)" opacity="0.06" rx="3"/>`;
            rangeIndicator += `<text x="${xScale(spots.length - 2).toFixed(1)}" y="${PAD_T + 10}" fill="var(--green)" font-size="7" text-anchor="middle" opacity="0.7">RANGE</text>`;
        }
    }

    // Y-axis labels (3 levels)
    const yMid = (spotMin + spotMax) / 2;
    const yLabels = [
        { v: spotMax, y: yScale(spotMax) },
        { v: yMid, y: yScale(yMid) },
        { v: spotMin, y: yScale(spotMin) }
    ];
    const yLabelsSvg = yLabels.map(l =>
        `<text x="${PAD_L - 4}" y="${(l.y + 3).toFixed(1)}" fill="var(--text-muted)" font-size="8" text-anchor="end">${l.v.toFixed(0)}</text>` +
        `<line x1="${PAD_L}" y1="${l.y.toFixed(1)}" x2="${W - PAD_R}" y2="${l.y.toFixed(1)}" stroke="var(--border)" stroke-width="0.3"/>`
    ).join('');

    // X-axis time labels (first, middle, last)
    const xLabels = [0, Math.floor(times.length / 2), times.length - 1]
        .filter(i => times[i])
        .map(i => `<text x="${xScale(i).toFixed(1)}" y="${H - 3}" fill="var(--text-muted)" font-size="8" text-anchor="middle">${times[i]}</text>`)
        .join('');

    // Current spot marker (last point)
    const lastX = xScale(spots.length - 1);
    const lastY = yScale(spots[spots.length - 1]);
    const spotDot = `<circle cx="${lastX.toFixed(1)}" cy="${lastY.toFixed(1)}" r="3" fill="${spotColor}" stroke="white" stroke-width="1"/>`;

    // Change stats
    const spotChange = spots[spots.length - 1] - spots[0];
    const spotChangePct = ((spotChange / spots[0]) * 100).toFixed(2);
    const vixNow = vixVals.length > 0 ? vixVals[vixVals.length - 1] : 0;
    const vixChange = vixVals.length >= 2 ? (vixVals[vixVals.length - 1] - vixVals[0]).toFixed(1) : '0';

    // Toggle between NF and BNF
    const otherIdx = index === 'NF' ? 'BNF' : 'NF';

    return `
    <div style="margin:6px 0;padding:4px 0;border-bottom:1px solid var(--border)">
        <div style="display:flex;justify-content:space-between;align-items:center;padding:0 2px 4px">
            <span style="font-size:11px;font-weight:600;color:var(--text-primary)">${index} ${spots[spots.length - 1].toFixed(0)} <span style="color:${spotChange >= 0 ? 'var(--green)' : 'var(--danger)'}">${spotChange >= 0 ? '+' : ''}${spotChange.toFixed(0)} (${spotChangePct}%)</span></span>
            <span style="font-size:10px;color:orange">VIX ${vixNow} (${vixChange >= 0 ? '+' : ''}${vixChange})</span>
            <button onclick="STATE._chartIndex='${otherIdx}';renderMarket()" style="font-size:9px;padding:2px 6px;border:1px solid var(--border);border-radius:3px;background:var(--bg-input);color:var(--text-muted);cursor:pointer">${otherIdx}</button>
        </div>
        <svg viewBox="0 0 ${W} ${H}" style="width:100%;height:auto;max-height:130px">
            ${rangeIndicator}
            ${yLabelsSvg}
            ${strikeLines}
            <path d="${fillPath}" fill="${spotColor}" opacity="0.08"/>
            <path d="${spotPath}" fill="none" stroke="${spotColor}" stroke-width="1.5" stroke-linejoin="round"/>
            ${vixPath ? `<path d="${vixPath}" fill="none" stroke="orange" stroke-width="0.8" stroke-dasharray="3,2" opacity="0.5"/>` : ''}
            ${spotDot}
            ${xLabels}
        </svg>
    </div>`;
}

function renderMarket() {
    const el = document.getElementById('market-content');
    if (!el || !(JSON.parse(NativeBridge.getLatestPoll() || '{}'))) return;

    const l = (JSON.parse(NativeBridge.getLatestPoll() || '{}'));
    const b = (JSON.parse(NativeBridge.getBaseline() || '{}'));
    const bias = l.bias;

    if (!b) {
        el.innerHTML = '<div class="empty-state">Enter morning data and scan to see market environment</div>';
        return;
    }

    const daily1s = b.dailySigmaBnf || 0;
    const trade1s = b.tradeSigmaBnf || 0;

    // VIX regime
    let ivRegime = 'NORMAL';
    let verdictClass = 'neutral';
    let verdict = 'Normal IV — no strong edge for buyers or sellers';
    if (l.vix >= C.IV_VERY_HIGH) { ivRegime = 'VERY HIGH'; verdictClass = 'sell'; verdict = '🔥 SELL PREMIUM — IV very high, 3 forces aligned for credit sellers'; }
    else if (l.vix >= C.IV_HIGH) { ivRegime = 'ELEVATED'; verdictClass = 'sell'; verdict = '📈 Sellers favored — elevated IV, credit spreads preferred'; }
    else if (l.vix <= C.IV_LOW) { ivRegime = 'LOW'; verdictClass = 'buy'; verdict = '💎 Cheap premium — debit spreads get bargain entry'; }

    // VIX vs yesterday
    let vixVsYday = '';
    if (b.yesterdayVix) {
        const diff = l.vix - b.yesterdayVix;
        const arrow = diff > 0.3 ? '↑' : diff < -0.3 ? '↓' : '→';
        const pct = ((diff / b.yesterdayVix) * 100).toFixed(1);
        vixVsYday = `Yesterday: ${b.yesterdayVix.toFixed(1)} · Change: ${diff > 0 ? '+' : ''}${diff.toFixed(1)} (${pct}%) ${arrow}`;
    }

    // Yesterday's data for comparisons
    const yday = (JSON.parse(NativeBridge.getYesterdayHistory(7) || '[]'))?.length > 0 ? (JSON.parse(NativeBridge.getYesterdayHistory(7) || '[]'))[0] : null;
    let ydayComparisons = '';
    if (yday) {
        const items = [];
        if (yday.fii_cash != null && (JSON.parse(NativeBridge.getMorningSnapshot(API.todayIST()) || '{}'))?.fiiCash) {
            const diff = parseFloat((JSON.parse(NativeBridge.getMorningSnapshot(API.todayIST()) || '{}')).fiiCash) - yday.fii_cash;
            items.push(`FII: ₹${yday.fii_cash}→₹${(JSON.parse(NativeBridge.getMorningSnapshot(API.todayIST()) || '{}')).fiiCash} (${diff > 0 ? '+' : ''}${diff.toFixed(0)})`);
        }
        if (yday.fii_short_pct != null && (JSON.parse(NativeBridge.getMorningSnapshot(API.todayIST()) || '{}'))?.fiiShortPct) {
            const diff = parseFloat((JSON.parse(NativeBridge.getMorningSnapshot(API.todayIST()) || '{}')).fiiShortPct) - yday.fii_short_pct;
            items.push(`Short%: ${yday.fii_short_pct}→${(JSON.parse(NativeBridge.getMorningSnapshot(API.todayIST()) || '{}')).fiiShortPct} (${diff > 0 ? '+' : ''}${diff.toFixed(1)})`);
        }
        if (yday.pcr != null && l.pcr) {
            const diff = l.pcr - yday.pcr;
            items.push(`PCR: ${yday.pcr.toFixed(2)}→${l.pcr.toFixed(2)} (${diff > 0 ? '+' : ''}${diff.toFixed(2)})`);
        }
        if (yday.bnf_spot != null && l.bnfSpot) {
            const diff = l.bnfSpot - yday.bnf_spot;
            items.push(`BNF: ${yday.bnf_spot.toFixed(0)}→${l.bnfSpot.toFixed(0)} (${diff > 0 ? '+' : ''}${diff.toFixed(0)})`);
        }
        if (yday.dii_cash != null && (JSON.parse(NativeBridge.getMorningSnapshot(API.todayIST()) || '{}'))?.diiCash) {
            const diff = parseFloat((JSON.parse(NativeBridge.getMorningSnapshot(API.todayIST()) || '{}')).diiCash) - yday.dii_cash;
            items.push(`DII: ₹${yday.dii_cash}→₹${(JSON.parse(NativeBridge.getMorningSnapshot(API.todayIST()) || '{}')).diiCash} (${diff > 0 ? '+' : ''}${diff.toFixed(0)})`);
        }
        if (yday.fii_stk_fut != null && (JSON.parse(NativeBridge.getMorningSnapshot(API.todayIST()) || '{}'))?.fiiStkFut) {
            const diff = parseFloat((JSON.parse(NativeBridge.getMorningSnapshot(API.todayIST()) || '{}')).fiiStkFut) - yday.fii_stk_fut;
            items.push(`FII Stk Fut: ₹${yday.fii_stk_fut}→₹${(JSON.parse(NativeBridge.getMorningSnapshot(API.todayIST()) || '{}')).fiiStkFut} (${diff > 0 ? '+' : ''}${diff.toFixed(0)})`);
        }
        ydayComparisons = items.map(i => `<span class="signal-chip signal-neutral">${i}</span>`).join('');
    }

    const scanTime = STATE.lastScanTime
        ? new Date(STATE.lastScanTime).toLocaleTimeString('en-IN', {hour:'2-digit', minute:'2-digit'})
        : API.istNow();

    el.innerHTML = `
        <!-- TIMESTAMP -->
        <div class="section-timestamp">Scanned: ${scanTime}${STATE.pollCount > 0 ? ` · Poll #${STATE.pollCount}` : ''}</div>

        <!-- INTRADAY CHART — spot + VIX from poll history (b68) -->
        ${renderIntradayChart(STATE._chartIndex || 'NF')}

        <!-- VERDICT -->
        <div class="env-verdict ${verdictClass}">${verdict}</div>

        <!-- INSTITUTIONAL REGIME — collapsible -->
        ${bd.institutionalRegime ? `
        <details>
            <summary style="cursor:pointer;font-size:13px;font-weight:600;color:${bd.institutionalRegime.regimeColor};padding:6px 0;">📊 ${bd.institutionalRegime.regime} · Confidence: ${bd.institutionalRegime.creditConfidence}${bd.institutionalRegime.absorptionRatio !== null ? ` · Absorption: ${bd.institutionalRegime.absorptionRatio}×` : ''} ▸</summary>
            <div style="border-left: 3px solid ${bd.institutionalRegime.regimeColor}; padding: 8px 12px; margin: 4px 0; background: var(--bg-input); border-radius: var(--radius-sm);">
                <div style="font-size:12px; color:var(--text-secondary); margin-top:4px;">${bd.institutionalRegime.regimeDetail}</div>
                <div style="font-size:11px; color:var(--text-muted); margin-top:4px;">
                    FII: ₹${bd.institutionalRegime.fiiCash}Cr · DII: ₹${bd.institutionalRegime.diiCash > 0 ? '+' : ''}${bd.institutionalRegime.diiCash}Cr
                    ${bd.institutionalRegime.absorptionRatio !== null ? ` · Absorption: ${bd.institutionalRegime.absorptionRatio}×` : ''}
                    · Idx Fut: ₹${bd.institutionalRegime.fiiIdxFut}Cr · Stk Fut: ₹${bd.institutionalRegime.fiiStkFut > 0 ? '+' : ''}${bd.institutionalRegime.fiiStkFut}Cr
                </div>
            </div>
        </details>
        ` : ''}

        <!-- GAP CLASSIFICATION -->
        ${bd.gapInfo && bd.gapInfo.type !== 'UNKNOWN' ? `
        <div class="env-row" style="padding: 6px 0;">
            <span class="env-row-label">BNF Gap</span>
            <span class="env-row-value" style="color: ${bd.gapInfo.gap > 0 ? 'var(--green)' : bd.gapInfo.gap < 0 ? 'var(--danger)' : 'var(--text-muted)'}">
                ${bd.gapInfo.gap > 0 ? '+' : ''}${bd.gapInfo.gap} pts (${bd.gapInfo.pct}%, ${bd.gapInfo.sigma}σ) — ${bd.gapInfo.type.replace('_', ' ')}
            </span>
        </div>
        ` : ''}
        ${bd.nfGapInfo && bd.nfGapInfo.type !== 'UNKNOWN' ? `
        <div class="env-row" style="padding: 6px 0;">
            <span class="env-row-label">NF Gap</span>
            <span class="env-row-value" style="color: ${bd.nfGapInfo.gap > 0 ? 'var(--green)' : bd.nfGapInfo.gap < 0 ? 'var(--danger)' : 'var(--text-muted)'}">
                ${bd.nfGapInfo.gap > 0 ? '+' : ''}${bd.nfGapInfo.gap} pts (${bd.nfGapInfo.pct}%, ${bd.nfGapInfo.sigma}σ) — ${bd.nfGapInfo.type.replace('_', ' ')}
            </span>
        </div>
        ` : ''}

        <!-- OVERNIGHT DELTA — Phase 10: Evening close vs morning inputs -->
        ${bd.overnightDelta && bd.overnightDelta.signals.length > 0 ? `
        <div style="padding:6px 10px; margin:4px 0; border-radius:8px; background:${bd.overnightDelta.summary.includes('BEARISH') ? 'rgba(211,47,47,0.08)' : bd.overnightDelta.summary.includes('BULLISH') ? 'rgba(56,142,60,0.08)' : 'rgba(128,128,128,0.06)'}; border-left:3px solid ${bd.overnightDelta.summary.includes('BEARISH') ? 'var(--danger)' : bd.overnightDelta.summary.includes('BULLISH') ? 'var(--green)' : 'var(--text-muted)'}">
            <div style="font-weight:600; font-size:12px; margin-bottom:3px">${bd.overnightDelta.summary}</div>
            <div style="font-size:11px; color:var(--text-muted)">
                ${bd.overnightDelta.signals.map(s => {
                    const color = s.dir === 'BEAR' ? 'var(--danger)' : s.dir === 'BULL' ? 'var(--green)' : 'var(--text-muted)';
                    const val = s.isSigma ? `${s.pct > 0 ? '+' : ''}${s.pct.toFixed(2)}σ` : `${s.pct > 0 ? '+' : ''}${s.pct}%`;
                    return `<span style="color:${color}">${s.name}: ${s.from}→${s.to ?? '?'} (${val})</span>`;
                }).join(' · ')}
            </div>
        </div>
        ` : ''}

        <!-- TOP GRID: Key numbers at a glance -->
        <div class="env-grid-3">
            <div class="env-item">
                <div class="env-label">VIX</div>
                <div class="env-value">${l.vix?.toFixed(1) || '--'}</div>
                <div class="env-sub">${ivRegime}</div>
            </div>
            <div class="env-item">
                <div class="env-label">BNF</div>
                <div class="env-value">${l.bnfSpot?.toFixed(0) || '--'}</div>
                <div class="env-sub">ATM: ${b.bnfAtm || '--'}</div>
            </div>
            <div class="env-item">
                <div class="env-label">NF</div>
                <div class="env-value">${l.nfSpot?.toFixed(0) || '--'}</div>
                <div class="env-sub">IV: ${l.ivPercentile != null ? l.ivPercentile + 'th %ile' : '--'}</div>
            </div>
        </div>

        <!-- FORCE 3: IV / VOLATILITY — collapsible -->
        <details>
            <summary class="env-section-title" style="cursor:pointer;user-select:none;">Force 3 — IV & Volatility ▸</summary>
        <div class="env-row">
            <span class="env-row-label">VIX vs Yesterday</span>
            <span class="env-row-value">${vixVsYday || 'No history yet'}</span>
        </div>
        <table class="oi-table">
            <thead><tr><th></th><th class="oi-th">BNF</th><th class="oi-th">NF</th></tr></thead>
            <tbody>
                <tr>
                    <td class="oi-td-label">ATM IV</td>
                    <td class="oi-td-val">${b.bnfAtmIv ? (b.bnfAtmIv > 1 ? b.bnfAtmIv.toFixed(1) + '%' : (b.bnfAtmIv * 100).toFixed(1) + '%') : '--'}</td>
                    <td class="oi-td-val">${b.nfAtmIv ? (b.nfAtmIv > 1 ? b.nfAtmIv.toFixed(1) + '%' : (b.nfAtmIv * 100).toFixed(1) + '%') : '--'}</td>
                </tr>
                <tr>
                    <td class="oi-td-label">Θ ₹/day</td>
                    <td class="oi-td-val" style="color:var(--green)">₹${Math.abs(b.bnfAtmTheta || 0)}</td>
                    <td class="oi-td-val" style="color:var(--green)">₹${Math.abs(b.nfAtmTheta || 0)}</td>
                </tr>
                <tr>
                    <td class="oi-td-label">DTE</td>
                    <td class="oi-td-val">${b.bnfTDTE || '--'}T (${b.bnfCalendarDTE || '--'}c)</td>
                    <td class="oi-td-val">${b.nfTDTE || '--'}T (${b.nfCalendarDTE || '--'}c)</td>
                </tr>
                <tr>
                    <td class="oi-td-label">Expiry</td>
                    <td class="oi-td-val">${b.bnfExpiry || '--'}</td>
                    <td class="oi-td-val">${b.nfExpiry || '--'}</td>
                </tr>
            </tbody>
        </table>
        </details>

        <!-- FORCE 1: DIRECTION / INTRINSIC — badge visible, signals collapsible -->
        <details class="bias-details">
            <summary class="bias-summary">
                <span class="bias-badge bias-${bias?.bias?.toLowerCase() || 'neutral'}">${bias?.label || 'N/A'}</span>
                <span class="bias-net">${bias?.net > 0 ? '+' : ''}${bias?.net || 0} net</span>
                ${l.spotSigma !== undefined ? `<span class="sigma-badge">Spot: ${l.spotSigma}σ</span>` : ''}
                ${l.vixSigma !== undefined ? `<span class="sigma-badge">VIX: ${l.vixSigma}σ</span>` : ''}
            </summary>
            <div class="env-signals">${(bias?.signals || []).map(s =>
                `<span class="signal-chip signal-${s.dir.toLowerCase()}">${s.name}: ${s.value}</span>`
            ).join('')}</div>
        </details>

        <!-- BRAIN INSIGHTS — Pyodide Python analysis (b71) -->
        ${renderBrainInsights()}

        <!-- RANGE BUDGET — collapsible -->
        <details>
            <summary class="env-section-title" style="cursor:pointer;user-select:none;">Range Budget — σ Framework ▸</summary>
        <table class="oi-table">
            <thead><tr><th></th><th class="oi-th">BNF</th><th class="oi-th">NF</th></tr></thead>
            <tbody>
                <tr>
                    <td class="oi-td-label">Daily 1σ</td>
                    <td class="oi-td-val">±${daily1s}</td>
                    <td class="oi-td-val">±${b.dailySigmaNf || 0}</td>
                </tr>
                <tr>
                    <td class="oi-td-label">Daily 2σ</td>
                    <td class="oi-td-val">±${daily1s * 2}</td>
                    <td class="oi-td-val">±${(b.dailySigmaNf || 0) * 2}</td>
                </tr>
                <tr>
                    <td class="oi-td-label">Trade 1σ</td>
                    <td class="oi-td-val" style="color:var(--accent)">±${trade1s} (${b.bnfTDTE}T)</td>
                    <td class="oi-td-val" style="color:var(--accent)">±${b.tradeSigmaNf || 0} (${b.nfTDTE || b.bnfTDTE}T)</td>
                </tr>
            </tbody>
        </table>
        </details>

        ${yday ? `
        <!-- OVERNIGHT: Yesterday Close → Today Morning -->
        <details>
            <summary class="env-section-title" style="cursor:pointer; user-select:none;">🌙 Overnight ▸</summary>
            <div class="env-signals">${ydayComparisons || '<span class="signal-chip signal-neutral">No comparison data</span>'}</div>
        </details>
        ` : ''}

        ${STATE.pollCount > 0 ? `
        <!-- INTRADAY: Morning → Now — collapsible -->
        <details>
            <summary class="env-section-title" style="cursor:pointer; user-select:none;">📈 Intraday (morning → now) ▸</summary>
            <div class="env-signals">
                ${b.vix && l.vix ? `<span class="signal-chip signal-${Math.abs(l.vix - b.vix) > 0.5 ? (l.vix > b.vix ? 'bear' : 'bull') : 'neutral'}">VIX: ${b.vix.toFixed(1)}→${l.vix.toFixed(1)} (${(l.vix - b.vix) > 0 ? '+' : ''}${(l.vix - b.vix).toFixed(1)})</span>` : ''}
                ${b.bnfSpot && l.bnfSpot ? `<span class="signal-chip signal-${Math.abs(l.bnfSpot - b.bnfSpot) > 100 ? (l.bnfSpot > b.bnfSpot ? 'bull' : 'bear') : 'neutral'}">BNF: ${b.bnfSpot.toFixed(0)}→${l.bnfSpot.toFixed(0)} (${(l.bnfSpot - b.bnfSpot) > 0 ? '+' : ''}${(l.bnfSpot - b.bnfSpot).toFixed(0)})</span>` : ''}
                ${b.pcr && l.pcr ? `<span class="signal-chip signal-neutral">PCR: ${b.pcr.toFixed(2)}→${l.pcr.toFixed(2)}</span>` : ''}
                ${l.spotSigma !== undefined ? `<span class="sigma-badge">Spot: ${l.spotSigma}σ</span>` : ''}
                ${l.vixSigma !== undefined ? `<span class="sigma-badge">VIX: ${l.vixSigma}σ</span>` : ''}
            </div>
        </details>
        ` : ''}
    `;
}

function renderOI() {
    const el = document.getElementById('oi-content');
    if (!el || !(JSON.parse(NativeBridge.getLatestPoll() || '{}'))) return;

    const l = (JSON.parse(NativeBridge.getLatestPoll() || '{}'));
    const b = (JSON.parse(NativeBridge.getBaseline() || '{}'));

    if (!b) {
        el.innerHTML = '<div class="empty-state">Scan to see OI structure & institutional positioning</div>';
        return;
    }

    const fmtOI = (oi) => {
        if (!oi) return '--';
        if (oi >= 1e7) return (oi / 1e7).toFixed(1) + 'Cr';
        if (oi >= 1e5) return (oi / 1e5).toFixed(1) + 'L';
        if (oi >= 1e3) return (oi / 1e3).toFixed(1) + 'K';
        return oi.toString();
    };

    // BNF
    const bnfPCR = l.nearAtmPCR;
    const bnfMP = l.maxPainBnf || b.maxPainBnf;
    const bnfMPDist = bnfMP ? Math.round(l.bnfSpot - bnfMP) : 0;
    const bnfCW = l.bnfCallWall || b.bnfCallWall;
    const bnfCWOI = l.bnfCallWallOI || b.bnfCallWallOI;
    const bnfPW = l.bnfPutWall || b.bnfPutWall;
    const bnfPWOI = l.bnfPutWallOI || b.bnfPutWallOI;
    const bnfCallOI = (JSON.parse(NativeBridge.getBnfChain() || '{}'))?.nearTotalCallOI || l.bnfTotalCallOI || b.bnfTotalCallOI || 0;
    const bnfPutOI = (JSON.parse(NativeBridge.getBnfChain() || '{}'))?.nearTotalPutOI || l.bnfTotalPutOI || b.bnfTotalPutOI || 0;
    const bnfTotal = bnfCallOI + bnfPutOI;
    const bnfCPct = bnfTotal > 0 ? Math.round(bnfCallOI / bnfTotal * 100) : 50;
    const bnfFP = l.futuresPremBnf;

    // NF
    const nfc = (JSON.parse(NativeBridge.getNfChain() || '{}'));
    const nfPCR = nfc?.nearAtmPCR;
    const nfMP = nfc?.maxPain || b.maxPainNf;
    const nfMPDist = nfMP && l.nfSpot ? Math.round(l.nfSpot - nfMP) : 0;
    const nfCW = nfc?.callWallStrike;
    const nfCWOI = nfc?.callWallOI;
    const nfPW = nfc?.putWallStrike;
    const nfPWOI = nfc?.putWallOI;
    const nfCallOI = nfc?.nearTotalCallOI || nfc?.totalCallOI || 0;
    const nfPutOI = nfc?.nearTotalPutOI || nfc?.totalPutOI || 0;
    const nfTotal = nfCallOI + nfPutOI;
    const nfCPct = nfTotal > 0 ? Math.round(nfCallOI / nfTotal * 100) : 50;
    const nfFP = nfc?.futuresPremium;

    const pc = (v) => !v ? 'var(--text-muted)' : v > 1.2 ? 'var(--green)' : v < 0.9 ? 'var(--danger)' : 'var(--text-primary)';
    const pl = (v) => !v ? '--' : v > 1.2 ? 'Bull' : v < 0.9 ? 'Bear' : 'Neut';
    const md = (d) => d > 100 ? `↑${d}` : d < -100 ? `↓${Math.abs(d)}` : `→${Math.abs(d)}`;
    const fpC = (v) => !v ? 'var(--text-muted)' : v > 0.05 ? 'var(--green)' : v < -0.05 ? 'var(--danger)' : 'var(--text-muted)';

    el.innerHTML = `
        <div class="section-timestamp">Updated: ${API.istNow()}${STATE.pollCount > 0 ? ` · Poll #${STATE.pollCount}` : ''}</div>

        <!-- COMPARISON TABLE -->
        <table class="oi-table">
            <thead>
                <tr><th></th><th class="oi-th">Bank Nifty</th><th class="oi-th">Nifty 50</th></tr>
            </thead>
            <tbody>
                <tr class="oi-pcr-row">
                    <td class="oi-td-label">PCR</td>
                    <td class="oi-td-val" style="color:${pc(bnfPCR)}"><span class="oi-big">${bnfPCR?.toFixed(2) || '--'}</span><br><span class="oi-sub">${pl(bnfPCR)} · F:${l.pcr?.toFixed(2) || '--'}</span></td>
                    <td class="oi-td-val" style="color:${pc(nfPCR)}"><span class="oi-big">${nfPCR?.toFixed(2) || '--'}</span><br><span class="oi-sub">${pl(nfPCR)} · F:${nfc?.pcr?.toFixed(2) || '--'}</span></td>
                </tr>
                <tr>
                    <td class="oi-td-label">Max Pain</td>
                    <td class="oi-td-val">${bnfMP || '--'}<br><span class="oi-sub">${md(bnfMPDist)}</span></td>
                    <td class="oi-td-val">${nfMP || '--'}<br><span class="oi-sub">${md(nfMPDist)}</span></td>
                </tr>
                <tr>
                    <td class="oi-td-label">Call Wall</td>
                    <td class="oi-td-val" style="color:var(--danger)">${bnfCW || '--'}<br><span class="oi-sub">${fmtOI(bnfCWOI)}</span></td>
                    <td class="oi-td-val" style="color:var(--danger)">${nfCW || '--'}<br><span class="oi-sub">${fmtOI(nfCWOI)}</span></td>
                </tr>
                <tr>
                    <td class="oi-td-label">Put Wall</td>
                    <td class="oi-td-val" style="color:var(--green)">${bnfPW || '--'}<br><span class="oi-sub">${fmtOI(bnfPWOI)}</span></td>
                    <td class="oi-td-val" style="color:var(--green)">${nfPW || '--'}<br><span class="oi-sub">${fmtOI(nfPWOI)}</span></td>
                </tr>
                <tr>
                    <td class="oi-td-label">OI Split</td>
                    <td class="oi-td-val">CE ${bnfCPct}% / PE ${100-bnfCPct}%
                        <div class="oi-bar-mini"><div class="oi-bar-fill call" style="width:${bnfCPct}%"></div><div class="oi-bar-fill put" style="width:${100-bnfCPct}%"></div></div>
                    </td>
                    <td class="oi-td-val">CE ${nfCPct}% / PE ${100-nfCPct}%
                        <div class="oi-bar-mini"><div class="oi-bar-fill call" style="width:${nfCPct}%"></div><div class="oi-bar-fill put" style="width:${100-nfCPct}%"></div></div>
                    </td>
                </tr>
                <tr>
                    <td class="oi-td-label">Fut Prem</td>
                    <td class="oi-td-val" style="color:${fpC(bnfFP)}">${bnfFP?.toFixed(3) || '--'}%</td>
                    <td class="oi-td-val" style="color:${fpC(nfFP)}">${nfFP?.toFixed(3) || '--'}%</td>
                </tr>
                <tr>
                    <td class="oi-td-label">Spot</td>
                    <td class="oi-td-val">${l.bnfSpot?.toFixed(0) || '--'}</td>
                    <td class="oi-td-val">${l.nfSpot?.toFixed(0) || '--'}</td>
                </tr>
            </tbody>
        </table>

        <!-- BREADTH -->
        <div class="env-section-title">📊 Market Breadth</div>
        ${(JSON.parse(NativeBridge.getBnfBreadth() || '{}')) ? `
        <div class="env-row">
            <span class="env-row-label">BNF (5 stocks, 79%)</span>
            <span class="env-row-value" style="color:${(JSON.parse(NativeBridge.getBnfBreadth() || '{}')).weightedPct > 0 ? 'var(--green)' : (JSON.parse(NativeBridge.getBnfBreadth() || '{}')).weightedPct < 0 ? 'var(--danger)' : 'var(--text-muted)'}">
                ${(JSON.parse(NativeBridge.getBnfBreadth() || '{}')).weightedPct > 0 ? '+' : ''}${(JSON.parse(NativeBridge.getBnfBreadth() || '{}')).weightedPct}% · ${(JSON.parse(NativeBridge.getBnfBreadth() || '{}')).advancing}↑ ${(JSON.parse(NativeBridge.getBnfBreadth() || '{}')).declining}↓
            </span>
        </div>
        <div class="env-signals">${((JSON.parse(NativeBridge.getBnfBreadth() || '{}')).results || []).map(r =>
            `<span class="signal-chip signal-${r.change > 0 ? 'bull' : r.change < 0 ? 'bear' : 'neutral'}">${r.name}: ${r.pctChange > 0 ? '+' : ''}${r.pctChange}%</span>`
        ).join('')}</div>
        ` : ''}
        ${(JSON.parse(NativeBridge.getNf50Breadth() || '{}')) ? `
        <div class="env-row">
            <span class="env-row-label">NF50 Breadth</span>
            <span class="env-row-value">${(JSON.parse(NativeBridge.getNf50Breadth() || '{}')).scaled}/50 advancing</span>
        </div>
        ` : ''}

        <!-- INSTITUTIONAL PCR READ — Dynamic context-aware (Phase 8.1) -->
        ${bd.pcrContext ? (() => {
            const ctx = bd.pcrContext;
            const biasColor = ctx.bias === 'BULL' ? 'var(--green)' : ctx.bias === 'BEAR' ? 'var(--danger)' : ctx.bias === 'MILD_BULL' ? 'var(--green)' : 'var(--text-muted)';
            const phaseLabel = ctx.phase === 'B' ? '🔄 Live vs 2PM' : '📊 Morning Read';
            const confDot = ctx.confidence === 'HIGH' ? '🟢' : ctx.confidence === 'MEDIUM' ? '🟡' : '⚪';
            return `
            <details>
                <summary class="env-section-title" style="cursor:pointer;user-select:none">🏛️ Institutional PCR Read ${confDot} ${phaseLabel} ▸</summary>
                <div class="traj-alert ${ctx.severity === 'high' ? 'warn' : ''}" style="border-left:3px solid ${biasColor}">
                    ${ctx.reading}
                </div>
                <div class="env-row">
                    <span class="env-row-label">Confidence</span>
                    <span class="env-row-value">${confDot} ${ctx.confidence}</span>
                </div>
                ${ctx.sessionTrend ? `<div class="traj-alert">${ctx.sessionTrend.text}</div>` : ''}
            </details>
            `;
        })() : STATE.contrarianPCR?.length ? `
        <details>
            <summary class="env-section-title" style="cursor:pointer;user-select:none">⚡ Contrarian Alert ▸</summary>
            ${STATE.contrarianPCR.map(f => `<div class="traj-alert ${f.severity === 'high' ? 'warn' : ''}">${f.text}</div>`).join('')}
        </details>
        ` : ''}

        ${bd.fiiTrend ? `
        <details>
            <summary class="env-section-title" style="cursor:pointer;user-select:none">📊 FII Short% Trend — <span style="color:${bd.fiiTrend.trend === 'COVERING' ? 'var(--green)' : bd.fiiTrend.trend === 'BUILDING' ? 'var(--danger)' : 'var(--warn)'}">
                ${bd.fiiTrend.label}</span> ▸</summary>
            <div class="env-row">
                <span class="env-row-label">3-Session</span>
                <span class="env-row-value" style="color:${bd.fiiTrend.trend === 'COVERING' ? 'var(--green)' : bd.fiiTrend.trend === 'BUILDING' ? 'var(--danger)' : 'var(--warn)'}">
                    ${bd.fiiTrend.label}${bd.fiiTrend.accel ? ' ACCELERATING' : ''}${bd.fiiTrend.aggressive ? ' ⚠️ AGGRESSIVE' : ''}
                </span>
            </div>
        </details>
        ` : ''}

        ${bd.sessionTrajectory ? `
        <details class="traj-details">
            <summary>📅 Session Trajectory (${bd.sessionTrajectory.dates?.length || 0} sessions) ▸</summary>
            <div class="traj-grid">
            ${bd.sessionTrajectory.trajectory.map(row =>
                `<div class="traj-row"><span class="traj-label">${row.label}</span>${row.arrows.map(a =>
                    `<span class="traj-arrow ${a === '↑' ? 'up' : a === '↓' ? 'down' : ''}">${a}</span>`
                ).join('')}</div>`
            ).join('')}
            </div>
            ${bd.sessionTrajectory.reversal ? `<div class="traj-alert">${bd.sessionTrajectory.reversal}</div>` : ''}
            ${bd.sessionTrajectory.alignment ? `<div class="traj-alert">${bd.sessionTrajectory.alignment}</div>` : ''}
        </details>
        ` : ''}

        ${bd.signalValidation ? (() => {
            const sv = bd.signalValidation;
            return `<div class="env-section-title">📡 Yesterday's Signal</div>
            <div class="traj-alert ${sv.correct ? '' : 'warn'}">
                ${sv.predicted} (${sv.strength}/5) → Gap: ${sv.actualGap > 0 ? '+' : ''}${sv.actualGap?.toFixed(0)} pts ${sv.correct ? '✅ CORRECT' : '❌ MISSED'}
                ${(JSON.parse(NativeBridge.getSignalAccuracyStats() || '{}')) ? ` · Accuracy: ${(JSON.parse(NativeBridge.getSignalAccuracyStats() || '{}')).correct}/${(JSON.parse(NativeBridge.getSignalAccuracyStats() || '{}')).total} (${(JSON.parse(NativeBridge.getSignalAccuracyStats() || '{}')).pct}%)` : ''}
            </div>`;
        })() : ''}

        ${renderPositioning()}
    `;
}

function renderWatchlist() {
    const el = document.getElementById('watchlist');
    if (!el) return;

    if (!(bd.watchlist || []).length && !(bd.generated_candidates || []).length) {
        el.innerHTML = '<div class="empty-state">Lock & Scan to generate strategies</div>';
        return;
    }

    const bnfAtm = (JSON.parse(NativeBridge.getBnfChain() || '{}'))?.atm || (JSON.parse(NativeBridge.getBaseline() || '{}'))?.bnfAtm || 0;
    const nfAtm = (JSON.parse(NativeBridge.getNfChain() || '{}'))?.atm || (JSON.parse(NativeBridge.getBaseline() || '{}'))?.nfAtm || 0;

    // Count candidates that ACTUALLY fit market conditions
    // isDirectionSafe: directional strategies with F1 against are NOT executable
    // Range-detected: 4-leg strategies exempt from ev>0 (range detection IS the edge)
    const rangeActive = STATE.rangeSigma != null && STATE.rangeSigma < 0.3;
    const executable = (bd.generated_candidates || []).filter(c =>
        !c.capitalBlocked && c.forces.aligned >= 2 && (c.contextScore || 0) >= -0.3
        && (c.ev > 0 || (rangeActive && c.legs === 4))
        && isDirectionSafe(c)
    ).length;
    const total = (bd.generated_candidates || []).length;

    // ═══ GO VERDICT BANNER ═══
    // b101: Use effective bias (brain-computed) when available — matches actual candidates
    const activeBiasObj = bd.effective_bias
        ? { bias: bd.effective_bias.bias, strength: bd.effective_bias.strength, net: bd.effective_bias.net, label: bd.effective_bias.label, votes: bd.morningBias?.votes || {bull:0, bear:0} }
        : ((JSON.parse(NativeBridge.getLatestPoll() || '{}'))?.bias || (JSON.parse(NativeBridge.getBaseline() || '{}'))?.bias);
    const biasLabel = bd.effective_bias?.label || (JSON.parse(NativeBridge.getLatestPoll() || '{}'))?.bias?.label || (JSON.parse(NativeBridge.getBaseline() || '{}'))?.bias?.label || 'NEUTRAL';
    const vix = (JSON.parse(NativeBridge.getLatestPoll() || '{}'))?.vix || (JSON.parse(NativeBridge.getBaseline() || '{}'))?.vix || 0;
    const modeLabel = STATE.tradeMode === 'intraday' ? '⚡ INTRADAY' : '📅 SWING';
    const goClass = executable >= 3 ? 'go-banner go-green' : executable >= 1 ? 'go-banner go-yellow' : 'go-banner go-grey';
    const goIcon = executable >= 3 ? '✅' : executable >= 1 ? '🟡' : '⏹';

    // Varsity recommendation — use effective bias to match actual candidates
    const biasObj = activeBiasObj;
    const varsityInfo = biasObj ? getVarsityFilter(biasObj, vix) : null;
    // Show first PRIMARY that actually has candidates, not just primary[0]
    const actualPrimary = varsityInfo?.primary?.find(p => (bd.generated_candidates || []).some(c => c.type === p)) || varsityInfo?.primary?.[0];
    const varsityLabel = actualPrimary ? friendlyType(actualPrimary) : '';
    const varsityAction = vix >= C.IV_HIGH ? 'SELL premium' : 'BUY premium';

    let html = `<div class="${goClass}">
        <div class="go-title">${goIcon} ${executable >= 1 ? 'GO' : 'WAIT'} · ${modeLabel}</div>
        <div class="go-detail">${executable} fit market (of ${total} generated) · VIX: ${vix.toFixed(1)} · Bias: ${biasLabel}</div>
        ${(() => {
            if (!STATE.lastScanTime) return '';
            const ageMin = Math.floor((Date.now() - STATE.lastScanTime) / 60000);
            if (ageMin < 5) return '';
            const stale = ageMin >= 30;
            const color = stale ? 'var(--danger)' : ageMin >= 15 ? 'var(--warn)' : 'var(--text-muted)';
            return `<div class="go-detail" style="font-size:11px;color:${color}">${stale ? '⚠️' : '⏱️'} Scanned ${ageMin}m ago${stale ? ' — tap Rescan for fresh candidates' : ''}</div>`;
        })()}
        ${bd.morningBias && (JSON.parse(NativeBridge.getLatestPoll() || '{}'))?.bias ? (() => {
            const drift = STATE.biasDrift || 0;
            const driftColor = Math.abs(drift) >= 2 ? 'var(--danger)' : Math.abs(drift) >= 1 ? 'var(--warn)' : 'var(--green)';
            const driftIcon = STATE.driftOverridden ? '⚠️' : Math.abs(drift) >= 1 ? '🔄' : '✅';
            const morningL = bd.morningBias.label;
            const liveL = STATE.live.bias.label;
            return morningL !== liveL || drift !== 0
                ? `<div class="go-detail" style="font-size:11px; color:${driftColor}">${driftIcon} Morning: ${morningL} · Now: ${liveL} · Drift: ${drift > 0 ? '+' : ''}${drift}${STATE.driftOverridden ? ' · OVERRIDDEN' : ''}</div>`
                : `<div class="go-detail" style="font-size:11px; color:var(--green)">✅ Plan holding: ${morningL}</div>`;
        })() : ''}
        ${varsityLabel ? `<div class="go-detail" style="font-weight:700; margin-top:4px;">📖 Varsity: ${varsityLabel} · ${varsityAction}</div>` : ''}
        ${bd.effective_bias && bd.morningBias && bd.effective_bias.bias !== bd.morningBias.bias ? (() => {
            const eb = bd.effective_bias;
            const mw = Math.round(eb.morning_weight * 100);
            const reasons = eb.drift_reasons?.length ? eb.drift_reasons.join(', ') : '';
            return `<div class="go-detail" style="font-size:11px; color:var(--accent); font-weight:600; margin-top:2px;">🧠 Brain: ${bd.morningBias.label} → ${eb.label} (MW:${mw}%${reasons ? ' · ' + reasons : ''})</div>`;
        })() : ''}
        ${varsityInfo?.rangeDetected ? `<div class="go-detail" style="font-size:11px; color:var(--green); margin-top:2px;">📊 Range detected (${STATE.rangeSigma}σ) — IB/IC prioritized over directional</div>` : ((JSON.parse(NativeBridge.getPollHistory() || '[]'))?.length >= 3 ? `<div class="go-detail" style="font-size:10px; color:var(--text-muted); margin-top:2px;">📊 Trending (${STATE.rangeSigma}σ) — directional strategies active</div>` : '')}
        ${bd.marketPhase && bd.marketPhase.id !== 'PRE_MARKET' && bd.marketPhase.id !== 'UNKNOWN' ? `<div class="go-detail" style="font-size:11px; color:var(--accent); margin-top:2px; font-weight:600;">${bd.marketPhase.label}: ${bd.marketPhase.hint}</div>
        <div class="go-detail" style="font-size:10px; color:var(--text-muted);">${bd.marketPhase.detail}</div>` : ''}
        <div style="display:flex;gap:8px;margin-top:8px;align-items:center">
            <button onclick="toggleTradeMode()" style="padding:6px 14px;font-size:12px;font-weight:600;border:2px solid ${STATE.tradeMode === 'intraday' ? 'var(--warn)' : 'var(--accent)'};background:${STATE.tradeMode === 'intraday' ? 'var(--warn)' : 'var(--accent)'};color:white;border-radius:var(--radius-sm);cursor:pointer;">
                ${STATE.tradeMode === 'intraday' ? '⚡ INTRADAY' : '📅 SWING'}
            </button>
            <button onclick="rescanStrategies()" style="padding:6px 14px;font-size:12px;background:var(--bg-input);color:var(--text-primary);border:1px solid var(--border);border-radius:var(--radius-sm);cursor:pointer;">🔄 Rescan</button>
        </div>
    </div>`;

    // ═══ PHASE 8: INSTITUTIONAL POSITIONING CYCLE ═══
    // Collapsible section: auto-expanded after 3:15PM, collapsed before
    // Global context is MANDATORY — gates positioning strategies
    const has315 = STATE._captured315pm && bd.tomorrow_signal;
    const posOpen = has315 ? 'open' : '';
    const sig = bd.tomorrow_signal;
    const sigColor = sig ? (sig.signal === 'BEARISH' ? 'var(--danger)' : sig.signal === 'BULLISH' ? 'var(--green)' : 'var(--warn)') : 'var(--text-muted)';

    html += `<details class="positioning-section" ${posOpen}>
        <summary class="positioning-summary">
            ⚡ Position for Tomorrow
            ${sig ? `<span class="pos-signal-badge" style="color:${sigColor}"> · ${sig.signal} (${sig.strength}/5)</span>` : STATE._captured2pm ? ' · ⏳ Awaiting 3:15 PM' : ''}
        </summary>
        <div class="positioning-body">`;

    // Global Direction inputs — Dow Now + Crude Now + GIFT Now (b91: evening ref for GIFT)
    const gd = (JSON.parse(NativeBridge.getGlobalDirection() || '{}'));
    const hasMorningRef = gd.dowClose || gd.crudeSettle;
    const dowPct = (gd.dowClose && gd.dowNow) ? (((gd.dowNow - gd.dowClose) / gd.dowClose) * 100).toFixed(2) : null;
    const crudePct = (gd.crudeSettle && gd.crudeNow) ? (((gd.crudeNow - gd.crudeSettle) / gd.crudeSettle) * 100).toFixed(2) : null;
    // b91: GIFT reference from evening close (most direct gap signal for tomorrow)
    const giftRef = (JSON.parse(NativeBridge.getConfig('eveningClose') || '{}'))?.gift || null;
    const giftPct = (giftRef && gd.giftNow) ? (((gd.giftNow - giftRef) / giftRef) * 100).toFixed(2) : null;
    const giftDir = giftPct !== null ? (giftPct >= C.GIFT_THRESHOLD ? 'BULL' : giftPct <= -C.GIFT_THRESHOLD ? 'BEAR' : 'NEUTRAL')
        : bd.gapInfo?.sigma ? (bd.gapInfo.sigma > 0.3 ? 'BULL' : bd.gapInfo.sigma < -0.3 ? 'BEAR' : 'NEUTRAL') : null;
    const dowDir = dowPct !== null ? (dowPct >= C.DOW_THRESHOLD ? 'BULL' : dowPct <= -C.DOW_THRESHOLD ? 'BEAR' : 'NEUTRAL') : null;
    const crudeDir = crudePct !== null ? (crudePct >= C.CRUDE_THRESHOLD ? 'BEAR' : crudePct <= -C.CRUDE_THRESHOLD ? 'BULL' : 'NEUTRAL') : null;
    const dirIcon = (d) => d === 'BULL' ? '🟢' : d === 'BEAR' ? '🔴' : d === 'NEUTRAL' ? '⚪' : '—';

    html += `<div class="global-context-section">
        <div class="gc-title">🌍 Global Direction <span style="color:var(--danger);font-size:11px">(enter live values)</span></div>
        ${!hasMorningRef && !giftRef ? '<div style="color:var(--warn);font-size:11px;margin-bottom:6px">⚠️ Enter Dow Close & Crude Settle in morning inputs, GIFT Close in evening section</div>' : ''}
        <div class="global-context-grid">
            <div class="input-group compact">
                <label>GIFT Now</label>
                <input type="text" inputmode="text" id="in-gift-now" class="input-field input-sm" placeholder="${giftRef || '24000'}"
                    value="${gd.giftNow ?? ''}">
                ${giftPct !== null ? `<div style="font-size:10px;color:${giftPct > 0 ? 'var(--green)' : giftPct < 0 ? 'var(--danger)' : 'var(--text-muted)'}">${giftPct > 0 ? '+' : ''}${giftPct}% ${dirIcon(giftDir)}</div>` : giftRef ? '<div style="font-size:9px;color:var(--text-muted)">vs eve ' + giftRef + '</div>' : '<div style="font-size:9px;color:var(--warn)">Set GIFT Close in 🌙 Evening</div>'}
            </div>
            <div class="input-group compact">
                <label>Dow Now</label>
                <input type="text" inputmode="text" id="in-dow-now" class="input-field input-sm" placeholder="e.g. 46120"
                    value="${gd.dowNow ?? ''}">
                ${dowPct !== null ? `<div style="font-size:10px;color:${dowPct < 0 ? 'var(--danger)' : dowPct > 0 ? 'var(--green)' : 'var(--text-muted)'}">${dowPct > 0 ? '+' : ''}${dowPct}% ${dirIcon(dowDir)}</div>` : ''}
            </div>
            <div class="input-group compact">
                <label>Crude Now</label>
                <input type="text" inputmode="text" id="in-crude-now" class="input-field input-sm" placeholder="e.g. 85.0"
                    value="${gd.crudeNow ?? ''}">
                ${crudePct !== null ? `<div style="font-size:10px;color:${crudePct > 0 ? 'var(--danger)' : crudePct < 0 ? 'var(--green)' : 'var(--text-muted)'}">${crudePct > 0 ? '+' : ''}${crudePct}% ${dirIcon(crudeDir)} India</div>` : ''}
            </div>
        </div>
        <button id="btn-save-global-dir" class="btn btn-sm" style="margin-top:6px;padding:4px 16px;font-size:11px;background:var(--accent);color:#fff;border:none;border-radius:6px;cursor:pointer">💾 Save</button>
        <span id="global-dir-saved" style="font-size:10px;color:var(--green);margin-left:8px;display:none">✓ Saved</span>
        <div id="global-dir-status" style="font-size:10px;color:var(--text-muted);margin-top:4px">${
            (gd.dowNow || gd.crudeNow || gd.giftNow)
            ? `Loaded: ${(JSON.parse(NativeBridge.getGlobalDirection() || '{}'))._date || API.todayIST()} · GIFT ${gd.giftNow || '--'}, Dow ${gd.dowNow || '--'}, Crude ${gd.crudeNow || '--'}`
            : ''
        }</div>
        ${(dowDir || crudeDir || giftDir) ? `<div style="font-size:11px;margin-top:4px">
            ${giftDir ? `GIFT: ${dirIcon(giftDir)}` : ''} ${dowDir ? `Dow: ${dirIcon(dowDir)}` : ''} ${crudeDir ? `Crude: ${dirIcon(crudeDir)}` : ''}
        </div>` : ''}
    </div>`;

    // ═══ POSITIONING TRADES — gated by direction inputs ═══
    if (has315 && STATE.positioningCandidates?.length > 0) {
        const gcFilled = gd.dowNow !== null && gd.crudeNow !== null;

        if (!gcFilled) {
            html += `<div class="positioning-gate">🔒 Enter Dow Futures Now & Crude Now above to unlock positioning strategies.</div>`;
        } else {
            // Positioning Varsity label
            const posVarsity = STATE.positioningBias ? getVarsityFilter(STATE.positioningBias, vix) : null;
            const posVarsityLabel = posVarsity?.primary?.[0] ? friendlyType(posVarsity.primary[0]) : '';
            const posVarsityAction = vix >= C.IV_HIGH ? 'SELL premium' : 'BUY premium';

            html += `<div class="tomorrow-signal" style="border-color:${sigColor}; margin:12px 0">
                <div class="signal-label">⚡ POSITION FOR TOMORROW</div>
                <div class="signal-value" style="color:${sigColor}">${sig.signal} (${sig.strength}/5)</div>
                ${sig.globalBoost ? `<div class="signal-detail" style="color:var(--accent)">🌍 Global boost: ${sig.globalBoost > 0 ? '+' : ''}${sig.globalBoost}</div>` : ''}
                ${posVarsityLabel ? `<div class="signal-detail" style="font-weight:700">📖 Varsity: ${posVarsityLabel} · ${posVarsityAction}</div>` : ''}
            </div>`;

            // Free capital check for positioning
            let marginUsed = 0;
            for (const t of (JSON.parse(NativeBridge.getOpenTrades() || '[]'))) {
                if (!t.paper) marginUsed += estimateTradeMargin(t); // b92: real broker margin
            }
            const freeCapital = C.CAPITAL - marginUsed;
            const minPeakNeeded = STATE.positioningCandidates.length > 0 ? peakCash(STATE.positioningCandidates[STATE.positioningCandidates.length - 1]) : 0;

            if (freeCapital < minPeakNeeded) {
                html += `<div class="positioning-gate" style="color:var(--warn)">⚠️ Free capital ₹${(freeCapital/1000).toFixed(1)}K — may not cover buy leg ₹${(minPeakNeeded/1000).toFixed(1)}K.</div>`;
            }

            // b91: Positioning candidates merged into regular NF/BNF sections below (Option C)
            const posMergeCount = STATE.positioningCandidates.filter(c => isDirectionSafe(c) && !c.capitalBlocked).length;
            if (posMergeCount > 0) {
                html += `<div style="font-size:11px;color:var(--accent);padding:4px 0">⚡ ${posMergeCount} positioning candidates merged into strategy sections below</div>`;
            }
        }
    } else if (!has315) {
        const statusMsg = STATE._captured2pm
            ? '✅ 2:00 PM baseline captured. Waiting for 3:15 PM comparison.'
            : 'Positioning analysis starts at 2:00 PM. Enter global cues at 3:15 PM.';
        html += `<div class="positioning-gate" style="color:var(--text-muted)">${statusMsg}</div>`;
    }

    html += `</div></details>`;
    // ═══ END POSITIONING SECTION ═══

    // ═══ TOP 3 DIVERSE — Best of each strategy type per index ═══
    // Engine picks optimal: 8-step waterfall + contextScore eliminates bad setups
    // Max 3 per index: one per strategy type, truly different risk profiles

    function diverseTop(candidates, index) {
        const rangeOK = STATE.rangeSigma != null && STATE.rangeSigma < 0.3;
        const filtered = candidates.filter(c =>
            c.index === index &&
            !c.capitalBlocked &&
            c.forces.aligned >= 2 &&          // at least 2/3 forces aligned
            isDirectionSafe(c) &&             // NEVER show direction-against as recommendation
            (c.contextScore || 0) >= -0.3 &&   // not fighting market condition
            (c.ev > 0 || (rangeOK && c.legs === 4))  // range: 4-leg exempt from ev>0
        );
        // Engine already ranked by 8-step waterfall. First of each type IS the best.
        // Max 3: truly different strategies, not 3 Bear Calls at different strikes.
        const seen = new Set();
        const diverse = [];
        for (const c of filtered) {
            if (!seen.has(c.type)) {
                seen.add(c.type);
                diverse.push(c);
            }
            if (diverse.length >= 3) break;
        }
        return diverse;
    }

    // ═══ b91: MERGE positioning candidates into regular sections (Option C) ═══
    // Clear stale positioning flags from previous renders
    for (const c of (bd.generated_candidates || [])) { delete c._posMatch; delete c._posOnly; }
    if (STATE.positioningCandidates) {
        for (const c of STATE.positioningCandidates) { delete c._posMatch; delete c._posOnly; }
    }

    const nfCands = diverseTop((bd.generated_candidates || []), 'NF');
    const bnfCands = diverseTop((bd.generated_candidates || []), 'BNF');

    // Build set of positioning candidate IDs (only if 315pm captured + global direction filled)
    const posIds = new Set();
    const gd315 = (JSON.parse(NativeBridge.getGlobalDirection() || '{}'));
    const gcFilled315 = has315 && gd315.dowNow !== null && gd315.crudeNow !== null;
    if (gcFilled315 && STATE.positioningCandidates?.length > 0) {
        for (const pc of STATE.positioningCandidates) posIds.add(pc.id);
    }

    if (posIds.size > 0) {
        // Tag regular candidates that also appear in positioning
        for (const c of nfCands) { c._posMatch = posIds.has(c.id); }
        for (const c of bnfCands) { c._posMatch = posIds.has(c.id); }

        // Append positioning-only candidates (not already in regular list)
        const regularIds = new Set([...nfCands, ...bnfCands].map(c => c.id));
        const posOnlyNf = STATE.positioningCandidates.filter(c =>
            c.index === 'NF' && !regularIds.has(c.id) && isDirectionSafe(c) && !c.capitalBlocked
        ).slice(0, 2);
        const posOnlyBnf = STATE.positioningCandidates.filter(c =>
            c.index === 'BNF' && !regularIds.has(c.id) && isDirectionSafe(c) && !c.capitalBlocked
        ).slice(0, 2);
        for (const c of posOnlyNf) { c._posOnly = true; nfCands.push(c); }
        for (const c of posOnlyBnf) { c._posOnly = true; bnfCands.push(c); }
    }
    const nfTotal = (bd.generated_candidates || []).filter(c => c.index === 'NF').length;
    if (nfCands.length) {
        html += renderCandidateCard(nfCands[0], nfAtm, 1);
        if (nfCands.length > 1) {
            html += `<details><summary style="cursor:pointer;font-size:12px;color:var(--accent);padding:6px 0;user-select:none;">NF: ${nfCands.length - 1} more ▸</summary>`;
            nfCands.slice(1).forEach((c, i) => { html += renderCandidateCard(c, nfAtm, i + 2); });
            html += '</details>';
        }
    } else if (nfTotal > 0) {
        const nfAgainst = (bd.generated_candidates || []).filter(c => c.index === 'NF' && !isDirectionSafe(c)).length;
        const reason = nfAgainst > 0 ? `${nfAgainst} strategies exist but go AGAINST your bias. WAIT for aligned setup.` :
            STATE.tradeMode === 'swing' ? 'None fit conditions. Try INTRADAY mode?' : 'WAIT for better setup.';
        html += `<div class="empty-state">NF: ${nfTotal} generated — ${reason}</div>`;
    } else {
        html += '<div class="empty-state">No NF candidates</div>';
    }

    // ═══ BANK NIFTY — collapsed by default ═══
    const bnfTotal = (bd.generated_candidates || []).filter(c => c.index === 'BNF').length;
    if (bnfCands.length) {
        html += `<details><summary style="cursor:pointer;font-size:13px;font-weight:600;color:var(--text-primary);padding:8px 0;user-select:none;">BANK NIFTY — ${bnfCands.length} candidates ▸</summary>`;
        bnfCands.forEach((c, i) => { html += renderCandidateCard(c, bnfAtm, i + 1); });
        html += '</details>';
    } else if (bnfTotal > 0) {
        const bnfAgainst = (bd.generated_candidates || []).filter(c => c.index === 'BNF' && !isDirectionSafe(c)).length;
        const reason = bnfAgainst > 0 ? `${bnfAgainst} strategies exist but go AGAINST your bias. WAIT.` : 'None fit current conditions.';
        html += `<div class="empty-state">BNF: ${bnfTotal} generated — ${reason}</div>`;
    } else {
        html += '<div class="empty-state">No BNF candidates</div>';
    }

    el.innerHTML = html;
}

function renderCandidateCard(cand, atm, rank) {
    const forces = cand.forces;
    const dots = alignmentDots(forces.aligned);
    const dirSafe = isDirectionSafe(cand);
    const alignLabel = !dirSafe ? '⛔ AGAINST BIAS' :
        forces.aligned === 3 ? '🟢 ALIGNED — Entry Ready' :
        forces.aligned === 2 ? '🟡 CONDITIONAL' : '⚫ WATCHING';
    const alignClass = !dirSafe ? 'align-1' :
        forces.aligned === 3 ? 'align-3' :
        forces.aligned === 2 ? 'align-2' : 'align-1';

    const is4Leg = cand.legs === 4;
    const otmDist = Math.abs(cand.sellStrike - atm);
    const otmLabel = otmDist < 50 ? 'ATM' : 'OTM';
    const premLabel = cand.isCredit ? 'Net Credit' : 'Net Debit';

    // Legs — execution order: BUY protection first, then SELL credit (Indian margin rule)
    let legsText = '';
    if (is4Leg) {
        // IC/IB: numbered execution order — BUY before SELL on each side
        legsText = `<span style="opacity:0.5">①</span> BUY ${cand.buyStrike} ${cand.buyType} @₹${cand.buyLTP?.toFixed(1)} <span style="opacity:0.5">(protection)</span><br>` +
            `<span style="opacity:0.5">②</span> SELL ${cand.sellStrike} ${cand.sellType} (${otmLabel}) @₹${cand.sellLTP?.toFixed(1)} <span style="opacity:0.5">(credit)</span><br>` +
            `<span style="opacity:0.5">③</span> BUY ${cand.buyStrike2} ${cand.buyType2} @₹${cand.buyLTP2?.toFixed(1)} <span style="opacity:0.5">(protection)</span><br>` +
            `<span style="opacity:0.5">④</span> SELL ${cand.sellStrike2} ${cand.sellType2} @₹${cand.sellLTP2?.toFixed(1)} <span style="opacity:0.5">(credit)</span>`;
    } else if (cand.isCredit) {
        // Credit 2-leg: BUY protection first, then SELL credit
        legsText = `<span style="opacity:0.5">①</span> BUY ${cand.buyStrike} ${cand.buyType} (${otmLabel}) @₹${cand.buyLTP?.toFixed(1)} <span style="opacity:0.5">(protection)</span><br>` +
            `<span style="opacity:0.5">②</span> SELL ${cand.sellStrike} ${cand.sellType} (${otmLabel}) @₹${cand.sellLTP?.toFixed(1)} <span style="opacity:0.5">(credit)</span>`;
    } else {
        // Debit 2-leg: BUY main leg first, SELL hedge
        legsText = `<span style="opacity:0.5">①</span> BUY ${cand.buyStrike} ${cand.buyType} (${otmLabel}) @₹${cand.buyLTP?.toFixed(1)}<br>` +
            `<span style="opacity:0.5">②</span> SELL ${cand.sellStrike} ${cand.sellType} (${otmLabel}) @₹${cand.sellLTP?.toFixed(1)}`;
    }

    // VIX trend badge for IC/IB candidates
    let vixTrendBadge = '';
    if ((cand.type === 'IRON_BUTTERFLY' || cand.type === 'IRON_CONDOR') && (JSON.parse(NativeBridge.getPollHistory() || '[]'))?.length >= 3) {
        const recentPolls = (JSON.parse(NativeBridge.getPollHistory() || '[]')).slice(-3);
        const vixTrend = (recentPolls[recentPolls.length-1]?.vix || 0) - (recentPolls[0]?.vix || 0);
        if (vixTrend >= 0.5) {
            vixTrendBadge = `<span style="background:var(--warn);color:#000;font-size:9px;padding:1px 4px;border-radius:3px;margin-left:4px">🌡️ VIX↑${vixTrend.toFixed(1)}</span>`;
        }
    }

    return `
    <div class="v1-card ${alignClass}" data-id="${cand.id}">
        <div class="v1-header">
            <div>
                <span class="v1-type">${friendlyType(cand.type)}</span>
                <span class="v1-tier">${dots}</span>
                ${cand.wallTag ? `<span class="v1-wall-tag">${cand.wallTag}</span>` : ''}
                ${cand.gammaTag ? `<span class="v1-gamma-tag">${cand.gammaTag}</span>` : ''}
                ${(cand.type === 'IRON_BUTTERFLY' || cand.type === 'IRON_CONDOR') && cand.tDTE <= 1 ? `<span style="background:#D32F2F;color:#fff;font-size:9px;padding:1px 4px;border-radius:3px;margin-left:4px">⏱ EXIT TODAY</span>` : ''}
                ${vixTrendBadge}
            </div>
            <span class="v1-rank">${cand._posMatch ? '<span style="background:#7B2FC4;color:#fff;font-size:8px;padding:1px 4px;border-radius:3px;margin-right:4px">📌+⚡</span>' : cand._posOnly ? '<span style="background:#7B2FC4;color:#fff;font-size:8px;padding:1px 4px;border-radius:3px;margin-right:4px">⚡ TMR</span>' : ''}${rank === 1 && cand.brainScore > 0 ? '🧠 ' : ''}#${rank || ''}</span>
        </div>
        <div class="v1-sub">${cand.index} · ${cand.expiry || '--'} · DTE ${cand.tDTE || '--'}T${cand.brainScore ? ` · <span style="color:${cand.brainScore > 0 ? 'var(--green)' : cand.brainScore < 0 ? 'var(--danger)' : 'var(--text-muted)'};font-weight:600">🧠${cand.brainScore > 0 ? '+' : ''}${cand.brainScore.toFixed(2)}</span>` : ''}</div>
        <div class="v1-legs">${legsText}</div>
        <div class="v1-prem">${premLabel} ₹${cand.netPremium}/share · W:${cand.width}</div>
        ${(() => {
            if (cand.beUpper && cand.beLower) {
                const spot = cand.index === 'BNF' ? (JSON.parse(NativeBridge.getLatestPoll() || '{}'))?.bnfSpot : (JSON.parse(NativeBridge.getLatestPoll() || '{}'))?.nfSpot;
                const upperCush = spot ? Math.round(cand.beUpper - spot) : null;
                const lowerCush = spot ? Math.round(spot - cand.beLower) : null;
                const cushStr = (upperCush != null && lowerCush != null)
                    ? ` <span style="color:var(--text-muted);font-size:9px">(↑${upperCush}pts / ↓${lowerCush}pts)</span>` : '';
                return `<div style="font-size:10px;color:var(--text-muted);margin-top:2px">BE: <span style="color:var(--accent);font-weight:600">${cand.beLower.toLocaleString()} ↔ ${cand.beUpper.toLocaleString()}</span>${cushStr}</div>`;
            } else if (cand.beUpper) {
                const spot = cand.index === 'BNF' ? (JSON.parse(NativeBridge.getLatestPoll() || '{}'))?.bnfSpot : (JSON.parse(NativeBridge.getLatestPoll() || '{}'))?.nfSpot;
                const cush = spot ? Math.round(cand.beUpper - spot) : null;
                return `<div style="font-size:10px;color:var(--text-muted);margin-top:2px">BE: <span style="color:var(--accent);font-weight:600">${cand.beUpper.toLocaleString()}</span>${cush != null ? ` <span style="color:var(--text-muted);font-size:9px">(${cush}pts buffer)</span>` : ''}</div>`;
            } else if (cand.beLower) {
                const spot = cand.index === 'BNF' ? (JSON.parse(NativeBridge.getLatestPoll() || '{}'))?.bnfSpot : (JSON.parse(NativeBridge.getLatestPoll() || '{}'))?.nfSpot;
                const cush = spot ? Math.round(spot - cand.beLower) : null;
                return `<div style="font-size:10px;color:var(--text-muted);margin-top:2px">BE: <span style="color:var(--accent);font-weight:600">${cand.beLower.toLocaleString()}</span>${cush != null ? ` <span style="color:var(--text-muted);font-size:9px">(${cush}pts buffer)</span>` : ''}</div>`;
            }
            return '';
        })()}
        ${cand.sigmaOTM ? `<div style="font-size:10px;padding:2px 8px;color:${cand.sigmaOTM >= 0.5 && cand.sigmaOTM <= 0.8 ? 'var(--green)' : cand.sigmaOTM < 0.5 ? 'var(--danger)' : 'var(--warn)'}">Strike: ${cand.sigmaOTM}σ OTM ${cand.sigmaOTM >= 0.5 && cand.sigmaOTM <= 0.8 ? '● SWEET SPOT' : cand.sigmaOTM > 0.8 ? '● thin credit zone' : '● too close'}</div>` : ''}
        ${renderBrainForCandidate(cand.id)}

        <div class="v1-metrics">
            <div class="v1-metric"><span class="v1-label">Max Profit</span><span class="v1-val green">₹${cand.maxProfit.toLocaleString()}${cand.realisticMaxProfit ? ` <span style="font-size:9px;color:var(--text-muted)">(actual ~₹${cand.realisticMaxProfit.toLocaleString()})</span>` : cand.intradayTheta && cand.tDTE > 2 ? ` <span style="font-size:9px;color:var(--text-muted)">(Θ ₹${cand.intradayTheta.toLocaleString()}/day)</span>` : ''}</span></div>
            <div class="v1-metric"><span class="v1-label">Max Loss</span><span class="v1-val red">₹${cand.maxLoss.toLocaleString()}</span></div>
            <div class="v1-metric"><span class="v1-label">R:R</span><span class="v1-val">${cand.riskReward || '--'}</span></div>
            ${cand.rawProbProfit && cand.rawProbProfit !== cand.probProfit ? `<div class="v1-metric"><span class="v1-label">P(Range)</span><span class="v1-val">${(cand.rawProbProfit * 100).toFixed(1)}%</span></div>` : ''}
            <div class="v1-metric"><span class="v1-label">P(Profit)</span><span class="v1-val${cand.upstoxPop && Math.abs(cand.probProfit * 100 - cand.upstoxPop) > 20 ? '" style="color:var(--danger)' : ''}">${(cand.probProfit * 100).toFixed(1)}%${cand.upstoxPop ? ` <span style="font-size:9px;color:var(--text-muted)">(UPX:${cand.upstoxPop.toFixed(0)}%)</span>` : ''}</span></div>
            ${CALIBRATION.win_rates[cand.type] && CALIBRATION.win_rates[cand.type].total > 0 ? `<div class="v1-metric"><span class="v1-label">Track Record</span><span class="v1-val" style="color:${CALIBRATION.win_rates[cand.type].rate >= 0.7 ? 'var(--green)' : CALIBRATION.win_rates[cand.type].rate >= 0.4 ? 'var(--warn)' : 'var(--danger)'}">${CALIBRATION.win_rates[cand.type].verdict} ${CALIBRATION.win_rates[cand.type].wins}/${CALIBRATION.win_rates[cand.type].total} (${(CALIBRATION.win_rates[cand.type].rate * 100).toFixed(0)}%)</span></div>` : ''}
        </div>

        <div class="v1-target">🎯 Target: ₹${cand.targetProfit?.toLocaleString() || '--'} | 🔴 SL: ₹${cand.stopLoss?.toLocaleString() || '--'}${cand.intradayTheta && (cand.type === 'IRON_CONDOR' || cand.type === 'IRON_BUTTERFLY') ? ' <span style="font-size:9px;color:var(--text-muted)">(intraday Θ)</span>' : ''}</div>
        ${cand.estCost ? `<div class="v1-cost" style="font-size:10px;color:${cand.costWarning ? 'var(--danger)' : 'var(--text-muted)'};padding:2px 0">${cand.costWarning ? '⚠️' : '💸'} Est. cost: ₹${cand.estCost.toLocaleString()} (${cand.estCostPct}% of max) · Net profit: ₹${(cand.netMaxProfit ?? 0).toLocaleString()}</div>` : ''}

        <div class="v1-forces">
            ${forceIcon(forces.f1)}Δ ${forceIcon(forces.f2)}Θ ${forceIcon(forces.f3)}IV · ${cand.varsityTier === 'PRIMARY' ? '<span style="color:var(--green)">PRIMARY</span>' : '<span style="color:var(--warn)">ALLOWED</span>'}${cand.wallTag ? ' 🛡️' : ''}${cand.gammaTag ? ` <span style="color:var(--danger)">${cand.gammaTag}</span>` : ''}
        </div>
        <div class="v1-footer">
            💰 BUY first ₹${peakCash(cand).toLocaleString()} → Margin: ₹${estimateBrokerMargin(cand).toLocaleString()}${cand.legs === 4 ? ' <span style="font-size:9px;color:var(--warn)">(est. SPAN)</span>' : ''}
            · EV/₹1K: ₹${(cand.ev / (peakCash(cand) / 1000 || 1)).toFixed(0)}
        </div>

        <div class="v1-align ${alignClass}">${alignLabel}</div>
        <div class="v1-trade-btns">
            ${forces.aligned >= 2 ? (() => {
                // b116: ML badge + REAL TRADE button (only when forces aligned >= 2)
                const mlBadge = cand.p_ml != null
                    ? `<div style="font-size:10px;margin-bottom:4px;display:flex;align-items:center;gap:6px">
                           <span style="background:${cand.mlAction==='TAKE'?'#388E3C':cand.mlAction==='WATCH'?'#F57C00':cand.mlAction==='BLOCKED'?'#7B2FC4':'#D32F2F'};color:#fff;border-radius:4px;padding:2px 7px;font-weight:600">
                               ML ${Math.round((cand.p_ml||0)*100)}% ${cand.mlAction||''}${cand.mlOod?' ⚠️':''}
                           </span>
                           ${cand.mlRegime ? `<span style="font-size:9px;color:var(--text-muted)">${cand.mlRegime}</span>` : ''}
                           ${cand.mlEdge != null ? `<span style="font-size:9px;color:${cand.mlEdge>=0?'var(--green)':'var(--danger)'}">${cand.mlEdge>=0?'+':''}${(cand.mlEdge*100).toFixed(0)}% edge</span>` : ''}
                       </div>
                       ${cand.mlOodWarn?.length ? `<div style="font-size:9px;color:var(--danger);margin-bottom:4px">⚠️ ${cand.mlOodWarn[0]}</div>` : ''}`
                    : '';
                const isBlocked = cand.mlOodBlocked === true;
                const realBtn = isBlocked
                    ? `<button class="btn-take" disabled style="opacity:0.45;cursor:not-allowed;background:#7B2FC4" title="${(cand.mlOodWarn||[]).join(' | ') || 'ML: No training data for this scenario'}">🚫 ML BLOCKED</button>`
                    : `<button class="btn-take" onclick="takeTrade('${cand.id}', false)">📌 REAL TRADE${cand.costWarning ? ' ⚠️' : ''}</button>`;
                return mlBadge + realBtn;
            })() : `<button disabled style="opacity:0.4;cursor:not-allowed;flex:1;padding:8px;border:none;border-radius:6px;background:var(--surface);color:var(--text-muted);font-size:12px">⚫ WATCHING</button>`}
            <button class="btn-paper" onclick="takeTrade('${cand.id}', true)">📋 PAPER${!canPaperTrade(cand.index) ? ' (FULL)' : ''}</button>
        </div>
    </div>`;
}

// ═══ TRADE CARD — shared renderer for real + paper positions ═══
function renderTradeCard(t, isPaper) {
    const forces = t.forces || {
        f1: t.force_f1 || 0, f2: t.force_f2 || 0, f3: t.force_f3 || 0,
        aligned: t.force_alignment || 0
    };
    const pnlClass = t.current_pnl >= 0 ? 'pnl-pos' : 'pnl-neg';
    const dots = alignmentDots(forces.aligned);

    const ci = t.controlIndex;
    let ciColor = 'var(--text-muted)', ciLabel = 'Calculating...';
    if (ci !== null && ci !== undefined) {
        ciColor = ci > 20 ? 'var(--green)' : ci < -20 ? 'var(--danger)' : 'var(--warn)';
        ciLabel = ci > 30 ? 'You in control' : ci > 0 ? 'Slight advantage' : ci > -30 ? 'Opponent gaining' : 'Opponent in control';
    }
    const ciPct = ci !== null && ci !== undefined ? Math.max(0, Math.min(100, (ci + 100) / 2)) : 50;
    const cardBorderColor = ci !== null && ci !== undefined ? (ci > 20 ? 'var(--green)' : ci < -20 ? 'var(--danger)' : 'var(--warn)') : 'var(--border)';

    const icon = isPaper ? '📋' : '📌';
    const paperClass = isPaper ? ' paper-card' : '';
    const modeTag = t.trade_mode ? `<span class="mode-tag mode-${t.trade_mode}">${t.trade_mode.toUpperCase()}</span>` : '';

    // Entry time + elapsed
    const entryTime = t.entry_date ? new Date(t.entry_date).toLocaleTimeString('en-IN', { timeZone: 'Asia/Kolkata', hour: '2-digit', minute: '2-digit', hour12: true }) : '--';
    const entryDateShort = t.entry_date ? new Date(t.entry_date).toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata', day: 'numeric', month: 'short' }) : '';
    let elapsed = '';
    if (t.entry_date) {
        const mins = Math.floor((Date.now() - new Date(t.entry_date).getTime()) / 60000);
        if (mins < 60) elapsed = `${mins}m`;
        else if (mins < 1440) elapsed = `${Math.floor(mins / 60)}h ${mins % 60}m`;
        else elapsed = `${Math.floor(mins / 1440)}d ${Math.floor((mins % 1440) / 60)}h`;
    }

    return `
    <div class="position-card${paperClass}" style="border-left:4px solid ${cardBorderColor}">
        <div class="pos-header">
            <span class="pos-title">${icon} ${t.index_key} ${friendlyType(t.strategy_type)} ${modeTag}</span>
            <span class="pos-strikes">${t.sell_strike}/${t.buy_strike} W:${t.width}</span>
        </div>
        <div class="pos-timing">${t.entry_date ? `⏱ ${entryDateShort} ${entryTime} · ${elapsed} ago` : ''}</div>
        <div class="pos-pnl ${pnlClass}">
            P&L: ₹${t.current_pnl?.toLocaleString() || 0}
            ${t.peak_pnl > 0 ? `<span class="pos-peak">(peak ₹${t.peak_pnl.toLocaleString()})</span>` : ''}
        </div>
        ${(() => {
            const legs = (t.strategy_type === 'IRON_CONDOR' || t.strategy_type === 'IRON_BUTTERFLY') ? 4 : 2;
            const lotSize = t.index_key === 'NF' ? C.NF_LOT : C.BNF_LOT;
            // For 4-leg trades, sell_ltp2 isn't stored separately — estimate both sell legs
            const sellPrem = (t.sell_ltp || 0) * lotSize * (legs === 4 ? 2 : 1);
            const slipPU = legs === 4 ? (t.index_key === 'BNF' ? C.SLIPPAGE.BNF_4LEG : C.SLIPPAGE.NF_4LEG) : (t.index_key === 'BNF' ? C.SLIPPAGE.BNF_2LEG : C.SLIPPAGE.NF_2LEG);
            const estCost = Math.round(sellPrem * C.STT_OPTIONS * 2 + C.BROKERAGE_PER_ORDER * legs * 2 + C.EXCHANGE_PER_LEG * legs * 2 * 1.18 + slipPU * lotSize * legs * 2 + 3);
            const netPnl = (t.current_pnl || 0) - estCost;
            return `<div style="font-size:10px;color:var(--text-muted);margin-top:-4px;margin-bottom:4px">Net: ₹${netPnl.toLocaleString()} <span style="color:var(--text-dimmed)">(cost ~₹${estCost.toLocaleString()})</span></div>`;
        })()}
        <div class="control-section">
            ${t.max_profit || t.max_loss ? `<div style="display:flex;justify-content:space-between;font-size:11px;padding:4px 0;border-bottom:1px solid var(--border)">
                <span style="color:var(--green)">🎯 Max: ₹${(t.max_profit || 0).toLocaleString()}</span>
                <span style="color:var(--text-muted)">P&L: ${t.max_profit > 0 ? Math.round((t.current_pnl || 0) / t.max_profit * 100) : 0}% of max</span>
                <span style="color:var(--danger)">🛑 Loss: ₹${(t.max_loss || 0).toLocaleString()}</span>
            </div>` : ''}
            <div class="env-row">
                <span class="env-row-label" style="color:${ciColor};font-weight:600">${ciLabel}</span>
                <span class="env-row-value" style="color:${ciColor}">${ci !== null && ci !== undefined ? ci : '--'}</span>
            </div>
            <div class="control-bar">
                <div class="control-fill" style="width:${ciPct}%; background:${ciColor}"></div>
            </div>
            ${t.wallDrift ? `<div style="font-size:10px;padding:2px 8px;margin-top:2px;color:${t.wallDrift.severity >= 2 ? 'var(--danger)' : 'var(--warn)'}">
                ${t.wallDrift.warning}
            </div>` : ''}
            ${t.vixSpike && t.vixSpike.change >= 0.5 ? `<div style="font-size:10px;padding:2px 8px;margin-top:2px;color:${t.vixSpike.change >= 2.0 ? 'var(--danger)' : t.vixSpike.change >= 1.0 ? 'var(--warn)' : 'var(--text-muted)'}">
                🌡️ VIX ${t.vixSpike.entryVix.toFixed(1)}→${t.vixSpike.currentVix.toFixed(1)} (${t.vixSpike.change > 0 ? '+' : ''}${t.vixSpike.change}${t.vixSpike.change >= 2.0 ? ' ⚠️ SPIKE — EXIT' : t.vixSpike.change >= 1.0 ? ' — rising' : ''})
            </div>` : ''}
            ${(() => {
                const beU = t.be_upper ?? t.beUpper ?? null;
                const beL = t.be_lower ?? t.beLower ?? null;
                const curSpot = t.index_key === 'BNF' ? (JSON.parse(NativeBridge.getLatestPoll() || '{}'))?.bnfSpot : (JSON.parse(NativeBridge.getLatestPoll() || '{}'))?.nfSpot;
                if (!curSpot || (!beU && !beL)) return '';
                let beText = '', cushionPts = null, danger = false;
                if (beU && beL) {
                    const uCush = Math.round(beU - curSpot);
                    const lCush = Math.round(curSpot - beL);
                    cushionPts = Math.min(uCush, lCush);
                    danger = cushionPts < 0;
                    beText = `BE: ${beL.toLocaleString()} ↔ ${beU.toLocaleString()} | ↑${uCush}pts / ↓${lCush}pts`;
                } else if (beU) {
                    cushionPts = Math.round(beU - curSpot);
                    danger = cushionPts < 0;
                    beText = `BE: ${beU.toLocaleString()} | ${Math.abs(cushionPts)}pts ${cushionPts < 0 ? '⚠️ BREACHED' : 'buffer'}`;
                } else {
                    cushionPts = Math.round(curSpot - beL);
                    danger = cushionPts < 0;
                    beText = `BE: ${beL.toLocaleString()} | ${Math.abs(cushionPts)}pts ${cushionPts < 0 ? '⚠️ BREACHED' : 'buffer'}`;
                }
                const color = danger ? 'var(--danger)' : cushionPts < 50 ? 'var(--warn)' : 'var(--text-muted)';
                return `<div style="font-size:10px;padding:3px 8px;margin-top:2px;color:${color};border-top:1px solid var(--border)">📍 ${beText}</div>`;
            })()}
        </div>
        ${renderBrainForTrade(t.id)}
        <div class="pos-actions">
            <button class="btn-close-profit" onclick="closeTrade('${t.id}', 'Brain said BOOK')">💰 Book Profit</button>
            <button class="btn-close-loss" onclick="closeTrade('${t.id}', ${(t.current_pnl ?? 0) > 0 ? "'Manual exit'" : "'Stop loss'"})">🛑 Exit</button>
        </div>
        <details class="exit-reasons" style="margin-top:4px">
            <summary style="cursor:pointer;font-size:10px;color:var(--text-muted);user-select:none">More exit reasons ▸</summary>
            <div style="display:flex;flex-wrap:wrap;gap:4px;margin-top:4px">
                <button style="font-size:10px;padding:3px 8px;border:1px solid var(--border);border-radius:4px;background:var(--bg-card);cursor:pointer" onclick="closeTrade('${t.id}', 'Target hit')">🎯 Target</button>
                <button style="font-size:10px;padding:3px 8px;border:1px solid var(--border);border-radius:4px;background:var(--bg-card);cursor:pointer" onclick="closeTrade('${t.id}', 'Thesis broke')">📉 Thesis broke</button>
                <button style="font-size:10px;padding:3px 8px;border:1px solid var(--border);border-radius:4px;background:var(--bg-card);cursor:pointer" onclick="closeTrade('${t.id}', 'Expiry exit')">⏱️ Expiry</button>
                <button style="font-size:10px;padding:3px 8px;border:1px solid var(--border);border-radius:4px;background:var(--bg-card);cursor:pointer" onclick="closeTrade('${t.id}', 'Wall drift')">🛡️ Wall drift</button>
                <button style="font-size:10px;padding:3px 8px;border:1px solid var(--border);border-radius:4px;background:var(--bg-card);cursor:pointer" onclick="closeTrade('${t.id}', 'Panic')">😰 Panic</button>
                <button style="font-size:10px;padding:3px 8px;border:1px solid var(--border);border-radius:4px;background:var(--bg-card);cursor:pointer" onclick="closeTrade('${t.id}', 'Manual')">✋ Manual</button>
            </div>
        </details>
        <details style="margin-top:6px">
            <summary style="cursor:pointer;font-size:11px;color:var(--text-muted);user-select:none">Trade details ▸</summary>
            <div class="pos-detail">
                Entry: ₹${t.entry_premium} ${t.is_credit ? 'credit' : 'debit'}
                · Now: ₹${t.current_premium || '--'}
                · Spot: ${t.current_spot?.toFixed(0) || '--'}
            </div>
            <div class="pos-forces">
                ${dots} ${forceIcon(forces.f1)} Direction ${forceIcon(forces.f2)} Time ${forceIcon(forces.f3)} Vol
            </div>
            <div class="pos-detail">
                Entry VIX: ${t.entry_vix?.toFixed(1) || '--'} · Bias: ${t.entry_bias || '--'} · Forces: ${t.force_alignment}/3
                ${t.trade_mode ? ` · Mode: ${t.trade_mode}` : ''}
            </div>
        </details>
    </div>`;
}

function renderPosition() {
    const el = document.getElementById('position');
    if (!el) return;

    let html = '';
    const lastUpdate = (JSON.parse(NativeBridge.getServiceStatus() || '{}').lastPoll) ? new Date((JSON.parse(NativeBridge.getServiceStatus() || '{}').lastPoll)).toLocaleTimeString('en-IN', { timeZone: 'Asia/Kolkata', hour: '2-digit', minute: '2-digit', hour12: true }) : '';

    // ═══ SIGNAL ACCURACY — compact, collapsible ═══
    if (bd.signalValidation) {
        const sv = bd.signalValidation;
        html += `<details>
            <summary style="cursor:pointer;font-size:12px;padding:4px 0;user-select:none">📡 Yesterday: ${sv.predicted} → ${sv.correct ? '✅' : '❌'} ${sv.actualDir} (${sv.actualGap > 0 ? '+' : ''}${sv.actualGap?.toFixed(0)} pts)${(JSON.parse(NativeBridge.getSignalAccuracyStats() || '{}')) ? ` · ${(JSON.parse(NativeBridge.getSignalAccuracyStats() || '{}')).pct}% accuracy` : ''} ▸</summary>
            <div class="signal-accuracy-card">
                <div class="env-row"><span class="env-row-label">Predicted</span><span class="env-row-value">${sv.predicted} (${sv.strength}/5)</span></div>
                <div class="env-row"><span class="env-row-label">Actual Gap</span><span class="env-row-value" style="color:${sv.correct ? 'var(--green)' : 'var(--danger)'}">${sv.actualGap > 0 ? '+' : ''}${sv.actualGap?.toFixed(0)} pts → ${sv.actualDir} ${sv.correct ? '✅' : '❌'}</span></div>
                ${(JSON.parse(NativeBridge.getSignalAccuracyStats() || '{}')) ? `<div class="env-row"><span class="env-row-label">Accuracy</span><span class="env-row-value" style="color:var(--accent)">${(JSON.parse(NativeBridge.getSignalAccuracyStats() || '{}')).correct}/${(JSON.parse(NativeBridge.getSignalAccuracyStats() || '{}')).total} (${(JSON.parse(NativeBridge.getSignalAccuracyStats() || '{}')).pct}%)</span></div>` : ''}
            </div>
        </details>`;
    }

    // ═══ OPEN TRADES — split real vs paper ═══
    const realTrades = (JSON.parse(NativeBridge.getOpenTrades() || '[]')).filter(t => !t.paper);
    const paperTrades = (JSON.parse(NativeBridge.getOpenTrades() || '[]')).filter(t => t.paper);

    if (realTrades.length === 0 && paperTrades.length === 0) {
        html += '<div class="empty-state">No open positions</div>';
    }

    // ═══ REAL TRADES ═══
    if (realTrades.length > 0) {
        if (realTrades.length > 1) {
            const totalPnL = realTrades.reduce((s, t) => s + (t.current_pnl || 0), 0);
            const totalClass = totalPnL >= 0 ? 'pnl-pos' : 'pnl-neg';
            html += `<div class="total-pnl-bar ${totalClass}">📌 Real P&L: ₹${totalPnL.toLocaleString()} (${realTrades.length} positions)</div>`;
        }
        html += `<div class="section-timestamp">Last updated: ${lastUpdate || API.istNow()}</div>`;
        for (const t of realTrades) {
            html += renderTradeCard(t, false);
        }
    }

    // ═══ PAPER TRADES ═══
    if (paperTrades.length > 0) {
        const paperPnL = paperTrades.reduce((s, t) => s + (t.current_pnl || 0), 0);
        const paperClass = paperPnL >= 0 ? 'pnl-pos' : 'pnl-neg';
        const nfPapers = paperTrades.filter(t => t.index_key === 'NF').length;
        const bnfPapers = paperTrades.filter(t => t.index_key === 'BNF').length;
        html += `<div class="paper-header">📋 Paper Trades (${nfPapers} NF · ${bnfPapers} BNF)</div>`;
        const totalEstCost = paperTrades.reduce((s, t) => {
            const legs = (t.strategy_type === 'IRON_CONDOR' || t.strategy_type === 'IRON_BUTTERFLY') ? 4 : 2;
            const lotSize = t.index_key === 'NF' ? C.NF_LOT : C.BNF_LOT;
            const sellPrem = (t.sell_ltp || 0) * lotSize * (legs === 4 ? 2 : 1);
            const slipPU = legs === 4 ? (t.index_key === 'BNF' ? C.SLIPPAGE.BNF_4LEG : C.SLIPPAGE.NF_4LEG) : (t.index_key === 'BNF' ? C.SLIPPAGE.BNF_2LEG : C.SLIPPAGE.NF_2LEG);
            return s + Math.round(sellPrem * C.STT_OPTIONS * 2 + C.BROKERAGE_PER_ORDER * legs * 2 + C.EXCHANGE_PER_LEG * legs * 2 * 1.18 + slipPU * lotSize * legs * 2 + 3);
        }, 0);
        const netPaperPnL = paperPnL - totalEstCost;
        html += `<div class="total-pnl-bar paper-pnl ${paperClass}">Paper P&L: ₹${paperPnL.toLocaleString()}</div>`;
        html += `<div style="text-align:center;font-size:10px;color:var(--text-muted);margin:-8px 0 8px">Net (est.): ₹${netPaperPnL.toLocaleString()} · Costs: ₹${totalEstCost.toLocaleString()}</div>`;

        // Cross-test comparison: group by index to show side-by-side performance
        for (const idx of ['NF', 'BNF']) {
            const idxTrades = paperTrades.filter(t => t.index_key === idx);
            if (idxTrades.length > 1) {
                const sorted = [...idxTrades].sort((a, b) => (b.current_pnl || 0) - (a.current_pnl || 0));
                const best = sorted[0];
                const worst = sorted[sorted.length - 1];
                const diff = Math.abs((best.current_pnl || 0) - (worst.current_pnl || 0));
                if (diff > 0) {
                    const modeMatch = best.trade_mode !== worst.trade_mode;
                    const typeMatch = best.strategy_type !== worst.strategy_type;
                    let insight = '';
                    if (modeMatch) insight = `${best.trade_mode} beating ${worst.trade_mode}`;
                    else if (typeMatch) insight = `${friendlyType(best.strategy_type)} beating ${friendlyType(worst.strategy_type)}`;
                    if (insight) {
                        html += `<div class="cross-test-insight">${idx}: ${insight} by ₹${diff.toLocaleString()}</div>`;
                    }
                }
            }
        }

        if (realTrades.length === 0) {
            html += `<div class="section-timestamp">Last updated: ${lastUpdate || API.istNow()}</div>`;
        }
        for (const t of paperTrades) {
            html += renderTradeCard(t, true);
        }
    }

    // ═══ MANUAL TRADE FORM — collapsible ═══
    html += `
    <details style="margin-top:12px">
        <summary class="env-section-title" style="cursor:pointer;user-select:none;">📝 Log Manual Trade ▸</summary>
        <div class="input-grid">
            <div class="input-group">
                <label>Type</label>
                <select id="mt-type" class="input-field">
                    <option value="BEAR_CALL">Bear Call</option>
                    <option value="BULL_PUT">Bull Put</option>
                    <option value="BEAR_PUT">Bear Put</option>
                    <option value="BULL_CALL">Bull Call</option>
                    <option value="IRON_CONDOR">Iron Condor</option>
                </select>
            </div>
            <div class="input-group">
                <label>Index</label>
                <select id="mt-index" class="input-field">
                    <option value="BNF">Bank Nifty</option>
                    <option value="NF">Nifty 50</option>
                </select>
            </div>
            <div class="input-group">
                <label>Mode</label>
                <select id="mt-mode" class="input-field">
                    <option value="swing"${STATE.tradeMode === 'swing' ? ' selected' : ''}>Swing</option>
                    <option value="intraday"${STATE.tradeMode === 'intraday' ? ' selected' : ''}>Intraday</option>
                </select>
            </div>
            <div class="input-group">
                <label style="display:flex;align-items:center;gap:6px">
                    <input type="checkbox" id="mt-paper" checked> 📋 Paper Trade
                </label>
            </div>
            <div class="input-group">
                <label style="display:flex;align-items:center;gap:6px">
                    <input type="checkbox" id="mt-event"> 🎲 Event-driven (luck)
                </label>
            </div>
            <div class="input-group">
                <label>Sell Strike</label>
                <input type="text" inputmode="numeric" id="mt-sell" class="input-field" placeholder="55500">
            </div>
            <div class="input-group">
                <label>Buy Strike</label>
                <input type="text" inputmode="numeric" id="mt-buy" class="input-field" placeholder="55800">
            </div>
            <div class="input-group">
                <label>Sell LTP (₹)</label>
                <input type="text" inputmode="decimal" id="mt-sell-ltp" class="input-field" placeholder="429.3">
            </div>
            <div class="input-group">
                <label>Buy LTP (₹)</label>
                <input type="text" inputmode="decimal" id="mt-buy-ltp" class="input-field" placeholder="334.85">
            </div>
        </div>
        <button class="btn-primary" onclick="logManualTrade()" style="margin-top:8px">📌 Log Trade</button>
    </details>`;

    el.innerHTML = html;
}

function renderFooter() {
    const el = document.getElementById('footer-status');
    if (!el) return;
    const time = API.istNow();
    const watching = (JSON.parse(NativeBridge.getServiceStatus() || '{}').running) ? '🟢' : '⏹';
    const polls = STATE.pollCount;
    const bi = bd || {};
    const verdict = bi.verdict;
    const brain = STATE.brainReady ?
        (verdict?.action ? `🧠 ${verdict.action}${verdict.confidence ? ' ' + verdict.confidence + '%' : ''}` : '🧠 ready') :
        (STATE.brainError ? '🧠✗' : '🧠…');
    const riskAlert = (bi.risk || []).some(r => r.strength >= 4) ? ' ⚠️' : '';
    el.textContent = `${watching} ${time} · ${brain}${riskAlert} · Polls: ${polls}`;
}


// ═══════════════════════════════════════════════════════════════
// MORNING INPUT & INITIALIZATION
// ═══════════════════════════════════════════════════════════════

function lockMorningData() {
    try {
        initAudio();
        requestNotificationPermission();
        const triggerScan = () => startWatchLoop();

        const rawInputs = {
            date: API.todayIST(),
            fiiCash: parseFloat(document.getElementById('in-fii-cash')?.value || 0) || 0,
            fiiShortPct: parseFloat(document.getElementById('in-fii-short')?.value || 0) || 0,
            diiCash: parseFloat(document.getElementById('in-dii-cash')?.value || 0) || 0,
            fiiIdxFut: parseFloat(document.getElementById('in-fii-idx-fut')?.value || 0) || 0,
            fiiStkFut: parseFloat(document.getElementById('in-fii-stk-fut')?.value || 0) || 0,
            dowClose: parseFloat(document.getElementById('in-dow-close')?.value || 0) || 0,
            crudeSettle: parseFloat(document.getElementById('in-crude-settle')?.value || 0) || 0,
            upstoxBias: document.getElementById('in-upstox-bias')?.value || ''
        };
        localStorage.setItem('mr2_morning_inputs', JSON.stringify(rawInputs));
        localStorage.setItem('mr2_morning', JSON.stringify(rawInputs));

        const baseline = collectBaselineFromForm();
        localStorage.setItem('mr2_morning_baseline', JSON.stringify(baseline));

        if (typeof NativeBridge !== 'undefined' && NativeBridge.setBaseline) {
            NativeBridge.setBaseline(JSON.stringify(baseline));
        }

        document.querySelectorAll('.morning-input').forEach(el => el.disabled = true);
        const btnLock = document.getElementById('btn-lock');
        if (btnLock) {
            btnLock.disabled = true;
            btnLock.textContent = 'Scanning...';
        }
        const statusEl = document.getElementById('status');
        if (statusEl) statusEl.textContent = '✅ Morning data locked. Starting scan...';

        triggerScan();
        renderAll();
    } catch (e) {
        console.error('lockMorningData failed:', e);
        const statusEl = document.getElementById('status');
        if (statusEl) statusEl.textContent = `Lock failed: ${e.message}`;
    }
}


function restoreMorningData(cloudConfig) {
    // Priority: Supabase → localStorage
    let data = cloudConfig?.morning_inputs || null;
    if (!data) {
        const saved = localStorage.getItem('mr2_morning');
        if (!saved) return;
        try { data = JSON.parse(saved); } catch { return; }
    }

    // Only restore if saved today
    const today = API.todayIST();
    if (data.date && data.date !== today) return;

    if (data.fiiCash) document.getElementById('in-fii-cash').value = data.fiiCash;
    if (data.fiiShortPct) document.getElementById('in-fii-short').value = data.fiiShortPct;
    if (data.diiCash) { const el = document.getElementById('in-dii-cash'); if (el) el.value = data.diiCash; }
    if (data.fiiIdxFut) { const el = document.getElementById('in-fii-idx-fut'); if (el) el.value = data.fiiIdxFut; }
    if (data.fiiStkFut) { const el = document.getElementById('in-fii-stk-fut'); if (el) el.value = data.fiiStkFut; }
    if (data.upstoxBias) {
        const el = document.getElementById('in-upstox-bias');
        if (el) el.value = data.upstoxBias;
    }
    // Restore Dow/Crude morning reference
    if (data.dowClose) {
        const el = document.getElementById('in-dow-close');
        if (el) el.value = data.dowClose;
        (JSON.parse(NativeBridge.getGlobalDirection() || '{}')).dowClose = parseFloat(data.dowClose);
    }
    if (data.crudeSettle) {
        const el = document.getElementById('in-crude-settle');
        if (el) el.value = data.crudeSettle;
        (JSON.parse(NativeBridge.getGlobalDirection() || '{}')).crudeSettle = parseFloat(data.crudeSettle);
    }
    // Restore morning bias (the plan — survives device change via Supabase)
    const biasCloud = cloudConfig?.morning_bias;
    const biasData = (biasCloud?.date === today) ? biasCloud : data;
    const biasLabel = biasData?.biasLabel || biasData?.label;
    const biasNet = biasData?.biasNet ?? biasData?.net;
    if (biasLabel && biasNet !== undefined && biasNet !== null) {
        // Restore morningBias — field names vary (biasLabel vs label) depending on save path
        const bl = biasLabel;
        const bn = biasNet;
        STATE.morningBias = {
            label: bl,
            net: bn,
            votes: { bull: biasData.biasBull || 0, bear: biasData.biasBear || 0 },
            bias: bn >= 1 ? 'BULL' : bn <= -1 ? 'BEAR' : 'NEUTRAL',
            strength: Math.abs(bn) >= 3 ? 'STRONG' : Math.abs(bn) >= 1 ? 'MILD' : '',
            signals: biasData.signals || []
        };
    }
}

// Token is hardcoded via Analytics Token in api.js — no UI needed

function restoreGlobalContext(cloudConfig) {
    let parsed = cloudConfig?.global_direction || null;
    if (!parsed) {
        try {
            const saved = localStorage.getItem('mr2_global_context');
            if (saved) parsed = JSON.parse(saved);
        } catch { /* ignore */ }
    }
    if (!parsed) return;

    const today = API.todayIST();
    if (parsed._date && parsed._date !== today) {
        localStorage.removeItem('mr2_global_context');
        return;
    }
    if (parsed.dowNow) (JSON.parse(NativeBridge.getGlobalDirection() || '{}')).dowNow = parsed.dowNow;
    if (parsed.crudeNow) (JSON.parse(NativeBridge.getGlobalDirection() || '{}')).crudeNow = parsed.crudeNow;
    if (parsed.giftNow) (JSON.parse(NativeBridge.getGlobalDirection() || '{}')).giftNow = parsed.giftNow;
    if (parsed._date) (JSON.parse(NativeBridge.getGlobalDirection() || '{}'))._date = parsed._date;
}

async function loadOpenTrade() {
    let trades = [];
    try {
        if (typeof DB !== 'undefined' && DB.getOpenTrades) {
            trades = await DB.getOpenTrades();
        } else if (typeof NativeBridge !== 'undefined' && NativeBridge.getOpenTrades) {
            trades = JSON.parse(NativeBridge.getOpenTrades() || '[]');
        }
    } catch (e) {
        console.warn('[boot] loadOpenTrade skipped:', e.message);
        trades = [];
    }
    STATE.openTrades = (trades || []).map(t => {
        // Restore in-memory journey from Supabase journey_stats (survives refresh)
        if (t.journey_stats) {
            t._journey = {
                spot_high: t.journey_stats.spot_high ?? null,
                spot_low: t.journey_stats.spot_low ?? null,
                max_ci: t.journey_stats.max_ci ?? null,
                min_ci: t.journey_stats.min_ci ?? null,
                forces_changed_count: t.journey_stats.forces_changed_count ?? 0,
                _lastAlignment: t.force_alignment ?? null,
                timeline: t.journey_stats.timeline || []
            };
        }
        return t;
    });
}

function requestNotificationPermission() {
    if ('Notification' in window && Notification.permission === 'default') {
        Notification.requestPermission();
    }
}

// ═══ MORNING COLLAPSE ═══

function collapseMorning() {
    const section = document.getElementById('morning-section');
    const full = document.getElementById('morning-full');
    const collapsed = document.getElementById('morning-collapsed');
    if (!section || !full || !collapsed) return;

    const fii = (JSON.parse(NativeBridge.getMorningSnapshot(API.todayIST()) || '{}'))?.fiiCash || '--';
    const short = (JSON.parse(NativeBridge.getMorningSnapshot(API.todayIST()) || '{}'))?.fiiShortPct || '--';
    const time = API.istNow();

    full.style.display = 'none';
    collapsed.style.display = 'block';
    const regime = bd.institutionalRegime;
    const regimeTag = regime ? ` · <span style="color:${regime.regimeColor}">${regime.regime}</span>` : '';
    collapsed.innerHTML = `<div class="morning-collapsed-bar" onclick="expandMorning()">
        ☀️ FII ₹${fii}Cr · Short ${short}%${regimeTag} · Scanned ${time}
        <span style="color:var(--text-muted)">▸</span>
    </div>`;
    section.classList.add('collapsed');
}

function expandMorning() {
    const section = document.getElementById('morning-section');
    const full = document.getElementById('morning-full');
    const collapsed = document.getElementById('morning-collapsed');
    if (!section || !full || !collapsed) return;

    full.style.display = 'block';
    collapsed.style.display = 'none';
    section.classList.remove('collapsed');
}

// ═══ TAB SWITCHING ═══
function switchTab(tabName) {
    document.querySelectorAll('.tab-btn').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.tab === tabName);
    });
    document.querySelectorAll('.tab-content').forEach(tc => {
        tc.classList.toggle('active', tc.id === `tab-${tabName}`);
    });
    STATE.activeTab = tabName;
}

// ═══════════════════════════════════════════════════════════════
// EVENING CLOSE — Phase 10: Store reference for overnight delta
// ═══════════════════════════════════════════════════════════════

function saveEveningClose() {
    try {
        const dowValue = document.getElementById('in-eve-dow')?.value?.trim() || '';
        const crudeValue = document.getElementById('in-eve-crude')?.value?.trim() || '';
        const giftValue = document.getElementById('in-eve-gift')?.value?.trim() || '';
        const statusEl = document.getElementById('evening-status');

        if (!dowValue && !crudeValue && !giftValue) {
            if (statusEl) statusEl.textContent = 'Enter at least one value before saving.';
            return;
        }

        const payload = {
            dow: dowValue ? parseFloat(dowValue) : null,
            crude: crudeValue ? parseFloat(crudeValue) : null,
            gift: giftValue ? parseFloat(giftValue) : null,
            date: API.todayIST(),
            saved_at: new Date().toISOString()
        };

        STATE.eveningClose = payload;
        localStorage.setItem('mr2_evening_close', JSON.stringify(payload));
        if (statusEl) {
            statusEl.textContent = `Saved: ${payload.date} · Dow ${dowValue || '--'}, Crude ${crudeValue || '--'}, GIFT ${giftValue || '--'}`;
        }
        renderAll();
    } catch (e) {
        console.error('saveEveningClose failed:', e);
        const statusEl = document.getElementById('evening-status');
        if (statusEl) statusEl.textContent = `Save failed: ${e.message}`;
    }
}


function restoreEveningClose(cloudConfig) {
    let localData = null;
    try { localData = JSON.parse(localStorage.getItem('mr2_evening_close') || 'null'); } catch (e) {}
    const cloudData = cloudConfig?.evening_close || null;
    let data = localData || cloudData;
    if (localData && cloudData) {
        const localTime = Date.parse(localData.saved_at || localData.date || '') || 0;
        const cloudTime = Date.parse(cloudData.saved_at || cloudData.date || '') || 0;
        data = localTime >= cloudTime ? localData : cloudData;
    }
    if (!data) return;

    STATE.eveningClose = data;

    // Populate fields
    if (data.dow) { const el = document.getElementById('in-eve-dow'); if (el) el.value = data.dow; }
    if (data.crude) { const el = document.getElementById('in-eve-crude'); if (el) el.value = data.crude; }
    if (data.gift) { const el = document.getElementById('in-eve-gift'); if (el) el.value = data.gift; }

    const statusEl = document.getElementById('evening-status');
    if (statusEl) statusEl.textContent = `Loaded: ${data.date} · Dow ${data.dow || '--'}, Crude ${data.crude || '--'}, GIFT ${data.gift || '--'}`;
}

// Compute overnight delta — called during morning scan

// ═══════════════════════════════════════════════════════════════
// DATA EXPORT — One-click Excel download of all Supabase data
// ═══════════════════════════════════════════════════════════════


// ═══ INIT ═══
document.addEventListener('DOMContentLoaded', async () => {
    document.getElementById('btn-save-evening')?.addEventListener('click', saveEveningClose);

    // F.2.1b — DB module deleted in F.2; null-guard all DB.* calls so boot completes
    // and button event listeners get attached. Restores rely on localStorage fallback.
    try { if (typeof DB !== 'undefined' && DB.init) DB.init(); } catch (e) { console.warn('[boot] DB.init skipped:', e.message); }

    // Fetch all config from Supabase (single query) — localStorage fallback if offline
    let cloudConfig = null;
    try { if (typeof DB !== 'undefined' && DB.getAllConfig) cloudConfig = await DB.getAllConfig(); } catch (e) { console.warn('[boot] DB.getAllConfig skipped:', e.message); }

    restoreMorningData(cloudConfig);
    restoreGlobalContext(cloudConfig);
    restoreEveningClose(cloudConfig);

    // Phase 11: Restore today's poll history (survives refresh + background kill)
    // Fetched separately because getAllConfig now excludes poll_history_* for performance
    const todayKey = 'poll_history_' + API.todayIST();
    let todayPolls = null;
    try { if (typeof DB !== 'undefined' && DB.getConfig) todayPolls = await DB.getConfig(todayKey); } catch (e) { console.warn('[boot] DB.getConfig(poll_history) skipped:', e.message); }
    if (todayPolls && Array.isArray(todayPolls)) {
        // b95: MERGE — keep whichever is longer (Supabase vs in-memory)
        // Prevents background kill from overwriting morning data
        if (todayPolls.length > (JSON.parse(NativeBridge.getPollHistory() || '[]')).length) {
            STATE.pollHistory = todayPolls;
        }
        // Sync pollCount so UI shows correct number
        STATE.pollCount = (JSON.parse(NativeBridge.getPollHistory() || '[]')).length;
        // b121: Lock in the restored base NOW — before any Kotlin broadcast arrives
        // syncFromNative adds Kotlin's fresh count on top: total = base + kotlin count
        STATE._restoredPollBase = STATE.pollCount;
    }

    // b97: Restore baseline from Supabase — enables polling after background kill
    const savedBaseline = cloudConfig?.morning_baseline;
    if (savedBaseline && savedBaseline._date === API.todayIST() && savedBaseline.baseline) {
        if (!(JSON.parse(NativeBridge.getBaseline() || '{}'))) {
            STATE.baseline = savedBaseline.baseline;
            STATE.live = { ...(JSON.parse(NativeBridge.getBaseline() || '{}')) };
            if (savedBaseline.bnfExpiry) STATE.bnfExpiry = savedBaseline.bnfExpiry;
            if (savedBaseline.nfExpiry) STATE.nfExpiry = savedBaseline.nfExpiry;
            console.log('[b97] Baseline restored from Supabase');
        }
    }

    // Cleanup poll_history keys older than 7 days (fire-and-forget)
    try { if (typeof DB !== 'undefined' && DB.cleanOldPolls) DB.cleanOldPolls(7).catch(() => {}); } catch (e) {}

    initTheme(cloudConfig);
    await loadOpenTrade();
    try {
        if (typeof DB !== 'undefined' && DB.getSignalAccuracyStats) {
            STATE.signalAccuracyStats = await DB.getSignalAccuracyStats();
        } else {
            STATE.signalAccuracyStats = JSON.parse(NativeBridge.getSignalAccuracyStats() || '{}');
        }
    } catch (e) {
        console.warn('[boot] getSignalAccuracyStats skipped:', e.message);
        STATE.signalAccuracyStats = {};
    }

    // If open trades exist, show positions tab
    if ((JSON.parse(NativeBridge.getOpenTrades() || '[]')).length > 0) {
        switchTab('positions');
    }

    renderAll();

    // b97: Auto-restart polling after background kill
    // If baseline restored + market open → start watching without manual Lock & Scan
    if ((JSON.parse(NativeBridge.getBaseline() || '{}')) && API.isMarketHours() && !(JSON.parse(NativeBridge.getServiceStatus() || '{}').running)) {
        console.log(`[b97] Auto-restart: baseline exists, market open, ${(JSON.parse(NativeBridge.getPollHistory() || '[]')).length} polls restored`);
        // Collapse morning section (already locked)
        const morningEl = document.getElementById('morning-inputs');
        if (morningEl) morningEl.style.display = 'none';
        const lockBtn = document.getElementById('btn-lock');
        if (lockBtn) {
            lockBtn.textContent = '🔓 Re-scan';
            lockBtn.disabled = false;
        }
        document.querySelectorAll('.morning-input').forEach(el => el.disabled = true);
        // Start watch loop
        startWatchLoop();
        const watchEl = document.getElementById('watch-status');
        if (watchEl) watchEl.textContent = `🟢 Resumed · Poll #${STATE.pollCount}`;
    }

    // Phase 12: Load Pyodide brain in background (non-blocking — app works without it)
    // Deferred by 2s so initial render + first poll aren't delayed
    setTimeout(() => { initBrain().catch(e => console.warn('[Brain] Deferred init failed:', e)); }, 2000);

    // Tab switching
    document.querySelectorAll('.tab-btn').forEach(btn => {
        btn.addEventListener('click', () => switchTab(btn.dataset.tab));
    });

    // Event listeners
    document.getElementById('btn-lock')?.addEventListener('click', lockMorningData);
    document.getElementById('btn-stop')?.addEventListener('click', stopWatchLoop);
    document.getElementById('btn-rescan')?.addEventListener('click', () => {
        stopWatchLoop();
        expandMorning();
        document.getElementById('btn-lock').disabled = false;
        document.getElementById('btn-lock').textContent = '🔒 Lock & Scan';
        document.querySelectorAll('.morning-input').forEach(el => el.disabled = false);
    });

    // Global Direction inputs — live update on change + auto-save + recompute boost
    document.addEventListener('change', (e) => {
        if (e.target.id === 'in-dow-now') {
            (JSON.parse(NativeBridge.getGlobalDirection() || '{}')).dowNow = e.target.value ? parseFloat(e.target.value) : null;
        } else if (e.target.id === 'in-crude-now') {
            (JSON.parse(NativeBridge.getGlobalDirection() || '{}')).crudeNow = e.target.value ? parseFloat(e.target.value) : null;
        } else if (e.target.id === 'in-gift-now') {
            (JSON.parse(NativeBridge.getGlobalDirection() || '{}')).giftNow = e.target.value ? parseFloat(e.target.value) : null;
        } else { return; }
        // Auto-save to localStorage + Supabase with date stamp
        const saveData = { ...(JSON.parse(NativeBridge.getGlobalDirection() || '{}')), _date: API.todayIST() };
        localStorage.setItem('mr2_global_context', JSON.stringify(saveData));
        DB.setConfig('global_direction', saveData);

        // Recompute globalBoost with new direction data
        computeGlobalBoost(bd.tomorrow_signal, bd.positioning);
        renderAll();
    });

    // Global Direction explicit save button (mobile-friendly — change event may not fire)
    document.addEventListener('click', (e) => {
        if (e.target.id !== 'btn-save-global-dir') return;
        const dowEl = document.getElementById('in-dow-now');
        const crudeEl = document.getElementById('in-crude-now');
        const giftEl = document.getElementById('in-gift-now');
        if (dowEl) (JSON.parse(NativeBridge.getGlobalDirection() || '{}')).dowNow = dowEl.value ? parseFloat(dowEl.value) : null;
        if (crudeEl) (JSON.parse(NativeBridge.getGlobalDirection() || '{}')).crudeNow = crudeEl.value ? parseFloat(crudeEl.value) : null;
        if (giftEl) (JSON.parse(NativeBridge.getGlobalDirection() || '{}')).giftNow = giftEl.value ? parseFloat(giftEl.value) : null;
        const saveData = { ...(JSON.parse(NativeBridge.getGlobalDirection() || '{}')), _date: API.todayIST() };
        localStorage.setItem('mr2_global_context', JSON.stringify(saveData));
        DB.setConfig('global_direction', saveData);
        computeGlobalBoost(bd.tomorrow_signal, bd.positioning);
        // Show saved feedback
        const badge = document.getElementById('global-dir-saved');
        if (badge) { badge.style.display = 'inline'; setTimeout(() => badge.style.display = 'none', 2000); }
        renderAll();
    });

    // Theme toggle — light is default, dark is toggled
    document.getElementById('theme-switch')?.addEventListener('change', (e) => {
        const isDark = e.target.checked;
        document.body.classList.toggle('dark', isDark);
        localStorage.setItem('mr2_theme', isDark ? 'dark' : 'light');
        DB.setConfig('settings', { theme: isDark ? 'dark' : 'light', tradeMode: STATE.tradeMode });
        document.querySelector('.toggle-icon').textContent = isDark ? '🌙' : '☀️';
        document.querySelector('meta[name="theme-color"]').content = isDark ? '#121218' : '#FFFFFF';
    });

    // b99: VISIBILITY CHANGE — instant recovery when app returns from background
    // Android suspends WebView JS in background. When user returns, timers may be stale.
    // This ensures immediate poll + brain run instead of waiting for next 5-min interval.
    document.addEventListener('visibilitychange', async () => {
        if (document.visibilityState !== 'visible') return;
        if (!(JSON.parse(NativeBridge.getBaseline() || '{}')) || !(JSON.parse(NativeBridge.getServiceStatus() || '{}').running)) return;

        // Phase 4: NATIVE MODE — full pull from Kotlin, no lightFetch
        if (STATE._nativeMode && window.NativeBridge) {
            console.log('[Phase 4] App resumed — pulling all data from Kotlin');
            try {
                // Pull polls
                if (window.NativeBridge.getPollHistory) {
                    const rawPolls = window.NativeBridge.getPollHistory();
                    if (rawPolls && rawPolls !== '[]' && rawPolls !== 'null' && rawPolls !== '') {
                        const nativePolls = JSON.parse(rawPolls);
                        if (Array.isArray(nativePolls) && nativePolls.length > (JSON.parse(NativeBridge.getPollHistory() || '[]')).length) {
                            // b121: Only update if Kotlin has MORE polls — its history IS the running total
                            STATE.pollHistory = nativePolls;
                            STATE.pollCount = nativePolls.length;
                        }
                    }
                }
                // Pull brain result (verdict, market, positions, effective bias)
                if (window.NativeBridge.getBrainResult) {
                    const brJson = window.NativeBridge.getBrainResult();
                    if (brJson && brJson !== '{}' && brJson !== 'null' && brJson !== '') {
                        const br = JSON.parse(brJson);
                        STATE.brainInsights = br;
                        STATE.brainLastRun = Date.now();
                        if (br.effective_bias && br.effective_bias.bias) {
                            STATE.effectiveBias = {
                                bias: br.effective_bias.bias, strength: br.effective_bias.strength || '',
                                net: br.effective_bias.net, morning_weight: br.effective_bias.morning_weight,
                                drift_reasons: br.effective_bias.drift_reasons || [],
                                label: `${br.effective_bias.strength ? br.effective_bias.strength + ' ' : ''}${br.effective_bias.bias}`
                            };
                        }
                    }
                }
                // Pull candidates
                if (window.NativeBridge.getCandidates) {
                    const candJson = window.NativeBridge.getCandidates();
                    if (candJson && candJson !== '[]' && candJson !== 'null') {
                        const cands = JSON.parse(candJson);
                        if (Array.isArray(cands) && cands.length > 0) {
                            STATE.candidates = cands;
                            STATE.watchlist = cands.slice(0, 6);
                            const seenIds = new Set((bd.watchlist || []).map(c => c.id));
                            for (const idx of ['BNF', 'NF']) {
                                const seen = new Set();
                                for (const c of cands.filter(c => c.index === idx && !c.capitalBlocked)) {
                                    if (!seen.has(c.type) && !seenIds.has(c.id)) { seen.add(c.type); seenIds.add(c.id); (bd.watchlist || []).push(c); }
                                    if (seen.size >= 5) break;
                                }
                            }
                        }
                    }
                }
                // Re-sync context back to Kotlin
                syncToNative();
                // b118: Re-restore global direction on resume — STATE resets on background kill
                try {
                    const freshConfig = await DB.getConfig('global_direction');
                    if (freshConfig) restoreGlobalContext({ global_direction: freshConfig });
                } catch { /* non-critical */ }
            } catch(e) {
                console.warn('[Phase 4] Kotlin pull failed:', e.message);
            }
            const el = document.getElementById('watch-status');
            if (el) el.textContent = `🟢 Native engine · Poll #${STATE.pollCount}`;
            renderAll();
            return; // No lightFetch in native mode
        }

        // BROWSER MODE — existing recovery logic
        const sinceLastPoll = (JSON.parse(NativeBridge.getServiceStatus() || '{}').lastPoll) ? (Date.now() - (JSON.parse(NativeBridge.getServiceStatus() || '{}').lastPoll)) / 60000 : 999;
        if (sinceLastPoll >= 4) {
            console.log(`[b108] App returned from background. Last poll ${sinceLastPoll.toFixed(1)}min ago. Immediate recovery.`);
            const el = document.getElementById('watch-status');
            if (el) el.textContent = '🔄 Recovering from background...';
            try {
                await lightFetch();
                if (el) el.textContent = `🟢 Resumed · Poll #${STATE.pollCount}`;
            } catch(e) {
                console.warn('[b108] Recovery poll failed:', e.message);
                if (el) el.textContent = '🟢 Watching';
            }
        }
    });
});

function initTheme(cloudConfig) {
    const settings = cloudConfig?.settings || null;
    const savedTheme = settings?.theme || localStorage.getItem('mr2_theme');
    // Restore trade mode from cloud
    if (settings?.tradeMode) STATE.tradeMode = settings.tradeMode;
    if (savedTheme === 'dark') {
        document.body.classList.add('dark');
        const toggle = document.getElementById('theme-switch');
        if (toggle) toggle.checked = true;
        const icon = document.querySelector('.toggle-icon');
        if (icon) icon.textContent = '🌙';
        document.querySelector('meta[name="theme-color"]').content = '#121218';
    }
}
