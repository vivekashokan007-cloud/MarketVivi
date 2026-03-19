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
        const result = { nfSpot: null, bnfSpot: null, vix: null, timestamp: Date.now() };

        debugLog('SPOTS_RAW_KEYS', { keys: Object.keys(quotes) });

        for (const [key, val] of Object.entries(quotes)) {
            const ltp = val?.last_price;
            if (key.includes('Nifty 50') && !key.includes('Bank')) result.nfSpot = ltp;
            else if (key.includes('Nifty Bank')) result.bnfSpot = ltp;
            else if (key.includes('VIX')) result.vix = ltp;
        }

        debugLog('SPOTS_PARSED', { nf: result.nfSpot, bnf: result.bnfSpot, vix: result.vix });
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
    const BNF_CONSTITUENTS = [
        { name: 'HDFC Bank', isin: 'INE040A01034', weight: 0.28 },
        { name: 'ICICI Bank', isin: 'INE090A01021', weight: 0.22 },
        { name: 'Kotak Mah', isin: 'INE237A01028', weight: 0.12 },
        { name: 'SBI', isin: 'INE062A01020', weight: 0.09 },
        { name: 'Axis Bank', isin: 'INE238A01034', weight: 0.08 }
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
                // Match back to constituent by checking ISIN in key
                const constituent = BNF_CONSTITUENTS.find(c => key.includes(c.isin) || key.includes(c.name.split(' ')[0].toUpperCase()));
                const weight = constituent?.weight || 0.05;
                const name = constituent?.name || key;
                const pctChange = val?.last_price ? (change / (val.last_price - change) * 100) : 0;

                results.push({ name, weight, change, pctChange: +pctChange.toFixed(2), ltp: val?.last_price });
                if (change > 0) { advancing++; weightedPct += weight * pctChange; }
                else if (change < 0) { declining++; weightedPct += weight * pctChange; }
            }

            debugLog('BNF_BREADTH', { matched: results.length, advancing, declining, weightedPct: +weightedPct.toFixed(2) });
            return { results, advancing, declining, weightedPct: +weightedPct.toFixed(2), total: results.length };
        } catch (e) {
            debugLog('BNF_BREADTH_ERROR', { message: e.message });
            return null;
        }
    }

    // ═══ NF50 BREADTH — All 50 constituents ═══
    // ISINs from official NSE niftyindices.com CSV
    const NF50_ISINS = [
        'INE002A01018','INE009A01021','INE040A01034','INE090A01021','INE154A01025',
        'INE176A01028','INE180A01020','INE185A01028','INE237A01028','INE238A01034',
        'INE062A01020','INE034A01023','INE019A01038','INE047A01021','INE066F01020',
        'INE397D01024','INE467B01029','INE028A01039','INE669E01016','INE101A01026',
        'INE121A01024','INE152A01029','INE160A01022','INE208A01029','INE213A01029',
        'INE216A01030','INE226A01021','INE256A01028','INE296A01024','INE361B01024',
        'INE376G01013','INE437A01024','INE438A01022','INE457A01014','INE528G01035',
        'INE585B01010','INE628A01036','INE669C01036','INE685A01028','INE691A01018',
        'INE721A01013','INE742F01042','INE758T01015','INE775A01035','INE848E01016',
        'INE860A01027','INE917I01010','INE934A01020','INE976A01021','INE030A01027'
    ];

    async function fetchNf50Breadth() {
        const keys = NF50_ISINS.map(isin => `NSE_EQ|${isin}`);
        const keysStr = keys.map(encodeURIComponent).join(',');
        try {
            const data = await apiCall('/market-quote/quotes', `instrument_key=${keysStr}`);
            const quotes = data?.data || {};
            const matched = Object.keys(quotes).length;
            let advancing = 0;
            for (const val of Object.values(quotes)) {
                if ((val?.net_change || 0) > 0) advancing++;
            }
            const scaled = matched > 0 ? Math.round(advancing / matched * 50) : 0;
            debugLog('NF50_BREADTH', { matched, advancing, scaled });
            return { advancing, matched, scaled, total: 50 };
        } catch (e) {
            debugLog('NF50_BREADTH_ERROR', { message: e.message });
            return null;
        }
    }

    // Expose debug on window — type window._API_DEBUG in console
    window._API_DEBUG = _debug;

    return {
        fetchSpots, fetchExpiries, fetchChain, parseChain,
        fetchBnfBreadth, fetchNf50Breadth, BNF_CONSTITUENTS,
        tradingDTE, calendarDTE, nearestExpiry,
        isMarketHours, minutesSinceOpen, istNow,
        getToken, setToken,
        NF_KEY, BNF_KEY, NSE_HOLIDAYS
    };
})();
