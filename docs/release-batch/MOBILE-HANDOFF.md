# ORXELIA・Partner Link 引き継ぎ（2026年11月10日）

## 次の担当へ
ユーザーはPCから離れ、スマホのChatGPTから継続したい。以下は作業記録。実装済みと未実装を区別し、同じ確認やキー作成を繰り返さない。秘密キーの貼付を求めない。

## 最新の依頼
ダッシュボードの一括改善、顧客・契約・アプリ別利用管理、Partner LinkのStripe接続、カレンダーの色と進捗の時系列修正を一つの公開にまとめる。先に開発・検証を完了し、具体的なプレビューと対象URL・想定公開クレジットを提示した後に本番公開承認を得る。今日の指示は本番公開や販売開始の承認ではない。

## 保存先
- GitHub: tobikyohei8989-tech/orxelia-dashboard
- 作業ブランチ: codex/partner-link-batched-update
- 一括修正の詳細: docs/release-batch/STATUS.md, dashboard-review.md, customer-management-plan.md
- Partner Link変更: experiments/tobita-partner-schedule/app.html, practical-core.js
- 新規検査: scripts/check-partner-display.mjs
- 配置済みWebhookのソースと検査: integrations/partner-link-billing/
- このPCの作業フォルダー: C:/Users/tobi1/Documents/Codex/2026-11-10/s/work/batched-update
- 元チャット: STRIPを接続（Codex ID 01a1c40c-aea4-7761-91f2-a27fbc1a3220）

## 確定した販売条件
Partner Linkは1社あたり月額3,980円（税込）、初期費用0円、招待職人無料、30日無料。申込時に支払い方法を登録し、無料期間後は自動更新。Stripe Tax自動計算はユーザーの明示選択でオフ。税込指定と税額計算は別物で、税務処理そのものが完了したとは言わない。

## Stripe・Supabase：確認済み
- Partner Link本番アカウント: acct_1Ua8RjIcxIrtGLMu
- 商品: prod_VbLYIKYlpL0Ktx
- 月額料金: price_1Ua8rmIcxIrtGLMuVxe2xxej。JPY3980/month、tax_behavior=inclusiveに更新・再取得済み。
- 決済リンク: plink_1Ua9BCIcxIrtGLMuhN5MMWR5。30日無料設定済み。アプリの自動会社登録・利用制御が未完成のためactive=false。ユーザーへ販売用として配布しない。
- Supabase: yzlxcfncdtojajlhihap（orxelia-dashboard）、ORXELIA組織。
- ユーザーがSecretsに保存した名前: PARTNER_LINK_STRIPE_SECRET_KEY、PARTNER_LINK_STRIPE_WEBHOOK_SECRET。一覧で両方の保存を確認。値は本資料・GitHubに一切含めない。
- Stripeアプリ用キー: Customers/Checkout Sessions/Customer Portalは書き込み、Subscriptions/Invoices/Prices/Products/Payment Intents/Charges and Refundsは読み取り。
- Webhook: we_1Ua9XrIcxIrtGLMuRpvSOi0K。
- URL: https://yzlxcfncdtojajlhihap.supabase.co/functions/v1/partner-link-stripe-webhook
- 受信関数v1は配置済み。Stripe SDKで生本文の署名を検証し、本番・対象アカウントを確認。イベントIDで重複排除し、service_role専用のpartner_link_stripe_eventsへ保存。
- DB: RLS有効、anon/authenticatedの読み取り不可、service_roleの書き込み可を確認。
- 関数への署名なしPOSTは400 Signature required。署名シークレット保存前の503は解消。これは正しい署名付きE2Eテストの合格ではない。
- Webhookの7つのローカル検査は合格。不正署名、古い署名、異なる環境/アカウント、重複、DB失敗、未設定、未購読イベントを検査。
- 現時点の受信キューは通知の保存のみ。契約や利用権限に反映するワーカーは未実装。実際の購入・顧客サブスク作成は行っていない。

## アプリ表示修正：手元で実装・検査済み、未公開
- 選択日は青い塗りつぶし。当日は金色の枠＋「今日」。日本時間の当日判定。今日を選択しても両方の印が残る。
- 進捗全タブは作業日→集合時刻の昇順。同日の時刻未設定は最後。未回答の注意表示は残し、注意の有無で日付順を崩さない。成立日の詳細も同じ順。
- check-partner-practical.mjs、check-partner-capacity.mjs、check-partner-display.mjsは合格。
- 架空データの日付画面をブラウザーで目視確認。iPhone実機・本番の実データ操作は未検証。

## 次に必要な作業（未完了）
1. 独立したテスト環境とテスト用Stripeキーでサーバー連携を検証する。本番カードを使ったテストを行わない。
2. 認証済みの会社管理者とStripe Customerの対応をサーバーで保持し、Checkout/Portalを会社本人だけが作成できるようにする。
3. 既存の管理者開設関数は特定のメールアドレスのみ許可する試作構成。契約会社の開設、会社ごとのデータ分離、招待との関係を実装する。既存社内利用を停止させない。
4. 契約通知の再照合、重複/順不同、再送、無料期間終了、成功/失敗/解約/再開/返金/不審請求を処理し、サーバー側DBアクセスに利用権限を適用する。画面を隠すだけでは不十分。
5. 支払失敗7日猶予は既存設計の仮案。決済再試行との整合を確認し、停止してもデータを消さず支払い後に復旧する。
6. docs/release-batchのダッシュボード改善10項目と共通顧客管理を実装する。2つの表示修正だけで全項目を完了扱いしない。
7. 更新を確認可能な形で提示し、公開承認後に1回にまとめて反映。Netlifyの自動ビルドは停止状態を維持する。作業ブランチの保存には[skip netlify]を付ける。

## スマホ継続の方法と制限
- 同じローカル作業を操作するには、ChatGPT iOSのCodex（旧Remote）から接続済みPCを選び、このチャットを開く。PCは起動・オンラインを維持する必要がある。
- PC側の接続設定: Settings > Connections > Control this Mac or PC > Set up/Add。QRコードをスマホで読み、同じChatGPTアカウントとワークスペースで接続する。エージェントから有効化済みと断定しない。
- PCを停止する場合は、クラウド環境またはGitHubを読めるスマホChatGPTでこのブランチと引き継ぎを参照する。スマホ側でGitHub/Stripe/Supabaseツールやクラウド環境が利用可能かは別途確認が必要。
- このPCのブラウザー状態、ローカルファイル、接続資格情報が通常のスマホチャットへ自動共有されたとは言わない。
