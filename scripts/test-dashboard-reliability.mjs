import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';

const app = await readFile(new URL('../app.js',import.meta.url),'utf8');
const pipeline = await readFile(new URL('./orxelia-proposal-pipeline.mjs',import.meta.url),'utf8');
const retry = vm.createContext({});
vm.runInContext(pipeline.slice(pipeline.indexOf('const readyStages'),pipeline.indexOf('function rank')),retry);
const now = Date.now();
for(const [status,prefix] of [['revision_requested','Gemini revision retry scheduled: '],['awaiting_selection','Gemini design retry scheduled: ']]){
 for(const [minutes,expected] of [[29,false],[30,true],[31,true]]){
  retry.candidate={status,design_status:'pending',error_message:prefix+'Error: Gemini unavailable: HTTP 503',updated_at:new Date(now-minutes*60000).toISOString()};
  assert.equal(vm.runInContext(`isReady(candidate,${now})`,retry),expected);
 }
}
for(const [message,expected] of [
 ['Error: Gemini unavailable: model HTTP 503',true],
 ['Error: Gemini unavailable: TimeoutError: timeout',true],
 ['Error: Gemini unavailable: model HTTP 429; fallback HTTP 503',false],
 ['Error: Gemini unavailable: model HTTP 403',false],
 ['Error: Design browser check failed HTTP 503',false],
 ['Error: Design preview must be static and offline',false]
]){
 retry.message=message;
 assert.equal(vm.runInContext('isTransientGeminiError(message)',retry),expected,message);
}

// Exercise the actual catch block with mocked storage; never contact production.
for(const stage of ['awaiting_selection','revision_requested']){
 for(const alreadyRetried of [false,true]){
  const writes=[];
  const prefix=stage==='awaiting_selection'?'Gemini design retry scheduled: ':'Gemini revision retry scheduled: ';
  const state=stage==='awaiting_selection'?'designing':'revising';
  const sandbox=vm.createContext({proposal:{id:'a',status:stage,error_message:alreadyRetried?prefix+'previous':null},
   error:Error('Gemini unavailable: model HTTP 503'),console:{log(){},error(){}},process:{},
   idFilter:()=>'',api:async()=>[{status:state}],update:async(id,fields,expected)=>writes.push({fields,expected})});
  vm.runInContext(pipeline.slice(pipeline.indexOf('const revisionRetryPrefix'),pipeline.indexOf('function isReady')),sandbox);
  const body=pipeline.slice(pipeline.lastIndexOf('} catch (error) {')+'} catch (error) {'.length).trim().slice(0,-1);
  await vm.runInContext(`(async()=>{${body}})()`,sandbox);
  assert.equal(writes.length,1);
  assert.equal(writes[0].fields.status,alreadyRetried?'failed':stage);
  assert.equal(writes[0].expected,state);
 }
}
assert.match(pipeline,/design_status:'ready',error_message:null/);
const panelContext=vm.createContext({esc:s=>String(s).replaceAll('<','&lt;')});
vm.runInContext(app.slice(app.indexOf('function proposalErrorPanel'),app.indexOf('function orxeliaTrialProposalPanel')),panelContext);
for(const [status,error_message,label] of [
 ['revision_requested','Gemini revision retry scheduled: Error: Gemini unavailable: HTTP 503','再試行します'],
 ['failed','Error: Gemini unavailable: HTTP 503','自動再試行は予約されていません'],
 ['awaiting_first_approval','old error','過去のエラー記録']
]){
 panelContext.p={status,error_message};
 assert.ok(vm.runInContext('proposalErrorPanel(p)',panelContext).includes(label));
}
console.log('PASS retry cooldown, bounded retry, non-transient rejection, recovery cleanup, error display');
