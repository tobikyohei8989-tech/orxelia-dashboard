import fs from 'node:fs/promises';
import { chromium } from 'playwright';
const key=process.env.GEMINI_API_KEY;
if(!key)throw Error('GEMINI_API_KEY is not configured');
const root='https://generativelanguage.googleapis.com/v1beta';
const headers={'x-goog-api-key':key,'Content-Type':'application/json'};
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function request(url,opts={},timeout=20000){
 const r=await fetch(url,{...opts,headers,signal:AbortSignal.timeout(timeout)});
 const raw=await r.text();let j;
 try{j=JSON.parse(raw)}catch{throw Error('Gemini returned non-JSON HTTP '+r.status)}
 return {status:r.status,ok:r.ok,j};
}
const list=await request(root+'/models?pageSize=100');
if(!list.ok)throw Error('Gemini models discovery HTTP '+list.status+': '+String(list.j.error?.message||'').slice(0,160));
const available=(list.j.models||[]).filter(m=>m.supportedGenerationMethods?.includes('generateContent')).map(m=>m.name.replace(/^models\//,''));
const candidates=[...new Set([...['gemini-3.8-flash','gemini-3-flash','gemini-2.5-flash-lite','gemini-2.0-flash-lite'].filter(m=>available.includes(m)),...available.filter(m=>/flash/i.test(m)).slice(0,6)])].slice(0,7);
console.log('Available compatible models:',candidates.join(', ')||'(none)');
if(!candidates.length)throw Error('No supported preferred Gemini model returned by models discovery');
let passed=false;
for(const model of candidates){
 for(let attempt=1;attempt<=2;attempt++){
  try{
   const {status,ok,j}=await request(root+'/models/'+model+':generateContent',{method:'POST',body:JSON.stringify({contents:[{role:'user',parts:[{text:'Return only a minimal valid HTML document containing a Japanese heading and one button.'}]}],generationConfig:{temperature:0,maxOutputTokens:2048}})},25000);
   if(ok){
    const out=j.candidates?.[0]?.content?.parts?.map(p=>p.text||'').join('')||'';
    if(/<html[\s>]|<!doctype html/i.test(out)){console.log('Gemini smoke test PASSED; model:',model,'HTML chars:',out.length);await fs.mkdir('build/gemini-smoke',{recursive:true});await fs.writeFile('build/gemini-smoke/index.html',out);passed=true;break}
    console.log('Model returned no valid HTML:',model,'finishReason:',j.candidates?.[0]?.finishReason);
    break;
   }
   console.log('Gemini model',model,'HTTP',status,'attempt',attempt,'reason:',String(j.error?.message||'').slice(0,180));
   if(![429,500,502,503,504].includes(status))break;
  }catch(e){console.log('Gemini model',model,'request error:',e.name)}
  if(attempt<2)await sleep(1500);
 }
 if(passed)break;
}
if(!passed)throw Error('No Gemini model completed HTML generation; inspect model availability/quota');

const browser=await chromium.launch({headless:true});
try{
 const page=await browser.newPage({viewport:{width:390,height:844},isMobile:true});
 const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto('file://'+process.cwd()+'/build/gemini-smoke/index.html');
 const body=await page.locator('body').innerText();
 const buttons=await page.locator('button').count();
 if(body.length<5||buttons<1||errors.length)throw Error('Generated HTML browser test failed: '+JSON.stringify({length:body.length,buttons,errors}));
 console.log('Generated HTML browser test PASSED; buttons:',buttons);
}finally{await browser.close()}
