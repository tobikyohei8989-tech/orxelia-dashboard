import {chromium} from 'playwright';
const base=process.env.SUPABASE_URL,secret=process.env.SUPABASE_SERVICE_ROLE_KEY,gemini=process.env.GEMINI_API_KEY;
if(!base||!secret)throw Error('Supabase server secrets required');
if(new URL(base).hostname.split('.')[0]!=='yzlxcfncdtojajlhihap')throw Error('Supabase project mismatch');
const headers={apikey:secret,Authorization:'Bearer '+secret,'Content-Type':'application/json'};
async function api(path,options={}){const r=await fetch(base+'/rest/v1/'+path,{...options,headers:{...headers,...options.headers}});if(!r.ok)throw Error('DB HTTP '+r.status+' '+(await r.text()).slice(0,240));return r.status===204?null:r.json()}
const idFilter=id=>'orxelia_proposals?id=eq.'+encodeURIComponent(id);
async function update(id,fields,expected){const rows=await api(idFilter(id)+'&status=eq.'+encodeURIComponent(expected),{method:'PATCH',headers:{Prefer:'return=representation'},body:JSON.stringify({...fields,updated_at:new Date().toISOString()})});if(rows.length!==1)throw Error('Stage changed concurrently');return rows[0]}
async function model(prompt,max=5500){if(!gemini)throw Error('Gemini key missing');const names=['gemini-flash-lite-latest','gemini-3.8-flash'];let failures=[];for(const name of names){for(let attempt=0;attempt<2;attempt++){try{const r=await fetch('https://generativelanguage.googleapis.com/v1beta/models/'+name+':generateContent',{method:'POST',headers:{'x-goog-api-key':gemini,'Content-Type':'application/json'},body:JSON.stringify({contents:[{parts:[{text:prompt}]}],generationConfig:{temperature:0.25,maxOutputTokens:max}}),signal:AbortSignal.timeout(45000)});const j=await r.json();if(!r.ok){failures.push(name+' HTTP '+r.status);if([429,500,503].includes(r.status)&&attempt===0)continue;break}if(j.candidates?.[0]?.finishReason==='MAX_TOKENS')throw Error('truncated');const text=j.candidates?.[0]?.content?.parts?.map(p=>p.text||'').join('');if(text?.trim())return text;throw Error('empty model response')}catch(e){failures.push(name+' '+String(e).slice(0,90))}}}throw Error('Gemini unavailable: '+failures.join('; '))}
const htmlFrom=(t,allowScripts=false)=>{const m=t.match(/<!doctype html[\s\S]*?<\/html>/i)||t.match(/<html[\s\S]*?<\/html>/i);if(!m)throw Error('AI did not return complete HTML');const h=m[0];if(h.length>120000)throw Error('HTML too large');if(new RegExp(allowScripts?'(<iframe\\b|<object\\b|<embed\\b|<form[^>]*action\\s*=|https?:\\/\\/)':'(<script\\b|<iframe\\b|<object\\b|<embed\\b|<form[^>]*action\\s*=|https?:\\/\\/)','i').test(h))throw Error('Design preview must be static and offline');return h};
async function test(html,interactive=false){const browser=await chromium.launch({headless:true});try{const page=await browser.newPage({viewport:{width:390,height:844},isMobile:true,hasTouch:true});const errors=[];page.on('pageerror',e=>errors.push(String(e)));await page.route('https://orxelia.test/**',route=>route.fulfill({status:200,contentType:'text/html; charset=utf-8',body:html}));await page.goto('https://orxelia.test/preview',{waitUntil:'load'});const result=await page.evaluate(()=>({width:document.documentElement.scrollWidth,viewport:innerWidth,text:document.body.innerText.length,buttons:document.querySelectorAll('button').length,inputs:document.querySelectorAll('input,textarea,select').length}));return {passed:result.text>100&&result.width<=result.viewport+10&&(!interactive||result.inputs>=2&&result.buttons>=1)&&!errors.length,...result,errors}}finally{await browser.close()}}
const brief=p=>JSON.stringify({title:p.title,problem:p.brief?.problem,solution:p.brief?.solution,target:p.brief?.target,competitive_position:p.brief?.competitive_position});
// Process pending proposal stages, including legacy dashboard projects migrated into the approval-gated workflow.
const proposal=(await api('orxelia_proposals?select=*&status=in.(awaiting_selection,revision_requested,approved_for_development,prototype_revision_requested,sales_review_requested,awaiting_final_approval)&order=created_at.asc&limit=30')).find(p=>p.status==='prototype_revision_requested'||p.status==='approved_for_development'||p.status==='sales_review_requested'||(p.status==='awaiting_final_approval'&&p.sales_review?.recommendation==='needs_evidence'&&(!p.sales_review?.last_researched_at||Date.now()-Date.parse(p.sales_review.last_researched_at)>20*60*60*1000))||p.status==='revision_requested'||p.design_status==='pending');
if(!proposal){console.log('No proposal stage work pending');process.exit(0)}
console.log('Processing proposal',proposal.id,'stage',proposal.status);
try{
 if(proposal.status==='awaiting_selection'){
  await update(proposal.id,{status:'designing',design_status:'generating'},'awaiting_selection');
  const h=htmlFrom(await model('You are Gemini, the ORXELIA UI designer. Produce ONLY complete standalone Japanese HTML/CSS for a STATIC MOBILE-FIRST DESIGN MOCKUP. No JavaScript, no external URLs, no remote assets. Clearly label as デザイン案（操作できません）. Show KPI card, record cards, and bottom navigation as visual mockup. Never invent real customer results or actual approval. This is NOT a functional app. Business: '+brief(proposal),7000));
  const t=await test(h);
  if(!t.passed)throw Error('Design browser check failed '+JSON.stringify(t));
  const feedback=await model('You are an independent Gemini UX reviewer. In Japanese give up to 5 concrete improvements to this mobile design; prioritize clarity and accessibility. No claim of functional testing. HTML: '+h.slice(0,18000),1100);
  await update(proposal.id,{status:'awaiting_first_approval',design_status:'ready',design_html:h,design_review:feedback.slice(0,3000),test_report:{design_preview:t}},'designing');
  console.log('Design preview saved, awaiting first approval');
 }else if(proposal.status==='revision_requested'){
  const feedback=(proposal.revision_request||'').trim();
  if(feedback.length<3)throw Error('Missing revision feedback');
  await update(proposal.id,{status:'revising'},'revision_requested');
  const revised=htmlFrom(await model('You are Gemini, revising a PRE-APPROVAL STATIC MOBILE DESIGN MOCKUP. Follow user feedback while preserving the original business purpose. Output ONLY complete standalone Japanese HTML/CSS; no JavaScript, URLs, or remote assets. Clearly label デザイン案（操作できません）. User feedback: '+feedback+' ORIGINAL DESIGN: '+(proposal.design_html||'').slice(0,21000)+' ORIGINAL BUSINESS: '+brief(proposal),10000));
  const checked=await test(revised);
  if(!checked.passed)throw Error('Revised design browser check failed '+JSON.stringify(checked));
  const review=await model('You are an independent Gemini UX reviewer. In Japanese briefly evaluate whether the requested changes were reflected, identify unresolved items, and list concrete UX concerns. User request: '+feedback+' Revised design: '+revised.slice(0,18000),1600);
  const history=Array.isArray(proposal.revision_history)?proposal.revision_history:[];
  const revision=(proposal.revision_number||1)+1;
  const summary='修正指示：'+feedback.slice(0,700)+' / Geminiレビュー：'+review.slice(0,1200);
  await update(proposal.id,{status:'awaiting_first_approval',design_status:'ready',design_html:revised,design_review:review,revision_number:revision,revision_summary:summary,revision_request:null,revision_history:[...history,{revision,feedback,review,at:new Date().toISOString()}].slice(-30),test_report:{design_preview:checked}},'revising');
  console.log('Revised design submitted for approval',proposal.id,revision);
 }else if(proposal.status==='approved_for_development'){
  await update(proposal.id,{status:'developing'},'approved_for_development');
  const h=htmlFrom(await model('You are ORXELIA engineer implementing the user-approved business. Produce ONLY complete standalone functional Japanese HTML, CSS and inline JS (no external dependencies or network). Mobile-first clear design inspired by this Gemini-reviewed visual mockup, preserve its visual hierarchy and make buttons actually work. Use localStorage, validated forms, list, delete confirmation, JSON backup and CSV export. Clearly label prototype, no real approval/contract or payment claims. Business: '+brief(proposal)+' DESIGN REVIEW: '+(proposal.design_review||'')+' DESIGN HTML: '+(proposal.design_html||'').slice(0,12000),16000),true);
  const t=await test(h,true);
  await update(proposal.id,{status:t.passed?'development_ready':'failed',prototype_html:h,test_report:{passed:t.passed,details:t,scope:'basic layout and JS errors only; end-to-end interactions, iOS, security and user demand not verified'},error_message:t.passed?null:'Browser smoke test failed'},'developing');
  console.log('Prototype test',JSON.stringify(t));
 }else if(proposal.status==='prototype_revision_requested'){
  const feedback=(proposal.prototype_revision_request||'').trim();
  if(feedback.length<3)throw Error('Missing prototype feedback');
  await update(proposal.id,{status:'prototype_revising'},'prototype_revision_requested');
  const h=htmlFrom(await model('You are ORXELIA software engineer revising an already approved PRIVATE functional prototype. Fix the user-reported issue, preserve all other working functions, make iPhone input reliable. CRITICAL: do not rerender forms during typing, including Japanese IME composition. Use safe localStorage with try/catch fallback, no external URLs or dependencies. Output ONLY complete standalone Japanese HTML/CSS/inline JavaScript. Keep working add/list/delete/export/backup and input validation. No publication or payments. User feedback: '+feedback+' ORIGINAL APP: '+(proposal.prototype_html||'').slice(0,26000)+' BUSINESS: '+brief(proposal),16000),true);
  const t=await test(h,true);
  const history=Array.isArray(proposal.prototype_revision_history)?proposal.prototype_revision_history:[];
  const version=(proposal.prototype_revision_number||1)+1;
  await update(proposal.id,{status:t.passed?'development_ready':'failed',prototype_html:h,prototype_revision_number:version,prototype_revision_request:null,prototype_revision_history:[...history,{version,feedback,passed:t.passed,at:new Date().toISOString()}].slice(-30),test_report:{passed:t.passed,details:t,scope:'basic browser smoke test only; iOS and full end-to-end functions unverified'},error_message:t.passed?null:'Revised prototype browser smoke test failed'},'prototype_revising');
  console.log('Prototype revision',proposal.id,version,'passed',t.passed);

 }else if(proposal.status==='awaiting_final_approval'){
  // Research triage is NOT a verified sales approval. Never manufacture evidence.
  const missing=Array.isArray(proposal.sales_review?.items)?proposal.sales_review.items:[];
  missing.push('顧客獲得経路の一次情報（SEO、SNS、紹介、直販）とその再現性','顧客獲得単価CAC、継続率、解約率、回収期間の実測または明示した仮説','競合の販売導線・無料代替・販売困難時の撤退条件');
  const guidance=await model('You are an internal research planner for ORXELIA. Business: '+brief(proposal)+' Missing evidence: '+JSON.stringify(missing)+'. Return a concise Japanese checklist for each gap: specific primary sources to verify, reproducible tests, and next steps. Also propose 2 low-cost acquisition experiments with measurable success and stop conditions, distinguishing facts from hypotheses. Do NOT claim web browsing, tests, customers, legal clearance, or verification. No invented URLs. Do not approve sales.',2500);
  await update(proposal.id,{sales_review:{...proposal.sales_review,recommendation:'needs_evidence',last_researched_at:new Date().toISOString(),research_plan:guidance.slice(0,6000),note:'AIが不足根拠の調査計画を更新しました。実証資料・実機テストは未完了のため販売承認不可。'}},'awaiting_final_approval');
  console.log('Research plan refreshed; sales remains blocked',proposal.id);
 }else if(proposal.status==='sales_review_requested'){
  await update(proposal.id,{status:'awaiting_final_approval',sales_review:{...proposal.sales_review,recommendation:'needs_evidence',items:['Distribution channel evidence and low-cost acquisition experiment','CAC, retention, payback and stop conditions','iPhone real-device tests','end-to-end functional testing','customer demand and competitive advantage','legal and privacy review','payment, cancellation and support design','pricing and margin verification'],note:'Sales is NOT ready. Final approval button remains disabled until verified evidence exists.'}},'sales_review_requested');
  console.log('Sales review saved: evidence missing, not ready for final approval');
 }
}catch(e){console.error('Proposal stage failed',String(e).slice(0,350));const state=(await api(idFilter(proposal.id)+'&select=status'))[0]?.status;if(['designing','revising','developing','prototype_revising'].includes(state))await update(proposal.id,{status:'failed',design_status:state==='designing'||state==='revising'?'failed':proposal.design_status,error_message:String(e).slice(0,350)},state);process.exitCode=1}
