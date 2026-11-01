import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
const src=readFileSync(new URL('../app.js', import.meta.url),'utf8');
const a=src.indexOf('function renderSingleLegCard(');
const fn=src.slice(a,src.indexOf('\n}\n',a)+3);
test('prior-session position warning remains visible with opt-in OFF and other index selected',()=>{
 const c={Intl,Date,JSON,Math,SINGLE_LEG_PENDING:{},SINGLE_LEG_STORE:{positions:[{index:'NF',action:'BUY_CE',instrument_key:'x',status:'EXIT_PENDING',session_date:'2000-01-01'}]},
 resumeSingleLegPending(){},singleLegEnabled:()=>false,getIndexSelector:()=> 'BNF',iaTodayIst:()=> '2026-11-02',iaEsc:x=>String(x??''),singleLegCapital:()=>({status:'UNAVAILABLE'})};
 vm.createContext(c);vm.runInContext(fn,c);
 assert.match(c.renderSingleLegCard({}),/sl-overdue/);
});
test('closed historical position has no overdue warning',()=>{
 const c={Intl,Date,JSON,Math,SINGLE_LEG_PENDING:{},SINGLE_LEG_STORE:{positions:[{status:'CLOSED',session_date:'2000-01-01'}]},
 resumeSingleLegPending(){},singleLegEnabled:()=>false,getIndexSelector:()=> 'BOTH',iaTodayIst:()=> '2026-11-02',iaEsc:x=>String(x??''),singleLegCapital:()=>({status:'UNAVAILABLE'})};
 vm.createContext(c);vm.runInContext(fn,c);assert.doesNotMatch(c.renderSingleLegCard({}),/sl-overdue/);
});
