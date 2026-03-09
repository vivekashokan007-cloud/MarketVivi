// ══════════════════════════════════════════════════════════════
// bs.js — Black-Scholes Engine + Bollinger Bands
// Market Radar v3.2  |  STANDALONE — no app.js / bhav.js deps
//
// FUNCTIONS (all pure — same input → same output always)
// ──────────────────────────────────────────────────────
// bsCall(S,K,r,sigma,T)           → call price
// bsPut(S,K,r,sigma,T)            → put price
// bsDelta(S,K,r,sigma,T,isCall)   → delta
// bsIV(mktPrice,S,K,r,T,isCall)   → implied vol (Newton-Raphson)
// bsExpectedMove(spot,vix,dte)    → {daily, one_sigma, two_sigma}
// bsStrikeByDelta(...)            → strike at target delta
// bsBollingerBands(spots,period,mult) → {upper,lower,mid,...}
// bsAnalyse(spot,vix,r,dte,spots,isNF) → master result object
// bsGetSpots(isNF)                → spot array from localStorage
// bsSummaryLine(analysis)         → single display string
// ══════════════════════════════════════════════════════════════

'use strict';

const BS_RISK_FREE_DEFAULT = 0.065;
const BS_SQRT2    = Math.SQRT2;
const BS_SQRT252  = Math.sqrt(252);
const BS_NF_STEP  = 50;
const BS_BNF_STEP = 100;
const BB_PERIOD   = 20;
const BB_MULT     = 2.0;

// ── Normal CDF — A&S 26.2.17 via erf relationship ─────────────
// N(x) = 0.5 * (1 + erf(x/√2))
// erf approximated by A&S: max error 7.5e-8
// ── Adaptive Delta ──────────────────────────────────────────────────────────
// VIX high → lower Δ → wider strikes (fat premiums far OTM, stay safe)
// VIX low  → higher Δ → closer strikes (come in to collect credit)
// Score: bull → widen call (lower callΔ), tighten put (higher putΔ)
//        bear → widen put  (lower putΔ),  tighten call (higher callΔ)
function bsTargetDelta(vix, score, isCall) {
  const base = vix < 12 ? 0.30
             : vix < 14 ? 0.25
             : vix < 16 ? 0.20
             : vix < 20 ? 0.15
             : vix < 24 ? 0.12
             : vix < 28 ? 0.10
             :             0.08;
  const s   = Math.max(-1, Math.min(1, score || 0));
  const adj = Math.abs(s) > 0.25 ? 0.03 : Math.abs(s) > 0.10 ? 0.02 : 0;
  const dir = s > 0 ? 1 : (s < 0 ? -1 : 0);
  const raw = isCall ? base - dir*adj : base + dir*adj;
  return Math.max(0.05, Math.min(0.40, raw));
}

function _normCDF(x) {
  const u = Math.abs(x) / BS_SQRT2;          // erf input = x/√2
  const t = 1 / (1 + 0.3275911 * u);
  const t2=t*t, t3=t2*t, t4=t3*t, t5=t4*t;
  const erfc = (0.254829592*t - 0.284496736*t2 + 1.421413741*t3
              - 1.453152027*t4 + 1.061405429*t5) * Math.exp(-u * u);
  const erfVal = 1 - erfc;                    // erf(x/√2)
  return x >= 0 ? 0.5*(1 + erfVal) : 0.5*(1 - erfVal);
}

// Standard normal PDF
function _normPDF(x) {
  return Math.exp(-x*x/2) / Math.sqrt(2*Math.PI);
}

// ── BS d1 / d2 ────────────────────────────────────────────────
function _d1(S,K,r,sigma,T) {
  if (T<=0||sigma<=0||S<=0||K<=0) return 0;
  return (Math.log(S/K) + (r + 0.5*sigma*sigma)*T) / (sigma*Math.sqrt(T));
}
function _d2(d1v,sigma,T) { return d1v - sigma*Math.sqrt(T); }

// ── Option prices ─────────────────────────────────────────────
function bsCall(S,K,r,sigma,T) {
  if (T<=0) return Math.max(0, S-K);
  const d1v=_d1(S,K,r,sigma,T), d2v=_d2(d1v,sigma,T);
  return S*_normCDF(d1v) - K*Math.exp(-r*T)*_normCDF(d2v);
}

function bsPut(S,K,r,sigma,T) {
  if (T<=0) return Math.max(0, K-S);
  const d1v=_d1(S,K,r,sigma,T), d2v=_d2(d1v,sigma,T);
  return K*Math.exp(-r*T)*_normCDF(-d2v) - S*_normCDF(-d1v);
}

// ── Greeks ────────────────────────────────────────────────────
function bsDelta(S,K,r,sigma,T,isCall) {
  if (T<=0) return isCall ? (S>K?1:0) : (S<K?-1:0);
  const d1v=_d1(S,K,r,sigma,T);
  return isCall ? _normCDF(d1v) : _normCDF(d1v)-1;
}

function bsGamma(S,K,r,sigma,T) {
  if (T<=0||sigma<=0) return 0;
  return _normPDF(_d1(S,K,r,sigma,T)) / (S*sigma*Math.sqrt(T));
}

function bsTheta(S,K,r,sigma,T,isCall) {
  if (T<=0) return 0;
  const d1v=_d1(S,K,r,sigma,T), d2v=_d2(d1v,sigma,T);
  const term1 = -(S*_normPDF(d1v)*sigma)/(2*Math.sqrt(T));
  return isCall
    ? (term1 - r*K*Math.exp(-r*T)*_normCDF(d2v))/365
    : (term1 + r*K*Math.exp(-r*T)*_normCDF(-d2v))/365;
}

// Vega per 1% vol change
function bsVega(S,K,r,sigma,T) {
  if (T<=0) return 0;
  return S*_normPDF(_d1(S,K,r,sigma,T))*Math.sqrt(T)/100;
}

// ── Implied Volatility — Bisection (robust for all moneyness) ─
// Newton-Raphson fails for deep-OTM short-DTE options (vega→0)
// Bisection always converges if solution exists in [0.001, 5.0]
function bsIV(mktPrice,S,K,r,T,isCall) {
  if (T<=0||mktPrice<=0) return null;
  const intrinsic = isCall ? Math.max(0,S-K) : Math.max(0,K-S);
  if (mktPrice < intrinsic*0.9999) return null;
  const fn = s => (isCall ? bsCall(S,K,r,s,T) : bsPut(S,K,r,s,T)) - mktPrice;
  let lo=0.001, hi=5.0;
  if (fn(lo)*fn(hi) > 0) return null; // no solution in range
  for (let i=0; i<80; i++) {
    const mid=((lo+hi)/2);
    const fmid=fn(mid);
    if (Math.abs(fmid)<0.0001) break;
    if (fn(lo)*fmid<0) hi=mid; else lo=mid;
  }
  const result=(lo+hi)/2;
  return Math.abs(fn(result))>1.0 ? null : result;
}

// ── Expected Move ─────────────────────────────────────────────
// India VIX = annualised IV of Nifty ATM options
// 1σ → 68% of weeks spot stays inside
// 2σ → 95% of weeks spot stays inside
function bsExpectedMove(spot,vix,dte) {
  if (!spot||!vix||!dte) return null;
  const sigma  = vix/100;
  const T      = dte/365;
  const move1  = spot*sigma*Math.sqrt(T);
  const move2  = move1*2;
  const daily  = spot*sigma/BS_SQRT252;
  const r5     = v => Math.round(v/5)*5;
  return {
    daily:     r5(daily),
    one_sigma: { upper:r5(spot+move1), lower:r5(spot-move1), width:r5(move1*2) },
    two_sigma: { upper:r5(spot+move2), lower:r5(spot-move2), width:r5(move2*2) },
    move_pts:  r5(move1),
    move_pct:  +((move1/spot)*100).toFixed(2),
    sigma, T,
  };
}

// ── Strike by Delta — binary search ──────────────────────────
function bsStrikeByDelta(spot,r,sigma,T,targetDelta,isCall,isNF) {
  if (T<=0||sigma<=0) return null;
  isNF = isNF!==false;
  const step = isNF ? BS_NF_STEP : BS_BNF_STEP;
  const r5n  = v => Math.round(v/step)*step;
  let lo = isCall ? spot       : spot*0.50;
  let hi = isCall ? spot*1.50  : spot;
  for (let i=0; i<60; i++) {
    const mid   = (lo+hi)/2;
    const delta = Math.abs(bsDelta(spot,mid,r,sigma,T,isCall));
    if (Math.abs(delta-targetDelta)<0.0001) break;
    if (delta>targetDelta) { if(isCall) lo=mid; else hi=mid; }
    else                   { if(isCall) hi=mid; else lo=mid; }
  }
  return r5n((lo+hi)/2);
}

// ── Bollinger Bands ───────────────────────────────────────────
// spots = array of closes, oldest → newest
// Returns: upper/lower/mid bands + squeeze + %B position
function bsBollingerBands(spots,period,mult) {
  period = period||BB_PERIOD;
  mult   = mult||BB_MULT;
  if (!spots||spots.length<period) return null;
  const recent  = spots.slice(-period);
  const n       = recent.length;
  const sma     = recent.reduce((a,b)=>a+b,0)/n;
  const stdDev  = Math.sqrt(recent.reduce((acc,x)=>acc+(x-sma)**2,0)/n);
  const upper   = sma+mult*stdDev;
  const lower   = sma-mult*stdDev;
  const bandwidth = ((upper-lower)/sma)*100;
  const current = spots[spots.length-1];
  const pctB    = upper===lower ? 0.5 : (current-lower)/(upper-lower);
  const r5      = v => Math.round(v/5)*5;
  return {
    upper:     r5(upper),
    lower:     r5(lower),
    mid:       r5(sma),
    stdDev:    +stdDev.toFixed(2),
    bandwidth: +bandwidth.toFixed(2),
    pctB:      +pctB.toFixed(3),
    position:  pctB>0.8  ? 'NEAR_UPPER' :
               pctB<0.2  ? 'NEAR_LOWER' :
               pctB>0.5  ? 'UPPER_HALF' : 'LOWER_HALF',
    squeeze:   bandwidth<3.0,   // bandwidth<3% = low vol, breakout pending
    n,
  };
}

// ── Combine BS + BB strikes (take most conservative) ─────────
// BS delta = forward-looking (VIX-based market expectation)
// BB bands = backward-looking (historical price range)
// Conservative IC = use the WIDER strike from either method
function _combineStrikes(bsStrike,bbStrike,isCall,isNF) {
  const step = isNF ? BS_NF_STEP : BS_BNF_STEP;
  const rnd  = v => Math.round(v/step)*step;
  if (!bsStrike && !bbStrike) return null;
  if (!bbStrike) return bsStrike;
  if (!bsStrike) return bbStrike;
  return rnd(isCall ? Math.max(bsStrike,bbStrike) : Math.min(bsStrike,bbStrike));
}

// ── Master Analysis ───────────────────────────────────────────
// spot   = current NF/BNF price
// vix    = India VIX from RADAR tab
// r      = 10Y yield as decimal (0.065 = 6.5%)
// dte    = calendar days to expiry
// spots  = array of recent closes from bhav (for BB) — optional
// isNF   = true for Nifty 50, false for Bank Nifty
// ── Volatility Skew (Phase 1 — static NSE calibration) ────────────────────
// India VIX = ATM implied vol. But OTM puts trade HIGHER, OTM calls LOWER.
// This is structural: everyone buys OTM puts as hedges → demand drives IV up.
//
// NSE persistent skew (calibrated from market structure, refined by bhav in Phase 2):
//   OTM Put  IV = VIX + skew_put  (+3 to +7 VIX pts depending on distance)
//   ATM      IV = VIX             (VIX IS the ATM vol by definition)
//   OTM Call IV = VIX + skew_call (-1 to +2 VIX pts, slight positive skew)
//
// moneyness = (strike - spot) / spot
//   call: moneyness > 0 (strike above spot)
//   put:  moneyness < 0 (strike below spot) — pass abs value, we handle sign
//
// Phase 2: bsSkewCoeffs will be replaced by coefficients extracted from
// your actual bhav data via bsIV() once 1-year upload is complete.
//
// skewCoeffs (tunable — override after Phase 2 calibration):
//   putSlope:  how many VIX pts of extra IV per 1% further OTM on put side
//   callSlope: same for call side (negative = discount vs VIX)
//   putFloor:  minimum extra IV added to puts regardless of distance
const BS_SKEW_COEFFS = {
  putSlope:  0.40,   // +0.40 VIX pts per 1% OTM (e.g. 10% OTM → +4 VIX pts)
  callSlope: 0.10,   // +0.10 VIX pts per 1% OTM (calls barely deviate from VIX)
  putFloor:  1.5,    // puts always at least 1.5 VIX pts above ATM IV
  callFloor: 0.0,    // calls have no floor premium
};

// Returns skew-adjusted annualised vol (decimal) for a given strike
// Use this instead of vix/100 when pricing individual legs
function bsSkewIV(vix, strike, spot, isCall) {
  const moneynessPct = Math.abs((strike - spot) / spot) * 100; // % OTM
  const coeffs = BS_SKEW_COEFFS;
  let skewAdj;
  if (isCall) {
    skewAdj = coeffs.callFloor + moneynessPct * coeffs.callSlope;
  } else {
    skewAdj = coeffs.putFloor  + moneynessPct * coeffs.putSlope;
  }
  return Math.max(vix, vix + skewAdj) / 100;  // annualised decimal
}

// Override skew coefficients after Phase 2 calibration from bhav data
// Call this once after bsCalibSkew() computes real coefficients
function bsSetSkewCoeffs(putSlope, callSlope, putFloor, callFloor) {
  BS_SKEW_COEFFS.putSlope  = putSlope  ?? BS_SKEW_COEFFS.putSlope;
  BS_SKEW_COEFFS.callSlope = callSlope ?? BS_SKEW_COEFFS.callSlope;
  BS_SKEW_COEFFS.putFloor  = putFloor  ?? BS_SKEW_COEFFS.putFloor;
  BS_SKEW_COEFFS.callFloor = callFloor ?? BS_SKEW_COEFFS.callFloor;
}

// Phase 2: Calibrate skew from bhav data
// bhavRows = [{strike, price, isCall, spot, vix, dte}] — from your uploaded data
// Returns {putSlope, callSlope, putFloor, callFloor} ready for bsSetSkewCoeffs()
function bsCalibSkew(bhavRows, r) {
  r = r || BS_RISK_FREE_DEFAULT;
  const putPts=[], callPts=[];
  for (const row of bhavRows) {
    const T = row.dte/365;
    if (T<=0||row.price<=0||row.spot<=0) continue;
    const iv = bsIV(row.price, row.spot, row.strike, r, T, row.isCall);
    if (!iv) continue;
    const ivVix    = iv*100 - row.vix;   // delta vs VIX
    const mPct = Math.abs((row.strike - row.spot)/row.spot)*100;
    if (row.isCall) callPts.push([mPct, ivVix]);
    else            putPts.push([mPct, ivVix]);
  }
  const linReg = pts => {
    if (pts.length < 5) return {slope:0, intercept:0};
    const n=pts.length, sx=pts.reduce((a,p)=>a+p[0],0), sy=pts.reduce((a,p)=>a+p[1],0);
    const sxx=pts.reduce((a,p)=>a+p[0]*p[0],0), sxy=pts.reduce((a,p)=>a+p[0]*p[1],0);
    const slope=(n*sxy-sx*sy)/(n*sxx-sx*sx||1);
    return {slope, intercept:(sy-slope*sx)/n};
  };
  const p=linReg(putPts), c=linReg(callPts);
  return {
    putSlope:  +Math.max(0, p.slope).toFixed(3),
    callSlope: +Math.max(0, c.slope).toFixed(3),
    putFloor:  +Math.max(0, p.intercept).toFixed(3),
    callFloor: +Math.max(0, c.intercept).toFixed(3),
    putSamples: putPts.length, callSamples: callPts.length,
  };
}

function bsAnalyse(spot,vix,r,dte,spots,isNF,score) {
  if (!spot||!vix||!dte) return null;
  isNF = isNF!==false;
  r    = r||BS_RISK_FREE_DEFAULT;

  const sigma     = vix/100;          // ATM vol — used for expected move
  const T         = dte/365;
  const step      = isNF ? BS_NF_STEP : BS_BNF_STEP;

  // Expected move uses ATM (flat) vol — correct, VIX IS ATM IV
  const em = bsExpectedMove(spot,vix,dte);

  // Adaptive delta based on VIX regime + directional score
  const callTargetD = bsTargetDelta(vix, score, true);
  const putTargetD  = bsTargetDelta(vix, score, false);

  // Strike search uses ATM sigma first (skew applied after strike found)
  // because we're searching by delta not by price
  const callD15 = bsStrikeByDelta(spot,r,sigma,T,callTargetD,      true, isNF);
  const callD20 = bsStrikeByDelta(spot,r,sigma,T,callTargetD+0.05, true, isNF);
  const putD15  = bsStrikeByDelta(spot,r,sigma,T,putTargetD,       false,isNF);
  const putD20  = bsStrikeByDelta(spot,r,sigma,T,putTargetD+0.05,  false,isNF);

  // Skew-adjusted IV for each strike (put IV > ATM, call IV ~ ATM)
  const sigmaCallD15 = callD15 ? bsSkewIV(vix,callD15,spot,true)  : sigma;
  const sigmaPutD15  = putD15  ? bsSkewIV(vix,putD15, spot,false) : sigma;

  // Verify actual deltas using skew-adjusted IV
  const callD15_actual = callD15 ? +Math.abs(bsDelta(spot,callD15,r,sigmaCallD15,T,true)).toFixed(3)  : null;
  const putD15_actual  = putD15  ? +Math.abs(bsDelta(spot,putD15, r,sigmaPutD15, T,false)).toFixed(3) : null;

  // Theoretical prices WITH skew — these are more accurate than flat-vol estimates
  const callD15_price = callD15 ? +bsCall(spot,callD15,r,sigmaCallD15,T).toFixed(2) : null;
  const putD15_price  = putD15  ? +bsPut (spot,putD15, r,sigmaPutD15, T).toFixed(2) : null;

  // Expose IVs for display
  const callIV = callD15 ? +(sigmaCallD15*100).toFixed(2) : null;
  const putIV  = putD15  ? +(sigmaPutD15 *100).toFixed(2) : null;

  // Bollinger Bands from bhav history
  const bb = (spots&&spots.length>=BB_PERIOD)
    ? bsBollingerBands(spots,BB_PERIOD,BB_MULT) : null;

  // Combined conservative strikes
  const combinedCall = _combineStrikes(callD15, bb?bb.upper:null, true,  isNF);
  const combinedPut  = _combineStrikes(putD15,  bb?bb.lower:null, false, isNF);

  // Distance from spot
  const callDist_pts = combinedCall ? combinedCall-spot        : null;
  const putDist_pts  = combinedPut  ? spot-combinedPut         : null;
  const callDist_em  = (callDist_pts&&em) ? +(callDist_pts/em.move_pts).toFixed(2) : null;
  const putDist_em   = (putDist_pts &&em) ? +(putDist_pts /em.move_pts).toFixed(2) : null;

  // IC wings (standard width)
  const width   = isNF ? 200 : 500;
  const callBuy = combinedCall ? combinedCall+width : null;
  const putBuy  = combinedPut  ? combinedPut-width  : null;

  // Theoretical IC credit at combined strikes
  let theoreticalCredit = null;
  let callLegCredit = null, putLegCredit = null;
  if (combinedCall&&combinedPut&&callBuy&&putBuy) {
    // Each leg priced with its own skew-adjusted IV
    const scS  = bsSkewIV(vix,combinedCall,spot,true);
    const scB  = bsSkewIV(vix,callBuy,     spot,true);
    const spS  = bsSkewIV(vix,combinedPut, spot,false);
    const spB  = bsSkewIV(vix,putBuy,      spot,false);
    const cs   = bsCall(spot,combinedCall,r,scS,T);
    const cb   = bsCall(spot,callBuy,     r,scB,T);
    const ps   = bsPut (spot,combinedPut, r,spS,T);
    const pb   = bsPut (spot,putBuy,      r,spB,T);
    callLegCredit    = +(cs-cb).toFixed(2);
    putLegCredit     = +(ps-pb).toFixed(2);
    theoreticalCredit = +(cs-cb+ps-pb).toFixed(2);
  }

  // Probability of IC profiting (both wings survive)
  let probProfit = null;
  if (combinedCall&&combinedPut) {
    // Use skew-adjusted IV for each side — put side is harder to survive
    const scFin  = bsSkewIV(vix,combinedCall,spot,true);
    const spFin  = bsSkewIV(vix,combinedPut, spot,false);
    const muC = (r-0.5*scFin*scFin)*T; const svC = scFin*Math.sqrt(T);
    const muP = (r-0.5*spFin*spFin)*T; const svP = spFin*Math.sqrt(T);
    const probCallSafe = _normCDF((Math.log(combinedCall/spot)-muC)/svC);
    const probPutSafe  = 1-_normCDF((Math.log(combinedPut/spot)-muP)/svP);
    probProfit = Math.round(probCallSafe*probPutSafe*100);
  }

  // Safety check — are strikes outside 1σ expected move?
  const callSafe = em&&combinedCall ? combinedCall>=em.one_sigma.upper : null;
  const putSafe  = em&&combinedPut  ? combinedPut <=em.one_sigma.lower : null;

  // Confidence: HIGH / MEDIUM / LOW
  let confidence='HIGH', confidenceReasons=[];
  if (bb?.squeeze) {
    confidence='LOW';
    confidenceReasons.push('BB squeeze — breakout risk, avoid IC');
  } else if (bb&&(bb.pctB>0.85||bb.pctB<0.15)) {
    confidence='MEDIUM';
    confidenceReasons.push(`Spot near BB ${bb.pctB>0.5?'upper':'lower'} band — trending`);
  }
  if (bb&&callD15&&Math.abs(combinedCall-callD15)>step*3) {
    confidence = confidence==='HIGH'?'MEDIUM':confidence;
    confidenceReasons.push('BS and BB strikes diverge');
  }
  if (vix>20) {
    confidence = confidence==='HIGH'?'MEDIUM':confidence;
    confidenceReasons.push(`VIX ${vix.toFixed(1)} elevated`);
  }
  if (confidenceReasons.length===0) confidenceReasons.push('BS delta and BB bands aligned');

  return {
    // Inputs
    spot,vix,r,dte,sigma,T,isNF,score,
    targetDelta:{ call:callTargetD, put:putTargetD },
    // Skew
    skew: {
      callIV, putIV,
      skewSpread: (callIV&&putIV) ? +(putIV-callIV).toFixed(2) : null,
      coeffs: { ...BS_SKEW_COEFFS },
    },
    // Expected move
    expectedMove: em,
    // Individual BS strikes
    strikes: {
      call:{ delta15:callD15, delta20:callD20, delta_actual:callD15_actual, bs_price:callD15_price },
      put: { delta15:putD15,  delta20:putD20,  delta_actual:putD15_actual,  bs_price:putD15_price  },
    },
    // Bollinger Bands
    bb,
    // Conservative combined strikes
    combinedStrikes: {
      call:combinedCall, put:combinedPut, callBuy, putBuy,
      callDist_pts, putDist_pts, callDist_em, putDist_em,
      callSafe, putSafe,
    },
    // P&L
    theoreticalCredit, probProfit, width,
    // Quality
    confidence, confidenceReasons,
    // Range
    breakeven: combinedCall&&combinedPut
      ? {upper:combinedCall,lower:combinedPut,width:combinedCall-combinedPut} : null,
  };
}

// ── Extract spot closes from localStorage ─────────────────────
function bsGetSpots(isNF) {
  const dates = JSON.parse(localStorage.getItem('mr_bhav_dates')||'[]');
  return dates.reduce((arr,dk)=>{
    try {
      const d = JSON.parse(localStorage.getItem('mr_bhav_'+dk)||'null');
      if (d?.spot) arr.push(d.spot);
    } catch(e){}
    return arr;
  },[]);
}

// ── One-line summary for display ──────────────────────────────
function bsSummaryLine(a) {
  if (!a?.expectedMove) return '—';
  const em = a.expectedMove;
  const lo = em.one_sigma.lower.toLocaleString('en-IN');
  const hi = em.one_sigma.upper.toLocaleString('en-IN');
  return `±${em.move_pts} pts  ·  1σ range: ${lo} – ${hi}`;
}
