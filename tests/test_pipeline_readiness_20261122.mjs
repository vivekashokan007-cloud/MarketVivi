import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
const src=readFileSync(new URL('../app.js', import.meta.url),'utf8');
function fn(name) {
 const m=new RegExp(`^function ${name}\\(`,'m').exec(src);
 return src.slice(m.index,src.indexOf('\n}\n',m.index)+3);
}
function harness(rows) {
 const c={Date, JSON, window:{NativeBridge:{singleLegRead:()=>JSON.stringify({quote_readiness:{by_index:rows}})}}};
 vm.createContext(c);
 vm.runInContext(['iaEsc','singleLegReadinessLine','singleLegHoldLine','singleLegPositionHoldLine'].concat(['bnfNewEntryAllowed', 'bnfAnalysisView']).map(fn).join('\n'),c);
 return c;
}
test('quote readiness is bound to displayed index, decision and exact instrument',()=>{
 const p={action:'BUY_CE',decision_id:'d1',instrument_key:'K1'};
 const c=harness({NF:{decision_id:'d1',instrument_key:'K1',state:'REQUEST_FAILED',reason:'HTTP_401'},
                  BNF:{decision_id:'d2',instrument_key:'K2',state:'QUOTE_VALIDATED'}});
 assert.match(c.singleLegReadinessLine('NF',p),/Broker request failed.*HTTP_401/);
 assert.match(c.singleLegReadinessLine('BNF',p),/not requested/);
 assert.doesNotMatch(c.singleLegReadinessLine('BNF',p),/checked/);
 assert.equal(c.singleLegReadinessLine('NF',{...p,action:'SELL_PE'}),'');
});
test('holding display uses persisted deadline and restart anchor',()=>{
 const c=harness({});
 assert.match(c.singleLegHoldLine({holding_contract:{time_exit:'15:05',deadline_session:'2026-11-02'}}),/15:05.*2026-11-02/);
 const p={holding_plan:{anchor_ts:new Date(Date.now()-60000).toISOString(),exit_deadline:'2026-11-02T15:05:00+05:30',policy_version:'saved-v1'}};
 assert.match(c.singleLegPositionHoldLine(p),/1 min elapsed.*2026-11-02T15:05.*saved-v1/);
});
