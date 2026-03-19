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
    MAX_RISK_PCT: 5,
    NF_LOT: 65,
    BNF_LOT: 30,
    NF_MARGIN_EST: 97000,
    BNF_MARGIN_EST: 28000,

    // Width options for candidate generation
    NF_WIDTHS: [100, 150, 200, 250, 300, 400],
    BNF_WIDTHS: [200, 300, 400, 500, 600, 800, 1000],

    // NF is secondary due to margin constraint. BNF is primary.
    // NF only recommended when margin < 70% capital
    NF_MARGIN_THRESHOLD: 0.7,

    // Polling intervals
    POLL_INTERVAL_MS: 5 * 60 * 1000,       // 5 min light fetch
    ROUTINE_NOTIFY_MS: 30 * 60 * 1000,     // 30 min routine notification

    // σ thresholds for notifications — ADAPTIVE, not hardcoded
    // These are statistical thresholds, not point values
    // The actual point values change with VIX and elapsed time
    SIGMA_ENTRY_THRESHOLD: 1.5,     // >1.5σ move triggers re-evaluation
    SIGMA_EXIT_THRESHOLD: 1.0,      // tighter for open positions
    SIGMA_IMPORTANT_THRESHOLD: 2.0, // >2σ = immediate important notification

    // Time gates (minutes since 9:15)
    NOISE_WINDOW: 15,    // first 15 min = suppress entry signals
    SWEET_SPOT_START: 135, // 11:30 AM — institutional flow visible
    SWEET_SPOT_END: 315,   // 14:30
    LAST_ENTRY_CUTOFF: 345, // 15:00 — no new entries in last 30 min

    // Force alignment labels
    FORCE_LABELS: { 1: '✅', 0: '⚠️', '-1': '❌' },

    // IV regime thresholds (VIX-based)
    IV_LOW: 15,
    IV_NORMAL_LOW: 16,
    IV_NORMAL_HIGH: 19,
    IV_HIGH: 20,
    IV_VERY_HIGH: 24,

    // Strategy types
    CREDIT_TYPES: ['BEAR_CALL', 'BULL_PUT'],
    DEBIT_TYPES: ['BEAR_PUT', 'BULL_CALL']
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

    // Open trade
    openTrade: null,

    // Premium history (from Supabase, for IV percentile)
    premiumHistory: [],

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

    // Active tab
    activeTab: 'data'
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

    // DEBUG: Log what morning data looks like
    console.log('[BIAS] morning input:', JSON.stringify(morning));
    console.log('[BIAS] chainData keys:', chainData ? Object.keys(chainData) : 'null');

    // Guard
    if (!morning) {
        console.warn('[BIAS] morning is null/undefined!');
        return { bias: 'NEUTRAL', strength: '', net: 0, votes, signals, label: 'NEUTRAL' };
    }

    // 1. FII Cash
    const fiiCashVal = morning.fiiCash;
    if (fiiCashVal != null && fiiCashVal !== '' && !isNaN(fiiCashVal)) {
        const fc = parseFloat(fiiCashVal);
        if (fc > 500) { votes.bull++; signals.push({ name: 'FII Cash', value: `₹${fc}Cr`, dir: 'BULL' }); }
        else if (fc < -500) { votes.bear++; signals.push({ name: 'FII Cash', value: `₹${fc}Cr`, dir: 'BEAR' }); }
        else signals.push({ name: 'FII Cash', value: `₹${fc}Cr`, dir: 'NEUTRAL' });
    } else {
        console.warn('[BIAS] FII Cash skipped:', typeof fiiCashVal, `"${fiiCashVal}"`);
    }

    // 2. FII Short%
    const fiiShortVal = morning.fiiShortPct;
    if (fiiShortVal != null && fiiShortVal !== '' && !isNaN(fiiShortVal)) {
        const sp = parseFloat(fiiShortVal);
        const prev = parseFloat(localStorage.getItem('mr2_fii_short_prev') || '0');
        if (sp > 85 && sp >= prev) { votes.bear++; signals.push({ name: 'FII Short%', value: `${sp}%↑`, dir: 'BEAR' }); }
        else if (sp > 85 && sp < prev) { signals.push({ name: 'FII Short%', value: `${sp}%↓ covering`, dir: 'NEUTRAL' }); }
        else if (sp < 70) { votes.bull++; signals.push({ name: 'FII Short%', value: `${sp}%`, dir: 'BULL' }); }
        else signals.push({ name: 'FII Short%', value: `${sp}%`, dir: 'NEUTRAL' });
    } else {
        console.warn('[BIAS] FII Short% skipped:', typeof fiiShortVal, `"${fiiShortVal}"`);
    }

    // 3. Close Character
    const closeCharVal = morning.closeChar;
    if (closeCharVal != null && closeCharVal !== '' && !isNaN(closeCharVal)) {
        const cc = parseFloat(closeCharVal);
        if (cc >= 1) { votes.bull++; signals.push({ name: 'Close Char', value: `${cc > 0 ? '+' : ''}${cc}`, dir: 'BULL' }); }
        else if (cc <= -1) { votes.bear++; signals.push({ name: 'Close Char', value: `${cc}`, dir: 'BEAR' }); }
        else signals.push({ name: 'Close Char', value: `${cc}`, dir: 'NEUTRAL' });
    } else {
        console.warn('[BIAS] Close Char skipped:', typeof closeCharVal, `"${closeCharVal}"`);
    }

    // 4. Upstox Bias
    if (morning.upstoxBias && morning.upstoxBias !== 'Neutral') {
        if (morning.upstoxBias === 'Bullish') { votes.bull++; signals.push({ name: 'Upstox', value: 'Bullish', dir: 'BULL' }); }
        else if (morning.upstoxBias === 'Bearish') { votes.bear++; signals.push({ name: 'Upstox', value: 'Bearish', dir: 'BEAR' }); }
    } else {
        signals.push({ name: 'Upstox', value: 'Neutral', dir: 'NEUTRAL' });
    }

    // 5. PCR (from chain)
    if (chainData?.pcr) {
        const pcr = chainData.pcr;
        if (pcr > 1.2) { votes.bull++; signals.push({ name: 'PCR', value: pcr.toFixed(2), dir: 'BULL' }); }
        else if (pcr < 0.9) { votes.bear++; signals.push({ name: 'PCR', value: pcr.toFixed(2), dir: 'BEAR' }); }
        else signals.push({ name: 'PCR', value: pcr.toFixed(2), dir: 'NEUTRAL' });
    }

    // 6. VIX Direction (vs yesterday from premium history)
    if (STATE.premiumHistory.length > 0 && chainData?.vix) {
        const yesterdayVix = STATE.premiumHistory[0]?.vix;
        if (yesterdayVix) {
            const diff = chainData.vix - yesterdayVix;
            if (diff > 0.3) { votes.bear++; signals.push({ name: 'VIX Dir', value: `${chainData.vix.toFixed(1)} ↑${diff.toFixed(1)}`, dir: 'BEAR' }); }
            else if (diff < -0.3) { votes.bull++; signals.push({ name: 'VIX Dir', value: `${chainData.vix.toFixed(1)} ↓${Math.abs(diff).toFixed(1)}`, dir: 'BULL' }); }
            else signals.push({ name: 'VIX Dir', value: `${chainData.vix.toFixed(1)} →`, dir: 'NEUTRAL' });
        }
    }

    // 7. Futures Premium
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

    return { bias, strength, net, votes, signals, label: `${strength} ${bias}`.trim() };
}


// ═══════════════════════════════════════════════════════════════
// FORCE ALIGNMENT ENGINE — The heart of v2
// ═══════════════════════════════════════════════════════════════

function assessForce1_Intrinsic(strategyType, biasResult) {
    // Does the directional bias support this strategy?
    const isBullStrategy = strategyType === 'BULL_CALL' || strategyType === 'BULL_PUT';
    const isBearStrategy = strategyType === 'BEAR_CALL' || strategyType === 'BEAR_PUT';

    if (biasResult.bias === 'BULL' && isBullStrategy) return 1;
    if (biasResult.bias === 'BEAR' && isBearStrategy) return 1;
    if (biasResult.bias === 'NEUTRAL') return 0;
    // Opposing direction
    if (biasResult.bias === 'BULL' && isBearStrategy) return -1;
    if (biasResult.bias === 'BEAR' && isBullStrategy) return -1;
    return 0;
}

function assessForce2_Theta(strategyType) {
    // Credit = always +1 (theta works for you). Debit = always -1.
    return C.CREDIT_TYPES.includes(strategyType) ? 1 : -1;
}

function assessForce3_IV(strategyType, vix, ivPercentile) {
    // Is the IV environment helping or hurting this strategy?
    const isCredit = C.CREDIT_TYPES.includes(strategyType);
    const isDebit = C.DEBIT_TYPES.includes(strategyType);

    // Determine IV regime
    let regime = 'NORMAL';
    if (vix >= C.IV_HIGH || (ivPercentile !== null && ivPercentile > 65)) regime = 'HIGH';
    if (vix >= C.IV_VERY_HIGH || (ivPercentile !== null && ivPercentile > 85)) regime = 'VERY_HIGH';
    if (vix <= C.IV_LOW || (ivPercentile !== null && ivPercentile < 25)) regime = 'LOW';

    if (regime === 'HIGH' || regime === 'VERY_HIGH') {
        // Premium is expensive. Sellers benefit (IV crush). Buyers overpay.
        return isCredit ? 1 : -1;
    } else if (regime === 'LOW') {
        // Premium is cheap. Buyers get bargains. Sellers get peanuts.
        return isDebit ? 1 : -1;
    }
    return 0; // NORMAL — neither helps nor hurts
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

    // Determine ATM IV for probability calculations
    const atmIv = parsed.atmIv || (vix / 100);
    const vol = atmIv > 1 ? atmIv / 100 : atmIv; // normalize

    // Strike step (derived from chain)
    const allStrikes = parsed.allStrikes;
    const step = allStrikes.length > 1 ? allStrikes[1] - allStrikes[0] : (isBNF ? 100 : 50);

    // Generate spreads
    const stratTypes = ['BEAR_CALL', 'BULL_PUT', 'BEAR_PUT', 'BULL_CALL'];

    for (const sType of stratTypes) {
        for (const width of widths) {
            const strikePairs = getStrikePairs(sType, atm, width, step, allStrikes, spot, isBNF);

            for (const pair of strikePairs) {
                const cand = buildCandidate(sType, pair, parsed.strikes, spot, lotSize, width, T, tDTE, vol, expiry, isBNF);
                if (!cand) continue;

                // Force alignment
                cand.forces = getForceAlignment(sType, biasResult, vix, ivPercentile);
                cand.index = isBNF ? 'BNF' : 'NF';
                cand.expiry = expiry;
                cand.tDTE = tDTE;

                // Capital check
                if (!isBNF) {
                    // NF: check margin constraint
                    if (C.CREDIT_TYPES.includes(sType) && C.NF_MARGIN_EST > C.CAPITAL * C.NF_MARGIN_THRESHOLD) {
                        cand.capitalBlocked = true;
                    }
                }

                candidates.push(cand);
            }
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

function buildCandidate(sType, pair, strikes, spot, lotSize, width, T, tDTE, vol, expiry, isBNF) {
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
    const probProfit = isCredit ? (1 - sellDelta) : sellDelta;
    if (probProfit < 0.30) return null; // minimum viable

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

    const id = `${sType}_${isBNF ? 'BNF' : 'NF'}_${pair.sell}_${pair.buy}_W${width}`;

    return {
        id, type: sType, width,
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
        margin: Math.round(margin),
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
            // Tertiary: probability (survivability)
            if (Math.abs(b.probProfit - a.probProfit) > 0.05) return b.probProfit - a.probProfit;
            // Quaternary: EV per rupee of risk
            const evRiskA = a.ev / a.maxLoss;
            const evRiskB = b.ev / b.maxLoss;
            return evRiskB - evRiskA;
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

        // Load premium history for IV percentile
        statusEl.textContent = 'Loading premium history...';
        STATE.premiumHistory = await DB.getPremiumHistory(60);
        dbg('PREMIUM_HISTORY', { days: STATE.premiumHistory.length, sample: STATE.premiumHistory.slice(0, 3).map(p => `${p.date}:${p.vix}`) });

        // Calculate IV percentile
        const vixHistory = STATE.premiumHistory.map(p => p.vix).filter(Boolean);
        const ivPctl = BS.ivPercentile(spots.vix, vixHistory);
        dbg('IV_PERCENTILE', { currentVix: spots.vix, historyCount: vixHistory.length, percentile: ivPctl });

        // Compute bias from morning inputs + chain data
        const biasResult = computeBias(STATE.morningInput, {
            pcr: STATE.bnfChain.pcr,
            vix: spots.vix,
            futuresPremium: STATE.bnfChain.futuresPremium
        });
        dbg('BIAS', { label: biasResult.label, net: biasResult.net, bull: biasResult.votes.bull, bear: biasResult.votes.bear, signalCount: biasResult.signals.length, signals: biasResult.signals.map(s => `${s.name}:${s.dir}`) });
        dbg('MORNING_INPUT', STATE.morningInput);

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
        const yesterdayVix = STATE.premiumHistory.length > 0 ? STATE.premiumHistory[0]?.vix : null;

        STATE.baseline = {
            timestamp: Date.now(),
            nfSpot: spots.nfSpot,
            bnfSpot: spots.bnfSpot,
            vix: spots.vix,
            yesterdayVix,
            nfAtmIv: STATE.nfChain.atmIv,
            bnfAtmIv: STATE.bnfChain.atmIv,
            pcr: STATE.bnfChain.pcr,
            maxPainBnf: STATE.bnfChain.maxPain,
            maxPainNf: STATE.nfChain.maxPain,
            futuresPremBnf: STATE.bnfChain.futuresPremium,
            futuresPremNf: STATE.nfChain.futuresPremium,
            bias: biasResult,
            ivPercentile: ivPctl,
            // OI walls
            bnfCallWall: STATE.bnfChain.callWallStrike,
            bnfCallWallOI: STATE.bnfChain.callWallOI,
            bnfPutWall: STATE.bnfChain.putWallStrike,
            bnfPutWallOI: STATE.bnfChain.putWallOI,
            // DTE
            bnfExpiry: STATE.bnfExpiry,
            bnfTDTE: bnfTDTE,
            bnfCalendarDTE: API.calendarDTE(STATE.bnfExpiry),
            nfExpiry: STATE.nfExpiry,
            // Theta
            bnfAtmTheta: Math.round(bnfAtmTheta * C.BNF_LOT), // ₹/day for 1 lot
            // Range budget
            dailySigmaBnf: Math.round(dailySigmaBnf),
            tradeSigmaBnf: Math.round(BS.sigmaDays(spots.bnfSpot, spots.vix, bnfTDTE)),
            // Total OI
            bnfTotalCallOI: STATE.bnfChain.totalCallOI,
            bnfTotalPutOI: STATE.bnfChain.totalPutOI,
            // ATM
            bnfAtm: STATE.bnfChain.atm,
            bnfSynthFutures: STATE.bnfChain.synthFutures
        };

        STATE.live = { ...STATE.baseline };
        STATE.lastPollTime = Date.now();
        STATE.pollCount = 0;
        STATE.lastForceState = {};
        STATE.watchlist.forEach(c => {
            STATE.lastForceState[c.id] = c.forces.aligned;
        });

        // Save MORNING snapshot to premium history
        const today = new Date().toISOString().split('T')[0];
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

        statusEl.textContent = '';
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

        const elapsed = API.minutesSinceOpen();
        const vixHistory = STATE.premiumHistory.map(p => p.vix).filter(Boolean);
        const ivPctl = BS.ivPercentile(spots.vix, vixHistory);

        // σ scores — how significant are the moves?
        const spotSigma = BS.sigmaScore(spots.bnfSpot, STATE.baseline.bnfSpot, STATE.baseline.vix, elapsed);
        const vixSigma = BS.vixSigmaScore(spots.vix, STATE.baseline.vix, elapsed);

        // Update live state
        STATE.live = {
            ...STATE.baseline,
            nfSpot: spots.nfSpot,
            bnfSpot: spots.bnfSpot,
            vix: spots.vix,
            pcr: bnfChain.pcr,
            maxPainBnf: bnfChain.maxPain,
            futuresPremBnf: bnfChain.futuresPremium,
            bnfAtmIv: bnfChain.atmIv,
            ivPercentile: ivPctl,
            spotSigma: +spotSigma.toFixed(2),
            vixSigma: +vixSigma.toFixed(2),
            timestamp: Date.now()
        };

        // Recompute bias with live chain data
        const biasResult = computeBias(STATE.morningInput, {
            pcr: bnfChain.pcr,
            vix: spots.vix,
            futuresPremium: bnfChain.futuresPremium
        });
        STATE.live.bias = biasResult;

        // Check: is any σ move significant enough to recalculate?
        const absSpotSigma = Math.abs(spotSigma);
        const absVixSigma = Math.abs(vixSigma);
        const threshold = STATE.openTrade ? C.SIGMA_EXIT_THRESHOLD : C.SIGMA_ENTRY_THRESHOLD;

        const significantMove = absSpotSigma > threshold || absVixSigma > threshold;

        if (significantMove) {
            // Recalculate force alignment for watchlist
            updateWatchlistForces(bnfChain, spots, biasResult, ivPctl);
        }

        // Update open trade P&L
        if (STATE.openTrade) {
            updateOpenTradePnL(bnfChain, spots);
        }

        // Check for notifications
        handleNotifications(absSpotSigma, absVixSigma, significantMove);

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
        // Update LTPs from live chain
        const sellData = bnfChain.strikes[cand.sellStrike]?.[cand.sellType];
        const buyData = bnfChain.strikes[cand.buyStrike]?.[cand.buyType];
        if (sellData) {
            cand.sellLTP = cand.isCredit ? sellData.bid : sellData.ask;
            cand.sellOI = sellData.oi;
        }
        if (buyData) {
            cand.buyLTP = cand.isCredit ? buyData.ask : buyData.bid;
            cand.buyOI = buyData.oi;
        }

        // Recalculate premium
        if (cand.isCredit) {
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

        // Detect alignment change
        cand._alignmentChanged = (cand.forces.aligned !== oldAlignment);
        cand._prevAlignment = oldAlignment;
    }
}

function updateOpenTradePnL(bnfChain, spots) {
    const trade = STATE.openTrade;
    if (!trade) return;

    const sellData = bnfChain.strikes[trade.sell_strike]?.[trade.sell_type];
    const buyData = bnfChain.strikes[trade.buy_strike]?.[trade.buy_type];
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

    trade.current_spot = spots.bnfSpot;
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

function handleNotifications(absSpotSigma, absVixSigma, significantMove) {
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

        // Check position exit signals
        if (STATE.openTrade) {
            const trade = STATE.openTrade;

            // Target hit
            if (trade.current_pnl >= trade.max_profit * 0.8) {
                sendNotification(
                    '💰 Target Near',
                    `P&L ₹${trade.current_pnl} (${Math.round(trade.current_pnl / trade.max_profit * 100)}% of max). Book profit.`,
                    'urgent'
                );
            }

            // Stop loss
            if (trade.current_pnl <= -trade.max_loss * 0.7) {
                sendNotification(
                    '🛑 Stop Loss Near',
                    `P&L ₹${trade.current_pnl}. Cut position.`,
                    'urgent'
                );
            }

            // Force deterioration
            if (trade.forces && trade.forces.aligned <= 1 && trade.current_pnl > 0) {
                sendNotification(
                    '⚡ Book Profit',
                    `Forces ${trade.forces.aligned}/3 but profitable ₹${trade.current_pnl}. Take it.`,
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
        if (STATE.openTrade) {
            body += ` | P&L ₹${STATE.openTrade.current_pnl}`;
        }
        const top = STATE.watchlist[0];
        if (top && !STATE.openTrade) {
            body += ` | Top: ${top.forces.aligned}/3 ${friendlyType(top.type)}`;
        }

        sendNotification('📈 Market Update', body, 'routine');
    }
}

function sendNotification(title, body, type) {
    // Play sound
    playSound(type);

    // PWA notification (if permission granted)
    if (Notification.permission === 'granted') {
        try {
            new Notification(title, {
                body, icon: '/favicon.ico',
                tag: type + '_' + Date.now(),
                silent: true // we play our own sound
            });
        } catch (e) { /* mobile might not support */ }
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

    STATE.pollTimer = setInterval(async () => {
        if (!API.isMarketHours()) {
            document.getElementById('watch-status').textContent = '⏸ Market closed';
            return;
        }
        document.getElementById('watch-status').textContent = '🔴 Polling...';
        await lightFetch();
        document.getElementById('watch-status').textContent = `🟢 Watching · Poll #${STATE.pollCount}`;
    }, C.POLL_INTERVAL_MS);

    document.getElementById('watch-status').textContent = '🟢 Watching';
    document.getElementById('btn-stop').style.display = 'inline-block';
}

function stopWatchLoop() {
    STATE.isWatching = false;
    if (STATE.pollTimer) { clearInterval(STATE.pollTimer); STATE.pollTimer = null; }
    document.getElementById('watch-status').textContent = '⏹ Stopped';
    document.getElementById('btn-stop').style.display = 'none';
}


// ═══════════════════════════════════════════════════════════════
// TRADE MANAGEMENT
// ═══════════════════════════════════════════════════════════════

async function takeTrade(candidateId) {
    const cand = STATE.watchlist.find(c => c.id === candidateId);
    if (!cand) return;

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
        entry_pcr: STATE.live.pcr,
        entry_futures_premium: STATE.live.futuresPremBnf,
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
        STATE.openTrade = trade;
        playSound('entry');
        switchTab('positions');
        renderAll();
    }
}

async function closeTrade(exitReason) {
    if (!STATE.openTrade) return;

    const trade = STATE.openTrade;
    await DB.updateTrade(trade.id, {
        status: 'CLOSED',
        exit_date: new Date().toISOString(),
        actual_pnl: trade.current_pnl,
        exit_premium: trade.current_premium,
        exit_reason: exitReason || 'Manual',
        exit_vix: STATE.live?.vix,
        exit_atm_iv: STATE.live?.bnfAtmIv,
        exit_force_alignment: trade.forces?.aligned
    });

    addNotificationLog('Trade Closed', `P&L: ₹${trade.current_pnl}. Reason: ${exitReason || 'Manual'}`, trade.current_pnl >= 0 ? 'entry' : 'urgent');
    STATE.openTrade = null;
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
        BULL_CALL: 'Bull Call'
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
    renderPremiumEnvironment();
    renderWatchlist();
    renderPosition();
    renderDebug();
    renderFooter();
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
            openTrade: STATE.openTrade ? 'YES' : 'NO',
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

function renderPremiumEnvironment() {
    const el = document.getElementById('premium-env');
    if (!el || !STATE.live) return;

    const l = STATE.live;
    const b = STATE.baseline;
    const bias = l.bias;

    if (!b) {
        el.innerHTML = '<div class="empty-state">Enter morning data and scan to see premium environment</div>';
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

    // Max Pain gravity
    const mpDist = b.maxPainBnf ? (l.bnfSpot - b.maxPainBnf) : 0;
    const mpDir = mpDist > 100 ? 'above ↑' : mpDist < -100 ? 'below ↓' : 'near →';

    // OI wall formatting
    const formatOI = (oi) => {
        if (!oi) return '0';
        if (oi >= 1e7) return (oi / 1e7).toFixed(1) + 'Cr';
        if (oi >= 1e5) return (oi / 1e5).toFixed(1) + 'L';
        if (oi >= 1e3) return (oi / 1e3).toFixed(1) + 'K';
        return oi.toString();
    };

    // OI bar proportions
    const totalOI = (b.bnfTotalCallOI || 0) + (b.bnfTotalPutOI || 0);
    const callPct = totalOI > 0 ? ((b.bnfTotalCallOI / totalOI) * 100).toFixed(0) : 50;
    const putPct = totalOI > 0 ? ((b.bnfTotalPutOI / totalOI) * 100).toFixed(0) : 50;

    // Yesterday's data from premium_history for comparisons
    const yday = STATE.premiumHistory.length > 0 ? STATE.premiumHistory[0] : null;
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

        <!-- TOP GRID: Key numbers at a glance -->
        <div class="env-grid-3">
            <div class="env-item">
                <div class="env-label">VIX</div>
                <div class="env-value">${l.vix?.toFixed(1) || '--'}</div>
                <div class="env-sub">${ivRegime}</div>
            </div>
            <div class="env-item">
                <div class="env-label">IV %ile</div>
                <div class="env-value">${l.ivPercentile !== null && l.ivPercentile !== undefined ? l.ivPercentile + 'th' : '--'}</div>
                <div class="env-sub">${STATE.premiumHistory.length}d history</div>
            </div>
            <div class="env-item">
                <div class="env-label">BNF</div>
                <div class="env-value">${l.bnfSpot?.toFixed(0) || '--'}</div>
                <div class="env-sub">ATM: ${b.bnfAtm || '--'}</div>
            </div>
        </div>

        <!-- FORCE 3: IV / VOLATILITY -->
        <div class="env-section-title">Force 3 — IV & Volatility</div>
        <div class="env-row">
            <span class="env-row-label">VIX vs Yesterday</span>
            <span class="env-row-value">${vixVsYday || 'No history yet'}</span>
        </div>
        <div class="env-row">
            <span class="env-row-label">BNF ATM IV</span>
            <span class="env-row-value">${b.bnfAtmIv ? (b.bnfAtmIv > 1 ? b.bnfAtmIv.toFixed(1) + '%' : (b.bnfAtmIv * 100).toFixed(1) + '%') : '--'}</span>
        </div>
        <div class="env-row">
            <span class="env-row-label">ATM Theta (₹/day)</span>
            <span class="env-row-value" style="color: var(--green)">₹${Math.abs(b.bnfAtmTheta || 0)} decay</span>
        </div>
        <div class="env-row">
            <span class="env-row-label">DTE</span>
            <span class="env-row-value">${b.bnfTDTE || '--'}T (${b.bnfCalendarDTE || '--'} cal) · Exp: ${b.bnfExpiry || '--'}</span>
        </div>

        <!-- FORCE 1: DIRECTION / INTRINSIC -->
        <div class="env-section-title">Force 1 — Direction & Intrinsic</div>
        <div class="env-bias">
            <span class="bias-badge bias-${bias?.bias?.toLowerCase() || 'neutral'}">${bias?.label || 'N/A'}</span>
            <span class="bias-net">${bias?.net > 0 ? '+' : ''}${bias?.net || 0} net</span>
            ${l.spotSigma !== undefined ? `<span class="sigma-badge">Spot: ${l.spotSigma}σ</span>` : ''}
            ${l.vixSigma !== undefined ? `<span class="sigma-badge">VIX: ${l.vixSigma}σ</span>` : ''}
        </div>
        <div class="env-signals">${(bias?.signals || []).map(s =>
            `<span class="signal-chip signal-${s.dir.toLowerCase()}">${s.name}: ${s.value}</span>`
        ).join('')}</div>
        <div class="env-row">
            <span class="env-row-label">Futures Premium</span>
            <span class="env-row-value ${(l.futuresPremBnf || 0) > 0.05 ? 'text-sell' : (l.futuresPremBnf || 0) < -0.05 ? '' : ''}">${l.futuresPremBnf?.toFixed(3) || '--'}%</span>
        </div>
        <div class="env-row">
            <span class="env-row-label">Synth Futures</span>
            <span class="env-row-value">${b.bnfSynthFutures?.toFixed(0) || '--'} (spot ${l.bnfSpot?.toFixed(0) || '--'})</span>
        </div>

        <!-- OI STRUCTURE -->
        <div class="env-section-title">OI Structure — Institutional Positioning</div>
        <div class="env-row">
            <span class="env-row-label">PCR</span>
            <span class="env-row-value">${l.pcr?.toFixed(2) || '--'}</span>
        </div>
        <div class="env-row">
            <span class="env-row-label">Max Pain</span>
            <span class="env-row-value">${b.maxPainBnf || '--'} (${mpDir}, ${Math.abs(mpDist).toFixed(0)} pts)</span>
        </div>
        <div class="env-row">
            <span class="env-row-label">Call Wall (resistance)</span>
            <span class="env-row-value" style="color: var(--danger)">${b.bnfCallWall || '--'} · ${formatOI(b.bnfCallWallOI)} OI</span>
        </div>
        <div class="env-row">
            <span class="env-row-label">Put Wall (support)</span>
            <span class="env-row-value" style="color: var(--green)">${b.bnfPutWall || '--'} · ${formatOI(b.bnfPutWallOI)} OI</span>
        </div>
        <div class="env-row">
            <span class="env-row-label">Total OI</span>
            <span class="env-row-value">CE ${callPct}% / PE ${putPct}%</span>
        </div>
        <div class="oi-bar">
            <div class="oi-bar-fill call" style="width: ${callPct}%; float: left;"></div>
            <div class="oi-bar-fill put" style="width: ${putPct}%; float: right;"></div>
        </div>

        <!-- RANGE BUDGET -->
        <div class="env-section-title">Range Budget — σ Framework</div>
        <div class="env-row">
            <span class="env-row-label">Daily 1σ</span>
            <span class="env-row-value">±${daily1s} pts (68% probability)</span>
        </div>
        <div class="env-row">
            <span class="env-row-label">Daily 2σ</span>
            <span class="env-row-value">±${(daily1s * 2)} pts (95% ceiling)</span>
        </div>
        <div class="env-row">
            <span class="env-row-label">Trade duration 1σ (${b.bnfTDTE}T)</span>
            <span class="env-row-value" style="color: var(--accent)">±${trade1s} pts</span>
        </div>
        <div class="env-row">
            <span class="env-row-label">NF Spot</span>
            <span class="env-row-value">${l.nfSpot?.toFixed(0) || '--'}</span>
        </div>

        ${yday ? `
        <!-- OVERNIGHT: Yesterday Close → Today Morning -->
        <div class="env-section-title">🌙 Overnight (${yday.date} close → today open)</div>
        <div class="env-signals">${ydayComparisons || '<span class="signal-chip signal-neutral">No comparison data</span>'}</div>
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

function renderWatchlist() {
    const el = document.getElementById('watchlist');
    if (!el) return;

    if (!STATE.watchlist.length && !STATE.candidates.length) {
        el.innerHTML = '<div class="empty-state">Press Lock & Scan to generate candidates</div>';
        return;
    }

    const scanTime = API.istNow();
    const atm = STATE.bnfChain?.atm || STATE.baseline?.bnfAtm || 0;

    // Separate BNF and NF candidates
    const bnfCands = STATE.watchlist.filter(c => c.index === 'BNF');
    const nfCands = STATE.candidates.filter(c => c.index === 'NF' && !c.capitalBlocked).slice(0, 3);
    const nfBlocked = STATE.candidates.some(c => c.index === 'NF' && c.capitalBlocked);

    let html = `<div class="section-timestamp">Generated: ${scanTime} · ${STATE.candidates.length} total candidates</div>`;

    // BNF Strategies
    html += '<div class="strat-section-title">Bank Nifty</div>';
    html += bnfCands.map(cand => renderCandidateCard(cand, atm)).join('');
    if (!bnfCands.length) html += '<div class="empty-state">No BNF candidates found</div>';

    // NF Strategies
    html += '<div class="strat-section-title">Nifty 50</div>';
    if (nfBlocked && !nfCands.length) {
        html += '<div class="empty-state">NF credit spreads need ~₹97K margin (88% of ₹1.1L capital). Hidden until capital allows.</div>';
    } else if (nfCands.length) {
        html += nfCands.map(cand => renderCandidateCard(cand, STATE.nfChain?.atm || 0)).join('');
    } else {
        html += '<div class="empty-state">No NF candidates found</div>';
    }

    el.innerHTML = html;
}

function renderCandidateCard(cand, atm) {
    const forces = cand.forces;
    const dots = alignmentDots(forces.aligned);
    const alignLabel = forces.aligned === 3 ? '🟢 ALIGNED — Entry Ready' :
        forces.aligned === 2 ? '🟡 CONDITIONAL' : '⚫ WATCHING';
    const alignClass = forces.aligned === 3 ? 'align-3' :
        forces.aligned === 2 ? 'align-2' : 'align-1';

    let sellLeg, buyLeg;
    if (cand.isCredit) {
        sellLeg = `SELL ${cand.sellStrike} ${cand.sellType} @ ₹${cand.sellLTP?.toFixed(1) || '--'}`;
        buyLeg = `BUY ${cand.buyStrike} ${cand.buyType} @ ₹${cand.buyLTP?.toFixed(1) || '--'}`;
    } else {
        buyLeg = `BUY ${cand.buyStrike} ${cand.buyType} @ ₹${cand.buyLTP?.toFixed(1) || '--'}`;
        sellLeg = `SELL ${cand.sellStrike} ${cand.sellType} @ ₹${cand.sellLTP?.toFixed(1) || '--'}`;
    }

    const otmDist = Math.abs(cand.sellStrike - atm);
    const otmLabel = otmDist < 50 ? 'ATM' : `${otmDist} OTM`;

    return `
        <div class="candidate-card ${alignClass}" data-id="${cand.id}">
            <div class="cand-header">
                <span class="cand-dots">${dots}</span>
                <span class="cand-type">${friendlyType(cand.type)}</span>
                <span class="cand-width">W:${cand.width} · ${otmLabel}</span>
            </div>
            <div class="cand-legs">
                <div class="leg sell-leg">🔴 ${sellLeg}</div>
                <div class="leg buy-leg">🟢 ${buyLeg}</div>
                <div class="leg-info">${cand.isCredit ? 'Net Credit' : 'Net Debit'} ₹${cand.netPremium}/share · Exp: ${cand.expiry || '--'}</div>
            </div>
            <div class="cand-forces">
                <span>Δ ${forceIcon(forces.f1)} Direction</span>
                <span>Θ ${forceIcon(forces.f2)} Time</span>
                <span>IV ${forceIcon(forces.f3)} Vol</span>
            </div>
            <div class="cand-metrics">
                <div class="metric"><span class="metric-label">Prob</span><span class="metric-value">${(cand.probProfit * 100).toFixed(0)}%</span></div>
                <div class="metric"><span class="metric-label">Profit</span><span class="metric-value" style="color:var(--green)">+₹${cand.maxProfit.toLocaleString()}</span></div>
                <div class="metric"><span class="metric-label">Risk</span><span class="metric-value" style="color:var(--danger)">₹${cand.maxLoss.toLocaleString()}</span></div>
                <div class="metric"><span class="metric-label">EV</span><span class="metric-value">₹${cand.ev.toLocaleString()}</span></div>
            </div>
            <div class="cand-ev">
                Θ decay: ₹${cand.netTheta}/day · DTE: ${cand.tDTE || '--'}T
            </div>
            <div class="cand-align ${alignClass}">${alignLabel}</div>
            ${forces.aligned >= 2 && !STATE.openTrade ? `
                <button class="btn-take" onclick="takeTrade('${cand.id}')">📌 I TOOK THIS TRADE</button>
            ` : ''}
        </div>
    `;
}

function renderPosition() {
    const el = document.getElementById('position');
    if (!el) return;

    if (!STATE.openTrade) {
        el.innerHTML = '<div class="empty-state">No open position. Take a trade from Strategies tab.</div>';
        return;
    }

    const t = STATE.openTrade;
    const forces = t.forces || { f1: 0, f2: 0, f3: 0, aligned: 0 };
    const pnlClass = t.current_pnl >= 0 ? 'pnl-pos' : 'pnl-neg';
    const dots = alignmentDots(forces.aligned);
    const lastUpdate = STATE.lastPollTime ? new Date(STATE.lastPollTime).toLocaleTimeString('en-IN', { timeZone: 'Asia/Kolkata', hour: '2-digit', minute: '2-digit', hour12: true }) : '';

    el.innerHTML = `
        <div class="section-timestamp">Last updated: ${lastUpdate || API.istNow()}</div>
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
            <div class="pos-detail">
                Entry VIX: ${t.entry_vix?.toFixed(1) || '--'} · Entry Bias: ${t.entry_bias || '--'} · Forces at entry: ${t.force_alignment}/3
            </div>
            <div class="pos-actions">
                <button class="btn-close-profit" onclick="closeTrade('Profit booked')">💰 Book Profit</button>
                <button class="btn-close-loss" onclick="closeTrade('Stop loss')">🛑 Exit</button>
            </div>
        </div>
    `;
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

    const fiiCash = document.getElementById('in-fii-cash').value;
    const fiiShortPct = document.getElementById('in-fii-short').value;
    const closeChar = document.getElementById('in-close-char').value;
    const upstoxBias = document.getElementById('in-upstox-bias').value;

    STATE.morningInput = { fiiCash, fiiShortPct, closeChar, upstoxBias };

    // Save to localStorage for restore
    localStorage.setItem('mr2_morning', JSON.stringify(STATE.morningInput));

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
        const today = new Date().toISOString().split('T')[0];
        // Only restore if saved today
        // (we don't have a date in the saved data, so always restore for now)
        if (data.fiiCash) document.getElementById('in-fii-cash').value = data.fiiCash;
        if (data.fiiShortPct) document.getElementById('in-fii-short').value = data.fiiShortPct;
        if (data.closeChar) document.getElementById('in-close-char').value = data.closeChar;
        if (data.upstoxBias) document.getElementById('in-upstox-bias').value = data.upstoxBias;
    } catch (e) { /* ignore */ }
}

function setupTokenInput() {
    const token = API.getToken();
    const tokenEl = document.getElementById('in-token');
    if (tokenEl && token) {
        tokenEl.value = token.substring(0, 20) + '...';
    }
}

function saveToken() {
    const tokenEl = document.getElementById('in-token');
    if (tokenEl && tokenEl.value && !tokenEl.value.includes('...')) {
        API.setToken(tokenEl.value);
        tokenEl.value = tokenEl.value.substring(0, 20) + '...';
    }
}

async function loadOpenTrade() {
    const trades = await DB.getOpenTrades();
    if (trades.length > 0) {
        STATE.openTrade = trades[0];
    }
}

function requestNotificationPermission() {
    if ('Notification' in window && Notification.permission === 'default') {
        Notification.requestPermission();
    }
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
    setupTokenInput();
    requestNotificationPermission();
    initTheme();
    await loadOpenTrade();

    // If open trade exists, show positions tab
    if (STATE.openTrade) {
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
    document.getElementById('btn-save-token')?.addEventListener('click', saveToken);
    document.getElementById('btn-rescan')?.addEventListener('click', () => {
        stopWatchLoop();
        document.getElementById('btn-lock').disabled = false;
        document.getElementById('btn-lock').textContent = '🔒 Lock & Scan';
        document.querySelectorAll('.morning-input').forEach(el => el.disabled = false);
    });

    // Theme toggle
    document.getElementById('theme-switch')?.addEventListener('change', (e) => {
        const isLight = e.target.checked;
        document.body.classList.toggle('light', isLight);
        localStorage.setItem('mr2_theme', isLight ? 'light' : 'dark');
        document.querySelector('.toggle-icon').textContent = isLight ? '☀️' : '🌙';
        document.querySelector('meta[name="theme-color"]').content = isLight ? '#f5f5f9' : '#121218';
    });
});

function initTheme() {
    const saved = localStorage.getItem('mr2_theme');
    if (saved === 'light') {
        document.body.classList.add('light');
        const toggle = document.getElementById('theme-switch');
        if (toggle) toggle.checked = true;
        const icon = document.querySelector('.toggle-icon');
        if (icon) icon.textContent = '☀️';
        document.querySelector('meta[name="theme-color"]').content = '#f5f5f9';
    }
}
