// ═══ BS ENGINE — Black-Scholes utilities for Market Radar v2.1 ═══
// IV from LTP (Newton-Raphson), delta, theta, expected moves, sigma scores
// Fallback when Upstox chain greeks are unavailable

const BS = (() => {
    const DAYS_PER_YEAR = 252;
    const RATE = 0.07; // risk-free rate (India ~7%)

    // Standard normal CDF approximation (Abramowitz & Stegun)
    function normCDF(x) {
        if (x > 10) return 1;
        if (x < -10) return 0;
        const a1 = 0.254829592, a2 = -0.284496736, a3 = 1.421413741;
        const a4 = -1.453152027, a5 = 1.061405429, p = 0.3275911;
        const sign = x < 0 ? -1 : 1;
        x = Math.abs(x);
        const t = 1.0 / (1.0 + p * x);
        const y = 1.0 - (((((a5 * t + a4) * t) + a3) * t + a2) * t + a1) * t * Math.exp(-x * x / 2);
        return 0.5 * (1.0 + sign * y);
    }

    // Standard normal PDF
    function normPDF(x) {
        return Math.exp(-0.5 * x * x) / Math.sqrt(2 * Math.PI);
    }

    // d1 and d2 for Black-Scholes
    function d1d2(spot, strike, T, vol) {
        if (T <= 0 || vol <= 0 || spot <= 0 || strike <= 0) return { d1: 0, d2: 0 };
        const d1 = (Math.log(spot / strike) + (RATE + 0.5 * vol * vol) * T) / (vol * Math.sqrt(T));
        const d2 = d1 - vol * Math.sqrt(T);
        return { d1, d2 };
    }

    // Black-Scholes option price
    function bsPrice(spot, strike, T, vol, type) {
        if (T <= 0) return Math.max(0, type === 'CE' ? spot - strike : strike - spot);
        const { d1, d2 } = d1d2(spot, strike, T, vol);
        const disc = Math.exp(-RATE * T);
        if (type === 'CE') {
            return spot * normCDF(d1) - strike * disc * normCDF(d2);
        } else {
            return strike * disc * normCDF(-d2) - spot * normCDF(-d1);
        }
    }

    // Delta: probability-weighted direction
    function delta(spot, strike, T, vol, type) {
        if (T <= 0) {
            if (type === 'CE') return spot > strike ? 1 : 0;
            if (type === 'PE') return spot < strike ? -1 : 0;
        }
        if (vol <= 0) vol = 0.15;
        const { d1 } = d1d2(spot, strike, T, vol);
        if (type === 'CE') return normCDF(d1);
        if (type === 'PE') return normCDF(d1) - 1;
        return 0;
    }

    // Theta: time decay per calendar day (options decay 365 days, not just 252 trading days)
    function theta(spot, strike, T, vol, type) {
        if (T <= 0 || vol <= 0) return 0;
        const { d1, d2 } = d1d2(spot, strike, T, vol);
        const sqrtT = Math.sqrt(T);
        const common = -(spot * normPDF(d1) * vol) / (2 * sqrtT);
        const disc = Math.exp(-RATE * T);
        if (type === 'CE') {
            return (common - RATE * strike * disc * normCDF(d2)) / 365;  // Gemini fix: calendar days
        } else {
            return (common + RATE * strike * disc * normCDF(-d2)) / 365;  // Gemini fix: calendar days
        }
    }

    // Implied Volatility via Newton-Raphson
    function impliedVol(spot, strike, T, price, type, maxIter = 50) {
        if (T <= 0 || price <= 0) return null;
        let vol = 0.25; // initial guess
        for (let i = 0; i < maxIter; i++) {
            const p = bsPrice(spot, strike, T, vol, type);
            const { d1 } = d1d2(spot, strike, T, vol);
            const vega = spot * normPDF(d1) * Math.sqrt(T);
            if (vega < 0.001) break;
            const diff = p - price;
            vol -= diff / vega;
            if (vol <= 0.01) vol = 0.01;
            if (vol > 5) vol = 5;
            if (Math.abs(diff) < 0.01) break;
        }
        return vol > 0.01 && vol < 5 ? vol : null;
    }

    // Expected move: daily 1σ from VIX
    function dailySigma(spot, vix) {
        return spot * (vix / 100) * Math.sqrt(1 / DAYS_PER_YEAR);
    }

    // Expected move: σ for N minutes
    function sigmaMins(spot, vix, mins) {
        return dailySigma(spot, vix) * Math.sqrt(mins / 375);
    }

    // Expected move: σ for N days
    function sigmaDays(spot, vix, days) {
        return dailySigma(spot, vix) * Math.sqrt(days);
    }

    // Sigma Score: how many σ has spot moved for elapsed time
    // Gemini fix: move from prevClose spans overnight gap.
    // Use dailySigma (full day expected move), not sigmaMins (intraday only).
    // This prevents absurd 12σ scores from normal overnight gaps.
    function sigmaScore(spot, prevClose, vix, mins) {
        if (!prevClose || !vix) return 0;
        const move = spot - prevClose;
        const expected = dailySigma(spot, vix);  // Full day σ, not intraday minutes
        return expected > 0 ? move / expected : 0;
    }

    // VIX Sigma Score: how unusual is today's VIX move
    // VIX daily σ ≈ VIX × 0.05 (empirical)
    // Gemini fix: accepts mins parameter to scale expected move for intraday
    // Clamped: first 60 min uses full-day σ (overnight VIX gap is normal)
    function vixSigmaScore(vix, prevVix, mins) {
        if (!prevVix || prevVix <= 0) return 0;
        const vixDailyStd = prevVix * 0.05;
        // Scale by intraday time — but floor at 0.5 to prevent opening gap absurdity
        const timeFactor = (mins && mins > 60) ? Math.max(0.5, Math.sqrt(mins / 375)) : 1;
        const scaledStd = vixDailyStd * timeFactor;
        return scaledStd > 0 ? (vix - prevVix) / scaledStd : 0;
    }

    // IV Percentile: where is current VIX relative to history
    function ivPercentile(vix, history) {
        if (!history || history.length < 5) return 50;
        const sorted = [...history].sort((a, b) => a - b);
        const below = sorted.filter(v => v <= vix).length;
        return Math.round((below / sorted.length) * 100);
    }

    return {
        DAYS_PER_YEAR,
        RATE,
        normCDF,
        normPDF,
        bsPrice,
        delta,
        theta,
        impliedVol,
        dailySigma,
        sigmaMins,
        sigmaDays,
        sigmaScore,
        vixSigmaScore,
        ivPercentile
    };
})();
