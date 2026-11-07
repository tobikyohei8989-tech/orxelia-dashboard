// Evidence collector: grounded web research, reproducible smoke checks, conservative sales gate.
const base=process.env.SUPABASE_URL,secret=process.env.SUPABASE_SERVICE_ROLE_KEY,key=process.env.GEMINI_API_KEY;
if(!base||!secret||!key)throw Error('Missing required secrets');
if(new URL(base).hostname.split('.')[0]!=='yzlxcfncdtojajlhihap')throw Error('Wrong Supabase project');
const headers={apikey:secret,Authorization:'Bearer '+secret,'Content-Type':'application/json'};
async function db(path,opts={}){const r=await fetch(base+'/rest/v1/'+path,{...opts,headers:{...headers,...opts.headers}});if(!r.ok)throw Error('Supabase '+r.status+': '+(await r.text()).slice(0,250));return r.status===204?null:r.json()}
const validUrl=u=>{try{const x=new URL(u);return x.protocol==='https:'&&!!x.hostname&&!['localhost','127.0.0.1'].includes(x.hostname)}catch{return false}};
async function groundedResearch(p){
 const prompt='Research this Japanese micro-SaaS using live Google Search grounding. Return factual competitor names and official pricing URLs, real alternative workflows (Excel/LINE), customer problem evidence, unit economics assumptions, privacy/legal considerations, and concrete sales differentiation. Do not fabricate metrics, prices, customer interviews, tests, or approval. Clearly distinguish observed facts from hypotheses. Respond in Japanese. Business: '+JSON.stringify({title:p.title,brief:p.brief}).slice(0,7000);
 const r=await fetch('https://generativelanguage.googleapis.com/v1beta/interactions',{method:'POST',headers:{'x-goog-api-key':key,'Content-Type':'application/json'},body:JSON.stringify({model:'gemini-3.8-flash',input:prompt,tools:[{type:'google_search'}]}),signal:AbortSignal.timeout(90000)});
 const j=await r.json();if(!r.ok)throw Error('Grounded Gemini HTTP '+r.status+': '+JSON.stringify(j.error||{}).slice(0,200));
 const parts=(j.outputs||j.output||[]);const steps=j.steps||[];
 const text=[j.output_text,...parts.flatMap(v=>[v.text,...(v.content||[]).map(x=>x.text)]),...steps.flatMap(v=>(v.output||[]).map(x=>x.text))].filter(v=>typeof v==='string').join('\n').trim();
 const citations=[...parts,...steps].flatMap(v=>[...(v.annotations||[]),...(v.content||[]).flatMap(c=>c.annotations||[])]);
 const candidates=[...citations.map(v=>v.url_citation?.url||v.url||v.uri),...steps.flatMap(v=>(v.results||[]).map(x=>x.url))];
 const sources=[...new Map(candidates.filter(validUrl).map(url=>[url,{url,title:''}])).values()].slice(0,20);
 if(!text)throw Error('No research text returned; inspect interactions response shape');
 return {text:text.slice(0,14000),sources,model:'gemini-3.8-flash',collected_at:new Date().toISOString(),source_status:sources.length?'search-grounded; external pages not independently audited':'no source URLs returned; treat all claims as unverified'};
}
async function smoke(html){if(!html)return {passed:false,reason:'No prototype'};const {chromium}=await import('playwright');const b=await chromium.launch({headless:true});try{const page=await b.newPage({viewport:{width:390,height:844},isMobile:true,hasTouch:true});let errors=[];page.on('pageerror',e=>errors.push(String(e).slice(0,200)));await page.route('https://orxelia.test/**',r=>r.fulfill({status:200,contentType:'text/html',body:html}));await page.goto('https://orxelia.test/app',{waitUntil:'load'});const x=await page.evaluate(()=>({width:document.documentElement.scrollWidth,viewport:innerWidth,inputs:document.querySelectorAll('input,textarea,select').length,buttons:document.querySelectorAll('button').length}));return {passed:x.width<=x.viewport+10&&x.inputs>0&&x.buttons>0&&!errors.length,details:x,errors,scope:'Chromium mobile viewport smoke only; not iPhone or end-to-end'}}finally{await b.close()}}
const candidates=await db('orxelia_proposals?select=*&status=eq.awaiting_final_approval&order=updated_at.asc&limit=30');
const pending=candidates.filter(p=>p.sales_review?.recommendation==='needs_evidence'&&(!p.sales_review?.evidence_audit?.checked_at||p.sales_review?.evidence_audit?.research_error||!p.sales_review?.evidence_audit?.research?.sources?.length&&Date.now()-Date.parse(p.sales_review.evidence_audit.checked_at)>20*3600000));
console.log('Pending evidence cases:',pending.length);
let failed=0;
for(const p of pending.slice(0,8)){
 try{
  let research=null,researchError=null;
  try{research=await groundedResearch(p)}catch(e){researchError=String(e).slice(0,350);failed++}
  let test={passed:false,reason:'Not run'};
  try{test=await smoke(p.prototype_html)}catch(e){test={passed:false,reason:String(e).slice(0,300)};failed++}
  const price=Number(String(p.brief?.pricing_hypothesis||'').match(/[0-9][0-9,]*/)?.[0].replaceAll(',','')||0);
  const scenarios=price>0?[10,30,100].map(customers=>({customers,monthly_revenue_yen:customers*price,assumption:'Revenue only; costs and conversion are unverified'})):[];
  const audit={checked_at:new Date().toISOString(),research,research_error:researchError,prototype_smoke:test,pricing_scenarios:scenarios,unverified:['Real iPhone device tests','Full end-to-end interaction tests','Actual customer demand or paid conversions','Legal/privacy professional review','Payment, cancellation and customer support readiness','Verified gross margin and acquisition cost']};
  const isInternal=String(p.brief?.problem||'').includes('動作検証専用')||String(p.title).includes('自動開発動作検証');
  const recommendation=isInternal?'internal_test_only':'needs_evidence';
  const review={...p.sales_review,recommendation,evidence_audit:audit,note:isInternal?'内部動作検証専用。販売・公開は不可。':research?.sources?.length?'競合調査の参照URLとブラウザ簡易検査を記録しました。販売条件は未充足です。':'調査または根拠URL取得に問題がありました。販売根拠は未確認です。'};
  const url='orxelia_proposals?id=eq.'+encodeURIComponent(p.id)+'&status=eq.awaiting_final_approval';
  const rows=await db(url,{method:'PATCH',headers:{Prefer:'return=representation'},body:JSON.stringify({sales_review:review,updated_at:new Date().toISOString()})});
  if(rows.length!==1)throw Error('Concurrent status change');
  console.log('Audit recorded:',p.title,'sources',research?.sources?.length||0,'smoke',test.passed,'researchError',researchError||'none');
 }catch(e){failed++;console.error('Evidence failed:',p.title,String(e).slice(0,300));}
}
if(failed)process.exitCode=1;
