# ダッシュボード保存・エラー表示の修正案

## 原因と変更

- 本番ログに `permission denied for table orxelia_proposals` を確認。画面の直接PATCHを、既存の所有者確認付きRPC `orxelia_set_proposal_priority` に変更する。既存RPCは対象所有者の行をロックして、選択案件と旧1位を同一トランザクションで更新する。本番DB定義・権限の変更は不要。
- 成功レスポンスの選択案件・順位を検証してから画面を更新する。認証切れ、権限不足、RPC不在、通信失敗を画面内で説明する。送信中は選択を無効化し、20秒で待機を終了する。通信失敗時は保存済みか不明なため、再読み込みによる確認を案内する。
- Geminiの503等の一時障害は、初回デザイン生成でも30分後以降に1回だけ再試行する。既存の修正再試行も維持。429・認証不備・品質検査失敗はこの再試行の対象外。
- 日次投入・案件再読込でも再試行の待機時間を確認する。成功時は古いエラーを消す。画面では再試行待ち・処理停止・過去のエラーを区別し、生のエラーは詳細欄に収める。
- すでに `failed` の案件は自動再開しない。販売・公開の判断も変更しない。

## 検証

- `node --check app.js`、`node --check scripts/orxelia-proposal-pipeline.mjs`
- `node scripts/check-business-flow.mjs`
- `node scripts/test-dashboard-reliability.mjs`：29/30/31分の待機判定、初回と修正の最大1回再試行、非一時障害の除外、表示状態
- `CHROMIUM_PATH=/usr/bin/chromium node scripts/test-dashboard-priority-browser.mjs`：390px・1280pxでRPC保存成功、401/403/RPC不在/通信切断/不正レスポンス、失敗時の選択維持と再操作、横はみ出し・未処理例外なし
- 確認画像：`build/dashboard-reliability/390.png`、`1280.png`（ローカル生成、リポジトリには含めない）
- Supabaseへの書込みとGeminiの実呼出しは未実施。実機iPhoneは未確認。既存RPCの本番定義・実行権限は読取り確認済み。

## 公開条件

- 対象URL： https://phenomenal-basbousa-1200eb.netlify.app/dashboard/
- 本番は未反映。開発ブランチに保持し、ユーザーの当該リリース承認を得てからまとめて公開する。
- Netlify自動ビルド停止を維持。今回の開発・ローカル検証によるNetlify公開消費は0。公開時は1回を予定するが、契約・公開方式を参照できないためクレジット消費の見積りは未確定。公開承認の前に確認する。
- 開発ブランチ保存のコミットには `[skip ci] [skip netlify]` を付け、保存時にAI生成や公開を起動しない。
