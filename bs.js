/* ═══════════════════════════════════════════════════════════════
   Market Radar v2 — Black-Scholes Engine
   Purpose: IV from LTP, expected move (σ), delta, theta
   All calibrations from 274 NF + 134 BNF observations — DO NOT CHANGE
   ═══════════════════════════════════════════════════════════════ */

const BS = (() => {
    const DAYS_PER_YEAR = 252; // trading days
    const MINUTES_PER_DAY = 375; // 9:15 - 15:30 IST
    const RISK_FREE = 0.07; // ~7% India

    // Standard normal CDF (Abramowitz & Stegun approximation)
    function normCDF(x) {
        if (x > 6) return 1;
        if (x < -6) return 0;
        const a1 = 0.254829592, a2 = -0.284496736, a3 = 1.421413741;
        const a4 = -1.453152027, a5 = 1.061405429, p = 0.3275911;
        const sign = x < 0 ? -1 : 1;
        const t = 1 / (1 + p * Math.abs(x));
        const y = 1 - (((((a5 * t + a4) * t) + a3) * t + a2) * t + a1) * t * Math.exp(-x * x / 2);
        return 0.5 * (1 + sign * y);
    }

    // Standard normal PDF
    function normPDF(x) {
        return Math.exp(-x * x / 2) / Math.sqrt(2 * Math.PI);
    }

    // d1, d2 components
    function d1d2(S, K, T, r, sigma) {
        const sqrtT = Math.sqrt(T);
        const d1 = (Math.log(S / K) + (r + sigma * sigma / 2) * T) / (sigma * sqrtT);
        const d2 = d1 - sigma * sqrtT;
        return { d1, d2, sqrtT };
    }

    // BS option price
    function price(S, K, T, r, sigma, type) {
        if (T <= 0) return Math.max(0, type === 'CE' ? S - K : K - S);
        const { d1, d2 } = d1d2(S, K, T, r, sigma);
        if (type === 'CE') {
            return S * normCDF(d1) - K * Math.exp(-r * T) * normCDF(d2);
        } else {
            return K * Math.exp(-r * T) * normCDF(-d2) - S * normCDF(-d1);
        }
    }

    // Implied Volatility via Newton-Raphson
    function impliedVol(S, K, marketPrice, T, type) {
        if (T <= 0 || marketPrice <= 0) return null;
        const intrinsic = type === 'CE' ? Math.max(0, S - K) : Math.max(0, K - S);
        if (marketPrice < intrinsic * 0.95) return null;

        let sigma = 0.25; // initial guess
        for (let i = 0; i < 50; i++) {
            const p = price(S, K, T, RISK_FREE, sigma, type);
            const { d1, sqrtT } = d1d2(S, K, T, RISK_FREE, sigma);
            const vega = S * normPDF(d1) * sqrtT;
            if (vega < 1e-10) break;
            const diff = p - marketPrice;
            if (Math.abs(diff) < 0.01) break;
            sigma -= diff / vega;
            if (sigma <= 0.01) sigma = 0.01;
            if (sigma > 3) sigma = 3;
        }
        return sigma > 0.01 && sigma < 3 ? sigma : null;
    }

    // Delta
    function delta(S, K, T, sigma, type) {
        if (T <= 0 || !sigma) return type === 'CE' ? (S > K ? 1 : 0) : (S < K ? -1 : 0);
        const { d1 } = d1d2(S, K, T, RISK_FREE, sigma);
        return type === 'CE' ? normCDF(d1) : normCDF(d1) - 1;
    }

    // Theta (per day, in price units)
    function theta(S, K, T, sigma, type) {
        if (T <= 0 || !sigma) return 0;
        const { d1, d2, sqrtT } = d1d2(S, K, T, RISK_FREE, sigma);
        const term1 = -(S * normPDF(d1) * sigma) / (2 * sqrtT);
        if (type === 'CE') {
            return (term1 - RISK_FREE * K * Math.exp(-RISK_FREE * T) * normCDF(d2)) / DAYS_PER_YEAR;
        } else {
            return (term1 + RISK_FREE * K * Math.exp(-RISK_FREE * T) * normCDF(-d2)) / DAYS_PER_YEAR;
        }
    }

    // ═══ SIGMA ENGINE — the core of v2 ═══

    // Daily 1σ expected move from VIX
    function dailySigma(spot, vix) {
        return spot * (vix / 100) * Math.sqrt(1 / DAYS_PER_YEAR);
    }

    // σ for any time window (in minutes)
    function sigmaMins(spot, vix, minutes) {
        const daily = dailySigma(spot, vix);
        return daily * Math.sqrt(minutes / MINUTES_PER_DAY);
    }

    // σ for N trading days
    function sigmaDays(spot, vix, days) {
        return dailySigma(spot, vix) * Math.sqrt(days);
    }

    // How many σ has spot moved? (relative to expected for elapsed time)
    function sigmaScore(currentSpot, baselineSpot, vix, elapsedMinutes) {
        const expectedSigma = sigmaMins(baselineSpot, vix, elapsedMinutes);
        if (expectedSigma < 0.01) return 0;
        return (currentSpot - baselineSpot) / expectedSigma;
    }

    // VIX σ — how many σ has VIX itself moved?
    // VIX daily σ ≈ VIX × 0.05 (empirical — VIX moves ~5% of itself per day)
    function vixSigmaScore(currentVix, baselineVix, elapsedMinutes) {
        const dailyVixSigma = baselineVix * 0.05;
        const expectedSigma = dailyVixSigma * Math.sqrt(elapsedMinutes / MINUTES_PER_DAY);
        if (expectedSigma < 0.01) return 0;
        return (currentVix - baselineVix) / expectedSigma;
    }

    // IV percentile from historical data array
    function ivPercentile(currentVix, historicalVixArray) {
        if (!historicalVixArray || historicalVixArray.length < 5) return null;
        const below = historicalVixArray.filter(v => v <= currentVix).length;
        return Math.round((below / historicalVixArray.length) * 100);
    }

    // Probability of profit for a spread (using delta of short strike)
    function probProfit(S, sellStrike, T, sigma, type) {
        if (!sigma || T <= 0) return 0.5;
        const d = Math.abs(delta(S, sellStrike, T, sigma, type));
        // For credit spread: P(profit) = 1 - |delta of sold option|
        // For debit spread: P(profit) = |delta of bought option|
        return d;
    }

    return {
        price, impliedVol, delta, theta, normCDF, normPDF,
        dailySigma, sigmaMins, sigmaDays, sigmaScore, vixSigmaScore,
        ivPercentile, probProfit,
        DAYS_PER_YEAR, MINUTES_PER_DAY, RISK_FREE
    };
})();

if (typeof module !== 'undefined') module.exports = BS;
