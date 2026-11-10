import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const js=readFileSync('app.js','utf8');
const html=readFileSync('dashboard/index.html','utf8');
const css=readFileSync('style.css','utf8');
const requiredRoutes=['home','portfolio','verification','finance','settings'];
for(const route of requiredRoutes)assert.ok(html.includes('data-tab="'+route+'"'),'navigation missing: '+route);
const render=js.slice(js.indexOf('function render()'),js.indexOf('function input(',js.indexOf('function render()')));
assert.ok(render.includes('home, portfolio:'),'home not wired');
assert.ok(render.includes('verification:() =>'),'approval view not wired');
assert.ok(render.includes('finance:() =>'),'finance view not wired');
assert.ok(render.includes('settings'),'settings view not wired');
const actions=[
  ['request_revision','awaiting_first_approval'],
  ['approve_development','awaiting_first_approval'],
  ['request_prototype_revision','development_ready'],
  ['request_sales_review','development_ready'],
  ['approve_sales','awaiting_final_approval']
];
const panel=js.slice(js.indexOf('function orxeliaTrialProposalPanel()'),js.indexOf('let readable',js.indexOf('function orxeliaTrialProposalPanel()')));
for(const [action,status] of actions){
 assert.ok(panel.includes('data-proposal-action="'+action+'"'),'missing action button '+action);
 assert.ok(panel.includes(status),'missing stage '+status);
}
const sync=js.slice(js.indexOf('const sync = (() => {'));
for(const action of [...actions.map(a=>a[0]),'hold'])assert.ok(sync.includes(action+':'),'missing action confirmation '+action);
assert.ok(sync.includes('/rest/v1/rpc/orxelia_proposal_transition'),'missing transition RPC');
assert.ok(sync.includes('p_id:id,p_action:action,p_feedback:feedback'),'missing transition parameters');
assert.ok(sync.includes('if(!session?.user?.id)'),'missing authentication guard');
assert.ok(sync.includes('if(!confirm(messages[action]))return'),'missing explicit confirmation');
assert.ok(sync.includes('btn.disabled=true'),'missing duplicate submission protection');
assert.ok(sync.includes('catch(e){alert("処理できませんでした:'),'missing failure feedback');
assert.ok(sync.includes('公開・決済開始は自動実行しません'),'missing sales safety boundary');
assert.ok(js.includes('data-prototype-preview') && /sandbox="allow-scripts allow-modals allow-forms allow-downloads"/.test(js),'missing isolated prototype');
assert.ok(js.includes('saveOrxeliaDraft') && js.includes('orxelia-revision-drafts-v1'),'missing draft persistence');
assert.ok(js.includes('function home()') && js.includes('executiveQuickMatrix()'),'missing home overview');
assert.ok(js.includes('taskSection.scrollIntoView'),'missing task navigation');
for(const asset of ['style.css','app.js','business-economics.js'])assert.ok(html.includes(asset),'missing linked asset '+asset);
for(const selector of ['.priority-card','.quick-table','.home-links'])assert.ok(css.includes(selector),'missing style '+selector);
console.log('PASS: five routes, five staged actions, Supabase RPC wiring, confirmation, auth, safe sales boundary, draft preservation, prototype isolation, assets');
console.log('NOTE: Static contract checks only. No actual Supabase/Gemini requests or browser interaction were performed.');
