import datetime, json, os, pathlib, urllib.request, urllib.error

key = os.environ.get("GEMINI_API_KEY", "").strip()
if not key:
    raise SystemExit("GEMINI_API_KEY is not configured")

projects = ["LIFE EDIT", "FIT NOTE", "MOMENT"]
today = datetime.datetime.now(datetime.timezone(datetime.timedelta(hours=9))).date().isoformat()
project = projects[(datetime.date.fromisoformat(today) - datetime.date(2026, 11, 5)).days % len(projects)]

prompt = f"""ORXELIAの事業「{project}」について日本語で事業性を分析してください。
市場需要、競合、収益性、1人運営、法務リスクの5項目。
Web検索機能がない場合は最新情報を調査したと主張しないこと。
確認できない価格、売上、統計、URLは創作しないこと。
顧客ヒアリング、外部連絡、支出は禁止。
JSONオブジェクトのみ返答。
format: orxelia-research-v1
project: {project}
researchedAt: {today}
findings: type, status, summary, source を持つ5件の配列。
typeは「公開市場データ」「競合実績・価格」「収益試算」「低コスト・一人運営」「法務・技術リスク」。
statusは「仮説」。不明なsourceは空文字。"""

body = json.dumps({
    "contents": [{"parts": [{"text": prompt}]}],
    "generationConfig": {
        "responseMimeType": "application/json",
        "temperature": 0.2,
        "maxOutputTokens": 2600
    }
}).encode("utf-8")

req = urllib.request.Request(
    "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent",
    data=body,
    headers={"Content-Type": "application/json", "x-goog-api-key": key},
    method="POST"
)

try:
    with urllib.request.urlopen(req, timeout=55) as response:
        result = json.load(response)
except urllib.error.HTTPError as exc:
    raise SystemExit(f"Gemini API HTTP {exc.code}; no report saved")

content = "".join(
    part.get("text", "")
    for candidate in result.get("candidates", [])
    for part in candidate.get("content", {}).get("parts", [])
)
report = json.loads(content)

types = {
    "公開市場データ", "競合実績・価格", "収益試算",
    "低コスト・一人運営", "法務・技術リスク"
}

if (
    report.get("format") != "orxelia-research-v1"
    or report.get("project") != project
    or report.get("researchedAt") != today
    or not isinstance(report.get("findings"), list)
    or len(report["findings"]) != 5
):
    raise SystemExit("Invalid report; no report saved")

for item in report["findings"]:
    if (
        item.get("type") not in types
        or not isinstance(item.get("summary"), str)
        or not item["summary"].strip()
        or len(item["summary"]) > 1000
        or not isinstance(item.get("source"), str)
        or len(item["source"]) > 500
    ):
        raise SystemExit("Invalid finding")
    item["status"] = "仮説"

feed = {
    "format": "orxelia-auto-feed-v1",
    "generatedAt": datetime.datetime.now(datetime.timezone.utc).isoformat(),
    "reports": [report]
}
path = pathlib.Path("ai-reports/latest.json")
path.parent.mkdir(exist_ok=True)
path.write_text(json.dumps(feed, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
print("Report generated:", project)
