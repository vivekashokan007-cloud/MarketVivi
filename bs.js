/* ============================================================
   bs.js — Black-Scholes Engine for Market Radar v5.0
   Calibrated coefficients — do NOT change without new data
   ============================================================ */

// ── Standard Normal CDF (Abramowitz & Stegun approximation) ──
function normCDF(x) {
  const a1 = 0.254829592, a2 = -0.284496736, a3 = 1.421413741;
  const a4 = -1.453152027, a5 = 1.061405429, p = 0.3275911;
  const sign = x < 0 ? -1 : 1;
  x = Math.abs(x) / Math.SQRT2;
  const t = 1.0 / (1.0 + p * x);
  const y = 1.0 - (((((a5 * t + a4) * t) + a3) * t + a2) * t + a1) * t * Math.exp(-x * x);
  return 0.5 * (1.0 + sign * y);
}

function normPDF(x) {
  return Math.exp(-0.5 * x * x) / Math.sqrt(2 * Math.PI);
}

// ── Core BS pricing ──
function bsCall(S, K, r, sigma, T) {
  if (T <= 0 || sigma <= 0) return Math.max(S - K, 0);
  const d1 = (Math.log(S / K) + (r + 0.5 * sigma * sigma) * T) / (sigma * Math.sqrt(T));
  const d2 = d1 - sigma * Math.sqrt(T);
  return S * normCDF(d1) - K * Math.exp(-r * T) * normCDF(d2);
}

function bsPut(S, K, r, sigma, T) {
  if (T <= 0 || sigma <= 0) return Math.max(K - S, 0);
  const d1 = (Math.log(S / K) + (r + 0.5 * sigma * sigma) * T) / (sigma * Math.sqrt(T));
  const d2 = d1 - sigma * Math.sqrt(T);
  return K * Math.exp(-r * T) * normCDF(-d2) - S * normCDF(-d1);
}

// ── Greeks ──
function bsDelta(S, K, r, sigma, T, isCall) {
  if (T <= 0 || sigma <= 0) {
    return isCall ? (S > K ? 1 : 0) : (S < K ? -1 : 0);
  }
  const d1 = (Math.log(S / K) + (r + 0.5 * sigma * sigma) * T) / (sigma * Math.sqrt(T));
  return isCall ? normCDF(d1) : normCDF(d1) - 1;
}

function bsGamma(S, K, r, sigma, T) {
  if (T <= 0 || sigma <= 0) return 0;
  const d1 = (Math.log(S / K) + (r + 0.5 * sigma * sigma) * T) / (sigma * Math.sqrt(T));
  return normPDF(d1) / (S * sigma * Math.sqrt(T));
}

function bsTheta(S, K, r, sigma, T, isCall) {
  if (T <= 0 || sigma <= 0) return 0;
  const d1 = (Math.log(S / K) + (r + 0.5 * sigma * sigma) * T) / (sigma * Math.sqrt(T));
  const d2 = d1 - sigma * Math.sqrt(T);
  const part1 = -(S * normPDF(d1) * sigma) / (2 * Math.sqrt(T));
  if (isCall) {
    return (part1 - r * K * Math.exp(-r * T) * normCDF(d2)) / 365;
  }
  return (part1 + r * K * Math.exp(-r * T) * normCDF(-d2)) / 365;
}

function bsVega(S, K, r, sigma, T) {
  if (T <= 0 || sigma <= 0) return 0;
  const d1 = (Math.log(S / K) + (r + 0.5 * sigma * sigma) * T) / (sigma * Math.sqrt(T));
  return S * normPDF(d1) * Math.sqrt(T) / 100;
}

// ── IV solver (Newton-Raphson) ──
function bsIV(mktPrice, S, K, r, T, isCall) {
  if (T <= 0 || mktPrice <= 0) return null;
  let sigma = 0.20; // initial guess
  for (let i = 0; i < 100; i++) {
    const price = isCall ? bsCall(S, K, r, sigma, T) : bsPut(S, K, r, sigma, T);
    const vega = bsVega(S, K, r, sigma, T) * 100; // undo /100
    if (Math.abs(vega) < 1e-10) break;
    const diff = price - mktPrice;
    if (Math.abs(diff) < 0.01) return sigma;
    sigma -= diff / vega;
    if (sigma <= 0.001) sigma = 0.001;
    if (sigma > 5) sigma = 5;
  }
  return sigma;
}

// ── Expected Move (uses TRADING days ÷ 252, not calendar ÷ 365) ──
// VIX is annualized over ~252 trading days, so conversion must match
function bsExpectedMove(spot, vix, tradingDte) {
  const t = tradingDte / 252;
  const one_sigma = spot * (vix / 100) * Math.sqrt(t);
  return { one_sigma, two_sigma: one_sigma * 2 };
}

// ── Target Delta based on VIX and score ──
function bsTargetDelta(vix, score, isCall) {
  // Base target: 0.15 delta (15-delta strikes)
  let target = 0.15;
  // High VIX → move further OTM (lower delta)
  if (vix > 20) target = 0.10;
  else if (vix > 16) target = 0.12;
  // Strong directional score → adjust delta
  if (isCall && score > 0.4) target *= 0.8;  // bullish: calls safer, go wider
  if (!isCall && score < -0.4) target *= 0.8; // bearish: puts safer, go wider
  return target;
}

// ── IV Skew Adjustment ──
// Calibrated coefficients for skew modeling
const BS_SKEW_COEFFS = {
  putSlope:  0.0012,  // IV increases per 1% OTM for puts
  callSlope: 0.0008,  // IV increases per 1% OTM for calls
  baseSmile: 0.02     // Minimum smile curvature
};

function bsSkewIV(vix, strike, spot, isCall) {
  const moneyness = Math.abs(strike - spot) / spot;
  const baseIV = vix / 100;
  if (isCall) {
    return baseIV + moneyness * BS_SKEW_COEFFS.callSlope * 100 + BS_SKEW_COEFFS.baseSmile * moneyness;
  }
  return baseIV + moneyness * BS_SKEW_COEFFS.putSlope * 100 + BS_SKEW_COEFFS.baseSmile * moneyness;
}

// ── Full BS Analysis ──
function bsAnalyse(spot, vix, r, dte, spots, isNF, score) {
  const T = dte / 365;
  const sigma = vix / 100;
  const em = bsExpectedMove(spot, vix, dte);
  const snap = isNF ? r50 : r100;

  // Delta-based strikes
  const targetPutDelta = bsTargetDelta(vix, score, false);
  const targetCallDelta = bsTargetDelta(vix, score, true);

  // Find strikes at target delta via search
  let putStrike = spot, callStrike = spot;
  const step = isNF ? 50 : 100;

  for (let k = spot - step; k > spot - em.two_sigma * 1.5; k -= step) {
    const d = Math.abs(bsDelta(spot, k, r, sigma, T, false));
    if (d <= targetPutDelta) { putStrike = k; break; }
  }
  for (let k = spot + step; k < spot + em.two_sigma * 1.5; k += step) {
    const d = Math.abs(bsDelta(spot, k, r, sigma, T, true));
    if (d <= targetCallDelta) { callStrike = k; break; }
  }

  // IV surface for nearby strikes
  const ivSurface = [];
  const range = isNF ? 500 : 1500;
  for (let k = snap(spot - range); k <= snap(spot + range); k += step) {
    ivSurface.push({
      strike: k,
      callIV: bsSkewIV(vix, k, spot, true),
      putIV: bsSkewIV(vix, k, spot, false),
      callDelta: bsDelta(spot, k, r, sigma, T, true),
      putDelta: bsDelta(spot, k, r, sigma, T, false),
      callPrice: bsCall(spot, k, r, sigma, T),
      putPrice: bsPut(spot, k, r, sigma, T)
    });
  }

  return {
    spot, vix, dte, T,
    expectedMove: em,
    putStrike: snap(putStrike),
    callStrike: snap(callStrike),
    targetPutDelta, targetCallDelta,
    ivSurface
  };
}

// ── Historical spots accessor ──
function bsGetSpots(isNF) {
  return isNF ? (window._NF_HIST || []) : (window._BNF_HIST || []);
}

console.log('[bs.js] Black-Scholes engine loaded — v5.0');
