import {createHash} from "node:crypto";
import {readFile} from "node:fs/promises";
import {qualityBrief,checkPrototypeQuality} from './prototype-quality.mjs';
import {chromium} from 'playwright';
const base=process.env.SUPABASE_URL,secret=process.env.SUPABASE_SERVICE_ROLE_KEY,gemini=process.env.GEMINI_API_KEY;
if(!base||!secret)throw Error('Supabase server secrets required');
if(new URL(base).hostname.split('.')[0]!=='yzlxcfncdtojajlhihap')throw Error('Supabase project mismatch');
const headers={apikey:secret,Authorization:'Bearer '+secret,'Content-Type':'application/json'};
async function api(path,options={}){const r=await fetch(base+'/rest/v1/'+path,{...options,headers:{...headers,...options.headers}});if(!r.ok)throw Error('DB HTTP '+r.status+' '+(await r.text()).slice(0,240));return r.status===204?null:r.json()}
const idFilter=id=>'orxelia_proposals?id=eq.'+encodeURIComponent(id);
async function update(id,fields,expected){const rows=await api(idFilter(id)+'&status=eq.'+encodeURIComponent(expected),{method:'PATCH',headers:{Prefer:'return=representation'},body:JSON.stringify({...fields,updated_at:new Date().toISOString()})});if(rows.length!==1)throw Error('Stage changed concurrently');return rows[0]}
async function model(prompt,max=5500){if(!gemini)throw Error('Gemini key missing');const names=['gemini-flash-lite-latest','gemini-3.8-flash'];let failures=[];for(const name of names){for(let attempt=0;attempt<2;attempt++){try{const r=await fetch('https://generativelanguage.googleapis.com/v1beta/models/'+name+':generateContent',{method:'POST',headers:{'x-goog-api-key':gemini,'Content-Type':'application/json'},body:JSON.stringify({contents:[{parts:[{text:prompt}]}],generationConfig:{temperature:0.25,maxOutputTokens:max}}),signal:AbortSignal.timeout(45000)});const j=await r.json();if(!r.ok){failures.push(name+' HTTP '+r.status);if([429,500,503].includes(r.status)&&attempt===0)continue;break}if(j.candidates?.[0]?.finishReason==='MAX_TOKENS')throw Error('truncated');const text=j.candidates?.[0]?.content?.parts?.map(p=>p.text||'').join('');if(text?.trim())return text;throw Error('empty model response')}catch(e){failures.push(name+' '+String(e).slice(0,90))}}}throw Error('Gemini unavailable: '+failures.join('; '))}
const htmlFrom=(t,allowScripts=false)=>{const m=t.match(/<!doctype html[\s\S]*?<\/html>/i)||t.match(/<html[\s\S]*?<\/html>/i);if(!m)throw Error('AI did not return complete HTML');const h=m[0];if(h.length>120000)throw Error('HTML too large');if(new RegExp(allowScripts?'(<iframe\\b|<object\\b|<embed\\b|<form[^>]*action\\s*=|https?:\\/\\/)':'(<script\\b|<iframe\\b|<object\\b|<embed\\b|<form[^>]*action\\s*=|https?:\\/\\/)','i').test(h))throw Error(allowScripts?'Prototype must be offline: external URLs, embedded documents and form actions are forbidden':'Design preview must be static and offline: scripts, external URLs, embedded documents and form actions are forbidden');return h};
let latestQuality=null;
async function generateHtml(prompt,max,allowScripts=false){
 let reason='';
 for(let attempt=0;attempt<3;attempt++){
  const output=await model(prompt+'\n'+qualityBrief+(reason?'\nPrevious output was rejected: '+reason+'. Regenerate the complete HTML. Use only inline CSS'+(allowScripts?' and inline JavaScript':' without JavaScript')+'; no CDN, web fonts, remote images, external URLs, iframe/object/embed or form actions.':''),max);
  try{
   const html=htmlFrom(output,allowScripts);
   const quality=await checkPrototypeQuality(html,{interactive:allowScripts,artifactDir:'build/prototype-quality/proposal-attempt-'+attempt});
   if(!quality.passed)throw Error('Submission quality gate: '+JSON.stringify(quality.errors));
   latestQuality=quality;
   return html;
  }catch(e){
   reason=String(e.message);
   if(attempt===2)throw e;
   console.warn('Generated HTML rejected; retrying',attempt+1,reason);
  }
 }
}

async function test(html,interactive=false){const browser=await chromium.launch({headless:true});try{const page=await browser.newPage({viewport:{width:390,height:844},isMobile:true,hasTouch:true});const errors=[];page.on('pageerror',e=>errors.push(String(e)));await page.route('https://orxelia.test/**',route=>route.fulfill({status:200,contentType:'text/html; charset=utf-8',body:html}));await page.goto('https://orxelia.test/preview',{waitUntil:'load'});const result=await page.evaluate(()=>({width:document.documentElement.scrollWidth,viewport:innerWidth,text:document.body.innerText.length,buttons:document.querySelectorAll('button').length,inputs:document.querySelectorAll('input,textarea,select').length}));return {passed:result.text>100&&result.width<=result.viewport+10&&(!interactive||result.inputs>=2&&result.buttons>=1)&&!errors.length,...result,errors}}finally{await browser.close()}}
const brief=p=>JSON.stringify({title:p.title,problem:p.brief?.problem,solution:p.brief?.solution,target:p.brief?.target,references:p.brief?.references,competitive_position:p.brief?.competitive_position});
async function buildPreapprovalTrial(proposal, design, designRevision) {
 const html = await generateHtml(
  'Build an offline, private evaluation prototype in Japanese. Implement the main workflow using fictitious sample data, validated inputs and a working list. Label it 開発許可前の非公開試作. No network, real personal data, publication, payments or external dependencies. Output standalone HTML, CSS and inline JavaScript only. Request: '+brief(proposal)+' Design: '+design.slice(0,12000),
  16000,true);
 const check = await test(html,true);
 if (!check.passed) throw Error('Private prototype browser test failed');
 return {html,report:{passed:true,design_revision:designRevision,browser:check,submission_quality:latestQuality}};
}
// Process pending proposal stages, including legacy dashboard projects migrated into the approval-gated workflow.
const readyStages = new Set(['prototype_revision_requested', 'approved_for_development', 'sales_review_requested', 'revision_requested']);
function isReady(candidate, now) {
 if (readyStages.has(candidate.status)) return true;
 if (candidate.status === 'awaiting_selection') return candidate.design_status === 'pending';
 if (candidate.status !== 'awaiting_final_approval' || candidate.recommendation !== 'needs_evidence') return false;
 return !candidate.last_researched_at || now - Date.parse(candidate.last_researched_at) > 20 * 60 * 60 * 1000;
}
function rank(candidate) {
 const value = Number(candidate.priority_rank);
 return Number.isSafeInteger(value) && value > 0 ? value : 99;
}
async function selectProposal() {
 const query = 'orxelia_proposals?select=id,status,design_status,priority_rank:brief->>priority_rank,recommendation:sales_review->>recommendation,last_researched_at:sales_review->>last_researched_at&brief->>dashboard_deleted_at=is.null&status=in.(awaiting_selection,revision_requested,approved_for_development,prototype_revision_requested,sales_review_requested,awaiting_final_approval)&order=created_at.asc,id.asc';
 const now = Date.now();
 let best;
 const pageSize = 100;
 for (let offset = 0; !best || !readyStages.has(best.status) || rank(best) !== 1; offset += pageSize) {
  const candidates = await api(`${query}&limit=${pageSize}&offset=${offset}`);
  for (const candidate of candidates) {
   if (!isReady(candidate, now)) continue;
   const tier = candidate.status === 'awaiting_final_approval' ? 1 : 0;
   const bestTier = best?.status === 'awaiting_final_approval' ? 1 : 0;
   if (!best || tier < bestTier || (tier === bestTier && rank(candidate) < rank(best))) best = candidate;
  }
  if (candidates.length < pageSize) break;
 }
 if (!best) return undefined;
 const [current] = await api(`${idFilter(best.id)}&status=eq.${encodeURIComponent(best.status)}&brief->>dashboard_deleted_at=is.null&select=*`);
 return current;
}
async function dailyPrototype() {
 const owner = process.env.ORXELIA_DAILY_PROPOSAL_OWNER_ID;
 if (!owner) return;
 if (!/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(owner)) throw Error('Invalid daily proposal owner ID');
 const feed = JSON.parse(await readFile(new URL('../ai-reports/latest.json', import.meta.url), 'utf8'));
 const day = new Intl.DateTimeFormat('sv-SE', {timeZone:'Asia/Tokyo'}).format(new Date());
 const idea = feed.reports?.find(report => report.researchedAt === day && report.idea?.research)?.idea;
 if (!idea || !Array.isArray(idea.sources) || idea.sources.length < 2) return;
 const hex = createHash('sha256').update(owner + ':' + day).digest('hex');
 const id = [hex.slice(0,8),hex.slice(8,12),hex.slice(12,16),hex.slice(16,20),hex.slice(20,32)].join('-');
 await api('orxelia_proposals?on_conflict=id', {
  method:'POST', headers:{Prefer:'resolution=ignore-duplicates,return=minimal'},
  body:JSON.stringify({
   id,owner_id:owner,title:idea.name,status:'awaiting_selection',design_status:'pending',
   brief:{source:'daily_researched_idea',research_date:day,problem:idea.customer,target:idea.customer,
    solution:[idea.offer,idea.next].join('\n'),competitive_position:idea.advantage,
    references:[idea.research,...idea.sources].join('\n').slice(0,3000)}
  })
 });
 const [queued] = await api(idFilter(id)+'&owner_id=eq.'+owner+'&status=eq.awaiting_selection&design_status=eq.pending&brief->>dashboard_deleted_at=is.null&select=*');
 return queued;
}
const proposal = await dailyPrototype() ?? await selectProposal();
if(!proposal){console.log('No proposal stage work pending');process.exit(0)}
console.log('Processing proposal',proposal.id,'stage',proposal.status);
try{
 if(proposal.status==='awaiting_selection'){
  await update(proposal.id,{status:'designing',design_status:'generating'},'awaiting_selection');
  const h=await generateHtml('You are Gemini, the ORXELIA UI designer. Produce ONLY complete standalone Japanese HTML/CSS for a STATIC MOBILE-FIRST DESIGN MOCKUP. No JavaScript, no external URLs, no remote assets. Clearly label as デザイン案（操作できません）. Show KPI card, record cards, and bottom navigation as visual mockup. Never invent real customer results or actual approval. This is NOT a functional app. Business: '+brief(proposal),7000);
  const t=await test(h);
  if(!t.passed)throw Error('Design browser check failed '+JSON.stringify(t));
  const feedback=await model('You are an independent Gemini UX reviewer. In Japanese give up to 5 concrete improvements to this mobile design; prioritize clarity and accessibility. No claim of functional testing. HTML: '+h.slice(0,18000),1100);
  const designQuality = latestQuality;
  const trial = await buildPreapprovalTrial(proposal,h,proposal.revision_number||1);
  await update(proposal.id,{status:'awaiting_first_approval',design_status:'ready',design_html:h,design_review:feedback.slice(0,3000),prototype_html:trial.html,test_report:{design_preview:t,submission_quality:designQuality,preapproval_trial:trial.report}},'designing');
  console.log('Design preview saved, awaiting first approval');
 }else if(proposal.status==='revision_requested'){
  const feedback=(proposal.revision_request||'').trim();
  if(feedback.length<3)throw Error('Missing revision feedback');
  await update(proposal.id,{status:'revising'},'revision_requested');
  const revised=await generateHtml('You are Gemini, revising a PRE-APPROVAL STATIC MOBILE DESIGN MOCKUP. Follow user feedback while preserving the original business purpose. Output ONLY complete standalone Japanese HTML/CSS; no JavaScript, URLs, or remote assets. Clearly label デザイン案（操作できません）. User feedback: '+feedback+' ORIGINAL DESIGN: '+(proposal.design_html||'').slice(0,21000)+' ORIGINAL BUSINESS: '+brief(proposal),10000);
  const checked=await test(revised);
  if(!checked.passed)throw Error('Revised design browser check failed '+JSON.stringify(checked));
  const review=await model('You are an independent Gemini UX reviewer. In Japanese briefly evaluate whether the requested changes were reflected, identify unresolved items, and list concrete UX concerns. User request: '+feedback+' Revised design: '+revised.slice(0,18000),1600);
  const history=Array.isArray(proposal.revision_history)?proposal.revision_history:[];
  const revision=(proposal.revision_number||1)+1;
  const summary='修正指示：'+feedback.slice(0,700)+' / Geminiレビュー：'+review.slice(0,1200);
  const designQuality = latestQuality;
  const trial = await buildPreapprovalTrial(proposal,revised,revision);
  await update(proposal.id,{status:'awaiting_first_approval',design_status:'ready',design_html:revised,design_review:review,revision_number:revision,revision_summary:summary,revision_request:null,revision_history:[...history,{revision,feedback,review,at:new Date().toISOString()}].slice(-30),prototype_html:trial.html,test_report:{design_preview:checked,submission_quality:designQuality,preapproval_trial:trial.report}},'revising');
  console.log('Revised design submitted for approval',proposal.id,revision);
 }else if(proposal.status==='approved_for_development'){
  await update(proposal.id,{status:'developing'},'approved_for_development');
  const h=await generateHtml('You are ORXELIA engineer implementing the user-approved business. Produce ONLY complete standalone functional Japanese HTML, CSS and inline JS (no external dependencies or network). Mobile-first clear design inspired by this Gemini-reviewed visual mockup, preserve its visual hierarchy and make buttons actually work. Use localStorage, validated forms, list, delete confirmation, JSON backup and CSV export. Clearly label prototype, no real approval/contract or payment claims. Business: '+brief(proposal)+' DESIGN REVIEW: '+(proposal.design_review||'')+' DESIGN HTML: '+(proposal.design_html||'').slice(0,12000),16000,true);
  const t=await test(h,true);
  await update(proposal.id,{status:t.passed?'development_ready':'failed',...(t.passed?{prototype_html:h}:{}),test_report:{passed:t.passed&&latestQuality?.passed===true,details:t,submission_quality:latestQuality,scope:'Desktop/mobile screenshots and core record workflow verified; business-specific functions, real iOS, security and demand remain separate'},error_message:t.passed?null:'Browser smoke test failed'},'developing');
  console.log('Prototype test',JSON.stringify(t));
 }else if(proposal.status==='prototype_revision_requested'){
  const feedback=(proposal.prototype_revision_request||'').trim();
  if(feedback.length<3)throw Error('Missing prototype feedback');
  await update(proposal.id,{status:'prototype_revising'},'prototype_revision_requested');
  const h=await generateHtml('You are ORXELIA software engineer revising an already approved PRIVATE functional prototype. Fix the user-reported issue, preserve all other working functions, make iPhone input reliable. CRITICAL: do not rerender forms during typing, including Japanese IME composition. Use safe localStorage with try/catch fallback, no external URLs or dependencies. Output ONLY complete standalone Japanese HTML/CSS/inline JavaScript. Keep working add/list/delete/export/backup and input validation. No publication or payments. User feedback: '+feedback+' ORIGINAL APP: '+(proposal.prototype_html||'').slice(0,26000)+' BUSINESS: '+brief(proposal),16000,true);
  const t=await test(h,true);
  const history=Array.isArray(proposal.prototype_revision_history)?proposal.prototype_revision_history:[];
  const version=(proposal.prototype_revision_number||1)+1;
  await update(proposal.id,{status:t.passed?'development_ready':'failed',...(t.passed?{prototype_html:h}:{}),prototype_revision_number:version,prototype_revision_request:null,prototype_revision_history:[...history,{version,feedback,passed:t.passed,at:new Date().toISOString()}].slice(-30),test_report:{passed:t.passed&&latestQuality?.passed===true,details:t,submission_quality:latestQuality,scope:'Desktop/mobile screenshots and core record workflow verified; real iOS and business-specific functions remain separate'},error_message:t.passed?null:'Revised prototype browser smoke test failed'},'prototype_revising');
  console.log('Prototype revision',proposal.id,version,'passed',t.passed);

 }else if(proposal.status==='awaiting_final_approval'){
  // Research triage is NOT a verified sales approval. Never manufacture evidence.
  const missing=Array.isArray(proposal.sales_review?.items)?[...proposal.sales_review.items]:[];
  missing.push('顧客獲得経路の一次情報（SEO、SNS、紹介、直販）とその再現性','顧客獲得単価CAC、継続率、解約率、回収期間の実測または明示した仮説','競合の販売導線・無料代替・販売困難時の撤退条件');
  const guidance=await model('You are an internal research planner for ORXELIA. Business: '+brief(proposal)+' Missing evidence: '+JSON.stringify(missing)+'. Return a concise Japanese checklist for each gap: specific primary sources to verify, reproducible tests, and next steps. Include a Japanese pre-sale legal checklist tailored to the proposal: permissions, trademark, copyright, terms, personal data, sales disclosures and security. For each, identify draft documents, official authorities or evidence to check, and unresolved questions. Then propose 2 low-cost acquisition experiments with measurable success and stop conditions, distinguishing facts from hypotheses. Do NOT claim web browsing, tests, customers, legal clearance, or verification. No invented URLs. Do not approve sales.',2500);
  await update(proposal.id,{sales_review:{...proposal.sales_review,recommendation:'needs_evidence',last_researched_at:new Date().toISOString(),research_plan:guidance.slice(0,6000),note:'AIが不足根拠の調査計画を更新しました。実証資料・実機テストは未完了のため販売承認不可。'}},'awaiting_final_approval');
  console.log('Research plan refreshed; sales remains blocked',proposal.id);
 }else if(proposal.status==='sales_review_requested'){
  await update(proposal.id,{status:'awaiting_final_approval',sales_review:{...proposal.sales_review,recommendation:'needs_evidence',items:['Distribution channel evidence and low-cost acquisition experiment','CAC, retention, payback and stop conditions','iPhone real-device tests','end-to-end functional testing','customer demand and competitive advantage','legal and privacy review','payment, cancellation and support design','pricing and margin verification'],note:'Sales is NOT ready. Final approval button remains disabled until verified evidence exists.'}},'sales_review_requested');
  console.log('Sales review saved: evidence missing, not ready for final approval');
 }
}catch(e){console.error('Proposal stage failed',String(e).slice(0,350));const state=(await api(idFilter(proposal.id)+'&select=status'))[0]?.status;if(['designing','revising','developing','prototype_revising'].includes(state))await update(proposal.id,{status:'failed',design_status:state==='designing'||state==='revising'?'failed':proposal.design_status,error_message:String(e).slice(0,350)},state);process.exitCode=1}
