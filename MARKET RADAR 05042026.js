/* ═══════════════════════════════════════════════════════════════
   Market Radar v2.0 — Premium-First Trading Engine
   
   Philosophy: Premium direction is the ONLY thing that matters.
   Three forces on every trade: Intrinsic (Δspot), Theta (Δtime), IV (Δvol)
   Score by force alignment, not market direction.
   
   Single continuous loop. σ-based adaptive noise filtering.
   ═══════════════════════════════════════════════════════════════ */

// ═══ CONSTANTS ═══
const C = {
    CAPITAL: 110000,
    MAX_RISK_PCT: 10,
    NF_LOT: 65,
    BNF_LOT: 30,
    NF_MARGIN_EST: 97000,
    BNF_MARGIN_EST: 28000,

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
    MIN_PROFIT_COST_PCT: 5,  // block trades where cost > 5% of max profit

    // Strategy categories
    CREDIT_TYPES: ['BEAR_CALL', 'BULL_PUT', 'IRON_CONDOR', 'IRON_BUTTERFLY'],
    DEBIT_TYPES: ['BEAR_PUT', 'BULL_CALL', 'DOUBLE_DEBIT'],
    NEUTRAL_TYPES: ['IRON_CONDOR', 'IRON_BUTTERFLY', 'DOUBLE_DEBIT'],
    DIRECTIONAL_BULL: ['BULL_CALL', 'BULL_PUT'],
    DIRECTIONAL_BEAR: ['BEAR_CALL', 'BEAR_PUT'],

    // Global direction thresholds (CALIBRATION PENDING — refine after 20+ observations)
    DOW_THRESHOLD: 0.5,     // % change to count as signal (derived: Dow -1.5% → NF -500pts, halved)
    CRUDE_THRESHOLD: 1.5    // % change to count as signal (crude avg daily range ~1-2%)
};

// ═══ CALIBRATION DATA — paper trades (25) + backtest (8372 trades, 552 days, Apr 2026) ═══
const CALIBRATION = {
    // Win rates per strategy type — paper trades + [backtest range across 3 dampening presets]
    win_rates: {
        IRON_BUTTERFLY: {
            wins: 6, total: 6, rate: 1.00, avg_pnl: 10787, verdict: '🔥',
            bt_range: '34-48%', bt_note: 'dampening-sensitive, intraday only'
        },
        IRON_CONDOR: {
            wins: 4, total: 4, rate: 1.00, avg_pnl: 3500, verdict: '✅',
            bt_range: '38-49%', bt_note: 'dampening-sensitive, intraday only'
        },
        BEAR_CALL: {
            wins: 7, total: 9, rate: 0.78, avg_pnl: 1683, verdict: '⚠️',
            bt_range: '45-77%', bt_note: 'OTM 0.5-0.8σ sweet spot'
        },
        BULL_PUT: {
            wins: 0, total: 6, rate: 0.00, avg_pnl: -1414, verdict: '❌',
            bt_range: '46-74%', bt_note: '0/6 was ATM narrow, OTM works'
        },
        BEAR_PUT: {
            wins: 0, total: 0, rate: null, avg_pnl: null, verdict: '?',
            bt_range: '54-68%', bt_note: 'ROBUST — swing 54% after DOWN'
        },
        BULL_CALL: {
            wins: 0, total: 0, rate: null, avg_pnl: null, verdict: '?',
            bt_range: '64-72%', bt_note: 'MOST ROBUST — swing 60% after UP'
        }
    },
    // Directional vs non-directional
    directional: { wins: 7, total: 15, rate: 0.47, avg_pnl: 356 },
    non_directional: { wins: 10, total: 10, rate: 1.00, avg_pnl: 7872 },
    // Bias outcomes
    bias_rates: {
        'STRONG BEAR': { wins: 7, total: 7, rate: 1.00 },
        'MILD BULL': { wins: 8, total: 10, rate: 0.80 },
        'MILD BEAR': { wins: 2, total: 4, rate: 0.50 },
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
    """Is sell strike near a wall? Is that wall building or crumbling?"""
    sell = trade.get('sell_strike', 0)
    idx = trade.get('index_key', 'BNF')
    last = polls[-1] if polls else {}
    cw = last.get('cw' if idx == 'BNF' else 'nfCW')
    pw = last.get('pw' if idx == 'BNF' else 'nfPW')
    is_bear = 'BEAR' in trade.get('strategy_type', '')
    # For bear strategies, call wall is our friend (resistance above sell)
    # For bull strategies, put wall is our friend (support below sell)
    if is_bear and cw:
        dist = cw - sell
        if 0 <= dist <= 200:
            return {"icon": "🛡️", "label": "Wall-protected",
                    "detail": f"Call wall {cw} {'AT' if dist == 0 else f'{dist}pts above'} sell {sell}.",
                    "impact": "bullish", "strength": 4 if dist == 0 else 3}
        elif dist < 0:
            return {"icon": "⚠️", "label": "Past the wall",
                    "detail": f"Sell {sell} is ABOVE call wall {cw}. No OI protection.",
                    "impact": "caution", "strength": 4}
    if not is_bear and pw:
        dist = sell - pw
        if 0 <= dist <= 200:
            return {"icon": "🛡️", "label": "Wall-protected",
                    "detail": f"Put wall {pw} {'AT' if dist == 0 else f'{dist}pts below'} sell {sell}.",
                    "impact": "bullish", "strength": 4 if dist == 0 else 3}
        elif dist < 0:
            return {"icon": "⚠️", "label": "Past the wall",
                    "detail": f"Sell {sell} is BELOW put wall {pw}. No OI protection.",
                    "impact": "caution", "strength": 4}
    # Check OI trend at sell strike from strike_oi data
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
    """Is spot accelerating toward the sell strike?"""
    sell = trade.get('sell_strike', 0)
    idx = trade.get('index_key', 'BNF')
    spot_key = 'bnf' if idx == 'BNF' else 'nf'
    is_bear = 'BEAR' in trade.get('strategy_type', '')
    recent = last_n(polls, 4)
    spots = [p.get(spot_key) for p in recent if p.get(spot_key)]
    if len(spots) < 3: return None
    curr = spots[-1]
    cushion = (sell - curr) if is_bear else (curr - sell)  # positive = safe
    if cushion <= 0: return None  # already crossed — handled by CI
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
        trend_bull = regime["direction"] > 0
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
    """Is there a strong OI wall near/at the sell strike?"""
    sell = cand.get('sellStrike', 0)
    idx = cand.get('index', 'BNF')
    is_bear = 'BEAR' in cand.get('type', '')
    last = polls[-1] if polls else {}
    cw = last.get('cw' if idx == 'BNF' else 'nfCW')
    pw = last.get('pw' if idx == 'BNF' else 'nfPW')
    cwOI = last.get('cwOI' if idx == 'BNF' else 'nfCWOI', 0)
    pwOI = last.get('pwOI' if idx == 'BNF' else 'nfPWOI', 0)
    if is_bear and cw:
        dist = cw - sell
        if 0 <= dist <= 300:
            return {"icon": "🛡️", "label": f"Wall at {cw} ({dist}pts above)",
                    "detail": f"Call wall OI protects your sell. Structural safety.",
                    "impact": "bullish", "strength": 3}
    elif not is_bear and pw:
        dist = sell - pw
        if 0 <= dist <= 300:
            return {"icon": "🛡️", "label": f"Wall at {pw} ({dist}pts below)",
                    "detail": f"Put wall OI protects your sell. Structural safety.",
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
    optimal = kelly * 110000
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
    _calibration = cal
    return cal

def candidate_pattern_match(cand, polls, baseline, regime):
    """Score candidate from YOUR trade history in similar conditions."""
    if not _calibration:
        return None
    ctype = cand.get('type', '')
    # Current VIX regime
    vixs = [p.get('vix') for p in polls[-3:] if p.get('vix')]
    vix = vixs[-1] if vixs else 20
    vr = 'VH' if vix >= 24 else 'H' if vix >= 20 else 'N' if vix >= 16 else 'L'
    # Try multi-factor key: strategy + VIX regime
    key = f"{ctype}|{vr}"
    match = _calibration.get('multi', {}).get(key)
    if match and match['total'] >= 3:
        rate = match['rate']
        return {"icon": "📊", "label": f"Your data: {match['wins']}/{match['total']} ({rate*100:.0f}%)",
                "detail": f"{ctype} at {vr} VIX. Avg P&L ₹{match['avg_pnl']:.0f}.",
                "impact": "bullish" if rate >= 0.6 else "caution" if rate < 0.4 else "neutral",
                "strength": 4 if match['total'] >= 5 else 3}
    # Fall back to strategy-only
    strat = _calibration.get('strategy', {}).get(ctype)
    if strat and strat['total'] >= 2:
        rate = strat['rate']
        return {"icon": "📊", "label": f"Your {ctype}: {strat['wins']}/{strat['total']} ({rate*100:.0f}%)",
                "detail": f"Avg P&L ₹{strat['avg_pnl']:.0f}. {'Edge confirmed.' if rate > 0.6 else 'Needs more data.' if rate >= 0.4 else 'Below 40% — paper first.'}",
                "impact": "bullish" if rate >= 0.6 else "caution" if rate < 0.4 else "neutral",
                "strength": 3 if strat['total'] >= 5 else 2}
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
# MAIN ENTRY POINT
# ═══════════════════════════════════════════

def analyze(poll_json, trades_json, baseline_json, open_trades_json, candidates_json, strike_oi_json):
    polls = json.loads(poll_json)
    closed_trades = json.loads(trades_json) if trades_json else []
    baseline = json.loads(baseline_json) if baseline_json else {}
    open_trades = json.loads(open_trades_json) if open_trades_json else []
    candidates = json.loads(candidates_json) if candidates_json else []
    strike_oi = json.loads(strike_oi_json) if strike_oi_json else {}

    result = {"market": [], "positions": {}, "candidates": {}, "timing": [], "risk": []}
    if len(polls) < 3:
        return json.dumps(result)

    # Build learning calibration (cached — only recomputes when trade count changes)
    build_calibration(closed_trades)

    regime = detect_regime(polls, baseline)

    # Market
    for fn in [pcr_velocity, oi_wall_shift, vix_momentum, spot_exhaustion,
               regime_detector, futures_premium_trend, oi_velocity, institutional_clock]:
        try:
            r = fn(polls, baseline)
            if r: result["market"].append(r)
        except: pass

    # Positions
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
        if ins: result["positions"][tid] = ins

    # Candidates — now includes pattern match from YOUR history
    for c in candidates:
        cid = c.get("id", "")
        ins = []
        for fn in [candidate_flow_alignment, candidate_wall_protection, candidate_regime_fit, candidate_pattern_match]:
            try:
                r = fn(c, polls, baseline, regime)
                if r: ins.append(r)
            except: pass
        if ins: result["candidates"][cid] = ins

    # Timing
    for fn in [timing_entry_window, timing_wait_signal]:
        try:
            r = fn(polls, baseline, regime)
            if r: result["timing"].append(r)
        except: pass

    # Risk — now includes exit analysis + factor importance + streak warning
    for fn in [risk_kelly_headroom, risk_regime_shift, risk_exit_analysis, risk_factor_importance, risk_streak_warning]:
        try:
            r = fn(polls, baseline, open_trades, closed_trades)
            if r: result["risk"].append(r)
        except: pass

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
    globalDirection: { dowClose: null, crudeSettle: null, dowNow: null, crudeNow: null },

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
    brainInsights: { market: [], positions: {}, candidates: {}, timing: [], risk: [] },
    brainLastRun: 0,          // timestamp of last brain run
    brainError: null,         // last error (for debug)
    brainLoadStart: 0,        // perf tracking
    _pyodide: null,           // Pyodide runtime reference

    // Active tab
    activeTab: 'market'
};


// ═══════════════════════════════════════════════════════════════
// SOUND ENGINE — Corporate-subtle Web Audio notifications
// ═══════════════════════════════════════════════════════════════

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

function computeBias(morning, chainData) {
    const votes = { bull: 0, bear: 0 };
    const signals = [];

    console.log('[BIAS] morning input:', JSON.stringify(morning));

    if (!morning) {
        console.warn('[BIAS] morning is null/undefined!');
        return { bias: 'NEUTRAL', strength: '', net: 0, votes, signals, label: 'NEUTRAL', upstoxAgrees: null };
    }

    // 1. FII Cash (manual)
    const fiiCashVal = morning.fiiCash;
    if (fiiCashVal != null && fiiCashVal !== '' && !isNaN(fiiCashVal)) {
        const fc = parseFloat(fiiCashVal);
        if (fc > 500) { votes.bull++; signals.push({ name: 'FII Cash', value: `₹${fc}Cr`, dir: 'BULL' }); }
        else if (fc < -500) { votes.bear++; signals.push({ name: 'FII Cash', value: `₹${fc}Cr`, dir: 'BEAR' }); }
        else signals.push({ name: 'FII Cash', value: `₹${fc}Cr`, dir: 'NEUTRAL' });
    }

    // 2. FII Short% (manual) — compare with yesterday from premium_history ONLY
    const fiiShortVal = morning.fiiShortPct;
    if (fiiShortVal != null && fiiShortVal !== '' && !isNaN(fiiShortVal)) {
        const sp = parseFloat(fiiShortVal);
        const ydayHist = STATE.yesterdayHistory || [];
        const prev = ydayHist.length > 0 && ydayHist[0]?.fii_short_pct ? ydayHist[0].fii_short_pct : null;
        if (prev === null) {
            // No yesterday data — can't compare direction, just use level
            if (sp > 85) { votes.bear++; signals.push({ name: 'FII Short%', value: `${sp}% (prev: N/A)`, dir: 'BEAR' }); }
            else if (sp < 70) { votes.bull++; signals.push({ name: 'FII Short%', value: `${sp}%`, dir: 'BULL' }); }
            else signals.push({ name: 'FII Short%', value: `${sp}%`, dir: 'NEUTRAL' });
        } else if (sp > 85 && sp > prev) { votes.bear++; signals.push({ name: 'FII Short%', value: `${sp}%↑ (was ${prev})`, dir: 'BEAR' }); }
        else if (sp > 85 && sp < prev) { signals.push({ name: 'FII Short%', value: `${sp}%↓ covering (was ${prev})`, dir: 'NEUTRAL' }); }
        else if (sp > 85 && sp === prev) { signals.push({ name: 'FII Short%', value: `${sp}% → flat (was ${prev})`, dir: 'NEUTRAL' }); }
        else if (sp < 70) { votes.bull++; signals.push({ name: 'FII Short%', value: `${sp}%`, dir: 'BULL' }); }
        else signals.push({ name: 'FII Short%', value: `${sp}%`, dir: 'NEUTRAL' });
    }

    // 3. Close Character (AUTO-CALCULATED from yesterday OHLC)
    const cc = chainData?.closeChar;
    if (cc != null) {
        if (cc >= 1) { votes.bull++; signals.push({ name: 'Close Char', value: `${cc > 0 ? '+' : ''}${cc} (auto)`, dir: 'BULL' }); }
        else if (cc <= -1) { votes.bear++; signals.push({ name: 'Close Char', value: `${cc} (auto)`, dir: 'BEAR' }); }
        else signals.push({ name: 'Close Char', value: `${cc} (auto)`, dir: 'NEUTRAL' });
    }

    // 4. PCR — use near-ATM PCR, not full chain (far OTM inflates call OI)
    if (chainData?.nearAtmPCR) {
        const pcr = chainData.nearAtmPCR;
        if (pcr > 1.2) { votes.bull++; signals.push({ name: 'PCR', value: `${pcr.toFixed(2)} (near-ATM)`, dir: 'BULL' }); }
        else if (pcr < 0.9) { votes.bear++; signals.push({ name: 'PCR', value: `${pcr.toFixed(2)} (near-ATM)`, dir: 'BEAR' }); }
        else signals.push({ name: 'PCR', value: `${pcr.toFixed(2)} (near-ATM)`, dir: 'NEUTRAL' });
    }

    // 5. VIX Direction (vs yesterday — uses yesterdayHistory which skips today)
    const ydayHistory = STATE.yesterdayHistory || STATE.premiumHistory || [];
    if (ydayHistory.length > 0 && chainData?.vix) {
        const yesterdayVix = ydayHistory[0]?.vix;
        if (yesterdayVix) {
            const diff = chainData.vix - yesterdayVix;
            if (diff > 0.3) { votes.bear++; signals.push({ name: 'VIX Dir', value: `${chainData.vix.toFixed(1)} ↑${diff.toFixed(1)}`, dir: 'BEAR' }); }
            else if (diff < -0.3) { votes.bull++; signals.push({ name: 'VIX Dir', value: `${chainData.vix.toFixed(1)} ↓${Math.abs(diff).toFixed(1)}`, dir: 'BULL' }); }
            else signals.push({ name: 'VIX Dir', value: `${chainData.vix.toFixed(1)} →`, dir: 'NEUTRAL' });
        }
    }

    // 6. Futures Premium (from chain)
    if (chainData?.futuresPremium !== undefined) {
        const fp = chainData.futuresPremium;
        if (fp > 0.05) { votes.bull++; signals.push({ name: 'Futures Prem', value: `${fp.toFixed(3)}%`, dir: 'BULL' }); }
        else if (fp < -0.05) { votes.bear++; signals.push({ name: 'Futures Prem', value: `${fp.toFixed(3)}%`, dir: 'BEAR' }); }
        else signals.push({ name: 'Futures Prem', value: `${fp.toFixed(3)}%`, dir: 'NEUTRAL' });
    }

    // 7. DII Absorption Direction (today vs yesterday — is the floor strengthening or cracking?)
    const diiVal = morning.diiCash != null && morning.diiCash !== '' ? parseFloat(morning.diiCash) : null;
    const fiiVal = morning.fiiCash != null && morning.fiiCash !== '' ? parseFloat(morning.fiiCash) : null;
    if (diiVal !== null && fiiVal !== null && Math.abs(fiiVal) > 100) {
        const todayAbsorption = +(diiVal / Math.abs(fiiVal)).toFixed(2);
        const yday = STATE.yesterdayHistory?.length > 0 ? STATE.yesterdayHistory[0] : null;
        const ydayDii = yday?.dii_cash;
        const ydayFii = yday?.fii_cash;
        const hasYday = ydayDii != null && ydayFii != null && Math.abs(ydayFii) > 100;
        const ydayAbsorption = hasYday ? +(ydayDii / Math.abs(ydayFii)).toFixed(2) : null;
        const change = ydayAbsorption !== null ? +(todayAbsorption - ydayAbsorption).toFixed(2) : null;
        const changeStr = change !== null ? ` (was ${ydayAbsorption}×, Δ${change > 0 ? '+' : ''}${change})` : '';

        if (change !== null) {
            // Direction + level combined
            if (change < -0.2 && todayAbsorption <= 1.0) {
                votes.bear++; signals.push({ name: 'DII Floor', value: `${todayAbsorption}×${changeStr}`, dir: 'BEAR' });
            } else if (change > 0.2 && todayAbsorption >= 0.7) {
                votes.bull++; signals.push({ name: 'DII Floor', value: `${todayAbsorption}×${changeStr}`, dir: 'BULL' });
            } else if (todayAbsorption > 1.2) {
                votes.bull++; signals.push({ name: 'DII Floor', value: `${todayAbsorption}× strong${changeStr}`, dir: 'BULL' });
            } else if (todayAbsorption < 0.3) {
                votes.bear++; signals.push({ name: 'DII Floor', value: `${todayAbsorption}× panic${changeStr}`, dir: 'BEAR' });
            } else {
                signals.push({ name: 'DII Floor', value: `${todayAbsorption}×${changeStr}`, dir: 'NEUTRAL' });
            }
        } else {
            // No yesterday — level only
            if (todayAbsorption > 1.0) {
                votes.bull++; signals.push({ name: 'DII Floor', value: `${todayAbsorption}× (no prev)`, dir: 'BULL' });
            } else if (todayAbsorption < 0.5) {
                votes.bear++; signals.push({ name: 'DII Floor', value: `${todayAbsorption}× (no prev)`, dir: 'BEAR' });
            } else {
                signals.push({ name: 'DII Floor', value: `${todayAbsorption}× (no prev)`, dir: 'NEUTRAL' });
            }
        }
    }

    // 8. Overnight Chain Validation — Phase 10
    // Chain: Evening close → Morning delta → Gap confirms
    // When chain validates, stale signals (Close Char, FII Short%, DII) lose weight
    // This is NOT vote counting — it's sequential confirmation
    const overnight = STATE.overnightDelta;
    const gap = STATE.gapInfo;
    let chainValidation = 'NONE'; // NONE | UNCERTAIN | LIKELY | CONFIRMED

    if (overnight && overnight.signals.length > 0) {
        // Step 1: What direction does overnight say?
        const overnightBulls = overnight.signals.filter(s => s.dir === 'BULL').length;
        const overnightBears = overnight.signals.filter(s => s.dir === 'BEAR').length;
        const overnightDir = overnightBears >= 2 ? 'BEAR' : overnightBulls >= 2 ? 'BULL' : 'MIXED';

        // Step 2: Does the gap confirm overnight direction?
        const gapDir = gap && Math.abs(gap.sigma) > 0.5 ? (gap.sigma < 0 ? 'BEAR' : 'BULL') : 'NEUTRAL';
        const gapConfirms = (overnightDir === gapDir);
        const gapConflicts = (overnightDir === 'BULL' && gapDir === 'BEAR') || (overnightDir === 'BEAR' && gapDir === 'BULL');

        // Step 3: Determine chain strength
        if (overnightDir !== 'MIXED' && gapConfirms) {
            chainValidation = 'CONFIRMED';  // Evening→Morning→Gap all agree
        } else if (overnightDir !== 'MIXED' && gapDir === 'NEUTRAL') {
            chainValidation = 'LIKELY';      // Evening→Morning agree, gap is flat
        } else if (overnightDir !== 'MIXED' && gapConflicts) {
            chainValidation = 'UNCERTAIN';   // Evening→Morning say one thing, gap says opposite
        }

        // Log overnight signals (always show, regardless of chain strength)
        for (const s of overnight.signals) {
            const valStr = s.isSigma ? s.pct.toFixed(2) + 'σ' : (s.pct > 0 ? '+' : '') + s.pct + '%';
            signals.push({ name: `🌙 ${s.name}`, value: `${s.from}→${s.to ?? '?'} (${valStr})`, dir: s.dir });
        }

        // Apply chain validation effect
        if (chainValidation === 'CONFIRMED') {
            // Chain confirmed — overnight direction is today's reality
            // Neutralize stale signals that conflict with confirmed direction
            const confirmedDir = overnightDir; // BULL or BEAR
            let staleNeutralized = 0;
            for (let i = 0; i < signals.length; i++) {
                const s = signals[i];
                const isStale = ['Close Char', 'FII Short%', 'DII Floor'].some(name => s.name.includes(name));
                if (isStale && s.dir !== 'NEUTRAL' && s.dir !== confirmedDir) {
                    // This stale signal conflicts with confirmed overnight chain — remove its vote
                    if (s.dir === 'BULL') votes.bull--;
                    if (s.dir === 'BEAR') votes.bear--;
                    signals[i] = { ...s, value: s.value + ' [stale⚠️]', dir: 'NEUTRAL' };
                    staleNeutralized++;
                }
            }
            // Add chain direction votes (2 votes for confirmed chain)
            if (confirmedDir === 'BEAR') { votes.bear += 2; }
            else if (confirmedDir === 'BULL') { votes.bull += 2; }
            signals.push({ name: '🔗 Chain', value: `CONFIRMED ${confirmedDir} (${staleNeutralized} stale neutralized)`, dir: confirmedDir });

        } else if (chainValidation === 'LIKELY') {
            // Chain likely — add 1 vote for overnight direction
            const likelyDir = overnightDir;
            if (likelyDir === 'BEAR') votes.bear++;
            else if (likelyDir === 'BULL') votes.bull++;
            signals.push({ name: '🔗 Chain', value: `LIKELY ${likelyDir} (gap flat, not confirmed)`, dir: likelyDir });

        } else if (chainValidation === 'UNCERTAIN') {
            // Chain broken — gap contradicts overnight. Don't add any votes.
            signals.push({ name: '🔗 Chain', value: `UNCERTAIN (overnight ${overnightDir} but gap ${gapDir})`, dir: 'NEUTRAL' });
        }
    }

    const net = votes.bull - votes.bear;
    let bias, strength;
    if (net >= 3) { bias = 'BULL'; strength = 'STRONG'; }
    else if (net >= 1) { bias = 'BULL'; strength = 'MILD'; }
    else if (net <= -3) { bias = 'BEAR'; strength = 'STRONG'; }
    else if (net <= -1) { bias = 'BEAR'; strength = 'MILD'; }
    else { bias = 'NEUTRAL'; strength = ''; }

    // Upstox comparison (NOT a vote — just agree/disagree)
    const upstoxBias = morning.upstoxBias;
    let upstoxAgrees = null;
    if (upstoxBias && upstoxBias !== '') {
        const upstoxDir = upstoxBias === 'Bullish' ? 'BULL' : upstoxBias === 'Bearish' ? 'BEAR' : 'NEUTRAL';
        upstoxAgrees = (bias === upstoxDir) || (bias === 'NEUTRAL' && upstoxDir === 'NEUTRAL');
        signals.push({ name: 'Upstox', value: `${upstoxBias} ${upstoxAgrees ? '✅ agrees' : '⚠️ DISAGREES'}`, dir: upstoxDir, isComparison: true });
    }

    return { bias, strength, net, votes, signals, label: `${strength} ${bias}`.trim(), upstoxAgrees };
}


// ═══════════════════════════════════════════════════════════════
// INSTITUTIONAL REGIME CLASSIFIER — Phase 7
// Uses FII Cash, DII Cash, FII Idx Fut, FII Stk Fut to classify
// market regime. This does NOT add bias votes — it adds CONFIDENCE
// to existing forces. Premium is king; this tells us how safely.
// ═══════════════════════════════════════════════════════════════

function computeInstitutionalRegime(morning) {
    const fiiCash = parseFloat(morning.fiiCash) || 0;
    const diiCash = parseFloat(morning.diiCash) || 0;
    const fiiIdxFut = parseFloat(morning.fiiIdxFut) || 0;
    const fiiStkFut = parseFloat(morning.fiiStkFut) || 0;

    // Skip if no institutional data entered
    if (!morning.diiCash && !morning.fiiIdxFut && !morning.fiiStkFut) {
        return null;
    }

    // Derived metrics
    const absFiiCash = Math.abs(fiiCash);
    const absorptionRatio = absFiiCash > 0 ? +(diiCash / absFiiCash).toFixed(2) : null;
    const fiiDerivNet = +(fiiIdxFut + fiiStkFut).toFixed(0); // simplified: idx fut + stk fut
    const isRotation = fiiCash < -500 && fiiStkFut > 200; // selling cash, buying stock futures
    const isPanic = fiiCash < -500 && absorptionRatio !== null && absorptionRatio < 0.5 && fiiStkFut < 0;
    const isAccumulation = fiiCash > 500 && diiCash > 0;
    const isRepositioning = fiiCash < -500 && fiiIdxFut > 0; // selling cash but buying idx futures = setting up bounce

    // Classify regime
    let regime, regimeColor, regimeDetail, creditConfidence;

    if (isPanic) {
        regime = 'PANIC';
        regimeColor = 'var(--danger)';
        regimeDetail = 'No floor — DII not absorbing, FII selling everything. Avoid credit near ATM.';
        creditConfidence = 'LOW';
    } else if (isRepositioning) {
        regime = 'REPOSITIONING';
        regimeColor = 'var(--warn)';
        regimeDetail = 'FII selling cash but buying futures — setting up for bounce. Direction may flip.';
        creditConfidence = 'MEDIUM';
    } else if (isRotation) {
        regime = 'ROTATION';
        regimeColor = 'var(--green)';
        regimeDetail = 'Orderly rotation — selling index, buying stocks. Floor exists. Credit spreads safe.';
        creditConfidence = 'HIGH';
    } else if (isAccumulation) {
        regime = 'ACCUMULATION';
        regimeColor = 'var(--green)';
        regimeDetail = 'FII + DII both buying. Rally likely. Credit bull spreads ride it.';
        creditConfidence = 'HIGH';
    } else if (absorptionRatio !== null && absorptionRatio >= 0.8 && fiiCash < -500) {
        regime = 'DEFENDED';
        regimeColor = '#2196F3';
        regimeDetail = `DII absorbing ${(absorptionRatio * 100).toFixed(0)}% of FII selling. Support holding.`;
        creditConfidence = 'HIGH';
    } else {
        regime = 'NORMAL';
        regimeColor = 'var(--text-muted)';
        regimeDetail = 'No extreme institutional pattern detected.';
        creditConfidence = 'MEDIUM';
    }

    return {
        regime, regimeColor, regimeDetail, creditConfidence,
        fiiCash, diiCash, fiiIdxFut, fiiStkFut,
        absorptionRatio, fiiDerivNet, isRotation
    };
}


// ═══════════════════════════════════════════════════════════════
// FORCE ALIGNMENT ENGINE — The heart of v2
// ═══════════════════════════════════════════════════════════════

function assessForce1_Intrinsic(strategyType, biasResult) {
    const isNeutral = C.NEUTRAL_TYPES.includes(strategyType);
    const isBull = C.DIRECTIONAL_BULL.includes(strategyType);
    const isBear = C.DIRECTIONAL_BEAR.includes(strategyType);

    // Neutral strategies: LOVE neutral bias, HATE strong directional
    if (isNeutral) {
        if (biasResult.bias === 'NEUTRAL') return 1;
        if (biasResult.strength === 'MILD') return 0;
        return -1; // STRONG directional = bad for neutral strategies
    }

    // Directional strategies: same as before
    if (biasResult.bias === 'BULL' && isBull) return 1;
    if (biasResult.bias === 'BEAR' && isBear) return 1;
    if (biasResult.bias === 'NEUTRAL') return 0;
    if (biasResult.bias === 'BULL' && isBear) return -1;
    if (biasResult.bias === 'BEAR' && isBull) return -1;
    return 0;
}

function assessForce2_Theta(strategyType) {
    return C.CREDIT_TYPES.includes(strategyType) ? 1 : -1;
}

function assessForce3_IV(strategyType, vix, ivPercentile) {
    const isCredit = C.CREDIT_TYPES.includes(strategyType);
    const isDebit = C.DEBIT_TYPES.includes(strategyType);

    let regime = 'NORMAL';
    if (vix >= C.IV_HIGH || (ivPercentile !== null && ivPercentile > 65)) regime = 'HIGH';
    if (vix >= C.IV_VERY_HIGH || (ivPercentile !== null && ivPercentile > 85)) regime = 'VERY_HIGH';
    if (vix <= C.IV_LOW || (ivPercentile !== null && ivPercentile < 25)) regime = 'LOW';

    if (regime === 'HIGH' || regime === 'VERY_HIGH') {
        return isCredit ? 1 : -1;
    } else if (regime === 'LOW') {
        return isDebit ? 1 : -1;
    }
    return 0;
}

function getForceAlignment(strategyType, biasResult, vix, ivPercentile) {
    const f1 = assessForce1_Intrinsic(strategyType, biasResult);
    const f2 = assessForce2_Theta(strategyType);
    const f3 = assessForce3_IV(strategyType, vix, ivPercentile);
    const aligned = [f1, f2, f3].filter(f => f === 1).length;
    const against = [f1, f2, f3].filter(f => f === -1).length;
    return { f1, f2, f3, aligned, against, score: f1 + f2 + f3 };
}


// ═══════════════════════════════════════════════════════════════
// DIRECTION INTELLIGENCE — v1 knowledge carried forward
// ═══════════════════════════════════════════════════════════════

// 3. Contrarian PCR Flag — extreme readings = reversal warning
function getContrarianPCR(currentPCR, history) {
    const flags = [];
    if (currentPCR < 0.6) flags.push({ type: 'extreme', text: `⚡ PCR ${currentPCR.toFixed(2)} — extreme low. Institutions buying cheap calls. Contrarian bounce likely 1-3 sessions.`, severity: 'high' });
    else if (currentPCR > 1.5) flags.push({ type: 'extreme', text: `⚡ PCR ${currentPCR.toFixed(2)} — heavy put writing near ATM. Institutions defending support. Bullish positioning.`, severity: 'high' });

    // Multi-session detection from history
    if (history.length >= 2) {
        const recentPCRs = history.slice(0, 2).map(h => h.pcr).filter(Boolean);
        if (recentPCRs.length >= 2) {
            if (recentPCRs.every(p => p < 0.8) && currentPCR < 0.8) {
                flags.push({ type: 'sustained', text: '📉 PCR < 0.8 for 3+ sessions — sustained bearish, watch for snap reversal.', severity: 'medium' });
            }
            if (recentPCRs.every(p => p > 1.3) && currentPCR > 1.3) {
                flags.push({ type: 'sustained', text: '📈 PCR > 1.3 for 3+ sessions — sustained bullish, institutions heavily defending.', severity: 'medium' });
            }
        }
    }
    return flags;
}

// 3b. Dynamic Institutional PCR — context-aware, 3 phases
// Phase A (9:15→2PM): PCR level + VIX + gap → context
// Phase B (2PM→3:15PM): + live OI delta vs 2PM baseline → transitional
// Phase C (3:15PM+): merged into positioning signal
function getInstitutionalPCR(currentPCR, vix, gapInfo, history, afternoonBaseline, liveChain) {
    if (!currentPCR) return null;

    const pcr = currentPCR;
    const isHighPCR = pcr > 1.3;
    const isLowPCR = pcr < 0.7;
    const isExtremePCR = pcr > 1.5 || pcr < 0.6;
    const highVix = vix >= 20;
    const veryHighVix = vix >= 24;
    const bigGapDown = gapInfo && (gapInfo.type === 'GAP_DOWN' || (gapInfo.sigma && gapInfo.sigma <= -1));
    const bigGapUp = gapInfo && (gapInfo.type === 'GAP_UP' || (gapInfo.sigma && gapInfo.sigma >= 1));

    // Yesterday's PCR for direction
    const ydayPCR = history?.length > 0 ? history[0]?.pcr : null;
    const pcrVsYday = ydayPCR ? pcr - ydayPCR : null;
    const pcrRising = pcrVsYday !== null && pcrVsYday > 0.05;
    const pcrFalling = pcrVsYday !== null && pcrVsYday < -0.05;

    // Multi-session trend (preserved from contrarian)
    let sessionTrend = null;
    if (history?.length >= 2) {
        const recentPCRs = history.slice(0, 2).map(h => h.pcr).filter(Boolean);
        if (recentPCRs.length >= 2 && recentPCRs.every(p => p < 0.8) && pcr < 0.8) {
            sessionTrend = { text: 'PCR < 0.8 for 3+ sessions — sustained bearish, watch for snap reversal.', dir: 'BEAR_SUSTAINED' };
        }
        if (recentPCRs.length >= 2 && recentPCRs.every(p => p > 1.3) && pcr > 1.3) {
            sessionTrend = { text: 'PCR > 1.3 for 3+ sessions — institutions heavily defending.', dir: 'BULL_SUSTAINED' };
        }
    }

    // ═══ PHASE A: Level + VIX + Gap context ═══
    let reading = '', bias = 'NEUTRAL', confidence = 'LOW', severity = 'medium';

    if (isHighPCR && veryHighVix && bigGapDown) {
        // Today's exact case: high PCR during crash = fear hedging
        reading = `PCR ${pcr.toFixed(2)} — Fear hedging (VIX ${vix.toFixed(1)}, ${gapInfo.sigma}σ gap-down). Panic puts, not institutional conviction.`;
        bias = 'NEUTRAL'; confidence = 'LOW'; severity = 'medium';
    } else if (isHighPCR && highVix && bigGapDown) {
        reading = `PCR ${pcr.toFixed(2)} — Defensive hedging (VIX ${vix.toFixed(1)}, gap-down). Floor may hold but driven by fear.`;
        bias = 'MILD_BULL'; confidence = 'LOW'; severity = 'medium';
    } else if (isHighPCR && highVix && !bigGapDown) {
        reading = `PCR ${pcr.toFixed(2)} — Institutional floor + elevated IV (VIX ${vix.toFixed(1)}). Support exists, credit sellers favored.`;
        bias = 'BULL'; confidence = 'MEDIUM'; severity = 'high';
    } else if (isHighPCR && !highVix && !bigGapDown) {
        reading = `PCR ${pcr.toFixed(2)} — Institutional floor (VIX ${vix.toFixed(1)}, normal day). Deliberate put writing = support.`;
        bias = 'BULL'; confidence = 'HIGH'; severity = 'high';
    } else if (isHighPCR && pcrRising && !bigGapDown) {
        reading = `PCR ${pcr.toFixed(2)} — Active floor building (rising from ${ydayPCR?.toFixed(2)}). Institutions adding support.`;
        bias = 'BULL'; confidence = 'MEDIUM'; severity = 'high';
    } else if (isHighPCR && pcrFalling) {
        reading = `PCR ${pcr.toFixed(2)} — Floor unwinding (was ${ydayPCR?.toFixed(2)}). Support weakening.`;
        bias = 'BEAR'; confidence = 'MEDIUM'; severity = 'high';
    } else if (isLowPCR && highVix && bigGapUp) {
        reading = `PCR ${pcr.toFixed(2)} — Euphoria calls (VIX ${vix.toFixed(1)}, gap-up). Caution — VIX still elevated.`;
        bias = 'NEUTRAL'; confidence = 'LOW'; severity = 'medium';
    } else if (isLowPCR && !highVix) {
        reading = `PCR ${pcr.toFixed(2)} — Institutions buying calls. Directional bullish bet.`;
        bias = 'BEAR'; confidence = 'HIGH'; severity = 'high';
    } else if (isLowPCR && highVix) {
        reading = `PCR ${pcr.toFixed(2)} — Low PCR despite high VIX. Aggressive call buying or put unwinding.`;
        bias = 'BEAR'; confidence = 'MEDIUM'; severity = 'high';
    } else if (isExtremePCR) {
        reading = `PCR ${pcr.toFixed(2)} — Extreme level. Watch for reversal.`;
        bias = pcr > 1.5 ? 'BULL' : 'BEAR'; confidence = 'MEDIUM'; severity = 'high';
    } else {
        reading = `PCR ${pcr.toFixed(2)} — Normal range. No extreme institutional signal.`;
        bias = 'NEUTRAL'; confidence = 'LOW'; severity = 'low';
    }

    // ═══ PHASE B: After 2PM — add live OI delta vs baseline ═══
    let oiDelta = null;
    if (afternoonBaseline && liveChain) {
        const baseCallOI = afternoonBaseline.bnfTotalCallOi || afternoonBaseline.bnf_total_call_oi || 0;
        const basePutOI = afternoonBaseline.bnfTotalPutOi || afternoonBaseline.bnf_total_put_oi || 0;
        const liveCallOI = liveChain.totalCallOI || 0;
        const livePutOI = liveChain.totalPutOI || 0;

        if (baseCallOI > 0 && basePutOI > 0) {
            const callDelta = liveCallOI - baseCallOI;
            const putDelta = livePutOI - basePutOI;
            const fmtOI = (v) => { const l = Math.abs(v) / 100000; return `${v > 0 ? '+' : '-'}${l.toFixed(1)}L`; };

            oiDelta = { callDelta, putDelta };

            // Enrich the reading with OI direction (DISPLAY ONLY — do NOT override bias)
            // Bias stays from Phase A (level context). OI delta is already signal #1 in computePositioning.
            let oiReading = '';
            if (callDelta > putDelta * 1.5 && callDelta > 50000) {
                oiReading = `Since 2PM: Calls ${fmtOI(callDelta)} vs Puts ${fmtOI(putDelta)} — ceiling building.`;
                if (isHighPCR) reading += ` Ceiling over floor — range/down likely.`;
            } else if (putDelta > callDelta * 1.5 && putDelta > 50000) {
                oiReading = `Since 2PM: Puts ${fmtOI(putDelta)} vs Calls ${fmtOI(callDelta)} — active floor building.`;
                if (isHighPCR) reading += ` Floor strengthening.`;
            } else if (Math.abs(callDelta) < 30000 && Math.abs(putDelta) < 30000) {
                oiReading = `Since 2PM: Minimal OI change — no new conviction.`;
            } else {
                oiReading = `Since 2PM: Calls ${fmtOI(callDelta)}, Puts ${fmtOI(putDelta)} — balanced activity.`;
            }

            if (oiReading) reading += ' ' + oiReading;
        }
    }

    return {
        pcr, reading, bias, confidence, severity,
        sessionTrend, oiDelta,
        phase: afternoonBaseline ? 'B' : 'A',
        vix, gapSigma: gapInfo?.sigma || 0
    };
}

// 4. FII Short% 3-Session Trend Tracker
function getFiiShortTrend(currentShort, history) {
    const vals = [];
    if (currentShort) vals.push(parseFloat(currentShort));
    for (const h of history.slice(0, 2)) {
        if (h.fii_short_pct) vals.push(h.fii_short_pct);
    }
    if (vals.length < 2) return null;

    const changes = [];
    for (let i = 0; i < vals.length - 1; i++) changes.push(vals[i] - vals[i + 1]);

    let trend = 'FLAT';
    let label = '';
    const allDown = changes.every(c => c < 0);
    const allUp = changes.every(c => c > 0);

    if (allDown) { trend = 'COVERING'; label = `↓↓ Covering (${vals.map(v => v.toFixed(1)).join('→')}) — bullish`; }
    else if (allUp) { trend = 'BUILDING'; label = `↑↑ Building (${vals.map(v => v.toFixed(1)).join('→')}) — bearish`; }
    else if (changes.length >= 2 && Math.sign(changes[0]) !== Math.sign(changes[1])) {
        trend = 'INFLECTION'; label = `⟳ Inflection (${vals.map(v => v.toFixed(1)).join('→')}) — direction changed`;
    } else {
        label = vals.map(v => v.toFixed(1)).join('→');
    }

    // Acceleration
    let accel = false;
    if (changes.length >= 2 && Math.abs(changes[0]) > Math.abs(changes[1]) * 1.3) accel = true;

    // Aggressive move
    const aggressive = changes.length > 0 && Math.abs(changes[0]) >= 3;

    return { trend, label, accel, aggressive, values: vals, changes };
}

// 7. Adversarial Control Index — who controls your open position?
function computeControlIndex(trade, chain, spot, bnfBreadth) {
    if (!trade || !chain) return null;

    const isBear = trade.strategy_type?.includes('BEAR');
    const isBull = trade.strategy_type?.includes('BULL');
    const isIC = trade.strategy_type === 'IRON_CONDOR' || trade.strategy_type === 'IRON_BUTTERFLY';
    let score = 0;

    // Signal 1: Max Pain Migration (35%)
    const entryMaxPain = trade.entry_max_pain || chain.maxPain;
    const currentMaxPain = chain.maxPain;
    if (entryMaxPain && currentMaxPain) {
        const mpMove = currentMaxPain - entryMaxPain;
        let mpScore = 0;
        if (isBear && mpMove < 0) mpScore = 1;      // MP moving down, good for bears
        else if (isBear && mpMove > 0) mpScore = -1;
        else if (isBull && mpMove > 0) mpScore = 1;
        else if (isBull && mpMove < 0) mpScore = -1;
        else if (isIC) mpScore = Math.abs(mpMove) < 200 ? 1 : -1; // IC wants MP stable
        score += mpScore * 35;
    }

    // Signal 2: Sell Strike OI change (30%)
    const sellStrikeData = chain.strikes[trade.sell_strike]?.[trade.sell_type];
    if (sellStrikeData && trade.entry_sell_oi) {
        const oiChange = sellStrikeData.oi - trade.entry_sell_oi;
        score += (oiChange > 0 ? 1 : oiChange < 0 ? -1 : 0) * 30;
    }

    // Signal 3: PCR Shift (25%)
    if (trade.entry_pcr && chain.pcr) {
        const pcrChange = chain.pcr - trade.entry_pcr;
        let pcrScore = 0;
        if (isBear && pcrChange < -0.05) pcrScore = 1;   // PCR dropping = more bearish
        else if (isBear && pcrChange > 0.05) pcrScore = -1;
        else if (isBull && pcrChange > 0.05) pcrScore = 1;
        else if (isBull && pcrChange < -0.05) pcrScore = -1;
        score += pcrScore * 25;
    }

    // Signal 4: Heavyweight Divergence — BNF only (10%)
    if (bnfBreadth && trade.index_key === 'BNF') {
        const wp = bnfBreadth.weightedPct || 0;
        let hwScore = 0;
        if (isBear && wp < -0.5) hwScore = 1;   // heavyweights falling = good for bears
        else if (isBear && wp > 0.5) hwScore = -1;
        else if (isBull && wp > 0.5) hwScore = 1;
        else if (isBull && wp < -0.5) hwScore = -1;
        score += hwScore * 10;
    }

    // ═══ b69 Signal 5: STRIKE PROXIMITY OVERRIDE ═══
    // When spot crosses sell strike, you're ITM — CI must reflect this danger.
    // Apr 2 lesson: CI showed "You in control: 40" while spot was 55 pts ABOVE sell strike.
    // Premium can still look OK (time value), but position is structurally threatened.
    if (spot && trade.sell_strike) {
        const sellStrike = trade.sell_strike;
        let strikeBreach = false;
        if (isBear && spot > sellStrike) strikeBreach = true;  // Bear Call: spot above sell = danger
        if (isBull && spot < sellStrike) strikeBreach = true;  // Bull Put: spot below sell = danger
        if (isIC) {
            // IC: check both sides
            const sellStrike2 = trade.sell_strike2 || sellStrike; // put side for IC
            if (spot > sellStrike || spot < sellStrike2) strikeBreach = true;
        }
        if (strikeBreach) {
            // Force CI strongly negative — override all other signals
            score = Math.min(score, -50);
        }
    }

    return Math.round(Math.max(-100, Math.min(100, score)));
}

// 8. Session Trajectory — last 5 sessions with arrows
function getSessionTrajectory(history) {
    if (!history || history.length < 2) return null;
    const sessions = history.slice(0, 5).reverse(); // oldest first
    const fields = ['vix', 'pcr', 'fii_cash', 'fii_short_pct', 'bnf_spot', 'nf_spot'];
    const labels = ['VIX', 'PCR', 'FII Cash', 'FII Short%', 'BNF', 'NF'];
    const trajectory = [];

    for (let f = 0; f < fields.length; f++) {
        const row = { label: labels[f], arrows: [] };
        for (let i = 1; i < sessions.length; i++) {
            const prev = sessions[i - 1][fields[f]];
            const curr = sessions[i][fields[f]];
            if (prev == null || curr == null) { row.arrows.push('—'); continue; }
            const diff = curr - prev;
            const threshold = fields[f] === 'vix' ? 0.3 : fields[f] === 'pcr' ? 0.03 : fields[f] === 'fii_short_pct' ? 0.5 : fields[f] === 'bnf_spot' || fields[f] === 'nf_spot' ? 50 : 100;
            row.arrows.push(diff > threshold ? '↑' : diff < -threshold ? '↓' : '→');
        }
        trajectory.push(row);
    }

    // Detect multi-signal reversal (3+ arrows changed direction from prev session)
    let reversalCount = 0;
    if (sessions.length >= 3) {
        for (const row of trajectory) {
            const last = row.arrows[row.arrows.length - 1];
            const prev = row.arrows.length >= 2 ? row.arrows[row.arrows.length - 2] : null;
            if (prev && last !== prev && last !== '→' && prev !== '→') reversalCount++;
        }
    }

    // Detect alignment (4+ moving same direction)
    const lastArrows = trajectory.map(r => r.arrows[r.arrows.length - 1]).filter(a => a !== '—');
    const upCount = lastArrows.filter(a => a === '↑').length;
    const downCount = lastArrows.filter(a => a === '↓').length;

    return {
        trajectory, dates: sessions.map(s => s.date),
        reversal: reversalCount >= 3 ? 'Possible institutional shift — 3+ signals reversed' : null,
        alignment: upCount >= 4 ? 'Institutional accumulation pressure — 4+ signals rising' :
            downCount >= 4 ? 'Institutional selling pressure — 4+ signals falling' : null
    };
}


// ═══════════════════════════════════════════════════════════════
// AFTERNOON POSITIONING SYSTEM — Detect institutional last-hour moves
// ═══════════════════════════════════════════════════════════════

// Build snapshot data from current state (used for morning, 2pm, 3:15pm)
function buildChainSnapshotData() {
    return {
        date: API.todayIST(),
        bnfSpot: STATE.live?.bnfSpot || STATE.baseline?.bnfSpot,
        nfSpot: STATE.live?.nfSpot || STATE.baseline?.nfSpot,
        vix: STATE.live?.vix || STATE.baseline?.vix,
        bnfPcr: STATE.bnfChain?.pcr,
        bnfNearAtmPcr: STATE.bnfChain?.nearAtmPCR,
        nfPcr: STATE.nfChain?.pcr,
        bnfMaxPain: STATE.bnfChain?.maxPain,
        nfMaxPain: STATE.nfChain?.maxPain,
        bnfCallWall: STATE.bnfChain?.callWallStrike,
        bnfCallWallOi: STATE.bnfChain?.callWallOI,
        bnfPutWall: STATE.bnfChain?.putWallStrike,
        bnfPutWallOi: STATE.bnfChain?.putWallOI,
        bnfTotalCallOi: STATE.bnfChain?.totalCallOI,
        bnfTotalPutOi: STATE.bnfChain?.totalPutOI,
        nfTotalCallOi: STATE.nfChain?.totalCallOI,
        nfTotalPutOi: STATE.nfChain?.totalPutOI,
        bnfAtmIv: STATE.bnfChain?.atmIv,
        bnfFuturesPrem: STATE.bnfChain?.futuresPremium,
        bnfBreadthPct: STATE.bnfBreadth?.weightedPct,
        nf50Advancing: STATE.nf50Breadth?.scaled
    };
}

// Heavy afternoon fetch — full chains + breadth (same as morning)
async function heavyAfternoonFetch() {
    const spots = await API.fetchSpots();
    if (!spots.bnfSpot || !spots.vix) throw new Error('Spots missing — check Upstox token');
    const bnfRaw = await API.fetchChain(API.BNF_KEY, STATE.bnfExpiry);
    STATE.bnfChain = API.parseChain(bnfRaw, spots.bnfSpot);
    const nfRaw = await API.fetchChain(API.NF_KEY, STATE.nfExpiry);
    STATE.nfChain = API.parseChain(nfRaw, spots.nfSpot);
    STATE.bnfBreadth = await API.fetchBnfBreadth();
    STATE.nf50Breadth = await API.fetchNf50Breadth();

    // Update live state
    STATE.live = {
        ...STATE.live,
        nfSpot: spots.nfSpot, bnfSpot: spots.bnfSpot, vix: spots.vix,
        pcr: STATE.bnfChain.pcr, nearAtmPCR: STATE.bnfChain.nearAtmPCR,
        maxPainBnf: STATE.bnfChain.maxPain, futuresPremBnf: STATE.bnfChain.futuresPremium,
        bnfAtmIv: STATE.bnfChain.atmIv,
        nfAtmIv: STATE.nfChain.atmIv, nfPcr: STATE.nfChain.pcr,
        futuresPremNf: STATE.nfChain.futuresPremium
    };
    return spots;
}

// Compare 2PM vs 3:15PM snapshots → detect positioning
function computePositioning(snap2pm, snap315pm) {
    if (!snap2pm || !snap315pm) return null;

    const delta = {
        callOiDelta: (snap315pm.bnf_total_call_oi || 0) - (snap2pm.bnf_total_call_oi || 0),
        putOiDelta: (snap315pm.bnf_total_put_oi || 0) - (snap2pm.bnf_total_put_oi || 0),
        nfCallOiDelta: (snap315pm.nf_total_call_oi || 0) - (snap2pm.nf_total_call_oi || 0),
        nfPutOiDelta: (snap315pm.nf_total_put_oi || 0) - (snap2pm.nf_total_put_oi || 0),
        pcrChange: (snap315pm.bnf_pcr || 0) - (snap2pm.bnf_pcr || 0),
        nearPcrChange: (snap315pm.bnf_near_atm_pcr || 0) - (snap2pm.bnf_near_atm_pcr || 0),
        vixChange: (snap315pm.vix || 0) - (snap2pm.vix || 0),
        maxPainShift: (snap315pm.bnf_max_pain || 0) - (snap2pm.bnf_max_pain || 0),
        breadthChange: (snap315pm.bnf_breadth_pct || 0) - (snap2pm.bnf_breadth_pct || 0),
        spotChange: (snap315pm.bnf_spot || 0) - (snap2pm.bnf_spot || 0),
        // Raw values for display
        snap2pm, snap315pm
    };

    // Score each signal for tomorrow direction
    let bearScore = 0, bullScore = 0;

    // 1. OI imbalance — which side is building faster?
    const netOiDelta = delta.putOiDelta - delta.callOiDelta;
    if (delta.callOiDelta > delta.putOiDelta * 1.5) { bearScore += 2; } // heavy call writing = bearish
    else if (delta.putOiDelta > delta.callOiDelta * 1.5) { bullScore += 2; } // heavy put writing = bullish (defense)

    // 2. PCR direction in last hour
    if (delta.pcrChange < -0.05) bearScore += 1.5;   // PCR dropping = more calls = bearish
    else if (delta.pcrChange > 0.05) bullScore += 1.5;

    // 3. VIX direction — rising into close = protection buying
    if (delta.vixChange > 0.3) bearScore += 1.5;
    else if (delta.vixChange < -0.3) bullScore += 1.5;

    // 4. Max Pain shift
    if (delta.maxPainShift < -100) bearScore += 1;
    else if (delta.maxPainShift > 100) bullScore += 1;

    // 5. BNF Breadth direction
    if (delta.breadthChange < -0.5) bearScore += 1;
    else if (delta.breadthChange > 0.5) bullScore += 1;

    // 6. PCR context — dynamic institutional read (Phase 8.1)
    // Uses the pcrContext that's been building all afternoon
    if (STATE.pcrContext && STATE.pcrContext.confidence !== 'LOW') {
        if (STATE.pcrContext.bias === 'BULL') bullScore += 1;
        else if (STATE.pcrContext.bias === 'BEAR') bearScore += 1;
        else if (STATE.pcrContext.bias === 'MILD_BULL') bullScore += 0.5;
    }

    // Generate signal
    const netScore = bullScore - bearScore;
    let signal = 'NEUTRAL';
    let strength = 0;
    if (netScore >= 3) { signal = 'BULLISH'; strength = Math.min(5, Math.round(netScore)); }
    else if (netScore >= 1) { signal = 'BULLISH'; strength = Math.min(3, Math.round(netScore)); }
    else if (netScore <= -3) { signal = 'BEARISH'; strength = Math.min(5, Math.round(Math.abs(netScore))); }
    else if (netScore <= -1) { signal = 'BEARISH'; strength = Math.min(3, Math.round(Math.abs(netScore))); }
    else { signal = 'NEUTRAL'; strength = 1; }

    return { delta, signal, strength, bullScore, bearScore, netScore };
}

// ═══ GLOBAL DIRECTION BOOST — Dow, Crude, GIFT direction agreement ═══
function computeGlobalBoost(tomorrowSignal, positioningResult) {
    if (!tomorrowSignal || tomorrowSignal.signal === 'NEUTRAL' || !positioningResult) return;

    // Reset to base strength
    tomorrowSignal.strength = positioningResult.strength;
    tomorrowSignal.globalBoost = 0;

    const gd = STATE.globalDirection;
    const isBull = tomorrowSignal.signal === 'BULLISH';
    let boost = 0;

    // Signal 1: Dow direction (prev close → now)
    if (gd.dowClose && gd.dowNow) {
        const dowPct = ((gd.dowNow - gd.dowClose) / gd.dowClose) * 100;
        if (Math.abs(dowPct) >= C.DOW_THRESHOLD) {
            if ((dowPct > 0 && isBull) || (dowPct < 0 && !isBull)) boost++;
            else boost--;
        }
    }

    // Signal 2: Crude direction (settlement → now) — INVERTED for India (rising crude = bearish)
    if (gd.crudeSettle && gd.crudeNow) {
        const crudePct = ((gd.crudeNow - gd.crudeSettle) / gd.crudeSettle) * 100;
        if (Math.abs(crudePct) >= C.CRUDE_THRESHOLD) {
            if ((crudePct < 0 && isBull) || (crudePct > 0 && !isBull)) boost++;
            else boost--;
        }
    }

    // Signal 3: GIFT direction (auto from gap — already computed)
    if (STATE.gapInfo && STATE.gapInfo.sigma) {
        const giftBull = STATE.gapInfo.sigma > 0.3;
        const giftBear = STATE.gapInfo.sigma < -0.3;
        if ((giftBull && isBull) || (giftBear && !isBull)) boost++;
        else if ((giftBull && !isBull) || (giftBear && isBull)) boost--;
    }

    if (boost !== 0) {
        tomorrowSignal.strength = Math.max(1, Math.min(5, positioningResult.strength + boost));
        tomorrowSignal.globalBoost = boost;
    }
}

// Validate yesterday's signal against today's gap
async function validateYesterdaySignal(todayGap) {
    if (!todayGap || todayGap.type === 'UNKNOWN') return null;
    try {
        // Get yesterday's date
        const ydayDate = STATE.yesterdayHistory?.[0]?.date;
        if (!ydayDate) return null;
        const ydaySignal = await DB.getChainSnapshot(ydayDate, '315pm');
        if (!ydaySignal || !ydaySignal.tomorrow_signal) return null;

        const predicted = ydaySignal.tomorrow_signal;
        const actualDir = todayGap.gap > 50 ? 'BULLISH' : todayGap.gap < -50 ? 'BEARISH' : 'NEUTRAL';
        const correct = (predicted === actualDir) || (predicted === 'NEUTRAL' && Math.abs(todayGap.gap) < 100);

        // Get historical accuracy
        const signals = await DB.getRecentSignals(20);
        // We need morning snapshots to get gaps... for now just track this one
        return {
            date: ydayDate,
            predicted,
            strength: ydaySignal.signal_strength,
            actualGap: todayGap.gap,
            actualDir,
            correct,
            totalSignals: signals.length
        };
    } catch (e) { return null; }
}

// Render positioning section on DATA tab
function renderPositioning() {
    if (!STATE.positioningResult && !STATE._captured2pm) return '';

    let html = '<div class="env-section-title">🔍 Afternoon Positioning</div>';

    // 2PM baseline status
    if (STATE._captured2pm && !STATE._captured315pm) {
        html += `<div class="env-row"><span class="env-row-label">2:00 PM Baseline</span><span class="env-row-value" style="color:var(--green)">✅ Captured</span></div>`;
        html += `<div class="env-row"><span class="env-row-label">3:15 PM Scan</span><span class="env-row-value" style="color:var(--text-muted)">⏳ Pending...</span></div>`;
    }

    // Full comparison after 3:15PM
    if (STATE.positioningResult) {
        const r = STATE.positioningResult;
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
            ${STATE.tomorrowSignal?.globalBoost ? `<div class="signal-detail" style="color:var(--accent)">🌍 Global direction: ${STATE.tomorrowSignal.globalBoost > 0 ? '+' : ''}${STATE.tomorrowSignal.globalBoost} strength</div>` : ''}
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

function getVarsityFilter(biasResult, vix) {
    const bias = biasResult?.bias || 'NEUTRAL';
    const strength = biasResult?.strength || '';
    const isStrong = strength === 'STRONG';
    const ivHigh = vix >= C.IV_HIGH; // VIX ≥ 20

    let primary = [], allowed = [], blocked = [];

    // ═══ BASE VARSITY FILTER (from Zerodha Varsity Modules 5, 6) ═══
    if (bias === 'BEAR' && ivHigh) {
        primary = ['BEAR_CALL'];
        allowed = isStrong ? [] : ['BULL_PUT', 'IRON_CONDOR'];
        blocked.push('BEAR_PUT', 'BULL_CALL', 'DOUBLE_DEBIT');
    } else if (bias === 'BULL' && ivHigh) {
        primary = ['BULL_PUT'];
        allowed = isStrong ? [] : ['BEAR_CALL', 'IRON_CONDOR'];
        blocked.push('BULL_CALL', 'BEAR_PUT', 'DOUBLE_DEBIT');
    } else if (bias === 'NEUTRAL' && ivHigh) {
        primary = ['IRON_CONDOR'];
        allowed = ['BEAR_CALL', 'BULL_PUT'];
        blocked.push('BEAR_PUT', 'BULL_CALL', 'DOUBLE_DEBIT');
    } else if (bias === 'BEAR' && !ivHigh) {
        primary = ['BEAR_PUT'];
        allowed = isStrong ? [] : ['BEAR_CALL'];
        blocked.push('BULL_PUT', 'BULL_CALL', 'IRON_CONDOR', 'DOUBLE_DEBIT');
    } else if (bias === 'BULL' && !ivHigh) {
        primary = ['BULL_CALL'];
        allowed = isStrong ? [] : ['BULL_PUT'];
        blocked.push('BEAR_CALL', 'BEAR_PUT', 'IRON_CONDOR', 'DOUBLE_DEBIT');
    } else { // NEUTRAL + low IV
        primary = ['DOUBLE_DEBIT'];
        allowed = ['IRON_CONDOR'];
        blocked.push('BEAR_PUT', 'BULL_CALL', 'BEAR_CALL', 'BULL_PUT');
    }

    // ═══ b68 OVERRIDE 1: BULL PUT — KILL SWITCH REMOVED (b70) ═══
    // b68: 0/6 paper losses → Bull Put killed. 
    // b70 BACKTEST (8372 trades): Bull Put 54.7-65.5% across all dampening presets.
    // Root cause of 0/6 was ATM narrow strikes — now prevented by:
    //   MIN_SIGMA_OTM (0.5σ) + MIN_WIDTH (NF:150, BNF:400)
    // Bull Put stays in its natural Varsity position (PRIMARY for BULL+HIGH IV).
    // No override needed — the filters do the job.

    // ═══ b70 OVERRIDE: VERY_HIGH VIX → DEBIT CO-PRIMARY ═══
    // Backtest Table 3 (8372 trades): VIX ≥24 → debit 91.7% vs credit 86.4%.
    // Premiums so inflated that explosive moves create huge debit profits.
    // Varsity M5 Ch19: "Buy options when you expect volatility to decrease" — at VERY_HIGH,
    // VIX will likely DECREASE (mean-revert), making bought options profitable.
    const isVeryHighVix = vix >= C.IV_VERY_HIGH; // VIX ≥ 24
    if (isVeryHighVix) {
        // Add directional debit as co-PRIMARY alongside credit
        if (bias === 'BEAR') {
            if (!primary.includes('BEAR_PUT')) primary.push('BEAR_PUT');
            blocked = blocked.filter(s => s !== 'BEAR_PUT');
        } else if (bias === 'BULL') {
            if (!primary.includes('BULL_CALL')) primary.push('BULL_CALL');
            blocked = blocked.filter(s => s !== 'BULL_CALL');
        } else {
            // NEUTRAL + VERY_HIGH: both debit directions as ALLOWED
            if (!allowed.includes('BEAR_PUT')) allowed.push('BEAR_PUT');
            if (!allowed.includes('BULL_CALL')) allowed.push('BULL_CALL');
            blocked = blocked.filter(s => s !== 'BEAR_PUT' && s !== 'BULL_CALL');
        }
    }

    // ═══ b68 OVERRIDE 2: RANGE DETECTION → IB/IC DEFAULT ═══
    // Data: Non-directional 10/10 (100%) vs Directional 7/15 (47%).
    // "The gap IS the move" — after gap absorbed, sell volatility not direction.
    // Range = last 3 polls within ±0.3σ AND minutes since open > 75 (after 10:30 AM)
    const rangeDetected = detectRange();
    const minutesSinceOpen = API.minutesSinceOpen?.() ?? 0;
    const afterSweetSpot = minutesSinceOpen > 75; // past 10:30 AM

    if (rangeDetected && afterSweetSpot && ivHigh) {
        // Range-bound + high VIX = vol crush territory → IB/IC dominate
        primary = ['IRON_BUTTERFLY', 'IRON_CONDOR'];
        if (bias === 'BEAR') allowed = ['BEAR_CALL'];
        else if (bias === 'BULL') allowed = ['BULL_PUT'];
        else allowed = [];
        blocked = blocked.filter(s => s !== 'IRON_BUTTERFLY' && s !== 'IRON_CONDOR');
    }

    // IB blocked by default for real trades (margin concern at ₹1.1L)
    // Only add to blocked if not already in primary/allowed from range override
    if (!primary.includes('IRON_BUTTERFLY') && !allowed.includes('IRON_BUTTERFLY')) {
        blocked.push('IRON_BUTTERFLY');
    }

    // Paper mode: unlock ALL strategies when no real trades are open
    const hasRealTrades = STATE.openTrades.some(t => !t.paper);
    if (!hasRealTrades) {
        const allTypes = ['BEAR_CALL', 'BULL_PUT', 'BEAR_PUT', 'BULL_CALL', 'IRON_CONDOR', 'IRON_BUTTERFLY', 'DOUBLE_DEBIT'];
        allowed = allTypes.filter(t => !primary.includes(t));
        blocked = [];
    }

    blocked = [...new Set(blocked)];
    return { primary, allowed, blocked, rangeDetected };
}

// ═══ RANGE DETECTION — "Is the gap move done?" (b68) ═══
// If last 3 polls (15 min) show spot within ±0.3σ, market is range-bound.
// This is the signal to switch from directional to non-directional strategies.
function detectRange() {
    const polls = STATE.pollHistory;
    if (!polls || polls.length < 3) return false;

    const last3 = polls.slice(-3);
    const spots = last3.map(p => p.nf).filter(v => v > 0);
    if (spots.length < 3) return false;

    const range = Math.max(...spots) - Math.min(...spots);
    const spot = spots[spots.length - 1];
    const vix = STATE.live?.vix || 20;
    const dailySigma = spot * (vix / 100) * Math.sqrt(1 / 252);

    if (dailySigma <= 0) return false;
    const rangeSigma = range / dailySigma;

    STATE.rangeDetected = rangeSigma < 0.3;
    STATE.rangeSigma = +rangeSigma.toFixed(3);
    return STATE.rangeDetected;
}

// ═══════════════════════════════════════════════════════════════
// WALL PROXIMITY + GAMMA RISK — Premium safety scores
// Wall = institutional bodyguards on your sell strike
// Gamma = how fast your premium can turn against you
// ═══════════════════════════════════════════════════════════════

function computeWallScore(cand, chain, isBNF) {
    const step = isBNF ? 200 : 100; // strike step size
    const callWall = chain.callWallStrike;
    const putWall = chain.putWallStrike;
    if (!callWall || !putWall) return { wallScore: 0, wallTag: '' };

    const isCredit = cand.isCredit;
    const type = cand.type;
    let score = 0, tag = '';

    if (type === 'BEAR_CALL' || type === 'IRON_CONDOR') {
        // Credit call side: sell strike near call wall = institutions defending above
        const distToCallWall = Math.abs(cand.sellStrike - callWall);
        if (distToCallWall === 0) { score = 1.0; tag = '🛡️ Wall'; }
        else if (distToCallWall <= step) { score = 0.7; tag = '🛡️'; }
        else if (distToCallWall <= step * 2) { score = 0.4; }
    }

    if (type === 'BULL_PUT' || type === 'IRON_CONDOR') {
        // Credit put side: sell strike near put wall = institutions defending below
        const sellPut = cand.sellStrike2 || cand.sellStrike; // IC has sellStrike2 for put side
        const distToPutWall = Math.abs(sellPut - putWall);
        const putScore = distToPutWall === 0 ? 1.0 : distToPutWall <= step ? 0.7 : distToPutWall <= step * 2 ? 0.4 : 0;

        if (type === 'IRON_CONDOR') {
            score = (score + putScore) / 2; // average both sides
            if (score >= 0.5) tag = '🛡️🛡️'; // both sides backed
            else if (score >= 0.3) tag = '🛡️';
        } else {
            score = putScore;
            if (score >= 0.7) tag = '🛡️ Wall';
            else if (score >= 0.4) tag = '🛡️';
        }
    }

    if (type === 'IRON_BUTTERFLY') {
        // ATM sell — check distance from both walls
        const distCall = Math.abs(cand.sellStrike - callWall);
        const distPut = Math.abs(cand.sellStrike - putWall);
        // IB is best when ATM is between walls (pinning zone)
        if (distCall > step * 3 && distPut > step * 3) { score = 0.6; tag = '📌 Pinned'; }
    }

    // DEBIT spreads: wall BLOCKS your target — penalty
    if (type === 'BULL_CALL') {
        const distToCallWall = Math.abs(cand.buyStrike - callWall);
        if (distToCallWall <= step) { score = -0.5; tag = '⚠️ Wall blocks'; }
    }
    if (type === 'BEAR_PUT') {
        const distToPutWall = Math.abs(cand.buyStrike - putWall);
        if (distToPutWall <= step) { score = -0.5; tag = '⚠️ Wall blocks'; }
    }

    return { wallScore: +score.toFixed(2), wallTag: tag };
}

function computeGammaRisk(cand, spot, tDTE) {
    // Gamma risk = how fast delta changes. Dangerous when:
    // 1. Sell strike is near ATM (high gamma zone)
    // 2. DTE is low (gamma increases as expiry approaches)
    // Credit sellers lose when gamma spikes against them

    if (!cand.isCredit) return { gammaRisk: 0, gammaTag: '' }; // debit buyers want gamma

    const distFromATM = Math.abs(cand.sellStrike - spot);
    const step = spot > 30000 ? 200 : 100; // BNF vs NF step
    const stepsAway = distFromATM / step;

    // Gamma risk score: 0 (safe) to 1 (dangerous)
    let risk = 0;

    // Near ATM = high gamma
    if (stepsAway <= 2) risk += 0.5;
    else if (stepsAway <= 4) risk += 0.3;
    else if (stepsAway <= 6) risk += 0.1;

    // Low DTE amplifies gamma
    if (tDTE <= 2) risk += 0.5;
    else if (tDTE <= 3) risk += 0.3;
    else if (tDTE <= 5) risk += 0.1;

    risk = Math.min(1.0, risk);

    let tag = '';
    if (risk >= 0.7) tag = '⚠️ High γ';
    else if (risk >= 0.4) tag = '⚠️ γ';

    return { gammaRisk: +risk.toFixed(2), gammaTag: tag };
}

// ═══ CONTEXT SCORE — Varsity rules as invisible ranking penalties ═══
// Negative = penalty (candidate drops). Positive = bonus (candidate rises). Zero = neutral.
// All dynamic from live data. tradeMode switches behavior.
function computeContextScore(cand, spot, tDTE, vix) {
    let penalty = 0;
    const isCredit = cand.isCredit;
    const isBear = C.DIRECTIONAL_BEAR.includes(cand.type);
    const isBull = C.DIRECTIONAL_BULL.includes(cand.type);
    const mode = STATE.tradeMode; // 'intraday' or 'swing'
    const daily1Sigma = spot * (vix / 100) * Math.sqrt(1 / 252);

    // 1. VIX DIRECTION — Varsity M6 Ch8.4: credit best when vol rising
    const ydayVix = STATE.yesterdayHistory?.[0]?.vix;
    if (ydayVix && isCredit) {
        const vixChange = vix - ydayVix;
        if (mode === 'swing') {
            if (vixChange < -0.5) penalty -= 0.3;
            else if (vixChange < -0.2) penalty -= 0.15;
        } else {
            // Intraday: VIX direction less critical (same-day exit)
            if (vixChange < -0.5) penalty -= 0.1;
        }
    }

    // 2. GAP CONFLICT — always applies regardless of mode
    const gap = STATE.gapInfo;
    if (gap && Math.abs(gap.sigma) > 0.8) {
        if ((gap.sigma > 0.8 && isBear) || (gap.sigma < -0.8 && isBull)) {
            penalty -= 0.4;
            if (Math.abs(gap.sigma) > 1.5) penalty -= 0.3;
        }
    }

    // 3. STRIKE DISTANCE — b69→b70: UNIFIED for both modes
    // Calibration (25 trades): ATM sells (<0.2σ) lose on reversals.
    // Backtest (8372 trades): 0.5-0.8σ = SWEET SPOT (66-84%). CLIFF at 0.8σ → 52%.
    // IB is exempt from this (contextScore hardcoded to 0 for IB).
    if (isCredit && daily1Sigma > 0) {
        const distFromATM = Math.abs(cand.sellStrike - spot);
        const sigmaAway = distFromATM / daily1Sigma;

        // Both modes: penalize ATM sells — cat-and-mouse kills them
        if (sigmaAway < 0.3) penalty -= 0.5;
        else if (sigmaAway < 0.5) penalty -= 0.25;
        // SWEET SPOT: 0.5-0.8σ — Varsity's OTM zone, backtest confirmed
        if (sigmaAway >= 0.5 && sigmaAway <= 0.8) penalty += 0.2;
        // b70: CLIFF PENALTY beyond 0.8σ — backtest shows 32pt drop
        else if (sigmaAway > 0.8 && sigmaAway <= 1.0) penalty -= 0.15;
        else if (sigmaAway > 1.0) penalty -= 0.3;
    }

    // 4. WIDTH — b69: wider is ALWAYS better (both modes)
    // Data: width has +0.727 correlation with P&L. Narrow = stop loss hunting.
    if (isCredit) {
        const minW = spot > 30000 ? C.MIN_WIDTH_BNF : C.MIN_WIDTH_NF;
        if (cand.width < minW) penalty -= 0.3;   // below minimum = strong penalty
        if (cand.width >= minW * 2) penalty += 0.1; // wide width = slight bonus
        if (mode === 'swing' && cand.width < 200) penalty -= 0.1; // swing still prefers wider
    }

    // 5. FAR OTM DEBIT + HIGH DTE — swing only
    if (mode === 'swing' && !isCredit && tDTE > 5 && daily1Sigma > 0) {
        const buyDist = Math.abs(cand.buyStrike - spot);
        const sigmaAway = buyDist / daily1Sigma;
        if (sigmaAway > 3) penalty -= 0.3;
    }

    return +penalty.toFixed(2);
}

// ═══ CHAIN DELTA — use Upstox per-strike delta (includes IV smile) instead of flat ATM IV ═══
// Falls back to BS.delta if chain delta unavailable (Upstox didn't provide greeks)
function chainDeltaAtPrice(chainStrikes, price, optionType, spot, T, vol) {
    if (!chainStrikes) return BS.delta(spot, price, T, vol, optionType);
    const allK = Object.keys(chainStrikes).map(Number).sort((a, b) => a - b);
    if (allK.length < 2) return BS.delta(spot, price, T, vol, optionType);

    // Find bracketing strikes
    let lo = null, hi = null;
    for (let i = 0; i < allK.length - 1; i++) {
        if (allK[i] <= price && allK[i + 1] >= price) { lo = allK[i]; hi = allK[i + 1]; break; }
    }
    if (!lo || !hi) {
        // Price outside chain — nearest strike
        const nearest = allK.reduce((a, b) => Math.abs(a - price) < Math.abs(b - price) ? a : b);
        const d = chainStrikes[nearest]?.[optionType]?.delta;
        return d != null ? d : BS.delta(spot, price, T, vol, optionType);
    }

    const dLo = chainStrikes[lo]?.[optionType]?.delta;
    const dHi = chainStrikes[hi]?.[optionType]?.delta;

    if (dLo != null && dHi != null) {
        // Interpolate
        const frac = (price - lo) / (hi - lo);
        return dLo + frac * (dHi - dLo);
    }
    // One available → use it; neither → BS fallback
    if (dLo != null) return dLo;
    if (dHi != null) return dHi;
    return BS.delta(spot, price, T, vol, optionType);
}

// Read ANY greek at an exact chain strike. Falls back to BS computation if chain value is null.
function chainTheta(strikes, strike, type, spot, T, vol) {
    const v = strikes?.[strike]?.[type]?.theta;
    return v != null ? v : BS.theta(spot, strike, T, vol, type);
}
function chainDelta(strikes, strike, type, spot, T, vol) {
    const v = strikes?.[strike]?.[type]?.delta;
    return v != null ? v : BS.delta(spot, strike, T, vol, type);
}

function generateCandidates(chain, spot, indexKey, expiry, vix, biasResult, ivPercentile) {
    const isBNF = indexKey === 'BNF';
    const lotSize = isBNF ? C.BNF_LOT : C.NF_LOT;
    const widths = isBNF ? C.BNF_WIDTHS : C.NF_WIDTHS;
    const parsed = chain;
    const atm = parsed.atm;
    const tDTE = API.tradingDTE(expiry);
    const T = tDTE / BS.DAYS_PER_YEAR;

    const candidates = [];

    const atmIv = parsed.atmIv || (vix / 100);
    const vol = atmIv > 1 ? atmIv / 100 : atmIv;

    const allStrikes = parsed.allStrikes;
    const step = allStrikes.length > 1 ? allStrikes[1] - allStrikes[0] : (isBNF ? 100 : 50);

    // ═══ VARSITY FILTER — only generate allowed strategy types ═══
    const varsity = getVarsityFilter(biasResult, vix);
    const allowedTypes = [...varsity.primary, ...varsity.allowed];

    // ═══ 1. DIRECTIONAL SPREADS (only Varsity-approved types) ═══
    const stratTypes = ['BEAR_CALL', 'BULL_PUT', 'BEAR_PUT', 'BULL_CALL']
        .filter(t => allowedTypes.includes(t));

    // ═══ RANGE BUDGET for debit spreads ═══
    // Reject if width > remaining 1σ in trade direction (uses multi-day sigma)
    const prevClose = isBNF
        ? (STATE.premiumHistory?.[0]?.bnf_spot || spot)
        : (STATE.premiumHistory?.[0]?.nf_spot || spot);
    const tradeSigma = BS.sigmaDays(spot, vix, tDTE);
    const moveFromClose = spot - prevClose;
    const remainingUp = Math.max(0, tradeSigma - Math.max(0, moveFromClose));
    const remainingDown = Math.max(0, tradeSigma - Math.max(0, -moveFromClose));

    for (const sType of stratTypes) {
        for (const width of widths) {
            const strikePairs = getStrikePairs(sType, atm, width, step, allStrikes, spot, isBNF);
            for (const pair of strikePairs) {
                const cand = buildCandidate(sType, pair, parsed.strikes, spot, lotSize, width, T, tDTE, vol, expiry, isBNF, vix);
                if (!cand) continue;

                // ═══ RANGE BUDGET FILTER (debit spreads only) ═══
                if (C.DEBIT_TYPES.includes(sType)) {
                    if (sType === 'BULL_CALL' && width > remainingUp * 1.2) continue;
                    if (sType === 'BEAR_PUT' && width > remainingDown * 1.2) continue;
                }

                cand.forces = getForceAlignment(sType, biasResult, vix, ivPercentile);
                cand.index = isBNF ? 'BNF' : 'NF';
                cand.expiry = expiry;
                cand.tDTE = tDTE;
                cand.varsityTier = varsity.primary.includes(sType) ? 'PRIMARY' : 'ALLOWED';
                // Wall proximity + Gamma risk
                const wall = computeWallScore(cand, parsed, isBNF);
                cand.wallScore = wall.wallScore;
                cand.wallTag = wall.wallTag;
                const gamma = computeGammaRisk(cand, spot, tDTE);
                cand.gammaRisk = gamma.gammaRisk;
                cand.gammaTag = gamma.gammaTag;
                cand.contextScore = computeContextScore(cand, spot, tDTE, vix);
                // Swing mode: BLOCK high gamma ATM sells — skip in paper mode (test everything)
                const hasRealTradesCandidate = STATE.openTrades.some(t => !t.paper);
                if (hasRealTradesCandidate && STATE.tradeMode === 'swing' && cand.isCredit && gamma.gammaRisk >= 0.7) {
                    cand.capitalBlocked = true;
                }
                if (hasRealTradesCandidate && !isBNF && C.DIRECTIONAL_BEAR.concat(C.DIRECTIONAL_BULL).includes(sType)) {
                    if (C.CREDIT_TYPES.includes(sType) && (peakCash(cand) + cand.maxLoss > C.CAPITAL * 0.9)) {
                        cand.capitalBlocked = true;
                    }
                }
                candidates.push(cand);
            }
        }
    }

    // ═══ 2. IRON CONDOR (Varsity-gated) ═══
    if (allowedTypes.includes('IRON_CONDOR')) {
        for (const width of widths) {
            const range = isBNF ? 2000 : 800;
            // Try symmetric distances from ATM
            for (let dist = width; dist <= range; dist += step) {
                const sellCall = atm + dist;
                const buyCall = sellCall + width;
                const sellPut = atm - dist;
                const buyPut = sellPut - width;

                if (!allStrikes.includes(sellCall) || !allStrikes.includes(buyCall)) continue;
                if (!allStrikes.includes(sellPut) || !allStrikes.includes(buyPut)) continue;

                const ceS = parsed.strikes[sellCall]?.CE;
                const ceB = parsed.strikes[buyCall]?.CE;
                const peS = parsed.strikes[sellPut]?.PE;
                const peB = parsed.strikes[buyPut]?.PE;
                if (!ceS || !ceB || !peS || !peB) continue;

                const callCredit = (ceS.bid || 0) - (ceB.ask || 0);
                const putCredit = (peS.bid || 0) - (peB.ask || 0);
                if (callCredit <= 0 || putCredit <= 0) continue;

                const totalCredit = callCredit + putCredit;
                const maxLossPerShare = width - totalCredit;
                if (maxLossPerShare <= 0) continue;

                const maxProfit = Math.round(totalCredit * lotSize);
                const maxLoss = Math.round(maxLossPerShare * lotSize);
                if (maxLoss > C.CAPITAL * C.MAX_RISK_PCT / 100) continue;
                if (maxLoss <= 0 || maxProfit <= 0) continue;

                // Probability: spot stays between both sold strikes
                // b71 FIX: Use chain delta (IV smile) instead of flat ATM IV
                const upperBE = sellCall + totalCredit;
                const lowerBE = sellPut - totalCredit;
                const probAbovePut = 1 - Math.abs(chainDeltaAtPrice(parsed.strikes, lowerBE, 'PE', spot, T, vol));
                const probBelowCall = 1 - Math.abs(chainDeltaAtPrice(parsed.strikes, upperBE, 'CE', spot, T, vol));
                const probProfit = Math.max(0, probAbovePut + probBelowCall - 1);
                if (probProfit < C.MIN_PROB) continue;
                if (totalCredit / width < C.MIN_CREDIT_RATIO) continue;

                const ev = Math.round((probProfit * maxProfit) - ((1 - probProfit) * maxLoss));

                // Theta: sum of all 4 legs — read from chain, BS fallback
                const netTheta = Math.round(Math.abs(
                    (chainTheta(parsed.strikes, sellCall, 'CE', spot, T, vol) + chainTheta(parsed.strikes, sellPut, 'PE', spot, T, vol)
                        - chainTheta(parsed.strikes, buyCall, 'CE', spot, T, vol) - chainTheta(parsed.strikes, buyPut, 'PE', spot, T, vol))
                ) * lotSize);

                const id = `IC_${isBNF ? 'BNF' : 'NF'}_${sellCall}_${sellPut}_W${width}`;

                candidates.push({
                    id, type: 'IRON_CONDOR', width, legs: 4,
                    sellStrike: sellCall, buyStrike: buyCall,
                    sellStrike2: sellPut, buyStrike2: buyPut,
                    sellType: 'CE', buyType: 'CE', sellType2: 'PE', buyType2: 'PE',
                    sellLTP: ceS.bid, buyLTP: ceB.ask,
                    sellLTP2: peS.bid, buyLTP2: peB.ask,
                    netPremium: +totalCredit.toFixed(2),
                    maxProfit, maxLoss, probProfit: +probProfit.toFixed(3),
                    ev, netTheta, isCredit: true, lotSize,
                    netDelta: +(Math.abs(chainDelta(parsed.strikes, sellCall, 'CE', spot, T, vol)) - Math.abs(chainDelta(parsed.strikes, sellPut, 'PE', spot, T, vol))).toFixed(4),
                    riskReward: maxLoss > 0 ? `1:${(maxProfit / maxLoss).toFixed(2)}` : '--',
                    targetProfit: Math.round(maxProfit * 0.5),
                    stopLoss: Math.round(maxProfit),
                    forces: getForceAlignment('IRON_CONDOR', biasResult, vix, ivPercentile),
                    index: isBNF ? 'BNF' : 'NF', expiry, tDTE
                });
                // Wall + Gamma on last pushed candidate
                const icCand = candidates[candidates.length - 1];
                const icWall = computeWallScore(icCand, parsed, isBNF);
                icCand.wallScore = icWall.wallScore; icCand.wallTag = icWall.wallTag;
                const icGamma = computeGammaRisk(icCand, spot, tDTE);
                icCand.gammaRisk = icGamma.gammaRisk; icCand.gammaTag = icGamma.gammaTag;
                // IC is neutral — only VIX direction penalty applies
                const ydayVixIC = STATE.yesterdayHistory?.[0]?.vix;
                icCand.contextScore = (ydayVixIC && vix - ydayVixIC < -0.5) ? -0.15 : 0;
                icCand.varsityTier = varsity.primary.includes('IRON_CONDOR') ? 'PRIMARY' : 'ALLOWED';
                // Block if peak cash (buy legs) + margin exceeds capital
                const icPeak = ((ceB.ask || 0) + (peB.ask || 0)) * lotSize;
                if (icPeak + maxLoss > C.CAPITAL * 0.9) {
                    const hasRealTradesIC = STATE.openTrades.some(t => !t.paper);
                    if (hasRealTradesIC) icCand.capitalBlocked = true;
                }
            }
        }
    } // end IC Varsity gate

    // ═══ 3. IRON BUTTERFLY — ALWAYS BLOCKED for ₹1.1L account ═══
    // IB needs ₹55-95K margin (2 ATM naked sells) + extreme gamma risk
    // Varsity: never recommended for small accounts
    if (allowedTypes.includes('IRON_BUTTERFLY')) {
        for (const width of widths) {
            const sellCall = atm;
            const buyCall = atm + width;
            const sellPut = atm;
            const buyPut = atm - width;

            if (!allStrikes.includes(buyCall) || !allStrikes.includes(buyPut)) continue;

            const ceS = parsed.strikes[atm]?.CE;
            const ceB = parsed.strikes[buyCall]?.CE;
            const peS = parsed.strikes[atm]?.PE;
            const peB = parsed.strikes[buyPut]?.PE;
            if (!ceS || !ceB || !peS || !peB) continue;

            const callCredit = (ceS.bid || 0) - (ceB.ask || 0);
            const putCredit = (peS.bid || 0) - (peB.ask || 0);
            if (callCredit <= 0 || putCredit <= 0) continue;

            const totalCredit = callCredit + putCredit;
            const maxLossPerShare = width - totalCredit;
            if (maxLossPerShare <= 0) continue;

            const maxProfit = Math.round(totalCredit * lotSize);
            const maxLoss = Math.round(maxLossPerShare * lotSize);
            if (maxLoss > C.CAPITAL * C.MAX_RISK_PCT / 100) continue;
            if (maxLoss <= 0 || maxProfit <= 0) continue;

            // IB breakevens: upper = ATM + totalCredit, lower = ATM - totalCredit
            // b71 FIX: Use chain delta like IC — was using width/sigma heuristic before
            const ibUpperBE = atm + totalCredit;
            const ibLowerBE = atm - totalCredit;
            const ibProbAbovePut = 1 - Math.abs(chainDeltaAtPrice(parsed.strikes, ibLowerBE, 'PE', spot, T, vol));
            const ibProbBelowCall = 1 - Math.abs(chainDeltaAtPrice(parsed.strikes, ibUpperBE, 'CE', spot, T, vol));
            const probProfit = Math.max(0, ibProbAbovePut + ibProbBelowCall - 1);
            if (probProfit < C.MIN_PROB) continue;

            const ev = Math.round((probProfit * maxProfit) - ((1 - probProfit) * maxLoss));
            const netTheta = Math.round(Math.abs(
                (chainTheta(parsed.strikes, atm, 'CE', spot, T, vol) + chainTheta(parsed.strikes, atm, 'PE', spot, T, vol)
                    - chainTheta(parsed.strikes, buyCall, 'CE', spot, T, vol) - chainTheta(parsed.strikes, buyPut, 'PE', spot, T, vol))
            ) * lotSize);

            const id = `IB_${isBNF ? 'BNF' : 'NF'}_${atm}_W${width}`;

            candidates.push({
                id, type: 'IRON_BUTTERFLY', width, legs: 4,
                sellStrike: atm, buyStrike: buyCall,
                sellStrike2: atm, buyStrike2: buyPut,
                sellType: 'CE', buyType: 'CE', sellType2: 'PE', buyType2: 'PE',
                sellLTP: ceS.bid, buyLTP: ceB.ask,
                sellLTP2: peS.bid, buyLTP2: peB.ask,
                netPremium: +totalCredit.toFixed(2),
                maxProfit, maxLoss, probProfit: +probProfit.toFixed(3),
                ev, netTheta, isCredit: true, lotSize,
                netDelta: 0, // IB is delta-neutral at entry
                riskReward: maxLoss > 0 ? `1:${(maxProfit / maxLoss).toFixed(2)}` : '--',
                targetProfit: Math.round(maxProfit * 0.5),
                stopLoss: Math.round(maxProfit),
                forces: getForceAlignment('IRON_BUTTERFLY', biasResult, vix, ivPercentile),
                index: isBNF ? 'BNF' : 'NF', expiry, tDTE
            });
            // Wall + Gamma on last pushed candidate
            const ibCand = candidates[candidates.length - 1];
            const ibWall = computeWallScore(ibCand, parsed, isBNF);
            ibCand.wallScore = ibWall.wallScore; ibCand.wallTag = ibWall.wallTag;
            const ibGamma = computeGammaRisk(ibCand, spot, tDTE);
            ibCand.gammaRisk = ibGamma.gammaRisk; ibCand.gammaTag = ibGamma.gammaTag;
            ibCand.contextScore = 0;
            ibCand.varsityTier = varsity.primary.includes('IRON_BUTTERFLY') ? 'PRIMARY' : 'ALLOWED';
            // IB capital block — skip in paper mode (no real money at risk)
            const hasRealTradesIB = STATE.openTrades.some(t => !t.paper);
            if (hasRealTradesIB) ibCand.capitalBlocked = true;
        }
    } // end IB Varsity gate

    // ═══ 4. DOUBLE DEBIT SPREAD (Varsity-gated) ═══
    if (allowedTypes.includes('DOUBLE_DEBIT')) {
        for (const width of widths) {
            // Buy ATM-ish CE spread + Buy ATM-ish PE spread
            const buyCall = atm;
            const sellCall = atm + width;
            const buyPut = atm;
            const sellPut = atm - width;

            if (!allStrikes.includes(sellCall) || !allStrikes.includes(sellPut)) continue;

            const ceB = parsed.strikes[atm]?.CE;
            const ceS = parsed.strikes[sellCall]?.CE;
            const peB = parsed.strikes[atm]?.PE;
            const peS = parsed.strikes[sellPut]?.PE;
            if (!ceB || !ceS || !peB || !peS) continue;

            const callDebit = (ceB.ask || 0) - (ceS.bid || 0);
            const putDebit = (peB.ask || 0) - (peS.bid || 0);
            if (callDebit <= 0 || putDebit <= 0) continue;

            const totalDebit = callDebit + putDebit;
            // Max profit = width - losing side's debit (one side profits, other expires worthless)
            // If BNF moves up: call spread profits (width - callDebit), put spread = -putDebit
            // Net best case = width - callDebit - putDebit = width - totalDebit
            const maxProfit = Math.round((width - totalDebit) * lotSize);
            const maxLoss = Math.round(totalDebit * lotSize); // both expire worthless if pinned at ATM
            if (maxLoss > C.CAPITAL * C.MAX_RISK_PCT / 100) continue;
            if (maxLoss <= 0 || maxProfit <= 0) continue;

            // Probability: need move > totalDebit in either direction
            // Roughly: 1 - prob(stays within totalDebit range)
            const breakeven = totalDebit;
            const moveNeeded = breakeven / spot;
            const dailySigma = BS.dailySigma(spot, vix) * Math.sqrt(tDTE);
            const probProfit = Math.max(0.1, 2 * (1 - BS.normCDF(breakeven / dailySigma)));
            if (probProfit < 0.30) continue; // lower threshold for event plays

            const ev = Math.round((probProfit * maxProfit) - ((1 - probProfit) * maxLoss));
            const netTheta = -Math.round(Math.abs(
                (chainTheta(parsed.strikes, atm, 'CE', spot, T, vol) + chainTheta(parsed.strikes, atm, 'PE', spot, T, vol)
                    - chainTheta(parsed.strikes, sellCall, 'CE', spot, T, vol) - chainTheta(parsed.strikes, sellPut, 'PE', spot, T, vol))
            ) * lotSize); // negative = theta against you

            const id = `DDS_${isBNF ? 'BNF' : 'NF'}_${atm}_W${width}`;

            candidates.push({
                id, type: 'DOUBLE_DEBIT', width, legs: 4,
                sellStrike: sellCall, buyStrike: atm,
                sellStrike2: sellPut, buyStrike2: atm,
                sellType: 'CE', buyType: 'CE', sellType2: 'PE', buyType2: 'PE',
                sellLTP: ceS.bid, buyLTP: ceB.ask,
                sellLTP2: peS.bid, buyLTP2: peB.ask,
                netPremium: +totalDebit.toFixed(2),
                maxProfit, maxLoss, probProfit: +probProfit.toFixed(3),
                ev, netTheta, isCredit: false, lotSize,
                netDelta: 0, // DDS is delta-neutral (long both sides)
                riskReward: maxLoss > 0 ? `1:${(maxProfit / maxLoss).toFixed(2)}` : '--',
                targetProfit: Math.round(maxProfit * 0.5),
                stopLoss: Math.round(maxLoss * 0.5),
                forces: getForceAlignment('DOUBLE_DEBIT', biasResult, vix, ivPercentile),
                index: isBNF ? 'BNF' : 'NF', expiry, tDTE
            });
            // Wall + Gamma on last pushed candidate
            const ddsCand = candidates[candidates.length - 1];
            const ddsWall = computeWallScore(ddsCand, parsed, isBNF);
            ddsCand.wallScore = ddsWall.wallScore; ddsCand.wallTag = ddsWall.wallTag;
            const ddsGamma = computeGammaRisk(ddsCand, spot, tDTE);
            ddsCand.gammaRisk = ddsGamma.gammaRisk; ddsCand.gammaTag = ddsGamma.gammaTag;
            ddsCand.contextScore = computeContextScore(ddsCand, spot, tDTE, vix);
            ddsCand.varsityTier = varsity.primary.includes('DOUBLE_DEBIT') ? 'PRIMARY' : 'ALLOWED';
        }
    } // end DDS Varsity gate

    // ═══ TRANSACTION COST — estimate real-world cost for each candidate ═══
    for (const cand of candidates) {
        const cost = estimateCost(cand);
        cand.estCost = cost.total;
        cand.estCostPct = cost.pctOfMax;
        cand.netMaxProfit = cand.maxProfit - cost.total;
        // Flag candidates where cost eats too much of max profit
        if (cost.costExceedsThreshold) {
            cand.costWarning = true;
            cand.costBlocked = true; // Always block REAL trades where cost > 5% of max profit
        }
    }

    return candidates;
}

function getStrikePairs(sType, atm, width, step, allStrikes, spot, isBNF) {
    const pairs = [];
    const range = isBNF ? 2000 : 800;

    switch (sType) {
        case 'BEAR_CALL': // Sell CE near, Buy CE far (credit)
            for (let sell = atm; sell <= atm + range; sell += step) {
                const buy = sell + width;
                if (allStrikes.includes(sell) && allStrikes.includes(buy)) {
                    pairs.push({ sell, buy, sellType: 'CE', buyType: 'CE' });
                }
            }
            break;
        case 'BULL_PUT': // Sell PE near, Buy PE far (credit)
            for (let sell = atm; sell >= atm - range; sell -= step) {
                const buy = sell - width;
                if (allStrikes.includes(sell) && allStrikes.includes(buy)) {
                    pairs.push({ sell, buy, sellType: 'PE', buyType: 'PE' });
                }
            }
            break;
        case 'BEAR_PUT': // Buy PE near, Sell PE far (debit)
            for (let buyStrike = atm; buyStrike >= atm - range; buyStrike -= step) {
                const sellStrike = buyStrike - width;
                if (allStrikes.includes(buyStrike) && allStrikes.includes(sellStrike)) {
                    pairs.push({ sell: sellStrike, buy: buyStrike, sellType: 'PE', buyType: 'PE' });
                }
            }
            break;
        case 'BULL_CALL': // Buy CE near, Sell CE far (debit)
            for (let buyStrike = atm; buyStrike <= atm + range; buyStrike += step) {
                const sellStrike = buyStrike + width;
                if (allStrikes.includes(buyStrike) && allStrikes.includes(sellStrike)) {
                    pairs.push({ sell: sellStrike, buy: buyStrike, sellType: 'CE', buyType: 'CE' });
                }
            }
            break;
    }
    return pairs.slice(0, 8); // limit per width
}

function buildCandidate(sType, pair, strikes, spot, lotSize, width, T, tDTE, vol, expiry, isBNF, vix) {
    const sellData = strikes[pair.sell]?.[pair.sellType];
    const buyData = strikes[pair.buy]?.[pair.buyType];
    if (!sellData || !buyData) return null;

    const isCredit = C.CREDIT_TYPES.includes(sType);

    // Use bid for selling, ask for buying (conservative)
    const sellPrice = isCredit ? sellData.bid : sellData.ask;
    const buyPrice = isCredit ? buyData.ask : buyData.bid;
    if (!sellPrice || !buyPrice) return null;

    let netPremium, maxProfit, maxLoss;
    if (isCredit) {
        netPremium = sellPrice - buyPrice;
        if (netPremium <= 0) return null;
        maxProfit = netPremium * lotSize;
        maxLoss = (width - netPremium) * lotSize;
    } else {
        netPremium = buyPrice - sellPrice;
        if (netPremium <= 0) return null;
        maxProfit = (width - netPremium) * lotSize;
        maxLoss = netPremium * lotSize;
    }

    if (maxLoss <= 0 || maxProfit <= 0) return null;

    // Risk check
    if (maxLoss > C.CAPITAL * C.MAX_RISK_PCT / 100) return null;

    // ═══ b69: MINIMUM STRIKE DISTANCE — credit directional sells only ═══
    // Data: ATM sells (<0.2σ) lose on reversals. OTM sells (>0.5σ) win 100%.
    // IB exempt (needs ATM). IC exempt (OTM by construction).
    // This HARD FILTER prevents the #1 cause of losses.
    let sigmaOTM = null;
    if (isCredit && (sType === 'BEAR_CALL' || sType === 'BULL_PUT')) {
        const dailySigma = spot * (vix / 100) * Math.sqrt(1 / 252);
        if (dailySigma > 0) {
            sigmaOTM = Math.abs(pair.sell - spot) / dailySigma;
            if (sigmaOTM < C.MIN_SIGMA_OTM) return null; // REJECT below 0.5σ
            sigmaOTM = +sigmaOTM.toFixed(2);
        }
    }

    // ═══ b69: MINIMUM WIDTH — narrow directional spreads get hunted ═══
    // Data: width has +0.727 correlation with P&L for 2-leg directional.
    // IC/IB width means wing distance, not buffer — different mechanic, don't filter.
    if (isCredit && (sType === 'BEAR_CALL' || sType === 'BULL_PUT')) {
        const minW = isBNF ? C.MIN_WIDTH_BNF : C.MIN_WIDTH_NF;
        if (width < minW) return null; // REJECT narrow directional credit spreads
    }

    // Probability — use BREAKEVEN, not sell strike
    // b71 FIX: Use per-strike chain delta (includes IV smile from Upstox)
    // Falls back to BS.delta with ATM IV only if chain delta unavailable
    let probProfit;
    if (isCredit) {
        const breakeven = pair.sellType === 'CE' ? pair.sell + netPremium : pair.sell - netPremium;
        probProfit = 1 - Math.abs(chainDeltaAtPrice(strikes, breakeven, pair.sellType, spot, T, vol));
    } else {
        const breakeven = pair.buyType === 'CE' ? pair.buy + netPremium : pair.buy - netPremium;
        probProfit = Math.abs(chainDeltaAtPrice(strikes, breakeven, pair.buyType, spot, T, vol));
    }

    // ═══ IV EDGE PROBABILITY BOOST — DISABLED (b67) ═══
    // Was: +10% boost for credit sellers when VIX ≥ 18.
    // Calibration Run #1 (18 trades): predicted 80% vs actual 56% = 24% inflation.
    // Upstox pop comparison: our 70.9% vs Upstox 17.1% on IB.
    // DISABLED until calibration engine determines correct boost (if any).
    // Original: if (isCredit && vix >= 18) { ivEdge = Math.min(0.10, (vix-16)*0.015); probProfit += ivEdge; }

    if (probProfit < C.MIN_PROB) return null;

    // Credit ratio filter
    if (isCredit && (netPremium / width) < C.MIN_CREDIT_RATIO) return null;

    // EV
    const ev = (probProfit * maxProfit) - ((1 - probProfit) * maxLoss);

    // Theta estimate — read from chain, BS fallback
    const sellTheta = chainTheta(strikes, pair.sell, pair.sellType, spot, T, vol) * lotSize;
    const buyTheta = chainTheta(strikes, pair.buy, pair.buyType, spot, T, vol) * lotSize;
    const netTheta = isCredit ? -(sellTheta - buyTheta) : (sellTheta - buyTheta); // positive = in your favor

    // Liquidity score (from OI)
    const liq = Math.min(1, (sellData.oi + buyData.oi) / 200000);

    // Greeks — net position, read from chain
    const sellDeltaVal = chainDelta(strikes, pair.sell, pair.sellType, spot, T, vol);
    const netDelta = isCredit ? sellDeltaVal : -sellDeltaVal;

    // R:R and targets
    const riskReward = maxLoss > 0 ? `1:${(maxProfit / maxLoss).toFixed(2)}` : '--';
    const targetProfit = Math.round(maxProfit * 0.5);
    const stopLoss = isCredit ? Math.round(maxProfit) : Math.round(maxLoss * 0.5);

    const id = `${sType}_${isBNF ? 'BNF' : 'NF'}_${pair.sell}_${pair.buy}_W${width}`;

    return {
        id, type: sType, width, legs: 2,
        sellStrike: pair.sell, buyStrike: pair.buy,
        sellType: pair.sellType, buyType: pair.buyType,
        sellLTP: sellPrice, buyLTP: buyPrice,
        sellOI: sellData.oi, buyOI: buyData.oi,
        sellInstrumentKey: sellData.instrumentKey,
        buyInstrumentKey: buyData.instrumentKey,
        netPremium: +netPremium.toFixed(2),
        maxProfit: Math.round(maxProfit),
        maxLoss: Math.round(maxLoss),
        probProfit: +probProfit.toFixed(3),
        ev: Math.round(ev),
        netTheta: Math.round(netTheta),
        netDelta: +netDelta.toFixed(4),
        riskReward,
        targetProfit,
        stopLoss,
        liq,
        isCredit,
        lotSize,
        upstoxPop: sellData.pop ?? null,
        sigmaOTM  // b70: strike distance from ATM in σ (null for IB/IC/debit)
    };
}


// ═══════════════════════════════════════════════════════════════
// CANDIDATE RANKING — Force-first, then EV/risk quality
// ═══════════════════════════════════════════════════════════════

// Dynamic peak cash — what actually leaves your account to enter (buy leg first)
function peakCash(c) {
    const buyLeg = (c.buyLTP || 0) + (c.legs === 4 ? (c.buyLTP2 || 0) : 0);
    return Math.round(buyLeg * (c.lotSize || 30));
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

function rankCandidates(candidates) {
    return candidates
        .filter(c => !c.capitalBlocked)
        .sort((a, b) => {
            // 1st: Varsity tier — PRIMARY before ALLOWED
            const tierOrder = { PRIMARY: 0, ALLOWED: 1 };
            const tierDiff = (tierOrder[a.varsityTier] || 1) - (tierOrder[b.varsityTier] || 1);
            if (tierDiff !== 0) return tierDiff;
            // 2nd: Calibration win rate — strategies that actually WIN rank higher
            const calA = CALIBRATION.win_rates[a.type]?.rate ?? 0.5;
            const calB = CALIBRATION.win_rates[b.type]?.rate ?? 0.5;
            if (Math.abs(calB - calA) > 0.1) return calB - calA;
            // 3rd: force alignment (3/3 > 2/3 > 1/3) — within same tier + calibration
            if (b.forces.aligned !== a.forces.aligned) return b.forces.aligned - a.forces.aligned;
            // 4th: fewer forces against
            if (a.forces.against !== b.forces.against) return a.forces.against - b.forces.against;
            // 5th: context score + brain score — Varsity rules + live copilot intelligence
            const scoreA = (a.contextScore || 0) + (a.brainScore || 0);
            const scoreB = (b.contextScore || 0) + (b.brainScore || 0);
            const ctxDiff = scoreB - scoreA;
            if (Math.abs(ctxDiff) > 0.1) return ctxDiff;
            // 6th: lower gamma risk
            const gammaDiff = (a.gammaRisk || 0) - (b.gammaRisk || 0);
            if (Math.abs(gammaDiff) > 0.2) return gammaDiff;
            // 7th: wall-backed candidates rank higher
            const wallDiff = (b.wallScore || 0) - (a.wallScore || 0);
            if (Math.abs(wallDiff) > 0.2) return wallDiff;
            // 8th: Capital efficiency — EV per ₹ deployed
            const pcA = peakCash(a) || 1;
            const pcB = peakCash(b) || 1;
            const effA = a.ev / pcA;
            const effB = b.ev / pcB;
            if (Math.abs(effB - effA) > 0.01) return effB - effA;
            // 9th: probability as tiebreaker
            return b.probProfit - a.probProfit;
        });
}

// ═══ BRAIN SCORING — converts copilot insights into ranking adjustments ═══
// Runs after every brain cycle. Re-sorts watchlist so #1 at 11:00 reflects 90min of reality.
function applyBrainScores() {
    const candInsights = STATE.brainInsights?.candidates || {};
    if (!Object.keys(candInsights).length && !STATE.brainReady) return;

    const impactWeights = { bullish: 0.08, neutral: 0.02, caution: -0.08, bearish: -0.04 };

    for (const cand of STATE.watchlist) {
        const insights = candInsights[cand.id] || [];
        let score = 0;
        for (const ins of insights) {
            const w = impactWeights[ins.impact] || 0;
            score += w * (ins.strength || 1);
        }
        cand.brainScore = +score.toFixed(3);
    }

    // Re-sort watchlist with brain scores included (rankCandidates uses contextScore + brainScore)
    STATE.watchlist.sort((a, b) => {
        // Same sort logic as rankCandidates but on existing watchlist
        const tierOrder = { PRIMARY: 0, ALLOWED: 1 };
        const tierDiff = (tierOrder[a.varsityTier] || 1) - (tierOrder[b.varsityTier] || 1);
        if (tierDiff !== 0) return tierDiff;
        const calA = CALIBRATION.win_rates[a.type]?.rate ?? 0.5;
        const calB = CALIBRATION.win_rates[b.type]?.rate ?? 0.5;
        if (Math.abs(calB - calA) > 0.1) return calB - calA;
        if (b.forces.aligned !== a.forces.aligned) return b.forces.aligned - a.forces.aligned;
        if (a.forces.against !== b.forces.against) return a.forces.against - b.forces.against;
        const scoreA = (a.contextScore || 0) + (a.brainScore || 0);
        const scoreB = (b.contextScore || 0) + (b.brainScore || 0);
        const ctxDiff = scoreB - scoreA;
        if (Math.abs(ctxDiff) > 0.1) return ctxDiff;
        const gammaDiff = (a.gammaRisk || 0) - (b.gammaRisk || 0);
        if (Math.abs(gammaDiff) > 0.2) return gammaDiff;
        const wallDiff = (b.wallScore || 0) - (a.wallScore || 0);
        if (Math.abs(wallDiff) > 0.2) return wallDiff;
        const pcA = peakCash(a) || 1; const pcB = peakCash(b) || 1;
        if (Math.abs(b.ev / pcB - a.ev / pcA) > 0.01) return b.ev / pcB - a.ev / pcA;
        return b.probProfit - a.probProfit;
    });
}

// ═══ Free capital filter — check peakCash (buy leg cost) + margin against available capital ═══
function applyFreeCapitalFilter(candidates) {
    let marginUsed = 0;
    for (const t of STATE.openTrades) {
        if (!t.paper) marginUsed += t.max_loss || 0; // Paper trades don't block real capital
    }
    const freeCapital = C.CAPITAL - marginUsed;
    return candidates.filter(c => {
        const pc = peakCash(c);
        return pc <= freeCapital * 0.9; // Can you afford the buy leg from available capital?
    });
}


// ═══════════════════════════════════════════════════════════════
// WATCH LOOP — Single continuous loop, σ-filtered
// ═══════════════════════════════════════════════════════════════

async function initialFetch() {
    const statusEl = document.getElementById('status');
    const dbg = (label, data) => {
        const entry = { time: API.istNow(), label, ...data };
        (window._API_DEBUG || []).push(entry);
        console.log(`[APP] ${label}`, data);
    };

    try {
        statusEl.textContent = 'Fetching spots & VIX...';
        const spots = await API.fetchSpots();
        if (!spots.nfSpot || !spots.bnfSpot || !spots.vix) {
            dbg('SPOTS_FAIL', { spots });
            throw new Error(`Missing spot/VIX data — NF:${spots.nfSpot} BNF:${spots.bnfSpot} VIX:${spots.vix}`);
        }
        dbg('SPOTS_OK', { nf: spots.nfSpot, bnf: spots.bnfSpot, vix: spots.vix });

        statusEl.textContent = 'Fetching BNF expiries...';
        const bnfExpiries = await API.fetchExpiries(API.BNF_KEY);
        STATE.bnfExpiry = API.nearestExpiry(bnfExpiries);
        dbg('BNF_EXPIRY', { selected: STATE.bnfExpiry, total: bnfExpiries.length });

        statusEl.textContent = 'Fetching NF expiries...';
        const nfExpiries = await API.fetchExpiries(API.NF_KEY);
        STATE.nfExpiry = API.nearestExpiry(nfExpiries);
        dbg('NF_EXPIRY', { selected: STATE.nfExpiry, total: nfExpiries.length });

        statusEl.textContent = 'Fetching BNF chain...';
        const bnfRaw = await API.fetchChain(API.BNF_KEY, STATE.bnfExpiry);
        STATE.bnfChain = API.parseChain(bnfRaw, spots.bnfSpot);
        dbg('BNF_CHAIN', { strikes: STATE.bnfChain.allStrikes.length, atm: STATE.bnfChain.atm, pcr: STATE.bnfChain.pcr, maxPain: STATE.bnfChain.maxPain });

        statusEl.textContent = 'Fetching NF chain...';
        const nfRaw = await API.fetchChain(API.NF_KEY, STATE.nfExpiry);
        STATE.nfChain = API.parseChain(nfRaw, spots.nfSpot);
        dbg('NF_CHAIN', { strikes: STATE.nfChain.allStrikes.length, atm: STATE.nfChain.atm, pcr: STATE.nfChain.pcr });

        // Fetch BNF breadth (5 constituents, 79% weight)
        statusEl.textContent = 'Fetching BNF breadth...';
        STATE.bnfBreadth = await API.fetchBnfBreadth();

        // Fetch NF50 breadth (50 constituents)
        statusEl.textContent = 'Fetching NF50 breadth...';
        STATE.nf50Breadth = await API.fetchNf50Breadth();

        // Load premium history FIRST (needed for yesterday date + IV percentile)
        statusEl.textContent = 'Loading premium history...';
        STATE.premiumHistory = await DB.getPremiumHistory(60);
        dbg('PREMIUM_HISTORY', { days: STATE.premiumHistory.length, sample: STATE.premiumHistory.slice(0, 3).map(p => `${p.date}:${p.vix}`) });

        const vixHistory = STATE.premiumHistory.map(p => p.vix).filter(Boolean);
        const ivPctl = BS.ivPercentile(spots.vix, vixHistory);
        dbg('IV_PERCENTILE', { currentVix: spots.vix, historyCount: vixHistory.length, percentile: ivPctl });

        // Find YESTERDAY's row — skip today's date
        const today = API.todayIST();
        const ydayRow = STATE.premiumHistory.find(p => p.date !== today) || null;
        // Also create a history array that excludes today (for VIX direction, trajectory etc)
        STATE.yesterdayHistory = STATE.premiumHistory.filter(p => p.date !== today);

        // Fetch yesterday's OHLC for auto Close Character
        statusEl.textContent = 'Fetching yesterday OHLC...';
        const yesterday = ydayRow?.date || null;
        let bnfCloseChar = 0;
        let nfCloseChar = 0;
        let ydayBnfOHLC = null;
        let ydayNfOHLC = null;
        if (yesterday) {
            ydayBnfOHLC = await API.fetchHistoricalOHLC(API.BNF_KEY, yesterday);
            ydayNfOHLC = await API.fetchHistoricalOHLC(API.NF_KEY, yesterday);
            if (ydayBnfOHLC) bnfCloseChar = API.calcCloseChar(ydayBnfOHLC);
            if (ydayNfOHLC) nfCloseChar = API.calcCloseChar(ydayNfOHLC);
            dbg('CLOSE_CHAR', { bnf: bnfCloseChar, nf: nfCloseChar, ydayDate: yesterday, bnfClose: ydayBnfOHLC?.close, bnfLow: ydayBnfOHLC?.low, bnfHigh: ydayBnfOHLC?.high });
        } else {
            dbg('CLOSE_CHAR', { msg: 'No yesterday date - first run' });
        }

        // Gap classification (uses yesterday's actual close, not today's seeded data)
        const ydayClose = ydayBnfOHLC?.close || ydayRow?.bnf_spot || null;
        STATE.gapInfo = API.classifyGap(spots.bnfSpot, ydayClose, spots.vix);
        dbg('GAP', STATE.gapInfo);

        // Phase 10: Overnight Delta — compare evening close (stored at 6 AM) vs morning inputs
        const overnightDelta = computeOvernightDelta(spots.nfSpot);
        if (overnightDelta) dbg('OVERNIGHT_DELTA', overnightDelta);

        // Compute bias — 6 data-driven signals + Upstox comparison
        const biasResult = computeBias(STATE.morningInput, {
            pcr: STATE.bnfChain.pcr,
            nearAtmPCR: STATE.bnfChain.nearAtmPCR,
            vix: spots.vix,
            futuresPremium: STATE.bnfChain.futuresPremium,
            closeChar: bnfCloseChar
        });
        dbg('BIAS', { label: biasResult.label, net: biasResult.net, bull: biasResult.votes.bull, bear: biasResult.votes.bear, signalCount: biasResult.signals.length, signals: biasResult.signals.map(s => `${s.name}:${s.dir}`) });
        dbg('MORNING_INPUT', STATE.morningInput);

        // ═══ MORNING BIAS — save the plan (only on first scan, not re-scan) ═══
        if (!STATE.morningBias) {
            // First scan today — this IS the morning plan
            STATE.morningBias = biasResult;
            STATE.biasDrift = 0;
            STATE.driftOverridden = false;
            const morningData = JSON.parse(localStorage.getItem('mr2_morning') || '{}');
            morningData.biasLabel = biasResult.label;
            morningData.biasNet = biasResult.net;
            morningData.biasBull = biasResult.votes.bull;
            morningData.biasBear = biasResult.votes.bear;
            morningData.signals = biasResult.signals.map(s => ({ name: s.name, dir: s.dir, value: s.value }));
            localStorage.setItem('mr2_morning', JSON.stringify(morningData));
            DB.setConfig('morning_bias', {
                label: biasResult.label, net: biasResult.net,
                biasBull: biasResult.votes.bull, biasBear: biasResult.votes.bear,
                signals: morningData.signals,
                date: API.todayIST()
            });
        } else {
            // Re-scan — morning plan restored from localStorage. Compute drift.
            STATE.biasDrift = biasResult.net - STATE.morningBias.net;
            if (Math.abs(STATE.biasDrift) >= 2 && !STATE.driftOverridden) {
                STATE.driftOverridden = true;
                addNotificationLog('⚠️ Morning Plan Overridden',
                    `Market shifted from ${STATE.morningBias.label} to ${biasResult.label} (drift ${STATE.biasDrift > 0 ? '+' : ''}${STATE.biasDrift}). Using live bias.`, 'urgent');
            }
        }

        // Direction intelligence (use yesterdayHistory to avoid comparing today with today)
        STATE.contrarianPCR = getContrarianPCR(STATE.bnfChain.nearAtmPCR || STATE.bnfChain.pcr, STATE.yesterdayHistory);
        STATE.pcrContext = getInstitutionalPCR(
            STATE.bnfChain.nearAtmPCR || STATE.bnfChain.pcr,
            spots.vix, STATE.gapInfo, STATE.yesterdayHistory,
            STATE.afternoonBaseline, STATE.bnfChain
        );
        STATE.fiiTrend = getFiiShortTrend(STATE.morningInput?.fiiShortPct, STATE.yesterdayHistory);
        STATE.trajectory = getSessionTrajectory(STATE.yesterdayHistory);

        // Generate candidates — use morning bias (plan) unless drift overridden
        statusEl.textContent = 'Generating candidates...';
        const activeBias = STATE.driftOverridden ? biasResult : STATE.morningBias;
        const bnfCandidates = generateCandidates(
            STATE.bnfChain, spots.bnfSpot, 'BNF', STATE.bnfExpiry, spots.vix, activeBias, ivPctl
        );
        const nfCandidates = generateCandidates(
            STATE.nfChain, spots.nfSpot, 'NF', STATE.nfExpiry, spots.vix, activeBias, ivPctl
        );

        const allCandidates = [...bnfCandidates, ...nfCandidates];
        STATE.candidates = rankCandidates(allCandidates);
        STATE.watchlist = STATE.candidates.slice(0, 6); // top 6 overall

        // Add diverse picks to watchlist so they get live updates during polls
        const seenIds = new Set(STATE.watchlist.map(c => c.id));
        for (const index of ['BNF', 'NF']) {
            const seen = new Set();
            for (const c of STATE.candidates.filter(c => c.index === index && !c.capitalBlocked)) {
                if (!seen.has(c.type) && !seenIds.has(c.id)) {
                    seen.add(c.type);
                    seenIds.add(c.id);
                    STATE.watchlist.push(c);
                }
                if (seen.size >= 5) break;
            }
        }
        dbg('CANDIDATES', {
            bnf: bnfCandidates.length, nf: nfCandidates.length, total: allCandidates.length,
            ranked: STATE.candidates.length, watchlist: STATE.watchlist.length,
            top3: STATE.watchlist.slice(0, 3).map(c => `${c.type} ${c.forces.aligned}/3 ${c.sellStrike}/${c.buyStrike}`)
        });

        // Set baseline
        const bnfTDTE = API.tradingDTE(STATE.bnfExpiry);
        const bnfT = bnfTDTE / BS.DAYS_PER_YEAR;
        const bnfAtmIvDec = STATE.bnfChain.atmIv ? (STATE.bnfChain.atmIv > 1 ? STATE.bnfChain.atmIv / 100 : STATE.bnfChain.atmIv) : (spots.vix / 100);
        const bnfAtmTheta = chainTheta(STATE.bnfChain.strikes, STATE.bnfChain.atm, 'CE', spots.bnfSpot, bnfT, bnfAtmIvDec)
            + chainTheta(STATE.bnfChain.strikes, STATE.bnfChain.atm, 'PE', spots.bnfSpot, bnfT, bnfAtmIvDec);
        const dailySigmaBnf = BS.dailySigma(spots.bnfSpot, spots.vix);
        const yesterdayVix = STATE.yesterdayHistory?.length > 0 ? STATE.yesterdayHistory[0]?.vix : null;

        // NF theta + DTE (same computation as BNF, different chain)
        const nfTDTE = API.tradingDTE(STATE.nfExpiry);
        const nfT = nfTDTE / BS.DAYS_PER_YEAR;
        const nfAtmIvDec = STATE.nfChain.atmIv ? (STATE.nfChain.atmIv > 1 ? STATE.nfChain.atmIv / 100 : STATE.nfChain.atmIv) : (spots.vix / 100);
        const nfAtmTheta = chainTheta(STATE.nfChain.strikes, STATE.nfChain.atm, 'CE', spots.nfSpot, nfT, nfAtmIvDec)
            + chainTheta(STATE.nfChain.strikes, STATE.nfChain.atm, 'PE', spots.nfSpot, nfT, nfAtmIvDec);

        STATE.baseline = {
            timestamp: Date.now(),
            nfSpot: spots.nfSpot,
            bnfSpot: spots.bnfSpot,
            vix: spots.vix,
            yesterdayVix,
            nfAtmIv: STATE.nfChain.atmIv,
            bnfAtmIv: STATE.bnfChain.atmIv,
            pcr: STATE.bnfChain.pcr,
            nearAtmPCR: STATE.bnfChain.nearAtmPCR,
            maxPainBnf: STATE.bnfChain.maxPain,
            maxPainNf: STATE.nfChain.maxPain,
            futuresPremBnf: STATE.bnfChain.futuresPremium,
            futuresPremNf: STATE.nfChain.futuresPremium,
            bias: biasResult,
            closeChar: bnfCloseChar,
            ivPercentile: ivPctl,
            // OI walls — BNF
            bnfCallWall: STATE.bnfChain.callWallStrike,
            bnfCallWallOI: STATE.bnfChain.callWallOI,
            bnfPutWall: STATE.bnfChain.putWallStrike,
            bnfPutWallOI: STATE.bnfChain.putWallOI,
            // DTE — both indices
            bnfExpiry: STATE.bnfExpiry,
            bnfTDTE: bnfTDTE,
            bnfCalendarDTE: API.calendarDTE(STATE.bnfExpiry),
            nfExpiry: STATE.nfExpiry,
            nfTDTE: nfTDTE,
            nfCalendarDTE: API.calendarDTE(STATE.nfExpiry),
            // Theta — both indices (₹/day for 1 lot)
            bnfAtmTheta: Math.round(bnfAtmTheta * C.BNF_LOT),
            nfAtmTheta: Math.round(nfAtmTheta * C.NF_LOT),
            // Range budget — both indices
            dailySigmaBnf: Math.round(dailySigmaBnf),
            tradeSigmaBnf: Math.round(BS.sigmaDays(spots.bnfSpot, spots.vix, bnfTDTE)),
            dailySigmaNf: Math.round(BS.dailySigma(spots.nfSpot, spots.vix)),
            tradeSigmaNf: Math.round(BS.sigmaDays(spots.nfSpot, spots.vix, nfTDTE)),
            // Total OI
            bnfTotalCallOI: STATE.bnfChain.totalCallOI,
            bnfTotalPutOI: STATE.bnfChain.totalPutOI,
            // ATM — both indices
            bnfAtm: STATE.bnfChain.atm,
            nfAtm: STATE.nfChain.atm,
            bnfSynthFutures: STATE.bnfChain.synthFutures,
            nfSynthFutures: STATE.nfChain.synthFutures,
            // Breadth
            bnfBreadth: STATE.bnfBreadth,
            nf50Breadth: STATE.nf50Breadth,
            bnfAdvancing: STATE.bnfBreadth?.advancing || 0,
            nf50Advancing: STATE.nf50Breadth?.scaled || 0
        };

        STATE.live = { ...STATE.baseline };
        STATE.lastPollTime = Date.now();
        STATE.pollCount = 0;
        STATE.lastForceState = {};
        STATE.watchlist.forEach(c => {
            STATE.lastForceState[c.id] = c.forces.aligned;
        });

        // Save MORNING snapshot to premium history
        DB.savePremiumSnapshot({
            date: today,
            nfSpot: spots.nfSpot,
            bnfSpot: spots.bnfSpot,
            vix: spots.vix,
            nfAtmIv: STATE.nfChain.atmIv,
            bnfAtmIv: STATE.bnfChain.atmIv,
            pcr: STATE.bnfChain.pcr,
            fiiCash: parseFloat(STATE.morningInput.fiiCash) || null,
            fiiShortPct: parseFloat(STATE.morningInput.fiiShortPct) || null,
            diiCash: parseFloat(STATE.morningInput.diiCash) || null,
            fiiIdxFut: parseFloat(STATE.morningInput.fiiIdxFut) || null,
            fiiStkFut: parseFloat(STATE.morningInput.fiiStkFut) || null,
            futuresPremBnf: STATE.bnfChain.futuresPremium,
            bias: biasResult.label,
            biasNet: biasResult.net
        }, 'morning');

        // Compute institutional regime
        STATE.institutionalRegime = computeInstitutionalRegime(STATE.morningInput);

        // Save FII short% as yesterday's baseline for next session
        if (STATE.morningInput.fiiShortPct) {
            localStorage.setItem('mr2_fii_short_prev', STATE.morningInput.fiiShortPct);
        }

        // Save morning CHAIN SNAPSHOT for afternoon comparison
        const morningSnap = buildChainSnapshotData();
        DB.saveChainSnapshot(morningSnap, 'morning');

        // Validate yesterday's positioning signal against today's gap
        STATE.signalValidation = await validateYesterdaySignal(STATE.gapInfo);
        if (STATE.signalValidation) {
            dbg('SIGNAL_VALIDATION', STATE.signalValidation);
            // Save result to Supabase (on yesterday's 315pm chain_snapshot row)
            const ydayDate = STATE.signalValidation.date;
            if (ydayDate) {
                await DB.updateSignalResult(ydayDate, STATE.signalValidation.correct, STATE.signalValidation.actualDir);
            }
            // Load accuracy stats from Supabase
            STATE.signalAccuracyStats = await DB.getSignalAccuracyStats();
        }

        // ═══ CHECK: Did today's 2PM / 3:15PM snapshots already get saved? ═══
        // This survives page refreshes, code pushes, Clear & Reset
        const existing2pm = await DB.getChainSnapshot(today, '2pm');
        const existing315pm = await DB.getChainSnapshot(today, '315pm');
        if (existing2pm) {
            STATE._captured2pm = true;
            STATE.afternoonBaseline = existing2pm;
            dbg('RESTORE_2PM', { date: today, status: 'Found in Supabase — flag set, will NOT re-capture' });
        }
        if (existing315pm) {
            STATE._captured315pm = true;
            dbg('RESTORE_315PM', { date: today, signal: existing315pm.tomorrow_signal, strength: existing315pm.signal_strength });
            // Restore tomorrow signal + positioning result
            if (existing315pm.tomorrow_signal) {
                STATE.tomorrowSignal = { signal: existing315pm.tomorrow_signal, strength: existing315pm.signal_strength || 0 };
                // Re-generate positioning trades with restored signal
                const tSignal = STATE.tomorrowSignal.signal;
                const positioningBias = {
                    bias: tSignal === 'BEARISH' ? 'BEAR' : tSignal === 'BULLISH' ? 'BULL' : 'NEUTRAL',
                    strength: STATE.tomorrowSignal.strength >= 3 ? 'STRONG' : 'MILD',
                    net: tSignal === 'BEARISH' ? -3 : tSignal === 'BULLISH' ? 3 : 0,
                    votes: { bull: tSignal === 'BULLISH' ? 3 : 0, bear: tSignal === 'BEARISH' ? 3 : 0 },
                    signals: [{ name: 'Tomorrow Signal', value: `${tSignal} (${STATE.tomorrowSignal.strength}/5)`, dir: tSignal === 'BEARISH' ? 'BEAR' : tSignal === 'BULLISH' ? 'BULL' : 'NEUTRAL' }],
                    label: `${STATE.tomorrowSignal.strength >= 3 ? 'STRONG' : 'MILD'} ${tSignal === 'BEARISH' ? 'BEAR' : tSignal === 'BULLISH' ? 'BULL' : 'NEUTRAL'}`.trim()
                };
                const posBnf = generateCandidates(STATE.bnfChain, spots.bnfSpot, 'BNF', STATE.bnfExpiry, spots.vix, positioningBias, ivPctl);
                const posNf = generateCandidates(STATE.nfChain, spots.nfSpot, 'NF', STATE.nfExpiry, spots.vix, positioningBias, ivPctl);
                STATE.positioningCandidates = applyFreeCapitalFilter(rankCandidates([...posBnf, ...posNf])).slice(0, 10);
                if (existing2pm) {
                    STATE.positioningResult = computePositioning(existing2pm, existing315pm);
                }
            }
        }

        statusEl.textContent = '';
        // Reset button after successful scan
        document.getElementById('btn-lock').disabled = true;
        document.getElementById('btn-lock').textContent = '✅ Scanned';
        document.getElementById('btn-stop').style.display = 'inline-block';

        // Auto-collapse morning section
        collapseMorning();

        renderAll();
        startWatchLoop();

    } catch (err) {
        statusEl.textContent = `Error: ${err.message}`;
        console.error('initialFetch error:', err);
        // Log to debug panel even on error
        if (window._API_DEBUG) {
            window._API_DEBUG.push({ time: API.istNow(), label: 'FETCH_ERROR', message: err.message, stack: err.stack?.split('\n')[1] || '' });
        }
        renderDebug();
        // Re-enable lock button so user can retry
        document.getElementById('btn-lock').disabled = false;
        document.getElementById('btn-lock').textContent = '🔒 Lock & Scan';
        document.querySelectorAll('.morning-input').forEach(el => el.disabled = false);
    }
}

async function lightFetch() {
    try {
        const spots = await API.fetchSpots();
        if (!spots.bnfSpot || !spots.vix) return;

        // Fetch updated BNF chain (for live LTPs on watched candidates)
        const bnfRaw = await API.fetchChain(API.BNF_KEY, STATE.bnfExpiry);
        const bnfChain = API.parseChain(bnfRaw, spots.bnfSpot);

        // Fetch NF chain if NF trade is open OR for OI tab display
        let nfChain = STATE.nfChain; // keep morning chain as fallback
        if (STATE.openTrades.some(t => t.index_key === 'NF') || STATE.nfExpiry) {
            try {
                const nfRaw = await API.fetchChain(API.NF_KEY, STATE.nfExpiry);
                nfChain = API.parseChain(nfRaw, spots.nfSpot);
            } catch (e) { console.warn('NF chain fetch skipped:', e.message); }
        }

        const elapsed = API.minutesSinceOpen();
        const vixHistory = STATE.premiumHistory.map(p => p.vix).filter(Boolean);
        const ivPctl = BS.ivPercentile(spots.vix, vixHistory);

        // σ scores — how significant are the moves?
        const spotSigma = BS.sigmaScore(spots.bnfSpot, STATE.baseline.bnfSpot, STATE.baseline.vix, elapsed);
        const vixSigma = BS.vixSigmaScore(spots.vix, STATE.baseline.vix, elapsed);

        // Update chain references for positioning/snapshot functions
        STATE.bnfChain = bnfChain;
        STATE.nfChain = nfChain;

        STATE.live = {
            ...STATE.baseline,
            nfSpot: spots.nfSpot,
            bnfSpot: spots.bnfSpot,
            vix: spots.vix,
            pcr: bnfChain.pcr,
            nearAtmPCR: bnfChain.nearAtmPCR,
            maxPainBnf: bnfChain.maxPain,
            futuresPremBnf: bnfChain.futuresPremium,
            bnfAtmIv: bnfChain.atmIv,
            // OI walls — live BNF
            bnfCallWall: bnfChain.callWallStrike,
            bnfCallWallOI: bnfChain.callWallOI,
            bnfPutWall: bnfChain.putWallStrike,
            bnfPutWallOI: bnfChain.putWallOI,
            bnfTotalCallOI: bnfChain.totalCallOI,
            bnfTotalPutOI: bnfChain.totalPutOI,
            // NF live data
            nfAtmIv: nfChain?.atmIv || STATE.baseline?.nfAtmIv,
            nfPcr: nfChain?.pcr,
            nfNearAtmPCR: nfChain?.nearAtmPCR,
            futuresPremNf: nfChain?.futuresPremium,
            ivPercentile: ivPctl,
            spotSigma: +spotSigma.toFixed(2),
            vixSigma: +vixSigma.toFixed(2),
            timestamp: Date.now()
        };

        // Recompute bias with live chain data
        const biasResult = computeBias(STATE.morningInput, {
            pcr: bnfChain.pcr,
            nearAtmPCR: bnfChain.nearAtmPCR,
            vix: spots.vix,
            futuresPremium: bnfChain.futuresPremium,
            closeChar: STATE.baseline?.closeChar || 0
        });
        STATE.live.bias = biasResult;

        // ═══ DRIFT DETECTION — morning plan vs live reality ═══
        if (STATE.morningBias) {
            STATE.biasDrift = biasResult.net - STATE.morningBias.net;
            // Auto-switch at ±2 drift — regenerate candidates with live bias
            if (Math.abs(STATE.biasDrift) >= 2 && !STATE.driftOverridden) {
                STATE.driftOverridden = true;
                sendNotification('⚠️ Market Regime Shift',
                    `Morning: ${STATE.morningBias.label} → Now: ${biasResult.label} (drift ${STATE.biasDrift > 0 ? '+' : ''}${STATE.biasDrift}). Strategies updated.`);
                addNotificationLog('⚠️ Drift Override',
                    `Morning: ${STATE.morningBias.label} (${STATE.morningBias.net}) → Now: ${biasResult.label} (${biasResult.net}). Candidates regenerated with live bias.`, 'urgent');
                // Regenerate candidates with live bias
                const bnfCands = generateCandidates(STATE.bnfChain, spots.bnfSpot, 'BNF', STATE.bnfExpiry, spots.vix, biasResult, ivPctl);
                const nfCands = generateCandidates(STATE.nfChain, spots.nfSpot, 'NF', STATE.nfExpiry, spots.vix, biasResult, ivPctl);
                STATE.candidates = rankCandidates([...bnfCands, ...nfCands]);
                STATE.watchlist = STATE.candidates.slice(0, 6);
                const seenIds = new Set(STATE.watchlist.map(c => c.id));
                for (const idx of ['BNF', 'NF']) {
                    const seen = new Set();
                    for (const c of STATE.candidates.filter(c => c.index === idx && !c.capitalBlocked)) {
                        if (!seen.has(c.type) && !seenIds.has(c.id)) { seen.add(c.type); seenIds.add(c.id); STATE.watchlist.push(c); }
                        if (seen.size >= 5) break;
                    }
                }
            }
        }

        // Update contrarian PCR with live near-ATM PCR
        STATE.contrarianPCR = getContrarianPCR(bnfChain.nearAtmPCR || bnfChain.pcr, STATE.yesterdayHistory);
        STATE.pcrContext = getInstitutionalPCR(
            bnfChain.nearAtmPCR || bnfChain.pcr,
            spots.vix, STATE.gapInfo, STATE.yesterdayHistory,
            STATE.afternoonBaseline, bnfChain
        );

        // Check: is any σ move significant enough to recalculate?
        const absSpotSigma = Math.abs(spotSigma);
        const absVixSigma = Math.abs(vixSigma);
        const threshold = STATE.openTrades.length > 0 ? C.SIGMA_EXIT_THRESHOLD : C.SIGMA_ENTRY_THRESHOLD;

        const significantMove = absSpotSigma > threshold || absVixSigma > threshold;

        if (significantMove) {
            // Recalculate force alignment for watchlist
            updateWatchlistForces(bnfChain, spots, biasResult, ivPctl);
        }

        // Update ALL open trade P&Ls — use correct chain based on trade index
        for (const trade of STATE.openTrades) {
            const tradeChain = trade.index_key === 'NF' ? nfChain : bnfChain;
            const tradeSpot = trade.index_key === 'NF' ? spots.nfSpot : spots.bnfSpot;
            updateOpenTradePnL(trade, tradeChain, spots, tradeSpot);
            // Adversarial Control Index — use correct chain
            trade.controlIndex = computeControlIndex(trade, tradeChain, tradeSpot, STATE.bnfBreadth);
        }

        // Check for notifications
        await handleNotifications(absSpotSigma, absVixSigma, significantMove);

        // ═══ POSITION HEALTH CHECK — runs EVERY poll, not just σ moves ═══
        for (const trade of STATE.openTrades) {
            const paperPrefix = trade.paper ? '📋 ' : '';
            const tradeLabel = `${paperPrefix}${trade.index_key} ${friendlyType(trade.strategy_type)} ${trade.sell_strike}`;
            const pnlPct = trade.max_profit > 0 ? trade.current_pnl / trade.max_profit : 0;
            const lossPct = trade.max_loss > 0 ? Math.abs(trade.current_pnl) / trade.max_loss : 0;
            const ci = trade.controlIndex;

            // First poll — always show status
            if (STATE.pollCount <= 1) {
                addNotificationLog('📊 Position Status',
                    `${tradeLabel} | P&L: ₹${trade.current_pnl} | Spot: ${trade.current_spot?.toFixed(0)} | Ctrl: ${ci ?? '--'}`,
                    'routine');
            }

            if (pnlPct >= 0.5 && pnlPct < 0.8 && !trade._notified50) {
                trade._notified50 = true;
                sendNotification('💰 50% Target Hit', `${tradeLabel} P&L ₹${trade.current_pnl} (${Math.round(pnlPct * 100)}% of max). Consider booking.`, 'important');
            }

            if (pnlPct >= 0.8 && !trade._notifiedTarget) {
                trade._notifiedTarget = true;
                sendNotification('🎯 Target! Book Profit', `${tradeLabel} P&L ₹${trade.current_pnl} (${Math.round(pnlPct * 100)}% of max ₹${trade.max_profit}). BOOK NOW.`, 'urgent');
            }

            if (trade.peak_pnl > 500 && trade.current_pnl < trade.peak_pnl * 0.5 && !trade._notifiedDrop) {
                trade._notifiedDrop = true;
                sendNotification('⚠️ P&L Dropping', `${tradeLabel} Was ₹${trade.peak_pnl}, now ₹${trade.current_pnl}. Peak erosion >50%.`, 'important');
            }

            if (ci !== null && ci <= -30 && !trade._notifiedControl) {
                trade._notifiedControl = true;
                sendNotification('🛑 Opponent in Control', `${tradeLabel} Control Index: ${ci}. Consider exiting.`, 'urgent');
            }

            if (trade.current_pnl < 0 && lossPct >= 0.6 && !trade._notifiedSL) {
                trade._notifiedSL = true;
                sendNotification('🛑 Stop Loss Near', `${tradeLabel} P&L ₹${trade.current_pnl} (${Math.round(lossPct * 100)}% of max loss). EXIT.`, 'urgent');
            }

            if (trade.is_credit && trade.current_spot && trade.sell_strike) {
                // ═══ b69: SELL STRIKE CROSSED — most urgent alert ═══
                // Apr 2 lesson: spot crossed 22,300 sell strike, CI showed "in control"
                // This is the EXIT signal — you're ITM, position is structurally threatened
                const isBearType = trade.strategy_type?.includes('BEAR');
                const isBullType = trade.strategy_type?.includes('BULL');
                const crossed = (isBearType && trade.current_spot > trade.sell_strike) ||
                    (isBullType && trade.current_spot < trade.sell_strike);
                if (crossed && !trade._notifiedCrossed) {
                    trade._notifiedCrossed = true;
                    sendNotification('🚨 SELL STRIKE BREACHED — EXIT',
                        `${tradeLabel} Spot ${trade.current_spot.toFixed(0)} has CROSSED sell strike ${trade.sell_strike}. Position is ITM. Consider immediate exit.`,
                        'urgent');
                }

                // Existing: spot approaching sell strike (warning)
                const cushion = Math.abs(trade.sell_strike - trade.current_spot);
                const width = trade.width || 300;
                if (cushion < width && !trade._notifiedCushion) {
                    trade._notifiedCushion = true;
                    sendNotification('⚡ Spot Near Sold Strike', `${tradeLabel} Only ${cushion.toFixed(0)} pts cushion. Sold: ${trade.sell_strike}, Spot: ${trade.current_spot.toFixed(0)}`, 'urgent');
                }
            }

            // ═══ b70: IB/IC INTRADAY-ONLY — 3PM EXIT ALERT ═══
            // Backtest Table 6 (552 days): IB 0%, IC 0-4% overnight survival.
            // ATM/near-ATM sold strikes ALWAYS get breached next day.
            // Alert at 2:45 PM (330 min after 9:15): "EXIT before close"
            const is4LegCredit = trade.strategy_type === 'IRON_BUTTERFLY' || trade.strategy_type === 'IRON_CONDOR';
            const minsOpen = API.minutesSinceOpen?.() ?? 0;
            if (is4LegCredit && minsOpen >= 330 && !trade._notified4LegExit) {
                trade._notified4LegExit = true;
                sendNotification('⏱️ EXIT 4-LEG BEFORE CLOSE',
                    `${tradeLabel} is ${trade.strategy_type} — backtest: 0% overnight survival. EXIT before 3:20 PM.`,
                    'urgent');
            }
        }

        // Save CLOSE snapshot — upserts by (date, 'close'), last poll = closing data
        const today = API.todayIST();
        DB.savePremiumSnapshot({
            date: today,
            nfSpot: spots.nfSpot,
            bnfSpot: spots.bnfSpot,
            vix: spots.vix,
            nfAtmIv: STATE.nfChain?.atmIv,
            bnfAtmIv: bnfChain.atmIv,
            pcr: bnfChain.pcr,
            fiiCash: parseFloat(STATE.morningInput?.fiiCash) || null,
            fiiShortPct: parseFloat(STATE.morningInput?.fiiShortPct) || null,
            diiCash: parseFloat(STATE.morningInput?.diiCash) || null,
            fiiIdxFut: parseFloat(STATE.morningInput?.fiiIdxFut) || null,
            fiiStkFut: parseFloat(STATE.morningInput?.fiiStkFut) || null,
            futuresPremBnf: bnfChain.futuresPremium,
            bias: STATE.live.bias?.label,
            biasNet: STATE.live.bias?.net
        }, 'close');

        STATE.pollCount++;
        STATE.lastPollTime = Date.now();

        // Phase 11: Store poll snapshot for intraday pattern matching
        // Helper: extract ATM ± 10 strikes with key fields (compact format)
        const extractStrikes = (chain, n = 10) => {
            if (!chain?.atm || !chain?.strikes || !chain?.allStrikes) return [];
            const atm = chain.atm;
            const step = chain.allStrikes.length > 1 ? chain.allStrikes[1] - chain.allStrikes[0] : (atm > 30000 ? 100 : 50);
            const result = [];
            for (let i = -n; i <= n; i++) {
                const strike = atm + (i * step);
                const ce = chain.strikes[strike]?.CE;
                const pe = chain.strikes[strike]?.PE;
                if (!ce && !pe) continue;
                result.push({
                    k: strike,
                    c: ce ? { o: ce.oi ?? 0, v: ce.volume ?? 0, l: +(ce.ltp?.toFixed(2) ?? 0), i: +(ce.iv?.toFixed(1) ?? 0), d: +(ce.delta?.toFixed(3) ?? 0), p: +(ce.pop?.toFixed(1) ?? 0) } : null,
                    p: pe ? { o: pe.oi ?? 0, v: pe.volume ?? 0, l: +(pe.ltp?.toFixed(2) ?? 0), i: +(pe.iv?.toFixed(1) ?? 0), d: +(pe.delta?.toFixed(3) ?? 0), p: +(pe.pop?.toFixed(1) ?? 0) } : null
                });
            }
            return result;
        };

        const pollSnap = {
            t: new Date().toLocaleTimeString('en-IN', { timeZone: 'Asia/Kolkata', hour: '2-digit', minute: '2-digit', hour12: false }),
            nf: spots.nfSpot,
            bnf: spots.bnfSpot,
            vix: +(spots.vix?.toFixed(1) ?? 0),
            pcr: +(bnfChain.nearAtmPCR?.toFixed(2) ?? 0),
            nfPcr: +(nfChain?.nearAtmPCR?.toFixed(2) ?? 0),
            // BNF walls
            cw: bnfChain.callWallStrike ?? null,
            cwOI: bnfChain.callWallOI ?? null,
            pw: bnfChain.putWallStrike ?? null,
            pwOI: bnfChain.putWallOI ?? null,
            // NF walls (strike + OI)
            nfCW: nfChain?.callWallStrike ?? null,
            nfCWOI: nfChain?.callWallOI ?? null,
            nfPW: nfChain?.putWallStrike ?? null,
            nfPWOI: nfChain?.putWallOI ?? null,
            // Total OI — for velocity tracking (is OI building or leaving?)
            bnfCOI: bnfChain.totalCallOI ?? null,
            bnfPOI: bnfChain.totalPutOI ?? null,
            nfCOI: nfChain?.totalCallOI ?? null,
            nfPOI: nfChain?.totalPutOI ?? null,
            // Max pain + futures premium
            mp: bnfChain.maxPain ?? null,
            nfMP: nfChain?.maxPain ?? null,
            fp: +(bnfChain.futuresPremium?.toFixed(3) ?? 0),
            // Breadth — heavyweight confirmation
            brd: STATE.bnfBreadth?.weightedPct ?? null,
            nfAdv: STATE.nf50Breadth?.scaled ?? null,
            // Bias
            bias: STATE.live.bias?.net ?? 0,
            // Per-strike data: ATM ± 10 strikes (oi, volume, ltp, iv, delta, pop)
            bnfS: extractStrikes(bnfChain),
            nfS: extractStrikes(nfChain)
        };
        STATE.pollHistory.push(pollSnap);

        // Save to Supabase — one key per day, array grows with each poll
        DB.setConfig('poll_history_' + today, STATE.pollHistory);

        // Phase 12: Run Pyodide brain — Python analysis on poll history
        await runBrain();

        renderAll();

    } catch (err) {
        console.warn('lightFetch error:', err.message);
        document.getElementById('status').textContent = `Poll error: ${err.message}`;
    }
}

function updateWatchlistForces(bnfChain, spots, biasResult, ivPctl) {
    for (const cand of STATE.watchlist) {
        // Use correct chain for this candidate's index
        const chain = cand.index === 'NF' ? STATE.nfChain : bnfChain;
        if (!chain) continue;

        // Update LTPs from live chain — leg 1+2
        const sellData = chain.strikes[cand.sellStrike]?.[cand.sellType];
        const buyData = chain.strikes[cand.buyStrike]?.[cand.buyType];
        if (sellData) {
            cand.sellLTP = cand.isCredit ? sellData.bid : sellData.ask;
            cand.sellOI = sellData.oi;
        }
        if (buyData) {
            cand.buyLTP = cand.isCredit ? buyData.ask : buyData.bid;
            cand.buyOI = buyData.oi;
        }

        // 4-leg: update leg 3+4
        if (cand.legs === 4 && cand.sellStrike2) {
            const sellData2 = chain.strikes[cand.sellStrike2]?.[cand.sellType2];
            const buyData2 = chain.strikes[cand.buyStrike2]?.[cand.buyType2];
            if (sellData2) cand.sellLTP2 = cand.isCredit ? sellData2.bid : sellData2.ask;
            if (buyData2) cand.buyLTP2 = cand.isCredit ? buyData2.ask : buyData2.bid;
        }

        // Recalculate premium
        if (cand.legs === 4) {
            if (cand.isCredit) {
                const credit1 = (cand.sellLTP || 0) - (cand.buyLTP || 0);
                const credit2 = (cand.sellLTP2 || 0) - (cand.buyLTP2 || 0);
                cand.netPremium = +(credit1 + credit2).toFixed(2);
                cand.maxProfit = Math.round(cand.netPremium * cand.lotSize);
                cand.maxLoss = Math.round((cand.width - cand.netPremium) * cand.lotSize);
            } else {
                const debit1 = (cand.buyLTP || 0) - (cand.sellLTP || 0);
                const debit2 = (cand.buyLTP2 || 0) - (cand.sellLTP2 || 0);
                cand.netPremium = +(debit1 + debit2).toFixed(2);
                cand.maxProfit = Math.round((cand.width - cand.netPremium) * cand.lotSize);
                cand.maxLoss = Math.round(cand.netPremium * cand.lotSize);
            }
        } else if (cand.isCredit) {
            cand.netPremium = +(cand.sellLTP - cand.buyLTP).toFixed(2);
            cand.maxProfit = Math.round(cand.netPremium * cand.lotSize);
            cand.maxLoss = Math.round((cand.width - cand.netPremium) * cand.lotSize);
        } else {
            cand.netPremium = +(cand.buyLTP - cand.sellLTP).toFixed(2);
            cand.maxProfit = Math.round((cand.width - cand.netPremium) * cand.lotSize);
            cand.maxLoss = Math.round(cand.netPremium * cand.lotSize);
        }

        // Recalculate forces
        const oldAlignment = cand.forces.aligned;
        cand.forces = getForceAlignment(cand.type, biasResult, spots.vix, ivPctl);
        cand._alignmentChanged = (cand.forces.aligned !== oldAlignment);
        cand._prevAlignment = oldAlignment;
    }
}

function updateOpenTradePnL(trade, chain, spots, tradeSpot) {
    if (!trade || !chain) return;

    const sellData = chain.strikes[trade.sell_strike]?.[trade.sell_type];
    const buyData = chain.strikes[trade.buy_strike]?.[trade.buy_type];
    if (!sellData || !buyData) return;

    const lotSize = trade.index_key === 'BNF' ? C.BNF_LOT : C.NF_LOT;

    if (trade.is_credit) {
        const currentNet = sellData.ltp - buyData.ltp;
        trade.current_premium = +currentNet.toFixed(2);
        trade.current_pnl = Math.round((trade.entry_premium - currentNet) * lotSize);
    } else {
        const currentNet = buyData.ltp - sellData.ltp;
        trade.current_premium = +currentNet.toFixed(2);
        trade.current_pnl = Math.round((currentNet - trade.entry_premium) * lotSize);
    }

    trade.current_spot = tradeSpot || spots.bnfSpot;
    trade.current_vix = spots.vix;

    // Update peak and trough (for calibration: max favorable + max adverse excursion)
    if (!trade.peak_pnl || trade.current_pnl > trade.peak_pnl) {
        trade.peak_pnl = trade.current_pnl;
    }
    if (trade.trough_pnl === undefined || trade.trough_pnl === null || trade.current_pnl < trade.trough_pnl) {
        trade.trough_pnl = trade.current_pnl;
    }
    trade.poll_count = (trade.poll_count || 0) + 1;

    // Journey tracking — aggregated for calibration
    if (!trade._journey) trade._journey = {};
    const j = trade._journey;
    if (!j.spot_high || trade.current_spot > j.spot_high) j.spot_high = trade.current_spot;
    if (!j.spot_low || trade.current_spot < j.spot_low) j.spot_low = trade.current_spot;
    const ci = trade.controlIndex;
    if (ci !== null && ci !== undefined) {
        if (j.max_ci === undefined || ci > j.max_ci) j.max_ci = ci;
        if (j.min_ci === undefined || ci < j.min_ci) j.min_ci = ci;
    }
    // Track force alignment changes
    const prevAlign = j._lastAlignment;
    const currAlign = trade.forces?.aligned;
    if (prevAlign !== undefined && prevAlign !== currAlign) {
        j.forces_changed_count = (j.forces_changed_count || 0) + 1;
    }
    j._lastAlignment = currAlign;

    // Journey timeline — full time-series for exit pattern analysis
    if (!j.timeline) j.timeline = [];
    const now = new Date();
    const timeStr = now.getHours().toString().padStart(2, '0') + ':' + now.getMinutes().toString().padStart(2, '0');
    j.timeline.push({
        t: timeStr,
        pnl: trade.current_pnl ?? 0,
        ci: ci ?? null,
        spot: trade.current_spot ?? null,
        vix: trade.current_vix ?? null,
        pcr: STATE.live?.nearAtmPCR ?? STATE.live?.pcr ?? null,
        fa: trade.forces?.aligned ?? null
    });

    // Force alignment for position
    const vixHistory = STATE.premiumHistory.map(p => p.vix).filter(Boolean);
    const ivPctl = BS.ivPercentile(spots.vix, vixHistory);
    trade.forces = getForceAlignment(trade.strategy_type, STATE.live.bias, spots.vix, ivPctl);

    // Update in Supabase
    DB.updateTrade(trade.id, {
        current_pnl: trade.current_pnl,
        current_spot: trade.current_spot,
        peak_pnl: trade.peak_pnl,
        trough_pnl: trade.trough_pnl,
        current_premium: trade.current_premium,
        poll_count: trade.poll_count,
        // Journey persisted for refresh survival
        journey_stats: {
            spot_high: j.spot_high ?? null,
            spot_low: j.spot_low ?? null,
            max_ci: j.max_ci ?? null,
            min_ci: j.min_ci ?? null,
            forces_changed_count: j.forces_changed_count ?? 0,
            timeline: j.timeline || []
        }
    });
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
        for (const cand of STATE.watchlist) {
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
        for (const trade of STATE.openTrades) {
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
                `BNF ${STATE.live.bnfSpot?.toFixed(0)} (${STATE.live.spotSigma}σ) VIX ${STATE.live.vix?.toFixed(1)} (${STATE.live.vixSigma}σ)`,
                'important'
            );
        }
    }

    // ═══ ROUTINE NOTIFICATIONS (every 30 min) ═══
    if (now - STATE.lastRoutineNotify >= C.ROUTINE_NOTIFY_MS) {
        STATE.lastRoutineNotify = now;

        let body = `BNF ${STATE.live.bnfSpot?.toFixed(0)} | VIX ${STATE.live.vix?.toFixed(1)}`;
        if (STATE.openTrades.length > 0) {
            const totalPnL = STATE.openTrades.reduce((s, t) => s + (t.current_pnl || 0), 0);
            body += ` | ${STATE.openTrades.length} pos P&L ₹${totalPnL}`;
        }
        const top = STATE.watchlist[0];
        if (top && STATE.openTrades.length === 0) {
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
                computeGlobalBoost(STATE.tomorrowSignal, STATE.positioningResult);

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
            addNotificationLog('✅ 3:15 PM Scan Complete', `Tomorrow Signal: ${STATE.tomorrowSignal?.signal || 'NEUTRAL'} (${STATE.tomorrowSignal?.strength || 0}/5)`, 'urgent');

            // ═══ GENERATE POSITIONING TRADES ═══
            const tSignal = STATE.tomorrowSignal?.signal || 'NEUTRAL';
            const positioningBias = {
                bias: tSignal === 'BEARISH' ? 'BEAR' : tSignal === 'BULLISH' ? 'BULL' : 'NEUTRAL',
                strength: STATE.tomorrowSignal?.strength >= 3 ? 'STRONG' : 'MILD',
                net: tSignal === 'BEARISH' ? -3 : tSignal === 'BULLISH' ? 3 : 0,
                votes: { bull: tSignal === 'BULLISH' ? 3 : 0, bear: tSignal === 'BEARISH' ? 3 : 0 },
                signals: [{ name: 'Tomorrow Signal', value: `${tSignal} (${STATE.tomorrowSignal?.strength}/5)`, dir: tSignal === 'BEARISH' ? 'BEAR' : tSignal === 'BULLISH' ? 'BULL' : 'NEUTRAL' }],
                label: `${STATE.tomorrowSignal?.strength >= 3 ? 'STRONG' : 'MILD'} ${tSignal === 'BEARISH' ? 'BEAR' : tSignal === 'BULLISH' ? 'BULL' : 'NEUTRAL'}`.trim()
            };

            const vixHistory = STATE.premiumHistory.map(p => p.vix).filter(Boolean);
            const ivPctl = BS.ivPercentile(STATE.live.vix, vixHistory);
            const spots = { bnfSpot: STATE.live.bnfSpot, nfSpot: STATE.live.nfSpot, vix: STATE.live.vix };

            const posBnfCands = generateCandidates(STATE.bnfChain, spots.bnfSpot, 'BNF', STATE.bnfExpiry, spots.vix, positioningBias, ivPctl);
            const posNfCands = generateCandidates(STATE.nfChain, spots.nfSpot, 'NF', STATE.nfExpiry, spots.vix, positioningBias, ivPctl);
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
        try { window.NativeBridge.sendNotification(title, body, type); } catch (e) { }
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
    if (STATE.isWatching) return;
    STATE.isWatching = true;
    STATE.lastRoutineNotify = Date.now();

    // Start native foreground service (keeps app alive in APK)
    if (window.NativeBridge && window.NativeBridge.isNative()) {
        try { window.NativeBridge.startMarketService(); } catch (e) { }
    }

    // Request notification permission
    if ('Notification' in window && Notification.permission === 'default') {
        Notification.requestPermission();
    }

    // Run first poll immediately (don't wait 5 min)
    setTimeout(async () => {
        if (API.isMarketHours()) {
            await lightFetch();
        }
    }, 3000);

    STATE.pollTimer = setInterval(async () => {
        if (!API.isMarketHours()) {
            // Auto-stop polling — market is closed, don't waste battery
            clearInterval(STATE.pollTimer);
            STATE.pollTimer = null;
            STATE.isWatching = false;
            const el = document.getElementById('watch-status');
            if (el) el.textContent = '⏹ Market closed — polling stopped';
            const stopBtn = document.getElementById('btn-stop');
            if (stopBtn) stopBtn.style.display = 'none';
            document.getElementById('footer-status').textContent =
                `🔴 ${new Date().toLocaleTimeString('en-IN', { timeZone: 'Asia/Kolkata', hour: '2-digit', minute: '2-digit', hour12: true })} · Polls: ${STATE.pollCount} · Market closed`;
            return;
        }
        const el = document.getElementById('watch-status');
        if (el) el.textContent = '🔴 Polling...';
        await lightFetch();
        if (el) el.textContent = `🟢 Watching · Poll #${STATE.pollCount}`;
    }, C.POLL_INTERVAL_MS);

    const el = document.getElementById('watch-status');
    if (el) el.textContent = '🟢 Watching';
    const stopBtn = document.getElementById('btn-stop');
    if (stopBtn) stopBtn.style.display = 'inline-block';
}

function stopWatchLoop() {
    STATE.isWatching = false;
    if (STATE.pollTimer) { clearInterval(STATE.pollTimer); STATE.pollTimer = null; }

    // Stop native foreground service
    if (window.NativeBridge && window.NativeBridge.isNative()) {
        try { window.NativeBridge.stopMarketService(); } catch (e) { }
    }

    document.getElementById('watch-status').textContent = '⏹ Stopped';
    document.getElementById('btn-stop').style.display = 'none';
}

// ═══════════════════════════════════════════════════════════════
// PYODIDE BRAIN — Python analysis engine in WebAssembly
// Loads async (non-blocking). Runs every poll. Graceful degradation.
// ═══════════════════════════════════════════════════════════════

async function initBrain() {
    // Guard: Pyodide CDN must be loaded
    if (typeof loadPyodide !== 'function') {
        console.warn('[Brain] Pyodide CDN not loaded — brain disabled');
        STATE.brainError = 'Pyodide CDN not loaded';
        return;
    }

    STATE.brainLoadStart = performance.now();
    console.log('[Brain] Loading Pyodide...');

    try {
        STATE._pyodide = await loadPyodide({
            // Minimal packages — no pandas/numpy (saves 40MB+)
            // indexURL defaults to CDN, which auto-detects
        });

        // Load the Python brain code
        STATE._pyodide.runPython(BRAIN_PYTHON);

        STATE.brainReady = true;
        const elapsed = ((performance.now() - STATE.brainLoadStart) / 1000).toFixed(1);
        console.log(`[Brain] Ready in ${elapsed}s`);

        // Run brain immediately if we already have poll data
        if (STATE.pollHistory.length >= 3) {
            await runBrain();
        }

    } catch (err) {
        console.error('[Brain] Init failed:', err);
        STATE.brainError = err.message;
        STATE.brainReady = false;
    }
}

async function runBrain() {
    if (!STATE.brainReady || !STATE._pyodide) return;
    if (STATE.pollHistory.length < 3) return;

    try {
        const py = STATE._pyodide;

        // 1. Poll data — strip per-strike arrays (heavy), keep everything else
        const pollsLite = STATE.pollHistory.map(p => {
            const { bnfS, nfS, ...rest } = p;
            return rest;
        });

        // 2. Closed trades cache — refresh every 10 min
        if (!STATE._brainTradesCache || Date.now() - (STATE._brainTradesCacheTime ?? 0) > 600000) {
            try {
                STATE._brainTradesCache = (await DB.getClosedTrades(50)) || [];
                STATE._brainTradesCacheTime = Date.now();
            } catch (e) { STATE._brainTradesCache = STATE._brainTradesCache || []; }
        }

        // 3. Open trades — slim to essential fields for Python
        const openTradesLite = STATE.openTrades.map(t => ({
            id: t.id, strategy_type: t.strategy_type, sell_strike: t.sell_strike,
            buy_strike: t.buy_strike, index_key: t.index_key, is_credit: t.is_credit,
            current_pnl: t.current_pnl ?? 0, max_profit: t.max_profit ?? 0,
            max_loss: t.max_loss ?? 0, controlIndex: t.controlIndex ?? null,
            entry_vix: t.entry_vix ?? null, trade_mode: t.trade_mode ?? 'swing',
            paper: t.paper ?? false
        }));

        // 4. Candidates — slim to essential fields
        const candsLite = (STATE.watchlist || []).slice(0, 10).map(c => ({
            id: c.id, type: c.type, sellStrike: c.sellStrike, buyStrike: c.buyStrike,
            index: c.index, isCredit: c.isCredit, sigmaOTM: c.sigmaOTM ?? null
        }));

        // 5. Strike OI history — extract OI at traded strikes from full poll data
        const strikeOI = {};
        for (const t of STATE.openTrades) {
            const field = t.index_key === 'NF' ? 'nfS' : 'bnfS';
            strikeOI[t.id] = STATE.pollHistory.slice(-6).map(p => {
                const sellData = (p[field] || []).find(s => s.k === t.sell_strike);
                const buyData = (p[field] || []).find(s => s.k === t.buy_strike);
                return {
                    t: p.t,
                    sellCOI: sellData?.c?.o ?? null, sellPOI: sellData?.p?.o ?? null,
                    buyCOI: buyData?.c?.o ?? null, buyPOI: buyData?.p?.o ?? null
                };
            });
        }

        // Pass all data via globals — safe, no escaping issues
        py.globals.set('_poll_json', JSON.stringify(pollsLite));
        py.globals.set('_trades_json', JSON.stringify(STATE._brainTradesCache));
        py.globals.set('_baseline_json', JSON.stringify({
            vix: STATE.baseline?.vix ?? 15,
            bnfSpot: STATE.baseline?.bnfSpot ?? 50000,
            nfSpot: STATE.baseline?.nfSpot ?? 23000
        }));
        py.globals.set('_open_trades_json', JSON.stringify(openTradesLite));
        py.globals.set('_candidates_json', JSON.stringify(candsLite));
        py.globals.set('_strike_oi_json', JSON.stringify(strikeOI));

        const resultJson = py.runPython(
            'analyze(_poll_json, _trades_json, _baseline_json, _open_trades_json, _candidates_json, _strike_oi_json)'
        );
        const result = JSON.parse(resultJson);

        if (result && typeof result === 'object') {
            // Dedup notifications — only NEW high-strength insights across ALL categories
            const prevKeys = new Set();
            const prev = STATE.brainInsights;
            [...(prev?.market || []), ...(prev?.timing || []), ...(prev?.risk || [])].forEach(i => prevKeys.add((i.type || '') + '|' + (i.label || '')));
            for (const tid in (prev?.positions || {})) (prev.positions[tid] || []).forEach(i => prevKeys.add((i.type || '') + '|' + (i.label || '')));

            const allNew = [...(result.market || []), ...(result.timing || []), ...(result.risk || [])];
            for (const tid in (result.positions || {})) allNew.push(...(result.positions[tid] || []));
            for (const ins of allNew) {
                const key = (ins.type || '') + '|' + (ins.label || '');
                if (ins.strength >= 4 && !prevKeys.has(key)) {
                    addNotificationLog(`🧠 ${ins.label}`, ins.detail, ins.strength >= 5 ? 'urgent' : 'important');
                }
            }

            STATE.brainInsights = result;
            STATE.brainLastRun = Date.now();
            STATE.brainError = null;

            // Level 1: Re-rank candidates based on brain intelligence
            applyBrainScores();
        }

    } catch (err) {
        console.warn('[Brain] Run error:', err.message);
        STATE.brainError = err.message;
    }
}

// ═══ TRADE MODE TOGGLE — Intraday vs Swing ═══
function toggleTradeMode() {
    STATE.tradeMode = STATE.tradeMode === 'swing' ? 'intraday' : 'swing';
    // Persist mode
    const currentTheme = document.body.classList.contains('dark') ? 'dark' : 'light';
    DB.setConfig('settings', { theme: currentTheme, tradeMode: STATE.tradeMode });
    // Regenerate candidates with new mode (contextScore + gamma block change)
    if (STATE.bnfChain && STATE.nfChain && STATE.live?.bias) {
        const vix = STATE.live.vix;
        const ivPctl = STATE.live.ivPercentile;
        const bnfCands = generateCandidates(STATE.bnfChain, STATE.live.bnfSpot, 'BNF', STATE.bnfExpiry, vix, STATE.live.bias, ivPctl);
        const nfCands = STATE.nfChain ? generateCandidates(STATE.nfChain, STATE.live.nfSpot, 'NF', STATE.nfExpiry, vix, STATE.live.bias, ivPctl) : [];
        STATE.candidates = rankCandidates([...bnfCands, ...nfCands]);
        STATE.watchlist = STATE.candidates.filter(c => c.forces.aligned >= 2 && !c.capitalBlocked);
        addNotificationLog('Mode Switch', `Switched to ${STATE.tradeMode.toUpperCase()} mode. ${STATE.candidates.filter(c => !c.capitalBlocked).length} candidates.`, 'info');
    }
    renderWatchlist();
    renderFooter();
}

// ═══ RESCAN STRATEGIES — fetch fresh chains + regenerate candidates ═══
async function rescanStrategies() {
    if (!STATE.baseline || !STATE.bnfExpiry || !STATE.nfExpiry) {
        alert('No live data yet. Run Lock & Scan first.');
        return;
    }

    // ═══ FRESH FETCH — actual live data from Upstox ═══
    const statusEl = document.getElementById('status');
    try {
        if (statusEl) statusEl.textContent = '🔄 Fetching live data...';
        const spots = await API.fetchSpots();
        if (!spots.bnfSpot || !spots.vix) throw new Error('Spots fetch failed');

        const bnfRaw = await API.fetchChain(API.BNF_KEY, STATE.bnfExpiry);
        STATE.bnfChain = API.parseChain(bnfRaw, spots.bnfSpot);

        const nfRaw = await API.fetchChain(API.NF_KEY, STATE.nfExpiry);
        STATE.nfChain = API.parseChain(nfRaw, spots.nfSpot);

        // Update live state with fresh data
        STATE.live = {
            ...STATE.live,
            nfSpot: spots.nfSpot, bnfSpot: spots.bnfSpot, vix: spots.vix,
            pcr: STATE.bnfChain.pcr, nearAtmPCR: STATE.bnfChain.nearAtmPCR,
            maxPainBnf: STATE.bnfChain.maxPain, futuresPremBnf: STATE.bnfChain.futuresPremium,
            bnfAtmIv: STATE.bnfChain.atmIv,
            bnfCallWall: STATE.bnfChain.callWallStrike, bnfCallWallOI: STATE.bnfChain.callWallOI,
            bnfPutWall: STATE.bnfChain.putWallStrike, bnfPutWallOI: STATE.bnfChain.putWallOI,
            nfAtmIv: STATE.nfChain.atmIv, nfPcr: STATE.nfChain.pcr,
            futuresPremNf: STATE.nfChain.futuresPremium,
            timestamp: Date.now()
        };

        // Recompute bias with fresh chain data
        const biasResult = computeBias(STATE.morningInput, {
            pcr: STATE.bnfChain.pcr,
            nearAtmPCR: STATE.bnfChain.nearAtmPCR,
            vix: spots.vix,
            futuresPremium: STATE.bnfChain.futuresPremium,
            closeChar: STATE.baseline?.closeChar || 0
        });
        STATE.live.bias = biasResult;

        if (statusEl) statusEl.textContent = '';
    } catch (e) {
        if (statusEl) statusEl.textContent = `Rescan error: ${e.message}`;
        console.error('[RESCAN] Fetch failed:', e);
        // Fall through — use whatever STATE has from last poll
    }

    const liveData = STATE.live;
    const liveBias = liveData.bias || STATE.baseline?.bias;
    if (!liveBias) {
        alert('No bias data. Run Lock & Scan first.');
        return;
    }

    // ═══ BIAS PRIORITY: institutional (3:15PM) > drift-overridden (live) > morning (plan) ═══
    const useInstitutional = STATE._captured315pm && STATE.positioningBias;
    const activeBias = useInstitutional ? STATE.positioningBias
        : (STATE.driftOverridden ? liveBias
            : (STATE.morningBias || liveBias));

    if (useInstitutional) {
        addNotificationLog('🔄 Rescan', `Using institutional bias: ${STATE.positioningBias.label}`, 'important');
    } else if (STATE.driftOverridden) {
        addNotificationLog('🔄 Rescan', `Using live bias (drift override): ${liveBias.label}`, 'important');
    } else if (STATE.morningBias) {
        addNotificationLog('🔄 Rescan', `Using morning plan: ${STATE.morningBias.label}${STATE.biasDrift ? ` (drift ${STATE.biasDrift > 0 ? '+' : ''}${STATE.biasDrift})` : ''}`, 'important');
    }

    const vixHistory = STATE.premiumHistory.map(p => p.vix).filter(Boolean);
    const ivPctl = BS.ivPercentile(liveData.vix, vixHistory);

    const bnfCandidates = generateCandidates(
        STATE.bnfChain, liveData.bnfSpot, 'BNF', STATE.bnfExpiry, liveData.vix, activeBias, ivPctl
    );
    const nfCandidates = generateCandidates(
        STATE.nfChain, liveData.nfSpot, 'NF', STATE.nfExpiry, liveData.vix, activeBias, ivPctl
    );

    const allCandidates = [...bnfCandidates, ...nfCandidates];
    STATE.candidates = rankCandidates(allCandidates);
    STATE.watchlist = STATE.candidates.slice(0, 6);

    // Add diverse picks to watchlist for live updates
    const seenIds = new Set(STATE.watchlist.map(c => c.id));
    for (const index of ['BNF', 'NF']) {
        const seen = new Set();
        for (const c of STATE.candidates.filter(c => c.index === index && !c.capitalBlocked)) {
            if (!seen.has(c.type) && !seenIds.has(c.id)) {
                seen.add(c.type);
                seenIds.add(c.id);
                STATE.watchlist.push(c);
            }
            if (seen.size >= 5) break;
        }
    }

    // ═══ PHASE 8: Also regenerate positioning candidates if they exist ═══
    if (STATE._captured315pm && STATE.positioningBias) {
        const posBnf = generateCandidates(STATE.bnfChain, liveData.bnfSpot, 'BNF', STATE.bnfExpiry, liveData.vix, STATE.positioningBias, ivPctl);
        const posNf = generateCandidates(STATE.nfChain, liveData.nfSpot, 'NF', STATE.nfExpiry, liveData.vix, STATE.positioningBias, ivPctl);
        STATE.positioningCandidates = applyFreeCapitalFilter(rankCandidates([...posBnf, ...posNf])).slice(0, 10);
    }

    const biasSource = useInstitutional ? '(institutional)' : STATE.driftOverridden ? '(drift override)' : STATE.morningBias ? '(morning plan)' : '';
    addNotificationLog('🔄 Rescan Complete', `${allCandidates.length} candidates. BNF ${liveData.bnfSpot?.toFixed(0)} NF ${liveData.nfSpot?.toFixed(0)} VIX ${liveData.vix?.toFixed(1)} ${biasSource}`, 'important');
    console.log(`[RESCAN] ${allCandidates.length} candidates, ${STATE.candidates.length} ranked, spot BNF=${liveData.bnfSpot} NF=${liveData.nfSpot} ${biasSource}`);
    renderAll();
}


// ═══════════════════════════════════════════════════════════════
// TRADE MANAGEMENT
// ═══════════════════════════════════════════════════════════════

// ═══ PAPER TRADE LIMIT — max 2 per index (2 NF + 2 BNF = 4 total) ═══
function canPaperTrade(indexKey) {
    const paperCount = STATE.openTrades.filter(t => t.paper && t.index_key === indexKey).length;
    return paperCount < 2;
}
function paperTradeCount() {
    return STATE.openTrades.filter(t => t.paper).length;
}

async function takeTrade(candidateId, isPaper = false) {
    const cand = STATE.watchlist.find(c => c.id === candidateId)
        || STATE.candidates.find(c => c.id === candidateId)
        || STATE.positioningCandidates.find(c => c.id === candidateId);
    if (!cand) { console.warn('takeTrade: candidate not found:', candidateId); return; }

    // Paper trade limit enforcement
    if (isPaper && !canPaperTrade(cand.index)) {
        alert(`❌ Paper trade limit reached for ${cand.index} (max 2). Close one first.`);
        return;
    }
    // Real trade: confirm
    if (!isPaper && !confirm(`📌 REAL TRADE: ${cand.index} ${friendlyType(cand.type)} ${cand.sellStrike}/${cand.buyStrike}\nThis will count as a real trade. Proceed?`)) {
        return;
    }

    // Determine candidate rank
    const rankList = STATE.candidates.filter(c => c.index === cand.index && !c.capitalBlocked && c.forces.aligned >= 2);
    const candRank = rankList.findIndex(c => c.id === cand.id) + 1;

    const isBNF = cand.index === 'BNF';
    const chain = isBNF ? STATE.bnfChain : STATE.nfChain;
    const spot = isBNF ? STATE.live.bnfSpot : STATE.live.nfSpot;
    const daily1Sigma = spot * (STATE.live.vix / 100) * Math.sqrt(1 / 252);

    const trade = {
        strategy_type: cand.type,
        index_key: cand.index,
        expiry: cand.expiry,
        entry_date: new Date().toISOString(),
        entry_spot: spot,
        entry_vix: STATE.live.vix,
        entry_atm_iv: isBNF ? STATE.live.bnfAtmIv : STATE.live.nfAtmIv,
        entry_premium: cand.netPremium,
        width: cand.width,
        sell_strike: cand.sellStrike,
        sell_type: cand.sellType,
        sell_ltp: cand.sellLTP,
        buy_strike: cand.buyStrike,
        buy_type: cand.buyType,
        buy_ltp: cand.buyLTP,
        max_profit: cand.maxProfit,
        max_loss: cand.maxLoss,
        is_credit: cand.isCredit,
        force_alignment: cand.forces.aligned,
        force_f1: cand.forces.f1,
        force_f2: cand.forces.f2,
        force_f3: cand.forces.f3,
        entry_pcr: isBNF ? STATE.live.pcr : (STATE.live.nfPcr || STATE.nfChain?.pcr),
        entry_futures_premium: isBNF ? STATE.live.futuresPremBnf : (STATE.live.futuresPremNf || STATE.nfChain?.futuresPremium),
        entry_max_pain: isBNF ? (STATE.live.maxPainBnf ?? STATE.bnfChain?.maxPain) : (STATE.nfChain?.maxPain ?? STATE.baseline?.maxPainNf),
        entry_sell_oi: (() => { return chain?.strikes[cand.sellStrike]?.[cand.sellType]?.oi ?? null; })(),
        entry_bias: STATE.live.bias?.label,
        entry_bias_net: STATE.live.bias?.net,
        entry_regime: STATE.institutionalRegime?.regime || null,
        entry_credit_confidence: STATE.institutionalRegime?.creditConfidence || null,
        entry_wall_score: cand.wallScore ?? null,
        entry_gamma_risk: cand.gammaRisk ?? null,
        entry_dii_cash: parseFloat(STATE.morningInput?.diiCash) || null,
        entry_absorption_ratio: STATE.institutionalRegime?.absorptionRatio ?? null,
        entry_gap_sigma: STATE.gapInfo?.sigma ?? null,
        entry_gap_type: STATE.gapInfo?.type || null,
        prob_profit: cand.probProfit,
        status: 'OPEN',
        current_pnl: 0,
        peak_pnl: 0,
        lots: 1,
        paper: isPaper,
        trade_mode: STATE.tradeMode || 'swing',

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
            buy_oi: chain?.strikes[cand.buyStrike]?.[cand.buyType]?.oi ?? null,
            sigma_from_atm: daily1Sigma > 0 ? +((Math.abs(cand.sellStrike - spot)) / daily1Sigma).toFixed(2) : null,
            // Market environment
            near_atm_pcr: isBNF ? STATE.live.nearAtmPCR : (STATE.live.nfNearAtmPCR || STATE.nfChain?.nearAtmPCR),
            iv_percentile: STATE.live.ivPercentile ?? null,
            spot_sigma: STATE.live.spotSigma ?? null,
            vix_sigma: STATE.live.vixSigma ?? null,
            vix_direction: STATE.yesterdayHistory?.[0]?.vix ? +(STATE.live.vix - STATE.yesterdayHistory[0].vix).toFixed(2) : null,
            // OI structure
            call_wall: isBNF ? STATE.live.bnfCallWall : (STATE.nfChain?.callWallStrike ?? null),
            call_wall_oi: isBNF ? STATE.live.bnfCallWallOI : (STATE.nfChain?.callWallOI ?? null),
            put_wall: isBNF ? STATE.live.bnfPutWall : (STATE.nfChain?.putWallStrike ?? null),
            put_wall_oi: isBNF ? STATE.live.bnfPutWallOI : (STATE.nfChain?.putWallOI ?? null),
            max_pain_dist: (() => {
                const mp = isBNF ? (STATE.live.maxPainBnf || STATE.bnfChain?.maxPain) : (STATE.nfChain?.maxPain || null);
                return mp ? Math.round(spot - mp) : null;
            })(),
            total_call_oi: isBNF ? STATE.live.bnfTotalCallOI : (STATE.nfChain?.totalCallOI ?? null),
            total_put_oi: isBNF ? STATE.live.bnfTotalPutOI : (STATE.nfChain?.totalPutOI ?? null),
            // Institutional
            regime: STATE.institutionalRegime?.regime || null,
            regime_detail: STATE.institutionalRegime?.regimeDetail || null,
            fii_deriv_net: STATE.institutionalRegime ? (parseFloat(STATE.morningInput?.fiiIdxFut || 0) + parseFloat(STATE.morningInput?.fiiStkFut || 0)) : null,
            absorption_ratio: STATE.institutionalRegime?.absorptionRatio ?? null,
            contrarian_pcr: STATE.contrarianPCR?.signal || null,
            // Bias detail — all 7 signal votes
            bias_signals: STATE.live.bias?.signals?.map(s => ({ n: s.name, d: s.dir, v: s.value })) || [],
            morning_bias: STATE.morningBias?.label || null,
            bias_drift: STATE.biasDrift ?? 0,
            upstox_agrees: STATE.live.bias?.upstoxAgrees ?? null,
            // Breadth
            bnf_breadth_pct: STATE.bnfBreadth?.pct ?? null,
            nf50_advancing: STATE.nf50Breadth?.advancing ?? null,
            // Global
            dow_close: STATE.globalDirection?.dowClose ?? null,
            crude_settle: STATE.globalDirection?.crudeSettle ?? null,
            gap_type: STATE.gapInfo?.type || null,
            gap_pts: STATE.gapInfo?.points ?? null,
            gap_sigma: STATE.gapInfo?.sigma ?? null,
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
        STATE.openTrades.push(trade);
        playSound('entry');
        switchTab('positions');
        renderAll();
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
            trade_mode: trade.trade_mode
        };
        const retry = await DB.insertTrade(essentialTrade);
        if (retry) {
            trade.id = retry.id;
            STATE.openTrades.push(trade);
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
            }).catch(() => { });
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
        entry_spot: indexKey === 'BNF' ? (STATE.live?.bnfSpot || STATE.baseline?.bnfSpot) : (STATE.live?.nfSpot || STATE.baseline?.nfSpot),
        entry_vix: STATE.live?.vix || STATE.baseline?.vix,
        entry_atm_iv: indexKey === 'BNF' ? (STATE.live?.bnfAtmIv || STATE.baseline?.bnfAtmIv) : (STATE.live?.nfAtmIv || STATE.baseline?.nfAtmIv),
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
        force_alignment: STATE.live?.bias ? getForceAlignment(type, STATE.live.bias, STATE.live.vix, STATE.live.ivPercentile).aligned : 0,
        force_f1: STATE.live?.bias ? getForceAlignment(type, STATE.live.bias, STATE.live.vix, STATE.live.ivPercentile).f1 : 0,
        force_f2: STATE.live?.bias ? getForceAlignment(type, STATE.live.bias, STATE.live.vix, STATE.live.ivPercentile).f2 : 0,
        force_f3: STATE.live?.bias ? getForceAlignment(type, STATE.live.bias, STATE.live.vix, STATE.live.ivPercentile).f3 : 0,
        entry_pcr: indexKey === 'BNF' ? (STATE.live?.pcr || STATE.baseline?.pcr) : (STATE.nfChain?.pcr || null),
        entry_futures_premium: indexKey === 'BNF' ? (STATE.live?.futuresPremBnf || STATE.baseline?.futuresPremBnf) : (STATE.nfChain?.futuresPremium || null),
        entry_max_pain: indexKey === 'BNF' ? (STATE.live?.maxPainBnf ?? STATE.bnfChain?.maxPain) : (STATE.nfChain?.maxPain ?? null),
        entry_sell_oi: (() => { const ch = indexKey === 'BNF' ? STATE.bnfChain : STATE.nfChain; return ch?.strikes[sellStrike]?.[sellType]?.oi ?? null; })(),
        entry_bias: STATE.live?.bias?.label || STATE.baseline?.bias?.label,
        entry_bias_net: STATE.live?.bias?.net || STATE.baseline?.bias?.net,
        entry_regime: STATE.institutionalRegime?.regime || null,
        entry_credit_confidence: STATE.institutionalRegime?.creditConfidence || null,
        entry_wall_score: null, // manual trade — no candidate wall score
        entry_gamma_risk: null, // manual trade — no candidate gamma
        entry_dii_cash: parseFloat(STATE.morningInput?.diiCash) || null,
        entry_absorption_ratio: STATE.institutionalRegime?.absorptionRatio ?? null,
        entry_gap_sigma: STATE.gapInfo?.sigma ?? null,
        entry_gap_type: STATE.gapInfo?.type || null,
        status: 'OPEN',
        current_pnl: 0,
        peak_pnl: 0,
        lots: 1,
        paper: isPaper,
        trade_mode: tradeMode,

        // ═══ MANUAL TRADE SNAPSHOT — market environment (no candidate data) ═══
        entry_snapshot: {
            candidate_rank: null,
            varsity_tier: null,
            context_score: null,
            ev: null,
            manual_entry: true,
            near_atm_pcr: indexKey === 'BNF' ? STATE.live?.nearAtmPCR : (STATE.nfChain?.nearAtmPCR ?? null),
            iv_percentile: STATE.live?.ivPercentile ?? null,
            spot_sigma: STATE.live?.spotSigma ?? null,
            vix_direction: STATE.yesterdayHistory?.[0]?.vix ? +(STATE.live?.vix - STATE.yesterdayHistory[0].vix).toFixed(2) : null,
            call_wall: indexKey === 'BNF' ? STATE.live?.bnfCallWall : (STATE.nfChain?.callWallStrike ?? null),
            put_wall: indexKey === 'BNF' ? STATE.live?.bnfPutWall : (STATE.nfChain?.putWallStrike ?? null),
            bias_signals: STATE.live?.bias?.signals?.map(s => ({ n: s.name, d: s.dir, v: s.value })) || [],
            morning_bias: STATE.morningBias?.label || null,
            bias_drift: STATE.biasDrift ?? 0,
            regime: STATE.institutionalRegime?.regime || null,
            bnf_breadth_pct: STATE.bnfBreadth?.pct ?? null,
            dow_close: STATE.globalDirection?.dowClose ?? null,
            crude_settle: STATE.globalDirection?.crudeSettle ?? null,
            gap_sigma: STATE.gapInfo?.sigma ?? null,
            minutes_since_open: API.minutesSinceOpen() ?? null,
            // Cost & calibration
            event_driven: document.getElementById('mt-event')?.checked || false
        }
    };

    const saved = await DB.insertTrade(trade);
    if (saved) {
        trade.id = saved.id;
        STATE.openTrades.push(trade);
        playSound('entry');
        switchTab('positions');
        renderAll();
        if (!STATE.isWatching) startWatchLoop();
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
            STATE.openTrades.push(trade);
            playSound('entry');
            switchTab('positions');
            renderAll();
            if (!STATE.isWatching) startWatchLoop();
            // Try to add full snapshot (non-blocking)
            DB.updateTrade(retry.id, {
                force_f1: trade.force_f1, force_f2: trade.force_f2, force_f3: trade.force_f3,
                entry_pcr: trade.entry_pcr, entry_bias_net: trade.entry_bias_net,
                entry_snapshot: trade.entry_snapshot
            }).catch(() => { });
        } else {
            alert('❌ Manual trade log failed! Check Debug panel for error.');
        }
    }
}

async function closeTrade(tradeId, exitReason) {
    const trade = STATE.openTrades.find(t => String(t.id) === String(tradeId));
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
        const chain = isBNF ? STATE.bnfChain : STATE.nfChain;
        const minsOpen = typeof API?.minutesSinceOpen === 'function' ? API.minutesSinceOpen() : null;

        await DB.updateTrade(trade.id, {
            status: 'CLOSED',
            exit_date: new Date().toISOString(),
            actual_pnl: trade.current_pnl ?? 0,
            exit_premium: trade.current_premium ?? null,
            exit_reason: exitReason || 'Manual',
            exit_vix: STATE.live?.vix ?? trade.current_vix ?? null,
            exit_atm_iv: isBNF ? (STATE.live?.bnfAtmIv ?? null) : (STATE.live?.nfAtmIv ?? STATE.nfChain?.atmIv ?? null),
            exit_force_alignment: trade.forces?.aligned ?? trade.force_alignment ?? null,
            exit_hold_minutes: trade.entry_date ? Math.floor((Date.now() - new Date(trade.entry_date).getTime()) / 60000) : null,
            exit_spot: trade.current_spot ?? null,
            exit_pcr: isBNF ? (STATE.live?.nearAtmPCR ?? STATE.live?.pcr ?? null) : (STATE.live?.nfNearAtmPCR ?? STATE.nfChain?.nearAtmPCR ?? null),
            exit_bias: STATE.live?.bias?.label ?? null,
            trough_pnl: trade.trough_pnl ?? null,
            poll_count: trade.poll_count ?? null,

            // ═══ EXIT SNAPSHOT — full market state at close (JSONB) ═══
            exit_snapshot: {
                spot: trade.current_spot ?? null,
                vix: STATE.live?.vix ?? trade.current_vix ?? null,
                atm_iv: isBNF ? (STATE.live?.bnfAtmIv ?? null) : (STATE.live?.nfAtmIv ?? null),
                near_atm_pcr: isBNF ? (STATE.live?.nearAtmPCR ?? null) : (STATE.live?.nfNearAtmPCR ?? STATE.nfChain?.nearAtmPCR ?? null),
                futures_premium: isBNF ? (STATE.live?.futuresPremBnf ?? null) : (STATE.live?.futuresPremNf ?? null),
                iv_percentile: STATE.live?.ivPercentile ?? null,
                call_wall: isBNF ? (STATE.live?.bnfCallWall ?? null) : (STATE.nfChain?.callWallStrike ?? null),
                put_wall: isBNF ? (STATE.live?.bnfPutWall ?? null) : (STATE.nfChain?.putWallStrike ?? null),
                max_pain: isBNF ? (STATE.live?.maxPainBnf ?? null) : (STATE.nfChain?.maxPain ?? null),
                sell_oi: chain?.strikes?.[trade.sell_strike]?.[trade.sell_type]?.oi ?? null,
                bias: STATE.live?.bias?.label ?? null,
                bias_net: STATE.live?.bias?.net ?? null,
                bias_signals: STATE.live?.bias?.signals?.map(s => ({ n: s.name, d: s.dir })) || [],
                force_f1: trade.forces?.f1 ?? trade.force_f1 ?? null,
                force_f2: trade.forces?.f2 ?? trade.force_f2 ?? null,
                force_f3: trade.forces?.f3 ?? trade.force_f3 ?? null,
                regime: STATE.institutionalRegime?.regime ?? null,
                spot_sigma: STATE.live?.spotSigma ?? null,
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
        STATE.openTrades = STATE.openTrades.filter(t => String(t.id) !== String(tradeId));
        renderAll();
    } catch (err) {
        console.error('closeTrade error:', err);
        alert(`Exit failed: ${err.message}. Try closing via Supabase SQL.`);
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
    const bi = STATE.brainInsights;
    const market = bi?.market || [];
    const timing = bi?.timing || [];
    const risk = bi?.risk || [];
    const all = [...market, ...timing, ...risk];

    if (!all.length && !STATE.brainReady && !STATE.brainError) {
        if (STATE.pollCount > 0 && typeof loadPyodide === 'function') {
            return `<div class="brain-section"><div class="brain-header">🧠 Brain</div><div class="brain-loading">Loading Python engine...</div></div>`;
        }
        return '';
    }
    if (!all.length) return '';

    const age = STATE.brainLastRun > 0 ? Math.round((Date.now() - STATE.brainLastRun) / 1000) : null;
    const ageText = age !== null ? (age < 60 ? `${age}s ago` : `${Math.round(age / 60)}m ago`) : '';

    // Sort: risk first (most important), then high-strength market, then timing
    const sorted = [...risk, ...market.filter(i => i.strength >= 3), ...timing, ...market.filter(i => i.strength < 3)];

    return `<div class="brain-section">
        <div class="brain-header">🧠 Brain <span class="brain-meta">${all.length} insights · ${ageText}</span></div>
        ${sorted.map(renderBrainCard).join('')}
    </div>`;
}

function renderBrainForTrade(tradeId) {
    const insights = STATE.brainInsights?.positions?.[tradeId];
    if (!insights || !insights.length) return '';
    return `<div class="brain-section" style="margin:6px 0 2px">${insights.map(renderBrainCard).join('')}</div>`;
}

function renderBrainForCandidate(candId) {
    const insights = STATE.brainInsights?.candidates?.[candId];
    if (!insights || !insights.length) return '';
    return `<div class="brain-section" style="margin:4px 0 2px">${insights.map(renderBrainCard).join('')}</div>`;
}

function renderAll() {
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

    const l = STATE.live || STATE.baseline;
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
    for (const t of STATE.openTrades) {
        if (!t.paper) marginUsed += t.max_loss || 0; // Paper trades don't block real margin
    }
    const available = C.CAPITAL - marginUsed;

    if (capEl) capEl.textContent = `₹${(C.CAPITAL / 1000).toFixed(1)}K`;
    if (marginEl) marginEl.textContent = marginUsed > 0 ? `Blocked: ₹${(marginUsed / 1000).toFixed(1)}K · Free: ₹${(available / 1000).toFixed(1)}K` : `Free: ₹${(C.CAPITAL / 1000).toFixed(1)}K`;

    if (pnlEl && STATE.openTrades.length > 0) {
        const realTrades = STATE.openTrades.filter(t => !t.paper);
        const paperTrades = STATE.openTrades.filter(t => t.paper);
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

function renderDebug() {
    const el = document.getElementById('debug-log');
    if (!el) return;

    const debugEntries = window._API_DEBUG || [];
    if (debugEntries.length === 0) {
        el.innerHTML = '<div class="empty-state">Debug data appears after scan</div>';
        return;
    }

    // Also add app-level state debug
    const stateInfo = [];
    if (STATE.baseline) {
        stateInfo.push({
            time: '', label: 'APP_STATE',
            baseline: 'SET',
            candidates: STATE.candidates.length,
            watchlist: STATE.watchlist.length,
            openTrades: STATE.openTrades.length,
            premiumHistoryDays: STATE.premiumHistory.length,
            ivPercentile: STATE.baseline.ivPercentile,
            isWatching: STATE.isWatching,
            pollCount: STATE.pollCount
        });
    }
    // Brain debug
    const bdi = STATE.brainInsights || {};
    const bdiTotal = (bdi.market || []).length + (bdi.timing || []).length + (bdi.risk || []).length
        + Object.values(bdi.positions || {}).reduce((s, a) => s + a.length, 0)
        + Object.values(bdi.candidates || {}).reduce((s, a) => s + a.length, 0);
    stateInfo.push({
        time: '', label: 'BRAIN',
        ready: STATE.brainReady,
        insights: `${bdiTotal} (mkt:${(bdi.market || []).length} pos:${Object.keys(bdi.positions || {}).length} cand:${Object.keys(bdi.candidates || {}).length} time:${(bdi.timing || []).length} risk:${(bdi.risk || []).length})`,
        lastRun: STATE.brainLastRun > 0 ? new Date(STATE.brainLastRun).toLocaleTimeString('en-IN', { timeZone: 'Asia/Kolkata', hour: '2-digit', minute: '2-digit' }) : 'never',
        error: STATE.brainError || 'none',
        loadTime: STATE.brainLoadStart > 0 && STATE.brainReady ? ((performance.now() - STATE.brainLoadStart) / 1000).toFixed(1) + 's' : 'n/a'
    });

    const allEntries = [...stateInfo, ...debugEntries].reverse(); // newest first

    el.innerHTML = allEntries.map(entry => {
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
    const polls = STATE.pollHistory;
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
    for (const t of STATE.openTrades) {
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
        const dailySigma = spot * ((STATE.live?.vix || 20) / 100) * Math.sqrt(1 / 252);
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
    if (!el || !STATE.live) return;

    const l = STATE.live;
    const b = STATE.baseline;
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
    const yday = STATE.yesterdayHistory?.length > 0 ? STATE.yesterdayHistory[0] : null;
    let ydayComparisons = '';
    if (yday) {
        const items = [];
        if (yday.fii_cash != null && STATE.morningInput?.fiiCash) {
            const diff = parseFloat(STATE.morningInput.fiiCash) - yday.fii_cash;
            items.push(`FII: ₹${yday.fii_cash}→₹${STATE.morningInput.fiiCash} (${diff > 0 ? '+' : ''}${diff.toFixed(0)})`);
        }
        if (yday.fii_short_pct != null && STATE.morningInput?.fiiShortPct) {
            const diff = parseFloat(STATE.morningInput.fiiShortPct) - yday.fii_short_pct;
            items.push(`Short%: ${yday.fii_short_pct}→${STATE.morningInput.fiiShortPct} (${diff > 0 ? '+' : ''}${diff.toFixed(1)})`);
        }
        if (yday.pcr != null && l.pcr) {
            const diff = l.pcr - yday.pcr;
            items.push(`PCR: ${yday.pcr.toFixed(2)}→${l.pcr.toFixed(2)} (${diff > 0 ? '+' : ''}${diff.toFixed(2)})`);
        }
        if (yday.bnf_spot != null && l.bnfSpot) {
            const diff = l.bnfSpot - yday.bnf_spot;
            items.push(`BNF: ${yday.bnf_spot.toFixed(0)}→${l.bnfSpot.toFixed(0)} (${diff > 0 ? '+' : ''}${diff.toFixed(0)})`);
        }
        if (yday.dii_cash != null && STATE.morningInput?.diiCash) {
            const diff = parseFloat(STATE.morningInput.diiCash) - yday.dii_cash;
            items.push(`DII: ₹${yday.dii_cash}→₹${STATE.morningInput.diiCash} (${diff > 0 ? '+' : ''}${diff.toFixed(0)})`);
        }
        if (yday.fii_stk_fut != null && STATE.morningInput?.fiiStkFut) {
            const diff = parseFloat(STATE.morningInput.fiiStkFut) - yday.fii_stk_fut;
            items.push(`FII Stk Fut: ₹${yday.fii_stk_fut}→₹${STATE.morningInput.fiiStkFut} (${diff > 0 ? '+' : ''}${diff.toFixed(0)})`);
        }
        ydayComparisons = items.map(i => `<span class="signal-chip signal-neutral">${i}</span>`).join('');
    }

    const scanTime = API.istNow();

    el.innerHTML = `
        <!-- TIMESTAMP -->
        <div class="section-timestamp">Scanned: ${scanTime}${STATE.pollCount > 0 ? ` · Poll #${STATE.pollCount}` : ''}</div>

        <!-- INTRADAY CHART — spot + VIX from poll history (b68) -->
        ${renderIntradayChart(STATE._chartIndex || 'NF')}

        <!-- VERDICT -->
        <div class="env-verdict ${verdictClass}">${verdict}</div>

        <!-- INSTITUTIONAL REGIME — collapsible -->
        ${STATE.institutionalRegime ? `
        <details>
            <summary style="cursor:pointer;font-size:13px;font-weight:600;color:${STATE.institutionalRegime.regimeColor};padding:6px 0;">📊 ${STATE.institutionalRegime.regime} · Confidence: ${STATE.institutionalRegime.creditConfidence}${STATE.institutionalRegime.absorptionRatio !== null ? ` · Absorption: ${STATE.institutionalRegime.absorptionRatio}×` : ''} ▸</summary>
            <div style="border-left: 3px solid ${STATE.institutionalRegime.regimeColor}; padding: 8px 12px; margin: 4px 0; background: var(--bg-input); border-radius: var(--radius-sm);">
                <div style="font-size:12px; color:var(--text-secondary); margin-top:4px;">${STATE.institutionalRegime.regimeDetail}</div>
                <div style="font-size:11px; color:var(--text-muted); margin-top:4px;">
                    FII: ₹${STATE.institutionalRegime.fiiCash}Cr · DII: ₹${STATE.institutionalRegime.diiCash > 0 ? '+' : ''}${STATE.institutionalRegime.diiCash}Cr
                    ${STATE.institutionalRegime.absorptionRatio !== null ? ` · Absorption: ${STATE.institutionalRegime.absorptionRatio}×` : ''}
                    · Idx Fut: ₹${STATE.institutionalRegime.fiiIdxFut}Cr · Stk Fut: ₹${STATE.institutionalRegime.fiiStkFut > 0 ? '+' : ''}${STATE.institutionalRegime.fiiStkFut}Cr
                </div>
            </div>
        </details>
        ` : ''}

        <!-- GAP CLASSIFICATION -->
        ${STATE.gapInfo && STATE.gapInfo.type !== 'UNKNOWN' ? `
        <div class="env-row" style="padding: 6px 0;">
            <span class="env-row-label">Today's Gap</span>
            <span class="env-row-value" style="color: ${STATE.gapInfo.gap > 0 ? 'var(--green)' : STATE.gapInfo.gap < 0 ? 'var(--danger)' : 'var(--text-muted)'}">
                ${STATE.gapInfo.gap > 0 ? '+' : ''}${STATE.gapInfo.gap} pts (${STATE.gapInfo.pct}%, ${STATE.gapInfo.sigma}σ) — ${STATE.gapInfo.type.replace('_', ' ')}
            </span>
        </div>
        ` : ''}

        <!-- OVERNIGHT DELTA — Phase 10: Evening close vs morning inputs -->
        ${STATE.overnightDelta && STATE.overnightDelta.signals.length > 0 ? `
        <div style="padding:6px 10px; margin:4px 0; border-radius:8px; background:${STATE.overnightDelta.summary.includes('BEARISH') ? 'rgba(211,47,47,0.08)' : STATE.overnightDelta.summary.includes('BULLISH') ? 'rgba(56,142,60,0.08)' : 'rgba(128,128,128,0.06)'}; border-left:3px solid ${STATE.overnightDelta.summary.includes('BEARISH') ? 'var(--danger)' : STATE.overnightDelta.summary.includes('BULLISH') ? 'var(--green)' : 'var(--text-muted)'}">
            <div style="font-weight:600; font-size:12px; margin-bottom:3px">${STATE.overnightDelta.summary}</div>
            <div style="font-size:11px; color:var(--text-muted)">
                ${STATE.overnightDelta.signals.map(s => {
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
    if (!el || !STATE.live) return;

    const l = STATE.live;
    const b = STATE.baseline;

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
    const bnfCallOI = STATE.bnfChain?.nearTotalCallOI || l.bnfTotalCallOI || b.bnfTotalCallOI || 0;
    const bnfPutOI = STATE.bnfChain?.nearTotalPutOI || l.bnfTotalPutOI || b.bnfTotalPutOI || 0;
    const bnfTotal = bnfCallOI + bnfPutOI;
    const bnfCPct = bnfTotal > 0 ? Math.round(bnfCallOI / bnfTotal * 100) : 50;
    const bnfFP = l.futuresPremBnf;

    // NF
    const nfc = STATE.nfChain;
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
                    <td class="oi-td-val">CE ${bnfCPct}% / PE ${100 - bnfCPct}%
                        <div class="oi-bar-mini"><div class="oi-bar-fill call" style="width:${bnfCPct}%"></div><div class="oi-bar-fill put" style="width:${100 - bnfCPct}%"></div></div>
                    </td>
                    <td class="oi-td-val">CE ${nfCPct}% / PE ${100 - nfCPct}%
                        <div class="oi-bar-mini"><div class="oi-bar-fill call" style="width:${nfCPct}%"></div><div class="oi-bar-fill put" style="width:${100 - nfCPct}%"></div></div>
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
        ${STATE.bnfBreadth ? `
        <div class="env-row">
            <span class="env-row-label">BNF (5 stocks, 79%)</span>
            <span class="env-row-value" style="color:${STATE.bnfBreadth.weightedPct > 0 ? 'var(--green)' : STATE.bnfBreadth.weightedPct < 0 ? 'var(--danger)' : 'var(--text-muted)'}">
                ${STATE.bnfBreadth.weightedPct > 0 ? '+' : ''}${STATE.bnfBreadth.weightedPct}% · ${STATE.bnfBreadth.advancing}↑ ${STATE.bnfBreadth.declining}↓
            </span>
        </div>
        <div class="env-signals">${(STATE.bnfBreadth.results || []).map(r =>
        `<span class="signal-chip signal-${r.change > 0 ? 'bull' : r.change < 0 ? 'bear' : 'neutral'}">${r.name}: ${r.pctChange > 0 ? '+' : ''}${r.pctChange}%</span>`
    ).join('')}</div>
        ` : ''}
        ${STATE.nf50Breadth ? `
        <div class="env-row">
            <span class="env-row-label">NF50 Breadth</span>
            <span class="env-row-value">${STATE.nf50Breadth.scaled}/50 advancing</span>
        </div>
        ` : ''}

        <!-- INSTITUTIONAL PCR READ — Dynamic context-aware (Phase 8.1) -->
        ${STATE.pcrContext ? (() => {
            const ctx = STATE.pcrContext;
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

        ${STATE.fiiTrend ? `
        <details>
            <summary class="env-section-title" style="cursor:pointer;user-select:none">📊 FII Short% Trend — <span style="color:${STATE.fiiTrend.trend === 'COVERING' ? 'var(--green)' : STATE.fiiTrend.trend === 'BUILDING' ? 'var(--danger)' : 'var(--warn)'}">
                ${STATE.fiiTrend.label}</span> ▸</summary>
            <div class="env-row">
                <span class="env-row-label">3-Session</span>
                <span class="env-row-value" style="color:${STATE.fiiTrend.trend === 'COVERING' ? 'var(--green)' : STATE.fiiTrend.trend === 'BUILDING' ? 'var(--danger)' : 'var(--warn)'}">
                    ${STATE.fiiTrend.label}${STATE.fiiTrend.accel ? ' ACCELERATING' : ''}${STATE.fiiTrend.aggressive ? ' ⚠️ AGGRESSIVE' : ''}
                </span>
            </div>
        </details>
        ` : ''}

        ${STATE.trajectory ? `
        <details class="traj-details">
            <summary>📅 Session Trajectory (${STATE.trajectory.dates?.length || 0} sessions) ▸</summary>
            <div class="traj-grid">
            ${STATE.trajectory.trajectory.map(row =>
            `<div class="traj-row"><span class="traj-label">${row.label}</span>${row.arrows.map(a =>
                `<span class="traj-arrow ${a === '↑' ? 'up' : a === '↓' ? 'down' : ''}">${a}</span>`
            ).join('')}</div>`
        ).join('')}
            </div>
            ${STATE.trajectory.reversal ? `<div class="traj-alert">${STATE.trajectory.reversal}</div>` : ''}
            ${STATE.trajectory.alignment ? `<div class="traj-alert">${STATE.trajectory.alignment}</div>` : ''}
        </details>
        ` : ''}

        ${STATE.signalValidation ? (() => {
            const sv = STATE.signalValidation;
            return `<div class="env-section-title">📡 Yesterday's Signal</div>
            <div class="traj-alert ${sv.correct ? '' : 'warn'}">
                ${sv.predicted} (${sv.strength}/5) → Gap: ${sv.actualGap > 0 ? '+' : ''}${sv.actualGap?.toFixed(0)} pts ${sv.correct ? '✅ CORRECT' : '❌ MISSED'}
                ${STATE.signalAccuracyStats ? ` · Accuracy: ${STATE.signalAccuracyStats.correct}/${STATE.signalAccuracyStats.total} (${STATE.signalAccuracyStats.pct}%)` : ''}
            </div>`;
        })() : ''}

        ${renderPositioning()}
    `;
}

function renderWatchlist() {
    const el = document.getElementById('watchlist');
    if (!el) return;

    if (!STATE.watchlist.length && !STATE.candidates.length) {
        el.innerHTML = '<div class="empty-state">Lock & Scan to generate strategies</div>';
        return;
    }

    const bnfAtm = STATE.bnfChain?.atm || STATE.baseline?.bnfAtm || 0;
    const nfAtm = STATE.nfChain?.atm || STATE.baseline?.nfAtm || 0;

    // Count candidates that ACTUALLY fit market conditions (same filter as diverseTop)
    const executable = STATE.candidates.filter(c =>
        !c.capitalBlocked && c.forces.aligned >= 2 && (c.contextScore || 0) >= -0.3 && c.ev > 0
    ).length;
    const total = STATE.candidates.length;

    // ═══ GO VERDICT BANNER ═══
    const biasLabel = STATE.live?.bias?.label || STATE.baseline?.bias?.label || 'NEUTRAL';
    const vix = STATE.live?.vix || STATE.baseline?.vix || 0;
    const modeLabel = STATE.tradeMode === 'intraday' ? '⚡ INTRADAY' : '📅 SWING';
    const goClass = executable >= 3 ? 'go-banner go-green' : executable >= 1 ? 'go-banner go-yellow' : 'go-banner go-grey';
    const goIcon = executable >= 3 ? '✅' : executable >= 1 ? '🟡' : '⏹';

    // Varsity recommendation
    const biasObj = STATE.live?.bias || STATE.baseline?.bias;
    const varsityInfo = biasObj ? getVarsityFilter(biasObj, vix) : null;
    const varsityLabel = varsityInfo?.primary?.[0] ? friendlyType(varsityInfo.primary[0]) : '';
    const varsityAction = vix >= C.IV_HIGH ? 'SELL premium' : 'BUY premium';

    let html = `<div class="${goClass}">
        <div class="go-title">${goIcon} ${executable >= 1 ? 'GO' : 'WAIT'} · ${modeLabel}</div>
        <div class="go-detail">${executable} fit market (of ${total} generated) · VIX: ${vix.toFixed(1)} · Bias: ${biasLabel}</div>
        ${STATE.morningBias && STATE.live?.bias ? (() => {
            const drift = STATE.biasDrift || 0;
            const driftColor = Math.abs(drift) >= 2 ? 'var(--danger)' : Math.abs(drift) >= 1 ? 'var(--warn)' : 'var(--green)';
            const driftIcon = STATE.driftOverridden ? '⚠️' : Math.abs(drift) >= 1 ? '🔄' : '✅';
            const morningL = STATE.morningBias.label;
            const liveL = STATE.live.bias.label;
            return morningL !== liveL || drift !== 0
                ? `<div class="go-detail" style="font-size:11px; color:${driftColor}">${driftIcon} Morning: ${morningL} · Now: ${liveL} · Drift: ${drift > 0 ? '+' : ''}${drift}${STATE.driftOverridden ? ' · OVERRIDDEN' : ''}</div>`
                : `<div class="go-detail" style="font-size:11px; color:var(--green)">✅ Plan holding: ${morningL}</div>`;
        })() : ''}
        ${varsityLabel ? `<div class="go-detail" style="font-weight:700; margin-top:4px;">📖 Varsity: ${varsityLabel} · ${varsityAction}</div>` : ''}
        ${varsityInfo?.rangeDetected ? `<div class="go-detail" style="font-size:11px; color:var(--green); margin-top:2px;">📊 Range detected (${STATE.rangeSigma}σ) — IB/IC prioritized over directional</div>` : (STATE.pollHistory?.length >= 3 ? `<div class="go-detail" style="font-size:10px; color:var(--text-muted); margin-top:2px;">📊 Trending (${STATE.rangeSigma}σ) — directional strategies active</div>` : '')}
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
    const has315 = STATE._captured315pm && STATE.tomorrowSignal;
    const posOpen = has315 ? 'open' : '';
    const sig = STATE.tomorrowSignal;
    const sigColor = sig ? (sig.signal === 'BEARISH' ? 'var(--danger)' : sig.signal === 'BULLISH' ? 'var(--green)' : 'var(--warn)') : 'var(--text-muted)';

    html += `<details class="positioning-section" ${posOpen}>
        <summary class="positioning-summary">
            ⚡ Position for Tomorrow
            ${sig ? `<span class="pos-signal-badge" style="color:${sigColor}"> · ${sig.signal} (${sig.strength}/5)</span>` : STATE._captured2pm ? ' · ⏳ Awaiting 3:15 PM' : ''}
        </summary>
        <div class="positioning-body">`;

    // Global Direction inputs — Dow Futures Now + Crude Now (morning ref from Lock & Scan)
    const gd = STATE.globalDirection;
    const hasMorningRef = gd.dowClose || gd.crudeSettle;
    const dowPct = (gd.dowClose && gd.dowNow) ? (((gd.dowNow - gd.dowClose) / gd.dowClose) * 100).toFixed(2) : null;
    const crudePct = (gd.crudeSettle && gd.crudeNow) ? (((gd.crudeNow - gd.crudeSettle) / gd.crudeSettle) * 100).toFixed(2) : null;
    const giftDir = STATE.gapInfo?.sigma ? (STATE.gapInfo.sigma > 0.3 ? 'BULL' : STATE.gapInfo.sigma < -0.3 ? 'BEAR' : 'NEUTRAL') : null;
    const dowDir = dowPct !== null ? (dowPct >= C.DOW_THRESHOLD ? 'BULL' : dowPct <= -C.DOW_THRESHOLD ? 'BEAR' : 'NEUTRAL') : null;
    const crudeDir = crudePct !== null ? (crudePct >= C.CRUDE_THRESHOLD ? 'BEAR' : crudePct <= -C.CRUDE_THRESHOLD ? 'BULL' : 'NEUTRAL') : null;
    const dirIcon = (d) => d === 'BULL' ? '🟢' : d === 'BEAR' ? '🔴' : d === 'NEUTRAL' ? '⚪' : '—';

    html += `<div class="global-context-section">
        <div class="gc-title">🌍 Global Direction <span style="color:var(--danger);font-size:11px">(enter live values)</span></div>
        ${!hasMorningRef ? '<div style="color:var(--warn);font-size:11px;margin-bottom:6px">⚠️ Enter Dow Close & Crude Settle in morning inputs first</div>' : ''}
        <div class="global-context-grid">
            <div class="input-group compact">
                <label>Dow Now</label>
                <input type="text" inputmode="text" id="in-dow-now" class="input-field input-sm" placeholder="46120"
                    value="${gd.dowNow ?? ''}">
                ${dowPct !== null ? `<div style="font-size:10px;color:${dowPct < 0 ? 'var(--danger)' : dowPct > 0 ? 'var(--green)' : 'var(--text-muted)'}">${dowPct > 0 ? '+' : ''}${dowPct}% ${dirIcon(dowDir)}</div>` : ''}
            </div>
            <div class="input-group compact">
                <label>Crude Now</label>
                <input type="text" inputmode="text" id="in-crude-now" class="input-field input-sm" placeholder="98.1"
                    value="${gd.crudeNow ?? ''}">
                ${crudePct !== null ? `<div style="font-size:10px;color:${crudePct > 0 ? 'var(--danger)' : crudePct < 0 ? 'var(--green)' : 'var(--text-muted)'}">${crudePct > 0 ? '+' : ''}${crudePct}% ${dirIcon(crudeDir)} India</div>` : ''}
            </div>
        </div>
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
            for (const t of STATE.openTrades) {
                if (!t.paper) marginUsed += t.max_loss || 0; // Paper trades don't block real capital
            }
            const freeCapital = C.CAPITAL - marginUsed;
            const minPeakNeeded = STATE.positioningCandidates.length > 0 ? peakCash(STATE.positioningCandidates[STATE.positioningCandidates.length - 1]) : 0;

            if (freeCapital < minPeakNeeded) {
                html += `<div class="positioning-gate" style="color:var(--warn)">⚠️ Free capital ₹${(freeCapital / 1000).toFixed(1)}K — may not cover buy leg ₹${(minPeakNeeded / 1000).toFixed(1)}K.</div>`;
            }

            const posBnf = STATE.positioningCandidates.filter(c => c.index === 'BNF').slice(0, 3);
            const posNf = STATE.positioningCandidates.filter(c => c.index === 'NF' && !c.capitalBlocked).slice(0, 2);
            if (posBnf.length) {
                html += '<div class="strat-header">BNF — POSITIONING</div>';
                posBnf.forEach((c, i) => { html += renderCandidateCard(c, bnfAtm, i + 1); });
            }
            if (posNf.length) {
                html += '<div class="strat-header">NF — POSITIONING</div>';
                posNf.forEach((c, i) => { html += renderCandidateCard(c, nfAtm, i + 1); });
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
        const filtered = candidates.filter(c =>
            c.index === index &&
            !c.capitalBlocked &&
            c.forces.aligned >= 2 &&          // at least 2/3 forces aligned
            (c.contextScore || 0) >= -0.3 &&   // not fighting market condition
            c.ev > 0                            // positive expected value
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

    // ═══ NIFTY 50 — #1 RECOMMENDED + rest collapsed ═══
    const nfCands = diverseTop(STATE.candidates, 'NF');
    const nfTotal = STATE.candidates.filter(c => c.index === 'NF').length;
    if (nfCands.length) {
        html += renderCandidateCard(nfCands[0], nfAtm, 1);
        if (nfCands.length > 1) {
            html += `<details><summary style="cursor:pointer;font-size:12px;color:var(--accent);padding:6px 0;user-select:none;">NF: ${nfCands.length - 1} more ▸</summary>`;
            nfCands.slice(1).forEach((c, i) => { html += renderCandidateCard(c, nfAtm, i + 2); });
            html += '</details>';
        }
    } else if (nfTotal > 0) {
        html += `<div class="empty-state">NF: ${nfTotal} strategies generated but none fit current conditions. ${STATE.tradeMode === 'swing' ? 'Try INTRADAY mode?' : 'WAIT for better setup.'}</div>`;
    } else {
        html += '<div class="empty-state">No NF candidates</div>';
    }

    // ═══ BANK NIFTY — collapsed by default ═══
    const bnfCands = diverseTop(STATE.candidates, 'BNF');
    const bnfTotal = STATE.candidates.filter(c => c.index === 'BNF').length;
    if (bnfCands.length) {
        html += `<details><summary style="cursor:pointer;font-size:13px;font-weight:600;color:var(--text-primary);padding:8px 0;user-select:none;">BANK NIFTY — ${bnfCands.length} candidates ▸</summary>`;
        bnfCands.forEach((c, i) => { html += renderCandidateCard(c, bnfAtm, i + 1); });
        html += '</details>';
    } else if (bnfTotal > 0) {
        html += `<div class="empty-state">BNF: ${bnfTotal} strategies generated but none fit current conditions.</div>`;
    } else {
        html += '<div class="empty-state">No BNF candidates</div>';
    }

    el.innerHTML = html;
}

function renderCandidateCard(cand, atm, rank) {
    const forces = cand.forces;
    const dots = alignmentDots(forces.aligned);
    const alignLabel = forces.aligned === 3 ? '🟢 ALIGNED — Entry Ready' :
        forces.aligned === 2 ? '🟡 CONDITIONAL' : '⚫ WATCHING';
    const alignClass = forces.aligned === 3 ? 'align-3' :
        forces.aligned === 2 ? 'align-2' : 'align-1';

    const is4Leg = cand.legs === 4;
    const otmDist = Math.abs(cand.sellStrike - atm);
    const otmLabel = otmDist < 50 ? 'ATM' : 'OTM';
    const premLabel = cand.isCredit ? 'Net Credit' : 'Net Debit';

    // Legs — v1 style: "SELL 54600 CE (OTM) @₹667 | BUY 54800 CE (OTM) @₹578"
    let legsText = '';
    if (is4Leg) {
        legsText = `SELL ${cand.sellStrike} ${cand.sellType} (${otmLabel}) @₹${cand.sellLTP?.toFixed(1)} | BUY ${cand.buyStrike} ${cand.buyType} @₹${cand.buyLTP?.toFixed(1)}<br>` +
            `SELL ${cand.sellStrike2} ${cand.sellType2} @₹${cand.sellLTP2?.toFixed(1)} | BUY ${cand.buyStrike2} ${cand.buyType2} @₹${cand.buyLTP2?.toFixed(1)}`;
    } else if (cand.isCredit) {
        legsText = `SELL ${cand.sellStrike} ${cand.sellType} (${otmLabel}) @₹${cand.sellLTP?.toFixed(1)} | BUY ${cand.buyStrike} ${cand.buyType} (${otmLabel}) @₹${cand.buyLTP?.toFixed(1)}`;
    } else {
        legsText = `BUY ${cand.buyStrike} ${cand.buyType} (${otmLabel}) @₹${cand.buyLTP?.toFixed(1)} | SELL ${cand.sellStrike} ${cand.sellType} (${otmLabel}) @₹${cand.sellLTP?.toFixed(1)}`;
    }

    return `
    <div class="v1-card ${alignClass}" data-id="${cand.id}">
        <div class="v1-header">
            <div>
                <span class="v1-type">${friendlyType(cand.type)}</span>
                <span class="v1-tier">${dots}</span>
                ${cand.wallTag ? `<span class="v1-wall-tag">${cand.wallTag}</span>` : ''}
                ${cand.gammaTag ? `<span class="v1-gamma-tag">${cand.gammaTag}</span>` : ''}
                ${(cand.type === 'IRON_BUTTERFLY' || cand.type === 'IRON_CONDOR') ? `<span style="background:#D32F2F;color:#fff;font-size:9px;padding:1px 4px;border-radius:3px;margin-left:4px">⏱ EXIT TODAY</span>` : ''}
            </div>
            <span class="v1-rank">${rank === 1 && cand.brainScore > 0 ? '🧠 ' : ''}#${rank || ''}</span>
        </div>
        <div class="v1-sub">${cand.index} · ${cand.expiry || '--'} · DTE ${cand.tDTE || '--'}T${cand.brainScore ? ` · <span style="color:${cand.brainScore > 0 ? 'var(--green)' : cand.brainScore < 0 ? 'var(--danger)' : 'var(--text-muted)'};font-weight:600">🧠${cand.brainScore > 0 ? '+' : ''}${cand.brainScore.toFixed(2)}</span>` : ''}</div>
        <div class="v1-legs">${legsText}</div>
        <div class="v1-prem">${premLabel} ₹${cand.netPremium}/share · W:${cand.width}</div>
        ${cand.sigmaOTM ? `<div style="font-size:10px;padding:2px 8px;color:${cand.sigmaOTM >= 0.5 && cand.sigmaOTM <= 0.8 ? 'var(--green)' : cand.sigmaOTM < 0.5 ? 'var(--danger)' : 'var(--warn)'}">Strike: ${cand.sigmaOTM}σ OTM ${cand.sigmaOTM >= 0.5 && cand.sigmaOTM <= 0.8 ? '● SWEET SPOT' : cand.sigmaOTM > 0.8 ? '● thin credit zone' : '● too close'}</div>` : ''}
        ${renderBrainForCandidate(cand.id)}

        <div class="v1-metrics">
            <div class="v1-metric"><span class="v1-label">Max Profit</span><span class="v1-val green">₹${cand.maxProfit.toLocaleString()}</span></div>
            <div class="v1-metric"><span class="v1-label">Max Loss</span><span class="v1-val red">₹${cand.maxLoss.toLocaleString()}</span></div>
            <div class="v1-metric"><span class="v1-label">R:R</span><span class="v1-val">${cand.riskReward || '--'}</span></div>
            <div class="v1-metric"><span class="v1-label">P(Profit)</span><span class="v1-val${cand.upstoxPop && Math.abs(cand.probProfit * 100 - cand.upstoxPop) > 20 ? '" style="color:var(--danger)' : ''}">${(cand.probProfit * 100).toFixed(1)}%${cand.upstoxPop ? ` <span style="font-size:9px;color:var(--text-muted)">(UPX:${cand.upstoxPop.toFixed(0)}%)</span>` : ''}</span></div>
            ${CALIBRATION.win_rates[cand.type] && CALIBRATION.win_rates[cand.type].total > 0 ? `<div class="v1-metric"><span class="v1-label">Track Record</span><span class="v1-val" style="color:${CALIBRATION.win_rates[cand.type].rate >= 0.7 ? 'var(--green)' : CALIBRATION.win_rates[cand.type].rate >= 0.4 ? 'var(--warn)' : 'var(--danger)'}">${CALIBRATION.win_rates[cand.type].verdict} ${CALIBRATION.win_rates[cand.type].wins}/${CALIBRATION.win_rates[cand.type].total} (${(CALIBRATION.win_rates[cand.type].rate * 100).toFixed(0)}%)</span></div>` : ''}
        </div>

        <div class="v1-target">🎯 Target: ₹${cand.targetProfit?.toLocaleString() || '--'} | 🔴 SL: ₹${cand.stopLoss?.toLocaleString() || '--'}</div>
        ${cand.estCost ? `<div class="v1-cost" style="font-size:10px;color:${cand.costWarning ? 'var(--danger)' : 'var(--text-muted)'};padding:2px 0">${cand.costWarning ? '⚠️' : '💸'} Est. cost: ₹${cand.estCost.toLocaleString()} (${cand.estCostPct}% of max) · Net profit: ₹${(cand.netMaxProfit ?? 0).toLocaleString()}</div>` : ''}

        <div class="v1-forces">
            ${forceIcon(forces.f1)}Δ ${forceIcon(forces.f2)}Θ ${forceIcon(forces.f3)}IV · ${cand.varsityTier === 'PRIMARY' ? '<span style="color:var(--green)">PRIMARY</span>' : '<span style="color:var(--warn)">ALLOWED</span>'}${cand.wallTag ? ' 🛡️' : ''}${cand.gammaTag ? ` <span style="color:var(--danger)">${cand.gammaTag}</span>` : ''}
        </div>
        <div class="v1-footer">
            💰 BUY first ₹${peakCash(cand).toLocaleString()} → Margin: ₹${cand.maxLoss.toLocaleString()}
            · EV/₹1K: ₹${(cand.ev / (peakCash(cand) / 1000 || 1)).toFixed(0)}
        </div>

        <div class="v1-align ${alignClass}">${alignLabel}</div>
        ${forces.aligned >= 2 ? `
        <div class="v1-trade-btns">
            <button class="btn-take" onclick="takeTrade('${cand.id}', false)" ${cand.costBlocked ? 'disabled style="opacity:0.4;cursor:not-allowed" title="Cost exceeds 5% of max profit"' : ''}>📌 REAL TRADE${cand.costBlocked ? ' ⚠️' : ''}</button>
            <button class="btn-paper" onclick="takeTrade('${cand.id}', true)">📋 PAPER${!canPaperTrade(cand.index) ? ' (FULL)' : ''}</button>
        </div>` : ''}
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
        </div>
        ${renderBrainForTrade(t.id)}
        <div class="pos-actions">
            <button class="btn-close-profit" onclick="closeTrade('${t.id}', '${isPaper ? 'Paper ' : ''}Profit booked')">💰 Book Profit</button>
            <button class="btn-close-loss" onclick="closeTrade('${t.id}', '${isPaper ? 'Paper ' : ''}Stop loss')">🛑 Exit</button>
        </div>
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
    const lastUpdate = STATE.lastPollTime ? new Date(STATE.lastPollTime).toLocaleTimeString('en-IN', { timeZone: 'Asia/Kolkata', hour: '2-digit', minute: '2-digit', hour12: true }) : '';

    // ═══ SIGNAL ACCURACY — compact, collapsible ═══
    if (STATE.signalValidation) {
        const sv = STATE.signalValidation;
        html += `<details>
            <summary style="cursor:pointer;font-size:12px;padding:4px 0;user-select:none">📡 Yesterday: ${sv.predicted} → ${sv.correct ? '✅' : '❌'} ${sv.actualDir} (${sv.actualGap > 0 ? '+' : ''}${sv.actualGap?.toFixed(0)} pts)${STATE.signalAccuracyStats ? ` · ${STATE.signalAccuracyStats.pct}% accuracy` : ''} ▸</summary>
            <div class="signal-accuracy-card">
                <div class="env-row"><span class="env-row-label">Predicted</span><span class="env-row-value">${sv.predicted} (${sv.strength}/5)</span></div>
                <div class="env-row"><span class="env-row-label">Actual Gap</span><span class="env-row-value" style="color:${sv.correct ? 'var(--green)' : 'var(--danger)'}">${sv.actualGap > 0 ? '+' : ''}${sv.actualGap?.toFixed(0)} pts → ${sv.actualDir} ${sv.correct ? '✅' : '❌'}</span></div>
                ${STATE.signalAccuracyStats ? `<div class="env-row"><span class="env-row-label">Accuracy</span><span class="env-row-value" style="color:var(--accent)">${STATE.signalAccuracyStats.correct}/${STATE.signalAccuracyStats.total} (${STATE.signalAccuracyStats.pct}%)</span></div>` : ''}
            </div>
        </details>`;
    }

    // ═══ OPEN TRADES — split real vs paper ═══
    const realTrades = STATE.openTrades.filter(t => !t.paper);
    const paperTrades = STATE.openTrades.filter(t => t.paper);

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
    const watching = STATE.isWatching ? '🟢' : '⏹';
    const polls = STATE.pollCount;
    // Count all brain insights across categories
    const bi = STATE.brainInsights || {};
    const mktCount = (bi.market || []).length + (bi.timing || []).length;
    const posCount = Object.values(bi.positions || {}).reduce((s, arr) => s + arr.length, 0);
    const candCount = Object.values(bi.candidates || {}).reduce((s, arr) => s + arr.length, 0);
    const riskCount = (bi.risk || []).length;
    const total = mktCount + posCount + candCount + riskCount;
    const brain = STATE.brainReady ? `🧠${total}` : (STATE.brainError ? '🧠✗' : '🧠…');
    const riskAlert = riskCount > 0 && (bi.risk || []).some(r => r.strength >= 4) ? ' ⚠️' : '';
    el.textContent = `${watching} ${time} · Polls: ${polls} · ${brain}${riskAlert} · Candidates: ${STATE.candidates.length}`;
}


// ═══════════════════════════════════════════════════════════════
// MORNING INPUT & INITIALIZATION
// ═══════════════════════════════════════════════════════════════

function lockMorningData() {
    initAudio(); // Initialize audio on user tap

    // Request notification permission on user tap (mobile Chrome requires gesture)
    if ('Notification' in window && Notification.permission === 'default') {
        Notification.requestPermission();
    }

    // ═══ PHASE 8: Clear stale positioning from yesterday/previous scan ═══
    STATE.positioningResult = null;
    STATE.tomorrowSignal = null;
    STATE.positioningCandidates = [];
    STATE.positioningBias = null;
    STATE._captured2pm = false;
    STATE._captured315pm = false;
    STATE.afternoonBaseline = null;
    // Clear afternoon "now" values but KEEP morning reference (dowClose, crudeSettle)
    STATE.globalDirection = { ...STATE.globalDirection, dowNow: null, crudeNow: null };
    localStorage.removeItem('mr2_global_context');

    const fiiCash = document.getElementById('in-fii-cash').value;
    const fiiShortPct = document.getElementById('in-fii-short').value;
    const upstoxBias = document.getElementById('in-upstox-bias')?.value || '';
    const diiCash = document.getElementById('in-dii-cash')?.value || '';
    const fiiIdxFut = document.getElementById('in-fii-idx-fut')?.value || '';
    const fiiStkFut = document.getElementById('in-fii-stk-fut')?.value || '';
    const dowClose = document.getElementById('in-dow-close')?.value || '';
    const crudeSettle = document.getElementById('in-crude-settle')?.value || '';

    // Save Dow/Crude morning reference to STATE
    if (dowClose) STATE.globalDirection.dowClose = parseFloat(dowClose);
    if (crudeSettle) STATE.globalDirection.crudeSettle = parseFloat(crudeSettle);

    // closeChar will be auto-calculated from yesterday's OHLC
    STATE.morningInput = { fiiCash, fiiShortPct, upstoxBias, diiCash, fiiIdxFut, fiiStkFut };

    // Save to localStorage for restore (includes Dow/Crude reference)
    const morningPayload = {
        ...STATE.morningInput, dowClose, crudeSettle,
        date: API.todayIST()
    };
    localStorage.setItem('mr2_morning', JSON.stringify(morningPayload));
    DB.setConfig('morning_inputs', morningPayload); // Supabase — survives device change

    // Disable inputs
    document.querySelectorAll('.morning-input').forEach(el => el.disabled = true);
    document.getElementById('btn-lock').disabled = true;
    document.getElementById('btn-lock').textContent = '⏳ Scanning...';

    initialFetch();
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
        STATE.globalDirection.dowClose = parseFloat(data.dowClose);
    }
    if (data.crudeSettle) {
        const el = document.getElementById('in-crude-settle');
        if (el) el.value = data.crudeSettle;
        STATE.globalDirection.crudeSettle = parseFloat(data.crudeSettle);
    }
    // Restore morning bias (the plan — survives device change via Supabase)
    const biasCloud = cloudConfig?.morning_bias;
    const biasData = (biasCloud?.date === today) ? biasCloud : data;
    if (biasData?.biasLabel && biasData?.biasNet !== undefined) {
        // Use biasLabel/biasNet from morning_bias config if available, else from morning_inputs
        const bl = biasData.biasLabel || biasData.label;
        const bn = biasData.biasNet ?? biasData.net;
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
    if (parsed.dowNow) STATE.globalDirection.dowNow = parsed.dowNow;
    if (parsed.crudeNow) STATE.globalDirection.crudeNow = parsed.crudeNow;
}

async function loadOpenTrade() {
    const trades = await DB.getOpenTrades();
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

    const fii = STATE.morningInput?.fiiCash || '--';
    const short = STATE.morningInput?.fiiShortPct || '--';
    const time = API.istNow();

    full.style.display = 'none';
    collapsed.style.display = 'block';
    const regime = STATE.institutionalRegime;
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
    const dow = document.getElementById('in-eve-dow')?.value;
    const crude = document.getElementById('in-eve-crude')?.value;
    const gift = document.getElementById('in-eve-gift')?.value;
    const statusEl = document.getElementById('evening-status');

    if (!dow && !crude && !gift) {
        if (statusEl) statusEl.textContent = '⚠️ Enter at least one value';
        return;
    }

    const payload = {
        dow: dow ? parseFloat(dow) : null,
        crude: crude ? parseFloat(crude) : null,
        gift: gift ? parseFloat(gift) : null,
        date: API.todayIST(),
        saved_at: new Date().toISOString()
    };

    STATE.eveningClose = payload;
    localStorage.setItem('mr2_evening_close', JSON.stringify(payload));
    DB.setConfig('evening_close', payload);

    if (statusEl) statusEl.textContent = `✅ Saved: Dow ${dow || '--'}, Crude ${crude || '--'}, GIFT ${gift || '--'} (${payload.date})`;
}

function restoreEveningClose(cloudConfig) {
    let data = cloudConfig?.evening_close || null;
    if (!data) {
        try { data = JSON.parse(localStorage.getItem('mr2_evening_close')); } catch (e) { }
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
function computeOvernightDelta(currentNfSpot) {
    const eve = STATE.eveningClose;
    if (!eve) return null;

    const morningDow = STATE.globalDirection?.dowClose;
    const morningCrude = STATE.globalDirection?.crudeSettle;

    const delta = { signals: [], summary: '' };

    // Dow delta: evening stored vs today's morning input
    if (eve.dow && morningDow) {
        const pct = ((morningDow - eve.dow) / eve.dow * 100).toFixed(2);
        const dir = Math.abs(pct) < C.DOW_THRESHOLD ? 'NEUTRAL' : (pct > 0 ? 'BULL' : 'BEAR');
        delta.signals.push({ name: 'Dow', from: eve.dow, to: morningDow, pct: +pct, dir, threshold: C.DOW_THRESHOLD });
    }

    // Crude delta: evening stored vs today's morning input
    if (eve.crude && morningCrude) {
        const pct = ((morningCrude - eve.crude) / eve.crude * 100).toFixed(2);
        // Crude up = bearish for India (cost push)
        const dir = Math.abs(pct) < C.CRUDE_THRESHOLD ? 'NEUTRAL' : (pct > 0 ? 'BEAR' : 'BULL');
        delta.signals.push({ name: 'Crude', from: eve.crude, to: morningCrude, pct: +pct, dir, threshold: C.CRUDE_THRESHOLD });
    }

    // GIFT delta: evening 9:15PM close vs current spot (passed from caller)
    if (eve.gift && STATE.gapInfo) {
        const gapDir = STATE.gapInfo.sigma > 0.3 ? 'BULL' : STATE.gapInfo.sigma < -0.3 ? 'BEAR' : 'NEUTRAL';
        delta.signals.push({ name: 'GIFT', from: eve.gift, to: currentNfSpot ?? null, pct: STATE.gapInfo.sigma, dir: gapDir, isSigma: true });
    }

    // Count directional signals
    const bullCount = delta.signals.filter(s => s.dir === 'BULL').length;
    const bearCount = delta.signals.filter(s => s.dir === 'BEAR').length;
    if (bearCount >= 2) delta.summary = '🔴 OVERNIGHT BEARISH';
    else if (bullCount >= 2) delta.summary = '🟢 OVERNIGHT BULLISH';
    else if (bearCount > bullCount) delta.summary = '🟡 OVERNIGHT MILDLY BEARISH';
    else if (bullCount > bearCount) delta.summary = '🟡 OVERNIGHT MILDLY BULLISH';
    else delta.summary = '⚪ OVERNIGHT NEUTRAL';

    STATE.overnightDelta = delta;
    return delta;
}

// ═══════════════════════════════════════════════════════════════
// DATA EXPORT — One-click Excel download of all Supabase data
// ═══════════════════════════════════════════════════════════════

async function exportAllData() {
    const statusEl = document.getElementById('export-status');
    const btn = document.getElementById('btn-export');
    if (!window.XLSX) { alert('SheetJS library not loaded. Check internet connection.'); return; }

    try {
        btn.disabled = true;
        statusEl.textContent = '⏳ Fetching trades...';
        // Create direct Supabase client for export queries
        const sb = window.supabase.createClient(
            'https://fdynxkfxohbnlvayouje.supabase.co',
            'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZkeW54a2Z4b2hibmx2YXlvdWplIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzMwMTc0NjQsImV4cCI6MjA4ODU5MzQ2NH0.1KbzYXtpuzUIDABCz9jKz4VjcuGeuyYOQAHkNLlndRE'
        );

        // 1. Fetch ALL trades
        const { data: trades } = await sb.from('trades_v2').select('*').order('created_at', { ascending: true });
        statusEl.textContent = `⏳ ${trades?.length || 0} trades... fetching history...`;

        // 2. Fetch ALL premium history
        const { data: premHist } = await sb.from('premium_history').select('*').order('date', { ascending: true });
        statusEl.textContent = `⏳ ${premHist?.length || 0} history rows... fetching snapshots...`;

        // 3. Fetch ALL chain snapshots
        const { data: chains } = await sb.from('chain_snapshots').select('*').order('date', { ascending: true });
        statusEl.textContent = `⏳ ${chains?.length || 0} snapshots... fetching config...`;

        // 4. Fetch ALL app_config
        const { data: config } = await sb.from('app_config').select('*');

        // ═══ SHEET 1: Trades (flattened) ═══
        const tradeRows = (trades || []).map(t => {
            const es = t.entry_snapshot || {};
            const xs = t.exit_snapshot || {};
            const js = t.journey_stats || {};
            return {
                id: t.id,
                date: t.entry_date?.split('T')[0],
                entry_time: t.entry_date?.split('T')[1]?.substring(0, 5),
                exit_date: t.exit_date?.split('T')[0],
                strategy: t.strategy_type,
                index: t.index_key,
                mode: t.trade_mode || '',
                paper: t.paper ? 'PAPER' : 'REAL',
                sell_strike: t.sell_strike,
                buy_strike: t.buy_strike,
                sell_type: t.sell_type,
                width: t.width,
                entry_premium: t.entry_premium,
                exit_premium: t.exit_premium,
                max_profit: t.max_profit,
                max_loss: t.max_loss,
                actual_pnl: t.actual_pnl,
                peak_pnl: t.peak_pnl,
                trough_pnl: t.trough_pnl,
                prob_profit: t.prob_profit,
                entry_spot: t.entry_spot,
                exit_spot: xs.spot ?? t.exit_spot,
                entry_vix: t.entry_vix,
                exit_vix: xs.vix ?? t.exit_vix,
                entry_pcr: t.entry_pcr,
                exit_pcr: xs.near_atm_pcr ?? t.exit_pcr,
                entry_bias: t.entry_bias,
                entry_bias_net: t.entry_bias_net,
                exit_bias: xs.bias ?? t.exit_bias,
                force_alignment: t.force_alignment,
                f1: t.force_f1, f2: t.force_f2, f3: t.force_f3,
                exit_force: xs.force_f1 != null ? `${xs.force_f1}/${xs.force_f2}/${xs.force_f3}` : '',
                regime: t.entry_regime,
                wall_score: t.entry_wall_score,
                gamma_risk: t.entry_gamma_risk,
                gap_sigma: t.entry_gap_sigma,
                gap_type: t.entry_gap_type,
                hold_minutes: t.exit_hold_minutes,
                poll_count: t.poll_count ?? js.poll_count,
                exit_reason: t.exit_reason,
                // Entry snapshot extras
                candidate_rank: es.candidate_rank,
                varsity_tier: es.varsity_tier,
                context_score: es.context_score,
                ev: es.ev,
                sigma_from_atm: es.sigma_from_atm,
                iv_percentile: es.iv_percentile,
                vix_direction: es.vix_direction,
                morning_bias: es.morning_bias,
                bias_drift: es.bias_drift,
                minutes_since_open: es.minutes_since_open,
                // Journey stats
                spot_high: js.spot_high,
                spot_low: js.spot_low,
                spot_range: js.spot_range,
                max_ci: js.max_ci,
                min_ci: js.min_ci,
                forces_changed: js.forces_changed_count,
                drawdown: js.drawdown_from_peak,
                recovery: js.recovery,
                pnl_per_poll: js.pnl_per_poll
            };
        });

        // ═══ SHEET 2: Premium History ═══
        const premRows = (premHist || []).map(p => ({
            date: p.date,
            session: p.session,
            nf_spot: p.nf_spot,
            bnf_spot: p.bnf_spot,
            vix: p.vix,
            nf_atm_iv: p.nf_atm_iv,
            bnf_atm_iv: p.bnf_atm_iv,
            pcr: p.pcr,
            fii_cash: p.fii_cash,
            fii_short_pct: p.fii_short_pct,
            dii_cash: p.dii_cash,
            fii_idx_fut: p.fii_idx_fut,
            fii_stk_fut: p.fii_stk_fut,
            futures_prem_bnf: p.futures_premium_bnf,
            bias: p.bias,
            bias_net: p.bias_net
        }));

        // ═══ SHEET 3: Chain Snapshots ═══
        const chainRows = (chains || []).map(c => ({
            date: c.date,
            session: c.session,
            bnf_spot: c.bnf_spot,
            nf_spot: c.nf_spot,
            vix: c.vix,
            bnf_pcr: c.bnf_pcr,
            bnf_near_atm_pcr: c.bnf_near_atm_pcr,
            nf_pcr: c.nf_pcr,
            bnf_call_wall: c.bnf_call_wall,
            bnf_call_wall_oi: c.bnf_call_wall_oi,
            bnf_put_wall: c.bnf_put_wall,
            bnf_put_wall_oi: c.bnf_put_wall_oi,
            bnf_max_pain: c.bnf_max_pain,
            nf_max_pain: c.nf_max_pain,
            bnf_total_call_oi: c.bnf_total_call_oi,
            bnf_total_put_oi: c.bnf_total_put_oi,
            nf_total_call_oi: c.nf_total_call_oi,
            nf_total_put_oi: c.nf_total_put_oi,
            bnf_atm_iv: c.bnf_atm_iv,
            bnf_futures_prem: c.bnf_futures_prem,
            bnf_breadth_pct: c.bnf_breadth_pct,
            nf50_advancing: c.nf50_advancing,
            tomorrow_signal: c.tomorrow_signal,
            signal_strength: c.signal_strength,
            signal_correct: c.signal_correct
        }));

        // ═══ SHEET 4: Poll History (all days) ═══
        const pollRows = [];
        for (const row of (config || [])) {
            if (row.key.startsWith('poll_history_')) {
                const date = row.key.replace('poll_history_', '');
                const polls = Array.isArray(row.value) ? row.value : [];
                for (const p of polls) {
                    pollRows.push({
                        date,
                        time: p.t,
                        nf: p.nf, bnf: p.bnf, vix: p.vix,
                        pcr: p.pcr, nf_pcr: p.nfPcr,
                        bnf_call_wall: p.cw, bnf_call_wall_oi: p.cwOI,
                        bnf_put_wall: p.pw, bnf_put_wall_oi: p.pwOI,
                        nf_call_wall: p.nfCW, nf_call_wall_oi: p.nfCWOI,
                        nf_put_wall: p.nfPW, nf_put_wall_oi: p.nfPWOI,
                        bnf_total_call_oi: p.bnfCOI, bnf_total_put_oi: p.bnfPOI,
                        nf_total_call_oi: p.nfCOI, nf_total_put_oi: p.nfPOI,
                        bnf_max_pain: p.mp, nf_max_pain: p.nfMP,
                        futures_prem: p.fp,
                        breadth: p.brd, nf50_adv: p.nfAdv,
                        bias_net: p.bias
                    });
                }
            }
        }

        // ═══ SHEET 5: Journey Timelines (per trade) ═══
        const journeyRows = [];
        for (const t of (trades || [])) {
            const timeline = t.journey_stats?.timeline || [];
            for (const pt of timeline) {
                journeyRows.push({
                    trade_id: t.id,
                    strategy: t.strategy_type,
                    index: t.index_key,
                    date: t.entry_date?.split('T')[0],
                    time: pt.t,
                    pnl: pt.pnl,
                    ci: pt.ci,
                    spot: pt.spot,
                    vix: pt.vix,
                    pcr: pt.pcr,
                    force_alignment: pt.fa
                });
            }
        }

        // ═══ SHEET 6: Strike Data (per-strike OI/IV/Delta/Pop from polls) ═══
        const strikeRows = [];
        for (const row of (config || [])) {
            if (row.key.startsWith('poll_history_')) {
                const date = row.key.replace('poll_history_', '');
                const polls = Array.isArray(row.value) ? row.value : [];
                for (const p of polls) {
                    // BNF strikes
                    for (const s of (p.bnfS || [])) {
                        if (s.c) strikeRows.push({ date, time: p.t, idx: 'BNF', strike: s.k, side: 'CE', oi: s.c.o, volume: s.c.v, ltp: s.c.l, iv: s.c.i, delta: s.c.d, pop: s.c.p });
                        if (s.p) strikeRows.push({ date, time: p.t, idx: 'BNF', strike: s.k, side: 'PE', oi: s.p.o, volume: s.p.v, ltp: s.p.l, iv: s.p.i, delta: s.p.d, pop: s.p.p });
                    }
                    // NF strikes
                    for (const s of (p.nfS || [])) {
                        if (s.c) strikeRows.push({ date, time: p.t, idx: 'NF', strike: s.k, side: 'CE', oi: s.c.o, volume: s.c.v, ltp: s.c.l, iv: s.c.i, delta: s.c.d, pop: s.c.p });
                        if (s.p) strikeRows.push({ date, time: p.t, idx: 'NF', strike: s.k, side: 'PE', oi: s.p.o, volume: s.p.v, ltp: s.p.l, iv: s.p.i, delta: s.p.d, pop: s.p.p });
                    }
                }
            }
        }

        // ═══ BUILD WORKBOOK ═══
        statusEl.textContent = '⏳ Building Excel...';
        const wb = XLSX.utils.book_new();

        if (tradeRows.length) {
            const ws1 = XLSX.utils.json_to_sheet(tradeRows);
            XLSX.utils.book_append_sheet(wb, ws1, 'Trades');
        }
        if (premRows.length) {
            const ws2 = XLSX.utils.json_to_sheet(premRows);
            XLSX.utils.book_append_sheet(wb, ws2, 'Premium History');
        }
        if (chainRows.length) {
            const ws3 = XLSX.utils.json_to_sheet(chainRows);
            XLSX.utils.book_append_sheet(wb, ws3, 'Chain Snapshots');
        }
        if (pollRows.length) {
            const ws4 = XLSX.utils.json_to_sheet(pollRows);
            XLSX.utils.book_append_sheet(wb, ws4, 'Poll History');
        }
        if (journeyRows.length) {
            const ws5 = XLSX.utils.json_to_sheet(journeyRows);
            XLSX.utils.book_append_sheet(wb, ws5, 'Journey Timelines');
        }
        if (strikeRows.length) {
            const ws6 = XLSX.utils.json_to_sheet(strikeRows);
            XLSX.utils.book_append_sheet(wb, ws6, 'Strike Data');
        }

        // Summary sheet
        const summary = [
            { metric: 'Export Date', value: new Date().toISOString() },
            { metric: 'Total Trades', value: trades?.length || 0 },
            { metric: 'Real Trades', value: (trades || []).filter(t => !t.paper).length },
            { metric: 'Paper Trades', value: (trades || []).filter(t => t.paper).length },
            { metric: 'Premium History Days', value: premHist?.length || 0 },
            { metric: 'Chain Snapshots', value: chains?.length || 0 },
            { metric: 'Poll History Entries', value: pollRows.length },
            { metric: 'Journey Timeline Points', value: journeyRows.length },
            { metric: 'Strike Data Points', value: strikeRows.length },
            { metric: 'App Version', value: 'v2.1 b71' }
        ];
        const ws0 = XLSX.utils.json_to_sheet(summary);
        XLSX.utils.book_append_sheet(wb, ws0, 'Summary');

        // ═══ DOWNLOAD via Supabase Storage (real HTTPS URL — works in ANY WebView) ═══
        const today = API.todayIST();
        const filename = `MarketRadar_Export_${today}.xlsx`;
        const wbout = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
        const blob = new Blob([wbout], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
        const stats = `${trades?.length || 0} trades · ${pollRows.length} polls · ${strikeRows.length} strikes`;

        statusEl.textContent = '⏳ Uploading to cloud...';

        // Upload to Supabase Storage (public 'exports' bucket)
        const storagePath = `export_${today}_${Date.now()}.xlsx`;
        const { error: uploadErr } = await sb.storage.from('EXPORTS').upload(storagePath, blob, {
            contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
            upsert: true
        });

        if (uploadErr) throw new Error('Upload failed: ' + uploadErr.message);

        // Get public URL with download header
        const { data: urlData } = sb.storage.from('EXPORTS').getPublicUrl(storagePath, { download: filename });
        const publicUrl = urlData?.publicUrl;
        if (!publicUrl) throw new Error('Could not get public URL');

        // Download via hidden iframe — proven technique for WebView downloads
        // Content-Disposition: attachment header tells WebView to download, not render
        const iframe = document.createElement('iframe');
        iframe.style.display = 'none';
        iframe.src = publicUrl;
        document.body.appendChild(iframe);
        setTimeout(() => { try { document.body.removeChild(iframe); } catch (e) { } }, 30000);

        statusEl.textContent = '';
        statusEl.appendChild(document.createTextNode(`✅ ${stats}`));
        statusEl.appendChild(document.createElement('br'));
        const link = document.createElement('a');
        link.href = publicUrl;
        link.download = filename;
        link.style.cssText = 'display:inline-block;margin-top:6px;padding:10px 16px;background:var(--accent);color:white;border-radius:8px;font-weight:700;font-size:13px;text-decoration:none';
        link.textContent = `📥 Download Excel`;
        statusEl.appendChild(link);
        statusEl.appendChild(document.createElement('br'));
        const hint = document.createElement('span');
        hint.style.cssText = 'font-size:10px;color:var(--text-muted)';
        hint.textContent = 'If tap fails: long-press → "Open in browser"';
        statusEl.appendChild(hint);
        btn.disabled = false;

    } catch (err) {
        console.error('Export error:', err);
        statusEl.textContent = `❌ Export failed: ${err.message}`;
        btn.disabled = false;
    }
}

// ═══ INIT ═══
document.addEventListener('DOMContentLoaded', async () => {
    DB.init();

    // Fetch all config from Supabase (single query) — localStorage fallback if offline
    const cloudConfig = await DB.getAllConfig();

    restoreMorningData(cloudConfig);
    restoreGlobalContext(cloudConfig);
    restoreEveningClose(cloudConfig);

    // Phase 11: Restore today's poll history (survives refresh)
    // Fetched separately because getAllConfig now excludes poll_history_* for performance
    const todayKey = 'poll_history_' + API.todayIST();
    const todayPolls = await DB.getConfig(todayKey);
    if (todayPolls) STATE.pollHistory = todayPolls;

    // Cleanup old poll_history_ keys (>7 days) to prevent DB bloat
    try {
        const cutoff = new Date();
        cutoff.setDate(cutoff.getDate() - 7);
        for (let d = 0; d < 30; d++) {
            const past = new Date(cutoff);
            past.setDate(past.getDate() - d);
            const oldKey = 'poll_history_' + past.toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
            localStorage.removeItem('mr2_cfg_' + oldKey);
        }
    } catch (e) { /* non-critical cleanup */ }

    initTheme(cloudConfig);
    await loadOpenTrade();
    STATE.signalAccuracyStats = await DB.getSignalAccuracyStats();

    // If open trades exist, show positions tab
    if (STATE.openTrades.length > 0) {
        switchTab('positions');
    }

    renderAll();

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

    // Evening close save button
    document.getElementById('btn-save-evening')?.addEventListener('click', saveEveningClose);

    // Global Direction inputs — live update on change + auto-save + recompute boost
    document.addEventListener('change', (e) => {
        if (e.target.id === 'in-dow-now') {
            STATE.globalDirection.dowNow = e.target.value ? parseFloat(e.target.value) : null;
        } else if (e.target.id === 'in-crude-now') {
            STATE.globalDirection.crudeNow = e.target.value ? parseFloat(e.target.value) : null;
        } else { return; }
        // Auto-save to localStorage + Supabase with date stamp
        const saveData = { ...STATE.globalDirection, _date: API.todayIST() };
        localStorage.setItem('mr2_global_context', JSON.stringify(saveData));
        DB.setConfig('global_direction', saveData);

        // Recompute globalBoost with new direction data
        computeGlobalBoost(STATE.tomorrowSignal, STATE.positioningResult);
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
