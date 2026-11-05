
import os
import json
import time
import pathlib
import datetime
import urllib.request
import urllib.error
import urllib.parse

BASE = "https://generativelanguage.googleapis.com/v1beta"
KEY = os.environ.get("GEMINI_API_KEY", "").strip()

if not KEY:
    raise SystemExit("GEMINI_API_KEY is missing")

HEADERS = {
    "Content-Type": "application/json",
    "x-goog-api-key": KEY
}

RETRY_CODES = {429, 500, 502, 503, 504}
WAIT_SECONDS = [5, 15, 30]

def api_request(url, payload=None, retries=3):
    data = None
    if payload is not None:
        data = json.dumps(payload).encode("utf-8")

    for attempt in range(retries + 1):
        request = urllib.request.Request(
            url,
            data=data,
            headers=HEADERS,
            method="POST" if data is not None else "GET"
        )

        try:
            with urllib.request.urlopen(
                request, timeout=65
            ) as response:
                return json.load(response)

        except urllib.error.HTTPError as error:
            detail = error.read().decode(
                "utf-8", errors="replace"
            )
            try:
                message = json.loads(detail).get(
                    "error", {}
                ).get("message", "")
            except ValueError:
                message = "Unknown API error"

            print(
                f"HTTP {error.code}: {message[:300]}",
                flush=True
            )

            if (
                error.code in RETRY_CODES
                and attempt < retries
            ):
                wait = WAIT_SECONDS[attempt]
                print(
                    f"Retry in {wait} seconds...",
                    flush=True
                )
                time.sleep(wait)
                continue

            raise

        except (TimeoutError, urllib.error.URLError) as error:
            print(
                "Connection error:",
                type(error).__name__,
                flush=True
            )
            if attempt < retries:
                time.sleep(WAIT_SECONDS[attempt])
                continue
            raise

    raise RuntimeError("Request failed")

def get_models():
    models = []
    token = ""

    for _ in range(10):
        query = "?pageSize=100"
        if token:
            query += "&pageToken=" + urllib.parse.quote(
                token
            )

        response = api_request(
            BASE + "/models" + query
        )

        for item in response.get("models", []):
            name = item.get("name", "")
            methods = item.get(
                "supportedGenerationMethods", []
            )

            excluded = [
                "image", "audio", "tts",
                "live", "robotics", "embedding"
            ]

            if (
                name.startswith("models/gemini-")
                and "generateContent" in methods
                and not any(
                    word in name.lower()
                    for word in excluded
                )
            ):
                models.append(name)

        token = response.get("nextPageToken", "")
        if not token:
            break

    return sorted(set(models))

def priority(name):
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
models.sort(key=priority)

if not models:
    raise SystemExit("No available models")

print(
    "Models found:", len(models),
    flush=True
)

JST = datetime.timezone(
    datetime.timedelta(hours=9)
)
today = datetime.datetime.now(JST).date()

projects = [
    "LIFE EDIT",
    "FIT NOTE",
    "MOMENT"
]

index = (
    today - datetime.date(2026, 11, 5)
).days % len(projects)

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

次の5項目を日本語で具体的に分析してください。

1. 公開市場データ
2. 競合実績・価格
3. 収益試算
4. 低コスト・一人運営
5. 法務・技術リスク

ルール：
- Web検索は実行していないため、最新情報を
  実際に調査したと主張しないこと。
- 未確認の統計・売上・URLを捏造しないこと。
- 収益試算には仮定を明示すること。
- 支出・契約・公開・外部連絡は禁止。
- 全項目を未検証の仮説として扱うこと。
- JSONオブジェクトのみを返すこと。

JSON形式：
{{
  "findings": [
    {{
      "type": "公開市場データ",
      "summary": "分析内容",
      "source": ""
    }}
  ]
}}

findingsには指定された5種類を
それぞれ1件ずつ、合計5件含めてください。
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

def validate(result):
    candidates = result.get("candidates", [])

    if not candidates:
        raise ValueError("No candidates")

    parts = candidates[0].get(
        "content", {}
    ).get("parts", [])

    content = "".join(
        item.get("text", "")
        for item in parts
        if isinstance(item.get("text"), str)
    )

    if not content.strip():
        raise ValueError("Empty response")

    parsed = json.loads(content)
    findings = parsed.get("findings")

    if (
        not isinstance(findings, list)
        or len(findings) != 5
    ):
        raise ValueError("Invalid findings count")

    for item in findings:
        if not isinstance(item, dict):
            raise ValueError("Invalid finding")
        if item.get("type") not in categories:
            raise ValueError("Invalid category")
        if not isinstance(
            item.get("summary"), str
        ) or not item["summary"].strip():
            raise ValueError("Invalid summary")

    if {
        item["type"] for item in findings
    } != set(categories):
        raise ValueError("Missing categories")

    for item in findings:
        item["status"] = "仮説"
        item["source"] = ""

    return findings

findings = None
selected_model = None

# 最大5モデルまで順番に試す
for model in models[:5]:
    print(
        "Trying:", model,
        flush=True
    )

    try:
        result = api_request(
            BASE + "/" + model + ":generateContent",
            payload,
            retries=3
        )

        findings = validate(result)
        selected_model = model
        break

    except urllib.error.HTTPError as error:
        print(
            "Switching model after HTTP",
            error.code,
            flush=True
        )

        # 認証・権限エラーは切替では解決しない
        if error.code in (401, 403):
            raise SystemExit(
                f"API access denied: {error.code}"
            )

        continue

    except (
        ValueError,
        KeyError,
        TypeError,
        TimeoutError,
        urllib.error.URLError
    ) as error:
        print(
            "Model failed:",
            type(error).__name__,
            str(error)[:200],
            flush=True
        )
        continue

if findings is None:
    raise SystemExit(
        "All candidate models failed. "
        "No report was saved."
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

output = pathlib.Path(
    "ai-reports/latest.json"
)
output.parent.mkdir(
    parents=True,
    exist_ok=True
)

output.write_text(
    json.dumps(
        feed,
        ensure_ascii=False,
        indent=2
    ) + "\n",
    encoding="utf-8"
)

print("SUCCESS", flush=True)
print("Project:", project, flush=True)
print("Model:", selected_model, flush=True)
print("Saved:", output, flush=True)
