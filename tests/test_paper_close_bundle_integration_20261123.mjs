import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
const source = readFileSync(new URL('../app.js', import.meta.url), 'utf8');
function fn(name) {
  const i = source.indexOf(`function ${name}(`);
  assert.ok(i >= 0, name);
  return source.slice(source.slice(i-6,i) === 'async ' ? i-6 : i, source.indexOf('\n}\n', i) + 3);
}
const names = ['asFiniteNumber', 'parsedObject', 'currentPnlValue', 'buildCloseLegQuotes', 'optionLegQuote',
  'estimateTeacherRoundTripCostBreakdown', 'buildPaperPnlBreakdown', 'readValidatedExtrema', 'withValidatedExtrema',
  'buildGrossExtremaCloseFields', 'buildNormalizedCloseExtremaPayload', 'moneyOrUnavailable',
  'assertPersistedCloseReasonProvenance', 'closeTrade', 'loadSingleLegStore', 'renderSingleLegCard'];
function setup() {
  const saved = [], remote = [], fees = [], alerts = [];
  const t = { id:'320', paper:true, index_key:'NF', strategy_type:'BEAR_PUT', sell_strike:25450,
    buy_strike:25600, sell_type:'PE', buy_type:'PE', current_pnl:90, current_premium:99,
    entry_date:new Date(Date.now()-3600000).toISOString(), peak_pnl:999999, trough_pnl:-999999 };
  const quote = {trade_id:'320', request_id:'fresh', quote_validity_state:'VALID', close_quote_quality:'VALID', close_quote_degraded_reason:null, gross_close_pnl:1000, executable_close_premium:87.5,
    expires_at_ms:Date.now()+60000, close_bundle_complete:true,
    close_bundle_contract:'paper_close_bundle_v1_one_accepted_quote_for_pnl_fees_and_evidence',
    close_leg_quotes:{buy:{bid:110,ask:111,instrument_key:'buy'},sell:{bid:22,ask:22.5,instrument_key:'sell'}},
    legs:[{instrument_key:'buy'},{instrument_key:'sell'}]};
  const validated = {trade_id:'320',status:'VALIDATED',basis:'GROSS_BEFORE_CHARGES',includes_accepted_close:false,
    contract:'a1_trusted_extrema_v1_trusted_marks_only_raw_extrema_unchanged',trusted_mfe:900,trusted_mae:-250,updated_at:'2026-11-23T06:59:00Z'};
  const bridge = {getValidatedPositionExtrema:ids=>JSON.stringify(Object.fromEntries(ids.map(id=>[id,validated]))),
    computeLiveFriction:raw=> { const x=JSON.parse(raw);fees.push(x);return JSON.stringify({friction_cost:100}); },
    singleLegRead:()=>JSON.stringify({positions:[],closed:[]})};
  const c = {console,Date,JSON,Number,String,Object,Math,Array,Set,Map,Intl,Promise,
    GROSS_EXTREMA_BASIS:'GROSS_MTM',GROSS_EXTREMA_UNIT:'INR_TOTAL',GROSS_EXTREMA_CONTRACT_VERSION:'legacy',
    STATE:{},bd:{},API:{minutesSinceOpen:()=>100},NativeBridge:bridge,window:{NativeBridge:bridge},
    nativeBridge:()=>bridge,safeParseNB:x=>JSON.parse(x),findOpenTradeById:()=>t,
    requestFreshPaperCloseQuote:async()=>quote,setPaperCloseBusy:()=>{},latestPollData:()=>({}),
    friendlyType:x=>x,confirm:()=>true,alert:x=>alerts.push(x),readNativeJson:()=>({strikes:{25450:{PE:{bid:800,ask:801}},25600:{PE:{bid:900,ask:901}}}}),
    removeOpenTradeFromState:()=>{},renderAll:()=>{},isEvRuleBTrade:()=>false,
    recordClosedTradeToNative:(_,patch)=>saved.push(JSON.parse(JSON.stringify(patch))),
    DB:{updateTrade:async(_,patch)=>{remote.push(JSON.parse(JSON.stringify(patch)));return true;}},addNotificationLog:()=>{},
    resumeSingleLegPending:()=>{},singleLegEnabled:()=>true,getIndexSelector:()=> 'BOTH',SINGLE_LEG_PENDING:{},
    iaEsc:x=>String(x),singleLegCapital:()=>({status:'SET',capital:1000000}),iaTodayIst:()=> '2026-11-23'};
  vm.createContext(c);vm.runInContext('let SINGLE_LEG_STORE = null;\n'+names.map(fn).join('\n'),c);
  return {c,t,quote,validated,saved,remote,fees,alerts,bridge};
}
test('actual close uses accepted legs for fees, native ledger and remote patch; gross extrema can be below close',async()=>{
  const h=setup();await h.c.closeTrade('320','Manual');
  assert.deepEqual(h.alerts,[]);assert.equal(h.saved.length,1);assert.equal(h.remote.length,1);
  assert.deepEqual(h.fees[0].close_leg_quotes,h.quote.close_leg_quotes);
  for(const patch of [h.saved[0],h.remote[0]]) {
    assert.equal(patch.actual_pnl,1000);assert.equal(patch.net_pnl,900);
    assert.deepEqual(patch.exit_snapshot.close_leg_quotes,h.quote.close_leg_quotes);
    assert.deepEqual(patch.close_trace_json.paper_close_quote,h.quote);
    assert.equal(patch.peak_pnl,900);assert.equal(patch.trough_pnl,-250);
    assert.equal(patch.close_trace_json.close_extrema_meta.includes_accepted_close,false);
    assert.equal(patch.close_trace_json.close_extrema_meta.basis,'GROSS_BEFORE_CHARGES');
    assert.equal(patch.close_trace_json.close_extrema_meta.observation_interval.to,h.validated.updated_at);
  }
});
test('missing accepted bundle permits gross close with unknown fees, never periodic fallback',async()=>{
  const h=setup();delete h.quote.close_leg_quotes;h.quote.close_bundle_complete=false;
  await h.c.closeTrade('320','Manual');assert.deepEqual(h.alerts,[]);
  assert.equal(h.saved[0].actual_pnl,1000);assert.equal(h.saved[0].net_pnl,null);
  assert.equal(h.saved[0].friction_cost,null);assert.deepEqual(h.saved[0].exit_snapshot.close_leg_quotes,{});
  assert.equal(h.fees.length,0);
});
test('validated unknown and one-sided observations stay unknown; no raw extrema or synthetic zero',()=>{
  const h=setup();const unknown=h.c.withValidatedExtrema(h.t,null);
  assert.equal(unknown.peak_pnl,null);assert.equal(unknown.trough_pnl,null);
  delete h.validated.trusted_mfe;h.validated.trusted_mae=0;
  const one=h.c.withValidatedExtrema(h.t,h.validated);assert.equal(one.peak_pnl,null);assert.equal(one.trough_pnl,0);
  h.validated.trade_id='other';assert.equal(h.c.withValidatedExtrema(h.t,h.validated).trough_pnl,null);
});
test('fee contexts are trade scoped and cannot reuse another accepted close',()=>{
  const h=setup();const bad={...h.t,accepted_paper_close_quote:{...h.quote,trade_id:'BNF'}};
  assert.equal(h.c.buildPaperPnlBreakdown(bad).netIfClosedNow,null);assert.equal(h.fees.length,0);
});
test('render rereads durable CLOSED state after a monitor exit without another admission',()=>{
  const h=setup();h.bridge.singleLegRead=()=>JSON.stringify({positions:[{position_id:'sl',index:'BNF',action:'BUY_PE',instrument_key:'key',status:'OPEN'}]});
  assert.match(h.c.renderSingleLegCard({}),/OPEN/);
  h.bridge.singleLegRead=()=>JSON.stringify({positions:[{position_id:'sl',index:'BNF',action:'BUY_PE',instrument_key:'key',status:'CLOSED',exit_reason:'TIME_EXIT'}],closed:[{position_id:'sl',net_pnl:3070.09}]});
  const html=h.c.renderSingleLegCard({});assert.match(html,/CLOSED/);assert.match(html,/3,070.09/);assert.doesNotMatch(html,/position overdue/);
});

test('degraded close metadata survives the actual close unchanged',async()=>{
  const h=setup();Object.assign(h.quote,{quote_validity_state:'INVALID',close_quote_quality:'DEGRADED',
    close_quote_degraded_reason:'quote_invalid_after_one_refresh:source_stale',close_quote_refresh_attempted:true});
  await h.c.closeTrade('320','Manual');assert.deepEqual(h.alerts,[]);
  for(const patch of [h.saved[0],h.remote[0]]) assert.deepEqual(patch.close_trace_json.paper_close_quote,h.quote);
});
