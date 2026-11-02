import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
const source = readFileSync(new URL('../app.js', import.meta.url), 'utf8');
function fn(n) { const i = source.indexOf(`function ${n}(`); assert.ok(i >= 0, n); return source.slice(i, source.indexOf('\n}\n', i) + 3); }
const names = ['normalizePaperIndexKey','parsePositiveIntegralLotJs','paperContractIdentityGate','paperTradeAuthorization',
  'paperObservationCandidate','paperObservationAuthorization','candidateLegCount','iaEsc','isIndexAuthorityActive','renderAuthorityCandidateCard','renderIntradayChart'];
function context() {
  const c = { Number,String,Object,Array,Math,Set,JSON, bd:{}, STATE:{},
    brainFreshnessStatus:()=>({fresh:true}), renderSnapshot:x=>x, latestPollData:()=>({vix:15.9}),
    readNativeJson:()=>[], friendlyType:x=>x, paperTradeCapacity:()=>({available:true,count:0,limit:2}),
    indexStructureChoiceAvailable:()=>false };
  vm.createContext(c);vm.runInContext(names.map(fn).join('\n'),c);return c;
}
function candidate() { return { id:'bnp', authorityPolicyVersion:'index_direction_v1', authorityOrder:'FIXED_PRESENTATION_ORDER_NOT_A_RANK',
  index:'BNF', type:'BEAR_PUT', expiry:'2026-11-23', lotSize:30,lots:1,isCredit:false,netPremium:-169.4,
  sellStrike:54400,sellType:'PE',buyStrike:54800,buyType:'PE',entryEligible:true,
  legs:[{action:'SELL',strike:54400,option_type:'PE',instrument_key:'NSE_FO|BNF54400PE',bid:622.45,ask:624},
    {action:'BUY',strike:54800,option_type:'PE',instrument_key:'NSE_FO|BNF54800PE',bid:789.75,ask:791.85}] }; }

test('actual Paper gate admits the phone-shaped bid/ask structure without LTP; source remains untouched',()=>{
  const c=context(), input=candidate(), before=JSON.stringify(input);
  const a=c.paperObservationAuthorization(input);
  assert.equal(a.allowed,true,a.reason);assert.equal(a.quantity_units,30);
  const p=c.paperObservationCandidate(input).candidate;
  assert.equal(p.sellLTP,622.45);assert.equal(p.buyLTP,791.85);assert.equal(p.netPremium,169.4);
  assert.equal(p.buyInstrumentKey,input.legs[1].instrument_key);
  assert.equal(p.paperEntryQuote.basis,'SIMULATED_BUY_ASK_SELL_BID');
  assert.equal(p.paperEntryQuote.exchange_freshness_verified,false);
  assert.equal(JSON.stringify(input),before);
  assert.doesNotMatch(c.renderAuthorityCandidateCard(input),/PAPER UNAVAILABLE/);
});
test('four-leg credit mapping and quantity retain both exact sides',()=>{
  const c=context(),x=candidate();Object.assign(x,{index:'NF',lotSize:65,type:'IRON_CONDOR',isCredit:true,expiry:'2026-11-03',
    sellStrike:23250,sellType:'CE',buyStrike:23400,buyType:'CE',sellStrike2:23150,sellType2:'PE',buyStrike2:23000,buyType2:'PE'});
  x.legs=[['SELL',23250,'CE',59.7,59.8],['SELL',23150,'PE',72.75,72.95],['BUY',23400,'CE',21.85,21.95],['BUY',23000,'PE',29.8,29.95]]
    .map(([action,strike,option_type,bid,ask])=>({action,strike,option_type,bid,ask,instrument_key:`NSE_FO|NF${strike}${option_type}`}));
  const p=c.paperObservationCandidate(x);assert.equal(p.reasons.length,0);
  assert.equal(p.candidate.netPremium,80.55);assert.equal(p.candidate.sellLTP2,72.75);assert.equal(p.candidate.buyLTP2,29.95);
  assert.equal(c.paperObservationAuthorization(x).quantity_units,65);
});
test('missing/crossed quotes, duplicate keys and conflicting identities cannot fall back to supplied LTP',()=>{
  const c=context();for(const alter of [x=>delete x.legs[0].bid,x=>x.legs[1].ask=0,x=>x.legs[0].bid=999,
    x=>x.legs[0].instrument_key=x.legs[1].instrument_key,x=>x.legs[0].expiry='2026-11-03',x=>x.sellStrike=123,
    x=>x.sellStrike2=1,x=>x.lotEvidence={status:'VERIFIED',index:'NF'}]) {
    const x=candidate();x.sellLTP=700;x.buyLTP=800;alter(x);assert.equal(c.paperObservationAuthorization(x).allowed,false);
  }
});
test('stale brain blocks manual Paper; managed freshness block remains visible with a manual recording',()=>{
  const c=context(),x=candidate();c.brainFreshnessStatus=()=>({fresh:false,reason:'stale brain'});
  assert.equal(c.paperObservationAuthorization(x).allowed,false);
  assert.match(c.renderAuthorityCandidateCard(x),/Manual Paper unavailable: stale brain/);
  c.brainFreshnessStatus=()=>({fresh:true});c.bd.managed_policy={BNF:{gates:[{candidate_id:x.id,admit:false,reasons:['FRESHNESS_UNVERIFIED:EXCHANGE_TIMESTAMP_MISSING']}]} };
  const html=c.renderAuthorityCandidateCard(x);assert.match(html,/Managed admission blocked: FRESHNESS_UNVERIFIED:EXCHANGE_TIMESTAMP_MISSING/);
  assert.match(html,/Manual Paper test/);assert.match(html,/does not authorize managed or broker execution/);
});
test('chart uses its snapshot index authority; stale authority is unavailable and legacy chart retains its old badge',()=>{
  const c=context(),snapshot={pollHistory:[0,1,2].map(i=>({t:`13:${30+i*5}`,nfSpot:23200+i,bnfSpot:54600-i,vix:15.9})),openTrades:[],
    brainResult:{direction_authority:{active:'index_direction_v1'},by_index:{BNF:{direction:{value:'BEAR'},regime:{value:'TREND_DOWN'}},NF:{direction:{value:'NEUTRAL'},regime:{value:'RANGE'}}}}};
  assert.match(c.renderIntradayChart('BNF',snapshot),/BEAR · TREND_DOWN/);
  assert.doesNotMatch(c.renderIntradayChart('BNF',snapshot),/>RANGE</);
  assert.match(c.renderIntradayChart('NF',snapshot),/NEUTRAL · RANGE/);
  c.brainFreshnessStatus=()=>({fresh:false});assert.match(c.renderIntradayChart('BNF',snapshot),/>UNAVAILABLE</);
  snapshot.brainResult={};assert.match(c.renderIntradayChart('BNF',snapshot),/>RANGE</);
});
