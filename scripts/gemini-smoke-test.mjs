const key=process.env.GEMINI_API_KEY;
if(!key)throw Error('GEMINI_API_KEY is not configured');
const url='https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent';
const r=await fetch(url,{method:'POST',headers:{'x-goog-api-key':key,'Content-Type':'application/json'},body:JSON.stringify({contents:[{role:'user',parts:[{text:'Return only a minimal valid HTML document containing a Japanese heading and one button.'}]}],generationConfig:{temperature:0,maxOutputTokens:2048,thinkingConfig:{thinkingBudget:0}}}),signal:AbortSignal.timeout(60000)});
const raw=await r.text();let j;try{j=JSON.parse(raw)}catch{throw Error('Gemini returned non-JSON HTTP '+r.status+' content-type '+r.headers.get('content-type'))}
if(!r.ok)throw Error('Gemini HTTP '+r.status+' '+JSON.stringify(j.error?.message||'unknown').slice(0,250));
const out=j.candidates?.[0]?.content?.parts?.map(p=>p.text||'').join('')||'';
if(!/<html[\s>]|<!doctype html/i.test(out))throw Error('Gemini response did not include an HTML document; finishReason='+j.candidates?.[0]?.finishReason);
console.log('Gemini smoke test PASSED; generated HTML chars:',out.length);
