"""Optional AI generator. Requires user-supplied Gemini API key (free tier may change).
Public output: do not include secrets or personal data. No third-party outreach.
"""
import datetime, json, os, pathlib, urllib.request, urllib.error

key=os.environ.get("GEMINI_API_KEY","").strip()
if not key:
    raise SystemExit("GEMINI_API_KEY not configured. No report generated; no paid API requested.")
projects=["LIFE EDIT","FIT NOTE","MOMENT"]
idx=(datetime.date.today()-datetime.date(2026,11,5)).days%len(projects)
project=projects[idx]
today=datetime.datetime.now(datetime.timezone(datetime.timedelta(hours=9))).date().isoformat()
prompt=f"""日本語でORXELIAの事業「{project}」を公開情報に基づき調査。最新の一次情報が検索できない場合、最新情報を調べたと主張しない。具体的な競合価格、利用者数、法規制は出典が確認できない場合は断定しない。顧客ヒアリング不要。費用・公開・外部連絡は禁止。以下のJSONオブジェクトだけ返す。format="orxelia-research-v1", project="{project}", researchedAt="{today}", findingsは5件でtypeが「公開市場データ」「競合実績・価格」「収益試算」「低コスト・一人運営」「法務・技術リスク」。各findingsにstatus="仮説", summary(根拠不足も明記), source(検証可能なURLが不明なら空文字)を含める。架空のURLを作らない。"""
url='https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent'
body=json.dumps({'contents':[{'parts':[{'text':prompt}]}],'generationConfig':{'responseMimeType':'application/json','temperature':0.2,'maxOutputTokens':2600}}).encode()
request=urllib.request.Request(url,data=body,headers={'Content-Type':'application/json','x-goog-api-key':key},method='POST')
try:
    with urllib.request.urlopen(request,timeout=55) as resp:
        result=json.load(resp)
except urllib.error.HTTPError as exc:
    raise SystemExit(f'AI service returned HTTP {exc.code}; no report published')
text=''.join(p.get('text','') for c in result.get('candidates',[]) for p in c.get('content',{}).get('parts',[]))
report=json.loads(text)
validtypes={'公開市場データ','競合実績・価格','収益試算','低コスト・一人運営','法務・技術リスク'}
if (report.get('format')!='orxelia-research-v1' or report.get('project')!=project or report.get('researchedAt')!=today or not isinstance(report.get('findings'),list) or len(report['findings'])!=5):
    raise SystemExit('Invalid report; nothing published')
for f in report['findings']:
    if (f.get('type') not in validtypes or not isinstance(f.get('summary'),str) or not f['summary'].strip() or len(f['summary'])>1000 or not isinstance(f.get('source'),str) or len(f['source'])>500):
        raise SystemExit('Invalid finding; nothing published')
    f['status']='仮説'
feed={'format':'orxelia-auto-feed-v1','generatedAt':datetime.datetime.now(datetime.timezone.utc).isoformat(),'reports':[report]}
path=pathlib.Path('ai-reports/latest.json');path.parent.mkdir(exist_ok=True)
path.write_text(json.dumps(feed,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
print('Validated report written for',project)
