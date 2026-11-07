import fs from 'node:fs/promises';
import path from 'node:path';
import { chromium } from 'playwright';

const base = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
const gh = process.env.GITHUB_TOKEN;
const model = process.env.ORXELIA_MODEL || 'openai/gpt-4.1-mini';
if (!base || !key || !gh) throw new Error('Missing SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY or GITHUB_TOKEN');
const headers = {apikey:key,Authorization:'Bearer '+key,'Content-Type':'application/json'};
const rest = async (resource,options={}) => {
 const r=await fetch(base.replace(/\/$/,'')+'/rest/v1/'+resource,{...options,headers:{...headers,...options.headers}});
 if(!r.ok) throw new Error('Supabase '+r.status+': '+(await r.text()).slice(0,400));
 return r.status===204?null:r.json();
};
const modelCall=async (messages) => {
 const r=await fetch('https://models.github.ai/inference/chat/completions',{
  method:'POST',headers:{Authorization:'Bearer '+gh,'Content-Type':'application/json'},
  body:JSON.stringify({model,messages,temperature:0.2,max_tokens:8000})
 });
 if(!r.ok) throw new Error('GitHub Models '+r.status+': '+(await r.text()).slice(0,400));
 const j=await r.json();return j.choices?.[0]?.message?.content||'';
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
 result={passed:errors.length===0,errors,controls,bodyLength:text.length,checks:['page load','mobile viewport','basic input','button click','javascript errors','external requests']};
 }finally{await browser.close();}
 return result;
};
const rows=await rest('orxelia_development_jobs?select=owner_id,report_date,project,status&status=in.(queued,running)&order=created_at.asc&limit=1');
if(!rows.length){console.log('No queued jobs');process.exit(0)}
const job=rows[0];const match='owner_id=eq.'+encodeURIComponent(job.owner_id)+'&report_date=eq.'+job.report_date;
const pipelines=await rest('orxelia_pipeline?select=project,summary,phase&'+match);
if(!['development_requested','development_running'].includes(pipelines[0]?.phase))throw new Error('Job not approved');
const patch=async(table,data)=>rest(table+'?'+match,{method:'PATCH',headers:{Prefer:'return=representation'},body:JSON.stringify(data)});
await patch('orxelia_development_jobs',{status:'running',updated_at:new Date().toISOString()});
await patch('orxelia_pipeline',{phase:'development_running',updated_at:new Date().toISOString()});
const dir=path.resolve('build/orxelia-job');let last={passed:false,errors:['Not run']};let html='';
try {
 const brief='Project: '+job.project+'\nSummary: '+pipelines[0].summary;
 let messages=[
 {role:'system',content:'Create a fully functional Japanese, mobile-first single-file HTML application. Output ONLY HTML. No network calls, external scripts, fonts, libraries, iframe, forms submitting to external URLs, credentials or paid APIs. Use browser localStorage for persistence. Include accessible controls, input validation, meaningful functionality, and on-page explanation that this is a prototype, not production.'},
 {role:'user',content:brief+'\nImplement a minimal functional prototype with real working interactions. Do not invent external integration.'}
 ];
 for(let attempt=1;attempt<=3;attempt++){
  html=parseHTML(await modelCall(messages));await safeFile(html,dir);last=await testHTML(dir);
  console.log('Attempt '+attempt,JSON.stringify(last));
  if(last.passed)break;
  messages=[...messages,{role:'assistant',content:html},{role:'user',content:'Fix these test failures, return entire corrected HTML: '+JSON.stringify(last.errors)}];
 }
 const deliverables=[
 {type:'prototype',title:'AI生成試作品（非公開HTML）',status:last.passed?'generated_tested':'generated_unverified',html,generatedAt:new Date().toISOString()},
 {type:'functional_test',title:'ブラウザ自動スモークテスト',status:last.passed?'passed':'failed',results:last},
 {type:'sales_assets',title:'販売ページ・決済・解約・法務',status:'not_started'}
 ];
 await patch('orxelia_pipeline',{phase:last.passed?'development_ready':'development_running',deliverables,updated_at:new Date().toISOString()});
 await patch('orxelia_development_jobs',{status:last.passed?'completed':'failed',updated_at:new Date().toISOString()});
 if(!last.passed)process.exitCode=1;
}catch(e){
 console.error(e);
 await patch('orxelia_development_jobs',{status:'failed',updated_at:new Date().toISOString()});
 await patch('orxelia_pipeline',{phase:'development_running',deliverables:[{type:'error',title:'自動開発失敗',status:'failed',description:String(e).slice(0,450)}],updated_at:new Date().toISOString()});
 process.exitCode=1;
}
