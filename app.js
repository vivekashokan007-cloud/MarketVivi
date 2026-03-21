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

    // Strategy categories
    CREDIT_TYPES: ['BEAR_CALL', 'BULL_PUT', 'IRON_CONDOR', 'IRON_BUTTERFLY'],
    DEBIT_TYPES: ['BEAR_PUT', 'BULL_CALL', 'DOUBLE_DEBIT'],
    NEUTRAL_TYPES: ['IRON_CONDOR', 'IRON_BUTTERFLY', 'DOUBLE_DEBIT'],
    DIRECTIONAL_BULL: ['BULL_CALL', 'BULL_PUT'],
    DIRECTIONAL_BEAR: ['BEAR_CALL', 'BEAR_PUT']
};

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
    contrarianPCR: [],
    fiiTrend: null,
    trajectory: null,
    controlIndex: null,
    gapInfo: null,
    yesterdayHistory: [],
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

    // Global context (3:15 PM inputs)
    globalContext: { giftNifty: null, europe: null, crude: null },

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
        date: new Date().toISOString().split('T')[0],
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
    STATE.live = { ...STATE.live,
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
            ${STATE.tomorrowSignal?.globalBoost ? `<div class="signal-detail" style="color:var(--accent)">🌍 Global context: ${STATE.tomorrowSignal.globalBoost > 0 ? '+' : ''}${STATE.tomorrowSignal.globalBoost} strength</div>` : ''}
        </div>`;
    }

    return html;
}


// ═══════════════════════════════════════════════════════════════
// CANDIDATE GENERATION
// ═══════════════════════════════════════════════════════════════

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

    // ═══ 1. DIRECTIONAL SPREADS (4 types) ═══
    const stratTypes = ['BEAR_CALL', 'BULL_PUT', 'BEAR_PUT', 'BULL_CALL'];

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
                if (!isBNF && C.DIRECTIONAL_BEAR.concat(C.DIRECTIONAL_BULL).includes(sType)) {
                    if (C.CREDIT_TYPES.includes(sType) && C.NF_MARGIN_EST > C.CAPITAL * C.NF_MARGIN_THRESHOLD) {
                        cand.capitalBlocked = true;
                    }
                }
                candidates.push(cand);
            }
        }
    }

    // ═══ 2. IRON CONDOR (Bear Call + Bull Put combined) ═══
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
            const probAbovePut = 1 - Math.abs(BS.delta(spot, sellPut, T, vol, 'PE'));
            const probBelowCall = 1 - Math.abs(BS.delta(spot, sellCall, T, vol, 'CE'));
            const probProfit = Math.max(0, probAbovePut + probBelowCall - 1);
            if (probProfit < C.MIN_PROB) continue;
            if (totalCredit / width < C.MIN_CREDIT_RATIO) continue;

            const ev = Math.round((probProfit * maxProfit) - ((1 - probProfit) * maxLoss));

            // Theta: sum of all 4 legs
            const netTheta = Math.round(Math.abs(
                (BS.theta(spot, sellCall, T, vol, 'CE') + BS.theta(spot, sellPut, T, vol, 'PE')
                - BS.theta(spot, buyCall, T, vol, 'CE') - BS.theta(spot, buyPut, T, vol, 'PE'))
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
                netDelta: +(Math.abs(BS.delta(spot, sellCall, T, vol, 'CE')) - Math.abs(BS.delta(spot, sellPut, T, vol, 'PE'))).toFixed(4),
                riskReward: maxLoss > 0 ? `1:${(maxProfit / maxLoss).toFixed(2)}` : '--',
                targetProfit: Math.round(maxProfit * 0.5),
                stopLoss: Math.round(maxProfit),
                forces: getForceAlignment('IRON_CONDOR', biasResult, vix, ivPercentile),
                index: isBNF ? 'BNF' : 'NF', expiry, tDTE,
                margin: Math.round(maxLossPerShare * lotSize * 1.2) // IC margin is ~one side
            });
        }
    }

    // ═══ 3. IRON BUTTERFLY (sell ATM CE+PE, buy wings) ═══
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

        // IB has lower probability (needs pinning near ATM) but higher credit
        const probProfit = Math.max(0.2, 1 - (width / (BS.dailySigma(spot, vix) * Math.sqrt(tDTE))));
        if (probProfit < C.MIN_PROB) continue;

        const ev = Math.round((probProfit * maxProfit) - ((1 - probProfit) * maxLoss));
        const netTheta = Math.round(Math.abs(
            (BS.theta(spot, atm, T, vol, 'CE') + BS.theta(spot, atm, T, vol, 'PE')
            - BS.theta(spot, buyCall, T, vol, 'CE') - BS.theta(spot, buyPut, T, vol, 'PE'))
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
            index: isBNF ? 'BNF' : 'NF', expiry, tDTE,
            margin: Math.round(maxLossPerShare * lotSize * 1.2)
        });
    }

    // ═══ 4. DOUBLE DEBIT SPREAD (Bull Call + Bear Put — straddle replacement) ═══
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
            (BS.theta(spot, atm, T, vol, 'CE') + BS.theta(spot, atm, T, vol, 'PE')
            - BS.theta(spot, sellCall, T, vol, 'CE') - BS.theta(spot, sellPut, T, vol, 'PE'))
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
            index: isBNF ? 'BNF' : 'NF', expiry, tDTE,
            margin: maxLoss
        });
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

    // Probability (using delta of sell strike)
    const sellDelta = Math.abs(BS.delta(spot, pair.sell, T, vol, pair.sellType));
    let probProfit = isCredit ? (1 - sellDelta) : sellDelta;

    // ═══ IV EDGE PROBABILITY BOOST (credit sellers only) ═══
    // When VIX ≥ 18, implied > realized. Delta underestimates credit win rate.
    if (isCredit && vix >= 18) {
        const ivEdge = Math.min(0.10, (vix - 16) * 0.015);
        probProfit = Math.min(0.98, probProfit + ivEdge);
    }

    if (probProfit < C.MIN_PROB) return null;

    // Credit ratio filter
    if (isCredit && (netPremium / width) < C.MIN_CREDIT_RATIO) return null;

    // EV
    const ev = (probProfit * maxProfit) - ((1 - probProfit) * maxLoss);

    // Theta estimate
    const sellTheta = BS.theta(spot, pair.sell, T, vol, pair.sellType) * lotSize;
    const buyTheta = BS.theta(spot, pair.buy, T, vol, pair.buyType) * lotSize;
    const netTheta = isCredit ? -(sellTheta - buyTheta) : (sellTheta - buyTheta); // positive = in your favor

    // Liquidity score (from OI)
    const liq = Math.min(1, (sellData.oi + buyData.oi) / 200000);

    // Margin estimate (simplified)
    const margin = isCredit ? (width - netPremium) * lotSize * 1.5 : maxLoss;

    // Greeks — net position
    const sellDeltaVal = BS.delta(spot, pair.sell, T, vol, pair.sellType);
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
        margin: Math.round(margin),
        riskReward,
        targetProfit,
        stopLoss,
        liq,
        isCredit,
        lotSize
    };
}


// ═══════════════════════════════════════════════════════════════
// CANDIDATE RANKING — Force-first, then EV/risk quality
// ═══════════════════════════════════════════════════════════════

function rankCandidates(candidates) {
    return candidates
        .filter(c => !c.capitalBlocked)
        .sort((a, b) => {
            // Primary: force alignment (3/3 > 2/3 > 1/3)
            if (b.forces.aligned !== a.forces.aligned) return b.forces.aligned - a.forces.aligned;
            // Secondary: fewer forces against
            if (a.forces.against !== b.forces.against) return a.forces.against - b.forces.against;
            // Tertiary: EV — sweet spot trades (higher credit, moderate prob) rank higher
            if (Math.abs(b.ev - a.ev) > 100) return b.ev - a.ev;
            // Quaternary: probability as tiebreaker
            return b.probProfit - a.probProfit;
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
        const today = new Date().toISOString().split('T')[0];
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

        // Direction intelligence (use yesterdayHistory to avoid comparing today with today)
        STATE.contrarianPCR = getContrarianPCR(STATE.bnfChain.nearAtmPCR || STATE.bnfChain.pcr, STATE.yesterdayHistory);
        STATE.fiiTrend = getFiiShortTrend(STATE.morningInput?.fiiShortPct, STATE.yesterdayHistory);
        STATE.trajectory = getSessionTrajectory(STATE.yesterdayHistory);

        // Generate candidates
        statusEl.textContent = 'Generating candidates...';
        const bnfCandidates = generateCandidates(
            STATE.bnfChain, spots.bnfSpot, 'BNF', STATE.bnfExpiry, spots.vix, biasResult, ivPctl
        );
        const nfCandidates = generateCandidates(
            STATE.nfChain, spots.nfSpot, 'NF', STATE.nfExpiry, spots.vix, biasResult, ivPctl
        );

        const allCandidates = [...bnfCandidates, ...nfCandidates];
        STATE.candidates = rankCandidates(allCandidates);
        STATE.watchlist = STATE.candidates.slice(0, 6); // top 6
        dbg('CANDIDATES', {
            bnf: bnfCandidates.length, nf: nfCandidates.length, total: allCandidates.length,
            ranked: STATE.candidates.length, watchlist: STATE.watchlist.length,
            top3: STATE.watchlist.slice(0, 3).map(c => `${c.type} ${c.forces.aligned}/3 ${c.sellStrike}/${c.buyStrike}`)
        });

        // Set baseline
        const bnfTDTE = API.tradingDTE(STATE.bnfExpiry);
        const bnfT = bnfTDTE / BS.DAYS_PER_YEAR;
        const bnfAtmIvDec = STATE.bnfChain.atmIv ? (STATE.bnfChain.atmIv > 1 ? STATE.bnfChain.atmIv / 100 : STATE.bnfChain.atmIv) : (spots.vix / 100);
        const bnfAtmTheta = BS.theta(spots.bnfSpot, STATE.bnfChain.atm, bnfT, bnfAtmIvDec, 'CE') + BS.theta(spots.bnfSpot, STATE.bnfChain.atm, bnfT, bnfAtmIvDec, 'PE');
        const dailySigmaBnf = BS.dailySigma(spots.bnfSpot, spots.vix);
        const yesterdayVix = STATE.yesterdayHistory?.length > 0 ? STATE.yesterdayHistory[0]?.vix : null;

        // NF theta + DTE (same computation as BNF, different chain)
        const nfTDTE = API.tradingDTE(STATE.nfExpiry);
        const nfT = nfTDTE / BS.DAYS_PER_YEAR;
        const nfAtmIvDec = STATE.nfChain.atmIv ? (STATE.nfChain.atmIv > 1 ? STATE.nfChain.atmIv / 100 : STATE.nfChain.atmIv) : (spots.vix / 100);
        const nfAtmTheta = BS.theta(spots.nfSpot, STATE.nfChain.atm, nfT, nfAtmIvDec, 'CE') + BS.theta(spots.nfSpot, STATE.nfChain.atm, nfT, nfAtmIvDec, 'PE');

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
            futuresPremBnf: STATE.bnfChain.futuresPremium,
            bias: biasResult.label,
            biasNet: biasResult.net
        }, 'morning');

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
            // Accumulate accuracy in localStorage
            const accKey = 'mr2_signal_accuracy';
            let accHistory = [];
            try { accHistory = JSON.parse(localStorage.getItem(accKey) || '[]'); } catch(e) {}
            // Don't duplicate same date
            if (!accHistory.find(h => h.date === STATE.signalValidation.date)) {
                accHistory.push({
                    date: STATE.signalValidation.date,
                    predicted: STATE.signalValidation.predicted,
                    actual: STATE.signalValidation.actualDir,
                    correct: STATE.signalValidation.correct
                });
                // Keep last 30
                if (accHistory.length > 30) accHistory = accHistory.slice(-30);
                localStorage.setItem(accKey, JSON.stringify(accHistory));
            }
            const correct = accHistory.filter(h => h.correct).length;
            STATE.signalAccuracyStats = { correct, total: accHistory.length, pct: accHistory.length > 0 ? Math.round(correct / accHistory.length * 100) : 0 };
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
                STATE.positioningCandidates = rankCandidates([...posBnf, ...posNf]).slice(0, 10);
                // Restore positioning comparison for display
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

        // Update contrarian PCR with live near-ATM PCR
        STATE.contrarianPCR = getContrarianPCR(bnfChain.nearAtmPCR || bnfChain.pcr, STATE.yesterdayHistory);

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
            const tradeLabel = `${trade.index_key} ${friendlyType(trade.strategy_type)} ${trade.sell_strike}`;
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
                const cushion = Math.abs(trade.sell_strike - trade.current_spot);
                const width = trade.width || 300;
                if (cushion < width && !trade._notifiedCushion) {
                    trade._notifiedCushion = true;
                    sendNotification('⚡ Spot Near Sold Strike', `${tradeLabel} Only ${cushion} pts cushion. Sold: ${trade.sell_strike}, Spot: ${trade.current_spot.toFixed(0)}`, 'urgent');
                }
            }
        }

        // Save CLOSE snapshot — upserts by (date, 'close'), last poll = closing data
        const today = new Date().toISOString().split('T')[0];
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
            futuresPremBnf: bnfChain.futuresPremium,
            bias: STATE.live.bias?.label,
            biasNet: STATE.live.bias?.net
        }, 'close');

        STATE.pollCount++;
        STATE.lastPollTime = Date.now();

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

    // Update peak
    if (!trade.peak_pnl || trade.current_pnl > trade.peak_pnl) {
        trade.peak_pnl = trade.current_pnl;
    }

    // Force alignment for position
    const vixHistory = STATE.premiumHistory.map(p => p.vix).filter(Boolean);
    const ivPctl = BS.ivPercentile(spots.vix, vixHistory);
    trade.forces = getForceAlignment(trade.strategy_type, STATE.live.bias, spots.vix, ivPctl);

    // Update in Supabase
    DB.updateTrade(trade.id, {
        current_pnl: trade.current_pnl,
        current_spot: trade.current_spot,
        peak_pnl: trade.peak_pnl,
        current_premium: trade.current_premium
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
            const today = new Date().toISOString().split('T')[0];
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

                // ═══ GLOBAL CONTEXT BOOST — adjusts signal strength ═══
                if (STATE.tomorrowSignal && STATE.tomorrowSignal.signal !== 'NEUTRAL') {
                    const gc = STATE.globalContext;
                    const isBull = STATE.tomorrowSignal.signal === 'BULLISH';
                    let boost = 0;
                    const THRESHOLD = 0.2;

                    if (gc.giftNifty !== null && Math.abs(gc.giftNifty) >= THRESHOLD) {
                        if ((gc.giftNifty > 0 && isBull) || (gc.giftNifty < 0 && !isBull)) boost++;
                        else boost--;
                    }
                    if (gc.europe !== null && Math.abs(gc.europe) >= THRESHOLD) {
                        if ((gc.europe > 0 && isBull) || (gc.europe < 0 && !isBull)) boost++;
                        else boost--;
                    }
                    if (gc.crude !== null && Math.abs(gc.crude) >= THRESHOLD) {
                        if ((gc.crude < 0 && isBull) || (gc.crude > 0 && !isBull)) boost++;
                        else boost--;
                    }

                    if (boost !== 0) {
                        STATE.tomorrowSignal.strength = Math.max(1, Math.min(5, STATE.tomorrowSignal.strength + boost));
                        STATE.tomorrowSignal.globalBoost = boost;
                    }
                }

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

            STATE.positioningCandidates = allPosCands.slice(0, 10);
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
    if (STATE.isWatching) return;
    STATE.isWatching = true;
    STATE.lastRoutineNotify = Date.now();

    // Start native foreground service (keeps app alive in APK)
    if (window.NativeBridge && window.NativeBridge.isNative()) {
        try { window.NativeBridge.startMarketService(); } catch(e) {}
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
            const el = document.getElementById('watch-status');
            if (el) el.textContent = '⏸ Market closed';
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
        try { window.NativeBridge.stopMarketService(); } catch(e) {}
    }

    document.getElementById('watch-status').textContent = '⏹ Stopped';
    document.getElementById('btn-stop').style.display = 'none';
}


// ═══════════════════════════════════════════════════════════════
// TRADE MANAGEMENT
// ═══════════════════════════════════════════════════════════════

async function takeTrade(candidateId) {
    const cand = STATE.watchlist.find(c => c.id === candidateId)
        || STATE.candidates.find(c => c.id === candidateId)
        || STATE.positioningCandidates.find(c => c.id === candidateId);
    if (!cand) { console.warn('takeTrade: candidate not found:', candidateId); return; }

    const trade = {
        strategy_type: cand.type,
        index_key: cand.index,
        expiry: cand.expiry,
        entry_date: new Date().toISOString(),
        entry_spot: cand.index === 'BNF' ? STATE.live.bnfSpot : STATE.live.nfSpot,
        entry_vix: STATE.live.vix,
        entry_atm_iv: cand.index === 'BNF' ? STATE.live.bnfAtmIv : STATE.live.nfAtmIv,
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
        entry_pcr: cand.index === 'BNF' ? STATE.live.pcr : (STATE.live.nfPcr || STATE.nfChain?.pcr),
        entry_futures_premium: cand.index === 'BNF' ? STATE.live.futuresPremBnf : (STATE.live.futuresPremNf || STATE.nfChain?.futuresPremium),
        entry_max_pain: cand.index === 'BNF' ? (STATE.live.maxPainBnf || STATE.bnfChain?.maxPain) : (STATE.nfChain?.maxPain || STATE.baseline?.maxPainNf),
        entry_sell_oi: (() => { const ch = cand.index === 'BNF' ? STATE.bnfChain : STATE.nfChain; return ch?.strikes[cand.sellStrike]?.[cand.sellType]?.oi || null; })(),
        entry_bias: STATE.live.bias?.label,
        entry_bias_net: STATE.live.bias?.net,
        prob_profit: cand.probProfit,
        status: 'OPEN',
        current_pnl: 0,
        peak_pnl: 0,
        lots: 1
    };

    const saved = await DB.insertTrade(trade);
    if (saved) {
        trade.id = saved.id;
        STATE.openTrades.push(trade);
        playSound('entry');
        switchTab('positions');
        renderAll();
    }
}

async function logManualTrade() {
    const type = document.getElementById('mt-type').value;
    const indexKey = document.getElementById('mt-index').value;
    const sellStrike = parseFloat(document.getElementById('mt-sell').value);
    const buyStrike = parseFloat(document.getElementById('mt-buy').value);
    const sellLTP = parseFloat(document.getElementById('mt-sell-ltp').value);
    const buyLTP = parseFloat(document.getElementById('mt-buy-ltp').value);

    if (!sellStrike || !buyStrike || !sellLTP || !buyLTP) {
        alert('Please fill all fields');
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
        entry_max_pain: indexKey === 'BNF' ? (STATE.live?.maxPainBnf || STATE.bnfChain?.maxPain) : (STATE.nfChain?.maxPain || null),
        entry_sell_oi: (() => { const ch = indexKey === 'BNF' ? STATE.bnfChain : STATE.nfChain; return ch?.strikes[sellStrike]?.[sellType]?.oi || null; })(),
        entry_bias: STATE.live?.bias?.label || STATE.baseline?.bias?.label,
        entry_bias_net: STATE.live?.bias?.net || STATE.baseline?.bias?.net,
        status: 'OPEN',
        current_pnl: 0,
        peak_pnl: 0,
        lots: 1
    };

    const saved = await DB.insertTrade(trade);
    if (saved) {
        trade.id = saved.id;
        STATE.openTrades.push(trade);
        playSound('entry');
        switchTab('positions');
        renderAll();
        // Start watch loop for live P&L tracking
        if (!STATE.isWatching) startWatchLoop();
    }
}

async function closeTrade(tradeId, exitReason) {
    const trade = STATE.openTrades.find(t => t.id === tradeId);
    if (!trade) return;

    await DB.updateTrade(trade.id, {
        status: 'CLOSED',
        exit_date: new Date().toISOString(),
        actual_pnl: trade.current_pnl,
        exit_premium: trade.current_premium,
        exit_reason: exitReason || 'Manual',
        exit_vix: STATE.live?.vix,
        exit_atm_iv: trade.index_key === 'NF' ? (STATE.live?.nfAtmIv || STATE.nfChain?.atmIv) : STATE.live?.bnfAtmIv,
        exit_force_alignment: trade.forces?.aligned
    });

    addNotificationLog('Trade Closed', `${trade.index_key} ${friendlyType(trade.strategy_type)} ${trade.sell_strike} P&L: ₹${trade.current_pnl}. Reason: ${exitReason || 'Manual'}`, trade.current_pnl >= 0 ? 'entry' : 'urgent');
    STATE.openTrades = STATE.openTrades.filter(t => t.id !== tradeId);
    renderAll();
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
        marginUsed += t.is_credit ? Math.round((t.width - t.entry_premium) * (t.index_key === 'BNF' ? C.BNF_LOT : C.NF_LOT) * 1.2) : t.max_loss;
    }
    const available = C.CAPITAL - marginUsed;

    if (capEl) capEl.textContent = `₹${(C.CAPITAL / 1000).toFixed(1)}K`;
    if (marginEl) marginEl.textContent = marginUsed > 0 ? `Blocked: ₹${(marginUsed / 1000).toFixed(1)}K · Free: ₹${(available / 1000).toFixed(1)}K` : `Free: ₹${(C.CAPITAL / 1000).toFixed(1)}K`;

    if (pnlEl && STATE.openTrades.length > 0) {
        const pnl = STATE.openTrades.reduce((s, t) => s + (t.current_pnl || 0), 0);
        pnlEl.textContent = `P&L: ${pnl >= 0 ? '+' : ''}₹${pnl}`;
        pnlEl.className = pnl >= 0 ? 'ticker-pnl-pos' : 'ticker-pnl-neg';
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
        ydayComparisons = items.map(i => `<span class="signal-chip signal-neutral">${i}</span>`).join('');
    }

    const scanTime = API.istNow();

    el.innerHTML = `
        <!-- TIMESTAMP -->
        <div class="section-timestamp">Scanned: ${scanTime}${STATE.pollCount > 0 ? ` · Poll #${STATE.pollCount}` : ''}</div>

        <!-- VERDICT -->
        <div class="env-verdict ${verdictClass}">${verdict}</div>

        <!-- GAP CLASSIFICATION -->
        ${STATE.gapInfo && STATE.gapInfo.type !== 'UNKNOWN' ? `
        <div class="env-row" style="padding: 6px 0;">
            <span class="env-row-label">Today's Gap</span>
            <span class="env-row-value" style="color: ${STATE.gapInfo.gap > 0 ? 'var(--green)' : STATE.gapInfo.gap < 0 ? 'var(--danger)' : 'var(--text-muted)'}">
                ${STATE.gapInfo.gap > 0 ? '+' : ''}${STATE.gapInfo.gap} pts (${STATE.gapInfo.pct}%, ${STATE.gapInfo.sigma}σ) — ${STATE.gapInfo.type.replace('_', ' ')}
            </span>
        </div>
        ${Math.abs(STATE.gapInfo.sigma) > 1 ? `<div class="traj-alert warn">⚡ ${STATE.gapInfo.sigma > 0 ? 'Gap-up' : 'Gap-down'} > 1σ — premium is inflated. Credit sellers: enter now. Debit buyers: WAIT for IV to settle.</div>` : ''}
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

        <!-- FORCE 3: IV / VOLATILITY — both indices -->
        <div class="env-section-title">Force 3 — IV & Volatility</div>
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

        <!-- FORCE 1: DIRECTION / INTRINSIC -->
        <div class="env-section-title">Force 1 — Direction & Intrinsic</div>
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

        <!-- RANGE BUDGET — Both indices -->
        <div class="env-section-title">Range Budget — σ Framework</div>
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

        ${yday ? `
        <!-- OVERNIGHT: Yesterday Close → Today Morning -->
        <details>
            <summary class="env-section-title" style="cursor:pointer; user-select:none;">🌙 Overnight ▸</summary>
            <div class="env-signals">${ydayComparisons || '<span class="signal-chip signal-neutral">No comparison data</span>'}</div>
        </details>
        ` : ''}

        ${STATE.pollCount > 0 ? `
        <!-- INTRADAY: Morning → Now -->
        <div class="env-section-title">📈 Intraday (morning → now)</div>
        <div class="env-signals">
            ${b.vix && l.vix ? `<span class="signal-chip signal-${Math.abs(l.vix - b.vix) > 0.5 ? (l.vix > b.vix ? 'bear' : 'bull') : 'neutral'}">VIX: ${b.vix.toFixed(1)}→${l.vix.toFixed(1)} (${(l.vix - b.vix) > 0 ? '+' : ''}${(l.vix - b.vix).toFixed(1)})</span>` : ''}
            ${b.bnfSpot && l.bnfSpot ? `<span class="signal-chip signal-${Math.abs(l.bnfSpot - b.bnfSpot) > 100 ? (l.bnfSpot > b.bnfSpot ? 'bull' : 'bear') : 'neutral'}">BNF: ${b.bnfSpot.toFixed(0)}→${l.bnfSpot.toFixed(0)} (${(l.bnfSpot - b.bnfSpot) > 0 ? '+' : ''}${(l.bnfSpot - b.bnfSpot).toFixed(0)})</span>` : ''}
            ${b.pcr && l.pcr ? `<span class="signal-chip signal-neutral">PCR: ${b.pcr.toFixed(2)}→${l.pcr.toFixed(2)}</span>` : ''}
            ${l.spotSigma !== undefined ? `<span class="sigma-badge">Spot: ${l.spotSigma}σ</span>` : ''}
            ${l.vixSigma !== undefined ? `<span class="sigma-badge">VIX: ${l.vixSigma}σ</span>` : ''}
        </div>
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
    const bnfCallOI = l.bnfTotalCallOI || b.bnfTotalCallOI || 0;
    const bnfPutOI = l.bnfTotalPutOI || b.bnfTotalPutOI || 0;
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
    const nfCallOI = nfc?.totalCallOI || 0;
    const nfPutOI = nfc?.totalPutOI || 0;
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

        <!-- INTELLIGENCE SECTION (moved from Trade tab) -->
        ${STATE.contrarianPCR?.length ? `
        <div class="env-section-title">⚡ Contrarian Alert</div>
        ${STATE.contrarianPCR.map(f => `<div class="traj-alert ${f.severity === 'high' ? 'warn' : ''}">${f.text}</div>`).join('')}
        ` : ''}

        ${STATE.fiiTrend ? `
        <div class="env-section-title">📊 FII Short% Trend</div>
        <div class="env-row">
            <span class="env-row-label">3-Session</span>
            <span class="env-row-value" style="color:${STATE.fiiTrend.trend === 'COVERING' ? 'var(--green)' : STATE.fiiTrend.trend === 'BUILDING' ? 'var(--danger)' : 'var(--warn)'}">
                ${STATE.fiiTrend.label}${STATE.fiiTrend.accel ? ' ACCELERATING' : ''}${STATE.fiiTrend.aggressive ? ' ⚠️ AGGRESSIVE' : ''}
            </span>
        </div>
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

    // Count executable (2/3+ alignment)
    const executable = STATE.candidates.filter(c => c.forces.aligned >= 2 && !c.capitalBlocked).length;
    const total = STATE.candidates.length;

    // ═══ GO VERDICT BANNER ═══
    const biasLabel = STATE.live?.bias?.label || STATE.baseline?.bias?.label || 'NEUTRAL';
    const vix = STATE.live?.vix || STATE.baseline?.vix || 0;
    const goClass = executable >= 3 ? 'go-banner go-green' : executable >= 1 ? 'go-banner go-yellow' : 'go-banner go-grey';
    const goIcon = executable >= 3 ? '✅' : executable >= 1 ? '🟡' : '⏹';

    let html = `<div class="${goClass}">
        <div class="go-title">${goIcon} ${executable >= 1 ? 'GO' : 'WAIT'}</div>
        <div class="go-detail">${executable} executable (of ${total} viable) · VIX: ${vix.toFixed(1)} · Bias: ${biasLabel}</div>
    </div>`;

    // ═══ GLOBAL CONTEXT INPUTS ═══
    html += `<div class="global-context-section">
        <div class="gc-title">🌍 Global Context</div>
        <div class="global-context-grid">
            <div class="input-group compact">
                <label>GIFT %</label>
                <input type="text" inputmode="text" id="in-gift-nifty" class="input-field input-sm" placeholder="-0.3"
                    value="${STATE.globalContext.giftNifty ?? ''}">
            </div>
            <div class="input-group compact">
                <label>Europe %</label>
                <input type="text" inputmode="text" id="in-europe" class="input-field input-sm" placeholder="+0.5"
                    value="${STATE.globalContext.europe ?? ''}">
            </div>
            <div class="input-group compact">
                <label>Crude %</label>
                <input type="text" inputmode="text" id="in-crude" class="input-field input-sm" placeholder="-1.2"
                    value="${STATE.globalContext.crude ?? ''}">
            </div>
        </div>
    </div>`;

    // ═══ POSITIONING TRADES (after 3:15 PM) ═══
    if (STATE.positioningCandidates?.length > 0 && STATE.tomorrowSignal) {
        const sig = STATE.tomorrowSignal;
        const sigColor = sig.signal === 'BEARISH' ? 'var(--danger)' : sig.signal === 'BULLISH' ? 'var(--green)' : 'var(--warn)';
        html += `<div class="tomorrow-signal" style="border-color:${sigColor}; margin:12px 0">
            <div class="signal-label">⚡ POSITION FOR TOMORROW</div>
            <div class="signal-value" style="color:${sigColor}">${sig.signal} (${sig.strength}/5)</div>
        </div>`;

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
        html += '<hr class="strat-divider">';
    }

    // ═══ BANK NIFTY — TOP 5 ═══
    const bnfCands = STATE.watchlist.filter(c => c.index === 'BNF');
    html += '<div class="strat-header">BANK NIFTY — TOP 5</div>';
    if (bnfCands.length) {
        bnfCands.forEach((c, i) => { html += renderCandidateCard(c, bnfAtm, i + 1); });
    } else {
        html += '<div class="empty-state">No BNF candidates</div>';
    }

    // ═══ NIFTY 50 — TOP 5 ═══
    const nfCands = STATE.candidates.filter(c => c.index === 'NF' && !c.capitalBlocked).slice(0, 5);
    const nfBlocked = STATE.candidates.some(c => c.index === 'NF' && c.capitalBlocked);
    html += '<div class="strat-header">NIFTY 50 — TOP 5</div>';
    if (nfCands.length) {
        nfCands.forEach((c, i) => { html += renderCandidateCard(c, nfAtm, i + 1); });
    } else if (nfBlocked) {
        html += '<div class="empty-state">NF credit needs ~₹97K margin. Capital insufficient.</div>';
    } else {
        html += '<div class="empty-state">No NF candidates</div>';
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
    const thetaLabel = cand.netTheta >= 0 ? `+₹${cand.netTheta}/day` : `-₹${Math.abs(cand.netTheta)}/day`;

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
            </div>
            <span class="v1-rank">#${rank || ''}</span>
        </div>
        <div class="v1-sub">${cand.index} · ${cand.expiry || '--'} · DTE ${cand.tDTE || '--'}T</div>
        <div class="v1-legs">${legsText}</div>
        <div class="v1-prem">${premLabel} ₹${cand.netPremium}/share · W:${cand.width}</div>

        <div class="v1-metrics">
            <div class="v1-metric"><span class="v1-label">Max Profit</span><span class="v1-val green">₹${cand.maxProfit.toLocaleString()}</span></div>
            <div class="v1-metric"><span class="v1-label">Max Loss</span><span class="v1-val red">₹${cand.maxLoss.toLocaleString()}</span></div>
            <div class="v1-metric"><span class="v1-label">R:R</span><span class="v1-val">${cand.riskReward || '--'}</span></div>
            <div class="v1-metric"><span class="v1-label">P(Profit)</span><span class="v1-val">${(cand.probProfit * 100).toFixed(1)}%</span></div>
        </div>

        <div class="v1-target">🎯 Target: ₹${cand.targetProfit?.toLocaleString() || '--'} | 🔴 SL: ₹${cand.stopLoss?.toLocaleString() || '--'}</div>

        <div class="v1-forces">
            Δ ${forceIcon(forces.f1)} Direction  Θ ${forceIcon(forces.f2)} Time  IV ${forceIcon(forces.f3)} Vol
        </div>

        <div class="v1-greeks">Δ ${cand.netDelta != null ? cand.netDelta : '--'} · θ ${(cand.netTheta / (cand.lotSize || 30)).toFixed(2)} · Θ/day: ${thetaLabel}</div>
        <div class="v1-footer">EV: ₹${cand.ev.toLocaleString()} | W:${cand.width} | Margin: ₹${cand.margin?.toLocaleString() || '--'}</div>

        <div class="v1-align ${alignClass}">${alignLabel}</div>
        ${forces.aligned >= 2 ? `<button class="btn-take" onclick="takeTrade('${cand.id}')">📌 I TOOK THIS TRADE</button>` : ''}
    </div>`;
}

function renderPosition() {
    const el = document.getElementById('position');
    if (!el) return;

    let html = '';
    const lastUpdate = STATE.lastPollTime ? new Date(STATE.lastPollTime).toLocaleTimeString('en-IN', { timeZone: 'Asia/Kolkata', hour: '2-digit', minute: '2-digit', hour12: true }) : '';

    // ═══ SIGNAL ACCURACY (if available) ═══
    if (STATE.signalValidation) {
        const sv = STATE.signalValidation;
        html += `<div class="signal-accuracy-card">
            <div class="env-section-title">📡 Yesterday's Signal</div>
            <div class="env-row"><span class="env-row-label">Predicted</span><span class="env-row-value">${sv.predicted} (${sv.strength}/5)</span></div>
            <div class="env-row"><span class="env-row-label">Actual Gap</span><span class="env-row-value" style="color:${sv.correct ? 'var(--green)' : 'var(--danger)'}">${sv.actualGap > 0 ? '+' : ''}${sv.actualGap?.toFixed(0)} pts → ${sv.actualDir} ${sv.correct ? '✅' : '❌'}</span></div>
            ${STATE.signalAccuracyStats ? `<div class="env-row"><span class="env-row-label">Accuracy</span><span class="env-row-value" style="color:var(--accent)">${STATE.signalAccuracyStats.correct}/${STATE.signalAccuracyStats.total} (${STATE.signalAccuracyStats.pct}%)</span></div>` : ''}
        </div>`;
    }

    // ═══ OPEN TRADES ═══
    if (STATE.openTrades.length === 0) {
        html += '<div class="empty-state">No open positions</div>';
    } else {
        // Total P&L bar if multiple trades
        if (STATE.openTrades.length > 1) {
            const totalPnL = STATE.openTrades.reduce((s, t) => s + (t.current_pnl || 0), 0);
            const totalClass = totalPnL >= 0 ? 'pnl-pos' : 'pnl-neg';
            html += `<div class="total-pnl-bar ${totalClass}">Total P&L: ₹${totalPnL.toLocaleString()} (${STATE.openTrades.length} positions)</div>`;
        }

        html += `<div class="section-timestamp">Last updated: ${lastUpdate || API.istNow()}</div>`;

        for (const t of STATE.openTrades) {
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

            html += `
            <div class="position-card">
                <div class="pos-header">
                    <span class="pos-title">📌 ${t.index_key} ${friendlyType(t.strategy_type)}</span>
                    <span class="pos-strikes">${t.sell_strike}/${t.buy_strike} W:${t.width}</span>
                </div>
                <div class="pos-pnl ${pnlClass}">
                    P&L: ₹${t.current_pnl?.toLocaleString() || 0}
                    ${t.peak_pnl > 0 ? `<span class="pos-peak">(peak ₹${t.peak_pnl.toLocaleString()})</span>` : ''}
                </div>
                <div class="pos-detail">
                    Entry: ₹${t.entry_premium} ${t.is_credit ? 'credit' : 'debit'}
                    · Now: ₹${t.current_premium || '--'}
                    · Spot: ${t.current_spot?.toFixed(0) || '--'}
                </div>
                <div class="pos-forces">
                    ${dots} ${forceIcon(forces.f1)} Direction ${forceIcon(forces.f2)} Time ${forceIcon(forces.f3)} Vol
                </div>
                <div class="control-section">
                    <div class="env-row">
                        <span class="env-row-label">Control Index</span>
                        <span class="env-row-value" style="color:${ciColor}">${ci !== null && ci !== undefined ? ci : '--'} · ${ciLabel}</span>
                    </div>
                    <div class="control-bar">
                        <div class="control-fill" style="width:${ciPct}%; background:${ciColor}"></div>
                    </div>
                </div>
                <div class="pos-detail">
                    Entry VIX: ${t.entry_vix?.toFixed(1) || '--'} · Bias: ${t.entry_bias || '--'} · Forces: ${t.force_alignment}/3
                </div>
                <div class="pos-actions">
                    <button class="btn-close-profit" onclick="closeTrade('${t.id}', 'Profit booked')">💰 Book Profit</button>
                    <button class="btn-close-loss" onclick="closeTrade('${t.id}', 'Stop loss')">🛑 Exit</button>
                </div>
            </div>`;
        }
    }

    // ═══ MANUAL TRADE FORM — always visible ═══
    html += `
    <div class="manual-trade-form" style="margin-top:12px">
        <div class="env-section-title">📝 Log Manual Trade</div>
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
        <button class="btn-primary" onclick="logManualTrade()" style="margin-top:8px">📌 Log This Trade</button>
    </div>`;

    el.innerHTML = html;
}

function renderFooter() {
    const el = document.getElementById('footer-status');
    if (!el) return;
    const time = API.istNow();
    const watching = STATE.isWatching ? '🟢' : '⏹';
    const polls = STATE.pollCount;
    el.textContent = `${watching} ${time} · Polls: ${polls} · Candidates: ${STATE.candidates.length}`;
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

    const fiiCash = document.getElementById('in-fii-cash').value;
    const fiiShortPct = document.getElementById('in-fii-short').value;
    const upstoxBias = document.getElementById('in-upstox-bias')?.value || '';

    // closeChar will be auto-calculated from yesterday's OHLC
    STATE.morningInput = { fiiCash, fiiShortPct, upstoxBias };

    // Save to localStorage for restore
    localStorage.setItem('mr2_morning', JSON.stringify({ ...STATE.morningInput, date: new Date().toISOString().split('T')[0] }));

    // Disable inputs
    document.querySelectorAll('.morning-input').forEach(el => el.disabled = true);
    document.getElementById('btn-lock').disabled = true;
    document.getElementById('btn-lock').textContent = '⏳ Scanning...';

    initialFetch();
}

function restoreMorningData() {
    const saved = localStorage.getItem('mr2_morning');
    if (!saved) return;
    try {
        const data = JSON.parse(saved);
        // Only restore if saved today
        const today = new Date().toISOString().split('T')[0];
        if (data.date && data.date !== today) return;
        if (data.fiiCash) document.getElementById('in-fii-cash').value = data.fiiCash;
        if (data.fiiShortPct) document.getElementById('in-fii-short').value = data.fiiShortPct;
        if (data.upstoxBias) {
            const el = document.getElementById('in-upstox-bias');
            if (el) el.value = data.upstoxBias;
        }
    } catch (e) { /* ignore */ }
}

// Token is hardcoded via Analytics Token in api.js — no UI needed

function restoreGlobalContext() {
    try {
        const saved = localStorage.getItem('mr2_global_context');
        if (saved) {
            STATE.globalContext = JSON.parse(saved);
        }
    } catch (e) { /* ignore */ }
}

async function loadOpenTrade() {
    const trades = await DB.getOpenTrades();
    STATE.openTrades = trades || [];
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
    collapsed.innerHTML = `<div class="morning-collapsed-bar" onclick="expandMorning()">
        ☀️ FII ₹${fii}Cr · Short ${short}% · Scanned ${time}
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

// ═══ INIT ═══
document.addEventListener('DOMContentLoaded', async () => {
    DB.init();
    restoreMorningData();
    restoreGlobalContext();
    initTheme();
    await loadOpenTrade();

    // If open trades exist, show positions tab
    if (STATE.openTrades.length > 0) {
        switchTab('positions');
    }

    renderAll();

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

    // Global Context inputs — live update on change + auto-save to localStorage
    document.addEventListener('change', (e) => {
        if (e.target.id === 'in-gift-nifty') {
            STATE.globalContext.giftNifty = e.target.value ? parseFloat(e.target.value) : null;
        } else if (e.target.id === 'in-europe') {
            STATE.globalContext.europe = e.target.value ? parseFloat(e.target.value) : null;
        } else if (e.target.id === 'in-crude') {
            STATE.globalContext.crude = e.target.value ? parseFloat(e.target.value) : null;
        } else { return; }
        // Auto-save to localStorage
        localStorage.setItem('mr2_global_context', JSON.stringify(STATE.globalContext));
    });

    // Theme toggle — light is default, dark is toggled
    document.getElementById('theme-switch')?.addEventListener('change', (e) => {
        const isDark = e.target.checked;
        document.body.classList.toggle('dark', isDark);
        localStorage.setItem('mr2_theme', isDark ? 'dark' : 'light');
        document.querySelector('.toggle-icon').textContent = isDark ? '🌙' : '☀️';
        document.querySelector('meta[name="theme-color"]').content = isDark ? '#121218' : '#FFFFFF';
    });
});

function initTheme() {
    const saved = localStorage.getItem('mr2_theme');
    if (saved === 'dark') {
        document.body.classList.add('dark');
        const toggle = document.getElementById('theme-switch');
        if (toggle) toggle.checked = true;
        const icon = document.querySelector('.toggle-icon');
        if (icon) icon.textContent = '🌙';
        document.querySelector('meta[name="theme-color"]').content = '#121218';
    }
}
