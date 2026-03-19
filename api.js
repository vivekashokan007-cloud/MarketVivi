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
        // Use chain-provided IV first, fall back to BS calculation
        if (atmData?.CE?.iv && atmData?.PE?.iv) {
            atmIv = (atmData.CE.iv + atmData.PE.iv) / 2;
        }

        debugLog('CHAIN_PARSED', {
            spot, atm, strikeCount: allStrikes.length,
            strikeRange: allStrikes.length ? `${allStrikes[0]}-${allStrikes[allStrikes.length-1]}` : 'none',
            totalCallOI, totalPutOI, pcr, maxPain,
            synthFutures: +synthFutures.toFixed(2), futuresPremium,
            atmIv, atmCE_ltp: atmData?.CE?.ltp, atmPE_ltp: atmData?.PE?.ltp
        });

        return {
            strikes, allStrikes, atm,
            totalCallOI, totalPutOI, pcr,
            maxPain, synthFutures, futuresPremium,
            atmIv
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

    // Expose debug on window — type window._API_DEBUG in console
    window._API_DEBUG = _debug;

    return {
        fetchSpots, fetchExpiries, fetchChain, parseChain,
        tradingDTE, calendarDTE, nearestExpiry,
        isMarketHours, minutesSinceOpen, istNow,
        getToken, setToken,
        NF_KEY, BNF_KEY, NSE_HOLIDAYS
    };
})();
