import {readFileSync,writeFileSync,appendFileSync} from 'node:fs';
const key=process.env.GEMINI_API_KEY;
if(!key)throw Error('GEMINI_API_KEY is not configured in GitHub Actions secrets');
const files=['index.html','style.css','app.js'];
const sources=files.map(f=>'### '+f+'\n'+readFileSync(f,'utf8').slice(0,f==='app.js'?43000:12000)).join('\n\n');
const prompt=`あなたはORXELIAと独立した日本語UI/UX監査担当のGeminiです。対象はGitHub Pages上の経営ダッシュボード。次の実装コードだけを根拠にレビューしてください。実際の画面・iPhone実機・操作テストを見ていない場合は必ず明記してください。事業ごとのAI生成デザインのレビューと混同しないこと。次の順番でMarkdownで返してください：1. 総評（100点満点、採点根拠） 2. iPhone 390pxの視認性とナビゲーション 3. 経営者が30秒で承認待ち、事業別売上、利益、契約数を把握できるか 4. 情報過多と削るべき項目 5. 重要度順の具体的改善提案5つ（対象ファイル・要素・変更内容・期待効果） 6. 確認できないことと追加テスト。事実と推測を区別し、Stripe連携済みや売上確定などと断定しない。\n\n${sources}`;
let failures=[];
for(const name of ['gemini-2.5-flash','gemini-2.0-flash']){
 try{
  const response=await fetch('https://generativelanguage.googleapis.com/v1beta/models/'+name+':generateContent',{method:'POST',headers:{'x-goog-api-key':key,'Content-Type':'application/json'},body:JSON.stringify({contents:[{parts:[{text:prompt}]}],generationConfig:{temperature:0.2,maxOutputTokens:4000}}),signal:AbortSignal.timeout(90000)});
  const data=await response.json();
  if(!response.ok){failures.push(name+' HTTP '+response.status);continue;}
  const result=data.candidates?.[0]?.content?.parts?.map(p=>p.text||'').join('').trim();
  if(!result||data.candidates?.[0]?.finishReason==='MAX_TOKENS')throw Error('Empty or truncated review');
  const output='# ORXELIA 経営ダッシュボード Geminiデザインレビュー\n\n実施日時（UTC）: '+new Date().toISOString()+'\n対象コミット: '+(process.env.GITHUB_SHA||'unknown')+'\nモデル: '+name+'\n評価範囲: ソースコードレビュー（実機画面検証ではありません）\n\n'+result+'\n';
  writeFileSync('gemini-dashboard-review.md',output);
  if(process.env.GITHUB_STEP_SUMMARY)appendFileSync(process.env.GITHUB_STEP_SUMMARY,output);
  console.log('Gemini dashboard review completed');
  process.exit(0);
 }catch(error){failures.push(name+': '+String(error).slice(0,180));}
}
throw Error('Gemini dashboard review failed: '+failures.join('; '));
