/* ═══════════════════════════════════════════════════════════════
   Market Radar v2 — Date Utilities (post-F.2)
   All Upstox API access moved to Kotlin (NativeBridge.* getters).
   This file kept ONLY for date/time utilities consumed by render code.
   ═══════════════════════════════════════════════════════════════ */

const API = (() => {
    // NSE Holidays 2026 — source NSE/CMTR/71775 Dec 12 2025. DO NOT CHANGE.
    const NSE_HOLIDAYS = [
        '2026-01-26', '2026-03-03', '2026-03-26', '2026-03-31',
        '2026-04-03', '2026-04-14', '2026-05-01', '2026-05-28',
        '2026-06-26', '2026-09-14', '2026-10-02', '2026-10-20',
        '2026-11-10', '2026-11-24', '2026-12-25'
    ];

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
            const dateStr = dateToIST(d);
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
        const dateStr = todayIST();
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

    // IST date as YYYY-MM-DD — safe for holiday checks, DTE, poll keys
    // Fixes: toISOString().split('T')[0] gives UTC, wrong after 6:30 PM IST
    function todayIST() {
        return new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
    }
    function dateToIST(d) {
        return d.toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
    }

    return {
        tradingDTE, calendarDTE, nearestExpiry,
        isMarketHours, minutesSinceOpen, istNow, todayIST, dateToIST,
        NSE_HOLIDAYS
    };
})();
