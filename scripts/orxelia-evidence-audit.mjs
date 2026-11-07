// Evidence collector: grounded web research, reproducible smoke checks, conservative sales gate.
const base=process.env.SUPABASE_URL,secret=process.env.SUPABASE_SERVICE_ROLE_KEY,key=process.env.GEMINI_API_KEY;
if(!base||!secret||!key)throw Error('Missing required secrets');
if(new URL(base).hostname.split('.')[0]!=='yzlxcfncdtojajlhihap')throw Error('Wrong Supabase project');
const headers={apikey:secret,Authorization:'Bearer '+secret,'Content-Type':'application/json'};
async function db(path,opts={}){const r=await fetch(base+'/rest/v1/'+path,{...opts,headers:{...headers,...opts.headers}});if(!r.ok)throw Error('Supabase '+r.status+': '+(await r.text()).slice(0,250));return r.status===204?null:r.json()}
const validUrl=u=>{try{const x=new URL(u);return x.protocol==='https:'&&!!x.hostname&&!['localhost','127.0.0.1'].includes(x.hostname)}catch{return false}};
async function groundedResearch(p){
 const prompt='Research this Japanese micro-SaaS using live Google Search grounding. Return factual competitor names and official pricing URLs, real alternative workflows (Excel/LINE), customer problem evidence, unit economics assumptions, privacy/legal considerations, and concrete sales differentiation. Do not fabricate metrics, prices, customer interviews, tests, or approval. Clearly distinguish observed facts from hypotheses. Respond in Japanese. Business: '+JSON.stringify({title:p.title,brief:p.brief}).slice(0,7000);
 const r=await fetch('https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent',{method:'POST',headers:{'x-goog-api-key':key,'Content-Type':'application/json'},body:JSON.stringify({contents:[{parts:[{text:prompt}]}],tools:[{google_search:{}}],generationConfig:{temperature:0.1,maxOutputTokens:3000}}),signal:AbortSignal.timeout(90000)});
 const j=await r.json();if(!r.ok)throw Error('Grounded Gemini HTTP '+r.status+': '+JSON.stringify(j.error||{}).slice(0,200));
 const c=j.candidates?.[0];const chunks=c?.groundingMetadata?.groundingChunks||[];
 const sources=[...new Map(chunks.map(v=>v.web).filter(v=>v&&validUrl(v.uri)).map(v=>[v.uri,{url:v.uri,title:v.title||''}])).values()].slice(0,20);
 const text=c?.content?.parts?.map(v=>v.text||'').join('').trim()||'';
 if(!text||!sources.length)throw Error('No grounded sources; no review update');
 return {text:text.slice(0,14000),sources,model:'gemini-2.5-flash',collected_at:new Date().toISOString(),source_status:'search-grounded; external pages not independently audited'};
}
async function smoke(html){if(!html)return {passed:false,reason:'No prototype'};const {chromium}=await import('playwright');const b=await chromium.launch({headless:true});try{const page=await b.newPage({viewport:{width:390,height:844},isMobile:true,hasTouch:true});let errors=[];page.on('pageerror',e=>errors.push(String(e).slice(0,200)));await page.route('https://orxelia.test/**',r=>r.fulfill({status:200,contentType:'text/html',body:html}));await page.goto('https://orxelia.test/app',{waitUntil:'load'});const x=await page.evaluate(()=>({width:document.documentElement.scrollWidth,viewport:innerWidth,inputs:document.querySelectorAll('input,textarea,select').length,buttons:document.querySelectorAll('button').length}));return {passed:x.width<=x.viewport+10&&x.inputs>0&&x.buttons>0&&!errors.length,details:x,errors,scope:'Chromium mobile viewport smoke only; not iPhone or end-to-end'}}finally{await b.close()}}
const candidates=await db('orxelia_proposals?select=*&status=eq.awaiting_final_approval&order=updated_at.asc&limit=30');
const pending=candidates.filter(p=>p.sales_review?.recommendation==='needs_evidence'&&(!p.sales_review?.evidence_audit?.checked_at||Date.now()-Date.parse(p.sales_review.evidence_audit.checked_at)>20*3600000));
console.log('Pending evidence cases:',pending.length);
let failed=0;
for(const p of pending.slice(0,8)){
 try{
  const research=await groundedResearch(p);
  const test=await smoke(p.prototype_html);
  const audit={checked_at:new Date().toISOString(),research,prototype_smoke:test,unverified:['Real iPhone device tests','Full end-to-end interaction tests','Actual customer demand or paid conversions','Legal/privacy professional review','Payment, cancellation and customer support readiness','Verified price and gross margin']};
  const review={...p.sales_review,recommendation:'needs_evidence',evidence_audit:audit,note:'公開情報の根拠付き調査とブラウザ簡易テストを記録。実機・需要・法務・決済等の未検証項目が残るため販売承認は不可。'};
  const url='orxelia_proposals?id=eq.'+encodeURIComponent(p.id)+'&status=eq.awaiting_final_approval';
  const rows=await db(url,{method:'PATCH',headers:{Prefer:'return=representation'},body:JSON.stringify({sales_review:review,updated_at:new Date().toISOString()})});
  if(rows.length!==1)throw Error('Concurrent status change');
  console.log('Evidence recorded:',p.title,'sources',research.sources.length,'smoke',test.passed);
 }catch(e){failed++;console.error('Evidence failed:',p.title,String(e).slice(0,300));}
}
if(failed)process.exitCode=1;
