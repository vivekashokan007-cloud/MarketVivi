import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
const text=fs.readFileSync(new URL('../app.js',import.meta.url),'utf8');
const code=text.slice(text.indexOf('/* CLOUD_RECOVERY_BEGIN'),text.indexOf('/* CLOUD_RECOVERY_END */'));
function boot(initial, recovered) {
 class Storage {
   get length(){return Object.keys(this).length;}
   key(i){return Object.keys(this)[i]??null;}
   getItem(k){return this[k]??null;}
   setItem(k,v){this[k]=String(v);}
   removeItem(k){delete this[k];}
   clear(){Object.keys(this).forEach(k=>delete this[k]);}
 }
 const storage=new Storage(); Object.entries(initial).forEach(([k,v])=>storage.setItem(k,v));
 const saves=[]; const events={}; const badges={};
 const native={ cloudReadWeb:()=>JSON.stringify(recovered), cloudSaveWeb:s=>{saves.push(JSON.parse(s));return true;},
   cloudRequestSync(){},cloudStatus:()=>JSON.stringify({state:'VERIFIED_CHECKPOINT',verified_at:'test'}) };
 const context={window:{AndroidBridge:native,localStorage:storage,addEventListener:(e,f)=>{events[e]=f;}},document:{
   addEventListener:(e,f)=>{events[e]=f;},getElementById:id=>badges[id]||null,
   createElement:()=>({style:{},setAttribute(){}}),body:{prepend:b=>{badges[b.id]=b;}}},setInterval(){}};
 vm.runInNewContext(code,context);
 return {storage,saves,context,events,badges};
}
let b=boot({mr2_theme:'dark',mr2_token:'broker-secret'},null);
assert.equal(b.storage.getItem('mr2_theme'),'dark');
assert.equal(b.storage.getItem('mr2_token'),'broker-secret');
assert.deepEqual(b.saves[0],{mr2_theme:'dark'});
b.storage.setItem('mr2_closed_trades',JSON.stringify(Array.from({length:351},(_,i)=>({id:i}))));
assert.equal(JSON.parse(b.saves.at(-1).mr2_closed_trades).length,351);
b.storage.removeItem('mr2_theme'); assert.ok(!('mr2_theme' in b.saves.at(-1)));
b=boot({mr2_theme:'old',mr2_token:'local-credential'},{mr2_theme:'restored',mr2_closed_trades:'[1,2]'});
assert.equal(b.storage.getItem('mr2_theme'),'restored'); assert.equal(b.storage.getItem('mr2_token'),'local-credential');
b.events.load(); assert.match(b.badges['mr-cloud-state'].textContent,/verified/);
b=boot({mr2_theme:'old'},{}); assert.equal(b.storage.getItem('mr2_theme'),null);
b.context.window.AndroidBridge.cloudSaveWeb=()=>false;
b.storage.setItem('mr2_theme','unsent'); assert.equal(b.context.window.mrCloudCaptureError,true);
console.log('PASS: first upgrade, restored and empty state, 351 trades, all storage mutations, secrets, failed capture and status');
