/* ═══════════════════════════════════════════════════════════════
   Market Radar v2 — Upstox API
   Light: spot + VIX + ATM chain slice (2-3 calls per 5-min poll)
   Heavy: full chains + expiries (initial scan only)
   ═══════════════════════════════════════════════════════════════ */

const API = (() => {
    const BASE = 'https://api.upstox.com/v2';
    const NF_KEY = 'NSE_INDEX|Nifty 50';
    const BNF_KEY = 'NSE_INDEX|Nifty Bank';
    const VIX_KEY = 'NSE_INDEX|India VIX';

    // NSE Holidays 2026 — source NSE/CMTR/71775 Dec 12 2025. DO NOT CHANGE.
    const NSE_HOLIDAYS = [
        '2026-01-26', '2026-03-03', '2026-03-26', '2026-03-31',
        '2026-04-03', '2026-04-14', '2026-05-01', '2026-05-28',
        '2026-06-26', '2026-09-14', '2026-10-02', '2026-10-20',
        '2026-11-10', '2026-11-24', '2026-12-25'
    ];

    function getToken() {
        return localStorage.getItem('mr2_upstox_token') || '';
    }

    function setToken(token) {
        localStorage.setItem('mr2_upstox_token', token.trim());
    }

    // ═══ DEBUG LOG — accessible via window._API_DEBUG in console ═══
    const _debug = [];
    function debugLog(label, data) {
        const entry = { time: new Date().toLocaleTimeString('en-IN', { timeZone: 'Asia/Kolkata' }), label, ...data };
        _debug.push(entry);
        if (_debug.length > 100) _debug.shift(); // rolling 100
        console.log(`[API] ${label}`, data);
    }

    async function apiCall(endpoint, rawQuery) {
        const token = getToken();
        if (!token) throw new Error('No Upstox token. Paste your access token.');
        // rawQuery is a pre-built query string
        const url = `${BASE}${endpoint}${rawQuery ? '?' + rawQuery : ''}`;
        debugLog('REQUEST', { endpoint, url });
        const res = await fetch(url, {
            headers: { 'Authorization': `Bearer ${token}`, 'Accept': 'application/json' }
        });
        if (!res.ok) {
            const body = await res.json().catch(() => ({}));
            debugLog('ERROR', { status: res.status, endpoint, body });
            throw new Error(`API ${res.status}: ${body.message || body.errors?.[0]?.message || 'Unknown error'}`);
        }
        const json = await res.json();
        debugLog('RESPONSE', { endpoint, status: res.status, dataKeys: Object.keys(json?.data || {}).length });
        return json;
    }

    // ═══ MARKET DATA ═══

    async function fetchSpots() {
        const keys = [NF_KEY, BNF_KEY, VIX_KEY].map(encodeURIComponent).join(',');
        const data = await apiCall('/market-quote/quotes', `instrument_key=${keys}`);
        const quotes = data?.data || {};
        const result = { nfSpot: null, bnfSpot: null, vix: null, timestamp: Date.now(),
            bnfOHLC: null, nfOHLC: null };

        debugLog('SPOTS_RAW_KEYS', { keys: Object.keys(quotes) });

        for (const [key, val] of Object.entries(quotes)) {
            const ltp = val?.last_price;
            const ohlc = val?.ohlc;
            if (key.includes('Nifty 50') && !key.includes('Bank')) {
                result.nfSpot = ltp;
                if (ohlc) result.nfOHLC = { open: ohlc.open, high: ohlc.high || ltp, low: ohlc.low || ltp, close: ltp };
            } else if (key.includes('Nifty Bank')) {
                result.bnfSpot = ltp;
                if (ohlc) result.bnfOHLC = { open: ohlc.open, high: ohlc.high || ltp, low: ohlc.low || ltp, close: ltp };
            } else if (key.includes('VIX')) {
                result.vix = ltp;
            }
        }

        debugLog('SPOTS_PARSED', { nf: result.nfSpot, bnf: result.bnfSpot, vix: result.vix,
            bnfOHLC: result.bnfOHLC ? `O:${result.bnfOHLC.open} H:${result.bnfOHLC.high} L:${result.bnfOHLC.low}` : 'none' });
        return result;
    }

    // ═══ OPTION CHAIN ═══

    async function fetchExpiries(indexKey) {
        const data = await apiCall('/option/contract', `instrument_key=${encodeURIComponent(indexKey)}`);
        const expiries = [];
        const seen = new Set();
        for (const item of (data?.data || [])) {
            const exp = item.expiry;
            if (exp && !seen.has(exp)) { seen.add(exp); expiries.push(exp); }
        }
        const sorted = expiries.sort();
        debugLog('EXPIRIES', { index: indexKey, count: sorted.length, nearest: sorted[0], all: sorted.slice(0, 5) });
        return sorted;
    }

    async function fetchChain(indexKey, expiry) {
        const data = await apiCall('/option/chain',
            `instrument_key=${encodeURIComponent(indexKey)}&expiry_date=${expiry}`
        );
        const items = data?.data || [];
        debugLog('CHAIN_RAW', { index: indexKey, expiry, items: items.length, sample: items[0] ? Object.keys(items[0]) : [] });
        return items;
    }

    // Parse chain into structured data
    function parseChain(rawChain, spot) {
        const strikes = {};
        let totalCallOI = 0, totalPutOI = 0;

        for (const item of rawChain) {
            const strike = item.strike_price;
            if (!strike) continue;
            if (!strikes[strike]) strikes[strike] = {};

            if (item.call_options) {
                const c = item.call_options.market_data || item.call_options;
                strikes[strike].CE = {
                    ltp: c.ltp || c.last_price || 0,
                    bid: c.bid_price || c.ltp || 0,
                    ask: c.ask_price || c.ltp || 0,
                    oi: c.oi || 0,
                    iv: c.iv || null,
                    volume: c.volume || 0,
                    instrumentKey: item.call_options.instrument_key || null
                };
                totalCallOI += (c.oi || 0);
            }
            if (item.put_options) {
                const p = item.put_options.market_data || item.put_options;
                strikes[strike].PE = {
                    ltp: p.ltp || p.last_price || 0,
                    bid: p.bid_price || p.ltp || 0,
                    ask: p.ask_price || p.ltp || 0,
                    oi: p.oi || 0,
                    iv: p.iv || null,
                    volume: p.volume || 0,
                    instrumentKey: item.put_options.instrument_key || null
                };
                totalPutOI += (p.oi || 0);
            }
        }

        // Find ATM
        const allStrikes = Object.keys(strikes).map(Number).sort((a, b) => a - b);
        let atm = allStrikes[0];
        let minDist = Infinity;
        for (const s of allStrikes) {
            if (Math.abs(s - spot) < minDist) { minDist = Math.abs(s - spot); atm = s; }
        }

        // PCR
        const pcr = totalCallOI > 0 ? +(totalPutOI / totalCallOI).toFixed(2) : null;

        // Max Pain
        let maxPain = atm;
        let minPain = Infinity;
        for (const s of allStrikes) {
            let pain = 0;
            for (const s2 of allStrikes) {
                if (strikes[s2].CE) pain += Math.max(0, s - s2) * strikes[s2].CE.oi;
                if (strikes[s2].PE) pain += Math.max(0, s2 - s) * strikes[s2].PE.oi;
            }
            if (pain < minPain) { minPain = pain; maxPain = s; }
        }

        // Synthetic futures from ATM put-call parity
        const atmData = strikes[atm];
        let synthFutures = spot;
        if (atmData?.CE?.ltp && atmData?.PE?.ltp) {
            synthFutures = atm + (atmData.CE.ltp - atmData.PE.ltp);
        }
        const futuresPremium = spot > 0 ? +((synthFutures - spot) / spot * 100).toFixed(3) : 0;

        // ATM IV (from real LTPs)
        let atmIv = null;
        // Use chain-provided IV first
        if (atmData?.CE?.iv && atmData?.PE?.iv) {
            atmIv = (atmData.CE.iv + atmData.PE.iv) / 2;
        }
        // Fallback: calculate from real LTPs using Black-Scholes
        if (!atmIv && atmData?.CE?.ltp && atmData?.PE?.ltp && typeof BS !== 'undefined') {
            // Estimate DTE from typical weekly expiry (~7 calendar days)
            const T_est = 7 / 365;
            const ceIv = BS.impliedVol(spot, atm, atmData.CE.ltp, T_est, 'CE');
            const peIv = BS.impliedVol(spot, atm, atmData.PE.ltp, T_est, 'PE');
            if (ceIv && peIv) atmIv = ((ceIv + peIv) / 2) * 100; // store as percentage
            else if (ceIv) atmIv = ceIv * 100;
            else if (peIv) atmIv = peIv * 100;
            debugLog('ATM_IV_CALC', { method: 'BS_fallback', ceIv: ceIv?.toFixed(4), peIv: peIv?.toFixed(4), atmIv: atmIv?.toFixed(2) });
        }

        // OI Walls — highest concentration strikes
        let callWallStrike = atm, callWallOI = 0;
        let putWallStrike = atm, putWallOI = 0;
        for (const s of allStrikes) {
            if (strikes[s]?.CE?.oi > callWallOI) { callWallOI = strikes[s].CE.oi; callWallStrike = s; }
            if (strikes[s]?.PE?.oi > putWallOI) { putWallOI = strikes[s].PE.oi; putWallStrike = s; }
        }

        debugLog('CHAIN_PARSED', {
            spot, atm, strikeCount: allStrikes.length,
            strikeRange: allStrikes.length ? `${allStrikes[0]}-${allStrikes[allStrikes.length-1]}` : 'none',
            totalCallOI, totalPutOI, pcr, maxPain,
            synthFutures: +synthFutures.toFixed(2), futuresPremium,
            atmIv, atmCE_ltp: atmData?.CE?.ltp, atmPE_ltp: atmData?.PE?.ltp,
            callWall: `${callWallStrike} (${callWallOI})`, putWall: `${putWallStrike} (${putWallOI})`
        });

        return {
            strikes, allStrikes, atm,
            totalCallOI, totalPutOI, pcr,
            maxPain, synthFutures, futuresPremium,
            atmIv,
            callWallStrike, callWallOI, putWallStrike, putWallOI
        };
    }

    // ═══ TRADING DTE ═══

    function tradingDTE(expiryStr) {
        const expiry = new Date(expiryStr + 'T15:30:00+05:30');
        const now = new Date();
        let count = 0;
        const d = new Date(now);
        d.setHours(0, 0, 0, 0);
        const end = new Date(expiry);
        end.setHours(0, 0, 0, 0);
        while (d <= end) {
            const day = d.getDay();
            const dateStr = d.toISOString().split('T')[0];
            if (day !== 0 && day !== 6 && !NSE_HOLIDAYS.includes(dateStr)) {
                count++;
            }
            d.setDate(d.getDate() + 1);
        }
        return Math.max(1, count);
    }

    function calendarDTE(expiryStr) {
        const expiry = new Date(expiryStr + 'T15:30:00+05:30');
        const now = new Date();
        return Math.max(1, Math.ceil((expiry - now) / 86400000));
    }

    // Nearest expiry from list
    function nearestExpiry(expiries) {
        const now = new Date();
        now.setHours(0, 0, 0, 0);
        for (const e of expiries) {
            if (new Date(e) >= now) return e;
        }
        return expiries[expiries.length - 1];
    }

    // ═══ MARKET HOURS CHECK ═══

    function isMarketHours() {
        const now = new Date();
        const ist = new Date(now.toLocaleString('en-US', { timeZone: 'Asia/Kolkata' }));
        const h = ist.getHours(), m = ist.getMinutes();
        const mins = h * 60 + m;
        const day = ist.getDay();
        if (day === 0 || day === 6) return false;
        const dateStr = ist.toISOString().split('T')[0];
        if (NSE_HOLIDAYS.includes(dateStr)) return false;
        return mins >= 555 && mins <= 930; // 9:15 - 15:30
    }

    function minutesSinceOpen() {
        const now = new Date();
        const ist = new Date(now.toLocaleString('en-US', { timeZone: 'Asia/Kolkata' }));
        const h = ist.getHours(), m = ist.getMinutes();
        const mins = h * 60 + m;
        return Math.max(1, mins - 555); // minutes since 9:15
    }

    function istNow() {
        return new Date().toLocaleString('en-IN', {
            timeZone: 'Asia/Kolkata',
            hour: '2-digit', minute: '2-digit', hour12: true
        });
    }

    // ═══ BNF BREADTH — Top 5 constituents (79% of BNF weight) ═══
    // CRITICAL: Upstox sends NSE_EQ|{ISIN} but responds with NSE_EQ:{SYMBOL}
    // Must match by SYMBOL in response key, NOT by ISIN
    const BNF_CONSTITUENTS = [
        { name: 'HDFC Bank', symbol: 'HDFCBANK', isin: 'INE040A01034', weight: 0.28 },
        { name: 'ICICI Bank', symbol: 'ICICIBANK', isin: 'INE090A01021', weight: 0.22 },
        { name: 'Kotak Mah', symbol: 'KOTAKBANK', isin: 'INE237A01036', weight: 0.12 },
        { name: 'SBI', symbol: 'SBIN', isin: 'INE062A01020', weight: 0.09 },
        { name: 'Axis Bank', symbol: 'AXISBANK', isin: 'INE238A01034', weight: 0.08 }
    ];

    async function fetchBnfBreadth() {
        const keys = BNF_CONSTITUENTS.map(c => `NSE_EQ|${c.isin}`);
        const keysStr = keys.map(encodeURIComponent).join(',');
        try {
            const data = await apiCall('/market-quote/quotes', `instrument_key=${keysStr}`);
            const quotes = data?.data || {};
            const results = [];
            let advancing = 0, declining = 0, weightedPct = 0;

            for (const [key, val] of Object.entries(quotes)) {
                const change = val?.net_change || 0;
                // Match by SYMBOL in response key: "NSE_EQ:HDFCBANK"
                const symbol = key.split(':')[1] || '';
                const constituent = BNF_CONSTITUENTS.find(c => c.symbol === symbol);
                const weight = constituent?.weight || 0.05;
                const name = constituent?.name || symbol;
                const prevClose = val?.last_price && change ? val.last_price - change : val?.last_price;
                const pctChange = prevClose ? (change / prevClose * 100) : 0;

                results.push({ name, symbol, weight, change, pctChange: +pctChange.toFixed(2), ltp: val?.last_price });
                if (change > 0) { advancing++; weightedPct += weight * pctChange; }
                else if (change < 0) { declining++; weightedPct += weight * pctChange; }
            }

            // Sort by weight descending for display
            results.sort((a, b) => b.weight - a.weight);

            const unmatched = BNF_CONSTITUENTS.filter(c => !results.find(r => r.symbol === c.symbol));
            if (unmatched.length > 0) {
                debugLog('BNF_BREADTH_MISSING', { missing: unmatched.map(c => `${c.name}(${c.symbol})`) });
            }

            debugLog('BNF_BREADTH', { matched: results.length, advancing, declining, weightedPct: +weightedPct.toFixed(2), symbols: results.map(r => r.symbol) });
            return { results, advancing, declining, weightedPct: +weightedPct.toFixed(2), total: results.length };
        } catch (e) {
            debugLog('BNF_BREADTH_ERROR', { message: e.message });
            return null;
        }
    }

    // ═══ NF50 BREADTH — All 50 constituents ═══
    // PROVEN ISINs from v1 upstox.js — verified during market hours
    const NF50_CONSTITUENTS = [
        { sym: 'ADANIENT',   isin: 'INE423A01024' },
        { sym: 'ADANIPORTS', isin: 'INE742F01042' },
        { sym: 'APOLLOHOSP', isin: 'INE437A01024' },
        { sym: 'ASIANPAINT', isin: 'INE021A01026' },
        { sym: 'AXISBANK',   isin: 'INE238A01034' },
        { sym: 'BAJAJ-AUTO', isin: 'INE917I01010' },
        { sym: 'BAJFINANCE', isin: 'INE296A01032' },
        { sym: 'BAJAJFINSV', isin: 'INE918I01026' },
        { sym: 'BEL',        isin: 'INE263A01024' },
        { sym: 'BHARTIARTL', isin: 'INE397D01024' },
        { sym: 'CIPLA',      isin: 'INE059A01026' },
        { sym: 'COALINDIA',  isin: 'INE522F01014' },
        { sym: 'DRREDDY',    isin: 'INE089A01031' },
        { sym: 'EICHERMOT',  isin: 'INE066A01021' },
        { sym: 'ETERNAL',    isin: 'INE758T01015' },
        { sym: 'GRASIM',     isin: 'INE047A01021' },
        { sym: 'HCLTECH',    isin: 'INE860A01027' },
        { sym: 'HDFCBANK',   isin: 'INE040A01034' },
        { sym: 'HDFCLIFE',   isin: 'INE795G01014' },
        { sym: 'HINDALCO',   isin: 'INE038A01020' },
        { sym: 'HINDUNILVR', isin: 'INE030A01027' },
        { sym: 'ICICIBANK',  isin: 'INE090A01021' },
        { sym: 'ITC',        isin: 'INE154A01025' },
        { sym: 'INFY',       isin: 'INE009A01021' },
        { sym: 'INDIGO',     isin: 'INE646L01027' },
        { sym: 'JSWSTEEL',   isin: 'INE019A01038' },
        { sym: 'JIOFIN',     isin: 'INE758E01017' },
        { sym: 'KOTAKBANK',  isin: 'INE237A01036' },
        { sym: 'LT',         isin: 'INE018A01030' },
        { sym: 'M&M',        isin: 'INE101A01026' },
        { sym: 'MARUTI',     isin: 'INE585B01010' },
        { sym: 'MAXHEALTH',  isin: 'INE027H01010' },
        { sym: 'NTPC',       isin: 'INE733E01010' },
        { sym: 'NESTLEIND',  isin: 'INE239A01024' },
        { sym: 'ONGC',       isin: 'INE213A01029' },
        { sym: 'POWERGRID',  isin: 'INE752E01010' },
        { sym: 'RELIANCE',   isin: 'INE002A01018' },
        { sym: 'SBILIFE',    isin: 'INE123W01016' },
        { sym: 'SHRIRAMFIN', isin: 'INE721A01047' },
        { sym: 'SBIN',       isin: 'INE062A01020' },
        { sym: 'SUNPHARMA',  isin: 'INE044A01036' },
        { sym: 'TCS',        isin: 'INE467B01029' },
        { sym: 'TATACONSUM', isin: 'INE192A01025' },
        { sym: 'TMPV',       isin: 'INE155A01022' },
        { sym: 'TATASTEEL',  isin: 'INE081A01020' },
        { sym: 'TECHM',      isin: 'INE669C01036' },
        { sym: 'TITAN',      isin: 'INE280A01028' },
        { sym: 'TRENT',      isin: 'INE849A01020' },
        { sym: 'ULTRACEMCO', isin: 'INE481G01011' },
        { sym: 'WIPRO',      isin: 'INE075A01022' }
    ];

    async function fetchNf50Breadth() {
        const keys = NF50_CONSTITUENTS.map(c => `NSE_EQ|${c.isin}`);
        const keysStr = keys.map(encodeURIComponent).join(',');
        try {
            const data = await apiCall('/market-quote/quotes', `instrument_key=${keysStr}`);
            const quotes = data?.data || {};
            const matched = Object.keys(quotes).length;
            let advancing = 0, declining = 0;

            for (const [key, val] of Object.entries(quotes)) {
                const change = val?.net_change || 0;
                if (change > 0) advancing++;
                else if (change < 0) declining++;
            }

            const scaled = matched > 0 ? Math.round(advancing / matched * 50) : 0;

            if (matched < 50) {
                // Log which symbols responded vs which were sent
                const respondedSymbols = Object.keys(quotes).map(k => k.split(':')[1] || k);
                const sentSymbols = NF50_CONSTITUENTS.map(c => c.sym);
                const missing = sentSymbols.filter(s => !respondedSymbols.includes(s));
                debugLog('NF50_UNMATCHED', { sent: 50, received: matched, missing });
            }

            debugLog('NF50_BREADTH', { matched, advancing, declining, scaled });
            return { advancing, declining, matched, scaled, total: 50 };
        } catch (e) {
            debugLog('NF50_BREADTH_ERROR', { message: e.message });
            return null;
        }
    }

    // ═══ HISTORICAL OHLC — for Close Character calculation ═══
    async function fetchHistoricalOHLC(instrumentKey, date) {
        // Upstox historical candle: to_date must be day AFTER the date we want
        // URL format: /historical-candle/{key}/{interval}/{to_date}/{from_date}
        try {
            const encoded = encodeURIComponent(instrumentKey);
            // to_date = next day (Upstox range is exclusive on to_date)
            const d = new Date(date);
            d.setDate(d.getDate() + 1);
            const toDate = d.toISOString().split('T')[0];

            const data = await apiCall(`/historical-candle/${encoded}/day/${toDate}/${date}`);
            const candles = data?.data?.candles;
            if (!candles || candles.length === 0) {
                debugLog('OHLC_EMPTY', { instrumentKey, date, toDate, rawDataKeys: Object.keys(data?.data || {}) });
                return null;
            }
            // Candle format: [timestamp, open, high, low, close, volume, oi]
            const c = candles[0];
            const result = { open: c[1], high: c[2], low: c[3], close: c[4], volume: c[5] };
            debugLog('OHLC_OK', { instrumentKey, date, ...result });
            return result;
        } catch (e) {
            debugLog('OHLC_ERROR', { instrumentKey, date, message: e.message });
            return null;
        }
    }

    // Calculate Close Character from OHLC
    // Returns -2 to +2: where did the market close within its daily range?
    function calcCloseChar(ohlc) {
        if (!ohlc || !ohlc.high || !ohlc.low || ohlc.high === ohlc.low) return 0;
        const range = ohlc.high - ohlc.low;
        const position = (ohlc.close - ohlc.low) / range;
        if (position > 0.8) return 2;   // strong close near high
        if (position > 0.6) return 1;   // bullish close
        if (position > 0.4) return 0;   // neutral mid-range
        if (position > 0.2) return -1;  // bearish close
        return -2;                       // weak close near low
    }

    // Classify gap type from yesterday close to today open
    function classifyGap(todayOpen, yesterdayClose, vix) {
        if (!todayOpen || !yesterdayClose || !vix) return { type: 'UNKNOWN', pct: 0, sigma: 0 };
        const gap = todayOpen - yesterdayClose;
        const pct = (gap / yesterdayClose) * 100;
        const dailySigma = yesterdayClose * (vix / 100) * Math.sqrt(1 / 252);
        const sigma = dailySigma > 0 ? gap / dailySigma : 0;

        let type = 'FLAT';
        if (Math.abs(sigma) > 1) type = gap > 0 ? 'GAP_UP' : 'GAP_DOWN';
        else if (Math.abs(sigma) > 0.3) type = gap > 0 ? 'MILD_GAP_UP' : 'MILD_GAP_DOWN';

        return { type, gap: Math.round(gap), pct: +pct.toFixed(2), sigma: +sigma.toFixed(2) };
    }

    // Expose debug on window
    window._API_DEBUG = _debug;

    return {
        fetchSpots, fetchExpiries, fetchChain, parseChain,
        fetchBnfBreadth, fetchNf50Breadth, BNF_CONSTITUENTS,
        fetchHistoricalOHLC, calcCloseChar, classifyGap,
        tradingDTE, calendarDTE, nearestExpiry,
        isMarketHours, minutesSinceOpen, istNow,
        getToken, setToken,
        NF_KEY, BNF_KEY, NSE_HOLIDAYS
    };
})();
