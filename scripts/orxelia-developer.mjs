import fs from 'node:fs/promises';
import path from 'node:path';
import { chromium } from 'playwright';

const base = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
const gh = process.env.GITHUB_TOKEN;
const model = process.env.ORXELIA_MODEL || 'openai/gpt-4.1-mini';
if (!base || !key || !gh) throw new Error('Missing SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY or GITHUB_TOKEN');
const expectedProject = 'yzlxcfncdtojajlhihap';
let actualProject;
try { actualProject = new URL(base).hostname.split('.')[0]; }
catch { throw new Error('SUPABASE_URL is not a valid URL'); }
if (actualProject !== expectedProject) throw new Error('Supabase project mismatch: expected '+expectedProject+', configured '+actualProject+'. Check ORXELIA_SUPABASE_URL in GitHub Actions secrets.');
const keyKind = key.startsWith('sb_secret_') ? 'secret' : key.startsWith('eyJ') ? 'legacy-jwt' : key.startsWith('sb_publishable_') ? 'publishable' : 'unknown';
console.log('Supabase target verified:',actualProject,'key type:',keyKind);
if (keyKind === 'publishable') throw new Error('ORXELIA_SUPABASE_SERVICE_ROLE_KEY is a publishable key, not a server-side secret key');
const headers = {apikey:key,Authorization:'Bearer '+key,'Content-Type':'application/json'};
const rest = async (resource,options={}) => {
 const r=await fetch(base.replace(/\/$/,'')+'/rest/v1/'+resource,{...options,headers:{...headers,...options.headers}});
 if(!r.ok) throw new Error('Supabase '+r.status+': '+(await r.text()).slice(0,400));
 return r.status===204?null:r.json();
};
const modelCall=async (messages) => {
 const attempts=[];
 const providers=[];
 if(process.env.GEMINI_API_KEY){
  const token=process.env.GEMINI_API_KEY;
  let names=['gemini-flash-lite-latest','gemini-3.8-flash'];
  try{
   const r=await fetch('https://generativelanguage.googleapis.com/v1beta/models?pageSize=100',{headers:{'x-goog-api-key':token},signal:AbortSignal.timeout(15000)});
   if(r.ok){
    const j=await r.json();
    const available=(j.models||[]).filter(m=>m.supportedGenerationMethods?.includes('generateContent')).map(m=>m.name.replace(/^models\\//,''));
    names=[...new Set([...['gemini-flash-lite-latest','gemini-3.5-flash-lite','gemini-3.8-flash','gemini-3-flash'].filter(n=>available.includes(n)),...available.filter(n=>/flash/i.test(n)&&!/tts|image|live|audio/i.test(n)).slice(0,6)])].slice(0,7);
   }
  }catch(e){console.log('Gemini model discovery unavailable:',e.name)}
  for(const name of names)providers.push({name:'Gemini '+name,url:'https://generativelanguage.googleapis.com/v1beta/models/'+name+':generateContent',token,body:{systemInstruction:{parts:[{text:messages.find(m=>m.role==='system')?.content||'Generate working HTML.'}]},contents:[{role:'user',parts:[{text:messages.filter(m=>m.role!=='system').map(m=>m.role+': '+m.content).join('\\n\\n')}]}],generationConfig:{temperature:0.2,maxOutputTokens:16384}}});
 }
 providers.push({name:'GitHub Models',url:'https://models.github.ai/inference/chat/completions',token:gh,body:{model,messages,temperature:0.2,max_tokens:8000}});
 for(const p of providers){
  try{
   const headers=p.name.startsWith('Gemini ')?{'x-goog-api-key':p.token,'Content-Type':'application/json'}:{Authorization:'Bearer '+p.token,Accept:'application/vnd.github+json','Content-Type':'application/json','X-GitHub-Api-Version':'2022-11-28'};
   let j;let status;
   for(let attempt=1;attempt<=4;attempt++){
    let r;
    try{r=await fetch(p.url,{method:'POST',headers,body:JSON.stringify(p.body),signal:AbortSignal.timeout(45000)})}
    catch(e){
     if((e.name==='TimeoutError'||e.name==='AbortError'||e instanceof TypeError)&&attempt<4){console.log('Transient '+p.name+' network/timeout; retry '+attempt+'/3');await new Promise(resolve=>setTimeout(resolve,1500*2**(attempt-1)));continue}
     throw e;
    }
    status=r.status;
    const raw=await r.text();
    try{j=JSON.parse(raw)}catch{throw new Error('Non-JSON response (HTTP '+r.status+', type '+(r.headers.get('content-type')||'unknown')+', sample '+JSON.stringify(raw.slice(0,60))+')')}
    if(r.ok)break;
    if([429,500,502,503,504].includes(r.status)&&attempt<4){console.log('Transient '+p.name+' HTTP '+r.status+'; retry '+attempt+'/3');await new Promise(resolve=>setTimeout(resolve,1500*2**(attempt-1)));continue}
    throw new Error('HTTP '+r.status+': '+JSON.stringify(j.error?.message||j).slice(0,200));
   }
   const content=p.name.startsWith('Gemini ')?j.candidates?.[0]?.content?.parts?.map(x=>x.text||'').join(''):j.choices?.[0]?.message?.content;
   if(typeof content!=='string'||!content.trim())throw new Error('No generated text in response');
   if(p.name.startsWith('Gemini ') && j.candidates?.[0]?.finishReason==='MAX_TOKENS')throw new Error('Output truncated by model token limit');
   console.log('AI provider succeeded:',p.name);return content;
  }catch(e){attempts.push(p.name+': '+String(e).slice(0,220));console.error('AI provider failed:',p.name,String(e).slice(0,220))}
 }
 throw new Error('All configured AI providers failed: '+attempts.join(' | '));
};
const parseHTML=text=>{const match=text.match(/\`\`\`(?:html)?\s*([\s\S]*?)\`\`\`/i);return (match?match[1]:text).trim()};
const safeFile = async (html,dir) => {
 if(!/^<!doctype html>|^<html[\s>]/i.test(html)) throw new Error('AI did not return HTML');
 if(/<script[^>]+src=|<iframe|fetch\s*\(|XMLHttpRequest|<form[^>]+action=|document\.cookie|localStorage\.getItem\s*\(\s*['"](?:token|secret)/i.test(html)) throw new Error('Potential external dependency or unsafe code');
 await fs.mkdir(dir,{recursive:true});await fs.writeFile(path.join(dir,'index.html'),html);
};
const testHTML=async dir=>{
 const browser=await chromium.launch({headless:true});const errors=[];let result;
 try {
 const page=await browser.newPage({viewport:{width:390,height:844},isMobile:true,hasTouch:true});
 page.on('pageerror',e=>errors.push(e.message));
 page.on('request',req=>{if(!req.url().startsWith('file:')&&!req.url().startsWith('data:'))errors.push('External request: '+req.url())});
 await page.goto('file://'+path.resolve(dir,'index.html'),{waitUntil:'load'});
 const text=(await page.locator('body').innerText()).trim();
 if(text.length<35)errors.push('Blank or incomplete UI');
 const controls=await page.locator('button,input,textarea,select').count();
 if(!controls)errors.push('No interactive controls');
 const inputs=page.locator('input:not([type=hidden]):not([type=file]),textarea');
 if(await inputs.count()) {const first=inputs.first(); const type=await first.getAttribute('type'); await first.fill(type==='number'?'12':'ORXELIA テスト').catch(e=>errors.push('Input interaction: '+e.message.slice(0,130)));}
 if(await page.locator('button').count()) {await page.locator('button').first().click({timeout:3000}).catch(e=>errors.push('Button interaction: '+e.message.slice(0,130)));}
 await page.waitForTimeout(250);
 if((await page.title()).includes('空調試運転メモ')){
  try{
   await page.locator('#site').fill('テスト現場');
   await page.locator('#unit').fill('室内機A');
   await page.locator('#intake').fill('27');
   await page.locator('#outlet').fill('15');
   await page.locator('#speed').fill('2.5');
   await page.locator('#recordForm button[type=submit]').click();
   if(!(await page.locator('#count').innerText()).includes('1'))errors.push('Save did not increase record count');
   if(!(await page.locator('#result').innerText()).includes('12'))errors.push('Temperature difference calculation failed');
   await page.reload();
   if(!(await page.locator('#count').innerText()).includes('1'))errors.push('Persistence after reload failed');
   const downloadPromise=page.waitForEvent('download',{timeout:5000});
   await page.locator('#csv').click();
   const download=await downloadPromise;
   if(!download.suggestedFilename().endsWith('.csv'))errors.push('CSV filename missing');
   await page.locator('#rows button[data-id]').first().click();
   if(!(await page.locator('#count').innerText()).includes('0'))errors.push('Delete failed');
  }catch(e){errors.push('HVAC functional tests: '+e.message.slice(0,180))}
 }
 result={passed:errors.length===0,errors,controls,bodyLength:text.length,checks:['page load','mobile viewport','basic input','button click','javascript errors','external requests',...(text.includes('空調試運転メモ')?['HVAC save','temperature difference','reload persistence','CSV download','delete']:[])]};
 }finally{await browser.close();}
 return result;
};
const visibleJobs=await rest('orxelia_development_jobs?select=owner_id,report_date,project,status,created_at&order=created_at.asc&limit=100');
console.log('Development jobs visible via REST:',visibleJobs.length,'status counts:',JSON.stringify(visibleJobs.reduce((a,j)=>(a[j.status]=(a[j.status]||0)+1,a),{})));
const rows=visibleJobs.filter(j=>j.status==='queued'||j.status==='running').slice(0,1);
if(!rows.length){console.log('No queued jobs currently visible via REST; no development attempted.');process.exit(0)}
const job=rows[0];const match='owner_id=eq.'+encodeURIComponent(job.owner_id)+'&report_date=eq.'+job.report_date;
const pipelines=await rest('orxelia_pipeline?select=project,summary,phase&'+match);
if(!['development_requested','development_running'].includes(pipelines[0]?.phase))throw new Error('Job not approved');
const patch=async(table,data)=>rest(table+'?'+match,{method:'PATCH',headers:{Prefer:'return=representation'},body:JSON.stringify(data)});
await patch('orxelia_development_jobs',{status:'running',updated_at:new Date().toISOString()});
await patch('orxelia_pipeline',{phase:'development_running',updated_at:new Date().toISOString()});
const dir=path.resolve('build/orxelia-job');let last={passed:false,errors:['Not run']};let html='';let generationMethod='ai_generated';
try {
 const brief='Project: '+job.project+'\\nSummary: '+pipelines[0].summary;
 const designBrief='Design direction: ORXELIA clean Japanese iPhone UI. White/light gray background, clear blue gradient KPI summary, large legible totals, rounded white record cards, status pills, bottom navigation (Home, Records, Add), generous tap targets, high contrast, accessible labels. Prioritize clarity over decoration. Keep all data handling and legal disclaimers functional; never invent approval or payment status. Responsive and dependency-free.';
 console.log('Design guidance enabled: ORXELIA mobile-first reference style.');
 let messages=[
 {role:'system',content:'Create a fully functional Japanese, mobile-first single-file HTML application. Output ONLY HTML. No network calls, external scripts, fonts, libraries, iframe, forms submitting to external URLs, credentials or paid APIs. Use browser localStorage for persistence. Include accessible controls, input validation, meaningful functionality, and on-page explanation that this is a prototype, not production.'},
 {role:'user',content:brief+'\n'+designBrief+'\nImplement a minimal functional prototype with real working interactions. Do not invent external integration.'}
 ];
 for(let attempt=1;attempt<=3;attempt++){
  try { html=parseHTML(await modelCall(messages)); }
  catch(modelError) {
   console.error('AI inference unavailable:',String(modelError).slice(0,450));
   if(attempt!==1 || !/空調試運転メモ/.test(job.project)) throw modelError;
   html=await fs.readFile(path.resolve('scripts/templates/hvac-trial.html'),'utf8');
   generationMethod='verified_template_fallback';
   console.log('Using explicit offline template fallback; this is NOT AI-generated.');
  }
  await safeFile(html,dir);last=await testHTML(dir);
  console.log('Attempt '+attempt,JSON.stringify(last));
  if(last.passed)break;
  if(generationMethod==='verified_template_fallback')throw new Error('Offline template failed browser test: '+JSON.stringify(last.errors));
  messages=[...messages,{role:'assistant',content:html},{role:'user',content:'Fix these test failures, return entire corrected HTML: '+JSON.stringify(last.errors)}];
 }
 const deliverables=[
 {type:'prototype',title:generationMethod==='ai_generated'?'AI生成試作品（非公開HTML）':'既存テンプレートによる動作試作（AI生成ではありません）',generationMethod,status:last.passed?'generated_tested':'generated_unverified',html,generatedAt:new Date().toISOString()},
 {type:'functional_test',title:'ブラウザ自動スモークテスト',status:last.passed?'passed':'failed',results:last},
 {type:'sales_assets',title:'販売ページ・決済・解約・法務',status:'not_started'}
 ];
 await patch('orxelia_pipeline',{phase:last.passed?'development_ready':'development_running',deliverables,updated_at:new Date().toISOString()});
 console.log('Prototype result:',generationMethod,last.passed?'browser_test_passed':'browser_test_failed');
 await patch('orxelia_development_jobs',{status:last.passed?'completed':'failed',updated_at:new Date().toISOString()});
 if(!last.passed)process.exitCode=1;
}catch(e){
 console.error(e);
 await patch('orxelia_development_jobs',{status:'failed',updated_at:new Date().toISOString()});
 await patch('orxelia_pipeline',{phase:'development_running',deliverables:[{type:'error',title:'自動開発失敗',status:'failed',description:String(e).slice(0,450)}],updated_at:new Date().toISOString()});
 process.exitCode=1;
}
