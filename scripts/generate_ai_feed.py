import os
import json
import pathlib
import datetime
import urllib.request
import urllib.error
import urllib.parse

BASE = "https://generativelanguage.googleapis.com/v1beta"
KEY = os.environ.get("GEMINI_API_KEY", "").strip()

if not KEY:
    raise SystemExit("ERROR: GEMINI_API_KEY is missing")

HEADERS = {
    "x-goog-api-key": KEY,
    "Content-Type": "application/json"
}

def request_json(url, payload=None):
    data = None if payload is None else json.dumps(payload).encode("utf-8")
    req = urllib.request.Request(
        url, data=data, headers=HEADERS,
        method="GET" if data is None else "POST"
    )
    try:
        with urllib.request.urlopen(req, timeout=90) as response:
            return json.load(response)
    except urllib.error.HTTPError as error:
        detail = error.read().decode("utf-8", errors="replace")
        print("API HTTP", error.code, detail[:1000])
        raise

def available_models():
    found = []
    token = ""
    for _ in range(10):
        query = "?pageSize=100"
        if token:
            query += "&pageToken=" + urllib.parse.quote(token)
        result = request_json(BASE + "/models" + query)
        for model in result.get("models", []):
            name = model.get("name", "")
            methods = model.get("supportedGenerationMethods", [])
            if (
                name.startswith("models/gemini-")
                and "generateContent" in methods
                and "image" not in name
                and "audio" not in name
                and "tts" not in name
                and "live" not in name
            ):
                found.append(name)
        token = result.get("nextPageToken", "")
        if not token:
            break
    return sorted(set(found))

models = available_models()
print("Available text models:", ", ".join(models))

if not models:
    raise SystemExit("No generateContent models available")

def priority(name):
    lower = name.lower()
    return (
        0 if "flash-lite" in lower else
        1 if "flash" in lower else
        2 if "pro" in lower else 3,
        1 if "preview" in lower else 0,
        name
    )

models.sort(key=priority)
model = models[0]
print("Selected model:", model)

jst = datetime.timezone(datetime.timedelta(hours=9))
today = datetime.datetime.now(jst).date()
projects = ["LIFE EDIT", "FIT NOTE", "MOMENT"]
project = projects[(today - datetime.date(2026, 11, 5)).days % 3]

types = [
    "公開市場データ",
    "競合実績・価格",
    "収益試算",
    "低コスト・一人運営",
    "法務・技術リスク"
]

prompt = (
    "あなたはORXELIAの事業調査担当です。\n"
    f"対象事業: {project}\n"
    f"調査日: {today.isoformat()}\n"
    "以下の5項目について日本語で事業性を評価してください。\n"
    + "\n".join(types)
    + "\nWeb検索は利用できないため、最新の事実を確認したと主張しないこと。"
    "数字やURLを捏造しないこと。全件を未検証の仮説として扱うこと。"
    "支出・契約・外部連絡は行わないこと。\n"
    "JSONのみ返してください。形式:\n"
    '{"findings":[{"type":"公開市場データ",'
    '"summary":"説明","source":""}]}\n'
    "findingsは指定した5種類を各1件、合計5件。"
)

payload = {
    "contents": [{"parts": [{"text": prompt}]}],
    "generationConfig": {
        "responseMimeType": "application/json",
        "temperature": 0.2,
        "maxOutputTokens": 3000
    }
}

try:
    result = request_json(
        BASE + "/" + model + ":generateContent",
        payload
    )
except urllib.error.HTTPError as error:
    raise SystemExit(
        f"Generation failed: HTTP {error.code}, model={model}"
    )

parts = []
for candidate in result.get("candidates", []):
    parts.extend(candidate.get("content", {}).get("parts", []))

content = "".join(
    part.get("text", "") for part in parts
    if isinstance(part.get("text"), str)
)

if not content.strip():
    raise SystemExit("Model returned no text")

parsed = json.loads(content)
findings = parsed.get("findings", [])

if not isinstance(findings, list) or len(findings) != 5:
    raise SystemExit("Invalid findings count")

if {item.get("type") for item in findings} != set(types):
    raise SystemExit("Invalid finding types")

for item in findings:
    if not isinstance(item.get("summary"), str):
        raise SystemExit("Missing summary")
    if not item["summary"].strip():
        raise SystemExit("Empty summary")
    item["status"] = "仮説"
    item["source"] = str(item.get("source") or "")

report = {
    "format": "orxelia-research-v1",
    "project": project,
    "researchedAt": today.isoformat(),
    "findings": findings
}

feed = {
    "format": "orxelia-auto-feed-v1",
    "generatedAt": datetime.datetime.now(
        datetime.timezone.utc
    ).isoformat(),
    "reports": [report]
}

path = pathlib.Path("ai-reports/latest.json")
path.parent.mkdir(parents=True, exist_ok=True)
path.write_text(
    json.dumps(feed, ensure_ascii=False, indent=2) + "\n",
    encoding="utf-8"
)

print("SUCCESS:", project, "using", model)
