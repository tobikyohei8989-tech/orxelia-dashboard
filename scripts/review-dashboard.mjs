import {readFileSync,writeFileSync,appendFileSync} from 'node:fs';
const key=process.env.GEMINI_API_KEY;
if(!key)throw Error('GEMINI_API_KEY is not configured in GitHub Actions secrets');
const files=['index.html','style.css','app.js'];
const sources=files.map(f=>'### '+f+'\n'+readFileSync(f,'utf8').slice(0,f==='app.js'?43000:12000)).join('\n\n');
const prompt=`あなたはORXELIAと独立した日本語UI/UX監査担当のGeminiです。対象はGitHub Pages上の経営ダッシュボード。次の実装コードだけを根拠にレビューしてください。実際の画面・iPhone実機・操作テストを見ていない場合は必ず明記してください。事業ごとのAI生成デザインのレビューと混同しないこと。次の順番でMarkdownで返してください：1. 総評（100点満点、採点根拠） 2. iPhone 390pxの視認性とナビゲーション 3. 経営者が30秒で承認待ち、事業別売上、利益、契約数を把握できるか 4. 情報過多と削るべき項目 5. 重要度順の具体的改善提案5つ（対象ファイル・要素・変更内容・期待効果） 6. 確認できないことと追加テスト。事実と推測を区別し、Stripe連携済みや売上確定などと断定しない。\n\n${sources}`;
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
const candidates=discovered.filter(m=>/gemini/i.test(m.name)&&!/embedding|imagen|tts|audio|live|robotics|computer-use/i.test(m.name)).sort((a,b)=>{
 const score=m=>(/flash/i.test(m.name)?100:0)+(/stable/i.test(m.name)?20:0)-(/preview|exp/i.test(m.name)?30:0)-(/lite/i.test(m.name)?10:0);
 return score(b)-score(a);
});
if(!candidates.length)throw Error('No generateContent Gemini models available to this API key; check API key project and model access');
const failures=[];
for(const model of candidates.slice(0,8)){
 const name=model.name;
 try{
  console.log('Trying Gemini model',name);
  const data=await request(api+name+':generateContent',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({contents:[{parts:[{text:prompt}]}],generationConfig:{temperature:0.2,maxOutputTokens:6000}})});
  const result=data.candidates?.[0]?.content?.parts?.map(p=>p.text||'').join('').trim();
  if(!result||data.candidates?.[0]?.finishReason==='MAX_TOKENS')throw Error('Empty or truncated review');
  const output='# ORXELIA 経営ダッシュボード Geminiデザインレビュー\\n\\n実施日時（UTC）: '+new Date().toISOString()+'\\n対象コミット: '+(process.env.GITHUB_SHA||'unknown')+'\\nモデル: '+name+'\\n評価範囲: ソースコードレビュー（実機画面検証ではありません）\\n\\n'+result+'\\n';
  writeFileSync('gemini-dashboard-review.md',output);
  if(process.env.GITHUB_STEP_SUMMARY)appendFileSync(process.env.GITHUB_STEP_SUMMARY,output);
  console.log('Gemini dashboard review completed with',name);
  process.exit(0);
 }catch(error){failures.push(name+': '+String(error).slice(0,350));}
}
throw Error('Gemini dashboard review failed: '+failures.join('; '));
