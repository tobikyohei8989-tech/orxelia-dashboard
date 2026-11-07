import {readFileSync,writeFileSync,appendFileSync} from 'node:fs';
const key=process.env.GEMINI_API_KEY;
if(!key)throw Error('GEMINI_API_KEY is not configured in GitHub Actions secrets');
const files=['index.html','style.css','app.js'];
const sources=files.map(f=>{
 const content=readFileSync(f,'utf8');
 if(f==='app.js'){
  const targets=['function executiveQuickMatrix()','function home()','function render()','function businessRevenueOverview()','function portfolio(','function orxeliaTrialProposalPanel()','document.addEventListener("click"'];
  const excerpts=targets.map(name=>{
   const i=content.indexOf(name);
   return i<0?'### NOT FOUND '+name:'### '+name+'\\n'+content.slice(i,i+(name.includes('orxeliaTrial')?6500:3800));
  });
  return '### '+f+'\\n'+content.slice(0,10000)+'\\n\\n'+excerpts.join('\\n\\n');
 }
 return '### '+f+'\\n'+(f==='style.css'?content.slice(0,6000)+'\\n/* FINAL OVERRIDES */\\n'+content.slice(-12500):content.slice(0,12000));
}).join('\\n\\n');
const prompt=`あなたはORXELIAと独立した日本語UI/UX監査担当のGeminiです。対象はGitHub Pages上の経営ダッシュボード。次の実装コードだけを根拠にレビューしてください。CSS末尾の上書きとホーム画面の最新コードを必ず確認してください。実際の画面・iPhone実機・操作テストを見ていない場合は必ず明記してください。事業ごとのAI生成デザインのレビューと混同しないこと。次の順番でMarkdownで返してください：1. 総評（100点満点、採点根拠） 2. iPhone 390pxの視認性とナビゲーション 3. 経営者が30秒で承認待ち、事業別売上、利益、契約数を把握できるか 4. 情報過多と削るべき項目 5. 重要度順の具体的改善提案5つ（対象ファイル・要素・変更内容・期待効果） 6. 確認できないことと追加テスト。事実と推測を区別し、Stripe連携済みや売上確定などと断定しない。\n\n${sources}`;
const api='https://generativelanguage.googleapis.com/v1beta/';
async function request(url,options={}){
 const response=await fetch(url,{...options,headers:{'x-goog-api-key':key,...options.headers},signal:AbortSignal.timeout(90000)});
 const body=await response.json().catch(()=>({}));
 if(!response.ok)throw Error('HTTP '+response.status+': '+String(body.error?.message||JSON.stringify(body)).slice(0,350));
 return body;
}
const discovered=[];let nextPageToken;
do{
 const qs=new URLSearchParams({pageSize:'100'});
 if(nextPageToken)qs.set('pageToken',nextPageToken);
 const page=await request(api+'models?'+qs);
 discovered.push(...(page.models||[]).filter(m=>m.supportedGenerationMethods?.includes('generateContent')));
 nextPageToken=page.nextPageToken;
}while(nextPageToken&&discovered.length<500);
const candidates=discovered.filter(m=>/gemini/i.test(m.name)&&!/image|embedding|imagen|tts|audio|live|robotics|computer-use|omni/i.test(m.name));
const preferred=['models/gemini-3.8-flash','models/gemini-3.5-flash','models/gemini-flash-latest'];
const selected=preferred.filter(n=>candidates.some(m=>m.name===n));
if(!selected.length)throw Error('No supported text Gemini model found among preferred models. Available: '+candidates.map(m=>m.name).join(', '));
const failures=[];
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
for(const name of selected){
 for(let attempt=1;attempt<=2;attempt++){
  try{
   console.log('Trying Gemini model',name,'attempt',attempt);
   const data=await request(api+name+':generateContent',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({contents:[{parts:[{text:prompt}]}],generationConfig:{temperature:0.2,maxOutputTokens:6000}})});
   const result=data.candidates?.[0]?.content?.parts?.map(p=>p.text||'').join('').trim();
   if(!result||data.candidates?.[0]?.finishReason==='MAX_TOKENS')throw Error('Empty or truncated review');
   const output='# ORXELIA 経営ダッシュボード Geminiデザインレビュー\\n\\n実施日時（UTC）: '+new Date().toISOString()+'\\n対象コミット: '+(process.env.GITHUB_SHA||'unknown')+'\\nモデル: '+name+'\\n評価範囲: ソースコードレビュー（実機画面検証ではありません）\\n\\n'+result+'\\n';
   writeFileSync('gemini-dashboard-review.md',output);
   if(process.env.GITHUB_STEP_SUMMARY)appendFileSync(process.env.GITHUB_STEP_SUMMARY,output);
   console.log('Gemini dashboard review completed with',name);
   process.exit(0);
  }catch(error){
   const msg=String(error);
   failures.push(name+' attempt '+attempt+': '+msg.slice(0,280));
   if(/HTTP 429|quota|rate.limit/i.test(msg))throw Error('Gemini quota exceeded. Stop immediately to avoid consuming more quota. '+msg.slice(0,350));
   if(/HTTP 404|no longer available/i.test(msg))break;
   if(/HTTP 503|HTTP 502|HTTP 500|TimeoutError|aborted due to timeout/i.test(msg)&&attempt===1){await sleep(12000);continue;}
   break;
  }
 }
}
throw Error('Gemini dashboard review failed: '+failures.join('; '));
