
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
    raise SystemExit("GEMINI_API_KEY is not configured")

HEADERS = {
    "Content-Type": "application/json",
    "x-goog-api-key": KEY
}

def api_request(url, payload=None):
    data = None
    if payload is not None:
        data = json.dumps(payload).encode("utf-8")

    request = urllib.request.Request(
        url,
        data=data,
        headers=HEADERS,
        method="POST" if data is not None else "GET"
    )

    try:
        with urllib.request.urlopen(request, timeout=90) as response:
            return json.load(response)
    except urllib.error.HTTPError as error:
        detail = error.read().decode("utf-8", errors="replace")
        try:
            message = json.loads(detail).get("error", {}).get("message", "")
        except ValueError:
            message = "Unknown API error"
        print("API error:", error.code, message[:500])
        raise

def get_models():
    models = []
    page_token = ""

    for _ in range(10):
        query = "?pageSize=100"
        if page_token:
            query += "&pageToken=" + urllib.parse.quote(page_token)

        response = api_request(BASE + "/models" + query)

        for item in response.get("models", []):
            name = item.get("name", "")
            methods = item.get("supportedGenerationMethods", [])

            if (
                name.startswith("models/gemini-")
                and "generateContent" in methods
                and not any(
                    word in name.lower()
                    for word in ["image", "audio", "tts", "live", "robotics"]
                )
            ):
                models.append(name)

        page_token = response.get("nextPageToken", "")
        if not page_token:
            break

    return sorted(set(models))

def model_priority(name):
    lower = name.lower()

    if lower == "models/gemini-3.5-flash-lite":
        return (0, name)
    if "flash-lite" in lower and "2.5" not in lower:
        return (1, name)
    if "flash" in lower and "2.5" not in lower:
        return (2, name)
    if "pro" in lower and "2.5" not in lower:
        return (3, name)
    return (4, name)

models = get_models()
models.sort(key=model_priority)

print("Available models:", ", ".join(models))

if not models:
    raise SystemExit("No compatible models found")

JST = datetime.timezone(datetime.timedelta(hours=9))
today = datetime.datetime.now(JST).date()

projects = ["LIFE EDIT", "FIT NOTE", "MOMENT"]
index = (today - datetime.date(2026, 11, 5)).days % len(projects)
project = projects[index]

categories = [
    "公開市場データ",
    "競合実績・価格",
    "収益試算",
    "低コスト・一人運営",
    "法務・技術リスク"
]

prompt = f"""
あなたはORXELIAのAI事業分析担当です。

対象事業：{project}
分析日：{today.isoformat()}

以下の5項目について、日本語で具体的に分析してください。

1. 公開市場データ
2. 競合実績・価格
3. 収益試算
4. 低コスト・一人運営
5. 法務・技術リスク

重要なルール：
- このAPI呼び出しではWeb検索を利用していません。
- 最新情報を実際に調査したと主張しないこと。
- 確認できない統計・売上・URLを創作しないこと。
- 試算は必ず仮定を明示すること。
- 支出・契約・公開・外部連絡は禁止。
- 全項目を未検証の仮説として扱うこと。

次のJSON形式だけを返してください。

{{
  "findings": [
    {{
      "type": "公開市場データ",
      "summary": "具体的な分析",
      "source": ""
    }}
  ]
}}

findingsには指定された5種類を1件ずつ、
合計5件含めてください。
"""

payload = {
    "contents": [
        {
            "role": "user",
            "parts": [{"text": prompt}]
        }
    ],
    "generationConfig": {
        "responseMimeType": "application/json",
        "temperature": 0.2,
        "maxOutputTokens": 3500
    }
}

def validate_response(result):
    candidates = result.get("candidates", [])
    if not candidates:
        raise ValueError("No candidates returned")

    parts = candidates[0].get("content", {}).get("parts", [])
    content = "".join(
        part.get("text", "")
        for part in parts
        if isinstance(part.get("text"), str)
    )

    if not content.strip():
        raise ValueError("Empty response")

    parsed = json.loads(content)
    findings = parsed.get("findings")

    if not isinstance(findings, list) or len(findings) != 5:
        raise ValueError("Expected exactly five findings")

    if {item.get("type") for item in findings} != set(categories):
        raise ValueError("Unexpected finding categories")

    for item in findings:
        summary = item.get("summary")
        if not isinstance(summary, str) or not summary.strip():
            raise ValueError("Invalid summary")

        item["status"] = "仮説"
        item["source"] = ""

    return findings

findings = None
selected_model = None

for model in models:
    print("Trying model:", model)

    try:
        response = api_request(
            BASE + "/" + model + ":generateContent",
            payload
        )
        findings = validate_response(response)
        selected_model = model
        break

    except urllib.error.HTTPError as error:
        if error.code in (400, 404):
            print("Skipping incompatible model:", model)
            continue
        raise SystemExit(
            "Generation stopped: HTTP " + str(error.code)
        )

    except (ValueError, KeyError, TypeError) as error:
        print("Invalid response:", str(error)[:200])
        continue

if findings is None:
    raise SystemExit(
        "No compatible model produced a valid report"
    )

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

output = pathlib.Path("ai-reports/latest.json")
output.parent.mkdir(parents=True, exist_ok=True)

output.write_text(
    json.dumps(feed, ensure_ascii=False, indent=2) + "\n",
    encoding="utf-8"
)

print("SUCCESS")
print("Project:", project)
print("Model:", selected_model)
print("Output:", output)
