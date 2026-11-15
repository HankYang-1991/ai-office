import {test} from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {PassThrough, Writable} from 'node:stream';
import {mkdtempSync, readFileSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import vm from 'node:vm';
import {sanitize, collect} from './codex-usage.mjs';
import readiness from './wait-pages-artifact.cjs';
import '../js/codex-state.js';

const reply = {rateLimits:{limitId:'codex',primary:{usedPercent:66,resetsAt:1900000000},secondary:null},email:'secret',planType:'secret'};
test('quota allowlist, null and invalid inputs', () => {
  const result = sanitize(reply);
  assert.equal(result.primary.remaining_pct,34);
  assert.equal(result.secondary,null);
  assert.deepEqual(Object.keys(result),['primary','secondary','updated_at']);
  assert.deepEqual(Object.keys(result.primary),['remaining_pct','reset_at']);
  assert.ok(!JSON.stringify(result).includes('secret'));
  for (const usedPercent of [null,true,'0',NaN,Infinity,-1,101])
    assert.throws(()=>sanitize({rateLimits:{primary:{usedPercent}}}));
  assert.throws(()=>sanitize({...reply,rateLimitsByLimitId:{other:{}}}));
});
function fakeServer(onRead) {
  const child = new EventEmitter(); child.stdout = new PassThrough(); child.kill = ()=>{};
  const send = msg => child.stdout.write(JSON.stringify(msg)+'\n');
  child.stdin = new Writable({write(chunk, enc, done) {
    const msg = JSON.parse(chunk);
    if (msg.method === 'initialize') queueMicrotask(()=>send({id:1,result:{}}));
    if (msg.method === 'account/rateLimits/read') queueMicrotask(()=>onRead(send));
    done();
  }});
  return child;
}
test('protocol initialize, read and atomic sanitized file', async()=>{
  const dir = mkdtempSync(join(tmpdir(),'quota-test-'));
  try {
    const output = join(dir,'quota.json');
    await collect({exe:'fake',output,launch:()=>fakeServer(send=>send({id:2,result:reply}))});
    assert.equal(JSON.parse(readFileSync(output)).primary.remaining_pct,34);
  } finally {rmSync(dir,{recursive:true});}
});
test('notification does not mask a timed-out read; failure clears data', async()=>{
  const dir = mkdtempSync(join(tmpdir(),'quota-test-'));
  try {
    const output = join(dir,'quota.json');
    await assert.rejects(collect({exe:'fake',output,watch:true,timeout:30,
      launch:()=>fakeServer(send=>send({method:'account/rateLimits/updated',params:reply}))}),/quota_read_timeout/);
    assert.deepEqual(JSON.parse(readFileSync(output)),{primary:null,secondary:null,updated_at:null});
  } finally {rmSync(dir,{recursive:true});}
});
test('fresh, stale, future, reset elapsed and invalid UI states',()=>{
  const now = Date.now(); const row = {used:66,limit:100,updated_at:new Date(now).toISOString()};
  assert.equal(CodexState.state(row,now),'fresh');
  for (const changes of [{stale:true},{updated_at:null},{updated_at:new Date(now-25*3600000).toISOString()},
    {updated_at:new Date(now+120000).toISOString()},{reset_at:new Date(now-1).toISOString()}])
    assert.equal(CodexState.state({...row,...changes},now),'stale');
  for (const changes of [{used:null},{used:NaN},{used:101},{reported:false},{connected:false},{limit:null}])
    assert.equal(CodexState.state({...row,...changes},now),'unavailable');
});
test('rendered stale and null quota contain no numeric percentage',()=>{
  const source=readFileSync(new URL('../js/app.js',import.meta.url),'utf8');
  const start=source.indexOf('  function realRowHTML('), end=source.indexOf('  function usageHTML(');
  const context=vm.createContext({window:{CodexState},esc:String,WIN:{},fmtNum:String,
    fmtDate:String,fmtLeft:()=>'',barColor:()=>'',pct:()=>0});
  vm.runInContext(source.slice(start,end),context);
  const row={scope:'own',used:66,limit:100,updated_at:new Date().toISOString()};
  assert.match(context.realRowHTML(row,false),/剩餘 34%/);
  assert.ok(!context.realRowHTML({...row,stale:true},false).includes('%'));
  assert.ok(!context.realRowHTML({...row,limit:null,reported:false},false).includes('%'));
});
test('artifact index retries empty responses then confirms exact upload',async()=>{
  let calls=0, waits=0;
  await readiness.waitForArtifact({listArtifacts:async()=>({artifacts:++calls===3?[{name:'github-pages',id:123,size:5}]:[]})},'123',{delay:async()=>waits++});
  assert.equal(waits,2);
});
test('artifact readiness stops on missing, wrong, duplicate or API error',async()=>{
  let waits=0;
  await assert.rejects(readiness.waitForArtifact({listArtifacts:async()=>({artifacts:[]})},'123',{delay:async()=>waits++}),/invisible/);
  assert.equal(waits,6);
  for (const artifacts of [[{name:'github-pages',id:124,size:5}], [{name:'github-pages',id:123,size:0}],
    [{name:'github-pages',id:123,size:5},{name:'github-pages',id:124,size:5}]])
    await assert.rejects(readiness.waitForArtifact({listArtifacts:async()=>({artifacts})},'123'));
  await assert.rejects(readiness.waitForArtifact({listArtifacts:async()=>{throw Error('denied')}},'123'),/denied/);
});
