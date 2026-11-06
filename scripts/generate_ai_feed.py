
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
    "x-goog-api-key": KEY,
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
            method="POST" if data is not None else "GET",
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
                flush=True,
            )

            if (
                error.code in RETRY_CODES
                and attempt < retries
            ):
                time.sleep(WAIT_SECONDS[attempt])
                continue

            raise

        except (
            TimeoutError,
            urllib.error.URLError,
        ) as error:
            print(
                "Connection error:",
                type(error).__name__,
                flush=True,
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
                "image",
                "audio",
                "tts",
                "live",
                "robotics",
                "embedding",
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


PROJECTS = [
    {
        "name": "LIFE EDIT",
        "description": (
            "家計管理・購入前相談・将来設計のPWA。"
            "レシート取込、クレジットカード明細取込、"
            "固定費管理、貯蓄目標、収支評価を提供。"
            "無料プランなし。"
        ),
        "business_model": (
            "月額課金を中心に検討。"
            "価格や契約数は未確定。"
        ),
    },
    {
        "name": "FIT NOTE",
        "description": (
            "AIによるファッションコーディネート提案。"
            "フィットネス・運動記録アプリではない。"
            "利用者の写真を必須とし、季節、サイズ、"
            "予算、用途、ブランド希望に応じて提案。"
            "UNIQLOとGUを中心に構成。"
            "人による確認を前提としない。"
        ),
        "business_model": (
            "1コーディネート1980円。"
            "複数回パック割引も検討。"
        ),
    },
    {
        "name": "MOMENT",
        "description": (
            "イベント向け写真共有サービス。"
            "主催者がQRコードを発行し、"
            "参加者が読み取って写真を投稿・共有。"
            "コメント機能は設けない。"
        ),
        "business_model": (
            "料金体系は未確定。"
            "イベント単位の課金などを検証する。"
        ),
    },
]

CATEGORIES = [
    "公開市場データ",
    "競合実績・価格",
    "収益試算",
    "低コスト・一人運営",
    "法務・技術リスク",
]

JST = datetime.timezone(
    datetime.timedelta(hours=9)
)
TODAY = datetime.datetime.now(JST).date()

index = (
    TODAY - datetime.date(2026, 11, 5)
).days % len(PROJECTS)

project = PROJECTS[index]
project_name = project["name"]

prompt = f"""
あなたはORXELIAのAI事業分析担当です。

対象事業：{project_name}
分析日：{TODAY.isoformat()}

【正しい事業内容】
{project["description"]}

【事業モデル】
{project["business_model"]}

上記の事業定義を厳守してください。
別業種のサービスと取り違えないでください。

以下の5項目を日本語で分析してください。

1. 公開市場データ
2. 競合実績・価格
3. 収益試算
4. 低コスト・一人運営
5. 法務・技術リスク

必須ルール：
- Web検索は実行していないため、実際に
  最新情報を調査したと主張しないこと。
- 未確認の統計、競合価格、売上、URLを
  捏造しないこと。
- 確認すべき一次資料を具体的に提案すること。
- 収益試算は仮定と計算式を明記すること。
- 実績と予測を明確に区別すること。
- 支出、契約、公開、外部連絡は禁止。
- 全項目を未検証の仮説として扱うこと。
- 顧客ヒアリング、アンケート、モニター募集、個別勧誘は提案しないこと。
- 検証は社内での試作・動作確認と、商品公開後の実購入件数・売上で行うこと。
- JSONオブジェクトのみを返すこと。

既存事業の分析とは別に、初期投資5万円以内・原則1人で
初売上を早く検証できる新規事業案を1件提案してください。
顧客の課題、売る商品・仮の価格・集客経路、最初の販売検証を
具体的に記述し、観測済みの需要や実績とは扱わないでください。

JSON形式：
{{
  "idea": {{"name": "新規事業名", "customer": "顧客と課題", "offer": "商品・価格仮説・集客経路", "next": "社内での動作確認と公開後に測る購入件数・売上"}},
  "findings": [
    {{
      "type": "公開市場データ",
      "summary": "具体的な分析内容",
      "source": ""
    }}
  ]
}}

findingsには指定された5種類を
それぞれ1件ずつ含めてください。
"""


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

        if item.get("type") not in CATEGORIES:
            raise ValueError("Invalid category")

        if (
            not isinstance(item.get("summary"), str)
            or not item["summary"].strip()
        ):
            raise ValueError("Invalid summary")

    if {
        item["type"] for item in findings
    } != set(CATEGORIES):
        raise ValueError("Missing categories")

    for item in findings:
        item["status"] = "仮説"
        item["source"] = ""

    # A malformed idea must not interrupt the existing-business feed.
    idea = parsed.get("idea")
    limits = {"name": 140, "customer": 300, "offer": 300, "next": 300}
    if not isinstance(idea, dict) or not all(
        isinstance(idea.get(field), str)
        and 0 < len(idea[field].strip()) <= limit
        for field, limit in limits.items()
    ):
        return findings, None

    return findings, {field: idea[field].strip() for field in limits}


def load_existing_reports(path):
    if not path.exists():
        return []

    try:
        existing = json.loads(
            path.read_text(encoding="utf-8")
        )
    except (OSError, ValueError) as error:
        raise SystemExit(
            "Existing report cannot be read. "
            "Refusing to overwrite: "
            + str(error)
        )

    if (
        not isinstance(existing, dict)
        or existing.get("format")
        != "orxelia-auto-feed-v1"
        or not isinstance(
            existing.get("reports"), list
        )
    ):
        raise SystemExit(
            "Unexpected existing report format. "
            "Refusing to overwrite."
        )

    return existing["reports"]


def save_feed(new_report):
    output = pathlib.Path(
        "ai-reports/latest.json"
    )
    output.parent.mkdir(
        parents=True,
        exist_ok=True,
    )

    existing = load_existing_reports(output)

    # 同じ事業・同じ調査日の古い版だけ差し替える。
    # 別の日付や別事業の調査結果は維持する。
    reports = [
        item
        for item in existing
        if not (
            isinstance(item, dict)
            and item.get("project")
            == new_report["project"]
            and item.get("researchedAt")
            == new_report["researchedAt"]
        )
    ]

    reports.append(new_report)

    # アプリ側の取り込み上限に合わせて最大30件。
    reports = reports[-30:]

    feed = {
        "format": "orxelia-auto-feed-v1",
        "generatedAt": datetime.datetime.now(
            datetime.timezone.utc
        ).isoformat(),
        "reports": reports,
    }

    temporary = output.with_suffix(".tmp")
    temporary.write_text(
        json.dumps(
            feed,
            ensure_ascii=False,
            indent=2,
        ) + "\n",
        encoding="utf-8",
    )
    temporary.replace(output)

    return output, len(reports)


def main():
    models = get_models()
    models.sort(key=priority)

    if not models:
        raise SystemExit("No available models")

    print(
        "Models found:", len(models),
        flush=True,
    )
    print(
        "Project:", project_name,
        flush=True,
    )

    payload = {
        "contents": [
            {
                "role": "user",
                "parts": [{"text": prompt}],
            }
        ],
        "generationConfig": {
            "responseMimeType": "application/json",
            "temperature": 0.2,
            "maxOutputTokens": 3500,
        },
    }

    findings = None
    selected_model = None

    for model in models[:5]:
        print(
            "Trying:", model,
            flush=True,
        )

        try:
            result = api_request(
                BASE + "/" + model
                + ":generateContent",
                payload,
                retries=3,
            )

            findings, idea = validate(result)
            selected_model = model
            break

        except urllib.error.HTTPError as error:
            print(
                "Switching model after HTTP",
                error.code,
                flush=True,
            )

            if error.code in (401, 403):
                raise SystemExit(
                    f"API access denied: {error.code}"
                )

        except (
            ValueError,
            KeyError,
            TypeError,
            TimeoutError,
            urllib.error.URLError,
        ) as error:
            print(
                "Model failed:",
                type(error).__name__,
                str(error)[:200],
                flush=True,
            )

    if findings is None:
        raise SystemExit(
            "All candidate models failed. "
            "No report was saved."
        )

    report = {
        "format": "orxelia-research-v1",
        "project": project_name,
        "researchedAt": TODAY.isoformat(),
        "findings": findings,
    }

    if idea:
        report["idea"] = idea

    output, count = save_feed(report)

    print("SUCCESS", flush=True)
    print("Project:", project_name, flush=True)
    print("Model:", selected_model, flush=True)
    print("Saved:", output, flush=True)
    print("Reports retained:", count, flush=True)


if __name__ == "__main__":
    main()
