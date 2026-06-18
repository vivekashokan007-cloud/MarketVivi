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
    ROUTINE_NOTIFY_MS: 60 * 60 * 1000,

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

const DEFAULT_TRADE_MODE = 'intraday';
const LS_TRADE_MODE = 'mr2_trade_mode';
const LS_TRADE_MODE_EXPLICIT = 'mr2_trade_mode_explicit';

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

// Native brain note: strategy analysis lives in Marketapp/Chaquopy brain.py.
// MarketVivi must remain display-only.

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

    // Candidates supplied by native brain.
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

    // Trade mode: 'intraday' (default, 0-1 DTE, ATM OK) or 'swing' (3-7 DTE, OTM near wall)
    tradeMode: DEFAULT_TRADE_MODE,
    settingsConfig: null,

    // Native Kotlin/Chaquopy brain state.
    brainReady: false,        // true after native brain result is available
    brainInsights: { verdict: null, market: [], positions: {}, candidates: {}, timing: [], risk: [] },
    effectiveBias: null,
    brainLastRun: 0,          // timestamp of last brain run
    brainError: null,         // last error (for debug)
    brainRefreshPending: false,
    brainRefreshReason: '',
    morningExpandedAfterLock: false,
    mlModelStatus: null,
    mlModelStatusAt: 0,
    mlStatusRefreshAt: 0,
    mlDecisions: null,
    mlDecisionsAt: 0,
    evaluatorJob: null,
    evaluatorProposals: [],
    evaluatorBusy: false,
    evaluatorError: '',
    evaluatorPollTimer: null,
    approvedBranchProposals: [],
    approvedBranchProposalsAt: 0,
    _mlEvaluationStatusKey: '',

    // Active tab
    activeTab: 'market'
};

try {
    const savedChartIndex = localStorage.getItem('mr2_chart_index');
    if (savedChartIndex === 'NF' || savedChartIndex === 'BNF') STATE._chartIndex = savedChartIndex;
} catch (e) {}

function switchChartIndex(nextIndex) {
    const idx = nextIndex === 'BNF' ? 'BNF' : 'NF';
    STATE._chartIndex = idx;
    try { localStorage.setItem('mr2_chart_index', idx); } catch (e) {}
    renderMarket();
}


// ═══════════════════════════════════════════════════════════════
// SOUND ENGINE — Corporate-subtle Web Audio notifications
// ═══════════════════════════════════════════════════════════════

/* F.2 helpers — bridge to Kotlin/brain.py single source of truth */

// `bd` is the latest brain_result snapshot. Refreshed inside renderAll() and
// any other function that needs fresh data. Defined at module-top so all
// downstream code can read bd.effective_bias, bd.candidates, etc. without
// having to call getBrainData() repeatedly per render.
let bd = {};

// F.2.7 — Safe parser for NativeBridge JSON returns. Handles the literal
// "null" string from Kotlin prefs defaults and JSON null payloads.
function safeParseNB(rawValue, fallback) {
    try {
        if (rawValue === null || rawValue === undefined || rawValue === '' || rawValue === 'null') return fallback;
        if (Array.isArray(rawValue)) return rawValue;
        if (typeof rawValue === 'object') return rawValue;
        const parsed = JSON.parse(rawValue);
        return (parsed === null || parsed === undefined) ? fallback : parsed;
    } catch (e) {
        return fallback;
    }
}

function latestPollData() {
    if (typeof NativeBridge === 'undefined') return {};
    const l = safeParseNB(NativeBridge.getLatestPoll?.(), {});
    if (l.bnfSpot == null && l.bnf != null) l.bnfSpot = l.bnf;
    if (l.nfSpot == null && l.nf != null) l.nfSpot = l.nf;
    return l;
}

function validDateOrBlank(value) {
    if (!value || typeof value !== 'string') return '';
    return value >= API.todayIST() ? value : '';
}

function maybeAutoRefreshMlStatus(serviceStatus = {}) {
    const evaluationDone = serviceStatus?.evaluationDoneToday === true;
    const evaluationRunning = serviceStatus?.evaluationRunning === true;
    const statusKey = [
        serviceStatus?.evaluationDoneDate || '',
        evaluationDone ? 'done' : (evaluationRunning ? 'running' : 'idle'),
        Number.isFinite(serviceStatus?.lastEvaluationOutcomeCount) ? serviceStatus.lastEvaluationOutcomeCount : 0,
        Number.isFinite(serviceStatus?.lastEvaluationProducedCount) ? serviceStatus.lastEvaluationProducedCount : 0,
        serviceStatus?.lastEvaluationMessage || ''
    ].join('|');

    if (STATE._mlEvaluationStatusKey === statusKey) return false;
    STATE._mlEvaluationStatusKey = statusKey;

    if (!evaluationDone && !evaluationRunning) return false;

    getMLModelStatusCached(true);
    getMLEvaluationOutcomesCached(true);
    getMLBrainSnapshotsCached(true);
    STATE.mlStatusRefreshAt = Date.now();
    return true;
}

function isTodayRecord(record) {
    return !!record && record.date === API.todayIST();
}

function getTodayNativeBaseline() {
    if (typeof NativeBridge === 'undefined') return null;
    const baseline = safeParseNB(NativeBridge.getBaseline?.(), {});
    return isTodayRecord(baseline) ? baseline : null;
}

function todayNativeSessionActive(serviceStatus = safeParseNB(NativeBridge?.getServiceStatus?.(), {}), latestPoll = latestPollData(), pollHistory = safeParseNB(NativeBridge?.getPollHistory?.(), [])) {
    const latestPollToday = latestPoll && latestPoll.date === API.todayIST();
    return !!(
        serviceStatus?.sessionActive ||
        serviceStatus?.polls > 0 ||
        latestPollToday ||
        (Array.isArray(pollHistory) && pollHistory.length > 0) ||
        getTodayNativeBaseline()
    );
}

function nextAutoStartText(serviceStatus) {
    const ts = Number(serviceStatus?.autoStartAt || 0);
    if (!Number.isFinite(ts) || ts <= 0) return '';
    try {
        return new Date(ts).toLocaleString('en-IN', {
            hour: 'numeric',
            minute: '2-digit',
            day: 'numeric',
            month: 'short'
        });
    } catch (e) {
        return '';
    }
}

function updateWatchStatusHint(serviceStatus = safeParseNB(NativeBridge?.getServiceStatus?.(), {})) {
    const watchEl = document.getElementById('watch-status');
    if (!watchEl) return;
    const polls = Number.isFinite(serviceStatus?.polls) ? serviceStatus.polls : (STATE.pollCount || 0);
    const expectedByNow = Number.isFinite(serviceStatus?.expectedPollsByNow) ? serviceStatus.expectedPollsByNow : 0;
    const expectedFullDay = Number.isFinite(serviceStatus?.expectedPollsFullDay) ? serviceStatus.expectedPollsFullDay : 76;
    const missed = Number.isFinite(serviceStatus?.missedPollsToday) ? serviceStatus.missedPollsToday : Math.max(expectedByNow - polls, 0);
    const coverage = serviceStatus?.pollCoverageState || '';
    const coverageLabel = expectedByNow > 0 ? ` · polls ${polls}/${expectedByNow} slots` : '';
    if (serviceStatus?.running) {
        const missLabel = missed > 0 ? ` · missed ${missed}` : '';
        watchEl.textContent = `🟢 Auto polling${coverageLabel}${missLabel}`;
        return;
    }
    if (!serviceStatus?.tokenReady) {
        watchEl.textContent = '🟠 Paste Upstox token to enable 9:15 auto polling';
        return;
    }
    const nextText = nextAutoStartText(serviceStatus);
    const suffix = nextText ? ` · Next ${nextText}` : '';
    switch (serviceStatus?.marketReason) {
        case 'WEEKEND':
            watchEl.textContent = `⏸ Weekend${suffix}`;
            break;
        case 'HOLIDAY':
            watchEl.textContent = `⏸ NSE holiday${suffix}`;
            break;
        case 'OPEN':
            if (polls > 0 || serviceStatus?.sessionActive) {
                watchEl.textContent = `🟠 Auto polling paused${coverageLabel}${missed > 0 ? ` · missed ${missed}` : ''}`;
            } else {
                watchEl.textContent = `🔄 Market open · recovering auto polling${expectedByNow > 0 ? ` · ${expectedByNow} slots elapsed` : ''}`;
            }
            break;
        case 'OUT_OF_HOURS':
            if (coverage === 'COMPLETE' && polls >= expectedFullDay) {
                watchEl.textContent = `✅ Session complete · polls ${polls}/${expectedFullDay} slots${suffix}`;
            } else if (expectedByNow > 0 && polls > 0) {
                watchEl.textContent = `⏸ Session partial · polls ${polls}/${expectedByNow} slots${missed > 0 ? ` · missed ${missed}` : ''}${suffix}`;
            } else {
                watchEl.textContent = `⏸ Waiting for 9:15 auto polling${suffix}`;
            }
            break;
        default:
            watchEl.textContent = `⏸ Auto polling idle${coverageLabel}${suffix}`;
            break;
    }
}

function isLiveRecommendationWindow(serviceStatus = safeParseNB(NativeBridge?.getServiceStatus?.(), {})) {
    return serviceStatus?.marketReason === 'OPEN';
}

function maybeAutoStartNativeIngestion(reason = 'ui') {
    if (typeof NativeBridge === 'undefined' || typeof NativeBridge.getServiceStatus !== 'function') return false;
    const serviceStatus = safeParseNB(NativeBridge.getServiceStatus(), {});
    updateWatchStatusHint(serviceStatus);
    if (serviceStatus.running) {
        STATE.isWatching = true;
        startNativePollWatchdog();
        return true;
    }
    if (!serviceStatus.tokenReady || !serviceStatus.marketOpen) return false;
    console.log(`[auto-ingestion] starting native service from ${reason}`);
    startWatchLoop();
    try {
        if (typeof NativeBridge.requestImmediatePoll === 'function') {
            NativeBridge.requestImmediatePoll();
        }
    } catch (e) {
        console.warn(`[auto-ingestion] immediate poll request failed from ${reason}:`, e.message);
    }
    updateWatchStatusHint(safeParseNB(NativeBridge.getServiceStatus(), serviceStatus));
    return true;
}

function clearSessionDerivedState() {
    bd = {};
    STATE.brainReady = false;
    STATE.brainInsights = { verdict: null, market: [], positions: {}, candidates: {}, timing: [], risk: [] };
    STATE.brainLastRun = null;
    STATE.brainError = null;
    STATE._nativeBrainAlerts = [];
    STATE.candidates = [];
    STATE.watchlist = [];
    STATE.positioningCandidates = [];
    STATE.positioningBias = null;
    STATE.effectiveBias = null;
    STATE.pollHistory = [];
    STATE.pollCount = 0;
    STATE.live = null;
    STATE.rangeSigma = 0;
    STATE.lastScanTime = null;
    STATE.brainRefreshPending = false;
    STATE.brainRefreshReason = '';
}

function clearMorningStorage() {
    localStorage.removeItem('mr2_morning_inputs');
    localStorage.removeItem('mr2_morning');
    localStorage.removeItem('mr2_morning_baseline');
}

function localTradeModeExplicit() {
    return localStorage.getItem(LS_TRADE_MODE_EXPLICIT) === '1';
}

function setLocalTradeMode(mode, explicit = true) {
    STATE.tradeMode = mode === 'swing' ? 'swing' : DEFAULT_TRADE_MODE;
    localStorage.setItem(LS_TRADE_MODE, STATE.tradeMode);
    if (explicit) {
        localStorage.setItem(LS_TRADE_MODE_EXPLICIT, '1');
    } else {
        localStorage.removeItem(LS_TRADE_MODE_EXPLICIT);
    }
}

function persistSettingsPatch(patch) {
    const nextSettings = { ...(STATE.settingsConfig || {}), ...(patch || {}) };
    STATE.settingsConfig = nextSettings;
    if (typeof DB !== 'undefined' && DB.setConfig) {
        DB.setConfig('settings', nextSettings);
    }
}

function firstCandidateFor(index) {
    if (typeof NativeBridge !== 'undefined' && !getTodayNativeBaseline()) return {};
    return (bd.generated_candidates || []).find(c => c.index === index) || {};
}

function callNativeJson(methodName, ...args) {
    if (typeof NativeBridge === 'undefined' || typeof NativeBridge[methodName] !== 'function') {
        throw new Error(`NativeBridge.${methodName} unavailable. Install latest APK.`);
    }
    const response = safeParseNB(NativeBridge[methodName](...args), { ok: true });
    if (response.ok === false) throw new Error(response.error || `${methodName} failed`);
    return response;
}

function currentOpenTrades() {
    if (Array.isArray(STATE.openTrades) && STATE.openTrades.length) return STATE.openTrades;
    if (typeof NativeBridge !== 'undefined' && typeof NativeBridge.getOpenTrades === 'function') {
        return safeParseNB(NativeBridge.getOpenTrades(), []);
    }
    return [];
}

function syncToNative() {
    if (typeof NativeBridge === 'undefined' || typeof NativeBridge.setOpenTrades !== 'function') return;
    try {
        const openTrades = Array.isArray(STATE.openTrades) ? STATE.openTrades : [];
        NativeBridge.setOpenTrades(JSON.stringify(openTrades));
    } catch (e) {
        console.warn('[syncToNative] failed:', e.message);
    }
}

function addOpenTradeToState(trade) {
    const tradeId = String(trade?.id ?? '');
    const openTrades = currentOpenTrades().filter(t => String(t.id) !== tradeId);
    STATE.openTrades = tradeId ? [...openTrades, trade] : [...openTrades, trade];
    syncToNative();
}

function removeOpenTradeFromState(tradeId) {
    STATE.openTrades = currentOpenTrades().filter(t => String(t.id) !== String(tradeId));
    syncToNative();
}

function formatServiceLastPoll(raw) {
    if (raw === null || raw === undefined || raw === '' || raw === 'Never') return '';
    if (typeof raw === 'number' && Number.isFinite(raw)) {
        return new Date(raw).toLocaleTimeString('en-IN', { timeZone: 'Asia/Kolkata', hour: '2-digit', minute: '2-digit', hour12: true });
    }
    const text = String(raw).trim();
    const parsed = new Date(text);
    if (!Number.isNaN(parsed.getTime())) {
        return parsed.toLocaleTimeString('en-IN', { timeZone: 'Asia/Kolkata', hour: '2-digit', minute: '2-digit', hour12: true });
    }
    return text;
}

// Storage-only Supabase adapter. Strategy analysis remains native-only.
const DB = {
    _client: null,
    get supabase() {
        if (this._client) return this._client;
        if (!window.supabase?.createClient) return null;
        this._client = window.supabase.createClient(EXPORT_SUPABASE_URL, EXPORT_SUPABASE_ANON_KEY);
        return this._client;
    },
    async insertTrade(trade) {
        try {
            const sb = this.supabase;
            if (!sb) throw new Error('Supabase client unavailable');
            const { data, error } = await sb.from('trades_v2').insert(trade).select('id').single();
            if (error) throw error;
            return data || { id: trade.id };
        } catch (e) {
            console.warn('[DB] insertTrade failed:', e.message);
            addNotificationLog('Trade Insert Failed', e.message, 'urgent');
            return null;
        }
    },
    async updateTrade(id, patch) {
        try {
            const sb = this.supabase;
            if (!sb) throw new Error('Supabase client unavailable');
            const { error } = await sb.from('trades_v2').update(patch).eq('id', id);
            if (error) throw error;
            return true;
        } catch (e) {
            console.warn('[DB] updateTrade failed:', e.message);
            return false;
        }
    },
    async setConfig(key, value) {
        try {
            const sb = this.supabase;
            if (!sb) throw new Error('Supabase client unavailable');
            const { error } = await sb.from('app_config').upsert({ key, value }, { onConflict: 'key' });
            if (error) throw error;
            return true;
        } catch (e) {
            console.warn('[DB] setConfig failed:', key, e.message);
            return false;
        }
    },
    async getConfig(key) {
        try {
            const sb = this.supabase;
            if (!sb) throw new Error('Supabase client unavailable');
            const { data, error } = await sb.from('app_config').select('value').eq('key', key).maybeSingle();
            if (error) throw error;
            return data?.value ?? null;
        } catch (e) {
            console.warn('[DB] getConfig failed:', key, e.message);
            return null;
        }
    }
};

function escapeHtml(value) {
    return String(value ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

function evaluatorStatusLabel(status) {
    switch (String(status || '').toLowerCase()) {
        case 'queued': return 'QUEUED';
        case 'processing': return 'PROCESSING';
        case 'completed': return 'COMPLETED';
        case 'failed': return 'FAILED';
        default: return 'IDLE';
    }
}

function formatCompactTs(ts) {
    if (!ts) return '--';
    const date = typeof ts === 'number' ? new Date(ts) : new Date(String(ts));
    if (Number.isNaN(date.getTime())) return String(ts);
    return date.toLocaleString('en-IN', {
        timeZone: 'Asia/Kolkata',
        day: '2-digit',
        month: 'short',
        hour: '2-digit',
        minute: '2-digit',
        hour12: true
    });
}

function restoreEvaluatorJob() {
    if (typeof NativeBridge === 'undefined' || typeof NativeBridge.getCachedEvaluationJob !== 'function') return;
    const parsed = safeParseNB(NativeBridge.getCachedEvaluationJob(), {});
    if (parsed && typeof parsed === 'object' && parsed.job_id) {
        STATE.evaluatorJob = parsed;
    }
}

function clearEvaluatorPollTimer() {
    if (STATE.evaluatorPollTimer) {
        clearTimeout(STATE.evaluatorPollTimer);
        STATE.evaluatorPollTimer = null;
    }
}

function scheduleEvaluatorPoll(jobId) {
    clearEvaluatorPollTimer();
    STATE.evaluatorPollTimer = setTimeout(() => {
        refreshEvaluatorJobStatus(jobId).catch(err => {
            STATE.evaluatorError = err.message || String(err);
            STATE.evaluatorBusy = false;
            renderAll();
        });
    }, 12000);
}

function normalizeProposalRow(row) {
    const payload = typeof row?.proposal_json === 'string'
        ? safeParseNB(row.proposal_json, {})
        : (row?.proposal_json || {});
    return {
        rowId: row?.id || '',
        proposalId: payload.proposal_id || row?.proposal_id || row?.id || '',
        status: row?.status || payload?.status || '',
        indexKey: payload?.index || row?.index_key || payload?.index_key || 'ALL',
        category: row?.category || payload?.category || '',
        priority: row?.priority || payload?.priority || '',
        hypothesis: payload?.hypothesis || '',
        explanation: payload?.explanation || '',
        conditions: payload?.conditions || {},
        action: payload?.action || {},
        evidence: payload?.evidence || {},
        validationNotes: row?.validation_notes || '',
        approvedAt: row?.approved_at || '',
        raw: row || {}
    };
}

function proposalSummaryText(row) {
    const p = normalizeProposalRow(row);
    const parts = [];
    const cond = p.conditions || {};
    const action = p.action || {};
    if (Array.isArray(cond.regime) && cond.regime.length) parts.push(`Regime ${cond.regime.join('/')}`);
    if (cond.vix_min != null || cond.vix_max != null) parts.push(`VIX ${cond.vix_min ?? '-'} to ${cond.vix_max ?? '-'}`);
    if (action.min_sigma_otm != null || action.max_sigma_otm != null) parts.push(`σ ${action.min_sigma_otm ?? '-'} to ${action.max_sigma_otm ?? '-'}`);
    const allow = Array.isArray(action.strategy_allow) ? action.strategy_allow : [];
    const block = Array.isArray(action.strategy_block) ? action.strategy_block : [];
    if (allow.length) parts.push(`Allow ${allow.join(', ')}`);
    if (block.length) parts.push(`Block ${block.join(', ')}`);
    if (p.evidence?.sample_size != null) parts.push(`n=${p.evidence.sample_size}`);
    return parts.join(' · ');
}

async function loadApprovedBranchProposals(force = false) {
    const ttlMs = 2 * 60 * 1000;
    const now = Date.now();
    if (!force && Array.isArray(STATE.approvedBranchProposals) && (now - STATE.approvedBranchProposalsAt) < ttlMs) {
        return STATE.approvedBranchProposals;
    }
    const nativeMethod = force ? 'refreshApprovedBranchProposals' : 'getApprovedBranchProposals';
    const nativeRows = safeParseNB(typeof NativeBridge !== 'undefined' ? NativeBridge[nativeMethod]?.() : '[]', []);
    if (Array.isArray(nativeRows)) {
        STATE.approvedBranchProposals = nativeRows;
        STATE.approvedBranchProposalsAt = now;
        return nativeRows;
    }
    if (nativeRows && nativeRows.ok === false && nativeRows.error) {
        console.warn('[evaluator] approved proposal load failed:', nativeRows.error);
        STATE.evaluatorError = nativeRows.error;
    }
    STATE.approvedBranchProposals = [];
    STATE.approvedBranchProposalsAt = now;
    return STATE.approvedBranchProposals;
}

async function loadEvaluationProposals(jobId) {
    const response = callNativeJson('getEvaluationJobProposals', jobId);
    STATE.evaluatorProposals = Array.isArray(response.proposals) ? response.proposals : [];
    if (STATE.evaluatorJob) {
        STATE.evaluatorJob.proposal_count = STATE.evaluatorProposals.length;
    }
    return STATE.evaluatorProposals;
}

async function refreshEvaluatorJobStatus(jobId, { allowReschedule = true } = {}) {
    const response = callNativeJson('getEvaluationJobStatus', jobId);
    STATE.evaluatorJob = {
        ...(STATE.evaluatorJob || {}),
        ...response,
        job_id: response.job_id || jobId,
        updated_at: Date.now()
    };
    const status = String(STATE.evaluatorJob.status || '').toLowerCase();
    if (status === 'completed') {
        STATE.evaluatorBusy = false;
        STATE.evaluatorError = '';
        clearEvaluatorPollTimer();
        await loadEvaluationProposals(jobId);
    } else if (status === 'failed') {
        STATE.evaluatorBusy = false;
        STATE.evaluatorError = STATE.evaluatorJob.error || 'Evaluation failed';
        clearEvaluatorPollTimer();
    } else {
        STATE.evaluatorBusy = true;
        if (allowReschedule) scheduleEvaluatorPoll(jobId);
    }
    renderAll();
    return STATE.evaluatorJob;
}

async function triggerGeminiEvaluation(indexScope = ['BNF', 'NF']) {
    if (!window.NativeBridge?.triggerEvaluationJob) {
        alert('Native bridge not available. Use APK version.');
        return;
    }
    try {
        STATE.evaluatorBusy = true;
        STATE.evaluatorError = '';
        STATE.evaluatorProposals = [];
        renderAll();
        const response = callNativeJson('triggerEvaluationJob', JSON.stringify({
            index_scope: Array.isArray(indexScope) && indexScope.length ? indexScope : ['BNF', 'NF']
        }));
        if (!response.job_id) throw new Error('Oracle did not return job_id');
        STATE.evaluatorJob = {
            job_id: response.job_id || '',
            status: response.status || 'queued',
            proposal_count: 0,
            started_at: response.requested_at || Date.now(),
            index_scope: response.request_payload?.index_scope || indexScope,
            request_payload: response.request_payload || {}
        };
        scheduleEvaluatorPoll(STATE.evaluatorJob.job_id);
        renderAll();
        alert(`Evaluator queued.\n\nJob: ${STATE.evaluatorJob.job_id}\nWindow: ${STATE.evaluatorJob.request_payload.date_from} → ${STATE.evaluatorJob.request_payload.date_to}\n\nStatus will refresh automatically.`);
    } catch (e) {
        STATE.evaluatorBusy = false;
        STATE.evaluatorError = e.message || String(e);
        renderAll();
        alert(`Evaluator trigger failed: ${STATE.evaluatorError}`);
    }
}

async function reviewBranchProposal(rowId, nextStatus) {
    if (!rowId) {
        alert('Proposal row id missing. Refresh proposals first.');
        return;
    }
    const actionLabel = nextStatus === 'approved'
        ? 'Approve this proposal for live brain use? It will start affecting strategy filtering after sync.'
        : (nextStatus === 'rejected'
            ? 'Reject this proposal? It will stay out of the live brain.'
            : 'Deactivate this approved proposal? It will stop affecting the live brain after sync.');
    if (!confirm(actionLabel)) return;
    if (typeof NativeBridge === 'undefined') {
        alert('Native bridge not available. Use APK version.');
        return;
    }
    const methodName = nextStatus === 'approved' ? 'approveBranchProposal' : 'rejectBranchProposal';
    const response = callNativeJson(methodName, String(rowId));
    await loadApprovedBranchProposals(true);
    if (STATE.evaluatorJob?.job_id) {
        await loadEvaluationProposals(STATE.evaluatorJob.job_id);
    }
    renderAll();
    alert(response.message || (nextStatus === 'approved' ? 'Proposal approved and synced.' : (nextStatus === 'rejected' ? 'Proposal rejected.' : 'Proposal deactivated from live brain.')));
}

function syncUpstoxTokenToNative({ promptIfMissing = false } = {}) {
    if (typeof NativeBridge === 'undefined' || typeof NativeBridge.setApiToken !== 'function') return false;
    let token = localStorage.getItem('mr2_upstox_token') || '';
    token = token.trim();
    if (!token && promptIfMissing) {
        token = (window.prompt('Paste Upstox access token for live market data') || '').trim();
        if (token) localStorage.setItem('mr2_upstox_token', token);
    }
    if (!token) return false;
    NativeBridge.setApiToken(token);
    return true;
}

function requireFilledInputs(fields) {
    const missing = fields.filter(({ id }) => {
        const el = document.getElementById(id);
        return !el || !String(el.value || '').trim();
    }).map(({ label }) => label);
    if (missing.length) throw new Error(`Missing required input: ${missing.join(', ')}`);
}

function getBrainData() {
    try {
        if (typeof NativeBridge === 'undefined') return {};
        const raw = NativeBridge.getBrainResult();
        if (!raw || raw === 'null') return {};
        const parsed = JSON.parse(raw);
        return parsed || {};
    } catch (e) {
        console.error('getBrainData failed:', e);
        return {};
    }
}

function hasBrainPayload(brain) {
    return !!(brain && typeof brain === 'object' && Object.keys(brain).length > 0);
}

function noteBrainRefreshRequested(reason = 'refresh') {
    STATE.brainRefreshPending = true;
    STATE.brainRefreshReason = reason;
}

function adoptBrainResult(nextBrain, { preserveLastGood = true } = {}) {
    const incoming = nextBrain && typeof nextBrain === 'object' ? nextBrain : {};
    const incomingHasPayload = hasBrainPayload(incoming);
    const currentHasPayload = hasBrainPayload(bd);

    if (!incomingHasPayload && preserveLastGood && currentHasPayload) {
        return false;
    }

    bd = incoming;
    applyBrainRangeSigma(bd);

    if (incomingHasPayload) {
        STATE.brainReady = true;
        STATE.brainInsights = incoming;
        STATE.brainLastRun = Date.now();
        STATE.brainError = incoming.candidate_error || null;
        STATE.candidates = Array.isArray(incoming.generated_candidates) ? incoming.generated_candidates.slice() : [];
        STATE.watchlist = Array.isArray(incoming.watchlist) ? incoming.watchlist.slice() : [];
        STATE.positioningCandidates = Array.isArray(incoming.positioning_candidates) ? incoming.positioning_candidates.slice() : [];
        STATE.positioningBias = incoming.positioning_bias || null;
        STATE.brainRefreshPending = false;
        STATE.brainRefreshReason = '';
        STATE.lastScanTime = Date.now();
        return true;
    }
    return false;
}

function parseMLStatus(raw) {
    const fallback = { ok: false, version: 'unknown', nTrain: 0, thrTake: 0, thrWatch: 0, baseWr: 0, sampleP: 0, error: '' };
    const status = safeParseNB(raw, fallback);
    return {
        ok: !!status.ok,
        version: status.version || 'unknown',
        nTrain: Number.isFinite(status.nTrain) ? status.nTrain : (Number.isFinite(status.n_train) ? status.n_train : 0),
        thrTake: Number.isFinite(status.thrTake) ? status.thrTake : (Number.isFinite(status.thr_take) ? status.thr_take : 0),
        thrWatch: Number.isFinite(status.thrWatch) ? status.thrWatch : (Number.isFinite(status.thr_watch) ? status.thr_watch : 0),
        baseWr: Number.isFinite(status.baseWr) ? status.baseWr : (Number.isFinite(status.base_wr) ? status.base_wr : 0),
        sampleP: Number.isFinite(status.sampleP) ? status.sampleP : (Number.isFinite(status.sample_p) ? status.sample_p : 0),
        error: status.error || ''
    };
}

function getMLModelStatusCached(force = false) {
    const ttlMs = 5 * 60 * 1000;
    const now = Date.now();
    if (!force && STATE.mlModelStatus && (now - STATE.mlModelStatusAt) < ttlMs) {
        return STATE.mlModelStatus;
    }
    const raw = typeof NativeBridge !== 'undefined' && typeof NativeBridge.getMLModelStatus === 'function'
        ? NativeBridge.getMLModelStatus()
        : '{}';
    const parsed = parseMLStatus(raw);
    STATE.mlModelStatus = parsed;
    STATE.mlModelStatusAt = now;
    return parsed;
}

function getMLDecisionsCached(force = false) {
    const ttlMs = 90 * 1000;
    const now = Date.now();
    if (!force && Array.isArray(STATE.mlDecisions) && (now - STATE.mlDecisionsAt) < ttlMs) {
        return STATE.mlDecisions;
    }
    const raw = typeof NativeBridge !== 'undefined' && typeof NativeBridge.getMLDecisions === 'function'
        ? NativeBridge.getMLDecisions(120)
        : '[]';
    const parsed = safeParseNB(raw, []);
    STATE.mlDecisions = Array.isArray(parsed) ? parsed : [];
    STATE.mlDecisionsAt = now;
    return STATE.mlDecisions;
}

function getMLEvaluationOutcomesCached(force = false) {
    const ttlMs = 90 * 1000;
    const now = Date.now();
    if (!force && Array.isArray(STATE.mlEvaluationOutcomes) && (now - STATE.mlEvaluationOutcomesAt) < ttlMs) {
        return STATE.mlEvaluationOutcomes;
    }
    const raw = typeof NativeBridge !== 'undefined' && typeof NativeBridge.getMLEvaluationOutcomes === 'function'
        ? NativeBridge.getMLEvaluationOutcomes(1000)
        : '[]';
    const parsed = safeParseNB(raw, []);
    STATE.mlEvaluationOutcomes = Array.isArray(parsed) ? parsed : [];
    STATE.mlEvaluationOutcomesAt = now;
    return STATE.mlEvaluationOutcomes;
}

function getMLEvaluationLaneSummaryCached(force = false) {
    const ttlMs = 90 * 1000;
    const now = Date.now();
    if (!force && STATE.mlEvaluationLaneSummary && (now - (STATE.mlEvaluationLaneSummaryAt || 0)) < ttlMs) {
        return STATE.mlEvaluationLaneSummary;
    }
    const raw = typeof NativeBridge !== 'undefined' && typeof NativeBridge.getMLEvaluationLaneSummary === 'function'
        ? NativeBridge.getMLEvaluationLaneSummary(1000)
        : '{}';
    const parsed = safeParseNB(raw, {});
    STATE.mlEvaluationLaneSummary = parsed && typeof parsed === 'object' ? parsed : {};
    STATE.mlEvaluationLaneSummaryAt = now;
    return STATE.mlEvaluationLaneSummary;
}

function getMLBrainSnapshotsCached(force = false) {
    const ttlMs = 90 * 1000;
    const now = Date.now();
    if (!force && Array.isArray(STATE.mlBrainSnapshots) && (now - STATE.mlBrainSnapshotsAt) < ttlMs) {
        return STATE.mlBrainSnapshots;
    }
    const raw = typeof NativeBridge !== 'undefined' && typeof NativeBridge.getMLBrainSnapshots === 'function'
        ? NativeBridge.getMLBrainSnapshots(200)
        : '[]';
    const parsed = safeParseNB(raw, []);
    STATE.mlBrainSnapshots = Array.isArray(parsed) ? parsed : [];
    STATE.mlBrainSnapshotsAt = now;
    return STATE.mlBrainSnapshots;
}

function defaultTeacherTruthConfig() {
    return {
        label_version: 'teacher_v1',
        config_version: '2026-06-15',
        tp_capture_pct: 0.50,
        sl_loss_multiple: 1.00,
        stt_options: 0.0015,
        brokerage_per_order: 20,
        exchange_per_leg: 15,
        gst_rate: 0.18,
        fixed_buffer: 3,
        slippage: {
            NF_2LEG: 1.0,
            NF_4LEG: 2.0,
            BNF_2LEG: 2.0,
            BNF_4LEG: 4.0
        }
    };
}

function getTeacherTruthConfigCached(force = false) {
    const ttlMs = 5 * 60 * 1000;
    const now = Date.now();
    if (!force && STATE.teacherTruthConfig && (now - (STATE.teacherTruthConfigAt || 0)) < ttlMs) {
        return STATE.teacherTruthConfig;
    }
    const fallback = defaultTeacherTruthConfig();
    const raw = typeof NativeBridge !== 'undefined' && typeof NativeBridge.getTeacherTruthConfig === 'function'
        ? NativeBridge.getTeacherTruthConfig()
        : '{}';
    const parsed = safeParseNB(raw, fallback);
    STATE.teacherTruthConfig = parsed && typeof parsed === 'object'
        ? { ...fallback, ...parsed, slippage: { ...fallback.slippage, ...(parsed.slippage || {}) } }
        : fallback;
    STATE.teacherTruthConfigAt = now;
    return STATE.teacherTruthConfig;
}

function estimateTeacherRoundTripCost(tradeLike = {}, config = getTeacherTruthConfigCached()) {
    const indexKey = String(tradeLike.index_key || tradeLike.indexKey || 'BNF').toUpperCase() === 'NF' ? 'NF' : 'BNF';
    const strategyType = String(tradeLike.strategy_type || tradeLike.strategyType || '').toUpperCase();
    const legCount = Number(tradeLike.leg_count || tradeLike.legCount || ((strategyType === 'IRON_CONDOR' || strategyType === 'IRON_BUTTERFLY') ? 4 : 2)) || 2;
    const lotSize = Number(tradeLike.lot_size || tradeLike.lotSize || (indexKey === 'NF' ? C.NF_LOT : C.BNF_LOT)) || (indexKey === 'NF' ? C.NF_LOT : C.BNF_LOT);
    const sellLtp = Number(tradeLike.sell_ltp ?? tradeLike.sellLTP ?? 0) || 0;
    const sellLtp2 = Number(tradeLike.sell_ltp2 ?? tradeLike.sellLTP2 ?? 0) || 0;
    const sellPrem = legCount === 4 ? (sellLtp + sellLtp2) * lotSize : sellLtp * lotSize;
    const slipKey = `${indexKey}_${legCount}LEG`;
    const slipPerUnit = Number(config?.slippage?.[slipKey] ?? 0) || 0;
    const sttRate = Number(config?.stt_options ?? 0.0015) || 0.0015;
    const brokerage = Number(config?.brokerage_per_order ?? 20) || 20;
    const exchange = Number(config?.exchange_per_leg ?? 15) || 15;
    const gstRate = Number(config?.gst_rate ?? 0.18) || 0.18;
    const fixedBuffer = Number(config?.fixed_buffer ?? 3) || 3;
    return Math.round(
        sellPrem * sttRate * 2 +
        brokerage * legCount * 2 +
        exchange * legCount * 2 * (1 + gstRate) +
        slipPerUnit * lotSize * legCount * 2 +
        fixedBuffer
    );
}

function buildPaperPnlBreakdown(tradeLike = {}) {
    const grossMtm = Number(tradeLike.current_pnl || 0) || 0;
    const estimatedRoundTripCost = estimateTeacherRoundTripCost(tradeLike);
    const netIfClosedNow = grossMtm - estimatedRoundTripCost;
    return { grossMtm, estimatedRoundTripCost, netIfClosedNow };
}

function buildTeacherLaneStatsFromOutcomes(outcomes = []) {
    const lanes = {
        NF_intraday: { rows: 0, successes: 0, sumR: 0, winRs: [], lossRs: [], capturedSum: 0, capturedCount: 0 },
        NF_swing: { rows: 0, successes: 0, sumR: 0, winRs: [], lossRs: [], capturedSum: 0, capturedCount: 0 },
        BNF_intraday: { rows: 0, successes: 0, sumR: 0, winRs: [], lossRs: [], capturedSum: 0, capturedCount: 0 },
        BNF_swing: { rows: 0, successes: 0, sumR: 0, winRs: [], lossRs: [], capturedSum: 0, capturedCount: 0 }
    };
    const normalizeBool = (value) => {
        if (value === true || value === 1 || value === '1') return true;
        if (value === false || value === 0 || value === '0') return false;
        if (typeof value === 'string') {
            const text = value.trim().toLowerCase();
            if (text === 'true' || text === 'yes') return true;
            if (text === 'false' || text === 'no') return false;
        }
        return null;
    };
    for (const row of Array.isArray(outcomes) ? outcomes : []) {
        if (String(row?.role || 'secondary').toLowerCase() !== 'primary') continue;
        if (String(row?.label_version || '').trim() !== 'teacher_v1') continue;
        const laneKey = String(row?.lane || '').trim();
        const lane = lanes[laneKey];
        if (!lane) continue;
        const r = Number(row?.r_multiple);
        if (!Number.isFinite(r)) continue;
        lane.rows += 1;
        lane.sumR += r;
        if (r > 0) lane.winRs.push(r);
        if (r < 0) lane.lossRs.push(Math.abs(r));
        const success = normalizeBool(row?.is_success);
        if (success === true) lane.successes += 1;
        const captured = Number(row?.captured_pct);
        if (Number.isFinite(captured)) {
            lane.capturedSum += captured;
            lane.capturedCount += 1;
        }
    }
    Object.values(lanes).forEach((lane) => {
        lane.successRatePct = lane.rows > 0 ? (lane.successes / lane.rows) * 100 : 0;
        lane.expectancyR = lane.rows > 0 ? lane.sumR / lane.rows : 0;
        const avgWinR = lane.winRs.length ? lane.winRs.reduce((s, v) => s + v, 0) / lane.winRs.length : 0;
        const avgLossR = lane.lossRs.length ? lane.lossRs.reduce((s, v) => s + v, 0) / lane.lossRs.length : 0;
        lane.breakEvenWinRatePct = (avgWinR > 0 && avgLossR > 0) ? (avgLossR / (avgLossR + avgWinR)) * 100 : 0;
        lane.avgCapturedPct = lane.capturedCount > 0 ? (lane.capturedSum / lane.capturedCount) * 100 : 0;
        lane.worthTrading = lane.rows >= 30 && lane.expectancyR > 0 && lane.successRatePct > lane.breakEvenWinRatePct;
    });
    return lanes;
}

function normalizeDecisionIndex(row = {}) {
    const primary = safeParseNB(row.primary_candidate_json, {});
    const candidate = safeParseNB(row.candidate_json, {});
    const context = safeParseNB(row.context_json, {});
    const raw = String(
        row.index_key ||
        row.index ||
        row.indexKey ||
        row.symbol ||
        row.underlying ||
        row.instrument ||
        primary.index ||
        candidate.index ||
        context.index_key ||
        context.index ||
        ''
    ).toUpperCase();
    if (raw.includes('BNF') || raw.includes('BANKNIFTY')) return 'BNF';
    if (raw.includes('NF') || raw.includes('NIFTY')) return 'NF';
    return 'UNK';
}

function normalizeDecisionMode(row = {}) {
    const primary = safeParseNB(row.primary_candidate_json, {});
    const candidate = safeParseNB(row.candidate_json, {});
    const context = safeParseNB(row.context_json, {});
    const raw = String(
        row.trade_mode ||
        row.tradeMode ||
        row.mode ||
        row.execution_mode ||
        primary.trade_mode ||
        primary.tradeMode ||
        candidate.trade_mode ||
        candidate.tradeMode ||
        context.trade_mode ||
        context.tradeMode ||
        ''
    ).toLowerCase();
    if (raw === 'intraday') return 'intraday';
    if (raw === 'swing') return 'swing';
    const strategy = String(
        row.strategy ||
        row.recommendation_strategy ||
        row.strategy_type ||
        primary.type ||
        candidate.type ||
        ''
    ).toUpperCase();
    if (strategy === 'IRON_CONDOR' || strategy === 'IRON_BUTTERFLY') return 'intraday';
    return 'unknown';
}

function resolveDecisionWon(row = {}) {
    for (const key of ['canonical_won', 'outcome_h2', 'won']) {
        const value = row?.[key];
        if (value === true || value === 1) return 1;
        if (value === false || value === 0) return 0;
        if (typeof value === 'string') {
            const text = value.trim().toLowerCase();
            if (text === 'true' || text === '1' || text === 'yes') return 1;
            if (text === 'false' || text === '0' || text === 'no') return 0;
        }
    }
    return null;
}

function buildMlLaneStats(decisions = []) {
    const lanes = {
        NF_intraday: { index: 'NF', mode: 'intraday', rows: 0, labeled: 0, wins: 0 },
        NF_swing: { index: 'NF', mode: 'swing', rows: 0, labeled: 0, wins: 0 },
        BNF_intraday: { index: 'BNF', mode: 'intraday', rows: 0, labeled: 0, wins: 0 },
        BNF_swing: { index: 'BNF', mode: 'swing', rows: 0, labeled: 0, wins: 0 }
    };
    for (const row of Array.isArray(decisions) ? decisions : []) {
        const primary = safeParseNB(row?.primary_candidate_json, {});
        const candidate = safeParseNB(row?.candidate_json, {});
        const explicitLane = String(row?.lane || primary?.lane || candidate?.lane || '').trim();
        const index = normalizeDecisionIndex(row);
        const mode = normalizeDecisionMode(row);
        const key = lanes[explicitLane] ? explicitLane : `${index}_${mode}`;
        if (!lanes[key]) continue;
        lanes[key].rows += 1;
        const won = resolveDecisionWon(row);
        if (!(won === 0 || won === 1)) continue;
        lanes[key].labeled += 1;
        if (won === 1) lanes[key].wins += 1;
    }
    for (const lane of Object.values(lanes)) {
        lane.winRate = lane.labeled > 0 ? ((lane.wins / lane.labeled) * 100) : null;
    }
    return lanes;
}

function buildMlLaneStatsFromOutcomes(outcomes = [], snapshots = []) {
    const lanes = {
        NF_intraday: { index: 'NF', mode: 'intraday', rows: 0, labeled: 0, wins: 0 },
        NF_swing: { index: 'NF', mode: 'swing', rows: 0, labeled: 0, wins: 0 },
        BNF_intraday: { index: 'BNF', mode: 'intraday', rows: 0, labeled: 0, wins: 0 },
        BNF_swing: { index: 'BNF', mode: 'swing', rows: 0, labeled: 0, wins: 0 }
    };
    const snapshotMap = new Map();
    for (const snap of Array.isArray(snapshots) ? snapshots : []) {
        const id = String(snap?.id || '').trim();
        if (id && !snapshotMap.has(id)) snapshotMap.set(id, snap);
    }

    function resolveOutcomeCandidate(row, snap) {
        const wantedId = String(row?.candidate_id || '').trim();
        if (!snap || !wantedId) return {};
        const primary = safeParseNB(snap.primary_candidate_json, {});
        if (String(primary?.id || '').trim() === wantedId) return primary;

        const ctx = safeParseNB(snap.context_json, {});
        const generated = Array.isArray(ctx?.snapshot_generated_candidates) ? ctx.snapshot_generated_candidates : [];
        const generatedMatch = generated.find(c => String(c?.id || '').trim() === wantedId);
        if (generatedMatch) return generatedMatch;

        const topCandidates = safeParseNB(snap.top_candidates_json, []);
        if (Array.isArray(topCandidates)) {
            const topMatch = topCandidates.find(c => String(c?.id || '').trim() === wantedId);
            if (topMatch) return topMatch;
        }
        return {};
    }

    function resolveOutcomeLaneKey(row, snap) {
        const explicitLane = String(row?.lane || '').trim();
        if (lanes[explicitLane]) return explicitLane;

        const candidate = resolveOutcomeCandidate(row, snap);
        const candidateLane = String(candidate?.lane || '').trim();
        if (lanes[candidateLane]) return candidateLane;

        const directBase = {
            index_key: row?.index_key || candidate?.index || candidate?.index_key,
            trade_mode: row?.trade_mode || candidate?.trade_mode || candidate?.tradeMode,
            strategy_type: row?.strategy_type || candidate?.type || candidate?.strategy_type
        };
        const directKey = `${normalizeDecisionIndex(directBase)}_${normalizeDecisionMode(directBase)}`;
        if (lanes[directKey]) return directKey;

        const primary = safeParseNB(snap?.primary_candidate_json, {});
        const primaryLane = String(primary?.lane || '').trim();
        if (lanes[primaryLane]) return primaryLane;

        const ctx = safeParseNB(snap?.context_json, {});
        const fallbackBase = {
            index_key: primary?.index || primary?.index_key || row?.index_key,
            trade_mode: row?.trade_mode || ctx?.trade_mode || ctx?.tradeMode,
            strategy_type: row?.strategy_type || primary?.type || primary?.strategy_type
        };
        const fallbackKey = `${normalizeDecisionIndex(fallbackBase)}_${normalizeDecisionMode(fallbackBase)}`;
        return lanes[fallbackKey] ? fallbackKey : '';
    }

    for (const row of Array.isArray(outcomes) ? outcomes : []) {
        const outcome = resolveDecisionWon(row);
        if (!(outcome === 0 || outcome === 1)) continue;
        const snapshotId = String(row?.snapshot_id || '').trim();
        const snap = snapshotId ? snapshotMap.get(snapshotId) : null;
        const key = resolveOutcomeLaneKey(row, snap);
        if (!key || !lanes[key]) continue;
        lanes[key].rows += 1;
        lanes[key].labeled += 1;
        if (outcome === 1 || outcome === true) lanes[key].wins += 1;
    }
    for (const lane of Object.values(lanes)) {
        lane.winRate = lane.labeled > 0 ? ((lane.wins / lane.labeled) * 100) : null;
    }
    return lanes;
}

function topCounterEntries(counter, limit = 3) {
    if (!counter || typeof counter !== 'object') return [];
    return Object.entries(counter)
        .filter(([, value]) => Number(value) > 0)
        .sort((a, b) => Number(b[1]) - Number(a[1]))
        .slice(0, limit);
}

function buildCandidatePipelineDiagnostics(brain = {}, snapshots = []) {
    const latestSnapshot = Array.isArray(snapshots) && snapshots.length > 0 ? snapshots[0] : null;
    const ctx = safeParseNB(latestSnapshot?.context_json, {});
    const liveStats = safeParseNB(brain?.candidate_stats, brain?.candidate_stats || {});
    const trace = safeParseNB(ctx?.candidate_generation_trace, ctx?.candidate_generation_trace || {});
    const rejectedStats = safeParseNB(ctx?.snapshot_rejected_candidate_stats, ctx?.snapshot_rejected_candidate_stats || {});
    const skipReason = safeParseNB(ctx?.snapshot_generation_skip_reason, ctx?.snapshot_generation_skip_reason || {});
    const skipReasons = Array.isArray(ctx?.snapshot_generation_skip_reasons) ? ctx.snapshot_generation_skip_reasons : [];
    const snapshotGenerated = Array.isArray(ctx?.snapshot_generated_candidates) ? ctx.snapshot_generated_candidates : [];
    const snapshotWatchlist = Array.isArray(ctx?.snapshot_watchlist) ? ctx.snapshot_watchlist : [];
    const latestPoll = safeParseNB(ctx?.snapshot_latest_poll, ctx?.snapshot_latest_poll || {});
    const byIndex = safeParseNB(trace?.by_index, trace?.by_index || {});

    const generatedCount = Array.isArray(brain?.generated_candidates) && brain.generated_candidates.length > 0
        ? brain.generated_candidates.length
        : snapshotGenerated.length;
    const watchlistCount = Array.isArray(brain?.watchlist) && brain.watchlist.length > 0
        ? brain.watchlist.length
        : snapshotWatchlist.length;
    const rejectedCount = Number.isFinite(liveStats?.rejected) ? Number(liveStats.rejected) : Number(rejectedStats?.total || 0);
    const acceptedTrace = Number.isFinite(trace?.accepted_count) ? Number(trace.accepted_count) : Number(liveStats?.total || 0);
    const rejectedTrace = Number.isFinite(trace?.rejected_count) ? Number(trace.rejected_count) : rejectedCount;

    const stageEntries = topCounterEntries(rejectedStats?.by_stage, 4);
    const reasonEntries = topCounterEntries(rejectedStats?.by_reason, 4);
    const indexSummaries = ['BNF', 'NF'].map(indexKey => {
        const row = byIndex?.[indexKey];
        const stats = row?.attempt_stats || {};
        if (!row || (!Number(stats.total) && !Number(stats.accepted) && !Number(stats.rejected))) return null;
        return {
            index: indexKey,
            total: Number(stats.total || 0),
            accepted: Number(stats.accepted || 0),
            rejected: Number(stats.rejected || 0)
        };
    }).filter(Boolean);

    return {
        source: latestSnapshot ? 'latest_saved_snapshot' : 'live_brain_result',
        generatedCount,
        watchlistCount,
        rejectedCount,
        acceptedTrace,
        rejectedTrace,
        latestPollTime: latestPoll?.t || latestPoll?.time || latestSnapshot?.poll_ts || '',
        stageEntries,
        reasonEntries,
        indexSummaries,
        skipReason: skipReason?.detail || '',
        skipReasonCode: skipReason?.reason_code || '',
        skipReasons
    };
}

function refreshBrainData() {
    if (typeof NativeBridge !== 'undefined') {
        const serviceStatus = safeParseNB(NativeBridge.getServiceStatus?.(), {});
        const latestPoll = safeParseNB(NativeBridge.getLatestPoll?.(), {});
        if (!todayNativeSessionActive(serviceStatus, latestPoll) && !serviceStatus.running) {
            clearSessionDerivedState();
            return bd;
        }
    }
    adoptBrainResult(getBrainData());
    return bd;
}

function applyBrainRangeSigma(brainResult) {
    const sigma = brainResult?.regime?.sigma ?? brainResult?.marketPhase?.sigma ?? null;
    const n = Number(sigma);
    if (Number.isFinite(n)) STATE.rangeSigma = Number(n.toFixed(2));
}

function pullNativeState() {
    if (typeof NativeBridge === 'undefined') return {};
    const status = safeParseNB(NativeBridge.getServiceStatus?.(), {});
    const pollHistory = safeParseNB(NativeBridge.getPollHistory?.(), []);
    const latestPoll = safeParseNB(NativeBridge.getLatestPoll?.(), {});
    if (!todayNativeSessionActive(status, latestPoll, pollHistory) && !status.running) {
        clearSessionDerivedState();
        return { status, pollHistory: [], latestPoll: {}, brainResult: {} };
    }
    const brainResult = safeParseNB(NativeBridge.getBrainResult?.(), {});

    if (Array.isArray(pollHistory)) {
        STATE.pollHistory = pollHistory;
        const nativePolls = Number.isFinite(status.polls) ? status.polls : 0;
        STATE.pollCount = Math.max(nativePolls, pollHistory.length, STATE.pollCount || 0);
    } else if (status.polls) {
        STATE.pollCount = Math.max(status.polls, STATE.pollCount || 0);
    }
    if (latestPoll && Object.keys(latestPoll).length) {
        STATE.live = latestPoll;
    }
    adoptBrainResult(brainResult);
    return { status, pollHistory, latestPoll, brainResult };
}

function startNativePollWatchdog() {
    if (STATE._nativePollWatchdog) clearInterval(STATE._nativePollWatchdog);
    STATE._nativePollStartedAt = Date.now();
    STATE._nativePollWatchdog = setInterval(() => {
        try {
            const snapshot = pullNativeState();
            const mlAutoRefreshed = maybeAutoRefreshMlStatus(snapshot.status);
            renderFooter();
            const hasPoll = snapshot.latestPoll && Object.keys(snapshot.latestPoll).length;
            if (mlAutoRefreshed || hasPoll || STATE.pollCount > 0) {
                renderAll();
                return;
            }
            const elapsedSec = Math.floor((Date.now() - (STATE._nativePollStartedAt || Date.now())) / 1000);
            if (elapsedSec >= 90) {
                const statusEl = document.getElementById('status');
                const nativeStatus = snapshot.status || {};
                if (statusEl) {
                    statusEl.textContent = `Service running, waiting for first poll (${elapsedSec}s). Check Logs if this continues. Polls: ${nativeStatus.polls || 0}`;
                }
            }
        } catch (e) {
            console.warn('[watchdog] native poll pull failed:', e.message);
        }
    }, 10000);
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
        latestPoll = safeParseNB(
            (typeof NativeBridge !== 'undefined' && NativeBridge.getLatestPoll) ? NativeBridge.getLatestPoll() : null,
            {}
        );
    } catch (e) {
        latestPoll = {};
    }
    let eveningClose = null;
    try {
        eveningClose = JSON.parse(localStorage.getItem('mr2_evening_close') || 'null');
    } catch (e) {
        eveningClose = null;
    }
    const ecBnf = eveningClose && eveningClose.bnfSpot ? eveningClose.bnfSpot : 0;
    const ecNf = eveningClose && eveningClose.nfSpot ? eveningClose.nfSpot : 0;
    const ecVix = eveningClose && eveningClose.vix ? eveningClose.vix : 0;
    return {
        date: API.todayIST(),
        bnfSpot: parseFloat(latestPoll.bnfSpot ?? latestPoll.bnf ?? ecBnf ?? 0) || 0,
        nfSpot: parseFloat(latestPoll.nfSpot ?? latestPoll.nf ?? ecNf ?? 0) || 0,
        vix: parseFloat(latestPoll.vix ?? ecVix ?? 0) || 0,
        bnfCallWall: parseFloat(latestPoll.bnfCallWall ?? latestPoll.cw ?? 0) || 0,
        bnfPutWall: parseFloat(latestPoll.bnfPutWall ?? latestPoll.pw ?? 0) || 0,
        fiiCash: num('in-fii-cash'),
        fiiShortPct: num('in-fii-short'),
        fiiIdxFut: num('in-fii-idx-fut'),
        fiiStkFut: num('in-fii-stk-fut'),
        diiCash: num('in-dii-cash'),
        dowClose: num('in-dow-close'),
        crudeSettle: num('in-crude-settle'),
        giftSpot: num('in-gift-spot'),
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
function candidateLegCount(c) {
    if (Array.isArray(c?.legs)) return c.legs.length;
    if (Number.isFinite(Number(c?.legCount))) return Number(c.legCount);
    if (Number.isFinite(Number(c?.legs))) return Number(c.legs);
    return 0;
}

function peakCash(c) {
    const buyLeg = (c.buyLTP || 0) + (candidateLegCount(c) === 4 ? (c.buyLTP2 || 0) : 0);
    return Math.round(buyLeg * (c.lotSize || 30));
}

// b91: Broker margin estimate — real SPAN margin, not just maxLoss
// 2-leg spreads: margin ≈ maxLoss (spread benefit applies)
// 4-leg IC/IB: SPAN on 2 short legs, ~90% after spread benefit from long legs
function estimateBrokerMargin(c) {
    if (candidateLegCount(c) === 4) {
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
// Candidate scoring and safety decisions are owned by native brain.
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

async function sendNotification(title, body, type) {
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
    STATE.isWatching = true;
    pullNativeState();
    startNativePollWatchdog();
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

        // The Android service now sends POLL_TICK as a lightweight wake-up signal.
        // When no payload is attached, pull the current native snapshot directly.
        if (!data || typeof data !== 'object') {
            const snapshot = pullNativeState();
            try {
                updateWatchStatusHint(snapshot.status || {});
            } catch (e) {
                console.warn('[syncFromNative] watch-status refresh failed:', e.message);
            }
            renderAll();
            return;
        }

        // Poll history — Kotlin is the source of truth for today's session.
        if (data.pollHistory && Array.isArray(data.pollHistory)) {
            STATE.pollHistory = data.pollHistory;
            STATE.pollCount = data.pollHistory.length;
        }
        // Kotlin may send a separate pollCount; never add a restored base across days.
        if (Object.prototype.hasOwnProperty.call(data, 'pollCount') && !data.pollHistory) {
            STATE.pollCount = data.pollCount;
        }
        
        // Phase 4: Full brain result from Kotlin
        if (data.brainResult) {
            adoptBrainResult(data.brainResult);
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
        try {
            updateWatchStatusHint(safeParseNB(NativeBridge.getServiceStatus?.(), {}));
        } catch (e) {
            console.warn('[syncFromNative] watch-status refresh failed:', e.message);
        }
        
        // Phase 3: Use brain-generated candidates if available (b114)
        if (data.brainResult?.generated_candidates?.length > 0) {
            const brainCands = data.brainResult.generated_candidates;
            const curatedWatchlist = Array.isArray(data.brainResult.watchlist) ? data.brainResult.watchlist : [];
            STATE.candidates = brainCands.slice();
            bd.generated_candidates = brainCands.slice();
            bd.watchlist = curatedWatchlist.slice();
            STATE.watchlist = curatedWatchlist.slice();
            STATE._lastCandidateBias = bd.effective_bias?.bias || bd.morningBias?.bias;
        }

        // Legacy fallback only. In normal native mode, brainResult.watchlist is authoritative.
        if (!data.brainResult && data.candidates && Array.isArray(data.candidates) && data.candidates.length > 0) {
            STATE.candidates = data.candidates;
            STATE.watchlist = data.candidates.slice(0, 6);
            STATE._lastCandidateBias = bd.effective_bias?.bias || bd.morningBias?.bias;
        }
        
        // Phase 4: Live spots from Kotlin
        if (data.spots) {
            // Removed dead no-op mutation of parsed latest poll object.
            // Native state is rendered via pullNativeState()/latestPollData().
            // Update header display
            const bnfEl = document.querySelector('.spot-bnf, [data-spot="bnf"]');
            const nfEl = document.querySelector('.spot-nf, [data-spot="nf"]');
            const vixEl = document.querySelector('.spot-vix, [data-spot="vix"]');
        }
        
        // Phase 4: Updated trade P&L from Kotlin
        if (data.openTrades && Array.isArray(data.openTrades)) {
            const openTrades = currentOpenTrades();
            let changed = false;
            for (const nt of data.openTrades) {
                const idx = openTrades.findIndex(t => String(t.id) === String(nt.id));
                if (idx >= 0) {
                    openTrades[idx] = {
                        ...openTrades[idx],
                        ...nt,
                        // Preserve best local peak if UI already saw a higher one.
                        peak_pnl: Math.max(openTrades[idx].peak_pnl || 0, nt.peak_pnl || 0)
                    };
                    changed = true;
                } else {
                    openTrades.push(nt);
                    changed = true;
                }
            }
            if (changed) {
                STATE.openTrades = openTrades;
            }
        }
        
        renderAll();
    } catch(e) {
        console.warn('[b108] syncFromNative error:', e.message);
    }
};

// ═══ TRADE MODE TOGGLE — Intraday vs Swing ═══
function toggleTradeMode() {
    STATE.tradeMode = STATE.tradeMode === 'swing' ? 'intraday' : 'swing';
    noteBrainRefreshRequested(`mode:${STATE.tradeMode}`);
    if (typeof NativeBridge !== 'undefined' && NativeBridge.setTradeMode) {
        NativeBridge.setTradeMode(STATE.tradeMode);
    }
    if (typeof NativeBridge !== 'undefined' && NativeBridge.requestImmediatePoll) {
        NativeBridge.requestImmediatePoll();
    }
    // Persist mode
    const currentTheme = document.body.classList.contains('dark') ? 'dark' : 'light';
    setLocalTradeMode(STATE.tradeMode, true);
    persistSettingsPatch({ theme: currentTheme, tradeMode: STATE.tradeMode, tradeModeExplicit: true });
    addNotificationLog('Mode Switch', `Switched to ${STATE.tradeMode.toUpperCase()} mode. Waiting for native brain refresh.`, 'info');
    renderWatchlist();
    renderFooter();
}

// ═══ RESCAN STRATEGIES — request native brain refresh ═══
async function rescanStrategies() {
    // F.2 reduced: brain.py generates candidates inside analyze().
    // Ask Kotlin for a fresh poll/brain cycle, then re-render current state.
    try {
        noteBrainRefreshRequested(`rescan:${STATE.tradeMode}`);
        if (typeof NativeBridge !== 'undefined' && NativeBridge.requestImmediatePoll) {
            NativeBridge.requestImmediatePoll();
        }
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
async function takeTradeImpl(candidateId, isPaper = false) {
    const cand = (bd.watchlist || []).find(c => String(c.id) === String(candidateId))
        || (bd.generated_candidates || []).find(c => String(c.id) === String(candidateId))
        || STATE.positioningCandidates.find(c => String(c.id) === String(candidateId));
    if (!cand) { console.warn('takeTrade: candidate not found:', candidateId); return; }
    const forces = cand.forces || { aligned: 0, f1: 0, f2: 0, f3: 0 };
    const latestPoll = safeParseNB(NativeBridge.getLatestPoll?.(), {});
    let pollHistory = safeParseNB(NativeBridge.getPollHistory?.(), []);

    // b105: Pull fresh poll history from Kotlin before snapshotting.
    // Covers the case where user returns from background and takes a trade
    // before the next poll fires — (JSON.parse(NativeBridge.getPollHistory() || '[]')) could otherwise be stale.
    if (window.NativeBridge?.getPollHistory) {
        try {
            const fresh = safeParseNB(window.NativeBridge.getPollHistory(), []);
            if (Array.isArray(fresh) && fresh.length > pollHistory.length) {
                STATE.pollHistory = fresh;
                pollHistory = fresh;
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
    const rankList = (bd.watchlist || []).filter(c => c.index === cand.index);
    const candRank = rankList.findIndex(c => c.id === cand.id) + 1;

    const isBNF = cand.index === 'BNF';
    const chain = isBNF ? safeParseNB(NativeBridge.getBnfChain(), {}) : safeParseNB(NativeBridge.getNfChain(), {});
    const strikeLeg = (strike, type) => chain?.strikes?.[strike]?.[type] || {};
    const spot = isBNF ? latestPoll.bnfSpot : latestPoll.nfSpot;
    const daily1Sigma = spot * ((latestPoll.vix || 0) / 100) / 15.8745  /* √252 */;
    const entryLotSize = cand.lotSize || (isBNF ? C.BNF_LOT : C.NF_LOT);
    const executionMode = isPaper
        ? 'paper'
        : (String(cand.executionReadiness?.mode || 'paper').toLowerCase());

    const trade = {
        strategy_type: cand.type,
        index_key: cand.index,
        expiry: cand.expiry,
        entry_date: new Date().toISOString(),
        entry_spot: spot,
        entry_vix: latestPoll.vix,
        entry_atm_iv: isBNF ? latestPoll.bnfAtmIv : latestPoll.nfAtmIv,
        entry_premium: cand.netPremium,
        width: cand.width,
        sell_strike: cand.sellStrike,
        sell_type: cand.sellType,
        sell_ltp: cand.sellLTP,
        buy_strike: cand.buyStrike,
        buy_type: cand.buyType,
        buy_ltp: cand.buyLTP,
        sell_instrument_key: cand.sellInstrumentKey ?? null,
        buy_instrument_key: cand.buyInstrumentKey ?? null,
        // 4-leg second side (IC/IB put side)
        sell_strike2: cand.sellStrike2 ?? null,
        sell_type2: cand.sellType2 ?? null,
        sell_ltp2: cand.sellLTP2 ?? null,
        buy_strike2: cand.buyStrike2 ?? null,
        buy_type2: cand.buyType2 ?? null,
        buy_ltp2: cand.buyLTP2 ?? null,
        sell_instrument_key2: cand.sellInstrumentKey2 ?? null,
        buy_instrument_key2: cand.buyInstrumentKey2 ?? null,
        max_profit: cand.maxProfit,
        max_loss: cand.maxLoss,
        is_credit: cand.isCredit,
        force_alignment: forces.aligned,
        force_f1: forces.f1,
        force_f2: forces.f2,
        force_f3: forces.f3,
        entry_pcr: isBNF ? latestPoll.pcr : (latestPoll.nfPcr || (JSON.parse(NativeBridge.getNfChain() || '{}'))?.pcr),
        entry_futures_premium: isBNF ? latestPoll.futuresPremBnf : (latestPoll.futuresPremNf || (JSON.parse(NativeBridge.getNfChain() || '{}'))?.futuresPremium),
        entry_max_pain: isBNF ? (latestPoll.maxPainBnf ?? (JSON.parse(NativeBridge.getBnfChain() || '{}'))?.maxPain) : ((JSON.parse(NativeBridge.getNfChain() || '{}'))?.maxPain ?? (JSON.parse(NativeBridge.getBaseline() || '{}'))?.maxPainNf),
        entry_sell_oi: strikeLeg(cand.sellStrike, cand.sellType).oi ?? null,
        entry_bias: latestPoll.bias?.label,
        entry_bias_net: latestPoll.bias?.net,
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
        execution_mode: executionMode,
        execution_status: 'not_sent',
        execution_error: null,
        order_tag: null,
        status: 'OPEN',
        current_pnl: 0,
        peak_pnl: 0,
        lots: 1,
        paper: isPaper,
        // b91: IC/IB always intraday — 0% overnight survival (backtest confirmed)
        trade_mode: (cand.type === 'IRON_CONDOR' || cand.type === 'IRON_BUTTERFLY') ? 'intraday' : (STATE.tradeMode || DEFAULT_TRADE_MODE),

        // ═══ RICH SNAPSHOT — everything for calibration (JSONB) ═══
        entry_snapshot: {
            // Candidate quality
            candidate_rank: candRank || null,
            varsity_tier: cand.varsityTier || null,
            // App vs trader tracking — was this the app's #1 pick?
            app_top_strategy: rankList[0]?.type || null,
            app_top_strike: rankList[0]?.sellStrike || null,
            followed_app: candRank === 1,
            lot_size: entryLotSize,
            context_score: cand.contextScore ?? 0,
            ev: cand.ev ?? null,
            net_theta: cand.netTheta ?? null,
            net_delta: cand.netDelta ?? null,
            risk_reward: cand.riskReward || null,
            target_profit: cand.targetProfit ?? null,
            stop_loss: cand.stopLoss ?? null,
            sell_oi: strikeLeg(cand.sellStrike, cand.sellType).oi ?? null,
            sell_oi2: cand.sellStrike2 ? (strikeLeg(cand.sellStrike2, cand.sellType2).oi ?? null) : null,
            buy_oi: strikeLeg(cand.buyStrike, cand.buyType).oi ?? null,
            sigma_from_atm: daily1Sigma > 0 ? +((Math.abs(cand.sellStrike - spot)) / daily1Sigma).toFixed(2) : null,
            // Market environment
            near_atm_pcr: isBNF ? latestPoll.nearAtmPCR : (latestPoll.nfNearAtmPCR || (JSON.parse(NativeBridge.getNfChain() || '{}'))?.nearAtmPCR),
            iv_percentile: latestPoll.ivPercentile ?? null,
            spot_sigma: latestPoll.spotSigma ?? null,
            vix_sigma: latestPoll.vixSigma ?? null,
            vix_direction: (JSON.parse(NativeBridge.getYesterdayHistory(7) || '[]'))?.[0]?.vix ? +(latestPoll.vix - (JSON.parse(NativeBridge.getYesterdayHistory(7) || '[]'))[0].vix).toFixed(2) : null,
            // OI structure
            call_wall: isBNF ? latestPoll.bnfCallWall : ((JSON.parse(NativeBridge.getNfChain() || '{}'))?.callWallStrike ?? null),
            call_wall_oi: isBNF ? latestPoll.bnfCallWallOI : ((JSON.parse(NativeBridge.getNfChain() || '{}'))?.callWallOI ?? null),
            put_wall: isBNF ? latestPoll.bnfPutWall : ((JSON.parse(NativeBridge.getNfChain() || '{}'))?.putWallStrike ?? null),
            put_wall_oi: isBNF ? latestPoll.bnfPutWallOI : ((JSON.parse(NativeBridge.getNfChain() || '{}'))?.putWallOI ?? null),
            max_pain_dist: (() => {
                const mp = isBNF ? (latestPoll.maxPainBnf || (JSON.parse(NativeBridge.getBnfChain() || '{}'))?.maxPain) : ((JSON.parse(NativeBridge.getNfChain() || '{}'))?.maxPain || null);
                return mp ? Math.round(spot - mp) : null;
            })(),
            total_call_oi: isBNF ? latestPoll.bnfTotalCallOI : ((JSON.parse(NativeBridge.getNfChain() || '{}'))?.totalCallOI ?? null),
            total_put_oi: isBNF ? latestPoll.bnfTotalPutOI : ((JSON.parse(NativeBridge.getNfChain() || '{}'))?.totalPutOI ?? null),
            // Institutional
            regime: bd.institutionalRegime?.regime || null,
            regime_detail: bd.institutionalRegime?.regimeDetail || null,
            fii_deriv_net: bd.institutionalRegime ? (parseFloat((JSON.parse(NativeBridge.getMorningSnapshot(API.todayIST()) || '{}'))?.fiiIdxFut || 0) + parseFloat((JSON.parse(NativeBridge.getMorningSnapshot(API.todayIST()) || '{}'))?.fiiStkFut || 0)) : null,
            absorption_ratio: bd.institutionalRegime?.absorptionRatio ?? null,
            contrarian_pcr: STATE.contrarianPCR?.signal || null,
            // Bias detail — all 7 signal votes
            bias_signals: latestPoll.bias?.signals?.map(s => ({ n: s.name, d: s.dir, v: s.value })) || [],
            morning_bias: bd.morningBias?.label || null,
            bias_drift: STATE.biasDrift ?? 0,
            upstox_agrees: latestPoll.bias?.upstoxAgrees ?? null,
            // Breadth
            bnf_breadth_pct: safeParseNB(NativeBridge.getBnfBreadth(), {})?.pct ?? null,
            nf50_advancing: safeParseNB(NativeBridge.getNf50Breadth(), {})?.advancing ?? null,
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
        addOpenTradeToState(trade);
        playSound('entry');
        switchTab('positions');
        renderAll();

        // b105: Write full ML decision record for execution-quality tracking.
        // ML scores are nullable until a trained model exists.
        if (DB.supabase) {
            const pollSeq = pollHistory.slice(-6).map(p => ({
                vix:           p.vix ?? null,
                pcr:           p.pcr ?? p.nearAtmPcr ?? null,
                bias_net:      p.biasNet ?? p.bias_net ?? null,
                breadth:       p.breadth ?? null,
                spot_move_pct: p.spotMovePct ?? null,
                futures_prem:  p.futuresPremBnf ?? p.futuresPrem ?? null,
            }));
            const last = pollHistory[pollHistory.length - 1] || {};
            const mlDoc = {
                trade_id:   saved.id,
                date:       API.todayIST(),
                entry_time: new Date().toLocaleTimeString('en-IN', {hour:'2-digit', minute:'2-digit', hour12: false}),
                strategy:   cand.type,
                index_name: cand.index,
                mode:       trade.trade_mode,
                paper:      isPaper,
                vix:        latestPoll.vix ?? null,
                sigma_away: cand.sigmaOTM ?? null,
                gap_sigma:  bd.gapInfo?.sigma ?? null,
                entry_credit: cand.netPremium ?? null,
                width:      cand.width ?? null,
                dte:        cand.tDTE ?? null,
                max_profit: cand.maxProfit ?? null,
                max_loss:   cand.maxLoss ?? null,
                vix_regime: (latestPoll.vix >= 20 ? 'HIGH (20-25)' : latestPoll.vix < 15 ? 'LOW (<15)' : 'NORMAL (15-20)'),
                day_direction: last.dayDirection ?? null,
                day_range:  last.dayRange ?? null,
                market_snapshot: {
                    vix:          latestPoll.vix,
                    pcr:          latestPoll.pcr,
                    near_atm_pcr: latestPoll.nearAtmPCR,
                    breadth:      latestPoll.breadth,
                    futures_prem: latestPoll.futuresPremBnf,
                    spot:         isBNF ? latestPoll.bnfSpot : latestPoll.nfSpot,
                    iv_percentile:latestPoll.ivPercentile,
                    bias_net:     latestPoll.bias?.net,
                    gap_sigma:    bd.gapInfo?.sigma,
                    weekday:      new Date().getDay(),
                },
                candidate_snap: {
                    sigma_away:    cand.sigmaOTM,
                    width:         cand.width,
                    entry_credit:  cand.netPremium,
                    ev:            cand.ev,
                    force_alignment: forces.aligned,
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
                canonical_won: null,
                model_version: '2.1.1',
            };
            if (DB.supabase) {
                DB.supabase.from('ml_decisions').insert(mlDoc)
                  .then(({error}) => {
                      if (!error) return;
                      const legacyDoc = { ...mlDoc };
                      delete legacyDoc.canonical_won;
                      DB.supabase.from('ml_decisions').insert(legacyDoc)
                        .then(({error: legacyError}) => {
                            if (legacyError) console.warn('[ML] ml_decisions insert failed:', legacyError.message);
                        });
                  });
            }
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
            addOpenTradeToState(trade);
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
            if (isPaper) {
                trade.id = `paper-local-${Date.now()}`;
                trade.local_only = true;
                addOpenTradeToState(trade);
                playSound('entry');
                switchTab('positions');
                renderAll();
                addNotificationLog('Paper Trade Local Only', 'Supabase insert failed; paper trade saved locally on this device.', 'caution');
                alert('⚠️ Paper trade saved locally only. Supabase calibration upload failed.');
            } else {
                alert('❌ Trade log failed! Use Manual Log on Position tab.\nCheck Debug panel for error details.');
            }
        }
    }
}

async function takeTrade(candidateId, isPaper = false) {
    try {
        await takeTradeImpl(candidateId, isPaper);
    } catch (e) {
        console.error('[TAKE_TRADE] failed:', e);
        addNotificationLog('Trade Button Failed', e.message || String(e), 'urgent');
        alert(`❌ ${isPaper ? 'Paper' : 'Real'} trade failed: ${e.message || e}`);
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
    const tradeMode = document.getElementById('mt-mode')?.value || STATE.tradeMode || DEFAULT_TRADE_MODE;

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
        entry_spot: indexKey === 'BNF' ? ((safeParseNB(NativeBridge.getLatestPoll(), {}))?.bnfSpot || (JSON.parse(NativeBridge.getBaseline() || '{}'))?.bnfSpot) : ((safeParseNB(NativeBridge.getLatestPoll(), {}))?.nfSpot || (JSON.parse(NativeBridge.getBaseline() || '{}'))?.nfSpot),
        entry_vix: (safeParseNB(NativeBridge.getLatestPoll(), {}))?.vix || (JSON.parse(NativeBridge.getBaseline() || '{}'))?.vix,
        entry_atm_iv: indexKey === 'BNF' ? ((safeParseNB(NativeBridge.getLatestPoll(), {}))?.bnfAtmIv || (JSON.parse(NativeBridge.getBaseline() || '{}'))?.bnfAtmIv) : ((safeParseNB(NativeBridge.getLatestPoll(), {}))?.nfAtmIv || (JSON.parse(NativeBridge.getBaseline() || '{}'))?.nfAtmIv),
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
        // Manual trade logging is display/storage only; native brain will assess forces on later polls.
        force_alignment: null,
        force_f1: null,
        force_f2: null,
        force_f3: null,
        entry_pcr: indexKey === 'BNF' ? ((safeParseNB(NativeBridge.getLatestPoll(), {}))?.pcr || (JSON.parse(NativeBridge.getBaseline() || '{}'))?.pcr) : ((JSON.parse(NativeBridge.getNfChain() || '{}'))?.pcr || null),
        entry_futures_premium: indexKey === 'BNF' ? ((safeParseNB(NativeBridge.getLatestPoll(), {}))?.futuresPremBnf || (JSON.parse(NativeBridge.getBaseline() || '{}'))?.futuresPremBnf) : ((JSON.parse(NativeBridge.getNfChain() || '{}'))?.futuresPremium || null),
        entry_max_pain: indexKey === 'BNF' ? ((safeParseNB(NativeBridge.getLatestPoll(), {}))?.maxPainBnf ?? (JSON.parse(NativeBridge.getBnfChain() || '{}'))?.maxPain) : ((JSON.parse(NativeBridge.getNfChain() || '{}'))?.maxPain ?? null),
        entry_sell_oi: (() => {
            const ch = indexKey === 'BNF' ? safeParseNB(NativeBridge.getBnfChain(), {}) : safeParseNB(NativeBridge.getNfChain(), {});
            return ch?.strikes?.[sellStrike]?.[sellType]?.oi ?? null;
        })(),
        entry_bias: (safeParseNB(NativeBridge.getLatestPoll(), {}))?.bias?.label || (JSON.parse(NativeBridge.getBaseline() || '{}'))?.bias?.label,
        entry_bias_net: (safeParseNB(NativeBridge.getLatestPoll(), {}))?.bias?.net || (JSON.parse(NativeBridge.getBaseline() || '{}'))?.bias?.net,
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
            near_atm_pcr: indexKey === 'BNF' ? (safeParseNB(NativeBridge.getLatestPoll(), {}))?.nearAtmPCR : ((JSON.parse(NativeBridge.getNfChain() || '{}'))?.nearAtmPCR ?? null),
            iv_percentile: (safeParseNB(NativeBridge.getLatestPoll(), {}))?.ivPercentile ?? null,
            spot_sigma: (safeParseNB(NativeBridge.getLatestPoll(), {}))?.spotSigma ?? null,
            vix_direction: (JSON.parse(NativeBridge.getYesterdayHistory(7) || '[]'))?.[0]?.vix ? +((safeParseNB(NativeBridge.getLatestPoll(), {}))?.vix - (JSON.parse(NativeBridge.getYesterdayHistory(7) || '[]'))[0].vix).toFixed(2) : null,
            call_wall: indexKey === 'BNF' ? (safeParseNB(NativeBridge.getLatestPoll(), {}))?.bnfCallWall : ((JSON.parse(NativeBridge.getNfChain() || '{}'))?.callWallStrike ?? null),
            put_wall: indexKey === 'BNF' ? (safeParseNB(NativeBridge.getLatestPoll(), {}))?.bnfPutWall : ((JSON.parse(NativeBridge.getNfChain() || '{}'))?.putWallStrike ?? null),
            bias_signals: (safeParseNB(NativeBridge.getLatestPoll(), {}))?.bias?.signals?.map(s => ({ n: s.name, d: s.dir, v: s.value })) || [],
            morning_bias: bd.morningBias?.label || null,
            bias_drift: STATE.biasDrift ?? 0,
            regime: bd.institutionalRegime?.regime || null,
            bnf_breadth_pct: safeParseNB(NativeBridge.getBnfBreadth(), {})?.pct ?? null,
            dow_close: (JSON.parse(NativeBridge.getGlobalDirection() || '{}'))?.dowClose ?? null,
            crude_settle: (JSON.parse(NativeBridge.getGlobalDirection() || '{}'))?.crudeSettle ?? null,
            gap_sigma: bd.gapInfo?.sigma ?? null,
            minutes_since_open: API.minutesSinceOpen() ?? null,
            lot_size: lotSize,
            // Cost & calibration
            event_driven: document.getElementById('mt-event')?.checked || false
        }
    };

    const saved = await DB.insertTrade(trade);
    if (saved) {
        trade.id = saved.id;
        addOpenTradeToState(trade);
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
            addOpenTradeToState(trade);
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
    const paperPnl = isPaper ? buildPaperPnlBreakdown(trade) : null;
    const closePnl = isPaper ? paperPnl.netIfClosedNow : (trade.current_pnl ?? 0);
    const confirmMsg = isPaper
        ? `${prefix}: Close ${trade.index_key} ${friendlyType(trade.strategy_type)} ${trade.sell_strike}?\nGross MTM: ₹${paperPnl.grossMtm.toLocaleString()}\nEst. round-trip cost: ₹${paperPnl.estimatedRoundTripCost.toLocaleString()}\nNet if closed now: ₹${paperPnl.netIfClosedNow.toLocaleString()}`
        : `${prefix}: Close ${trade.index_key} ${friendlyType(trade.strategy_type)} ${trade.sell_strike}?\nP&L: ₹${trade.current_pnl ?? 'unknown'}`;
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
        removeOpenTradeFromState(tradeId); // push removal to Kotlin now
        renderAll();    // re-render immediately — card gone from UI

        const closedWon = closePnl > 0;

        // Now update Supabase in background (non-blocking)
        DB.updateTrade(trade.id, {
            status: 'CLOSED',
            exit_date: new Date().toISOString(),
            actual_pnl: closePnl,
            canonical_won: closedWon,
            outcome_h2: closedWon ? 1 : 0,
            exit_premium: trade.current_premium ?? null,
            exit_reason: exitReason || 'Manual',
            paper_close_reason_quality: null,
            paper_thesis_break_type: null,
            paper_rule_followed: null,
            paper_close_note: null,
            exit_vix: (safeParseNB(NativeBridge.getLatestPoll(), {}))?.vix ?? trade.current_vix ?? null,
            exit_atm_iv: isBNF ? ((safeParseNB(NativeBridge.getLatestPoll(), {}))?.bnfAtmIv ?? null) : ((safeParseNB(NativeBridge.getLatestPoll(), {}))?.nfAtmIv ?? (JSON.parse(NativeBridge.getNfChain() || '{}'))?.atmIv ?? null),
            exit_force_alignment: trade.forces?.aligned ?? trade.force_alignment ?? null,
            exit_hold_minutes: trade.entry_date ? Math.floor((Date.now() - new Date(trade.entry_date).getTime()) / 60000) : null,
            exit_spot: trade.current_spot ?? null,
            exit_pcr: isBNF ? ((safeParseNB(NativeBridge.getLatestPoll(), {}))?.nearAtmPCR ?? (safeParseNB(NativeBridge.getLatestPoll(), {}))?.pcr ?? null) : ((safeParseNB(NativeBridge.getLatestPoll(), {}))?.nfNearAtmPCR ?? (JSON.parse(NativeBridge.getNfChain() || '{}'))?.nearAtmPCR ?? null),
            exit_bias: (safeParseNB(NativeBridge.getLatestPoll(), {}))?.bias?.label ?? null,
            trough_pnl: trade.trough_pnl ?? null,
            poll_count: trade.poll_count ?? null,

            // ═══ EXIT SNAPSHOT — full market state at close (JSONB) ═══
            exit_snapshot: {
                spot: trade.current_spot ?? null,
                vix: (safeParseNB(NativeBridge.getLatestPoll(), {}))?.vix ?? trade.current_vix ?? null,
                atm_iv: isBNF ? ((safeParseNB(NativeBridge.getLatestPoll(), {}))?.bnfAtmIv ?? null) : ((safeParseNB(NativeBridge.getLatestPoll(), {}))?.nfAtmIv ?? null),
                near_atm_pcr: isBNF ? ((safeParseNB(NativeBridge.getLatestPoll(), {}))?.nearAtmPCR ?? null) : ((safeParseNB(NativeBridge.getLatestPoll(), {}))?.nfNearAtmPCR ?? (JSON.parse(NativeBridge.getNfChain() || '{}'))?.nearAtmPCR ?? null),
                futures_premium: isBNF ? ((safeParseNB(NativeBridge.getLatestPoll(), {}))?.futuresPremBnf ?? null) : ((safeParseNB(NativeBridge.getLatestPoll(), {}))?.futuresPremNf ?? null),
                iv_percentile: (safeParseNB(NativeBridge.getLatestPoll(), {}))?.ivPercentile ?? null,
                call_wall: isBNF ? ((safeParseNB(NativeBridge.getLatestPoll(), {}))?.bnfCallWall ?? null) : ((JSON.parse(NativeBridge.getNfChain() || '{}'))?.callWallStrike ?? null),
                put_wall: isBNF ? ((safeParseNB(NativeBridge.getLatestPoll(), {}))?.bnfPutWall ?? null) : ((JSON.parse(NativeBridge.getNfChain() || '{}'))?.putWallStrike ?? null),
                max_pain: isBNF ? ((safeParseNB(NativeBridge.getLatestPoll(), {}))?.maxPainBnf ?? null) : ((JSON.parse(NativeBridge.getNfChain() || '{}'))?.maxPain ?? null),
                sell_oi: chain?.strikes?.[trade.sell_strike]?.[trade.sell_type]?.oi ?? null,
                bias: (safeParseNB(NativeBridge.getLatestPoll(), {}))?.bias?.label ?? null,
                bias_net: (safeParseNB(NativeBridge.getLatestPoll(), {}))?.bias?.net ?? null,
                bias_signals: (safeParseNB(NativeBridge.getLatestPoll(), {}))?.bias?.signals?.map(s => ({ n: s.name, d: s.dir })) || [],
                force_f1: trade.forces?.f1 ?? trade.force_f1 ?? null,
                force_f2: trade.forces?.f2 ?? trade.force_f2 ?? null,
                force_f3: trade.forces?.f3 ?? trade.force_f3 ?? null,
                regime: bd.institutionalRegime?.regime ?? null,
                spot_sigma: (safeParseNB(NativeBridge.getLatestPoll(), {}))?.spotSigma ?? null,
                minutes_since_open: minsOpen,
                premium: trade.current_premium ?? null,
                drift_from_morning: STATE.biasDrift ?? 0,
                gross_mtm_close: trade.current_pnl ?? 0,
                estimated_round_trip_cost: isPaper ? paperPnl.estimatedRoundTripCost : null,
                net_if_closed_now: closePnl
            },
            paper_discipline: null,

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

        addNotificationLog(
            `${prefix} Trade Closed`,
            `${trade.index_key} ${friendlyType(trade.strategy_type)} ${trade.sell_strike} ${trade.trade_mode ? `[${trade.trade_mode}]` : ''} ${isPaper ? `Net closed: ₹${closePnl} (gross ₹${paperPnl.grossMtm}, est cost ₹${paperPnl.estimatedRoundTripCost}).` : `P&L: ₹${trade.current_pnl}.`}${holdDuration ? ` Held: ${holdDuration}.` : ''} Reason: ${exitReason || 'Manual'}`,
            closePnl >= 0 ? 'entry' : 'urgent'
        );

        // b105: Fill ML outcome for calibration tracking
        if (trade.id && DB.supabase) {
            const outcomeUpdate = {
                canonical_won:      closedWon,
                won:                closedWon,
                outcome_h2:         closedWon ? 1 : 0,
                outcome_pct_of_max: (trade.max_profit > 0)
                    ? Math.round((closePnl / trade.max_profit) * 10000) / 10000
                    : null,
                actual_pnl:         closePnl,
                peak_pnl:           trade.peak_pnl ?? null,
                trough_pnl:         trade.trough_pnl ?? null,
                hold_minutes:       trade.entry_date ? Math.floor((Date.now() - new Date(trade.entry_date).getTime()) / 60000) : null,
                exit_reason:        exitReason || 'Manual',
                paper_reason_quality: null,
                paper_thesis_break_type: null,
                paper_rule_followed: null,
                exit_vix:           (safeParseNB(NativeBridge.getLatestPoll(), {}))?.vix ?? null,
                exit_pcr:           (safeParseNB(NativeBridge.getLatestPoll(), {}))?.pcr ?? null,
                ci_min:             trade._journey?.min_ci ?? null,
                ci_max:             trade._journey?.max_ci ?? null,
                closed_at:          new Date().toISOString(),
            };
            DB.supabase.from('ml_decisions').update(outcomeUpdate).eq('trade_id', trade.id)
              .then(({error}) => {
                  if (!error) return;
                  const legacyUpdate = { ...outcomeUpdate };
                  delete legacyUpdate.canonical_won;
                  DB.supabase.from('ml_decisions').update(legacyUpdate).eq('trade_id', trade.id)
                    .then(({error: legacyError}) => {
                        if (legacyError) console.warn('[ML] ml_decisions outcome fill failed:', legacyError.message);
                    });
              });
        }
    } catch (err) {
        console.error('closeTrade error:', err);
        // Even if something fails, ensure trade is removed from UI
        removeOpenTradeFromState(tradeId);
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
    const liveWindow = isLiveRecommendationWindow();
    const verdict = bi?.verdict;
    const market = bi?.market || [];
    const timing = bi?.timing || [];
    const risk = bi?.risk || [];
    const all = [...market, ...timing, ...risk];

    if (!all.length && !verdict && !STATE.brainReady && !STATE.brainError) return '';

    const age = STATE.brainLastRun > 0 ? Math.round((Date.now() - STATE.brainLastRun) / 1000) : null;
    const ageText = age !== null ? (age < 60 ? `${age}s ago` : `${Math.round(age/60)}m ago`) : '';

    // VERDICT CARD — the ONE answer
    let verdictHtml = '';
    if (!liveWindow) {
        verdictHtml = `<div class="brain-card" style="border-left-color:var(--text-muted);border-left-width:4px;padding:10px 12px">
            <div style="font-size:14px;font-weight:700;color:var(--text-muted)">Market closed</div>
            <div class="brain-detail" style="margin-top:4px">Live recommendation archived after the trading window. Review saved signals and ML outcomes instead of acting on the last intraday verdict.</div>
        </div>`;
    } else if (verdict && verdict.action) {
        const vColor = verdict.action === 'WAIT' || verdict.action === 'STOP' ? 'var(--warn)' :
            verdict.direction === 'BULL' ? 'var(--green)' : verdict.direction === 'BEAR' ? 'var(--danger)' : 'var(--accent)';
        const confBar = verdict.confidence > 0 ? `<div style="height:3px;background:var(--border);border-radius:2px;margin-top:4px"><div style="height:100%;width:${verdict.confidence}%;background:${vColor};border-radius:2px"></div></div>` : '';
        const urgencyText = verdict.action === 'WAIT' && verdict.urgency === 'ENTER NOW' ? '' : (verdict.urgency || '');
        verdictHtml = `<div class="brain-card" style="border-left-color:${vColor};border-left-width:4px;padding:10px 12px">
            <div style="font-size:14px;font-weight:700;color:${vColor}">${verdict.action}${verdict.strategy ? ' — ' + verdict.strategy.replace('_', ' ') : ''}</div>
            <div style="font-size:12px;font-weight:600;margin-top:2px">${urgencyText} ${verdict.confidence > 0 ? '· Confidence: ' + verdict.confidence + '%' : ''}</div>
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

function detailsStateKey(detail) {
    const container = detail.closest('.tab-content')?.id || 'root';
    const directSummary = Array.from(detail.children).find(el => el.tagName === 'SUMMARY');
    const summaryText = (directSummary?.textContent || '')
        .replace(/\b\d+s ago\b/g, '')
        .replace(/\bPoll #\d+\b/g, 'Poll #')
        .replace(/\b\d{1,2}:\d{2}\s*(am|pm)\b/gi, '')
        .replace(/\s+/g, ' ')
        .trim();
    const classes = (detail.className || '').replace(/\s+/g, '.');
    return `${container}|${classes}|${summaryText}`;
}

function detailsIndexKey(detail) {
    const container = detail.closest('.tab-content') || document.body;
    const containerId = container.id || 'root';
    const details = Array.from(container.querySelectorAll('details'));
    return `${containerId}|idx:${details.indexOf(detail)}`;
}

function captureOpenDetailsState() {
    const state = new Set();
    document.querySelectorAll('.tab-content details[open]').forEach(detail => {
        state.add(detailsStateKey(detail));
        state.add(detailsIndexKey(detail));
    });
    return state;
}

function restoreOpenDetailsState(state) {
    if (!state || state.size === 0) return;
    document.querySelectorAll('.tab-content details').forEach(detail => {
        if (state.has(detailsStateKey(detail)) || state.has(detailsIndexKey(detail))) detail.open = true;
    });
}

function updateLockScanUi() {
    const btnLock = document.getElementById('btn-lock');
    const statusEl = document.getElementById('status');
    if (!btnLock && !statusEl) return;

    const baseline = getTodayNativeBaseline();
    let localBaseline = null;
    try {
        localBaseline = safeParseNB(localStorage.getItem('mr2_morning_baseline'), null);
    } catch (e) {
        localBaseline = null;
    }
    const lockedToday = !!baseline || isTodayRecord(localBaseline);
    if (!lockedToday) return;

    const serviceStatus = callNativeJson('getServiceStatus', {}, {});
    const pollCount = Number.isFinite(serviceStatus.polls)
        ? serviceStatus.polls
        : (STATE.pollCount || safeParseNB(NativeBridge.getPollHistory?.(), []).length || 0);
    const isRunning = !!serviceStatus.running || !!STATE.isWatching;

    document.querySelectorAll('.morning-input').forEach(el => el.disabled = true);
    if (btnLock) {
        btnLock.disabled = true;
        btnLock.textContent = isRunning ? 'Watching...' : 'Locked';
    }
    if (statusEl && !statusEl.textContent.startsWith('Lock failed')) {
        statusEl.textContent = isRunning
            ? `✅ Watching market${pollCount ? ` · Poll #${pollCount}` : ''}`
            : '✅ Morning data locked. Waiting for service...';
    }
    collapseMorning();
}

function renderAll() {
    const openDetailsState = captureOpenDetailsState();
    refreshBrainData();  // F.2: keep bd fresh for all render functions
    renderTicker();
    renderMarket();
    renderOI();
    renderWatchlist();
    renderPosition();
    renderML();
    renderDebug();
    renderFooter();
    updateLockScanUi();
    restoreOpenDetailsState(openDetailsState);
    updateStickyLayout();
}

function updateStickyLayout() {
    if (updateStickyLayout._pending) return;
    updateStickyLayout._pending = true;
    requestAnimationFrame(() => {
        updateStickyLayout._pending = false;
        const root = document.documentElement;
        const header = document.querySelector('.app-header');
        const ticker = document.getElementById('live-ticker');
        const headerHeight = header ? Math.ceil(header.getBoundingClientRect().height) : 0;
        const tickerVisible = ticker && getComputedStyle(ticker).display !== 'none';
        const tickerHeight = tickerVisible ? Math.ceil(ticker.getBoundingClientRect().height) : 0;
        const nextHeader = `${headerHeight}px`;
        const nextTicker = `${tickerHeight}px`;
        if (root.style.getPropertyValue('--app-header-h') !== nextHeader) {
            root.style.setProperty('--app-header-h', nextHeader);
        }
        if (root.style.getPropertyValue('--live-ticker-h') !== nextTicker) {
            root.style.setProperty('--live-ticker-h', nextTicker);
        }
    });
}

function renderTicker() {
    const ticker = document.getElementById('live-ticker');
    if (!ticker) return;

    const l = latestPollData();
    if (!l) {
        ticker.style.display = 'none';
        updateStickyLayout();
        return;
    }

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
    updateStickyLayout();
}

// ── b105: ML manual retrain + calibration helpers ────────────────────────

async function triggerMLRetrain() {
    if (!window.NativeBridge?.triggerMLRetrain) {
        alert('Native bridge not available. Use APK version.');
        return;
    }
    alert(
        'Manual retrain disabled.\n\n' +
        'ML model retrains automatically when 500 labeled recommendations\n' +
        'accumulate through the monthly evaluation cadence.\n\n' +
        'Check the ML status panel for current progress.'
    );
}

async function triggerDayEvaluation() {
    if (!window.NativeBridge?.triggerDayEvaluation) {
        alert('Native bridge not available. Use APK version.');
        return;
    }
    try {
        const response = safeParseNB(window.NativeBridge.triggerDayEvaluation(), {});
        setTimeout(() => {
            getMLModelStatusCached(true);
            getMLEvaluationOutcomesCached(true);
            getMLBrainSnapshotsCached(true);
            renderAll();
        }, 3000);
        alert(response.message || 'Day evaluation started. Refresh ML status in a few seconds.');
    } catch (e) {
        alert('Day evaluation trigger failed: ' + e.message);
    }
}

function triggerRefreshMLStatus() {
    try {
        getMLModelStatusCached(true);
        getMLEvaluationOutcomesCached(true);
        getMLEvaluationLaneSummaryCached(true);
        getMLBrainSnapshotsCached(true);
        STATE.mlStatusRefreshAt = Date.now();
        renderAll();
        const service = safeParseNB(typeof NativeBridge !== 'undefined' ? NativeBridge.getServiceStatus?.() : null, {});
        const done = service.evaluationDoneToday === true;
        const outcomes = Number.isFinite(service.lastEvaluationOutcomeCount) ? service.lastEvaluationOutcomeCount : null;
        const produced = Number.isFinite(service.lastEvaluationProducedCount) ? service.lastEvaluationProducedCount : null;
        if (done) {
            const detail = outcomes === 0
                ? "ML status refreshed. Evaluation is done, but no outcomes were persisted to Supabase."
                : `ML status refreshed. Evaluation is done with ${outcomes} outcomes persisted to Supabase${produced != null ? ` (${produced} produced)` : ''}.`;
            alert(detail);
        } else if (service.evaluationRunning === true) {
            alert('ML status refreshed. Evaluation is still running.');
        } else {
            alert('ML status refreshed.');
        }
    } catch (e) {
        alert('Could not refresh ML status: ' + e.message);
    }
}

function setExecutionSandboxFromUI(enabled) {
    try {
        if (!window.NativeBridge?.setExecutionSandboxEnabled) {
            alert('Native bridge not available.');
            return;
        }
        const ok = window.NativeBridge.setExecutionSandboxEnabled(!!enabled);
        if (!ok) {
            alert('Could not update sandbox mode.');
            return;
        }
        renderAll();
    } catch (e) {
        alert('Could not update sandbox mode: ' + e.message);
    }
}

function saveOrderProxyUrlFromUI() {
    try {
        if (!window.NativeBridge?.setOrderProxyUrl) {
            alert('Native bridge not available.');
            return;
        }
        const input = document.getElementById('execution-proxy-url');
        const value = (input?.value || '').trim();
        const ok = window.NativeBridge.setOrderProxyUrl(value);
        if (!ok) {
            alert('Could not save proxy URL.');
            return;
        }
        renderAll();
    } catch (e) {
        alert('Could not save proxy URL: ' + e.message);
    }
}

async function checkMLDecisions() {
    try {
        const { data, error } = await DB.supabase
            .from('ml_decisions')
            .select('ml_action, canonical_won, outcome_h2, won, p_final');
        if (error || !data?.length) {
            alert('No closed ML decisions yet. Take and close some trades first.');
            return;
        }
        const byAction = {};
        for (const r of data) {
            const won = resolveDecisionWon(r);
            if (!(won === 0 || won === 1)) continue;
            const a = r.ml_action || 'UNKNOWN';
            if (!byAction[a]) byAction[a] = { n: 0, wins: 0 };
            byAction[a].n++;
            if (won === 1) byAction[a].wins++;
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
                    let s = safeParseNB(window.NativeBridge.getMLModelStatus(), {});
                    if (typeof s === 'string') s = safeParseNB(s, {});
                    const version = s.version || s.ver || 'unknown';
                    const nTrain = s.n_train ?? s.nTrain ?? 0;
                    const thrTake = s.thr_take ?? s.thrTake ?? 0;
                    const baseWr = s.base_wr ?? s.baseWr ?? 0;
                    return `<div style="font-size:10px;color:var(--text-muted);margin-bottom:6px">
                        v${version} · n=${nTrain} · TAKE≥${thrTake} · base WR=${(baseWr * 100).toFixed(1)}%
                    </div>`;
                } catch(e) { return ''; }
            })() : '<div style="font-size:10px;color:var(--text-muted);margin-bottom:6px">Install APK and open fresh to load model</div>'}
            <div style="display:flex;gap:8px;flex-wrap:wrap">
                ${mlReady ? `<button onclick="triggerMLRetrain()" style="background:var(--accent);color:#fff;border:none;border-radius:6px;padding:6px 12px;font-size:11px;font-weight:600;cursor:pointer">📊 ML Status</button>` : ''}
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
        source: 'native'
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
    const polls = STATE.pollHistory || [];
    if (!polls || polls.length < 2) return '<div style="text-align:center;font-size:11px;color:var(--text-muted);padding:8px">Chart appears after 2+ polls</div>';

    const spotKey = index === 'NF' ? 'nf' : 'bnf';
    const spotAlias = index === 'NF' ? 'nfSpot' : 'bnfSpot';
    const getSpot = (p) => {
        const n = Number(p?.[spotKey] ?? p?.[spotAlias] ?? 0);
        return Number.isFinite(n) ? n : 0;
    };
    const getVix = (p) => {
        const n = Number(p?.vix ?? 0);
        return Number.isFinite(n) ? n : 0;
    };
    // Use only polls where BOTH spot and vix are valid (consistent indices)
    const validPolls = polls.filter(p => getSpot(p) > 0 && getVix(p) > 0);
    if (validPolls.length < 2) return '';

    const spots = validPolls.map(getSpot);
    const vixVals = validPolls.map(getVix);
    const times = validPolls.map(p => p.t || p.pollTime || p.time || '');

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
        const dailySigma = spot * (((safeParseNB(NativeBridge.getLatestPoll(), {}))?.vix || 20) / 100) / 15.8745  /* √252 */;
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
            <button onclick="switchChartIndex('${otherIdx}')" style="font-size:9px;padding:2px 6px;border:1px solid var(--border);border-radius:3px;background:var(--bg-input);color:var(--text-muted);cursor:pointer">View ${otherIdx}</button>
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
    if (!el) return;

    const l = latestPollData();
    if (!Object.keys(l).length) return;
    const b = (JSON.parse(NativeBridge.getBaseline() || '{}'));
    const bnfChain = safeParseNB(NativeBridge.getBnfChain?.(), {});
    const nfChain = safeParseNB(NativeBridge.getNfChain?.(), {});
    const bnfCand = firstCandidateFor('BNF');
    const nfCand = firstCandidateFor('NF');
    const dteFromExpiry = (expiry) => {
        if (!expiry || typeof expiry !== 'string') return null;
        const todayStr = (typeof API?.todayIST === 'function') ? API.todayIST() : new Date().toISOString().slice(0, 10);
        const today = new Date(`${todayStr}T00:00:00+05:30`);
        const exp = new Date(`${expiry}T00:00:00+05:30`);
        if (!Number.isFinite(today.getTime()) || !Number.isFinite(exp.getTime())) return null;
        return Math.max(0, Math.ceil((exp - today) / 86400000));
    };
    const bnfExpiry = validDateOrBlank(bnfChain.expiry || bnfCand.expiry || '');
    const nfExpiry = validDateOrBlank(nfChain.expiry || nfCand.expiry || '');
    const bnfDte = bnfCand.tDTE ?? dteFromExpiry(bnfExpiry);
    const nfDte = nfCand.tDTE ?? dteFromExpiry(nfExpiry);
    const bnfAtm = bnfChain.atm || bd.bnfProfile?.atm || 0;
    const nfAtm = nfChain.atm || bd.nfProfile?.atm || 0;
    const bnfAtmIv = bnfChain.atmIv || l.bnfAtmIv || b.bnfAtmIv || 0;
    const nfAtmIv = nfChain.atmIv || l.nfAtmIv || b.nfAtmIv || 0;
    const bnfTheta = bd.bnfProfile?.avgTheta ?? b.bnfAtmTheta ?? 0;
    const nfTheta = bd.nfProfile?.avgTheta ?? b.nfAtmTheta ?? 0;
    const bias = l.bias;

    if (!b) {
        el.innerHTML = '<div class="empty-state">Enter morning data and scan to see market environment</div>';
        return;
    }

    const daily1s = b.dailySigmaBnf || Math.round(((l.bnfSpot || 0) * ((l.vix || 0) / 100)) / Math.sqrt(252));
    const daily1sNf = b.dailySigmaNf || Math.round(((l.nfSpot || 0) * ((l.vix || 0) / 100)) / Math.sqrt(252));
    const trade1s = b.tradeSigmaBnf || (bnfDte != null ? Math.round(daily1s * Math.sqrt(Math.max(1, bnfDte))) : 0);
    const trade1sNf = b.tradeSigmaNf || (nfDte != null ? Math.round(daily1sNf * Math.sqrt(Math.max(1, nfDte))) : 0);
    const chosenSpot = Number(STATE._chartIndex === 'BNF' ? l.bnfSpot : l.nfSpot);
    const chosenBaseSpot = Number(STATE._chartIndex === 'BNF' ? b.bnfSpot : b.nfSpot);
    const chosenDailySigma = STATE._chartIndex === 'BNF' ? daily1s : daily1sNf;
    const derivedSpotSigma = (Number.isFinite(chosenSpot) && Number.isFinite(chosenBaseSpot) && Number.isFinite(chosenDailySigma) && chosenDailySigma > 0)
        ? +(((chosenSpot - chosenBaseSpot) / chosenDailySigma).toFixed(1))
        : null;
    const spotSigma = Number.isFinite(l.spotSigma) ? l.spotSigma : derivedSpotSigma;
    const derivedVixSigma = (Number.isFinite(l.vix) && Number.isFinite(b.vix))
        ? +(((l.vix - b.vix) / 0.5).toFixed(1))
        : null;
    const vixSigma = Number.isFinite(l.vixSigma) ? l.vixSigma : derivedVixSigma;

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

    const fmtIv = (iv) => iv ? (iv > 1 ? iv.toFixed(1) + '%' : (iv * 100).toFixed(1) + '%') : '--';

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
                <div class="env-sub">ATM: ${bnfAtm || '--'} · IV: ${fmtIv(bnfAtmIv)}</div>
            </div>
            <div class="env-item">
                <div class="env-label">NF</div>
                <div class="env-value">${l.nfSpot?.toFixed(0) || '--'}</div>
                <div class="env-sub">ATM: ${nfAtm || '--'} · IV: ${fmtIv(nfAtmIv)}</div>
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
	                    <td class="oi-td-val">${fmtIv(bnfAtmIv)}</td>
	                    <td class="oi-td-val">${fmtIv(nfAtmIv)}</td>
	                </tr>
	                <tr>
	                    <td class="oi-td-label">Θ ₹/day</td>
	                    <td class="oi-td-val" style="color:var(--green)">₹${Math.abs(bnfTheta || 0)}</td>
	                    <td class="oi-td-val" style="color:var(--green)">₹${Math.abs(nfTheta || 0)}</td>
	                </tr>
	                <tr>
	                    <td class="oi-td-label">DTE</td>
	                    <td class="oi-td-val">${bnfDte ?? '--'}T</td>
	                    <td class="oi-td-val">${nfDte ?? '--'}T</td>
	                </tr>
	                <tr>
	                    <td class="oi-td-label">Expiry</td>
	                    <td class="oi-td-val">${bnfExpiry || '--'}</td>
	                    <td class="oi-td-val">${nfExpiry || '--'}</td>
	                </tr>
            </tbody>
        </table>
        </details>

        <!-- FORCE 1: DIRECTION / INTRINSIC — badge visible, signals collapsible -->
        <details class="bias-details">
            <summary class="bias-summary">
                <span class="bias-badge bias-${bias?.bias?.toLowerCase() || 'neutral'}">${bias?.label || 'N/A'}</span>
                <span class="bias-net">${bias?.net > 0 ? '+' : ''}${bias?.net || 0} net</span>
                ${spotSigma != null ? `<span class="sigma-badge">Spot: ${spotSigma}σ</span>` : ''}
                ${vixSigma != null ? `<span class="sigma-badge">VIX: ${vixSigma}σ</span>` : ''}
            </summary>
            <div class="env-signals">${(bias?.signals || []).map(s =>
                `<span class="signal-chip signal-${s.dir.toLowerCase()}">${s.name}: ${s.value}</span>`
            ).join('')}</div>
        </details>

        <!-- BRAIN INSIGHTS — native Kotlin/Chaquopy analysis -->
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
	                    <td class="oi-td-val">±${daily1sNf || 0}</td>
	                </tr>
	                <tr>
	                    <td class="oi-td-label">Daily 2σ</td>
	                    <td class="oi-td-val">±${daily1s * 2}</td>
	                    <td class="oi-td-val">±${(daily1sNf || 0) * 2}</td>
	                </tr>
	                <tr>
	                    <td class="oi-td-label">Trade 1σ</td>
	                    <td class="oi-td-val" style="color:var(--accent)">±${trade1s} (${bnfDte ?? '--'}T)</td>
	                    <td class="oi-td-val" style="color:var(--accent)">±${trade1sNf || 0} (${nfDte ?? '--'}T)</td>
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
                ${spotSigma != null ? `<span class="sigma-badge">Spot: ${spotSigma}σ</span>` : ''}
                ${vixSigma != null ? `<span class="sigma-badge">VIX: ${vixSigma}σ</span>` : ''}
            </div>
        </details>
        ` : ''}
    `;
}

function renderOI() {
    const el = document.getElementById('oi-content');
    if (!el || !(safeParseNB(NativeBridge.getLatestPoll(), {}))) return;

    const l = safeParseNB(NativeBridge.getLatestPoll(), {});
    const b = safeParseNB(NativeBridge.getBaseline(), {});
    const bnfChain = safeParseNB(NativeBridge.getBnfChain(), {});
    const nfc = safeParseNB(NativeBridge.getNfChain(), {});

    if (!b) {
        el.innerHTML = '<div class="empty-state">Scan to see OI structure & institutional positioning</div>';
        return;
    }

    const toFiniteNum = (v) => {
        const n = Number(v);
        return Number.isFinite(n) ? n : null;
    };

    const fmtOI = (oi) => {
        const n = toFiniteNum(oi);
        if (n == null || n === 0) return '--';
        if (n >= 1e7) return (n / 1e7).toFixed(1) + 'Cr';
        if (n >= 1e5) return (n / 1e5).toFixed(1) + 'L';
        if (n >= 1e3) return (n / 1e3).toFixed(1) + 'K';
        return n.toString();
    };

    // BNF
    const bnfPCR = bnfChain.nearAtmPCR || l.nearAtmPCR || bnfChain.pcr;
    const bnfMP = bnfChain.maxPain || l.maxPainBnf || b.maxPainBnf;
    const bnfSpotNum = toFiniteNum(l.bnfSpot);
    const bnfMPNum = toFiniteNum(bnfMP);
    const bnfMPDist = (bnfSpotNum != null && bnfMPNum != null) ? Math.round(bnfSpotNum - bnfMPNum) : null;
    const bnfCW = bnfChain.callWallStrike || l.bnfCallWall || b.bnfCallWall;
    const bnfCWOI = bnfChain.callWallOI || l.bnfCallWallOI || b.bnfCallWallOI;
    const bnfPW = bnfChain.putWallStrike || l.bnfPutWall || b.bnfPutWall;
    const bnfPWOI = bnfChain.putWallOI || l.bnfPutWallOI || b.bnfPutWallOI;
    const bnfCallOI = bnfChain.nearTotalCallOI || bnfChain.totalCallOI || l.bnfTotalCallOI || b.bnfTotalCallOI || 0;
    const bnfPutOI = bnfChain.nearTotalPutOI || bnfChain.totalPutOI || l.bnfTotalPutOI || b.bnfTotalPutOI || 0;
    const bnfTotal = bnfCallOI + bnfPutOI;
    const bnfCPct = bnfTotal > 0 ? Math.round(bnfCallOI / bnfTotal * 100) : 50;
    const bnfFP = l.futuresPremBnf ?? l.fp;

    // NF
    const nfPCR = nfc.nearAtmPCR || nfc.pcr;
    const nfMP = nfc.maxPain || b.maxPainNf;
    const nfSpotNum = toFiniteNum(l.nfSpot);
    const nfMPNum = toFiniteNum(nfMP);
    const nfMPDist = (nfSpotNum != null && nfMPNum != null) ? Math.round(nfSpotNum - nfMPNum) : null;
    const nfCW = nfc.callWallStrike;
    const nfCWOI = nfc.callWallOI;
    const nfPW = nfc.putWallStrike;
    const nfPWOI = nfc.putWallOI;
    const nfCallOI = nfc.nearTotalCallOI || nfc.totalCallOI || 0;
    const nfPutOI = nfc.nearTotalPutOI || nfc.totalPutOI || 0;
    const nfTotal = nfCallOI + nfPutOI;
    const nfCPct = nfTotal > 0 ? Math.round(nfCallOI / nfTotal * 100) : 50;
    const nfFP = nfc.futuresPremium;

    const pc = (v) => !v ? 'var(--text-muted)' : v > 1.2 ? 'var(--green)' : v < 0.9 ? 'var(--danger)' : 'var(--text-primary)';
    const pl = (v) => !v ? '--' : v > 1.2 ? 'Bull' : v < 0.9 ? 'Bear' : 'Neut';
    const md = (d) => {
        if (!Number.isFinite(d)) return '--';
        return d > 100 ? `↑${d}` : d < -100 ? `↓${Math.abs(d)}` : `→${Math.abs(d)}`;
    };
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
        ${(() => {
            const breadth = safeParseNB(NativeBridge.getBnfBreadth(), {});
            if (typeof breadth.weightedPct !== 'number') return '';
            return `
        <div class="env-row">
            <span class="env-row-label">BNF (5 stocks, 79%)</span>
            <span class="env-row-value" style="color:${breadth.weightedPct > 0 ? 'var(--green)' : breadth.weightedPct < 0 ? 'var(--danger)' : 'var(--text-muted)'}">
                ${breadth.weightedPct > 0 ? '+' : ''}${breadth.weightedPct}% · ${breadth.advancing || 0}↑ ${breadth.declining || 0}↓
            </span>
        </div>
        <div class="env-signals">${(breadth.results || []).map(r =>
            `<span class="signal-chip signal-${r.change > 0 ? 'bull' : r.change < 0 ? 'bear' : 'neutral'}">${r.name}: ${r.pctChange > 0 ? '+' : ''}${r.pctChange}%</span>`
        ).join('')}</div>
        `;
        })()}
        ${(() => {
            const nf50 = safeParseNB(NativeBridge.getNf50Breadth(), {});
            if (typeof nf50.scaled !== 'number') return '';
            const adv = Number.isFinite(nf50.advancing) ? nf50.advancing : 0;
            const total = Number.isFinite(nf50.total) && nf50.total > 0 ? nf50.total : 50;
            const considered = Number.isFinite(nf50.considered) && nf50.considered > 0 ? nf50.considered : total;
            const pct = Number.isFinite(nf50.advPct) ? nf50.advPct : (Number.isFinite(nf50.pct) ? nf50.pct : null);
            const missingCount = Number.isFinite(nf50.missingCount) ? nf50.missingCount : Math.max(0, total - considered);
            const coverageNote = considered < total ? ` · coverage ${considered}/${total}${missingCount > 0 ? ` · missing ${missingCount}` : ''}` : '';
            return `
        <div class="env-row">
            <span class="env-row-label">NF50 Breadth</span>
            <span class="env-row-value">${adv}/${total} advancing${pct !== null ? ` · ${pct}%` : ''}${coverageNote}</span>
        </div>
        `;
        })()}

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

    if (typeof NativeBridge !== 'undefined' && !getTodayNativeBaseline()) {
        el.innerHTML = '<div class="empty-state">Lock & Scan to generate strategies</div>';
        return;
    }

    if (!(bd.watchlist || []).length && !(bd.generated_candidates || []).length) {
        if (STATE.brainRefreshPending) {
            const modeLabel = STATE.tradeMode === 'intraday' ? 'intraday' : 'swing';
            el.innerHTML = `<div class="empty-state">Refreshing ${modeLabel} strategies from native brain...</div>`;
            return;
        }
        if (STATE.brainReady && hasBrainPayload(bd)) {
            const verdict = bd.verdict || {};
            const conflicts = Array.isArray(verdict.conflicts) ? verdict.conflicts.filter(Boolean) : [];
            const reason = bd.candidate_error || verdict.reasoning || bd.decisionReason || bd.decision_reason || '';
            el.innerHTML = `
                <div class="empty-state">
                    No ${STATE.tradeMode} strategies ready right now
                    ${reason ? `<div style="margin-top:6px;font-size:12px;color:var(--text-muted)">${reason}</div>` : ''}
                    ${conflicts.length ? `<div style="margin-top:6px;font-size:11px;color:var(--warn)">⚠️ ${conflicts.join(' · ')}</div>` : ''}
                </div>`;
            return;
        }
        el.innerHTML = '<div class="empty-state">Lock & Scan to generate strategies</div>';
        return;
    }

    const bnfAtm = (JSON.parse(NativeBridge.getBnfChain() || '{}'))?.atm || (JSON.parse(NativeBridge.getBaseline() || '{}'))?.bnfAtm || 0;
    const nfAtm = (JSON.parse(NativeBridge.getNfChain() || '{}'))?.atm || (JSON.parse(NativeBridge.getBaseline() || '{}'))?.nfAtm || 0;

    // Display-only: Python/Kotlin brain owns candidate generation, ranking, and watchlist selection.
    const brainWatchlist = Array.isArray(bd.watchlist) ? bd.watchlist : [];
    const executable = brainWatchlist.length;
    const total = (bd.generated_candidates || []).length;

    // ═══ GO VERDICT BANNER ═══
    const biasLabel = bd.effective_bias?.label || (safeParseNB(NativeBridge.getLatestPoll(), {}))?.bias?.label || (JSON.parse(NativeBridge.getBaseline() || '{}'))?.bias?.label || 'NEUTRAL';
    const vix = (safeParseNB(NativeBridge.getLatestPoll(), {}))?.vix || (JSON.parse(NativeBridge.getBaseline() || '{}'))?.vix || 0;
    const modeLabel = STATE.tradeMode === 'intraday' ? '⚡ INTRADAY' : '📅 SWING';
    const goClass = executable >= 3 ? 'go-banner go-green' : executable >= 1 ? 'go-banner go-yellow' : 'go-banner go-grey';
    const goIcon = executable >= 3 ? '✅' : executable >= 1 ? '🟡' : '⏹';

    const brainVerdict = bd.verdict || {};
    const brainStrategyLabel = brainVerdict.strategy ? friendlyType(brainVerdict.strategy) : '';
    const brainActionLabel = brainVerdict.action ? String(brainVerdict.action).replace('_', ' ') : '';
    const brainRegimeType = bd.regime?.type || bd.marketPhase?.type || '';
    const brainRangeDetected = brainRegimeType === 'range'
        || brainVerdict.strategy === 'IRON_CONDOR'
        || brainVerdict.strategy === 'IRON_BUTTERFLY';

    let html = `<div class="${goClass}">
        <div class="go-title">${goIcon} ${executable >= 1 ? 'GO' : 'WAIT'} · ${modeLabel}</div>
        <div class="go-detail">${brainWatchlist.length} brain watchlist (of ${total} generated) · VIX: ${vix.toFixed(1)} · Bias: ${biasLabel}</div>
        ${STATE.brainRefreshPending ? `<div class="go-detail" style="font-size:11px;color:var(--accent)">🔄 Refreshing ${STATE.tradeMode.toUpperCase()} candidates...</div>` : ''}
        ${(() => {
            if (!STATE.lastScanTime) return '';
            const ageMin = Math.floor((Date.now() - STATE.lastScanTime) / 60000);
            if (ageMin < 5) return '';
            const stale = ageMin >= 30;
            const color = stale ? 'var(--danger)' : ageMin >= 15 ? 'var(--warn)' : 'var(--text-muted)';
            return `<div class="go-detail" style="font-size:11px;color:${color}">${stale ? '⚠️' : '⏱️'} Scanned ${ageMin}m ago${stale ? ' — tap Rescan for fresh candidates' : ''}</div>`;
        })()}
        ${bd.morningBias && (safeParseNB(NativeBridge.getLatestPoll(), {}))?.bias ? (() => {
            const drift = STATE.biasDrift || 0;
            const driftColor = Math.abs(drift) >= 2 ? 'var(--danger)' : Math.abs(drift) >= 1 ? 'var(--warn)' : 'var(--green)';
            const driftIcon = STATE.driftOverridden ? '⚠️' : Math.abs(drift) >= 1 ? '🔄' : '✅';
            const morningL = bd.morningBias.label;
            const liveL = STATE.live.bias.label;
            return morningL !== liveL || drift !== 0
                ? `<div class="go-detail" style="font-size:11px; color:${driftColor}">${driftIcon} Morning: ${morningL} · Now: ${liveL} · Drift: ${drift > 0 ? '+' : ''}${drift}${STATE.driftOverridden ? ' · OVERRIDDEN' : ''}</div>`
                : `<div class="go-detail" style="font-size:11px; color:var(--green)">✅ Plan holding: ${morningL}</div>`;
        })() : ''}
        ${brainStrategyLabel ? `<div class="go-detail" style="font-weight:700; margin-top:4px;">🧠 Brain strategy: ${brainStrategyLabel}${brainActionLabel ? ' · ' + brainActionLabel : ''}</div>` : ''}
        ${bd.effective_bias && bd.morningBias && bd.effective_bias.bias !== bd.morningBias.bias ? (() => {
            const eb = bd.effective_bias;
            const mw = Math.round(eb.morning_weight * 100);
            const reasons = eb.drift_reasons?.length ? eb.drift_reasons.join(', ') : '';
            const ebLabel = eb.label || `${eb.strength ? eb.strength + ' ' : ''}${eb.bias || 'NEUTRAL'}`;
            return `<div class="go-detail" style="font-size:11px; color:var(--accent); font-weight:600; margin-top:2px;">🧠 Brain: ${bd.morningBias.label} → ${ebLabel} (MW:${mw}%${reasons ? ' · ' + reasons : ''})</div>`;
        })() : ''}
        ${brainRangeDetected ? `<div class="go-detail" style="font-size:11px; color:var(--green); margin-top:2px;">📊 Range detected (${STATE.rangeSigma}σ) — brain prioritized IB/IC</div>` : (STATE.pollHistory?.length >= 3 ? `<div class="go-detail" style="font-size:10px; color:var(--text-muted); margin-top:2px;">📊 Brain regime: ${brainRegimeType || 'active'} (${STATE.rangeSigma}σ)</div>` : '')}
        ${bd.marketPhase && bd.marketPhase.id !== 'PRE_MARKET' && bd.marketPhase.id !== 'UNKNOWN' ? `<div class="go-detail" style="font-size:11px; color:var(--accent); margin-top:2px; font-weight:600;">${bd.marketPhase.label}: ${bd.marketPhase.hint}</div>
        <div class="go-detail" style="font-size:10px; color:var(--text-muted);">${bd.marketPhase.detail}</div>` : ''}
        <div style="display:flex;gap:8px;margin-top:8px;align-items:center">
            <button onclick="toggleTradeMode()" style="padding:6px 14px;font-size:12px;font-weight:600;border:2px solid ${STATE.tradeMode === 'intraday' ? 'var(--warn)' : 'var(--accent)'};background:${STATE.tradeMode === 'intraday' ? 'var(--warn)' : 'var(--accent)'};color:white;border-radius:var(--radius-sm);cursor:pointer;">
                ${STATE.tradeMode === 'intraday' ? '⚡ INTRADAY' : '📅 SWING'}
            </button>
            <button onclick="rescanStrategies()" style="padding:6px 14px;font-size:12px;background:var(--bg-input);color:var(--text-primary);border:1px solid var(--border);border-radius:var(--radius-sm);cursor:pointer;">🔄 Rescan</button>
        </div>
    </div>`;

    // Position-for-tomorrow planning removed from Trade tab.

    const nfCands = brainWatchlist.filter(c => c.index === 'NF');
    const bnfCands = brainWatchlist.filter(c => c.index === 'BNF');
    const nfTop = nfCands.slice(0, 5);
    const bnfTop = bnfCands.slice(0, 5);
    const nfTotal = (bd.generated_candidates || []).filter(c => c.index === 'NF').length;
    if (nfTop.length) {
        html += `<div class="section-note" style="font-size:11px;color:var(--text-muted);margin:4px 0 8px 0;">NF: showing best ${nfTop.length}${nfCands.length > nfTop.length ? ` of ${nfCands.length} watchlist` : ''}</div>`;
        nfTop.forEach((c, i) => { html += renderCandidateCard(c, nfAtm, i + 1); });
    } else if (nfTotal > 0) {
        html += `<div class="empty-state">NF: ${nfTotal} generated — brain returned no NF watchlist candidate.</div>`;
    } else {
        html += '<div class="empty-state">No NF candidates</div>';
    }

    // ═══ BANK NIFTY — collapsed by default ═══
    const bnfTotal = (bd.generated_candidates || []).filter(c => c.index === 'BNF').length;
    if (bnfTop.length) {
        html += `<details><summary style="cursor:pointer;font-size:13px;font-weight:600;color:var(--text-primary);padding:8px 0;user-select:none;">BANK NIFTY — showing best ${bnfTop.length}${bnfCands.length > bnfTop.length ? ` of ${bnfCands.length}` : ''} ▸</summary>`;
        bnfTop.forEach((c, i) => { html += renderCandidateCard(c, bnfAtm, i + 1); });
        html += '</details>';
    } else if (bnfTotal > 0) {
        html += `<div class="empty-state">BNF: ${bnfTotal} generated — brain returned no BNF watchlist candidate.</div>`;
    } else {
        html += '<div class="empty-state">No BNF candidates</div>';
    }

    el.innerHTML = html;
}

function renderCandidateCard(cand, atm, rank) {
    const forces = cand.forces || { f1: 0, f2: 0, f3: 0, aligned: 0 };
    const dots = alignmentDots(forces.aligned);
    const backendBlocked = cand.directionSafe === false || cand.entryAction === 'BLOCKED' || cand.blocked === true;
    const is4Leg = candidateLegCount(cand) === 4;
    const otmDist = Math.abs(cand.sellStrike - atm);
    const otmLabel = otmDist < 50 ? 'ATM' : 'OTM';
    const premLabel = cand.isCredit ? 'Net Credit' : 'Net Debit';
    const execReady = cand.executionReadiness || {};
    const execGate = execReady.gate || cand.executionGate || 'WAIT';
    const execOk = execReady.ready === true || cand.executionReady === true;
    const execReasons = Array.isArray(execReady.reasons) ? execReady.reasons : [];
    const execMode = execReady.mode || 'paper';
    const rrValue = (typeof cand.maxProfit === 'number' && typeof cand.maxLoss === 'number' && cand.maxLoss > 0)
        ? cand.maxProfit / cand.maxLoss
        : null;
    const premiumEdge = Number.isFinite(Number(cand.premiumEdge)) ? Number(cand.premiumEdge)
        : (Number.isFinite(Number(cand.ev)) ? Number(cand.ev) : null);
    const weakEconomicsReasons = [];
    if (cand.isCredit && premiumEdge != null && premiumEdge <= 0) weakEconomicsReasons.push('premium edge <= 0');
    if (cand.isCredit && rrValue != null && rrValue < 0.10) weakEconomicsReasons.push(`R:R ${rrValue.toFixed(2)} < 0.10`);
    const weakEconomics = cand.isCredit && weakEconomicsReasons.length > 0;
    const economicallyStrong = !weakEconomics;
    const alignLabel = backendBlocked ? '⛔ BLOCKED BY BRAIN' :
        forces.aligned === 3 && economicallyStrong ? '🟢 ALIGNED — Entry Ready' :
        forces.aligned === 3 ? '🟡 STRUCTURE OK — Review Edge' :
        forces.aligned === 2 ? '🟡 CONDITIONAL' : '⚫ WATCHING';
    const alignClass = backendBlocked ? 'align-1' :
        forces.aligned === 3 && economicallyStrong ? 'align-3' :
        forces.aligned >= 2 ? 'align-2' : 'align-1';
    const execBadgeBg = execOk ? (economicallyStrong ? '#2E7D32' : '#6B7280') : '#B45309';
    const execBadgeText = execOk ? (economicallyStrong ? 'READY' : 'MONITOR') : 'WAIT';
    const execDisplayGate = execOk && !economicallyStrong ? 'MONITOR' : execGate;

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
    if ((cand.type === 'IRON_BUTTERFLY' || cand.type === 'IRON_CONDOR') && STATE.pollHistory?.length >= 3) {
        const recentPolls = STATE.pollHistory.slice(-3);
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
                const spot = cand.index === 'BNF' ? (safeParseNB(NativeBridge.getLatestPoll(), {}))?.bnfSpot : (safeParseNB(NativeBridge.getLatestPoll(), {}))?.nfSpot;
                const upperCush = spot ? Math.round(cand.beUpper - spot) : null;
                const lowerCush = spot ? Math.round(spot - cand.beLower) : null;
                const cushStr = (upperCush != null && lowerCush != null)
                    ? ` <span style="color:var(--text-muted);font-size:9px">(↑${upperCush}pts / ↓${lowerCush}pts)</span>` : '';
                return `<div style="font-size:10px;color:var(--text-muted);margin-top:2px">BE: <span style="color:var(--accent);font-weight:600">${cand.beLower.toLocaleString()} ↔ ${cand.beUpper.toLocaleString()}</span>${cushStr}</div>`;
            } else if (cand.beUpper) {
                const spot = cand.index === 'BNF' ? (safeParseNB(NativeBridge.getLatestPoll(), {}))?.bnfSpot : (safeParseNB(NativeBridge.getLatestPoll(), {}))?.nfSpot;
                const cush = spot ? Math.round(cand.beUpper - spot) : null;
                return `<div style="font-size:10px;color:var(--text-muted);margin-top:2px">BE: <span style="color:var(--accent);font-weight:600">${cand.beUpper.toLocaleString()}</span>${cush != null ? ` <span style="color:var(--text-muted);font-size:9px">(${cush}pts buffer)</span>` : ''}</div>`;
            } else if (cand.beLower) {
                const spot = cand.index === 'BNF' ? (safeParseNB(NativeBridge.getLatestPoll(), {}))?.bnfSpot : (safeParseNB(NativeBridge.getLatestPoll(), {}))?.nfSpot;
                const cush = spot ? Math.round(spot - cand.beLower) : null;
                return `<div style="font-size:10px;color:var(--text-muted);margin-top:2px">BE: <span style="color:var(--accent);font-weight:600">${cand.beLower.toLocaleString()}</span>${cush != null ? ` <span style="color:var(--text-muted);font-size:9px">(${cush}pts buffer)</span>` : ''}</div>`;
            }
            return '';
        })()}
        ${cand.sigmaOTM ? `<div style="font-size:10px;padding:2px 8px;color:${cand.sigmaOTM >= 0.5 && cand.sigmaOTM <= 0.8 ? (economicallyStrong ? 'var(--green)' : 'var(--warn)') : cand.sigmaOTM < 0.5 ? 'var(--danger)' : 'var(--warn)'}">Strike: ${cand.sigmaOTM}σ OTM ${cand.sigmaOTM >= 0.5 && cand.sigmaOTM <= 0.8 ? (economicallyStrong ? '● SWEET SPOT' : '● structure ok, edge weak') : cand.sigmaOTM > 0.8 ? '● thin credit zone' : '● too close'}</div>` : ''}
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
            💰 BUY first ₹${peakCash(cand).toLocaleString()} → Margin: ₹${estimateBrokerMargin(cand).toLocaleString()}${candidateLegCount(cand) === 4 ? ' <span style="font-size:9px;color:var(--warn)">(est. SPAN)</span>' : ''}
            · EV/₹1K: ₹${(cand.ev / (peakCash(cand) / 1000 || 1)).toFixed(0)}
        </div>
        ${weakEconomics ? `<div style="font-size:10px;color:var(--warn);margin-top:4px">⚠️ Economics weak: ${weakEconomicsReasons.join(' · ')}</div>` : ''}
        <div style="font-size:10px;margin-top:4px;display:flex;align-items:center;gap:6px;flex-wrap:wrap">
            <span style="background:${execBadgeBg};color:#fff;border-radius:4px;padding:2px 7px;font-weight:600">EXEC ${execBadgeText}</span>
            <span style="color:var(--text-muted)">Mode: ${String(execMode).toUpperCase()} · Gate: ${execDisplayGate}</span>
            ${execReasons.length ? `<span style="color:var(--warn)">(${execReasons.join(' | ')})</span>` : ''}
        </div>

        <div class="v1-align ${alignClass}">${alignLabel}</div>
        <div class="v1-trade-btns">
            ${forces.aligned >= 2 ? (() => {
                // b116: ML badge + REAL TRADE button (only when forces aligned >= 2)
                const mlAction = cand.mlAction || '';
                const mlColor = mlAction === 'TAKE' ? '#388E3C'
                    : mlAction === 'WATCH' ? '#F57C00'
                    : mlAction === 'BLOCKED' ? '#7B2FC4'
                    : mlAction === 'UNSURE' ? '#607D8B'
                    : '#D32F2F';
                const decisionSource = cand.decisionSource || cand.decision_source || '';
                const sourceLabel = decisionSource === 'ML_UNSURE_FALLBACK' ? 'Source: brain fallback'
                    : decisionSource === 'ML_ADVISORY' ? 'Source: brain + ML advisory'
                    : decisionSource ? `Source: ${decisionSource}` : '';
                const mlBadge = cand.p_ml != null
                    ? `<div style="font-size:10px;margin-bottom:4px;display:flex;align-items:center;gap:6px">
                           <span style="background:${mlColor};color:#fff;border-radius:4px;padding:2px 7px;font-weight:600">
                               ML ${Math.round((cand.p_ml||0)*100)}% ${mlAction}${cand.mlOodFlag ? ' ⚠️' : (cand.mlOod ? ' ⚠️' : '')}
                           </span>
                           ${cand.mlRegime ? `<span style="font-size:9px;color:var(--text-muted)">${cand.mlRegime}</span>` : ''}
                           ${cand.mlEdge != null ? `<span style="font-size:9px;color:${cand.mlEdge>=0?'var(--green)':'var(--danger)'}">${cand.mlEdge>=0?'+':''}${(cand.mlEdge*100).toFixed(0)}% edge</span>` : ''}
                       </div>
                       ${sourceLabel ? `<div style="font-size:9px;color:var(--text-muted);margin-bottom:4px">${sourceLabel}</div>` : ''}
                       ${cand.mlUnsureReason?.length ? `<div style="font-size:9px;color:var(--warn);margin-bottom:4px">ML unsure: ${cand.mlUnsureReason[0]}</div>` : ''}
                       ${cand.mlOodWarn?.length ? `<div style="font-size:9px;color:var(--danger);margin-bottom:4px">⚠️ ${cand.mlOodWarn[0]}</div>` : ''}`
                    : '';
                const execModeLower = String(execMode || 'paper').toLowerCase();
                const execGateRequired = execModeLower === 'sandbox' || execModeLower === 'live';
                const execBlocked = execGateRequired && !execOk;
                const execReasonText = execReasons.length ? execReasons.join(' | ') : 'Execution readiness checks not passed';
                const oodWarnText = (cand.mlOodWarn || []).join(' | ') || 'ML warning: low confidence / out-of-distribution scenario';
                const oodTitle = cand.mlOodBlocked === true || cand.mlOodFlag === true || cand.mlOod === true
                    ? ` title="${oodWarnText}"`
                    : '';
                const weakEconomicsText = weakEconomicsReasons.length ? weakEconomicsReasons.join(' | ') : 'Economics weak';
                const realBtn = execBlocked
                    ? `<button class="btn-take" disabled style="opacity:0.45;cursor:not-allowed;background:#B45309" title="${execReasonText}">⏳ EXEC WAIT</button>`
                    : weakEconomics
                    ? `<button class="btn-take" disabled style="opacity:0.55;cursor:not-allowed;background:#6B7280" title="${weakEconomicsText}">⚠️ REVIEW EDGE</button>`
                    : `<button class="btn-take" onclick="takeTrade('${cand.id}', false)"${oodTitle}>📌 REAL TRADE${cand.costWarning ? ' ⚠️' : ''}${cand.mlOodBlocked || cand.mlOodFlag || cand.mlOod ? ' ⚠️' : ''}</button>`;
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
    const paperPnl = isPaper ? buildPaperPnlBreakdown(t) : null;
    const headlinePnl = isPaper ? paperPnl.netIfClosedNow : (t.current_pnl || 0);
    const pnlClass = headlinePnl >= 0 ? 'pnl-pos' : 'pnl-neg';
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
            ${isPaper ? 'Net If Closed Now' : 'P&L'}: ₹${headlinePnl.toLocaleString()}
            ${t.peak_pnl > 0 ? `<span class="pos-peak">(peak ₹${t.peak_pnl.toLocaleString()})</span>` : ''}
        </div>
        ${isPaper
            ? `<div style="font-size:10px;color:var(--text-muted);margin-top:-4px;margin-bottom:4px">Gross MTM: ₹${paperPnl.grossMtm.toLocaleString()} <span style="color:var(--text-dimmed)">· Est. round-trip cost: ₹${paperPnl.estimatedRoundTripCost.toLocaleString()}</span></div>`
            : ''
        }
        <div class="control-section">
            ${t.max_profit || t.max_loss ? `<div style="display:flex;justify-content:space-between;font-size:11px;padding:4px 0;border-bottom:1px solid var(--border)">
                <span style="color:var(--green)">🎯 Max: ₹${(t.max_profit || 0).toLocaleString()}</span>
                <span style="color:var(--text-muted)">${isPaper ? 'Net' : 'P&L'}: ${t.max_profit > 0 ? Math.round((headlinePnl || 0) / t.max_profit * 100) : 0}% of max</span>
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
                const curSpot = t.index_key === 'BNF' ? (safeParseNB(NativeBridge.getLatestPoll(), {}))?.bnfSpot : (safeParseNB(NativeBridge.getLatestPoll(), {}))?.nfSpot;
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
            ${isPaper ? `<div class="pos-detail">Gross MTM: ₹${paperPnl.grossMtm.toLocaleString()} · Est. cost: ₹${paperPnl.estimatedRoundTripCost.toLocaleString()} · Net now: ₹${paperPnl.netIfClosedNow.toLocaleString()}</div>` : ''}
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
    const serviceStatus = safeParseNB(NativeBridge.getServiceStatus?.(), {});
    const lastUpdate = formatServiceLastPoll(serviceStatus.lastPoll);

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
        const totalEstCost = paperTrades.reduce((s, t) => s + estimateTeacherRoundTripCost(t), 0);
        const netPaperPnL = paperPnL - totalEstCost;
        const paperClass = netPaperPnL >= 0 ? 'pnl-pos' : 'pnl-neg';
        const nfPapers = paperTrades.filter(t => t.index_key === 'NF').length;
        const bnfPapers = paperTrades.filter(t => t.index_key === 'BNF').length;
        html += `<div class="paper-header">📋 Paper Trades (${nfPapers} NF · ${bnfPapers} BNF)</div>`;
        html += `<div class="total-pnl-bar paper-pnl ${paperClass}">Paper Net If Closed Now: ₹${netPaperPnL.toLocaleString()}</div>`;
        html += `<div style="text-align:center;font-size:10px;color:var(--text-muted);margin:-8px 0 8px">Gross MTM: ₹${paperPnL.toLocaleString()} · Est. round-trip costs: ₹${totalEstCost.toLocaleString()}</div>`;

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

function renderML() {
    const el = document.getElementById('ml-content');
    if (!el) return;

    const service = safeParseNB(typeof NativeBridge !== 'undefined' ? NativeBridge.getServiceStatus?.() : null, {});
    maybeAutoRefreshMlStatus(service);
    const status = getMLModelStatusCached();
    const brain = safeParseNB(typeof NativeBridge !== 'undefined' ? NativeBridge.getBrainResult?.() : null, {});
    const infra = safeParseNB(typeof NativeBridge !== 'undefined' ? NativeBridge.getExecutionInfraStatus?.() : null, {});
    const pollHistory = safeParseNB(typeof NativeBridge !== 'undefined' ? NativeBridge.getPollHistory?.() : null, []);
    const signalStats = safeParseNB(typeof NativeBridge !== 'undefined' ? NativeBridge.getSignalAccuracyStats?.() : null, {});
    const decisions = getMLDecisionsCached();
    const evaluationOutcomes = getMLEvaluationOutcomesCached();
    const evaluationLaneSummary = getMLEvaluationLaneSummaryCached();
    const brainSnapshots = getMLBrainSnapshotsCached();
    const proxyUrl = typeof NativeBridge !== 'undefined' ? (NativeBridge.getOrderProxyUrl?.() || '') : '';
    const evaluationDone = service.evaluationDoneToday === true;
    const evaluationRunning = service.evaluationRunning === true;
    const evaluationReady = service.evaluationReady !== false;
    const evaluationBlockedReason = service.evaluationBlockedReason || '';
    const evaluationMessage = service.lastEvaluationMessage || (evaluationDone ? "Today's evaluation done." : '');
    const evaluationOutcomeCount = Number.isFinite(service.lastEvaluationOutcomeCount) ? service.lastEvaluationOutcomeCount : null;
    const evaluationProducedCount = Number.isFinite(service.lastEvaluationProducedCount) ? service.lastEvaluationProducedCount : null;
    const evaluationButtonText = evaluationDone
        ? '✅ Today Done'
        : (evaluationRunning
            ? '⏳ Evaluating...'
            : (!evaluationReady
                ? (evaluationBlockedReason === 'WAIT_FOR_POST_CLOSE_HANDOFF'
                    ? '⏳ Auto After Close'
                    : evaluationBlockedReason === 'SESSION_PARTIAL'
                        ? '⏳ Await Full Close Data'
                        : '⛔ Not Ready')
                : '📋 Evaluate Today'));
    const evaluationButtonDisabled = evaluationRunning || evaluationDone || !evaluationReady;
    const evaluationButtonAction = 'triggerDayEvaluation()';
    const mlStatusRefreshText = STATE.mlStatusRefreshAt > 0
        ? new Date(STATE.mlStatusRefreshAt).toLocaleTimeString('en-IN', { timeZone: 'Asia/Kolkata', hour: '2-digit', minute: '2-digit' })
        : '';
    const evaluatorJob = STATE.evaluatorJob || null;
    const evaluatorStatus = evaluatorStatusLabel(evaluatorJob?.status);
    const evaluatorProposalCount = Array.isArray(STATE.evaluatorProposals) ? STATE.evaluatorProposals.length : 0;
    const approvedBranchCount = Array.isArray(STATE.approvedBranchProposals) ? STATE.approvedBranchProposals.length : 0;
    const evaluatorWindow = evaluatorJob?.request_payload ? `${evaluatorJob.request_payload.date_from} → ${evaluatorJob.request_payload.date_to}` : '--';
    const evaluatorLastCheck = formatCompactTs(evaluatorJob?.updated_at || evaluatorJob?.started_at);

    const verdict = brain?.verdict || {};
    const liveWindow = isLiveRecommendationWindow(service);
    const action = liveWindow ? (verdict.action || brain.action || 'WAIT') : 'WAIT';
    const strategy = liveWindow ? (verdict.strategy || brain.strategy || '--') : '--';
    const confidence = liveWindow ? (Number.isFinite(verdict.confidence) ? verdict.confidence : (Number.isFinite(brain.confidence) ? brain.confidence : 0)) : 0;
    const decisionSource = liveWindow
        ? (brain.decisionSource || brain.decision_source || verdict.decisionSource || verdict.decision_source || 'DEFAULT_BRAIN_MATH')
        : 'MARKET_CLOSED';
    const decisionReason = brain.decisionReason || brain.decision_reason || verdict.decisionReason || verdict.decision_reason || '';
    const watchlistCount = Array.isArray(brain.watchlist) ? brain.watchlist.length : 0;
    const candidateCount = Array.isArray(brain.generated_candidates) ? brain.generated_candidates.length : 0;
    const pollsToday = Array.isArray(pollHistory) ? pollHistory.length : 0;
    const accuracyPct = Number.isFinite(signalStats.pct) ? signalStats.pct.toFixed(1) : '--';
    const recent = decisions.slice(0, 5);
    const labeledRows = decisions.filter(d => {
        const won = resolveDecisionWon(d);
        return won === 0 || won === 1;
    });
    const fallbackLabeledCount = labeledRows.length;
    const fallbackWinCount = labeledRows.filter(d => resolveDecisionWon(d) === 1).length;
    const summaryLanes = safeParseNB(evaluationLaneSummary?.lanes, evaluationLaneSummary?.lanes || {});
    const summaryTeacherLanes = safeParseNB(evaluationLaneSummary?.teacher_lanes, evaluationLaneSummary?.teacher_lanes || {});
    const summaryTeacher = safeParseNB(evaluationLaneSummary?.teacher_summary, evaluationLaneSummary?.teacher_summary || {});
    const summaryComparison = safeParseNB(evaluationLaneSummary?.comparison_summary, evaluationLaneSummary?.comparison_summary || {});
    const summaryComparisonLanes = safeParseNB(evaluationLaneSummary?.comparison_lanes, evaluationLaneSummary?.comparison_lanes || {});
    const summaryRowsToday = Number(evaluationLaneSummary?.rowsToday || 0);
    const summaryAttributedRows = Number(evaluationLaneSummary?.attributedRows || 0);
    const hasNativeLaneSummary = summaryLanes && typeof summaryLanes === 'object' && Object.keys(summaryLanes).length > 0;
    const hasNativeTeacherSummary = summaryTeacherLanes && typeof summaryTeacherLanes === 'object' && Object.keys(summaryTeacherLanes).length > 0;
    const outcomeLaneStats = hasNativeLaneSummary ? {
        NF_intraday: { index: 'NF', mode: 'intraday', rows: Number(summaryLanes.NF_intraday?.rows || 0), labeled: Number(summaryLanes.NF_intraday?.labeled || 0), wins: Number(summaryLanes.NF_intraday?.wins || 0) },
        NF_swing: { index: 'NF', mode: 'swing', rows: Number(summaryLanes.NF_swing?.rows || 0), labeled: Number(summaryLanes.NF_swing?.labeled || 0), wins: Number(summaryLanes.NF_swing?.wins || 0) },
        BNF_intraday: { index: 'BNF', mode: 'intraday', rows: Number(summaryLanes.BNF_intraday?.rows || 0), labeled: Number(summaryLanes.BNF_intraday?.labeled || 0), wins: Number(summaryLanes.BNF_intraday?.wins || 0) },
        BNF_swing: { index: 'BNF', mode: 'swing', rows: Number(summaryLanes.BNF_swing?.rows || 0), labeled: Number(summaryLanes.BNF_swing?.labeled || 0), wins: Number(summaryLanes.BNF_swing?.wins || 0) }
    } : buildMlLaneStatsFromOutcomes(evaluationOutcomes, brainSnapshots);
    for (const lane of Object.values(outcomeLaneStats)) {
        lane.winRate = lane.labeled > 0 ? ((lane.wins / lane.labeled) * 100) : null;
    }
    const fallbackLaneStats = buildMlLaneStats(decisions);
    const teacherLaneStats = hasNativeTeacherSummary ? {
        NF_intraday: { rows: Number(summaryTeacherLanes.NF_intraday?.rows || 0), successes: Number(summaryTeacherLanes.NF_intraday?.successes || 0), successRatePct: Number(summaryTeacherLanes.NF_intraday?.successRatePct || 0), expectancyR: Number(summaryTeacherLanes.NF_intraday?.expectancyR || 0), avgCapturedPct: Number(summaryTeacherLanes.NF_intraday?.avgCapturedPct || 0), breakEvenWinRatePct: Number(summaryTeacherLanes.NF_intraday?.breakEvenWinRatePct || 0), worthTrading: summaryTeacherLanes.NF_intraday?.worthTrading === true },
        NF_swing: { rows: Number(summaryTeacherLanes.NF_swing?.rows || 0), successes: Number(summaryTeacherLanes.NF_swing?.successes || 0), successRatePct: Number(summaryTeacherLanes.NF_swing?.successRatePct || 0), expectancyR: Number(summaryTeacherLanes.NF_swing?.expectancyR || 0), avgCapturedPct: Number(summaryTeacherLanes.NF_swing?.avgCapturedPct || 0), breakEvenWinRatePct: Number(summaryTeacherLanes.NF_swing?.breakEvenWinRatePct || 0), worthTrading: summaryTeacherLanes.NF_swing?.worthTrading === true },
        BNF_intraday: { rows: Number(summaryTeacherLanes.BNF_intraday?.rows || 0), successes: Number(summaryTeacherLanes.BNF_intraday?.successes || 0), successRatePct: Number(summaryTeacherLanes.BNF_intraday?.successRatePct || 0), expectancyR: Number(summaryTeacherLanes.BNF_intraday?.expectancyR || 0), avgCapturedPct: Number(summaryTeacherLanes.BNF_intraday?.avgCapturedPct || 0), breakEvenWinRatePct: Number(summaryTeacherLanes.BNF_intraday?.breakEvenWinRatePct || 0), worthTrading: summaryTeacherLanes.BNF_intraday?.worthTrading === true },
        BNF_swing: { rows: Number(summaryTeacherLanes.BNF_swing?.rows || 0), successes: Number(summaryTeacherLanes.BNF_swing?.successes || 0), successRatePct: Number(summaryTeacherLanes.BNF_swing?.successRatePct || 0), expectancyR: Number(summaryTeacherLanes.BNF_swing?.expectancyR || 0), avgCapturedPct: Number(summaryTeacherLanes.BNF_swing?.avgCapturedPct || 0), breakEvenWinRatePct: Number(summaryTeacherLanes.BNF_swing?.breakEvenWinRatePct || 0), worthTrading: summaryTeacherLanes.BNF_swing?.worthTrading === true }
    } : buildTeacherLaneStatsFromOutcomes(evaluationOutcomes);
    const outcomeLaneTotal = Object.values(outcomeLaneStats).reduce((sum, lane) => sum + (lane.labeled || 0), 0);
    const teacherLaneTotal = Object.values(teacherLaneStats).reduce((sum, lane) => sum + (lane.rows || 0), 0);
    const persistedOutcomeRows = Number.isFinite(evaluationOutcomeCount) ? evaluationOutcomeCount : 0;
    const attributionBackfillNeeded = (summaryRowsToday > 0 && summaryAttributedRows === 0) || (persistedOutcomeRows > 0 && outcomeLaneTotal === 0);
    const laneStats = outcomeLaneTotal > 0 ? outcomeLaneStats : (attributionBackfillNeeded ? {
        NF_intraday: { index: 'NF', mode: 'intraday', rows: 0, labeled: 0, wins: 0, winRate: null },
        NF_swing: { index: 'NF', mode: 'swing', rows: 0, labeled: 0, wins: 0, winRate: null },
        BNF_intraday: { index: 'BNF', mode: 'intraday', rows: 0, labeled: 0, wins: 0, winRate: null },
        BNF_swing: { index: 'BNF', mode: 'swing', rows: 0, labeled: 0, wins: 0, winRate: null }
    } : fallbackLaneStats);
    const labeledCount = outcomeLaneTotal > 0
        ? Object.values(laneStats).reduce((sum, lane) => sum + (lane.labeled || 0), 0)
        : (attributionBackfillNeeded ? persistedOutcomeRows : fallbackLabeledCount);
    const winCount = outcomeLaneTotal > 0
        ? Object.values(laneStats).reduce((sum, lane) => sum + (lane.wins || 0), 0)
        : (attributionBackfillNeeded ? 0 : fallbackWinCount);
    const labeledWinRate = labeledCount > 0 ? ((winCount / labeledCount) * 100).toFixed(1) : '--';
    const teacherSuccessCount = hasNativeTeacherSummary
        ? Number(summaryTeacher?.successes || 0)
        : Object.values(teacherLaneStats).reduce((sum, lane) => sum + (lane.successes || 0), 0);
    const teacherSuccessRatePct = hasNativeTeacherSummary
        ? Number(summaryTeacher?.successRatePct || 0)
        : (teacherLaneTotal > 0 ? (teacherSuccessCount / teacherLaneTotal) * 100 : 0);
    const teacherExpectancyR = hasNativeTeacherSummary
        ? Number(summaryTeacher?.expectancyR || 0)
        : (teacherLaneTotal > 0 ? Object.values(teacherLaneStats).reduce((sum, lane) => sum + ((lane.expectancyR || 0) * (lane.rows || 0)), 0) / teacherLaneTotal : 0);
    const teacherBreakEvenPct = hasNativeTeacherSummary
        ? Number(summaryTeacher?.breakEvenWinRatePct || 0)
        : 0;
    const teacherAvgCapturedPct = hasNativeTeacherSummary
        ? Number(summaryTeacher?.avgCapturedPct || 0)
        : (teacherLaneTotal > 0 ? Object.values(teacherLaneStats).reduce((sum, lane) => sum + ((lane.avgCapturedPct || 0) * (lane.rows || 0)), 0) / teacherLaneTotal : 0);
    const teacherTradeableBucketCount = Number(summaryTeacher?.tradeableBucketCount || 0);
    const teacherBucketCount = Number(summaryTeacher?.bucketCount || 0);
    const teacherWorthTrading = summaryTeacher?.worthTrading === true;
    const comparisonLegacyWinRatePct = Number(summaryComparison?.legacyWinRatePct || 0);
    const comparisonTeacherSuccessRatePct = Number(summaryComparison?.teacherSuccessRatePct || 0);
    const comparisonTeacherExpectancyR = Number(summaryComparison?.teacherExpectancyR || 0);
    const comparisonTeacherBreakEvenPct = Number(summaryComparison?.teacherBreakEvenWinRatePct || 0);
    const comparisonTeacherRows = Number(summaryComparison?.teacherPrimaryRows || 0);
    const comparisonLegacyRows = Number(summaryComparison?.legacyPrimaryLabeled || 0);
    const comparisonWinRateDeltaPts = Number(summaryComparison?.winRateDeltaPts || 0);
    const targetLabels = 500;
    const progressPct = Math.min(100, Math.round((labeledCount / targetLabels) * 100));
    const candidateDiagnostics = buildCandidatePipelineDiagnostics(brain, brainSnapshots);
    const diagnosticStageText = candidateDiagnostics.stageEntries.length > 0
        ? candidateDiagnostics.stageEntries.map(([stage, count]) => `${stage} ${count}`).join(' · ')
        : '--';
    const diagnosticReasonText = candidateDiagnostics.reasonEntries.length > 0
        ? candidateDiagnostics.reasonEntries.map(([reason, count]) => `${reason} ${count}`).join(' · ')
        : '--';
    const diagnosticIndexText = candidateDiagnostics.indexSummaries.length > 0
        ? candidateDiagnostics.indexSummaries.map(row => `${row.index} accepted ${row.accepted}/${row.total}`).join(' · ')
        : '--';

    let html = '';
    html += `
        <section class="section">
            <h2>🧠 ML Stack</h2>
            <div class="brain-card" style="border-left-color:${status.ok ? 'var(--green)' : 'var(--warn)'}">
                <div class="brain-card-header">
                    <span class="brain-icon">●</span>
                    <span class="brain-label">${status.ok ? 'Model READY' : 'Model NOT READY'}</span>
                    <span class="brain-strength" style="color:${status.ok ? 'var(--green)' : 'var(--warn)'}">${status.version || 'unknown'}</span>
                </div>
                <div class="brain-detail">
                    Train rows: <b>${status.nTrain || 0}</b> · Thresholds: <b>${((status.thrTake || 0) * 100).toFixed(0)} / ${((status.thrWatch || 0) * 100).toFixed(0)}</b><br>
                    Base win rate: <b>${((status.baseWr || 0) * 100).toFixed(1)}%</b> · Sample probability: <b>${((status.sampleP || 0) * 100).toFixed(1)}%</b>
                    ${status.error ? `<br><span style="color:var(--danger)">Error: ${status.error}</span>` : ''}
                </div>
            </div>
            <div class="brain-card" style="border-left-color:var(--accent)">
                <div class="brain-card-header">
                    <span class="brain-icon">📡</span>
                    <span class="brain-label">Live Brain Output</span>
                </div>
                <div class="brain-detail">
                    Action: <b>${action}</b> · Strategy: <b>${strategy}</b> · Confidence: <b>${confidence.toFixed(0)}%</b><br>
                    Watchlist: <b>${watchlistCount}</b> · Candidates: <b>${candidateCount}</b> · Polls today: <b>${pollsToday}</b><br>
                    Decision source: <b>${decisionSource}</b>${decisionReason ? ` · ${decisionReason}` : ''}
                </div>
            </div>
            <div class="brain-card" style="border-left-color:var(--warn)">
                <div class="brain-card-header">
                    <span class="brain-icon">📈</span>
                    <span class="brain-label">Evaluation Signals</span>
                </div>
                <div class="brain-detail">
                    Decision rows: <b>${decisions.length}</b> · Signal accuracy: <b>${accuracyPct}%</b><br>
                    Service: <b>${service.running ? 'RUNNING' : 'STOPPED'}</b>${service.polls != null ? ` · Poll #${service.polls}` : ''}${service.lastPoll ? ` · Last poll ${service.lastPoll}` : ''}<br>
                    Day evaluation: <b style="color:${evaluationDone ? 'var(--green)' : (evaluationRunning ? 'var(--warn)' : 'var(--text)')}">${evaluationDone ? 'DONE' : (evaluationRunning ? 'RUNNING' : 'PENDING')}</b>${evaluationOutcomeCount != null ? ` · Outcomes persisted: <b>${evaluationOutcomeCount}</b>` : ''}${evaluationProducedCount != null ? ` · Produced: <b>${evaluationProducedCount}</b>` : ''}${evaluationMessage ? `<br>${evaluationMessage}` : ''}${evaluationDone && evaluationOutcomeCount === 0 && (evaluationProducedCount || 0) > 0 ? `<br><span style="color:var(--warn)">Evaluation produced rows, but none were persisted to Supabase.</span>` : ''}${evaluationDone && (evaluationProducedCount || 0) === 0 ? `<br><span style="color:var(--warn)">No evaluable shadow teacher labels were produced from today's saved recommendations.</span>` : ''}
                </div>
            </div>
            <div class="brain-card" style="border-left-color:var(--warn)">
                <div class="brain-card-header">
                    <span class="brain-icon">🧭</span>
                    <span class="brain-label">Candidate Pipeline Diagnostics</span>
                </div>
                <div class="brain-detail">
                    Source: <b>${candidateDiagnostics.source}</b>${candidateDiagnostics.latestPollTime ? ` · Snapshot ${candidateDiagnostics.latestPollTime}` : ''}<br>
                    Generated: <b>${candidateDiagnostics.generatedCount}</b> · Watchlist: <b>${candidateDiagnostics.watchlistCount}</b> · Rejected: <b>${candidateDiagnostics.rejectedCount}</b><br>
                    Trace accepted: <b>${candidateDiagnostics.acceptedTrace}</b> · Trace rejected: <b>${candidateDiagnostics.rejectedTrace}</b><br>
                    ${candidateDiagnostics.skipReason ? `Skip reason: <b>${candidateDiagnostics.skipReason}</b>${candidateDiagnostics.skipReasonCode ? ` (${candidateDiagnostics.skipReasonCode})` : ''}<br>` : ''}
                    By index: <b>${diagnosticIndexText}</b><br>
                    Top rejection stages: <b>${diagnosticStageText}</b><br>
                    Top rejection reasons: <b>${diagnosticReasonText}</b>
                    ${candidateDiagnostics.generatedCount === 0 && candidateDiagnostics.rejectedCount > 0 ? `<br><span style="color:var(--warn)">The brain saw candidate attempts, but none survived the gate waterfall into generated/watchlist payloads.</span>` : ''}
                    ${candidateDiagnostics.generatedCount === 0 && candidateDiagnostics.rejectedCount === 0 && candidateDiagnostics.skipReason ? `<br><span style="color:var(--warn)">Generation was skipped before the gate waterfall. Fix the upstream contract named in the skip reason.</span>` : ''}
                </div>
            </div>
            <div class="brain-card" style="border-left-color:var(--accent)">
                <div class="brain-card-header">
                    <span class="brain-icon">🧪</span>
                    <span class="brain-label">Teacher v1 Shadow Review</span>
                </div>
                <div class="brain-detail">
                    Primary shadow rows: <b>${teacherLaneTotal}</b> · Success rate: <b>${teacherLaneTotal > 0 ? `${teacherSuccessRatePct.toFixed(1)}%` : '--'}</b><br>
                    Expectancy: <b>${teacherLaneTotal > 0 ? `${teacherExpectancyR.toFixed(2)}R` : '--'}</b> · Break-even win rate: <b>${teacherLaneTotal > 0 ? `${teacherBreakEvenPct.toFixed(1)}%` : '--'}</b><br>
                    Avg captured: <b>${teacherLaneTotal > 0 ? `${teacherAvgCapturedPct.toFixed(1)}%` : '--'}</b> · Bucket gate: <b>${teacherBucketCount > 0 ? `${teacherTradeableBucketCount}/${teacherBucketCount}` : '--'}</b>${teacherBucketCount > 0 ? ` · Verdict: <b style="color:${teacherWorthTrading ? 'var(--green)' : 'var(--warn)'}">${teacherWorthTrading ? 'POSITIVE EXPECTANCY' : 'NOT WORTH RISK YET'}</b>` : ''}<br>
                    Label version: <b>${summaryTeacher?.labelVersion || 'teacher_v1'}</b> · Scope: <b>managed exit, primary-only shadow</b>
                </div>
            </div>
            <div class="brain-card" style="border-left-color:var(--warn)">
                <div class="brain-card-header">
                    <span class="brain-icon">⚖️</span>
                    <span class="brain-label">Old vs Honest Teacher</span>
                </div>
                <div class="brain-detail">
                    Legacy primary win rate: <b>${comparisonLegacyRows > 0 ? `${comparisonLegacyWinRatePct.toFixed(1)}%` : '--'}</b> · Honest teacher success: <b>${comparisonTeacherRows > 0 ? `${comparisonTeacherSuccessRatePct.toFixed(1)}%` : '--'}</b><br>
                    Honest expectancy: <b>${comparisonTeacherRows > 0 ? `${comparisonTeacherExpectancyR.toFixed(2)}R` : '--'}</b> · Honest BE win rate: <b>${comparisonTeacherRows > 0 ? `${comparisonTeacherBreakEvenPct.toFixed(1)}%` : '--'}</b><br>
                    Delta: <b style="color:${comparisonWinRateDeltaPts >= 0 ? 'var(--green)' : 'var(--warn)'}">${comparisonTeacherRows > 0 ? `${comparisonWinRateDeltaPts.toFixed(1)} pts` : '--'}</b> · Scope: <b>${summaryComparison?.scope || 'primary_only_old_vs_teacher_shadow'}</b>
                </div>
                <div style="overflow-x:auto;margin-top:8px">
                    <table style="width:100%;border-collapse:collapse;font-size:12px">
                        <thead>
                            <tr>
                                <th style="text-align:left;padding:6px 4px;color:var(--text-muted)">Lane</th>
                                <th style="text-align:right;padding:6px 4px;color:var(--text-muted)">Old WR</th>
                                <th style="text-align:right;padding:6px 4px;color:var(--text-muted)">Teacher SR</th>
                                <th style="text-align:right;padding:6px 4px;color:var(--text-muted)">Exp R</th>
                                <th style="text-align:right;padding:6px 4px;color:var(--text-muted)">BE win</th>
                            </tr>
                        </thead>
                        <tbody>
                            ${[
                                ['NF_intraday', 'NF intraday'],
                                ['NF_swing', 'NF swing'],
                                ['BNF_intraday', 'BNF intraday'],
                                ['BNF_swing', 'BNF swing']
                            ].map(([key, label]) => {
                                const row = summaryComparisonLanes[key] || {};
                                const oldWr = Number(row.legacyLabeled || 0) > 0 ? `${Number(row.legacyWinRatePct || 0).toFixed(1)}%` : '--';
                                const newSr = Number(row.teacherRows || 0) > 0 ? `${Number(row.teacherSuccessRatePct || 0).toFixed(1)}%` : '--';
                                const expR = Number(row.teacherRows || 0) > 0 ? `${Number(row.teacherExpectancyR || 0).toFixed(2)}R` : '--';
                                const beWr = Number(row.teacherRows || 0) > 0 ? `${Number(row.teacherBreakEvenWinRatePct || 0).toFixed(1)}%` : '--';
                                return `
                                    <tr>
                                        <td style="padding:6px 4px;border-top:1px solid var(--border)"><b>${label}</b></td>
                                        <td style="padding:6px 4px;border-top:1px solid var(--border);text-align:right">${oldWr}</td>
                                        <td style="padding:6px 4px;border-top:1px solid var(--border);text-align:right">${newSr}</td>
                                        <td style="padding:6px 4px;border-top:1px solid var(--border);text-align:right">${expR}</td>
                                        <td style="padding:6px 4px;border-top:1px solid var(--border);text-align:right">${beWr}</td>
                                    </tr>
                                `;
                            }).join('')}
                        </tbody>
                    </table>
                </div>
            </div>
            <div class="brain-card" style="border-left-color:var(--green)">
                <div class="brain-card-header">
                    <span class="brain-icon">🎯</span>
                    <span class="brain-label">Paper Training Progress</span>
                </div>
                <div class="brain-detail">
                    Labeled decisions: <b>${labeledCount}/${targetLabels}</b> (${progressPct}%) · Win rate: <b>${labeledWinRate === '--' ? '--' : `${labeledWinRate}%`}</b><br>
                    Closed wins: <b>${winCount}</b> · Remaining to target: <b>${Math.max(0, targetLabels - labeledCount)}</b><br>
                    Status: <b>${labeledCount >= targetLabels ? 'READY FOR RETRAIN GATE' : 'COLLECT MORE PAPER OUTCOMES'}</b><br>
                    Scope: <b>legacy label consumer</b> (canonical_won/outcome_h2 unchanged until switch gate) · Source: <b>${outcomeLaneTotal > 0 ? 'primary evaluated outcomes' : (attributionBackfillNeeded ? 'persisted outcomes need attribution backfill' : 'recent decision fallback')}</b>
                </div>
            </div>
            <div class="brain-card" style="border-left-color:var(--accent)">
                <div class="brain-card-header">
                    <span class="brain-icon">🧭</span>
                    <span class="brain-label">4-Lane Teacher Matrix</span>
                </div>
                <div class="brain-detail">
                    Honest teacher metrics are expectancy-first. Success means the managed exit actually captured the target, not just that P&L stayed above zero at one late snapshot.
                    ${teacherLaneTotal === 0 ? `<br><span style="color:var(--warn)">No teacher_v1 primary rows are available yet for lane-level reporting.</span>` : ''}
                </div>
                <div style="overflow-x:auto;margin-top:8px">
                    <table style="width:100%;border-collapse:collapse;font-size:12px">
                        <thead>
                            <tr>
                                <th style="text-align:left;padding:6px 4px;color:var(--text-muted)">Lane</th>
                                <th style="text-align:right;padding:6px 4px;color:var(--text-muted)">Rows</th>
                                <th style="text-align:right;padding:6px 4px;color:var(--text-muted)">Success</th>
                                <th style="text-align:right;padding:6px 4px;color:var(--text-muted)">Exp R</th>
                                <th style="text-align:right;padding:6px 4px;color:var(--text-muted)">BE win</th>
                                <th style="text-align:right;padding:6px 4px;color:var(--text-muted)">Worth</th>
                            </tr>
                        </thead>
                        <tbody>
                            ${[
                                ['NF_intraday', 'NF intraday'],
                                ['NF_swing', 'NF swing'],
                                ['BNF_intraday', 'BNF intraday'],
                                ['BNF_swing', 'BNF swing']
                            ].map(([key, label]) => {
                                const lane = teacherLaneStats[key] || {};
                                const successRate = Number.isFinite(lane.successRatePct) && lane.rows > 0 ? `${lane.successRatePct.toFixed(1)}%` : '--';
                                const expectancy = Number.isFinite(lane.expectancyR) && lane.rows > 0 ? `${lane.expectancyR.toFixed(2)}R` : '--';
                                const breakEven = Number.isFinite(lane.breakEvenWinRatePct) && lane.rows > 0 ? `${lane.breakEvenWinRatePct.toFixed(1)}%` : '--';
                                const worth = lane.rows > 0 ? (lane.worthTrading ? 'YES' : 'NO') : '--';
                                return `
                                    <tr>
                                        <td style="padding:6px 4px;border-top:1px solid var(--border)"><b>${label}</b></td>
                                        <td style="padding:6px 4px;border-top:1px solid var(--border);text-align:right">${lane.rows || 0}</td>
                                        <td style="padding:6px 4px;border-top:1px solid var(--border);text-align:right">${successRate}</td>
                                        <td style="padding:6px 4px;border-top:1px solid var(--border);text-align:right">${expectancy}</td>
                                        <td style="padding:6px 4px;border-top:1px solid var(--border);text-align:right">${breakEven}</td>
                                        <td style="padding:6px 4px;border-top:1px solid var(--border);text-align:right;color:${lane.worthTrading ? 'var(--green)' : 'var(--warn)'}">${worth}</td>
                                    </tr>
                                `;
                            }).join('')}
                        </tbody>
                    </table>
                </div>
            </div>
            <div class="brain-card" style="border-left-color:var(--accent)">
                <div class="brain-card-header">
                    <span class="brain-icon">🧩</span>
                    <span class="brain-label">Execution Infra State</span>
                </div>
                <div class="brain-detail">
                    Instrument keys: <b>${infra.instrumentKeyPresentRows || 0}/${infra.instrumentKeyRows || 0}</b> · Flow: <b>${infra.instrumentKeyFlowOk ? 'OK' : 'MISSING'}</b><br>
                    Token: <b>${infra.tokenReady ? 'READY' : 'MISSING'}</b> · Sandbox: <b>${infra.sandboxEnabled ? 'ON' : 'OFF'}</b> · Proxy: <b>${infra.proxyConfigured ? 'CONFIGURED' : 'NOT SET'}</b><br>
                    Readiness: Paper <b>${infra.paperReady ? 'READY' : 'WAIT'}</b> · Sandbox <b>${infra.sandboxReady ? 'READY' : 'WAIT'}</b> · Live <b>${infra.liveReady ? 'READY' : 'WAIT'}</b>
                    ${infra.error ? `<br><span style="color:var(--danger)">Error: ${infra.error}</span>` : ''}
                </div>
            </div>
        </section>
    `;

    html += `
        <section class="section">
            <h2>⚙️ ML Controls</h2>
            <div class="v1-trade-btns" style="margin-top:0">
                <button onclick="triggerRefreshMLStatus()" class="btn-primary" style="flex:1;padding:8px 10px;font-size:12px">↻ Refresh Status</button>
                <button onclick="triggerMLRetrain()" class="btn-paper" style="flex:1;padding:8px 10px">📊 ML Status</button>
                <button onclick="${evaluationButtonAction}" class="btn-paper" style="flex:1;padding:8px 10px;font-size:12px;${evaluationButtonDisabled ? 'opacity:.55;pointer-events:none' : ''}" ${evaluationButtonDisabled ? 'disabled' : ''}>${evaluationButtonText}</button>
            </div>
            ${mlStatusRefreshText ? `<div class="brain-detail" style="margin-top:6px;color:var(--text-muted)">Status refreshed: ${mlStatusRefreshText}</div>` : ''}
            <div class="brain-card" style="border-left-color:var(--accent);margin-top:8px">
                <div class="brain-card-header">
                    <span class="brain-icon">🛠</span>
                    <span class="brain-label">Execution Settings</span>
                </div>
                <div class="brain-detail">
                    <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:6px">
                        <button onclick="setExecutionSandboxFromUI(true)" class="btn-primary" style="padding:7px 10px;font-size:11px;${infra.sandboxEnabled ? '' : 'opacity:.75'}">Sandbox ON</button>
                        <button onclick="setExecutionSandboxFromUI(false)" class="btn-paper" style="padding:7px 10px;font-size:11px;${infra.sandboxEnabled ? 'opacity:.75' : ''}">Sandbox OFF</button>
                    </div>
                    <div style="margin-top:8px">
                        <input id="execution-proxy-url" type="text" class="input-field" placeholder="https://your-relay-host:8443" value="${String(proxyUrl).replace(/"/g, '&quot;')}">
                        <div class="v1-trade-btns" style="margin-top:6px">
                            <button onclick="saveOrderProxyUrlFromUI()" class="btn-primary" style="padding:7px 10px;font-size:11px">Save Proxy URL</button>
                        </div>
                    </div>
                </div>
            </div>
            <div class="brain-detail" style="margin-top:8px;color:var(--text-muted)">
                ML is downstream-only. It records snapshots and evaluates outcomes, but it does not change live trade selection.
            </div>
        </section>
    `;

    html += `
        <section class="section">
            <h2>🤖 Gemini Evaluator</h2>
            <div class="brain-card" style="border-left-color:${STATE.evaluatorError ? 'var(--danger)' : 'var(--accent)'}">
                <div class="brain-card-header">
                    <span class="brain-icon">◉</span>
                    <span class="brain-label">Oracle Job State</span>
                    <span class="brain-strength" style="color:${STATE.evaluatorBusy ? 'var(--warn)' : (STATE.evaluatorError ? 'var(--danger)' : 'var(--accent)')}">${evaluatorStatus}</span>
                </div>
                <div class="brain-detail">
                    Job: <b>${evaluatorJob?.job_id || '--'}</b> · Proposals: <b>${evaluatorJob?.proposal_count ?? evaluatorProposalCount}</b> · Approved live branches: <b>${approvedBranchCount}</b><br>
                    Window: <b>${escapeHtml(evaluatorWindow)}</b> · Last check: <b>${escapeHtml(evaluatorLastCheck)}</b>
                    ${STATE.evaluatorError ? `<br><span style="color:var(--danger)">Error: ${escapeHtml(STATE.evaluatorError)}</span>` : ''}
                    ${evaluatorJob?.error ? `<br><span style="color:var(--danger)">Oracle: ${escapeHtml(evaluatorJob.error)}</span>` : ''}
                </div>
            </div>
            <div class="v1-trade-btns" style="margin-top:8px">
                <button onclick="triggerGeminiEvaluation(['BNF','NF'])" class="btn-primary" style="flex:1;padding:8px 10px;font-size:12px;${STATE.evaluatorBusy ? 'opacity:.55;pointer-events:none' : ''}" ${STATE.evaluatorBusy ? 'disabled' : ''}>🚀 Run 30D Review</button>
                <button onclick="STATE.evaluatorJob?.job_id && refreshEvaluatorJobStatus(STATE.evaluatorJob.job_id)" class="btn-paper" style="flex:1;padding:8px 10px;font-size:12px;${evaluatorJob?.job_id ? '' : 'opacity:.55;pointer-events:none'}" ${evaluatorJob?.job_id ? '' : 'disabled'}>🔄 Refresh Oracle</button>
                <button onclick="loadApprovedBranchProposals(true).then(() => renderAll())" class="btn-paper" style="flex:1;padding:8px 10px;font-size:12px">📥 Reload Approved</button>
            </div>
            <div class="brain-detail" style="margin-top:8px;color:var(--text-muted)">
                Gemini remains offline and advisory. Oracle output never auto-activates. Only approved proposals are synced into the live brain.
            </div>
            <div style="margin-top:10px">
                ${(STATE.evaluatorProposals || []).length ? STATE.evaluatorProposals.map(row => {
                    const p = normalizeProposalRow(row);
                    const reviewLocked = String(p.status || '').toLowerCase() === 'approved';
                    const rejected = String(p.status || '').toLowerCase() === 'rejected';
                    return `
                        <div class="brain-card" style="border-left-color:${reviewLocked ? 'var(--green)' : 'var(--warn)'};margin-bottom:8px">
                            <div class="brain-card-header">
                                <span class="brain-icon">•</span>
                                <span class="brain-label">${escapeHtml(p.proposalId || p.rowId || 'proposal')}</span>
                                <span class="brain-strength">${escapeHtml(`${p.indexKey} · ${p.priority || 'priority?'}`)}${reviewLocked ? ' · LIVE' : (rejected ? ' · REJECTED' : '')}</span>
                            </div>
                            <div class="brain-detail">
                                <b>${escapeHtml(p.category || 'proposal')}</b>${p.hypothesis ? ` · ${escapeHtml(p.hypothesis)}` : ''}<br>
                                ${escapeHtml(proposalSummaryText(row) || 'No structured summary provided.')}
                                ${p.explanation ? `<br>${escapeHtml(p.explanation)}` : ''}
                                ${p.validationNotes ? `<br>Notes: ${escapeHtml(p.validationNotes)}` : ''}
                                ${p.approvedAt ? `<br>Approved: ${escapeHtml(p.approvedAt)}` : ''}
                            </div>
                            <div class="v1-trade-btns" style="margin-top:8px">
                                <button onclick="reviewBranchProposal(${JSON.stringify(String(p.rowId))}, 'approved')" class="btn-primary" style="flex:1;padding:7px 10px;font-size:11px;${reviewLocked ? 'opacity:.55;pointer-events:none' : ''}" ${reviewLocked ? 'disabled' : ''}>✅ Approve Live</button>
                                <button onclick="reviewBranchProposal(${JSON.stringify(String(p.rowId))}, 'rejected')" class="btn-paper" style="flex:1;padding:7px 10px;font-size:11px">${reviewLocked ? '⏸ Deactivate' : '🛑 Reject'}</button>
                            </div>
                        </div>
                    `;
                }).join('') : `<div class="empty-state">${String(evaluatorJob?.status || '').toLowerCase() === 'completed' ? 'Job completed. No proposals returned.' : 'No evaluator proposals loaded yet'}</div>`}
            </div>
        </section>
    `;

    html += `
        <section class="section">
            <h2>🗂 Recent ML Decisions</h2>
            ${recent.length ? recent.map(row => {
                const rowAction = row.action || row.recommendation_action || row.verdict_action || '--';
                const rowStrategy = row.strategy || row.recommendation_strategy || '--';
                const rowOutcome = row.outcome || row.result || row.label_quality || '--';
                const rowTs = row.created_at || row.updated_at || row.poll_ts || '--';
                const rowIndex = normalizeDecisionIndex(row);
                const rowMode = normalizeDecisionMode(row);
                const rowLane = rowIndex !== 'UNK' && rowMode !== 'unknown' ? `${rowIndex} · ${rowMode}` : (rowIndex !== 'UNK' ? rowIndex : '--');
                return `
                    <div class="brain-card">
                        <div class="brain-card-header">
                            <span class="brain-icon">•</span>
                            <span class="brain-label">${rowAction} · ${rowStrategy}</span>
                            <span class="brain-strength">${rowOutcome}</span>
                        </div>
                        <div class="brain-detail">${escapeHtml(rowLane)} · ${escapeHtml(rowTs)}</div>
                    </div>
                `;
            }).join('') : '<div class="empty-state">No ML decisions loaded yet</div>'}
        </section>
    `;

    el.innerHTML = html;
}

function renderFooter() {
    const el = document.getElementById('footer-status');
    if (!el) return;
    const time = API.istNow();
    const serviceStatus = safeParseNB(NativeBridge.getServiceStatus?.(), {});
    const watching = serviceStatus.running ? '🟢' : '⏹';
    const nativePolls = Number.isFinite(serviceStatus.polls) ? serviceStatus.polls : 0;
    const polls = Math.max(nativePolls, STATE.pollCount || 0);
    const bi = bd || {};
    const verdict = bi.verdict;
    const liveWindow = isLiveRecommendationWindow(serviceStatus);
    const brain = !liveWindow ? '🧠 closed' : (
        STATE.brainReady ?
            (verdict?.action ? `🧠 ${verdict.action}${verdict.confidence ? ' ' + verdict.confidence + '%' : ''}` : '🧠 ready') :
            (STATE.brainError ? '🧠✗' : '🧠…')
    );
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
        const triggerScan = () => {
            startWatchLoop();
            try {
                if (typeof NativeBridge !== 'undefined' && typeof NativeBridge.requestImmediatePoll === 'function') {
                    NativeBridge.requestImmediatePoll();
                }
            } catch (e) {
                console.warn('[lockMorningData] immediate poll request skipped:', e.message);
            }
        };
        requireFilledInputs([
            { id: 'in-fii-cash', label: 'FII Cash' },
            { id: 'in-fii-short', label: 'FII Short %' },
            { id: 'in-dii-cash', label: 'DII Cash' },
            { id: 'in-fii-idx-fut', label: 'FII Idx Fut' },
            { id: 'in-fii-stk-fut', label: 'FII Stk Fut' },
            { id: 'in-dow-close', label: 'Dow Close' },
            { id: 'in-crude-settle', label: 'Crude Settle' },
            { id: 'in-gift-spot', label: 'GIFT Spot' }
        ]);

        if (!syncUpstoxTokenToNative({ promptIfMissing: true })) {
            throw new Error('Upstox token missing. Paste token to enable auto polling.');
        }

        const rawInputs = {
            date: API.todayIST(),
            fiiCash: parseFloat(document.getElementById('in-fii-cash')?.value || 0) || 0,
            fiiShortPct: parseFloat(document.getElementById('in-fii-short')?.value || 0) || 0,
            diiCash: parseFloat(document.getElementById('in-dii-cash')?.value || 0) || 0,
            fiiIdxFut: parseFloat(document.getElementById('in-fii-idx-fut')?.value || 0) || 0,
            fiiStkFut: parseFloat(document.getElementById('in-fii-stk-fut')?.value || 0) || 0,
            dowClose: parseFloat(document.getElementById('in-dow-close')?.value || 0) || 0,
            crudeSettle: parseFloat(document.getElementById('in-crude-settle')?.value || 0) || 0,
            giftSpot: parseFloat(document.getElementById('in-gift-spot')?.value || 0) || 0,
            upstoxBias: document.getElementById('in-upstox-bias')?.value || ''
        };
        const baseline = collectBaselineFromForm();
        const morningResult = callNativeJson('setMorningInput', JSON.stringify(baseline));
        if (morningResult && morningResult.error) {
            throw new Error(`Morning input error: ${morningResult.error}`);
        }

        localStorage.setItem('mr2_morning_inputs', JSON.stringify(rawInputs));
        localStorage.setItem('mr2_morning', JSON.stringify(rawInputs));

        localStorage.setItem('mr2_morning_baseline', JSON.stringify(baseline));
        // Do not overwrite the richer native baseline after setMorningInput().
        // NativeBridge.setMorningInput() already persisted:
        // - date
        // - fresh live BNF / NF / VIX quotes
        // - discovered expiries
        // Writing the form-collected baseline here can replace that with stale or
        // partial values before the first poll has even completed.

        document.querySelectorAll('.morning-input').forEach(el => el.disabled = true);
        const btnLock = document.getElementById('btn-lock');
        if (btnLock) {
            btnLock.disabled = true;
            btnLock.textContent = 'Scanning...';
        }
        const statusEl = document.getElementById('status');
        if (statusEl) statusEl.textContent = '✅ Morning data locked. Refreshing live scan...';

        STATE.morningExpandedAfterLock = false;
        collapseMorning({ force: true });
        triggerScan();
        renderAll();
    } catch (e) {
        console.error('lockMorningData failed:', e);
        const btnLock = document.getElementById('btn-lock');
        if (btnLock) {
            btnLock.disabled = false;
            btnLock.textContent = '🔒 Lock & Scan';
        }
        expandMorning();
        const statusEl = document.getElementById('status');
        if (statusEl) statusEl.textContent = `Lock failed: ${e.message}`;
    }
}


function restoreMorningData(cloudConfig) {
    // Priority: Supabase → localStorage
    let data = cloudConfig?.morning_inputs || null;
    if (!data && cloudConfig?.morning_baseline) {
        data = cloudConfig.morning_baseline;
    }
    if (!data) {
        const saved = localStorage.getItem('mr2_morning');
        if (!saved) return;
        try { data = JSON.parse(saved); } catch { return; }
    }

    // Only restore if saved today
    const today = API.todayIST();
    if (!data.date || data.date !== today) {
        clearMorningStorage();
        return;
    }

    const firstNonNull = (...vals) => vals.find(v => v !== undefined && v !== null && v !== '');
    const fiiCash = firstNonNull(data.fiiCash, data.fii_cash);
    const fiiShortPct = firstNonNull(data.fiiShortPct, data.fii_short_pct);
    const diiCash = firstNonNull(data.diiCash, data.dii_cash);
    const fiiIdxFut = firstNonNull(data.fiiIdxFut, data.fii_idx_fut);
    const fiiStkFut = firstNonNull(data.fiiStkFut, data.fii_stk_fut);
    const giftSpot = firstNonNull(data.giftSpot, data.gift_spot);
    const dowClose = firstNonNull(data.dowClose, data.dow_close, data.dow);
    const crudeSettle = firstNonNull(data.crudeSettle, data.crude_settle, data.crude);

    if (fiiCash !== undefined) document.getElementById('in-fii-cash').value = fiiCash;
    if (fiiShortPct !== undefined) document.getElementById('in-fii-short').value = fiiShortPct;
    if (diiCash !== undefined) { const el = document.getElementById('in-dii-cash'); if (el) el.value = diiCash; }
    if (fiiIdxFut !== undefined) { const el = document.getElementById('in-fii-idx-fut'); if (el) el.value = fiiIdxFut; }
    if (fiiStkFut !== undefined) { const el = document.getElementById('in-fii-stk-fut'); if (el) el.value = fiiStkFut; }
    if (giftSpot !== undefined) { const el = document.getElementById('in-gift-spot'); if (el) el.value = giftSpot; }
    if (data.upstoxBias) {
        const el = document.getElementById('in-upstox-bias');
        if (el) el.value = data.upstoxBias;
    }
    // Restore Dow/Crude morning reference
    if (dowClose !== undefined) {
        const el = document.getElementById('in-dow-close');
        if (el) el.value = dowClose;
        const gd = (typeof NativeBridge !== 'undefined' && NativeBridge.getGlobalDirection)
            ? safeParseNB(NativeBridge.getGlobalDirection(), {})
            : {};
        gd.dowClose = parseFloat(dowClose);
        if (typeof NativeBridge !== 'undefined' && NativeBridge.setGlobalDirection) {
            NativeBridge.setGlobalDirection(JSON.stringify(gd));
        }
    }
    if (crudeSettle !== undefined) {
        const el = document.getElementById('in-crude-settle');
        if (el) el.value = crudeSettle;
        const gd = (typeof NativeBridge !== 'undefined' && NativeBridge.getGlobalDirection)
            ? safeParseNB(NativeBridge.getGlobalDirection(), {})
            : {};
        gd.crudeSettle = parseFloat(crudeSettle);
        if (typeof NativeBridge !== 'undefined' && NativeBridge.setGlobalDirection) {
            NativeBridge.setGlobalDirection(JSON.stringify(gd));
        }
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
    const gd = (typeof NativeBridge !== 'undefined' && NativeBridge.getGlobalDirection)
        ? safeParseNB(NativeBridge.getGlobalDirection(), {})
        : {};
    if (parsed.dowNow) gd.dowNow = parsed.dowNow;
    if (parsed.crudeNow) gd.crudeNow = parsed.crudeNow;
    if (parsed.giftNow) gd.giftNow = parsed.giftNow;
    if (parsed._date) gd._date = parsed._date;
    if (typeof NativeBridge !== 'undefined' && NativeBridge.setGlobalDirection) {
        NativeBridge.setGlobalDirection(JSON.stringify(gd));
    }
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
    syncToNative();
}

function requestNotificationPermission() {
    if ('Notification' in window && Notification.permission === 'default') {
        Notification.requestPermission();
    }
}

// ═══ MORNING COLLAPSE ═══

function morningFieldValue(id, fallback = '--') {
    const el = document.getElementById(id);
    const value = String(el?.value || '').trim();
    return value || fallback;
}

function buildMorningSummaryHtml() {
    const upstox = morningFieldValue('in-upstox-bias', 'Not entered');
    const rows = [
        ['FII Cash', morningFieldValue('in-fii-cash')],
        ['FII Short%', morningFieldValue('in-fii-short')],
        ['DII Cash', morningFieldValue('in-dii-cash')],
        ['Idx Fut', morningFieldValue('in-fii-idx-fut')],
        ['Stk Fut', morningFieldValue('in-fii-stk-fut')],
        ['Dow', morningFieldValue('in-dow-close')],
        ['Crude', morningFieldValue('in-crude-settle')],
        ['GIFT', morningFieldValue('in-gift-spot')],
        ['Upstox', upstox]
    ];
    return `
        <div class="morning-collapsed-bar" role="button" tabindex="0" aria-label="Show locked morning inputs">
            <div>
                <strong>🔒 Morning data locked</strong>
                <span class="morning-summary-hint">Tap to review full inputs</span>
                <div class="morning-summary-grid">
                    ${rows.map(([label, value]) => `
                        <span class="morning-summary-item">
                            <span>${label}</span><b>${value}</b>
                        </span>
                    `).join('')}
                </div>
            </div>
            <span class="morning-summary-arrow">▾</span>
        </div>
    `;
}

function collapseMorning(options = {}) {
    if (STATE.morningExpandedAfterLock && !options.force) return;
    const section = document.getElementById('morning-section');
    const full = document.getElementById('morning-full');
    const collapsed = document.getElementById('morning-collapsed');
    if (!section || !full || !collapsed) return;

    collapsed.innerHTML = buildMorningSummaryHtml();
    collapsed.onclick = () => expandMorning({ lockedReview: true });
    collapsed.onkeydown = (event) => {
        if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            expandMorning({ lockedReview: true });
        }
    };
    full.style.display = 'none';
    collapsed.style.display = 'block';
    section.classList.add('collapsed');
}

function expandMorning(options = {}) {
    const section = document.getElementById('morning-section');
    const full = document.getElementById('morning-full');
    const collapsed = document.getElementById('morning-collapsed');
    if (!section || !full || !collapsed) return;

    if (options.lockedReview) STATE.morningExpandedAfterLock = true;
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

        callNativeJson('setEveningClose', JSON.stringify(payload));
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

const EXPORT_SUPABASE_URL = 'https://fdynxkfxohbnlvayouje.supabase.co';
const EXPORT_SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZkeW54a2Z4b2hibmx2YXlvdWplIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzMwMTc0NjQsImV4cCI6MjA4ODU5MzQ2NH0.1KbzYXtpuzUIDABCz9jKz4VjcuGeuyYOQAHkNLlndRE';
const EXPORT_TABLES = [
    'daily_data',
    'app_config',
    'trades_v2',
    'premium_history',
    'chain_snapshots',
    'ml_decisions',
    'ml_models',
    'ml_performance',
    'ml_poll_sequences',
    'trade_log',
    'trades',
    'radar_inputs',
    'bhav_options',
    'straddle_ratios',
];

const EXCEL_MAX_CELL_CHARS = 32767;
const EXPORT_TRUNCATION_STATS = { count: 0 };
const EXPORT_STORAGE_BUCKET = 'EXPORTS';
const EXPORT_RETENTION_DAYS = 14;
const EXPORT_MAX_FILES_TO_KEEP = 30;

function jsonCell(value) {
    if (value === null || value === undefined) return '';
    const raw = (typeof value === 'object') ? JSON.stringify(value) : String(value);
    if (raw.length <= EXCEL_MAX_CELL_CHARS) return raw;
    EXPORT_TRUNCATION_STATS.count += 1;
    const suffix = ' …[truncated]';
    return raw.slice(0, EXCEL_MAX_CELL_CHARS - suffix.length) + suffix;
}

function flattenRow(row) {
    const out = {};
    for (const [key, value] of Object.entries(row || {})) out[key] = jsonCell(value);
    return out;
}

function safeSheetName(name, used) {
    const base = String(name || 'Sheet').replace(/[:\\/?*[\]]/g, '_').slice(0, 31) || 'Sheet';
    let sheet = base;
    let suffix = 1;
    while (used.has(sheet)) {
        const tail = `_${suffix++}`;
        sheet = `${base.slice(0, 31 - tail.length)}${tail}`;
    }
    used.add(sheet);
    return sheet;
}

async function fetchAllExportRows(sb, table) {
    const pageSize = 1000;
    const rows = [];
    for (let from = 0; ; from += pageSize) {
        const to = from + pageSize - 1;
        const { data, error } = await sb.from(table).select('*').range(from, to);
        if (error) throw new Error(`${table}: ${error.message}`);
        rows.push(...(data || []));
        if (!data || data.length < pageSize) break;
    }
    return rows;
}

async function cleanupOldExportFiles(sb, opts = {}) {
    const keepDays = Number.isFinite(opts.keepDays) ? opts.keepDays : EXPORT_RETENTION_DAYS;
    const keepCount = Number.isFinite(opts.keepCount) ? opts.keepCount : EXPORT_MAX_FILES_TO_KEEP;
    const cutoffMs = Date.now() - (keepDays * 24 * 60 * 60 * 1000);
    const keepSet = new Set(opts.keepPaths || []);

    const allFiles = [];
    const pageSize = 100;
    for (let offset = 0; ; offset += pageSize) {
        const { data, error } = await sb.storage.from(EXPORT_STORAGE_BUCKET).list('', {
            limit: pageSize,
            offset,
            sortBy: { column: 'created_at', order: 'desc' },
        });
        if (error) throw new Error(`EXPORTS list failed: ${error.message}`);
        const page = Array.isArray(data) ? data.filter(f => f && f.name) : [];
        allFiles.push(...page);
        if (page.length < pageSize) break;
    }

    const sorted = allFiles.sort((a, b) => {
        const at = Date.parse(a.created_at || '') || 0;
        const bt = Date.parse(b.created_at || '') || 0;
        return bt - at;
    });

    const toDelete = [];
    sorted.forEach((file, idx) => {
        const name = file.name;
        if (!name || keepSet.has(name)) return;
        const createdAtMs = Date.parse(file.created_at || '') || 0;
        const tooOld = createdAtMs > 0 && createdAtMs < cutoffMs;
        const overCount = idx >= keepCount;
        if (tooOld || overCount) toDelete.push(name);
    });

    if (!toDelete.length) return { scanned: sorted.length, deleted: 0 };

    let deleted = 0;
    for (let i = 0; i < toDelete.length; i += 100) {
        const chunk = toDelete.slice(i, i + 100);
        const { error: rmErr } = await sb.storage.from(EXPORT_STORAGE_BUCKET).remove(chunk);
        if (!rmErr) deleted += chunk.length;
    }
    return { scanned: sorted.length, deleted };
}

function buildPollAuditRows(appConfigRows) {
    const pollRows = [];
    for (const row of appConfigRows || []) {
        if (!String(row.key || '').startsWith('poll_history_')) continue;
        const tradeDate = String(row.key).replace('poll_history_', '');
        const polls = Array.isArray(row.value) ? row.value : [];
        polls.forEach((p, idx) => {
            pollRows.push({
                trade_date: tradeDate,
                poll_no: idx + 1,
                poll_date: p.date || '',
                time: p.t || '',
                bnf: p.bnf,
                nf: p.nf,
                vix: p.vix,
                bnf_pcr: p.pcr,
                nf_pcr: p.nfPcr,
                bnf_call_wall: p.cw,
                bnf_call_wall_oi: p.cwOI,
                bnf_put_wall: p.pw,
                bnf_put_wall_oi: p.pwOI,
                nf_call_wall: p.nfCW,
                nf_call_wall_oi: p.nfCWOI,
                nf_put_wall: p.nfPW,
                nf_put_wall_oi: p.nfPWOI,
                bnf_max_pain: p.mp,
                nf_max_pain: p.nfMP,
                bnf_total_call_oi: p.bnfCOI,
                bnf_total_put_oi: p.bnfPOI,
                nf_total_call_oi: p.nfCOI,
                nf_total_put_oi: p.nfPOI,
                futures_prem: p.fp,
                breadth_pct: p.brd,
                nf50_advancing: p.nfAdv,
                bias_net: p.bias,
            });
        });
    }
    return pollRows;
}

function buildStrikeAuditRows(appConfigRows) {
    const strikeRows = [];
    for (const row of appConfigRows || []) {
        if (!String(row.key || '').startsWith('poll_history_')) continue;
        const tradeDate = String(row.key).replace('poll_history_', '');
        const polls = Array.isArray(row.value) ? row.value : [];
        polls.forEach((p, pollIdx) => {
            for (const [idx, strikes] of [['BNF', p.bnfS || []], ['NF', p.nfS || []]]) {
                for (const s of strikes) {
                    if (s.c) {
                        strikeRows.push({
                            trade_date: tradeDate, poll_no: pollIdx + 1, time: p.t || '',
                            index: idx, strike: s.k, side: 'CE',
                            oi: s.c.o, volume: s.c.v, ltp: s.c.l, iv: s.c.i, delta: s.c.d, pop: s.c.p
                        });
                    }
                    if (s.p) {
                        strikeRows.push({
                            trade_date: tradeDate, poll_no: pollIdx + 1, time: p.t || '',
                            index: idx, strike: s.k, side: 'PE',
                            oi: s.p.o, volume: s.p.v, ltp: s.p.l, iv: s.p.i, delta: s.p.d, pop: s.p.p
                        });
                    }
                }
            }
        });
    }
    return strikeRows;
}

function buildAppConfigAuditRows(appConfigRows) {
    return (appConfigRows || []).map(row => ({
        key: row.key,
        updated_at: row.updated_at || '',
        value_type: Array.isArray(row.value) ? 'array' : typeof row.value,
        array_count: Array.isArray(row.value) ? row.value.length : '',
        value_json: jsonCell(row.value),
    }));
}

async function blobToBase64Payload(blob) {
    const bytes = new Uint8Array(await blob.arrayBuffer());
    let binary = '';
    const chunkSize = 0x8000;
    for (let i = 0; i < bytes.length; i += chunkSize) {
        binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
    }
    return btoa(binary);
}

async function saveExportBlobNative(filename, blob) {
    const bridge = window.NativeBridge || window.AndroidBridge;
    if (!bridge?.saveExportFile && !bridge?.beginExportFile) return null;
    const mimeType = blob.type || 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
    const base64Data = await blobToBase64Payload(blob);

    if (bridge?.beginExportFile && bridge?.appendExportFileChunk && bridge?.finishExportFile) {
        const beginRaw = bridge.beginExportFile(filename, mimeType);
        let begin = null;
        try {
            begin = JSON.parse(beginRaw || '{}');
        } catch (e) {
            throw new Error(`Native export begin returned invalid response: ${beginRaw || 'empty'}`);
        }
        if (!begin.ok || !begin.sessionId) throw new Error(begin.error || 'Native export begin failed');

        // Android WebView's JavaScript bridge rejects string args above ~32767 chars.
        const chunkSize = 24 * 1024;
        for (let i = 0; i < base64Data.length; i += chunkSize) {
            const chunkRaw = bridge.appendExportFileChunk(begin.sessionId, base64Data.slice(i, i + chunkSize));
            let chunkResult = null;
            try {
                chunkResult = JSON.parse(chunkRaw || '{}');
            } catch (e) {
                throw new Error(`Native export chunk returned invalid response: ${chunkRaw || 'empty'}`);
            }
            if (!chunkResult.ok) throw new Error(chunkResult.error || 'Native export chunk failed');
        }

        const finishRaw = bridge.finishExportFile(begin.sessionId);
        let finish = null;
        try {
            finish = JSON.parse(finishRaw || '{}');
        } catch (e) {
            throw new Error(`Native export finish returned invalid response: ${finishRaw || 'empty'}`);
        }
        if (!finish.ok) throw new Error(finish.error || 'Native export finish failed');
        return finish;
    }

    const raw = bridge.saveExportFile(filename, mimeType, base64Data);
    let result = null;
    try {
        result = JSON.parse(raw || '{}');
    } catch (e) {
        throw new Error(`Native export returned invalid response: ${raw || 'empty'}`);
    }
    if (!result.ok) throw new Error(result.error || 'Native export failed');
    return result;
}

async function exportAllData() {
    const statusEl = document.getElementById('export-status');
    const btn = document.getElementById('btn-export');
    if (!statusEl || !btn) return;
    if (!window.supabase?.createClient) {
        statusEl.textContent = '❌ Supabase export library not loaded. Refresh and retry.';
        return;
    }
    if (!window.XLSX) {
        statusEl.textContent = '❌ SheetJS Excel library not loaded. Refresh and retry.';
        return;
    }

    btn.disabled = true;
    EXPORT_TRUNCATION_STATS.count = 0;
    const sb = window.supabase.createClient(EXPORT_SUPABASE_URL, EXPORT_SUPABASE_ANON_KEY);
    const rowsByTable = {};
    const errors = [];

    try {
        for (const table of EXPORT_TABLES) {
            statusEl.textContent = `⏳ Fetching ${table}...`;
            try {
                rowsByTable[table] = await fetchAllExportRows(sb, table);
            } catch (e) {
                rowsByTable[table] = [];
                errors.push(e.message);
            }
        }

        statusEl.textContent = '⏳ Building Excel workbook...';
        const appConfigRows = rowsByTable.app_config || [];
        const pollRows = buildPollAuditRows(appConfigRows);
        const strikeRows = buildStrikeAuditRows(appConfigRows);
        const configAuditRows = buildAppConfigAuditRows(appConfigRows);
        const usedNames = new Set();
        const wb = XLSX.utils.book_new();

        const summaryRows = [
            { metric: 'Export timestamp', value: new Date().toISOString() },
            { metric: 'PWA version', value: document.querySelector('.version')?.textContent?.trim() || 'unknown' },
            { metric: 'Tables requested', value: EXPORT_TABLES.length },
            { metric: 'Tables with fetch errors', value: errors.length },
            { metric: 'Poll history rows', value: pollRows.length },
            { metric: 'Strike rows', value: strikeRows.length },
            { metric: 'Oversized cells truncated', value: EXPORT_TRUNCATION_STATS.count },
            ...EXPORT_TABLES.map(table => ({ metric: `${table} rows`, value: rowsByTable[table]?.length || 0 })),
            ...errors.map((error, idx) => ({ metric: `Error ${idx + 1}`, value: error })),
        ];
        XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(summaryRows), safeSheetName('Summary', usedNames));
        XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(pollRows.length ? pollRows : [{ note: 'No poll_history_* rows found in app_config' }]), safeSheetName('Poll History Flat', usedNames));
        XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(strikeRows.length ? strikeRows : [{ note: 'No per-strike rows found in poll history' }]), safeSheetName('Strike Data Flat', usedNames));
        XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(configAuditRows.length ? configAuditRows : [{ note: 'No app_config rows found' }]), safeSheetName('App Config Audit', usedNames));

        for (const table of EXPORT_TABLES) {
            const rows = rowsByTable[table] || [];
            const sheetRows = rows.length ? rows.map(flattenRow) : [{ note: `No rows exported from ${table}` }];
            XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(sheetRows), safeSheetName(table, usedNames));
        }

        const today = API.todayIST();
        const filename = `MarketRadar_Export_${today}.xlsx`;
        const wbout = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
        const blob = new Blob([wbout], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
        const storagePath = `export_${today}_${Date.now()}.xlsx`;
        const totalRows = Object.values(rowsByTable).reduce((sum, rows) => sum + (rows?.length || 0), 0);
        let nativeSaveWarning = '';

        try {
            statusEl.textContent = '⏳ Saving Excel to Downloads...';
            const nativeResult = await saveExportBlobNative(filename, blob);
            if (nativeResult?.ok) {
                statusEl.textContent = '';
                statusEl.appendChild(document.createTextNode(`✅ Export saved to Downloads: ${nativeResult.fileName || filename} · ${totalRows} table rows · ${pollRows.length} polls · ${strikeRows.length} strikes`));
                if (errors.length) {
                    statusEl.appendChild(document.createElement('br'));
                    const errSpan = document.createElement('span');
                    errSpan.style.color = '#b45309';
                    errSpan.textContent = `⚠ ${errors.length} table fetch issue(s); see Summary sheet.`;
                    statusEl.appendChild(errSpan);
                }
                if (EXPORT_TRUNCATION_STATS.count > 0) {
                    statusEl.appendChild(document.createElement('br'));
                    const truncSpan = document.createElement('span');
                    truncSpan.style.color = '#b45309';
                    truncSpan.textContent = `⚠ ${EXPORT_TRUNCATION_STATS.count} oversized cell(s) truncated for Excel compatibility.`;
                    statusEl.appendChild(truncSpan);
                }
                return;
            }
        } catch (nativeErr) {
            nativeSaveWarning = nativeErr.message || String(nativeErr);
            console.warn('Native export save failed; falling back to Supabase Storage:', nativeErr);
        }

        statusEl.textContent = '⏳ Uploading Excel to Supabase Storage...';
        const { error: uploadErr } = await sb.storage.from(EXPORT_STORAGE_BUCKET).upload(storagePath, blob, {
            contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
            upsert: true,
        });
        if (uploadErr) {
            const detail = nativeSaveWarning
                ? `Native save failed: ${nativeSaveWarning}; Storage upload failed: ${uploadErr.message}`
                : `Storage upload failed: ${uploadErr.message}`;
            throw new Error(detail);
        }

        let cleanupNote = '';
        try {
            const cleanup = await cleanupOldExportFiles(sb, {
                keepDays: EXPORT_RETENTION_DAYS,
                keepCount: EXPORT_MAX_FILES_TO_KEEP,
                keepPaths: [storagePath],
            });
            if (cleanup?.deleted) {
                cleanupNote = ` · cleanup: deleted ${cleanup.deleted} old file(s)`;
            }
        } catch (cleanupErr) {
            console.warn('EXPORTS cleanup warning:', cleanupErr);
        }

        const { data: urlData } = sb.storage.from(EXPORT_STORAGE_BUCKET).getPublicUrl(storagePath, { download: filename });
        const publicUrl = urlData?.publicUrl;
        if (!publicUrl) throw new Error('Storage upload succeeded but public URL was empty');

        const iframe = document.createElement('iframe');
        iframe.style.display = 'none';
        iframe.src = publicUrl;
        document.body.appendChild(iframe);
        setTimeout(() => { try { document.body.removeChild(iframe); } catch (e) { /* ignore cleanup */ } }, 30000);

        statusEl.textContent = '';
        statusEl.appendChild(document.createTextNode(`✅ Export ready: ${totalRows} table rows · ${pollRows.length} polls · ${strikeRows.length} strikes${cleanupNote}`));
        if (errors.length) {
            statusEl.appendChild(document.createElement('br'));
            const errSpan = document.createElement('span');
            errSpan.style.color = '#b45309';
            errSpan.textContent = `⚠ ${errors.length} table fetch issue(s); see Summary sheet.`;
            statusEl.appendChild(errSpan);
        }
        if (EXPORT_TRUNCATION_STATS.count > 0) {
            statusEl.appendChild(document.createElement('br'));
            const truncSpan = document.createElement('span');
            truncSpan.style.color = '#b45309';
            truncSpan.textContent = `⚠ ${EXPORT_TRUNCATION_STATS.count} oversized cell(s) truncated for Excel compatibility.`;
            statusEl.appendChild(truncSpan);
        }
        statusEl.appendChild(document.createElement('br'));
        const link = document.createElement('a');
        link.href = publicUrl;
        link.download = filename;
        link.target = '_blank';
        link.rel = 'noopener';
        link.textContent = '📥 Download Excel';
        link.style.cssText = 'display:inline-block;margin-top:6px;padding:10px 16px;background:var(--accent);color:white;border-radius:8px;font-weight:700;font-size:13px;text-decoration:none';
        statusEl.appendChild(link);
    } catch (err) {
        console.error('Export error:', err);
        statusEl.textContent = `❌ Export failed: ${err.message}`;
    } finally {
        btn.disabled = false;
    }
}

window.exportAllData = exportAllData;

function bindCriticalUiHandlers() {
    const tabButtons = Array.from(document.querySelectorAll('.tab-btn'));
    tabButtons.forEach(btn => {
        btn.onclick = () => switchTab(btn.dataset.tab);
    });

    const firstTab = tabButtons[0];
    if (!(firstTab && typeof firstTab.onclick === 'function')) {
        throw new Error('tab-btn listeners failed to attach');
    }

    document.getElementById('btn-save-evening').onclick = saveEveningClose;
    document.getElementById('btn-lock').onclick = lockMorningData;
    document.getElementById('btn-stop').onclick = stopWatchLoop;
    document.getElementById('btn-rescan').onclick = () => {
        stopWatchLoop();
        STATE.morningExpandedAfterLock = false;
        expandMorning();
        document.getElementById('btn-lock').disabled = false;
        document.getElementById('btn-lock').textContent = '🔒 Lock & Scan';
        document.querySelectorAll('.morning-input').forEach(el => el.disabled = false);
    };

    const themeSwitch = document.getElementById('theme-switch');
    if (themeSwitch) {
        themeSwitch.onchange = (e) => {
            const isDark = e.target.checked;
            document.body.classList.toggle('dark', isDark);
            localStorage.setItem('mr2_theme', isDark ? 'dark' : 'light');
            persistSettingsPatch({
                theme: isDark ? 'dark' : 'light',
                tradeMode: STATE.tradeMode,
                tradeModeExplicit: localTradeModeExplicit()
            });
            document.querySelector('.toggle-icon').textContent = isDark ? '🌙' : '☀️';
            document.querySelector('meta[name="theme-color"]').content = isDark ? '#121218' : '#FFFFFF';
        };
    }
}

// ═══ INIT ═══
document.addEventListener('DOMContentLoaded', async () => {
    initStickyLayoutObserver();
    try {
        bindCriticalUiHandlers();
        console.info('[boot] tab handlers attached:', typeof document.querySelectorAll('.tab-btn')[0]?.onclick === 'function');
    } catch (e) {
        console.error('[boot] Critical UI handler bind failed:', e);
        const statusEl = document.getElementById('status');
        if (statusEl) statusEl.textContent = `Boot error: ${e.message}`;
        return;
    }

    // F.2.1b — DB module deleted in F.2; null-guard all DB.* calls so boot completes
    // and button event listeners get attached. Restores rely on localStorage fallback.
    try { if (typeof DB !== 'undefined' && DB.init) DB.init(); } catch (e) { console.warn('[boot] DB.init skipped:', e.message); }
    try { syncUpstoxTokenToNative(); } catch (e) { console.warn('[boot] token sync skipped:', e.message); }
    try { restoreEvaluatorJob(); } catch (e) { console.warn('[boot] restoreEvaluatorJob failed:', e.message); }

    // Fetch all config from Supabase (single query) — localStorage fallback if offline
    let cloudConfig = null;
    try { if (typeof DB !== 'undefined' && DB.getAllConfig) cloudConfig = await DB.getAllConfig(); } catch (e) { console.warn('[boot] DB.getAllConfig skipped:', e.message); }

    try { restoreMorningData(cloudConfig); } catch (e) { console.warn('[boot] restoreMorningData failed:', e.message); }
    try { restoreGlobalContext(cloudConfig); } catch (e) { console.warn('[boot] restoreGlobalContext failed:', e.message); }
    try { restoreEveningClose(cloudConfig); } catch (e) { console.warn('[boot] restoreEveningClose failed:', e.message); }

    // Phase 11: Restore today's poll history (survives refresh + background kill)
    // Fetched separately because getAllConfig now excludes poll_history_* for performance
    const todayKey = 'poll_history_' + API.todayIST();
    let todayPolls = null;
    try { if (typeof DB !== 'undefined' && DB.getConfig) todayPolls = await DB.getConfig(todayKey); } catch (e) { console.warn('[boot] DB.getConfig(poll_history) skipped:', e.message); }
    if (todayPolls && Array.isArray(todayPolls)) {
        STATE.pollHistory = todayPolls;
        STATE.pollCount = todayPolls.length;
    }

    // b97: Restore baseline from Supabase — enables polling after background kill
    const savedBaseline = cloudConfig?.morning_baseline;
    if (savedBaseline && savedBaseline._date === API.todayIST() && savedBaseline.baseline) {
        const nativeBaselineToday = getTodayNativeBaseline();
        if (!nativeBaselineToday) {
            const restoredBaseline = { ...savedBaseline.baseline, date: savedBaseline._date };
            STATE.baseline = restoredBaseline;
            STATE.live = { ...restoredBaseline };
            if (savedBaseline.bnfExpiry) STATE.bnfExpiry = savedBaseline.bnfExpiry;
            if (savedBaseline.nfExpiry) STATE.nfExpiry = savedBaseline.nfExpiry;
            try {
                if (typeof NativeBridge !== 'undefined' && NativeBridge.setBaseline) {
                    NativeBridge.setBaseline(JSON.stringify(restoredBaseline));
                }
            } catch (e) {
                console.warn('[b97] Native baseline restore skipped:', e.message);
            }
            console.log('[b97] Baseline restored from Supabase');
        }
    }

    // Cleanup poll_history keys older than 7 days (fire-and-forget)
    try { if (typeof DB !== 'undefined' && DB.cleanOldPolls) DB.cleanOldPolls(7).catch(() => {}); } catch (e) {}

    initTheme(cloudConfig);
    try { await loadOpenTrade(); } catch (e) { console.warn('[boot] loadOpenTrade failed:', e); }
    try { await loadApprovedBranchProposals(true); } catch (e) { console.warn('[boot] loadApprovedBranchProposals failed:', e.message); }
    try {
        if (typeof DB !== 'undefined' && DB.getSignalAccuracyStats) {
            STATE.signalAccuracyStats = await DB.getSignalAccuracyStats();
        } else {
            STATE.signalAccuracyStats = safeParseNB(NativeBridge.getSignalAccuracyStats(), {});
        }
    } catch (e) {
        console.warn('[boot] getSignalAccuracyStats skipped:', e.message);
        STATE.signalAccuracyStats = {};
    }

    // If open trades exist, show positions tab
    if (safeParseNB(NativeBridge.getOpenTrades(), []).length > 0) {
        switchTab('positions');
    }

    try { renderAll(); } catch (e) { console.warn('[boot] renderAll failed:', e.message); }
    try {
        const restoredJobId = STATE.evaluatorJob?.job_id;
        const restoredJobStatus = String(STATE.evaluatorJob?.status || '').toLowerCase();
        if (restoredJobId && !['completed', 'failed', 'rejected'].includes(restoredJobStatus)) {
            await refreshEvaluatorJobStatus(restoredJobId, { allowReschedule: true });
        }
    } catch (e) {
        console.warn('[boot] evaluator status restore failed:', e.message);
    }

    // Auto-ingestion is native-owned. The service should start on market open
    // when token/schedule conditions are met, even if Lock & Scan is never pressed.
    maybeAutoStartNativeIngestion('boot');
    const todayBaseline = getTodayNativeBaseline();
    if (todayBaseline && safeParseNB(NativeBridge.getServiceStatus(), {}).running) {
        console.log(`[b162] Restored active service: ${safeParseNB(NativeBridge.getPollHistory(), []).length} polls restored`);
        STATE.morningExpandedAfterLock = false;
        collapseMorning({ force: true });
        const lockBtn = document.getElementById('btn-lock');
        if (lockBtn) {
            lockBtn.textContent = 'Watching...';
            lockBtn.disabled = true;
        }
        document.querySelectorAll('.morning-input').forEach(el => el.disabled = true);
        const watchEl = document.getElementById('watch-status');
        if (watchEl) watchEl.textContent = `🟢 Watching · Poll #${STATE.pollCount}`;
        updateLockScanUi();
    } else {
        updateWatchStatusHint(safeParseNB(NativeBridge.getServiceStatus(), {}));
    }

    // Native Kotlin+Chaquopy runtime owns all analysis.

    // Global Direction inputs — live update on change + auto-save + recompute boost
    document.addEventListener('change', (e) => {
        const gd = safeParseNB(NativeBridge.getGlobalDirection(), {});
        if (e.target.id === 'in-dow-now') {
            gd.dowNow = e.target.value ? parseFloat(e.target.value) : null;
        } else if (e.target.id === 'in-crude-now') {
            gd.crudeNow = e.target.value ? parseFloat(e.target.value) : null;
        } else if (e.target.id === 'in-gift-now') {
            gd.giftNow = e.target.value ? parseFloat(e.target.value) : null;
        } else { return; }
        if (typeof NativeBridge !== 'undefined' && NativeBridge.setGlobalDirection) {
            NativeBridge.setGlobalDirection(JSON.stringify(gd));
        }
        // Auto-save to localStorage + Supabase with date stamp
        const saveData = { ...gd, _date: API.todayIST() };
        localStorage.setItem('mr2_global_context', JSON.stringify(saveData));
        DB.setConfig('global_direction', saveData);

        // Recompute globalBoost with new direction data
        computeGlobalBoost(bd.tomorrow_signal, bd.positioning);
        renderAll();
    });

    // Global Direction explicit save button (mobile-friendly — change event may not fire)
    document.addEventListener('click', (e) => {
        if (e.target.id !== 'btn-save-global-dir') return;
        const gd = safeParseNB(NativeBridge.getGlobalDirection(), {});
        const dowEl = document.getElementById('in-dow-now');
        const crudeEl = document.getElementById('in-crude-now');
        const giftEl = document.getElementById('in-gift-now');
        if (dowEl) gd.dowNow = dowEl.value ? parseFloat(dowEl.value) : null;
        if (crudeEl) gd.crudeNow = crudeEl.value ? parseFloat(crudeEl.value) : null;
        if (giftEl) gd.giftNow = giftEl.value ? parseFloat(giftEl.value) : null;
        if (typeof NativeBridge !== 'undefined' && NativeBridge.setGlobalDirection) {
            NativeBridge.setGlobalDirection(JSON.stringify(gd));
        }
        const saveData = { ...gd, _date: API.todayIST() };
        localStorage.setItem('mr2_global_context', JSON.stringify(saveData));
        DB.setConfig('global_direction', saveData);
        computeGlobalBoost(bd.tomorrow_signal, bd.positioning);
        // Show saved feedback
        const badge = document.getElementById('global-dir-saved');
        if (badge) { badge.style.display = 'inline'; setTimeout(() => badge.style.display = 'none', 2000); }
        renderAll();
    });

    // b99: VISIBILITY CHANGE — instant recovery when app returns from background
    // Android suspends WebView JS in background. When user returns, timers may be stale.
    // This ensures immediate poll + brain run instead of waiting for next 5-min interval.
    document.addEventListener('visibilitychange', async () => {
        if (document.visibilityState !== 'visible') return;
        const serviceStatus = safeParseNB(NativeBridge.getServiceStatus(), {});
        maybeAutoStartNativeIngestion('resume');
        try { await loadApprovedBranchProposals(true); } catch (e) { console.warn('[resume] loadApprovedBranchProposals failed:', e.message); }
        if (STATE.evaluatorJob?.job_id) {
            try {
                const status = String(STATE.evaluatorJob.status || '').toLowerCase();
                if (!['completed', 'failed', 'rejected'].includes(status)) {
                    await refreshEvaluatorJobStatus(STATE.evaluatorJob.job_id, { allowReschedule: true });
                }
            } catch (e) {
                console.warn('[resume] evaluator status refresh failed:', e.message);
            }
        }
        if (!todayNativeSessionActive(serviceStatus) && !serviceStatus.running) {
            clearSessionDerivedState();
            updateWatchStatusHint(serviceStatus);
            renderAll();
            return;
        }

        // Phase 4: NATIVE MODE — full pull from Kotlin, no lightFetch
        if (STATE._nativeMode && window.NativeBridge) {
            console.log('[Phase 4] App resumed — pulling all data from Kotlin');
            try {
                // Pull polls
                if (window.NativeBridge.getPollHistory) {
                    const rawPolls = window.NativeBridge.getPollHistory();
                    const nativePolls = safeParseNB(rawPolls, []);
                    if (Array.isArray(nativePolls)) {
                        STATE.pollHistory = nativePolls;
                        STATE.pollCount = nativePolls.length;
                    }
                }
                // Pull brain result (verdict, market, positions, effective bias)
                if (window.NativeBridge.getBrainResult) {
                    const brJson = window.NativeBridge.getBrainResult();
                    if (brJson && brJson !== '{}' && brJson !== 'null' && brJson !== '') {
                        const br = JSON.parse(brJson);
                        adoptBrainResult(br);
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
                // Legacy fallback only. In normal native mode, brain result owns watchlist/candidates.
                if ((!bd.watchlist || !bd.watchlist.length) && window.NativeBridge.getCandidates) {
                    const candJson = window.NativeBridge.getCandidates();
                    if (candJson && candJson !== '[]' && candJson !== 'null') {
                        const cands = JSON.parse(candJson);
                        if (Array.isArray(cands) && cands.length > 0) {
                            STATE.candidates = cands;
                            STATE.watchlist = cands.slice(0, 6);
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
            updateWatchStatusHint(safeParseNB(NativeBridge.getServiceStatus(), serviceStatus));
            renderAll();
            return; // No lightFetch in native mode
        }

        // BROWSER MODE — existing recovery logic
        const resumeStatus = safeParseNB(NativeBridge.getServiceStatus(), {});
        const sinceLastPoll = (resumeStatus.lastPoll) ? (Date.now() - resumeStatus.lastPoll) / 60000 : 999;
        if (sinceLastPoll >= 4) {
            console.log(`[b108] App returned from background. Last poll ${sinceLastPoll.toFixed(1)}min ago. Immediate recovery.`);
            const el = document.getElementById('watch-status');
            if (el) el.textContent = '🔄 Recovering from background...';
            try {
                await lightFetch();
                updateWatchStatusHint(safeParseNB(NativeBridge.getServiceStatus(), resumeStatus));
            } catch(e) {
                console.warn('[b108] Recovery poll failed:', e.message);
                updateWatchStatusHint(safeParseNB(NativeBridge.getServiceStatus(), resumeStatus));
            }
        }
    });
});

function initStickyLayoutObserver() {
    updateStickyLayout();
    window.addEventListener('resize', updateStickyLayout);
    window.addEventListener('orientationchange', updateStickyLayout);
    if (window.ResizeObserver) {
        const observer = new ResizeObserver(updateStickyLayout);
        const header = document.querySelector('.app-header');
        const ticker = document.getElementById('live-ticker');
        if (header) observer.observe(header);
        if (ticker) observer.observe(ticker);
    }
}

function initTheme(cloudConfig) {
    const settings = cloudConfig?.settings || null;
    STATE.settingsConfig = settings ? { ...settings } : null;
    const savedTheme = settings?.theme || localStorage.getItem('mr2_theme');
    // Restore trade mode from saved UI settings first; native is a fallback only.
    const savedMode = settings?.tradeMode || localStorage.getItem(LS_TRADE_MODE);
    const savedModeExplicit = settings?.tradeModeExplicit === true || localTradeModeExplicit();
    if (savedMode === 'intraday' || savedMode === 'swing') {
        STATE.tradeMode = savedModeExplicit ? savedMode : DEFAULT_TRADE_MODE;
    }
    try {
        const nativeMode = (typeof NativeBridge !== 'undefined' && NativeBridge.getTradeMode) ? NativeBridge.getTradeMode() : '';
        const nativeModeExplicit = (typeof NativeBridge !== 'undefined' && NativeBridge.getTradeModeExplicit)
            ? !!NativeBridge.getTradeModeExplicit()
            : false;
        if (savedMode === 'intraday' || savedMode === 'swing') {
            if (savedModeExplicit) {
                setLocalTradeMode(STATE.tradeMode, true);
            } else {
                setLocalTradeMode(DEFAULT_TRADE_MODE, false);
                persistSettingsPatch({ theme: savedTheme === 'dark' ? 'dark' : 'light', tradeMode: DEFAULT_TRADE_MODE, tradeModeExplicit: false });
            }
            if (typeof NativeBridge !== 'undefined') {
                if (savedModeExplicit && NativeBridge.setTradeMode) {
                    NativeBridge.setTradeMode(STATE.tradeMode);
                } else if (!savedModeExplicit && NativeBridge.setTradeModeDefault) {
                    NativeBridge.setTradeModeDefault(STATE.tradeMode);
                }
            }
        } else if (nativeMode === 'intraday' || nativeMode === 'swing') {
            if (nativeModeExplicit) {
                STATE.tradeMode = nativeMode;
                setLocalTradeMode(STATE.tradeMode, true);
                persistSettingsPatch({ theme: savedTheme === 'dark' ? 'dark' : 'light', tradeMode: STATE.tradeMode, tradeModeExplicit: true });
            } else {
                STATE.tradeMode = nativeMode === 'swing' ? DEFAULT_TRADE_MODE : nativeMode;
                setLocalTradeMode(STATE.tradeMode, false);
                persistSettingsPatch({ theme: savedTheme === 'dark' ? 'dark' : 'light', tradeMode: STATE.tradeMode, tradeModeExplicit: false });
                if (typeof NativeBridge !== 'undefined' && NativeBridge.setTradeModeDefault) {
                    NativeBridge.setTradeModeDefault(STATE.tradeMode);
                }
            }
        } else if (typeof NativeBridge !== 'undefined' && NativeBridge.setTradeModeDefault) {
            NativeBridge.setTradeModeDefault(STATE.tradeMode);
        }
    } catch {}
    if (savedTheme === 'dark') {
        document.body.classList.add('dark');
        const toggle = document.getElementById('theme-switch');
        if (toggle) toggle.checked = true;
        const icon = document.querySelector('.toggle-icon');
        if (icon) icon.textContent = '🌙';
        document.querySelector('meta[name="theme-color"]').content = '#121218';
    }
}
