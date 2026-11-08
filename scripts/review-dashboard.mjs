import {readFileSync,writeFileSync,appendFileSync} from 'node:fs';
const key=process.env.GEMINI_API_KEY;
if(!key)throw Error('GEMINI_API_KEY is not configured in GitHub Actions secrets');
const sources = ['index.html','experiments/tobita-partner-schedule/app.html'].map(f => {const raw=readFileSync(f,'utf8');return 'FILE '+f+'\n'+(f==='index.html'?raw:raw.slice(0,raw.indexOf('<script type="module">'))+'\n'+raw.slice(raw.indexOf('function render(){'),raw.indexOf('function render(){')+10000));}).join('\n\n');
const prompt = `あなたはORXELIAのWebデザインをChatGPTと共同検討するGeminiです。ユーザーは「現HPのPartner Link紹介と操作デモは分かりにくい。実際の画面とも違う。もっと実物を伝えたい。改修案を3つ」と希望。ソースは公開済みコードのみ。3案を独立した意図で提案し、推奨案を選んでください。ChatGPT暫定案はA実画面を大きく見せる製品紹介、B管理者から職人回答までの3手順ガイド、C管理者・職人を並べた両側比較。良い点と弱点、見出し、ファーストビュー、スクロール順、CTA、スマホ仕様、実画面と整合させる方法を日本語Markdownで具体的に。実装ソースだけを根拠とし、画像を見た/実機で動かしたとは言わないこと。20日締め人工集計・年次集計は要望だが現app.htmlの画面では確認できないため実装済みと断定しない。プッシュ通知は端末設定とホーム追加が必要。架空の顧客実績・効果数値・料金を作らない。デモはサンプル名と固定日付、通信なし、実通知と本番更新なし。本番ソース、企業HP、認証は変更せず別ブランチで案を保存する。ユーザーは60歳以上の職人にも分かる見やすさを重視。デモの成立は自動成功でなく職人側の承諾操作を明示。最後に比較表と必須修正5つを出す。\n\n${sources}`;
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
const preferred=['models/gemini-3.5-flash','models/gemini-3.8-flash','models/gemini-flash-latest'];
const selected=preferred.filter(n=>candidates.some(m=>m.name===n));
if(!selected.length)throw Error('No supported text Gemini model found among preferred models. Available: '+candidates.map(m=>m.name).join(', '));
const failures=[];
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
for(const name of selected){
 for(let attempt=1;attempt<=2;attempt++){
  try{
   console.log('Trying Gemini model',name,'attempt',attempt);
   const data=await request(api+name+':generateContent',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({contents:[{parts:[{text:prompt}]}],generationConfig:{temperature:0.2,maxOutputTokens:12000}})});
   const result=data.candidates?.[0]?.content?.parts?.map(p=>p.text||'').join('').trim();
   if(!result)throw Error('Empty review');
   const truncated=data.candidates?.[0]?.finishReason==='MAX_TOKENS';
   if(truncated && result.length<700)throw Error('Review truncated before meaningful content');
   const output='# ORXELIA Partner Link ホームページ共同検討\\n\\n実施日時（UTC）: '+new Date().toISOString()+'\\n対象コミット: '+(process.env.GITHUB_SHA||'unknown')+'\\nモデル: '+name+'\\n評価範囲: ソースコードレビュー（実機画面検証ではありません）\\n\\n'+result+'\\n';
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
