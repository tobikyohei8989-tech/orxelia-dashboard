
function prototypeAutoHeightDocument(html){
 const code = '(function(){function report(){var b=document.body,e=document.documentElement;var height=Math.max(b?b.scrollHeight:0,e?e.scrollHeight:0);parent.postMessage({type:"orxelia-prototype-height",height:height},"*");}window.addEventListener("load",report);window.addEventListener("resize",report);if(window.ResizeObserver){new ResizeObserver(report).observe(document.documentElement);}setTimeout(report,150);setTimeout(report,800);})();';
 const injection='<script>'+code+'</scr'+'ipt>';
 const doc=String(html||'');
 return doc.includes('</body>')?doc.replace('</body>',injection+'</body>'):doc+injection;
}
window.addEventListener('message',event=>{
 if(!event.data||event.data.type!=='orxelia-prototype-height')return;
 const frame=Array.from(document.querySelectorAll('iframe.prototype-live-frame')).find(f=>f.contentWindow===event.source);
 if(!frame)return;
 const h=Number(event.data.height);
 if(!Number.isFinite(h)||h<100||h>100000)return;
 frame.style.height=Math.ceil(h+4)+'px';
});
"use strict";

const $ = id => document.getElementById(id);
const esc = value => String(value ?? "").replace(/[&<>"']/g, char =>
  ({"&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;", "'":"&#39;"})[char]);
const yen = value => new Intl.NumberFormat("ja-JP", {style:"currency", currency:"JPY"}).format(value);
const today = () => new Intl.DateTimeFormat("sv-SE", {timeZone:"Asia/Tokyo"}).format(new Date());
const key = "orxelia-dashboard-v1";
const recoveryKey = "orxelia-local-recovery-v16";
const salesKey = "orxelia-sales-v17-local";
const backupKey = "orxelia-safety-history-v18";
const tasksKey = "orxelia-action-tasks-v25-local";
const evidenceKey = "orxelia-evidence-v30-local";
const types = ["日次候補", "過去の候補", "既存プロジェクト"];
const stages = ["未確認", "未検証", "検証中", "開発中", "販売中", "収益化済み", "保留", "終了"];
const priorities = ["未設定", "高", "中", "低"];
const activityStates = ["準備中", "調査中", "試作中", "検証中", "判断待ち", "完了", "停止"];
const empty = () => ({version:1, projects:[], ledger:[], decisions:[]});
let data = empty();
let orxeliaTrialProposals = [];
let orxeliaArchivedProposals = [];
let proposalSync = { state: "pending", lastSuccess: null };
const legalReviewFields = {
  regulation: "規制・許認可",
  trademark: "商標・名称・ロゴ",
  copyright: "著作権・素材",
  terms: "利用規約",
  privacy: "個人情報",
  sales: "販売表示",
  security: "認証・権限・決済安全性"
};
function clearProposalSync() {
  orxeliaTrialProposals = [];
  orxeliaArchivedProposals = [];
  proposalSync = { state: "pending", lastSuccess: null };
}
function activeProjects(){return data.projects.filter(p=>!p.deletedAt&&!orxeliaArchivedProposals.some(c=>c.brief?.legacy_id===p.id||c.title===p.name));}

let orxeliaRevisionDrafts = {};
const orxeliaDraftKey = "orxelia-revision-drafts-v1";
try { const saved=JSON.parse(localStorage.getItem(orxeliaDraftKey)||"{}");if(saved&&typeof saved==="object"&&!Array.isArray(saved))orxeliaRevisionDrafts=saved; } catch {}
function saveOrxeliaDraft(id,value){
 if(!/^[0-9a-f-]{36}$/i.test(id))return;
 orxeliaRevisionDrafts[id]=String(value).slice(0,3000);
 try{localStorage.setItem(orxeliaDraftKey,JSON.stringify(orxeliaRevisionDrafts))}catch(e){console.warn("Revision draft local save unavailable",e)}
}
document.addEventListener("input",event=>{
 const field=event.target.closest?.("[data-revision-input]");
 if(field)saveOrxeliaDraft(field.dataset.revisionInput,field.value);
});
document.addEventListener("compositionend",event=>{
 const field=event.target.closest?.("[data-revision-input]");
 if(field)saveOrxeliaDraft(field.dataset.revisionInput,field.value);
});
document.addEventListener("toggle",event=>{
 if(event.target?.matches?.("details[data-prototype-preview]") && !event.target.open) {
  // The next scheduled refresh may update the proposal once the preview is closed.
 }
},true);
document.addEventListener("focusout",event=>{
 const field=event.target.closest?.("[data-revision-input]");
 if(field)saveOrxeliaDraft(field.dataset.revisionInput,field.value);
});

function salesReviewJapanese(value){let s=String(value||"");const terms=[[/Sales is NOT ready\./gi,"販売開始の条件を満たしていません。"],[/Final approval button remains disabled until verified evidence exists\./gi,"検証済みの根拠がそろうまで最終承認はできません。"],[/iPhone real-device tests/gi,"iPhone実機テスト"],[/end-to-end functional testing/gi,"全機能の一連の動作テスト"],[/customer demand and competitive advantage/gi,"顧客需要と競合優位性の検証"],[/legal and privacy review/gi,"法務・個人情報保護の確認"],[/payment, cancellation and support design/gi,"決済・解約・問い合わせ対応の設計"],[/pricing and margin verification/gi,"価格設定と利益率の検証"]];for(const [pattern,replacement] of terms)s=s.replace(pattern,replacement);return s.replace(/\\s*／\\s*/g," ／ ");}
function hasPreapprovalTrial(proposal) {
  const trial = proposal.test_report?.preapproval_trial;
  return Boolean(proposal.prototype_html?.trim() && trial?.passed === true &&
    trial.design_revision === (Number(proposal.revision_number) || 1));
}
function proposalPriority(status){return ["awaiting_first_approval","development_ready","awaiting_final_approval"].includes(status)?0:status==="failed"?1:["designing","revising","developing","prototype_revising","sales_review_requested"].includes(status)?2:3;}
function proposalNext(status){return ({awaiting_first_approval:"非公開試作を確認し、法務審査・開発許可へ進む",development_ready:"動作試作品を操作し、修正または販売審査を選択",awaiting_final_approval:"販売根拠が不足している場合は承認できません。審査内容を確認",failed:"AI処理が停止しています。原因を確認してください",sales_review_requested:"販売審査の結果を待っています",final_approved:"販売方針は承認済み。公開・決済は別途手続きが必要",on_hold:"保留中。再開は別途判断が必要"})[status]||"AIの処理状況を確認してください";}
// Partner Link is an existing internally deployed product, not a new sales approval.
function isPartnerLinkImplemented(p){
  return p?.id === "9322fe5e-74a2-43dc-ae6e-b8615af4f455" && p.brief?.manual_implementation?.kind === "partner_link";
}
function partnerLinkProductPanel(p){
  const release=p.brief.manual_implementation;
  return '<article class="partner-product business-progress" aria-label="Partner Link 手配ボード"><div class="partner-product-top"><span class="partner-product-label">開発したシステム</span><span class="partner-product-status">社内運用中</span></div><h3>Partner Link <small>（手配ボード）</small></h3><p>協力職人の空き確認から、仕事の打診・承諾・成立までを管理します。</p><div class="partner-product-links"><a class="partner-open" href="https://phenomenal-basbousa-1200eb.netlify.app/experiments/tobita-partner-schedule/app.html" target="_blank" rel="noopener noreferrer">手配ボードを開く ↗</a><a href="https://phenomenal-basbousa-1200eb.netlify.app/products/partner-link/" target="_blank" rel="noopener noreferrer">商品紹介・デモを見る ↗</a></div><p class="partner-product-note">手配ボードは登録済みアカウントでログインしてください。一般販売の条件・料金は準備中です。</p><details><summary>開発状況・残っている確認事項</summary><ul><li>実装済み：ログイン、空き日程、仕事の打診・承諾・辞退、成立日の詳細表示、会社名・ロゴ設定</li><li>通知：端末の対応状況・ホーム画面追加・通知許可が必要です</li><li>修正済み：成立スタンプの位置ずれ、氏名の表示サイズ</li><li>公開済み：商品紹介ページとサンプル操作デモ</li><li>要確認：20日締めの人工集計、年間集計、請求照合の対応範囲</li></ul><p>反映日：'+esc(release.recorded_on||'2026-11-09')+'。売上・契約数はこの記録から自動計上しません。</p><p>以前のAI処理状態は履歴として保持し、現在の社内運用とは分けています。</p></details>'+businessRemovalButton(null,p)+'</article>';
}
function implementedProductsPanel(){
  return orxeliaTrialProposals.filter(isPartnerLinkImplemented).map(partnerLinkProductPanel).join('');
}

function orxeliaTrialProposalPanel(){
 if(!orxeliaTrialProposals.length)return "";
 const names={awaiting_selection:"Geminiデザイン作成待ち",designing:"Geminiデザイン作成中",awaiting_first_approval:"第1承認待ち",revision_requested:"修正指示受付済み",revising:"Gemini再デザイン中",approved_for_development:"開発待ち",developing:"開発・テスト中",development_ready:"動作試作品完成・操作確認待ち",prototype_revision_requested:"試作品の修正指示受付済み",prototype_revising:"AIが試作品を修正中",sales_review_requested:"販売審査中",awaiting_final_approval:"販売審査：根拠確認中",final_approved:"販売方針承認済み（公開・決済未実行）",on_hold:"保留",failed:"処理失敗"};
 const sorted=[...orxeliaTrialProposals].sort((a,b)=>(Number(a.brief?.priority_rank)||99)-(Number(b.brief?.priority_rank)||99)||proposalPriority(a.status)-proposalPriority(b.status));
 const chosen=sorted.find(p=>Number(p.brief?.priority_rank)===1);
 const priorityPicker=`<div class="proposal-priority-picker" style="padding:14px;border:1px solid #d3dce6;border-radius:12px;margin:12px 0"><label for="orxelia-priority-select"><b>最優先で開発する案件（経営者が選択）</b></label><select id="orxelia-priority-select" style="width:100%;padding:10px;margin:8px 0"><option value="">選択してください</option>${sorted.map(p=>`<option value="${esc(p.id)}" ${chosen?.id===p.id?"selected":""}>${esc(p.title)}</option>`).join("")}</select><small>AI推奨とは別に開発順を指定します。公開・販売の承認にはなりません。</small></div>`;
 const count=sorted.filter(p=>!isPartnerLinkImplemented(p)).filter(p=>p.status==="awaiting_first_approval"||p.status==="development_ready"||(p.status==="awaiting_final_approval"&&p.sales_review?.recommendation==="ready_for_approval")).length;
 return `<section class="proposal-workspace"><div class="proposal-intro"><h3>AI事業の承認・販売判断</h3><p>操作が必要な案件と、販売根拠不足で保留中の案件を分けて確認できます。販売根拠不足は承認依頼ではありません。</p><div class="proposal-summary"><span>あなたの操作待ち <b>${count}件</b></span><span>全案件 <b>${sorted.length}件</b></span></div>${priorityPicker}</div>${sorted.map(p=>isPartnerLinkImplemented(p)?partnerLinkProductPanel(p):`<details class="proposal-item" ${(p.status==="awaiting_first_approval"||p.status==="development_ready"||(p.status==="awaiting_final_approval"&&p.sales_review?.recommendation==="ready_for_approval"))?'open':''}><summary><span class="proposal-item-title">${esc(p.title)}</span><span class="proposal-item-status">${esc(names[p.status]||p.status)}</span></summary><div class="proposal-item-body"><p class="proposal-next"><b>今の段階：</b>${esc(proposalNext(p.status))}</p><details class="proposal-meta"><summary>事業内容・差別化・IDを見る</summary><small>事業ID：${esc(p.id)}</small><p>${esc(p.brief?.problem||"")}</p><p><b>提案：</b>${esc(p.brief?.solution||"")}</p><p><b>差別化仮説：</b>${esc(p.brief?.competitive_position||"")}</p></details><button type="button" data-legal-review="${esc(p.id)}">法務審査を確認・記録</button><p class="proposal-version">デザイン第${Number(p.revision_number)||1}版 ／ 試作品第${Number(p.prototype_revision_number)||1}版</p>
 ${p.design_html?`<details class="design-preview"><summary>Geminiのデザイン案を見る（操作不可）</summary><iframe title="Geminiデザインプレビュー" sandbox="" referrerpolicy="no-referrer" loading="lazy" style="width:100%;height:480px;border:1px solid #556579;border-radius:14px;background:white" srcdoc="${esc(p.design_html)}"></iframe><details><summary>Geminiのデザインレビュー</summary><p>${esc(p.design_review||"")}</p></details></details>`:"<p>デザインはまだ生成されていません。自動処理の完了をお待ちください。</p>"}
 ${p.status==="awaiting_first_approval"&&p.design_status==="ready"&&!hasPreapprovalTrial(p)?`<p>このデザイン版の非公開試作が未確認です。「内容を維持して非公開試作を作成」と入力し、修正・再提出を依頼してください。</p>`:""}
 ${p.status==="awaiting_first_approval"&&p.design_status==="ready"?`<label for="revision-${esc(p.id)}">修正したい内容・機能・画面への指示</label><textarea id="revision-${esc(p.id)}" data-revision-input="${esc(p.id)}" maxlength="3000" rows="4" style="display:block;width:100%;margin:8px 0" placeholder="例：返品期限を最上部に表示。材料名は選択式にして、入力を簡単にしてください。">${esc(orxeliaRevisionDrafts[p.id]||"")}</textarea><button type="button" data-proposal-action="request_revision" data-proposal-id="${esc(p.id)}">Geminiへ修正依頼・再提出</button> <button type="button" data-proposal-action="approve_development" data-proposal-id="${esc(p.id)}" ${hasPreapprovalTrial(p)?"":"disabled"}>第1承認：本格開発へ</button> <button type="button" data-proposal-action="hold" data-proposal-id="${esc(p.id)}">保留</button>`:""}
 ${p.prototype_html?`<details data-prototype-preview><summary>非公開の動作試作品を確認</summary><iframe title="開発試作品（隔離プレビュー）" sandbox="allow-scripts allow-modals" referrerpolicy="no-referrer" loading="lazy" class="prototype-live-frame" scrolling="auto" srcdoc="${esc(prototypeAutoHeightDocument(p.prototype_html))}"></iframe></details><p>自動テスト：${(p.test_report?.passed===true||p.test_report?.preapproval_trial?.passed===true)?"主要操作の自動検査に合格":"未合格／未確認"}（実機・機能網羅は未検証）</p>`:""}
 ${p.status==="development_ready"&&p.prototype_html?`<label for="prototype-feedback-${esc(p.id)}">動作試作品を実際に使って気づいた不具合・改善点</label><textarea id="prototype-feedback-${esc(p.id)}" data-revision-input="${esc(p.id)}" maxlength="3000" rows="4" style="display:block;width:100%;margin:8px 0" placeholder="例：入力中に文字が消える。登録したデータが消えないようにしてほしい。">${esc(orxeliaRevisionDrafts[p.id]||"")}</textarea><button type="button" data-proposal-action="request_prototype_revision" data-proposal-id="${esc(p.id)}">動作試作品をAIへ修正依頼・再テスト</button><p>試作品第${Number(p.prototype_revision_number)||1}版。修正後は再度こちらで操作確認できます。</p>`:""}
 ${p.status==="development_ready"&&p.brief?.classification!=="internal_validation_not_commercial_proposal"&&p.test_report?.passed===true?`<button type="button" data-proposal-action="request_sales_review" data-proposal-id="${esc(p.id)}">販売審査へ進む</button>`:""}
 ${p.sales_review?.chatgpt_competitor_research?`<details class="sales-review-details"><summary>ChatGPT競合調査・公式URLを見る</summary><p>競合・価格は更新されるため公式ページで再確認してください。無料代替・顧客需要も比較対象です。</p><ul>${(p.sales_review.chatgpt_competitor_research.sources||[]).map(v=>`<li><a href="${esc(v.url||"")}" target="_blank" rel="noopener noreferrer">${esc(v.name||"競合")}</a>：${esc(v.price||"価格未確認")} ／ ${esc(v.features||v.scope||"")}</li>`).join("")}</ul><p><b>勝てる条件の仮説：</b>${esc(p.sales_review.chatgpt_competitor_research.win_hypothesis||p.sales_review.chatgpt_competitor_research.assessment||"未検証")}</p><p><b>Geminiの独立レビュー：</b>${esc(p.sales_review.chatgpt_competitor_research.gemini_independent_review?.status==="pending_quota"?"API制限により未実施":"未確認")}</p></details>`:""}
 ${p.sales_review?.prototype_user_review?.approved===false?`<p class="proposal-next"><b>試作品のユーザー確認：未承認</b>。上の非公開試作品を操作して確認してください。販売承認とは別の手続きです。</p>`:""}
 ${p.sales_review?`<details class="sales-review-details"><summary>販売審査の結果・不足している確認項目</summary><p>${esc(salesReviewJapanese(p.sales_review.note||""))}</p><ul>${(p.sales_review.items||[]).map(item=>`<li>${esc(salesReviewJapanese(item))}</li>`).join("")}</ul></details>`:""}
 ${p.status==="awaiting_final_approval"&&p.sales_review?.recommendation==="ready_for_approval"?`<button type="button" data-proposal-action="approve_sales" data-proposal-id="${esc(p.id)}">最終承認（公開・決済は別途）</button>`:""}
 ${p.revision_summary?`<details><summary>前回の修正指示とレビュー</summary><p>${esc(p.revision_summary)}</p></details>`:""}${p.error_message?`<div role="alert" class="proposal-failure"><strong>デザイン生成を停止しました</strong><p>${esc(p.error_message)}</p><p>${String(p.error_message).includes("Design preview must be static and offline")?"外部スクリプト・通信・CDN等を含むデザインが安全検査で拒否されました。表示や承認の操作では復旧できません。生成側の修正と再実行が必要です。":"処理履歴を確認し、原因を解消してから再実行してください。"}</p><p>この案件は販売・公開されていません。競合優位性が確認できるまで開発再開は保留してください。</p></div>`:""}
 </div></details>`).join("")}</section>`;
}

let readable = true;
try {
  const saved = localStorage.getItem(key);
  if (saved) {
    data = JSON.parse(saved);
    validate(data);
  }
} catch {
  data = empty();
  readable = false;
  $("notice").textContent = "保存データを読み込めません。元のデータを保護するため編集を停止しました。";
}

let tab = "home";
let filter = "すべて";
let date = data.projects.map(p => p.date).filter(Boolean).sort().at(-1) || today();
let month = today().slice(0,7);
let submit;

function preserveRecoverySnapshot(reason) {
  if (!readable) throw Error("保存データを読み込めないためバックアップできません。");
  const snapshot = {at:new Date().toISOString(),reason,data};
  // The separate recovery key is never synchronized or included in ordinary imports.
  try { localStorage.setItem(recoveryKey, JSON.stringify(snapshot)); }
  catch { throw Error("安全用の端末内バックアップを作成できません。空き容量を確認してください。"); }
}
function downloadRecoverySnapshot() {
  const raw = localStorage.getItem(recoveryKey);
  if (!raw) throw Error("復旧用スナップショットがありません。");
  const snapshot = JSON.parse(raw);
  validate(snapshot.data);
  const url = URL.createObjectURL(new Blob([JSON.stringify(snapshot.data,null,2)],{type:"application/json"}));
  const a = document.createElement("a"); a.href=url;
  a.download="ORXELIA-recovery-"+snapshot.at.slice(0,10)+".json";
  document.body.append(a); a.click(); a.remove();
  setTimeout(()=>URL.revokeObjectURL(url),30000);
}
function keepSafetyCopy(reason) {
  if (!readable) throw Error("データが読めないため、安全コピーを作成できません。");
  const rawSales = localStorage.getItem(salesKey);
  if (rawSales !== null) JSON.parse(rawSales);
  const previous = localStorage.getItem(backupKey);
  const history = previous ? JSON.parse(previous) : [];
  if (!Array.isArray(history)) throw Error("安全コピーの形式が不正です。更新を停止しました。");
  const entry = {at:new Date().toISOString(),reason,portfolio:data,sales:rawSales,tasks:localStorage.getItem(tasksKey),evidence:localStorage.getItem(evidenceKey)};
  // Keep three previous versions without modifying the current saved record.
  localStorage.setItem(backupKey,JSON.stringify([entry,...history].slice(0,3)));
}
function exportSafetyCopy() {
  const raw = localStorage.getItem(backupKey);
  if (!raw) throw Error("安全コピーはまだありません。データを編集すると自動作成されます。");
  const history = JSON.parse(raw);
  const url = URL.createObjectURL(new Blob([JSON.stringify(history,null,2)],{type:"application/json"}));
  const link=document.createElement("a"); link.href=url;
  link.download="ORXELIA-safety-history-"+today()+".json";
  document.body.append(link); link.click(); link.remove();
  setTimeout(()=>URL.revokeObjectURL(url),30000);
}
function save(next) {
  if (!readable) throw Error("保存領域を読み込めないため編集できません。");
  validate(next);
  keepSafetyCopy("事業・収支・判断の変更前");
  localStorage.setItem(key, JSON.stringify(next));
  data = next;
  window.dispatchEvent(new Event("orxelia-local-change"));
}
function validate(value) {
  const str = v => typeof v === "string";
  const day = v => str(v) && /^\d{4}-\d{2}-\d{2}$/.test(v) && Number.isFinite(Date.parse(v)) && new Date(v).toISOString().slice(0,10) === v;
  const amount = v => Number.isSafeInteger(v) && v >= 0 && v <= 1000000000000;
  if (value?.version !== 1 || !Array.isArray(value.projects) || !Array.isArray(value.ledger) || !Array.isArray(value.decisions)) throw Error("ORXELIA形式のJSONを選んでください。");
  const ids = new Set(), ranks = new Set(), ledgerKeys = new Set(), counts = new Map();
  for (const p of value.projects) {
    if (!p || !str(p.id) || !p.id || ids.has(p.id) || !str(p.name) || !p.name.trim() ||
        !types.includes(p.type) || !stages.includes(p.stage) || !priorities.includes(p.priority) ||
        ![p.customer,p.note,p.next,p.source].every(str) || !(p.price === null || amount(p.price)) ||
        !Array.isArray(p.history) || !p.history.every(h => h && day(h.date) && str(h.note))) throw Error("事業レコードの形式を確認してください。");
    if (p.reviewBy !== undefined && p.reviewBy !== "" && !day(p.reviewBy)) throw Error("判断期限の日付を確認してください。");
    if (p.passCriteria !== undefined && !str(p.passCriteria)) throw Error("判断基準の形式を確認してください。");
    ids.add(p.id);
    if (p.type === types[0]) {
      if (!day(p.date) || ![0,1,2,3].includes(p.rank)) throw Error("日次候補の日付と重点順位を確認してください。");
      counts.set(p.date, (counts.get(p.date) || 0) + 1);
      if (counts.get(p.date) > 10) throw Error("日次候補は1日10案までです。");
      const slot = p.date + "/" + p.rank;
      if (p.rank && ranks.has(slot)) throw Error("同じ日付に同じ重点順位があります。");
      if (p.rank) ranks.add(slot);
    } else if (p.date !== "" || p.rank !== 0) throw Error("日付と重点順位は日次候補だけに設定できます。");
  }
  for (const row of value.ledger) {
    if (!row || !ids.has(row.project) || !day(row.month + "-01") || !amount(row.revenue) ||
        !amount(row.cost) || !str(row.evidence) || !row.evidence.trim()) throw Error("月次収支と確認元を確認してください。");
    const slot = JSON.stringify([row.project,row.month]);
    if (ledgerKeys.has(slot)) throw Error("同じ事業・月の収支が重複しています。");
    ledgerKeys.add(slot);
  }
  if (value.importLog !== undefined && (!Array.isArray(value.importLog) || value.importLog.length > 200 || !value.importLog.every(r => r && typeof r.at === "string" && !Number.isNaN(Date.parse(r.at)) && typeof r.date === "string" && typeof r.projects === "number" && Number.isInteger(r.projects) && r.projects >= 0 && typeof r.decisions === "number" && Number.isInteger(r.decisions) && r.decisions >= 0))) throw Error("取り込み履歴の形式を確認してください。");
  for (const d of value.decisions) {
    if (!d || !day(d.date) || !str(d.title) || !d.title.trim() || !str(d.note) ||
        !["提案","決定済み","保留","却下"].includes(d.status) || !str(d.source)) throw Error("経営判断の形式を確認してください。");
    if (d.activity !== undefined) {
      const a = d.activity;
      if (!a || !str(a.runId) || !a.runId.trim() || !str(a.task) || !a.task.trim() ||
          !activityStates.includes(a.state) || !str(a.updatedAt) ||
          !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?(?:Z|[+-]\d{2}:\d{2})$/.test(a.updatedAt) ||
          !Number.isFinite(Date.parse(a.updatedAt)) ||
          !Array.isArray(a.steps) || !a.steps.length || a.steps.length > 12 ||
          !a.steps.every(step => str(step) && step.trim()) ||
          !Number.isInteger(a.completed) || a.completed < 0 || a.completed > a.steps.length ||
          !str(a.current) || !str(a.next) || !str(a.blocker) ||
          (a.state === "完了" && a.completed !== a.steps.length) ||
          (a.state === "停止" && !a.blocker.trim())) throw Error("作業進捗の形式を確認してください。");
    }
  }
}

const badge = value => '<span class="chip">' + esc(value) + '</span>';
const metric = (title, value, note) => '<div class="metric"><small>' + esc(title) + '</small><b>' + esc(value) + '</b><span>' + esc(note) + '</span></div>';
const action = (label, fn, value = "", primary = false) => '<button type="button" data-action="' + fn + '" data-value="' + esc(value) + '"' + (primary ? ' class="primary"' : '') + '>' + esc(label) + '</button>';
const heading = (title, buttons = "") => '<div class="head"><h2>' + title + '</h2><div class="actions">' + buttons + '</div></div>';
const panel = content => '<div class="panel">' + content + '</div>';
const grid = cards => '<div class="grid">' + cards.join("") + '</div>';

function card(p) {
  const history = [...p.history].reverse().map(h => '<li><time>' + esc(h.date) + '</time>　' + esc(h.note) + '</li>').join("");
  return '<article><h3>' + esc(p.name) + '</h3><div class="chips">' +
    [p.type, p.stage, "優先度 " + p.priority, ...(p.rank ? ["重点 " + p.rank] : [])].map(badge).join("") +
    '</div>' + (p.customer ? '<p>対象　' + esc(p.customer) + '</p>' : '') +
    (p.price === null ? '' : '<p>価格仮説　' + yen(p.price) + ' / 月</p>') +
    (p.note ? '<p>' + esc(p.note) + '</p>' : '') +
    (p.reviewBy ? '<p>判断期限　' + esc(p.reviewBy) + '</p>' : '') +
    (p.passCriteria ? '<p>判断基準　' + esc(p.passCriteria) + '</p>' : '') +
    '<p>次の行動　' + esc(p.next || "未設定") + '</p><details><summary>進捗履歴・出典</summary><p>' +
    esc(p.source) + '</p>' + (history ? '<ol>' + history + '</ol>' : '<p>履歴は未登録です。</p>') + '</details>' +
    action("編集・進捗を記録","project",p.id) + action("この事業を削除","projectDelete",p.id) + '</article>';
}


// v12: opt-in catalog merge; never overwrites existing records.
const initialCatalog = [{"id":"orxelia-catalog-01","name":"見積もり催促・追客管理","type":"過去の候補","stage":"未確認","priority":"高","date":"","rank":0,"price":1480,"customer":"","note":"引き継ぎ台帳（実績未確認）。2026-11-05候補。","next":"見積提出後の追客漏れを検証","source":"2026-11-05 引き継ぎプロンプト","history":[]},{"id":"orxelia-catalog-02","name":"契約更新・解約期限アラート","type":"過去の候補","stage":"未確認","priority":"高","date":"","rank":0,"price":980,"customer":"","note":"引き継ぎ台帳（実績未確認）。2026-11-05候補。","next":"更新忘れの頻度と支払意思を調査","source":"2026-11-05 引き継ぎプロンプト","history":[]},{"id":"orxelia-catalog-03","name":"定期点検・保守期限管理","type":"過去の候補","stage":"未確認","priority":"高","date":"","rank":0,"price":2480,"customer":"","note":"引き継ぎ台帳（実績未確認）。2026-11-05候補。","next":"点検期限管理の需要を検証","source":"2026-11-05 引き継ぎプロンプト","history":[]},{"id":"orxelia-catalog-04","name":"顧客提出書類の回収管理","type":"過去の候補","stage":"未確認","priority":"中","date":"","rank":0,"price":1980,"customer":"","note":"引き継ぎ台帳（実績未確認）。2026-11-05候補。","next":"提出書類の回収負担を調査","source":"2026-11-05 引き継ぎプロンプト","history":[]},{"id":"orxelia-catalog-05","name":"店舗の日次引継ぎノート","type":"過去の候補","stage":"未確認","priority":"中","date":"","rank":0,"price":1480,"customer":"","note":"引き継ぎ台帳（実績未確認）。2026-11-05候補。","next":"店舗担当者へ課題を確認","source":"2026-11-05 引き継ぎプロンプト","history":[]},{"id":"orxelia-catalog-06","name":"求人応募者への返信漏れ防止","type":"過去の候補","stage":"未確認","priority":"中","date":"","rank":0,"price":1980,"customer":"","note":"引き継ぎ台帳（実績未確認）。2026-11-05候補。","next":"採用担当者へ課題を確認","source":"2026-11-05 引き継ぎプロンプト","history":[]},{"id":"orxelia-catalog-07","name":"車両・工具の点検期限管理","type":"過去の候補","stage":"未確認","priority":"中","date":"","rank":0,"price":1480,"customer":"","note":"引き継ぎ台帳（実績未確認）。2026-11-05候補。","next":"対象事業者へ需要を確認","source":"2026-11-05 引き継ぎプロンプト","history":[]},{"id":"orxelia-catalog-08","name":"定期購入・サブスク支出監査","type":"過去の候補","stage":"未確認","priority":"中","date":"","rank":0,"price":980,"customer":"","note":"引き継ぎ台帳（実績未確認）。2026-11-05候補。","next":"解約忘れの実態を調査","source":"2026-11-05 引き継ぎプロンプト","history":[]},{"id":"orxelia-catalog-09","name":"講師向け月謝未納管理","type":"過去の候補","stage":"未確認","priority":"中","date":"","rank":0,"price":1480,"customer":"","note":"引き継ぎ台帳（実績未確認）。2026-11-05候補。","next":"講師へ課題を確認","source":"2026-11-05 引き継ぎプロンプト","history":[]},{"id":"orxelia-catalog-10","name":"納品後フォロー自動化","type":"過去の候補","stage":"未確認","priority":"中","date":"","rank":0,"price":1980,"customer":"","note":"引き継ぎ台帳（実績未確認）。2026-11-05候補。","next":"納品後対応の課題を調査","source":"2026-11-05 引き継ぎプロンプト","history":[]},{"id":"orxelia-catalog-11","name":"入金漏れ・未回収チェッカー","type":"過去の候補","stage":"未確認","priority":"未設定","date":"","rank":0,"price":null,"customer":"","note":"引き継ぎ台帳（実績未確認）。","next":"過去案の状況を確認","source":"2026-11-05 引き継ぎプロンプト","history":[]},{"id":"orxelia-catalog-12","name":"現場写真・工事記録整理ツール","type":"過去の候補","stage":"未確認","priority":"未設定","date":"","rank":0,"price":null,"customer":"","note":"引き継ぎ台帳（実績未確認）。","next":"過去案の状況を確認","source":"2026-11-05 引き継ぎプロンプト","history":[]},{"id":"orxelia-catalog-13","name":"キャンセル待ち自動案内ツール","type":"過去の候補","stage":"未確認","priority":"未設定","date":"","rank":0,"price":null,"customer":"","note":"引き継ぎ台帳（実績未確認）。","next":"過去案の状況を確認","source":"2026-11-05 引き継ぎプロンプト","history":[]},{"id":"orxelia-catalog-14","name":"LIFE EDIT","type":"既存プロジェクト","stage":"未確認","priority":"未設定","date":"","rank":0,"price":null,"customer":"","note":"引き継ぎ台帳（実績未確認）。","next":"開発・公開状況を確認","source":"2026-11-05 引き継ぎプロンプト","history":[]},{"id":"orxelia-catalog-15","name":"FIT NOTE","type":"既存プロジェクト","stage":"未確認","priority":"未設定","date":"","rank":0,"price":null,"customer":"","note":"引き継ぎ台帳（実績未確認）。","next":"開発・公開状況を確認","source":"2026-11-05 引き継ぎプロンプト","history":[]},{"id":"orxelia-catalog-16","name":"MOMENT","type":"既存プロジェクト","stage":"未確認","priority":"未設定","date":"","rank":0,"price":null,"customer":"","note":"引き継ぎ台帳（実績未確認）。","next":"開発・公開状況を確認","source":"2026-11-05 引き継ぎプロンプト","history":[]},{"id":"orxelia-catalog-17","name":"SOBARIO","type":"既存プロジェクト","stage":"保留","priority":"低","date":"","rank":0,"price":null,"customer":"","note":"引き継ぎ台帳（実績未確認）。","next":"中止中：再開には明示承認が必要","source":"2026-11-05 引き継ぎプロンプト","history":[]},{"id":"orxelia-catalog-18","name":"START FIND","type":"既存プロジェクト","stage":"保留","priority":"低","date":"","rank":0,"price":null,"customer":"","note":"引き継ぎ台帳（実績未確認）。","next":"保留中：再開には明示承認が必要","source":"2026-11-05 引き継ぎプロンプト","history":[]},{"id":"orxelia-catalog-19","name":"SaaS向け紹介報酬管理サービス","type":"既存プロジェクト","stage":"保留","priority":"低","date":"","rank":0,"price":null,"customer":"","note":"引き継ぎ台帳（実績未確認）。","next":"保留中：再開には明示承認が必要","source":"2026-11-05 引き継ぎプロンプト","history":[]}];
const normalizedName = name => String(name).normalize("NFKC").toLowerCase().replace(/[\s\u3000・･_－ー-]/g, "");
function catalogPreview() {
  const existingNames = new Set(data.projects.map(p => normalizedName(p.name)));
  const existingIds = new Set(data.projects.map(p => p.id));
  const additions = initialCatalog.filter(p => !existingNames.has(normalizedName(p.name)) && !existingIds.has(p.id));
  return {additions,skipped:initialCatalog.length-additions.length};
}
function mergeCatalog() {
  const {additions,skipped} = catalogPreview();
  if (!additions.length) { $("notice").textContent = "台帳19件は登録済み、または名称が一致しています。既存データは変更していません。"; return; }
  if (!confirm("引き継ぎ台帳19件のうち、新規 " + additions.length + "件を追加し、" + skipped + "件を重複候補として除外します。\n既存の事業・収支・判断は変更しません。追加しますか？")) return;
  save({...data,projects:[...data.projects,...additions]});
  render();
  $("notice").textContent = additions.length + "件を追加しました。ステータスや売上は未確認のままです。";
}
function pendingDecisionSummary() {
  const pending = data.decisions.filter(d => !d.activity && d.status === "提案");
  return panel('<h3>承認待ちの経営判断　' + pending.length + '件</h3>' +
    (pending.length ? '<p>' + pending.slice(0,3).map(d => esc(d.title)).join(' ／ ') + '</p>' : '<p>現在、承認待ちはありません。</p>') +
    '<p>承認は記録のみです。外部への実行は行いません。</p>' + action("判断一覧を確認","openDecisions"));
}

function executiveOverview() {
  const projects = activeProjects();
  const rows = data.ledger.filter(r => r.month === month);
  const sum = field => rows.reduce((total,r) => total + r[field], 0);
  const revenue = sum("revenue"), cost = sum("cost");
  const active = projects.filter(p => ["検証中", "開発中"].includes(p.stage));
  const top = [...active].sort((a,b) => ({"高":0,"中":1,"低":2,"未設定":3}[a.priority] - {"高":0,"中":1,"低":2,"未設定":3}[b.priority]))[0];
  const finances = rows.length ? yen(revenue-cost) : "未確認";
  return '<div class="head"><h2>経営サマリー</h2></div><div class="metrics overview-metrics">' +
    metric("管理事業",projects.length,"登録済みの全区分") +
    metric("検証中",projects.filter(p=>p.stage === "検証中").length,"登録済み") +
    metric("開発中",projects.filter(p=>p.stage === "開発中").length,"登録済み") +
    metric("販売・収益化",projects.filter(p=>["販売中","収益化済み"].includes(p.stage)).length,"登録ステータス") +
    metric("月間売上",rows.length ? yen(revenue) : "未確認",month + "・入力済みのみ") +
    metric("月間費用",rows.length ? yen(cost) : "未確認",month + "・入力済みのみ") +
    metric("差引収支",finances,"税引前・入力済みのみ") +
    '' +
    '</div>' + panel('<h3>最優先の経営課題</h3><p>' +
    (top ? esc(top.name + "：" + (top.next || "次の行動を登録してください")) : "優先案件の試作と動作確認を進めます。") +
    '</p><p>2027年末目標：10事業が各月10万円以上の税引後純利益。現在の収支入力は売上と費用のみのため、達成率は算定していません。未入力の事業は0円とみなしません。</p></div>') + pendingDecisionSummary();
}

const businessSteps = ["候補","検証","開発","販売","収益化"];
const businessStageIndex = {"未確認":0,"未検証":0,"検証中":1,"開発中":2,"販売中":3,"収益化済み":4};

function displayedBusinessStage(project, activities) {
  if (["販売中","収益化済み","保留","終了"].includes(project.stage)) return project.stage;
  const state = activities.get(normalizedName(project.name))?.state;
  if (state === "検証中" || (state === "判断待ち" && project.name === currentResearchProject)) return "検証中";
  if (state === "試作中") return "開発中";
  return project.stage;
}

function portfolioProgress(project, evidence, stage) {
  const index = businessStageIndex[stage];
  const records = evidence?.filter(row => row.project === project.id);
  const confirmed = records?.filter(row => ["資料確認済み","社内動作確認済み","販売実績確認済み"].includes(row.status)).length;
  return '<article class="business-progress"><h3>' + esc(project.name) + '</h3>' +
    badge(stage) + (project.priority === "未設定" ? "" : badge("優先度 " + project.priority)) +
    (index === undefined ? "" : '<ol class="business-steps" aria-label="事業の段階">' +
      businessSteps.map((step,i) => '<li' + (i === index ? ' aria-current="step"' : '') + '>' + step + '</li>').join("") + '</ol>') +
    '<p>' + (records ? (records.length ? '確認済み ' + confirmed + '件 ／ 未確認・仮説 ' + (records.length-confirmed) + '件' : '検証記録なし') : '検証記録を読み込めません') + '</p>' +
    '<p>次の行動　' + esc(project.next || "未設定") + '</p>' +
    businessRemovalButton(project) + details("事業の詳細・編集",card(project)) + '</article>';
}

function portfolio(activities) {
  const selected = activeProjects().filter(p => filter === "すべて" || p.type === filter).sort((a,b) => ({"高":0,"中":1,"低":2,"未設定":3}[a.priority] - {"高":0,"中":1,"低":2,"未設定":3}[b.priority]));
  const filters = ["すべて",...types].map(t => '<option' + (t === filter ? ' selected' : '') + '>' + t + '</option>').join("");
  const evidence = loadEvidence();
  const cloudByLegacy = new Map(orxeliaTrialProposals.filter(p=>p.brief?.legacy_id).map(p=>[p.brief.legacy_id,p]));
  const cloudByName = new Map(orxeliaTrialProposals.map(p=>[p.title,p]));
  const statuses={awaiting_selection:"デザイン生成待ち",designing:"Geminiデザイン生成中",awaiting_first_approval:"デザイン確認・第1承認待ち",revision_requested:"デザイン修正依頼済み",revising:"デザイン修正中",approved_for_development:"試作品開発待ち",developing:"AI試作品開発中",development_ready:"動作試作品の確認・修正待ち",prototype_revision_requested:"試作品修正受付済み",prototype_revising:"試作品修正・テスト中",sales_review_requested:"販売審査中",awaiting_final_approval:"販売判断待ち",final_approved:"販売方針承認済み",failed:"AI処理エラー",on_hold:"保留"};
  const rows=selected.map(project=>{
    const cloud=cloudByLegacy.get(project.id)||cloudByName.get(project.name);
    if(isPartnerLinkImplemented(cloud))return partnerLinkProductPanel(cloud);
    if(!cloud)return portfolioProgress(project,evidence,displayedBusinessStage(project,activities));
    return '<article class="business-progress portfolio-tile"><span class="portfolio-status">'+esc(statuses[cloud.status]||cloud.status)+'</span><h3>'+esc(project.name)+'</h3><p class="portfolio-next">'+esc(proposalNext(cloud.status))+'</p><button type="button" data-tab="verification">承認・詳細を見る</button>'+businessRemovalButton(project,cloud) + details("過去の記録・編集",card(project))+'</article>';
  });
  const linked = new Set(selected.map(p=>(cloudByLegacy.get(p.id)||cloudByName.get(p.name))?.id).filter(Boolean));
  const extra = filter==="すべて"?orxeliaTrialProposals.filter(p=>!linked.has(p.id)).map(p=>isPartnerLinkImplemented(p)?partnerLinkProductPanel(p):'<article class="business-progress portfolio-tile"><span class="portfolio-status">'+esc(statuses[p.status]||p.status)+'</span><h3>'+esc(p.title)+'</h3><p class="portfolio-next">'+esc(proposalNext(p.status))+'</p><button type="button" data-tab="verification">承認・詳細を見る</button>'+businessRemovalButton(null,p)+'</article>'):[];
  return heading("事業一覧",action("＋ 事業を登録","project","",true)+'<button type="button" data-development-request>作りたいシステムを依頼</button>')+
    '<p class="portfolio-guide">事業ごとの現在地と、次に必要な行動をまとめました。承認・修正は「承認・販売」で操作できます。</p>'+
    '<label>表示する事業<select id="filter">'+filters+'</select></label>'+
    (rows.length||extra.length?grid([...rows,...extra]):panel('<p>この区分の登録は0件です。</p>')) + removedBusinessesPanel();
}

function activeQueue() {
  const priority = ["高", "中", "低", "未設定"];
  return activeProjects().filter(p => ["検証中", "開発中"].includes(p.stage))
    .sort((a,b) => (a.reviewBy || "9999").localeCompare(b.reviewBy || "9999") ||
      priority.indexOf(a.priority) - priority.indexOf(b.priority));
}

function exportBrief() {
  const clip = (value, limit) => (value || "").slice(0, limit);
  const queue = activeQueue();
  const brief = {
    date: today(), activeCount: queue.length,
    selected: queue.slice(0, 6).map(p => ({
      name: clip(p.name, 140), stage: p.stage, priority: p.priority,
      reviewBy: p.reviewBy || "", next: clip(p.next, 300),
      passCriteria: clip(p.passCriteria, 300), evidence: clip(p.note, 500)
    }))
  };
  const blob = new Blob([JSON.stringify(brief,null,2)], {type:"application/json"});
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = "orxelia-brief-" + brief.date + ".json";
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function daily() {
  const ideas = activeProjects().filter(p => p.type === types[0] && p.date === date);
  const top = ideas.filter(p => p.rank).sort((a,b) => a.rank - b.rank);
  const days = [...new Set(data.projects.map(p => p.date).filter(Boolean))].sort().reverse();
  const queue = activeQueue();
  return heading("日次レポート", action("＋ 日次候補","dailyProject","",true)) +
    '<div class="head"><h3>進行中の案件</h3></div>' +
    panel('<p>検証中 ' + queue.filter(p => p.stage === "検証中").length +
      '件 ／ 開発中 ' + queue.filter(p => p.stage === "開発中").length +
      '件。判断期限、優先度の順に表示します。</p>' +
      '<p>GPT用の要約は上位6件です。事業メモが含まれるため共有前に確認してください。</p>' +
      action("GPT用の要約を書き出す","brief")) +
    (queue.length ? grid(queue.map(card)) : "") +
    '<label>対象日（日本時間）<input id="day" type="date" value="' + esc(date) + '"></label>' +
    (days.length ? '<label>登録済みの日付<select id="registered"><option value="">選択</option>' +
      days.map(d => '<option>' + d + '</option>').join("") + '</select></label>' : '') +
    '<p>' + ideas.length + ' / 10案 ・ 重点 ' + top.length + ' / 3案 ／ 手動登録</p>' +
    (top.length ? '<div class="head"><h3>重点検証</h3></div>' + grid(top.map(card)) : panel('<p>この日の重点候補は未登録です。</p>')) +
    '<div class="head"><h3>日次候補一覧</h3></div>' + (ideas.length ? grid(ideas.map(card)) : panel('<p>この日の候補は未登録です。</p>'));
}
function financeModel() {
  const rows = data.projects.filter(p => p.price !== null && p.price > 0).slice(0,50);
  const contribution = 0.7, tax = 0.3, target = 100000;
  return panel('<h3>月10万円の税引後利益：仮説試算</h3>' +
    '<p>仮定：顧客1件当たり限界利益率70%、利益への税負担30%、その他固定費0円。実績・税額の確定計算ではありません。決済手数料・集客費・解約率・実際の税務条件は別途検証が必要です。</p>' +
    (rows.length ? '<div class="model-list">' + rows.map(p => {
      const n = Math.ceil(target / (p.price * contribution * (1-tax)));
      return '<p><strong>' + esc(p.name) + '</strong>：月額 ' + yen(p.price) + ' → 必要顧客数 <strong>' + n + '件</strong>（仮説）</p>';
    }).join('') + '</div>' : '<p>月額料金が登録された事業がありません。</p>'));
}
function strategyAnalysis() {
  const stageScore = {"未確認":0,"未検証":0,"検証中":2,"開発中":2,"販売中":3,"収益化済み":4,"保留":-2,"終了":-3};
  const priorityScore = {"高":2,"中":1,"低":0,"未設定":0};
  const active = data.projects.filter(p => !["保留","終了"].includes(p.stage));
  const scored = active.map(p => {
    const evidence = data.ledger.filter(r => r.project === p.id);
    const hasSales = evidence.some(r => r.revenue > 0);
    const positive = evidence.some(r => r.revenue > r.cost);
    const score = (stageScore[p.stage] || 0) + (priorityScore[p.priority] || 0) + (hasSales ? 3 : 0) + (positive ? 2 : 0) + (p.next?.trim() ? 1 : 0);
    const missing = [!evidence.length && "収支実績", !p.customer?.trim() && "対象顧客", !p.next?.trim() && "次の行動", p.price === null && "価格仮説"].filter(Boolean);
    return {p, score, missing, hasSales};
  }).sort((a,b) => b.score-a.score || a.p.name.localeCompare(b.p.name,"ja"));
  return panel('<h3>経営判断の補助スコア（暫定）</h3>' +
    '<p>進捗段階・手動優先度・入力済み売上・差引収支・次の行動を加点する簡易ルールです。市場需要、成功確率、税引後利益を推定するものではありません。未入力は実績ゼロとみなしません。</p>' +
    (scored.length ? '<div class="model-list">' + scored.slice(0,10).map(({p,score,missing,hasSales}) =>
      '<p><strong>' + esc(p.name) + '</strong>：' + score + '点（' + esc(p.stage) + '）' +
      (hasSales ? '／売上記録あり' : '／売上未確認') +
      '<br>不足情報：' + esc(missing.join('・') || 'この基準ではなし') + '</p>').join('') + '</div>' : '<p>分析対象の事業がありません。</p>') +
    '<p>この順位は開発投資の承認ではありません。競合調査、社内試作、公開後の販売実績を基に判断してください。</p>');
}

function executiveInsights() {
  const targetPerBusiness = 100000, goalBusinesses = 10, taxAssumption = 0.30;
  const latestMonths = [...new Set(data.ledger.map(r => r.month))].sort().reverse();
  const latest = latestMonths[0];
  const rows = latest ? data.ledger.filter(r => r.month === latest) : [];
  const byProject = new Map(rows.map(r => [r.project,r]));
  const verified = data.projects.map(p => ({p,r:byProject.get(p.id)})).filter(x=>x.r);
  const estimate = r => Math.max(0,(r.revenue-r.cost)*(1-taxAssumption));
  const achievers = verified.filter(x => estimate(x.r) >= targetPerBusiness);
  const gap = Math.max(0,goalBusinesses-achievers.length);
  const outstanding = data.projects.filter(p=>!['保留','終了'].includes(p.stage)).map(p=>{
    const r=byProject.get(p.id);
    const missing=[];
    if(!r) missing.push('月次収支');
    if(!p.customer?.trim()) missing.push('想定顧客');
    if(!p.next?.trim()) missing.push('次の行動');
    if(!p.reviewBy) missing.push('判断期限');
    return {p,r,missing};
  });
  const needs = outstanding.filter(x=>x.missing.length).sort((a,b)=>b.missing.length-a.missing.length).slice(0,8);
  const near = outstanding.filter(x=>x.r && x.r.revenue>x.r.cost).sort((a,b)=>estimate(b.r)-estimate(a.r)).slice(0,5);
  return heading('経営分析・次の行動') +
    panel('<h3>2027年末の目標に対する現在地</h3><p>目標：独立した10事業で、それぞれ月間税引後純利益10万円以上。以下は登録された収支のみに基づく参考値です。</p>'+
      grid([metric('目標事業数',goalBusinesses+'事業','2027年末'),metric('参考達成数',achievers.length+'事業',latest ? latest+'の入力済み収支から試算':'収支データ未登録'),metric('目標との差',gap+'事業','参考達成数との差'),metric('収支入力',verified.length+' / '+data.projects.length+'事業',latest||'対象月なし')])+
      '<p class="warn">注意：税率30%を一律に仮定した概算です。売上−入力費用を税引前利益とみなす単純計算であり、実際の税引後純利益・達成認定ではありません。未入力事業は未達成ではなく「不明」です。</p>')+
    panel('<h3>次に確認すべき情報</h3><p>以下は入力不足を機械的に抽出した確認候補です。自動調査や外部への連絡は実行しません。</p>'+
      (needs.length ? '<div class="model-list">'+needs.map(x=>'<p><strong>'+esc(x.p.name)+'</strong>：'+esc(x.missing.join('・'))+'を確認</p>').join('')+'</div>':'<p>入力不足として抽出された項目はありません。</p>'))+
    panel('<h3>収支がプラスの事業（参考順位）</h3><p>直近の入力済み月 '+esc(latest||'なし')+'。収支未登録の事業は順位に含みません。</p>'+
      (near.length ? '<div class="model-list">'+near.map(x=>'<p><strong>'+esc(x.p.name)+'</strong>：参考税引後 '+yen(Math.floor(estimate(x.r)))+' ／ 月額目標との差 '+yen(Math.max(0,targetPerBusiness-Math.floor(estimate(x.r))))+'</p>').join('')+'</div>':'<p>入力済みで収支がプラスの事業はありません。</p>'))+
    strategyAnalysis() + financeModel();
}

function finance() {
  const rows = data.ledger.filter(r => r.month === month);
  const revenue = rows.reduce((total,r) => total + r.revenue,0);
  const cost = rows.reduce((total,r) => total + r.cost,0);
  const records = data.projects.map(p => {
    const r = rows.find(row => row.project === p.id);
    return '<article><h3>' + esc(p.name) + '</h3>' +
      (r ? '<p>売上 ' + yen(r.revenue) + ' ／ 費用 ' + yen(r.cost) + ' ／ 差引収支（税引前・暫定） ' + yen(r.revenue-r.cost) +
      '</p><p>確認元　' + esc(r.evidence) + '</p>' + (r.revenue === 0 && r.cost === 0 ? badge("入力済み実績ゼロ") : '') : '<p>未登録 ／ 実績不明</p>') +
      '<div class="actions">' + action(r ? "収支を編集" : "収支を登録","ledger",p.id) +
      (r ? action("入力を削除","removeLedger",p.id) : '') + '</div></article>';
  });
  return heading("月次収支") + '<label>対象月<input id="month" type="month" value="' + esc(month) + '"></label>' +
    '<div class="metrics">' +
    [ ["売上",revenue], ["費用",cost], ["差引収支",revenue-cost] ].map(([title,value]) =>
      metric(title, rows.length ? yen(value) : "未登録", rows.length ? "入力済み " + rows.length + " / " + data.projects.length + "件の合計" : "実績未登録")).join("") +
    '</div><p>差引収支は入力した売上 − 費用であり、営業利益・税引後純利益とは異なります。確認済みの月次実績だけを登録してください。</p>' +
    (records.length ? grid(records) : panel('<p>収支を入力する事業を先に登録してください。</p>'));
}

const quoteDemo = '<a class="demo-link" href="./quote-followup-demo.html" target="_blank" rel="noopener">試作を開く</a>';
const hasTrial = a => a.task === "見積もり催促・追客管理" && a.completed >= 2;

function progressGroups() {
  const groups = new Map();
  for (const d of data.decisions) {
    if (!d.activity) continue;
    const events = groups.get(d.activity.task) || [];
    events.push(d);
    groups.set(d.activity.task, events);
  }
  return [...groups.values()].map(events =>
    events.sort((a,b) => Date.parse(b.activity.updatedAt) - Date.parse(a.activity.updatedAt))
  ).sort((a,b) => Date.parse(b[0].activity.updatedAt) - Date.parse(a[0].activity.updatedAt));
}

function currentProgress(events) {
  return events.find(d => !d.activity.current.startsWith("過去の調査記録。"));
}

function latestProjectActivities() {
  const latestByName = new Map();
  for (const events of progressGroups()) {
    const latest = currentProgress(events)?.activity;
    if (!latest) continue;
    const name = normalizedName(latest.task);
    if (Date.parse(latest.updatedAt) > (Date.parse(latestByName.get(name)?.updatedAt) || 0)) {
      latestByName.set(name,latest);
    }
  }
  return latestByName;
}

function progressCard(events, showHistory) {
  const latest = currentProgress(events) || events[0];
  const a = latest.activity;
  const ready = hasTrial(a);
  const oldReview = a.blocker === "ご自身の試用・承認待ち。承認後に本格開発へ進む。";
  const status = oldReview ? "試作できました" : a.state === "準備中" ? "準備中" : a.state;
  const current = a.current || "まだ報告がありません。";
  const next = oldReview ? "AIが費用のかからない改善を続けます。" : (a.next || "次の作業はまだ決まっていません。");
  const reason = a.blocker && !oldReview ? '<p><strong>止まっている理由</strong>　' + esc(a.blocker) + '</p>' : '';
  const owner = reason ? "止まっている理由を確認してください。" :
    ready ? "気になったら試せます。必須の作業はありません。" : "今はすることはありません。";
  const history = showHistory ? '<details><summary>これまでの報告（' + events.length + '件）</summary>' +
    events.map(event => '<p>' + esc(new Date(event.activity.updatedAt).toLocaleString("ja-JP",{timeZone:"Asia/Tokyo",hour12:false})) +
      ' ／ ' + esc(event.activity.state) + '</p><p>' + esc(event.note) + '</p><p>出典　' + esc(event.source) + '</p>').join("") + '</details>' : '';
  return '<article class="owner-next"><h3>' + esc(a.task) + '</h3><div class="chips">' + badge(status) + '</div>' +
    '<p><strong>いま</strong>　' + esc(current) + '</p>' +
    '<p><strong>次</strong>　' + esc(next) + '</p>' + reason +
    '<p><strong>あなた</strong>　' + esc(owner) + '</p>' +
    (ready ? quoteDemo : '') + history + '</article>';
}

function ownerOverview() {
  const groups = progressGroups();
  const proposals = data.decisions.filter(d => !d.activity && d.status === "提案").length;
  return heading("いまの進み具合") +
    (proposals ? panel('<p>確認できる判断が ' + proposals + ' 件あります。</p><button type="button" data-tab="decisions">判断を見る</button>') :
      panel('<p>確認待ちの判断はありません。費用のかからない作業はAIが進めます。</p>')) +
    (groups.length ? grid(groups.map(events => progressCard(events,false))) : panel('<p>まだ報告がありません。</p>')) +
    '<div class="head"><button type="button" data-tab="progress">これまでの報告を見る</button></div>';
}

function progress() {
  const groups = progressGroups();
  return heading("案件の進み具合", '<button id="sync-now" type="button">最新の報告を取得</button>') +
    (groups.length ? grid(groups.map(events => progressCard(events,true))) : panel('<p>まだ報告がありません。</p>'));
}

function decisionReview(index, status) {
  const old = data.decisions[index];
  if (!old || old.activity || !["決定済み","保留","却下"].includes(status)) throw Error("対象の提案が見つかりません。");
  if (old.status !== "提案") throw Error("提案状態の記録だけを審査できます。編集画面から変更してください。");
  const reason = prompt("判断理由を記録してください（必須）。外部への実行は行われません。");
  if (reason === null) return;
  if (!reason.trim()) throw Error("判断理由を入力してください。");
  if (!confirm("「" + old.title + "」を「" + status + "」にしますか？\nこの操作で外部サービスは実行されません。")) return;
  const stamp = new Date().toLocaleString("ja-JP", {timeZone:"Asia/Tokyo",hour12:false});
  const updated = {...old,status,note:old.note + "\n【審査 " + stamp + " JST／" + status + "】" + reason.trim()};
  save({...data,decisions:data.decisions.map((d,i)=>i===index?updated:d)});
  render();
  $("notice").textContent = "経営判断を記録しました。外部への操作は実行していません。";
}
const currentResearchProject = "見積もり催促・追客管理";
const validationRepo = "tobikyohei8989-tech/orxelia-dashboard";
let validationRun = null;
let validationChecked = 0;
let validationError = false;

function showValidationStatus() {
  const target = $("quote-validation-status");
  if (!target) return;
  const run = validationRun;
  const status = !run ? (validationError ? "取得できません" : "確認中") :
    run.status === "completed" ?
      ({success:"合格",failure:"失敗",cancelled:"中止",timed_out:"時間切れ",skipped:"実行なし"}[run.conclusion] || "完了") :
      run.status === "in_progress" ? "実行中" : "実行待ち";
  const time = run ? new Intl.DateTimeFormat("ja-JP",{
    timeZone:"Asia/Tokyo",dateStyle:"short",timeStyle:"short"
  }).format(new Date(run.updated_at)) : "";
  target.innerHTML = badge(status) + (run ?
    '<span> ' + esc(time) + ' JST</span> <a class="demo-link" href="https://github.com/' + validationRepo +
    '/actions/runs/' + run.id + '" target="_blank" rel="noopener">実行結果</a>' : "") +
    (validationError && run ? '<span> ／ 最新情報を取得できません</span>' : "");
}

async function refreshValidationStatus() {
  if (!$("quote-validation-status") || document.hidden || Date.now() - validationChecked < 75000) return;
  validationChecked = Date.now();
  try {
    const response = await fetch("https://api.github.com/repos/" + validationRepo +
      "/actions/workflows/quote-validation.yml/runs?branch=main&per_page=1",
      {signal:AbortSignal.timeout(8000)});
    if (!response.ok) throw Error("Workflow status unavailable");
    const feed = await response.json();
    const run = feed.workflow_runs?.[0];
    if (!Number.isSafeInteger(run?.id) || !Number.isFinite(Date.parse(run.updated_at))) throw Error("No valid run");
    validationRun = run;
    validationError = false;
  } catch {
    validationError = true;
  }
  showValidationStatus();
}

function launchDecisions() {
  const projects = [...data.projects].sort((a,b) =>
    Number(Object.hasOwn(businessEconomics,b.name)) - Number(Object.hasOwn(businessEconomics,a.name)));
  const amount = value => value == null ? "未算定" : yen(value);
  const rows = projects.map(project => {
    const plan = Object.hasOwn(businessEconomics,project.name) ? businessEconomics[project.name] : null;
    const base = plan ? projectEconomics(plan).scenarios[1] : null;
    return '<tr><th scope="row">' + esc(project.name) + '<small>' +
      (base ? "条件別試算・基準" : "試算準備中") + '</small></th><td>' +
      amount(base?.cost) + '</td><td>' + (base?esc(base.count)+'件':'未算定') + '</td><td>' + amount(base?.revenue) + '</td><td' +
      (base?.profit < 0 ? ' class="warn"' : '') + '><strong>' + amount(base?.profit) +
      '</strong></td></tr>';
  });
  const cards = projects.filter(project => Object.hasOwn(businessEconomics,project.name)).map(project => {
    const plan = Object.hasOwn(businessEconomics,project.name) ? businessEconomics[project.name] : null;
    const result = plan ? projectEconomics(plan) : null;
    const price = plan?.price ?? project.price;
    const scenarios = result ? result.scenarios.map(({count,revenue,profit},index) =>
      badge(["低位","基準","高位"][index] + " " + count + "契約 ／ 売上 " + yen(revenue) + " ／ 利益 " + yen(profit))).join("") :
      '<p>契約見込み・月間売上・月間利益　未算定</p>';
    return '<article><h3>' + esc(project.name) + '</h3>' +
      badge(project.stage) + badge(plan ? "条件別試算" : "試算準備中") +
      '<p>月額価格仮説 <strong>' + amount(price) + '</strong> ／ 1契約あたり月間原価 <strong>' +
      amount(plan?.variable) + '</strong></p><p>月間固定費 <strong>' + amount(plan?.fixed) +
      '</strong> ／ 初期準備費 <strong>' + amount(plan?.initial) +
      '</strong></p><p>月次損益分岐 <strong>' +
      (result ? (result.breakEven === null ? "到達不可" : result.breakEven + "契約") : "未算定") +
      '</strong></p><div class="chips">' + scenarios + '</div>' +
      (plan ? details("試算条件",'<p>' + esc(plan.note) + '</p>') : "") + '</article>';
  });
  return '<section id="launch-decisions" tabindex="-1">' + heading("事業別の販売判断") +
    (projects.some(project => project.name === currentResearchProject) ?
      panel('<h3>見積もり催促・追客管理の自動テスト</h3><div id="quote-validation-status" role="status">確認中</div>' +
        '<p>模擬案件を使った動作テスト。市場調査・販売実績とは別の記録です。</p>') +
      panel('<h3>販売判断は保留</h3><div class="chips">' + badge("市場資料あり") +
        badge("対象層の購入需要は未確認") + badge("商用原価は未確定") + '</div>' +
        details("市場調査の出典と適用範囲",
          '<ul><li>営業支援ツール導入済みBtoB企業の営業管理職111名の調査で、9割以上が提案後の状況把握を難しいと回答。小規模事業者の購入率を示す調査ではありません。 <a href="https://sonybn.co.jp/news/2026/1021/" target="_blank" rel="noopener">調査原文</a></li>' +
          '<li>競合には見積提出後の連絡時期を知らせる機能があります。 <a href="https://ai-dounyuu.com/quote-automation/" target="_blank" rel="noopener">競合の公式機能</a></li></ul>')) : "") +
    '<p>月間原価は固定費と契約ごとの原価の合計。売上と利益は基準シナリオ・税引前。</p>' +
    (rows.length ? '<div class="decision-table" tabindex="0" role="region" aria-label="全事業の月間採算"><table><thead><tr>' +
      '<th scope="col">事業</th><th scope="col">月間原価</th><th scope="col">基準契約数（試算）</th><th scope="col">月間売上見込み</th><th scope="col">月間利益</th>' +
      '</tr></thead><tbody>' + rows.join("") + '</tbody></table></div>' :
      panel('<p>登録事業がありません。</p>')) +
    (cards.length ? details("契約数・損益分岐・試算の根拠",grid(cards)) : "") + '</section>';
}

function decisions() {
  return heading("経営判断", action("＋ 判断を記録","decision","",true)) +
    (data.decisions.some(d => !d.activity) ? grid(data.decisions.map((d,i) => ({d,i})).filter(({d}) => !d.activity).sort((a,b) => b.d.date.localeCompare(a.d.date)).map(({d,i}) =>
      '<article><h3>' + esc(d.title) + '</h3><div class="chips">' + badge(d.date) + badge(d.status) +
      '</div><p>' + esc(d.note) + '</p><p>出典　' + esc(d.source) + '</p>' + (d.status === '提案' ? '<div class="actions">' + action('承認','reviewApprove',i) + action('保留','reviewHold',i) + action('却下','reviewReject',i) + '</div>' : '') + (/^AI(?:事業案|既存事業調査) /.test(d.source) ? "" : action("編集","decision",i)) + '</article>')) :
    panel('<p>判断の記録は未登録です。</p>'));
}
function importLogPanel() {
  const logs = (data.importLog || []).slice(-12).reverse();
  return panel('<h3>日次取り込み履歴</h3><p>追加実績のみ記録します。過去の取り込み分は自動復元されません。</p>' + (logs.length ? '<ol>' + logs.map(r => '<li>' + esc(r.at.slice(0,16).replace("T"," ")) + ' ／ 対象日 ' + esc(r.date) + ' ／ 候補 ' + r.projects + '件・判断 ' + r.decisions + '件</li>').join("") + '</ol>' : '<p>記録はありません。</p>'));
}
function settings() {
  return heading("設定・データ管理") + (window.orxeliaSync?.view() || "") +
    panel('<h3>引き継ぎ事業台帳（19件）</h3><p>既存の事業を保持し、未登録の候補だけ追加します。類似名称は別名として残る場合があります。実績・開発状況は自動確定しません。</p>' + action("追加候補を確認して取り込む","mergeCatalog")) +
    importLogPanel() +
    panel('<h3>初期データ・バックアップ</h3><p>初回は同梱の「初期データ.json」を読み込んでください。読み込みは現在の内容を全件置き換えます。</p>' +
      '<label>日次リンクを貼り付け<textarea id="report-link" rows="2" placeholder="取り込みリンクをここに貼り付け"></textarea></label>' + action("日次レポートを追加","reportPaste","",true) + action("JSONを書き出す","export") + action("端末内の復旧用データを書き出す","recoveryExport") + action("直近3世代の安全コピーを書き出す","safetyExport") + action("全データをまとめてJSON出力","bundleExport") + action("iPhone用：復旧データを画面に表示","recoveryView") + '<label>JSONを読み込む<input type="file" id="import" accept=".json,application/json"></label>') +
    '<div class="head"><h3>運用条件</h3></div>' + panel('<p>初期予算上限 ¥3,000 ／ 新規固定費 ¥0。配布構成でのアプリ費用は初期・月額ともに ¥0。</p><p>ログインすると同じアカウントの端末間で同期します。毎朝7:30の定期作業は、このPCとCodexアプリの起動、ログイン済みブラウザーが必要です。工程ごとの報告はホームの「作業進捗」で確認できます。会計サービスは未連携です。</p><p id="offline">オフラインの状態を確認中…</p>');
}


// v17: Sales pilot is intentionally device-local. It does not enter v16 cloud sync.
const salesStages = ["見込み", "接触済み", "商談中", "契約", "失注"];
function loadSales() {
  try {
    const raw = localStorage.getItem(salesKey);
    if (!raw) return [];
    const rows = JSON.parse(raw);
    if (!Array.isArray(rows) || rows.length > 2000 || !rows.every(r => r && typeof r.name === "string" && typeof r.note === "string" && salesStages.includes(r.stage) && typeof r.id === "string")) throw Error();
    return rows;
  } catch { return null; }
}
function sales() {
  const rows = loadSales();
  if (rows === null) return heading("営業・収益化") + panel('<p class="warn">営業データの形式が不正です。上書きを防ぐため編集を停止しました。</p>');
  const counts = Object.fromEntries(salesStages.map(stage => [stage, rows.filter(r => r.stage === stage).length]));
  const price = 1480, fee = .036, fixed = 0, tax = .30;
  const netPerCustomer = price * (1-fee) * (1-tax);
  const needed = Math.ceil((100000 + fixed*(1-tax)) / netPerCustomer);
  return heading("営業・収益化",action("営業CSVを書き出す","salesExport")) +
    panel('<h3>見積もり追客管理（事業仮説）</h3><p>月額1,480円は仮価格。決済手数料3.6%、税負担30%、固定費0円の単純試算で、その他の費用・税制・解約率は未反映です。</p>' +
    grid([metric("月額想定単価",yen(price),"仮説"),metric("目標契約数",needed+"社","税引後月10万円の概算"),metric("登録契約数",counts["契約"]+"社","手動登録のみ"),metric("想定月額売上",yen(counts["契約"]*price),"入金実績ではありません")])) +
    panel('<h3>見込み客を登録</h3><p>この画面の情報は現在の端末内にのみ保存されます。端末間同期・通常のJSONバックアップには含まれません。個人情報や機密情報は入力しないでください。</p>' +
    '<form id="sales-form"><label>企業・案件名（識別用の略称）<input name="name" maxlength="100" required></label><label>段階<select name="stage">'+salesStages.map(x=>'<option>'+x+'</option>').join('')+'</select></label><label>次の行動・メモ<textarea name="note" maxlength="500"></textarea></label><button class="primary">登録する</button></form>') +
    panel('<h3>営業パイプライン</h3>'+grid(salesStages.map(x=>metric(x,counts[x]+"件","手動記録")))+
    (rows.length ? rows.map(r=>'<article><h3>'+esc(r.name)+'</h3><p>'+esc(r.note)+'</p><label>段階<select data-sales-id="'+esc(r.id)+'">'+salesStages.map(x=>'<option'+(x===r.stage?' selected':'')+'>'+x+'</option>').join('')+'</select></label>'+action('削除','salesDelete',r.id)+'</article>').join('') : '<p>登録はありません。</p>'));
}
function saveSales(rows) { if (loadSales() === null) throw Error("営業データが読み込めません。"); keepSafetyCopy("営業データ変更前"); localStorage.setItem(salesKey,JSON.stringify(rows)); }
function salesExport() {
  const rows=loadSales(); if (rows === null) throw Error("営業データを読み込めません。");
  const csv=[['案件名','段階','メモ'],...rows.map(r=>[r.name,r.stage,r.note])].map(row=>row.map(v=>'"'+String(v).replace(/"/g,'""')+'"').join(',')).join('\r\n');
  const url=URL.createObjectURL(new Blob(['\uFEFF'+csv],{type:'text/csv;charset=utf-8'}));
  const a=document.createElement('a');a.href=url;a.download='ORXELIA-sales-'+today()+'.csv';document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),30000);
}

// v25: action tracking is intentionally local; never claim cloud synchronization.
const taskStates = ["未着手","進行中","完了","保留"];
function loadTasks() {
  try {
    const raw = localStorage.getItem(tasksKey);
    if (!raw) return [];
    const rows = JSON.parse(raw);
    if (!Array.isArray(rows) || rows.length > 3000 || !rows.every(t => t && typeof t.id === "string" && typeof t.title === "string" && t.title.length <= 160 && typeof t.project === "string" && typeof t.due === "string" && (t.due === "" || /^\d{4}-\d{2}-\d{2}$/.test(t.due)) && taskStates.includes(t.state))) throw Error();
    return rows;
  } catch { return null; }
}
function saveTasks(rows) {
  if (loadTasks() === null) throw Error("実行タスクを読み込めないため変更を停止しました。");
  keepSafetyCopy("実行タスクの変更前");
  localStorage.setItem(tasksKey,JSON.stringify(rows));
}
function downloadJson(name,value) {
  const url=URL.createObjectURL(new Blob([JSON.stringify(value,null,2)],{type:"application/json"}));
  const a=document.createElement("a"); a.href=url;a.download=name;a.rel="noopener";
  document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),30000);
}
function exportBundle() {
  if (!readable || loadSales()===null || loadTasks()===null || loadEvidence()===null) throw Error("読み込めないデータがあります。書き出しを停止しました。");
  downloadJson("ORXELIA-all-local-"+today()+".json",{format:"orxelia-bundle-v50",exportedAt:new Date().toISOString(),portfolio:data,sales:loadSales(),tasks:loadTasks(),evidence:loadEvidence()});
}
function tasks() {
  const rows=loadTasks();
  if (rows===null) return heading("実行タスク")+panel('<p class="warn">タスクの保存データを読み込めません。上書き防止のため編集を停止しました。</p>');
  const overdue=rows.filter(t=>t.state!=="完了" && t.due && t.due<today());
  const choices=data.projects.map(p=>'<option value="'+esc(p.id)+'">'+esc(p.name)+'</option>').join('');
  const sorted=[...rows].sort((a,b)=>(a.state==="完了")-(b.state==="完了") || (a.due||"9999").localeCompare(b.due||"9999"));
  return heading("実行タスク",action("タスクJSON出力","tasksExport"))+
    panel('<h3>行動の見える化</h3><p>経営判断から実行へ。タスクは手動で登録・更新します。AIによる自動実行や外部への連絡はありません。</p>'+grid([metric("登録タスク",rows.length+"件","端末内の記録"),metric("進行中",rows.filter(t=>t.state==="進行中").length+"件","手動更新"),metric("期限超過",overdue.length+"件","未完了のみ"),metric("完了",rows.filter(t=>t.state==="完了").length+"件","手動更新")]))+
    panel('<h3>タスクを追加</h3><form id="task-form"><label>やること<input name="title" maxlength="160" required></label><label>対象事業<select name="project"><option value="">共通・未指定</option>'+choices+'</select></label><label>期限<input name="due" type="date"></label><button class="primary">タスク登録</button></form>')+
    panel('<h3>タスク一覧</h3><p>保存先はこの端末のみです。機密情報は登録しないでください。</p>'+(sorted.length?sorted.map(t=>'<article><h3>'+esc(t.title)+'</h3><p>'+esc(data.projects.find(p=>p.id===t.project)?.name||"共通")+' ／ 期限 '+esc(t.due||"未設定")+'</p><label>進捗<select data-task-id="'+esc(t.id)+'">'+taskStates.map(state=>'<option'+(state===t.state?' selected':'')+'>'+state+'</option>').join('')+'</select></label>'+action("削除","taskDelete",t.id)+'</article>').join(''):'<p>まだタスクがありません。</p>'));
}


// v30: evidence is manually entered, not autonomous AI research.
const evidenceTypes = ["公開市場データ","競合実績・価格","収益試算","低コスト・一人運営","法務・技術リスク","小規模販売検証","顧客ヒアリング","社内動作検証"];
const newEvidenceTypes = evidenceTypes.filter(type => type !== "顧客ヒアリング");
const evidenceStatuses = ["未検証","仮説","資料確認済み","販売実績確認済み","顧客確認済み","社内動作確認済み"];
function loadEvidence() {
  try {
    const raw=localStorage.getItem(evidenceKey);
    if (!raw) return [];
    const rows=JSON.parse(raw);
    if (!Array.isArray(rows) || rows.length>3000 || !rows.every(r=>r && typeof r.id==="string" && typeof r.project==="string" && evidenceTypes.includes(r.type) && evidenceStatuses.includes(r.status) && typeof r.summary==="string" && r.summary.length<=1000 && typeof r.source==="string" && r.source.length<=500 && typeof r.date==="string")) throw Error();
    return rows;
  } catch {return null;}
}
function saveEvidence(rows) {
  if(loadEvidence()===null) throw Error("検証データが読み込めないため保存を停止しました。");
  keepSafetyCopy("検証記録の変更前");
  localStorage.setItem(evidenceKey,JSON.stringify(rows));
}
function commandCenter() {
  const tasks=loadTasks(),sales=loadSales(),evidence=loadEvidence();
  if(tasks===null||sales===null||evidence===null) return heading("経営司令室")+panel('<p class="warn">一部の保存データが読み込めません。復旧前に上書きしないでください。</p>');
  const pending=data.decisions.filter(d=>d.status==="提案"&&!d.activity);
  const due=tasks.filter(t=>t.state!=="完了"&&t.due&&t.due<=today()).sort((a,b)=>a.due.localeCompare(b.due));
  const latest=[...new Set(data.ledger.map(r=>r.month))].sort().at(-1);
  const entries=latest?data.ledger.filter(r=>r.month===latest):[];
  const net=entries.reduce((n,r)=>n+r.revenue-r.cost,0);
  return heading("経営司令室")+
    panel('<h3>今日の経営状況</h3><p>登録データの集計です。AIによる自動調査や外部実行は行っていません。</p>'+
      grid([metric("承認待ち",pending.length+"件","判断の記録"),metric("期限到来・超過",due.length+"件","未完了タスク"),metric("検証記録",evidence.length+"件","手動登録"),metric("直近月の差引収支",latest?yen(net):"未登録",latest||"実績不明")]))+
    panel('<h3>先に確認すること</h3>'+
      (pending.length?'<p>承認待ち：'+pending.slice(0,5).map(d=>esc(d.title)).join(" ／ ")+'</p>':'<p>承認待ちの記録はありません。</p>')+
      (due.length?'<p>期限到来：'+due.slice(0,5).map(t=>esc(t.title)+"（"+esc(t.due)+"）").join(" ／ ")+'</p>':'<p>期限到来の未完了タスクはありません。</p>')+
      '<p>承認はアプリ内の記録のみです。外部公開・支払い・顧客連絡は実行されません。</p>'+
      action("経営判断を確認","openDecisions")+action("タスクを確認","openTasks")+action("検証履歴を確認","openEvidence"))+
    panel('<h3>営業状況</h3><p>手動登録の営業案件：'+sales.length+'件 ／ 契約ステータス：'+sales.filter(r=>r.stage==="契約").length+'件。契約・入金の実在を自動確認するものではありません。</p>');
}
const verificationWeights = [
  {type:"公開市場データ",label:"市場需要・課題の強さ",points:25},
  {type:"競合実績・価格",label:"差別化・継続利用価値",points:20},
  {type:"収益試算",label:"税引後の収益性",points:25},
  {type:"低コスト・一人運営",label:"低コスト・1人運営",points:20},
  {type:"法務・技術リスク",label:"法務・技術リスク",points:10}
];
function evidenceFreshness(row) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(row.date)) return "日付不明";
  const days=Math.floor((Date.parse(today()+"T00:00:00+09:00")-Date.parse(row.date+"T00:00:00+09:00"))/86400000);
  return days>180?"再調査推奨（180日超）":days>=0?"記録から"+days+"日":"日付要確認";
}
// v40: explicit, local-only JSON report import. No network calls or autonomous AI.
function normalizeResearchReport(raw) {
  if (!raw || raw.format!=="orxelia-research-v1" || !Array.isArray(raw.findings) || raw.findings.length<1 || raw.findings.length>100) throw Error("ORXELIA調査レポート形式ではありません（orxelia-research-v1）。");
  if(typeof raw.project!=="string" || raw.project.length>160) throw Error("対象事業名が不正です。");
  const project=data.projects.find(p=>p.id===raw.project || p.name===raw.project);
  if(!project) throw Error("事業一覧に対象事業が見つかりません。事業名を正確に指定してください。");
  const date=raw.researchedAt;
  if(typeof date!=="string" || !/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(Date.parse(date+"T00:00:00Z"))) throw Error("調査日（YYYY-MM-DD）が不正です。");
  const findings=raw.findings.map((f,i)=>{
    if(!f || !evidenceTypes.includes(f.type) || !["未検証","仮説","資料確認済み","販売実績確認済み"].includes(f.status) || typeof f.summary!=="string" || !f.summary.trim() || f.summary.length>1000 || typeof f.source!=="string" || f.source.length>500) throw Error("調査項目 "+(i+1)+" の形式が不正です。");
    if(f.status==="販売実績確認済み") throw Error("販売実績は自動インポートできません。手動で確認してください。");
    // AI-authored reports are unverified until a person checks the primary source.
    return {id:crypto.randomUUID(),project:project.id,type:f.type,status:f.status==="資料確認済み"?"仮説":f.status,summary:f.summary.trim(),source:f.source.trim(),date};
  });
  return {project,findings,date,downgraded:raw.findings.filter(f=>f.status==="資料確認済み").length};
}

// v50: read-only public feed; no API credentials in the browser.
let dailyIdeas = [];
let researchReviews = [];
const maxAiFeedSize = 1000000; // 30 reports, including multibyte text and new ideas.
const aiFeedPath = "ai-reports/latest.json";
const aiFeedStateKey = "orxelia-ai-feed-state-v50";
let aiFeedStatus = "未確認（公開レポートを確認中）";
let aiFeedCheckedAt = "";
async function autoImportAiFeed() {
  if (!readable || loadEvidence()===null) {aiFeedStatus="保存データに問題があるため自動反映を停止";return;}
  try {
    const response=await fetch(new URL('/'+aiFeedPath,location.origin).href+"?t="+Date.now(),{cache:"no-store"});
    if(!response.ok) throw Error("公開レポートなし（HTTP "+response.status+"）");
    if(Number(response.headers.get("content-length")||0)>maxAiFeedSize) throw Error("レポートのサイズ超過");
    const body=await response.text();if(body.length>maxAiFeedSize)throw Error("レポートのサイズ超過");
    const feed=JSON.parse(body);
    if(!feed || feed.format!=="orxelia-auto-feed-v1" || !Array.isArray(feed.reports) || feed.reports.length>30) throw Error("公開レポート形式が不正");
    dailyIdeas = feed.reports.flatMap(report => {
      if (report?.project !== currentResearchProject) return [];
      const idea = report.idea;
      const day = report?.researchedAt;
      if (typeof day !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(day) || !idea ||
          ![idea.name,idea.customer,idea.offer,idea.next].every(value =>
            typeof value === "string" && value.trim() && value.length <= 300) ||
          idea.name.length > 140 || !normalizedName(idea.name)) return [];
      return [{...idea, day, source:"AI事業案 " + day + " " + normalizedName(idea.name)}];
    }).sort((a,b) => b.day.localeCompare(a.day));
    const rows=loadEvidence();if(rows===null)throw Error("既存記録を読み込めません");
    const signatures=new Set(rows.map(r=>[r.project,r.type,r.summary,r.source,r.date].join("\u001f")));
    const incoming=[];let skipped=0;
    researchReviews = [];
    for(const item of feed.reports){
      if (item?.project !== currentResearchProject) {skipped++;continue;}
      try {
        const report=normalizeResearchReport(item);
        researchReviews.push({name:report.project.name, project:report.project.id, day:report.date,
          source:"AI既存事業調査 " + report.date + " " + report.project.id,
          offer:report.findings.map(row => row.type + "： " + row.summary).join("\n")});
        for(const row of report.findings){
          const key=[row.project,row.type,row.summary,row.source,row.date].join("\u001f");
          if(signatures.has(key)){skipped++;continue;}
          signatures.add(key);incoming.push(row);
        }
      }catch{skipped++;}
    }
    if(rows.length+incoming.length>3000)throw Error("保存上限のため自動反映停止");
    if(incoming.length)saveEvidence([...rows,...incoming]);
    aiFeedCheckedAt=new Date().toLocaleString("ja-JP");
    aiFeedStatus="公開レポートを確認：新規"+incoming.length+"件、既存・対象外"+skipped+"件。AI生成の記録は仮説として保存";
    try{localStorage.setItem(aiFeedStateKey,JSON.stringify({status:aiFeedStatus,checkedAt:aiFeedCheckedAt}));}catch{}
    if((tab==="verification" || tab==="home") && !$("view").contains(document.activeElement))render();
  } catch(error){
    aiFeedStatus="自動反映待機："+String(error.message||"通信エラー");
    if((tab==="verification" || tab==="home") && !$("view").contains(document.activeElement))render();
  }
}
function aiFeedPanel(){
  return panel('<h3>AI調査の自動反映（v50）</h3><p>'+esc(aiFeedStatus)+'</p><p>公開リポジトリの ai-reports/latest.json を読み込み、現在の調査対象「見積もり催促・追客管理」の仮説だけを端末へ自動追加します。出典は人が確認するまで「仮説」です。個人情報・機密情報を公開レポートに含めないでください。</p>'+action("公開レポートを再確認","aiFeedRefresh")+'<p>GitHub ActionsのAI生成設定がない場合、レポートは自動生成されません。データの自動反映とAIによる調査の自動実行は別の機能です。</p>');
}
// v45: zero-fee, no-OAuth interoperability. No third-party account connection is claimed.
function downloadText(name,content,mime) {
  const url=URL.createObjectURL(new Blob(["\ufeff",content],{type:mime+";charset=utf-8"}));
  const a=document.createElement("a");a.href=url;a.download=name;document.body.append(a);a.click();a.remove();
  setTimeout(()=>URL.revokeObjectURL(url),30000);
}
function csvCell(value) {
  let v=String(value??"").replace(/\r\n?/g,"\n");
  // Prevent spreadsheet formula injection even when fields are user supplied.
  if (/^\s*[=+\-@]/.test(v)) v="'"+v;
  return '"'+v.replace(/"/g,'""')+'"';
}
function exportCsv(name,headers,rows) {
  downloadText(name,[headers,...rows].map(row=>row.map(csvCell).join(",")).join("\r\n"),"text/csv");
}
function exportTasksCsv() {
  const rows=loadTasks();if(rows===null)throw Error("タスクを読み込めません。");
  exportCsv("ORXELIA-tasks-"+today()+".csv",["タスク","事業","期限","状態"],rows.map(r=>[r.title,data.projects.find(p=>p.id===r.project)?.name||"共通",r.due,r.state]));
}
function exportEvidenceCsv() {
  const rows=loadEvidence();if(rows===null)throw Error("検証記録を読み込めません。");
  exportCsv("ORXELIA-evidence-"+today()+".csv",["事業","調査日","種類","状態","内容","出典"],rows.map(r=>[data.projects.find(p=>p.id===r.project)?.name||"",r.date,r.type,r.status,r.summary,r.source]));
}
function exportPortfolioCsv() {
  exportCsv("ORXELIA-projects-"+today()+".csv",["事業名","種別","段階","優先度"],data.projects.map(r=>[r.name,r.type,r.stage,r.priority]));
}
function icsEscape(s) {return String(s??"").replace(/\\/g,"\\\\").replace(/\n/g,"\\n").replace(/,/g,"\\,").replace(/;/g,"\\;");}
function exportTasksCalendar() {
  const rows=loadTasks();if(rows===null)throw Error("タスクを読み込めません。");
  const events=rows.filter(t=>t.due&&/^\d{4}-\d{2}-\d{2}$/.test(t.due)&&t.state!=="完了");
  if(!events.length)throw Error("期限のある未完了タスクがありません。");
  const stamp=new Date().toISOString().replace(/[-:]/g,"").replace(/\.\d{3}/,"");
  const lines=["BEGIN:VCALENDAR","VERSION:2.0","PRODID:-//ORXELIA//Task Export//JA","CALSCALE:GREGORIAN"];
  for(const t of events){
    const d=t.due.replace(/-/g,"");
    const next=new Date(t.due+"T00:00:00Z");next.setUTCDate(next.getUTCDate()+1);
    const end=next.toISOString().slice(0,10).replace(/-/g,"");
    lines.push("BEGIN:VEVENT","UID:"+encodeURIComponent(t.id)+"@orxelia.local","DTSTAMP:"+stamp,"DTSTART;VALUE=DATE:"+d,"DTEND;VALUE=DATE:"+end,"SUMMARY:"+icsEscape("ORXELIA: "+t.title),"DESCRIPTION:"+icsEscape(data.projects.find(p=>p.id===t.project)?.name||"共通"),"END:VEVENT");
  }
  lines.push("END:VCALENDAR");
  downloadText("ORXELIA-tasks-"+today()+".ics",lines.join("\r\n"),"text/calendar");
}
function researchPrompt() {
  const names=data.projects.map(p=>p.name).join("、");
  const prompt=`ORXELIAの事業候補について、公開一次資料・公式料金表・公開統計を中心に最新の市場調査をしてください。調査対象の事業名は「${data.projects[0]?.name||"事業名を指定"}」。他の候補は ${names||"未登録"} です。市場需要、競合実績・価格、税引後の収益試算、低コスト・一人運営、法務・技術リスクを検証。未確認の数字は推定と明記し、原典URLと調査日を記載してください。顧客ヒアリング・アンケート・モニター募集は提案しないでください。社内で試作・動作確認し、公開後の購入件数・売上で評価する手順を提案してください。出力はJSONのみ。形式: {"format":"orxelia-research-v1","project":"対象事業名","researchedAt":"YYYY-MM-DD","findings":[{"type":"公開市場データ","status":"仮説","summary":"根拠・限界・結論","source":"出典URL"}]}。typeは「公開市場データ」「競合実績・価格」「収益試算」「低コスト・一人運営」「法務・技術リスク」から選択。外部公開・費用発生・連絡は行わないでください。`;
  if(navigator.clipboard?.writeText) navigator.clipboard.writeText(prompt).then(()=>$("notice").textContent="AI調査依頼文をコピーしました。ChatGPTへ貼り付けてください。").catch(()=>downloadText("ORXELIA-research-prompt.txt",prompt,"text/plain"));
  else downloadText("ORXELIA-research-prompt.txt",prompt,"text/plain");
}
function freeConnectionsPanel(){
  return panel('<h3>無料の外部連携・データ持ち出し（v45）</h3><p>外部アカウントへの直接同期ではありません。端末内の情報をCSV・カレンダー形式で出力し、必要に応じて各サービスに読み込ませる方式です。追加API契約・OAuth設定は不要です。</p>'+
    action("AI調査依頼文をコピー","researchPrompt")+
    action("事業一覧CSV","portfolioCsv")+
    action("検証記録CSV","evidenceCsv")+
    action("タスクCSV","tasksCsv")+
    action("期限付きタスクをカレンダー形式で出力","tasksIcs")+
    '<p>CSV：Excel・Googleスプレッドシート等で開けます。ICS：iPhoneカレンダー等への取り込み用です（自動同期ではありません）。公開情報の調査はChatGPTで実施し、生成されたJSONを下の画面で確認して取り込んでください。</p>');
}

function researchImportPanel() {
  return panel('<h3>AI市場調査レポートの取り込み（v40）</h3><p>ChatGPTで調査して作成した専用JSONを読み込みます。読み込み後は内容を確認してから登録します。外部通信・API課金・自動調査はありません。</p>'+action("調査用JSONテンプレート出力","researchTemplate")+'<label>調査レポートJSONファイル<input id="research-file" type="file" accept=".json,application/json"></label><div id="research-preview" aria-live="polite"><p>まだファイルが選択されていません。</p></div><p>AIの「資料確認済み」申告は安全のため「仮説」に変更します。原典を人が確認してから検証状態を更新してください。</p>');
}
let pendingResearch=null;
function showResearchPreview(report) {
  pendingResearch=report;
  const target=$("research-preview");
  if(!target) return;
  target.innerHTML='<h3>取り込み前の確認</h3><p>事業：'+esc(report.project.name)+' ／ 調査日：'+esc(report.date)+' ／ '+report.findings.length+'件</p><p>AIの確認済み申告 '+report.downgraded+'件を「仮説」に変更します。</p>'+report.findings.map(f=>'<article><strong>'+esc(f.type)+'</strong><p>'+esc(f.status)+'：'+esc(f.summary)+'</p><p>出典：'+esc(f.source||"未記載")+'</p></article>').join('')+action('内容を確認して登録','researchCommit')+action('取り込みを中止','researchCancel');
}
function verification() {
  const rows=loadEvidence();
  if(rows===null)return heading("事業検証")+panel('<p class="warn">検証記録が読み込めません。上書きを停止しました。</p>');
  const opts=data.projects.map(p=>'<option value="'+esc(p.id)+'">'+esc(p.name)+'</option>').join("");
  const projectName=id=>data.projects.find(p=>p.id===id)?.name||"未指定";
  const recent=[...rows].reverse();
  const scorecard=data.projects.filter(p=>p.stage!=="終了"&&p.stage!=="保留").map(p=>{
    const own=rows.filter(r=>r.project===p.id);
    const done=verificationWeights.filter(w=>own.some(r=>r.type===w.type&&r.status==="資料確認済み"&&r.source.trim()));
    return {name:p.name,confirmed:done.length,missing:verificationWeights.filter(w=>!done.includes(w)).map(w=>w.label),stale:own.filter(r=>evidenceFreshness(r).startsWith("再調査")).length};
  }).sort((a,b)=>b.confirmed-a.confirmed);
  return heading("公開情報による事業検証",action("検証データJSON出力","evidenceExport"))+
    panel('<h3>この端末の検証記録</h3><p>手動で登録した資料確認済み記録の件数です。販売判断に掲載した公開資料は、事業別の販売判断にまとまっています。</p>' +
      (scorecard.length ? scorecard.map(x=>'<p>' + esc(x.name) + ' ／ 資料の登録がある項目 ' +
        x.confirmed + ' / ' + verificationWeights.length + (x.stale ? ' ／ 再調査推奨 ' + x.stale + '件' : '') + '</p>').join("") :
        '<p>対象事業がありません。</p>'))+
    details("AIレポートの取り込み・データ出力",aiFeedPanel()+freeConnectionsPanel()+researchImportPanel())+
    panel('<h3>検証結果を登録</h3><form id="evidence-form"><label>対象事業<select name="project" required><option value="">選択してください</option>'+opts+'</select></label><label>検証の種類<select name="type">'+newEvidenceTypes.map(x=>'<option>'+x+'</option>').join("")+'</select></label><label>確認状況<select name="status">'+evidenceStatuses.filter(x=>x!=="顧客確認済み").map(x=>'<option>'+x+'</option>').join("")+'</select></label><label>確認内容・未解決事項<textarea name="summary" maxlength="1000" required></textarea></label><label>出典URL・資料名（資料確認済みの場合は確認した一次資料）<input name="source" maxlength="500"></label><button class="primary">検証記録を保存</button></form>')+
    panel('<h3>検証履歴（出典と鮮度）</h3>'+(recent.length?recent.slice(0,100).map(r=>'<article><h3>'+esc(projectName(r.project))+'</h3><p>'+esc(r.type)+' ／ '+esc(r.status)+' ／ '+esc(r.date)+' ／ '+esc(evidenceFreshness(r))+'</p><p>'+esc(r.summary)+'</p><p>根拠：'+esc(r.source||"未記録")+'</p>'+action("削除","evidenceDelete",r.id)+'</article>').join(""):'<p>この端末に登録された検証履歴はありません。</p>'));
}

const details = (title, content) => '<details class="panel"><summary>' + title + '</summary>' + content + '</details>';
function openSection(title) {
  const section = [...$("view").querySelectorAll("details")].find(d => d.firstElementChild.textContent === title);
  if (section) section.open = true;
}

function ideaReviewPanel(limit = dailyIdeas.length) {
  return panel('<h3>新規事業の提案</h3><p>AI生成仮説・Web調査なし</p>' +
    (dailyIdeas.length ? dailyIdeas.slice(0,limit).map((idea,index) => {
      const status = data.decisions.find(d => d.source === idea.source)?.status;
      return '<article><h4>' + esc(idea.name) + '</h4>' + badge(idea.day) +
        badge(status === "決定済み" ? "採用" : status || "判断待ち") +
        '<p>顧客と課題　' + esc(idea.customer) + '</p><p>商品と販売仮説　' + esc(idea.offer) +
        '</p><p>最初の販売検証　' + esc(idea.next) + '</p>' +
        (!status || status === "保留" ? '<div class="actions">' +
          action("採用","ideaAdopt",index) + action("保留","ideaHold",index) +
          action("却下","ideaReject",index) + '</div>' : '') + '</article>';
    }).join("") : '<p>新規提案はまだありません。</p>'));
}

function reviewIdea(idea, status) {
  if (!idea) throw Error("事業案が見つかりません。");
  const prior = data.decisions.find(d => d.source === idea.source);
  if (prior && prior.status !== "保留") throw Error("判断済みの事業案です。");
  if (prior?.status === status) return;
  const projects = [...data.projects];
  if (status === "決定済み" && !idea.project) {
    if (projects.some(p => normalizedName(p.name) === normalizedName(idea.name))) {
      throw Error("同名の事業が登録済みです。事業一覧で確認してください。");
    }
    projects.push({id:crypto.randomUUID(), name:idea.name, type:types[2], stage:"検証中",
      priority:"未設定", date:"", rank:0, price:null, customer:idea.customer, next:idea.next,
      note:"AI生成仮説・Web調査なし\n" + idea.offer, source:idea.source,
      history:[{date:today(), note:"利用者がAI事業案を採用"}]});
  }
  const decision = {date:today(), title:idea.name, status, source:idea.source,
    note:[prior?.note, today() + " " + (status === "決定済み" ? "採用" : status),
      "AI生成仮説・Web調査なし", idea.customer, idea.offer, idea.next].filter(Boolean).join("\n")};
  save({...data, projects, decisions:prior ?
    data.decisions.map(d => d === prior ? decision : d) : [...data.decisions,decision]});
  if (status === "決定済み" && !idea.project) { tab = "portfolio"; filter = "すべて"; }
  render();
  $("notice").textContent = status === "決定済み" && !idea.project ? "採用し、検証中の事業として登録しました。" : "判断を保存しました。";
}

function existingResearchPanel() {
  const latest = [...researchReviews].sort((a,b) => b.day.localeCompare(a.day));
  return details("既存事業のAI分析と判断", panel('<p>AI生成仮説・Web調査なし</p>' +
    (latest.length ? latest.map(report => {
      const status = data.decisions.find(d => d.source === report.source)?.status;
      const index = researchReviews.indexOf(report);
      return '<article><h3>' + esc(report.name) + '</h3>' + badge(report.day) +
        badge(status === "決定済み" ? "採用" : status || "判断待ち") +
        '<ul>' + report.offer.split("\n").map(line => '<li>' + esc(line) + '</li>').join("") + '</ul>' +
        '<div class="actions">' +
        (!status || status === "保留" ?
          action("採用","researchAdopt",index) + action("保留","researchHold",index) + action("却下","researchReject",index) : "") +
        (status === "決定済み" ? action("事業の次の行動を編集","project",report.project) : "") +
        '</div></article>';
    }).join("") : '<p>事業一覧に一致する公開レポートはありません。</p>')));
}

function businessRevenueOverview() {
  const period=today().slice(0,7);
  const ledger=data.ledger.filter(r=>r.month===period);
  const byProject=new Map(data.projects.map(p=>[p.id,p]));
  const salesRows=loadSales();
  const contractCount=salesRows===null?null:salesRows.filter(r=>r.stage==="契約").length;
  const revenue=ledger.reduce((sum,r)=>sum+r.revenue,0);
  const cost=ledger.reduce((sum,r)=>sum+r.cost,0);
  const rows=ledger.map(r=>{
    const project=byProject.get(r.project);
    return '<article class="business-progress"><h3>'+esc(project?.name||"登録事業")+'</h3><div class="metrics">'+
      metric("契約数","未連携","事業別契約台帳は未接続")+
      metric("売上",yen(r.revenue),"当月入力実績")+
      metric("差引収支",yen(r.revenue-r.cost),"売上−費用・税引前")+
      '</div></article>';
  }).join("");
  return panel('<h3>事業別の契約・売上・利益</h3><p>対象：'+esc(period)+' ／ 実績登録ベース。未登録を0円とは扱いません。</p>'+
    '<div class="metrics">'+
    metric("契約件数",contractCount===null?"確認不可":contractCount+"件","営業記録の契約段階・事業別未連携")+
    metric("売上合計",ledger.length?yen(revenue):"未登録","当月実績")+
    metric("差引収支",ledger.length?yen(revenue-cost):"未登録","税引前・営業利益ではありません")+
    '</div>'+
    (rows||'<p>事業別の売上・費用はまだ登録されていません。販売開始後、実績を登録するとここに表示されます。</p>')+
    '<p>※契約数は現在の営業記録に基づく件数で、事業別の正確な契約数や有効契約数ではありません。今後の契約・決済連携が必要です。</p>'+
    '<button type="button" data-tab="finance">売上・費用を登録する</button>');
}
function executiveQuickMatrix() {
  const period=today().slice(0,7);
  const ledger=data.ledger.filter(r=>r.month===period);
  const byId=new Map(data.projects.map(p=>[p.id,p]));
  const byName=new Map();
  for(const entry of ledger){
    const name=byId.get(entry.project)?.name;
    if(!name)continue;
    const current=byName.get(name)||{revenue:0,cost:0,records:0};
    current.revenue+=Number(entry.revenue)||0;
    current.cost+=Number(entry.cost)||0;
    current.records++;
    byName.set(name,current);
  }
  const cloudNames=new Set(orxeliaTrialProposals.map(p=>p.title));
  const projects=[...orxeliaTrialProposals.map(p=>({name:p.title,status:p.status,cloud:true})),
    ...activeProjects().filter(p=>!cloudNames.has(p.name)).map(p=>({name:p.name,status:p.stage,cloud:false}))];
  const awaiting=new Set(['awaiting_first_approval','development_ready','awaiting_final_approval']);
  const statusLabel={awaiting_first_approval:'デザイン承認待ち',development_ready:'試作品確認待ち',awaiting_final_approval:'販売判断待ち',awaiting_selection:'生成待ち',designing:'デザイン生成中',revision_requested:'修正待ち',revising:'修正中',approved_for_development:'開発待ち',developing:'開発中',prototype_revision_requested:'試作品修正待ち',prototype_revising:'試作品修正中',sales_review_requested:'販売審査中',final_approved:'販売方針承認済み',on_hold:'保留'};
  const rows=projects.map(p=>{
    const actual=byName.get(p.name);
    const state=statusLabel[p.status]||p.status||'未設定';
    const label=awaiting.has(p.status)?'<strong class="quick-attention">'+esc(state)+'</strong>':esc(state);
    return '<tr'+(awaiting.has(p.status)?' class="needs-action"':'')+'><th scope="row">'+esc(p.name)+'</th><td data-label="進捗">'+label+'</td><td data-label="売上">'+ (actual?yen(actual.revenue):'—')+'</td><td data-label="売上−費用">'+(actual?yen(actual.revenue-actual.cost):'—')+'</td><td data-label="契約数">—</td></tr>';
  }).join('');
  return '<section class="quick-overview" aria-label="事業別30秒サマリー"><div class="head"><h2>事業別の状況</h2><small>'+esc(period)+' 実績入力分</small></div>'+
    (rows?'<div class="quick-table-scroll" tabindex="0" role="region" aria-label="事業別ステータスと入力実績"><table class="quick-table"><thead><tr><th scope="col">事業</th><th scope="col">進捗・確認</th><th scope="col">売上</th><th scope="col">売上−費用</th><th scope="col">契約数</th></tr></thead><tbody>'+rows+'</tbody></table></div>':'<p>登録事業はまだありません。</p>')+
    '<p class="quick-note">※当月の手動入力分。売上−費用は営業利益・純利益ではありません。契約数は未連携です。</p><details><summary>数値の見方</summary><p>売上と売上−費用は当月の手動入力データです。売上−費用は営業利益・純利益ではありません。契約数は事業別の確定データと紐付いていないため「未連携」と表示しています。「—」は0円を意味しません。</p></details></section>';
}
function home() {
  const syncState = proposalSync.state;
  const syncLabel = {
    pending: "案件を取得するにはログインして同期してください。",
    loading: "案件を読み込んでいます。",
    failed: proposalSync.lastSuccess
      ? "同期に失敗しました。最後に取得した案件を表示しています。"
      : "案件を取得できませんでした。設定から同期を再試行してください。",
    ready: ""
  }[syncState];
  const syncNote = syncLabel ? '<p role="status">'+esc(syncLabel)+'</p>' : "";
  const syncTime = proposalSync.lastSuccess
    ? '<p class="muted">案件の最終取得 '+esc(proposalSync.lastSuccess.toLocaleString("ja-JP",{timeZone:"Asia/Tokyo"}))+'</p>'
    : "";
  const requiresAction=p=>!isPartnerLinkImplemented(p)&&(p.status==="awaiting_first_approval"||p.status==="development_ready"||(p.status==="awaiting_final_approval"&&p.sales_review?.recommendation==="ready_for_approval"));
  const owner=orxeliaTrialProposals.filter(requiresAction);
  const research=orxeliaTrialProposals.filter(p=>p.status==="awaiting_final_approval"&&!requiresAction(p));
  const running=orxeliaTrialProposals.filter(p=>["awaiting_selection","designing","revision_requested","revising","approved_for_development","developing","prototype_revision_requested","prototype_revising","sales_review_requested"].includes(p.status));
  const cleanTitle=p=>esc(p.title.replace(/（自動開発動作検証）/g,"").replace(/^【第2件・本番検証】/,""));
  const ownerRows=owner.map(p=>{
    const design=p.status==="awaiting_first_approval",prototype=p.status==="development_ready";
    const task=design?"非公開試作と法務審査を確認し、開発許可を判断する":prototype?"試作品を操作して、修正か販売審査依頼を選ぶ":"販売審査の根拠を確認し、販売可否を判断する";
    const label=design?"デザインを確認":prototype?"試作品を確認":"販売判断を確認";
    return '<article class="business-progress priority-card owner-action-card"><div class="priority-top"><span class="priority-label">あなたの操作が必要</span><span class="priority-state">'+esc(label)+'</span></div><h3>'+cleanTitle(p)+'</h3><p><b>やること：</b>'+esc(task)+'</p><button class="primary" type="button" data-tab="verification">承認・販売画面で操作する →</button></article>';
  }).join("");
  const researchRows=research.map(p=>'<article class="business-progress priority-card ai-review-card"><div class="priority-top"><span class="priority-state">販売保留・根拠不足</span></div><h3>'+cleanTitle(p)+'</h3><p><b>あなたの操作：</b>今は不要。需要・競合優位性・採算の証拠がそろうまで販売判断しません。</p></article>').join("");
  return implementedProductsPanel()+'<div class="home-intro"><span class="eyebrow">EXECUTIVE OVERVIEW</span><h2>今、あなたがやること</h2><p>操作が必要な案件だけをオレンジ色で表示します。調査不足の案件は別にまとめています。</p></div>'+
    syncNote+syncTime+'<section class="priority-section"><div class="head"><h2>あなたの操作待ち</h2><span class="count-pill">'+(proposalSync.lastSuccess?owner.length+'件':'未取得')+'</span></div>'+(ownerRows?'<div class="priority-list">'+ownerRows+'</div>':syncState==="ready"?'<div class="empty-state"><strong>今すぐ必要な操作はありません</strong><p>販売根拠が不足している案件は、承認せず保留します。</p></div>':"")+'</section>'+
    (researchRows?'<section class="priority-section"><div class="head"><h2>AI側の調査課題・販売保留</h2><span class="count-pill">'+research.length+'件</span></div><p>この欄はあなたへの承認依頼ではありません。調査が自動で完了することを保証する表示でもありません。</p><div class="priority-list">'+researchRows+'</div></section>':'')+
    '<details class="home-stats"><summary>全体の数字・事業別状況を見る</summary><div class="metrics">'+metric("あなたの操作待ち",proposalSync.lastSuccess?owner.length+"件":"未取得","承認・試作品の判断")+metric("AI作業中・待機",proposalSync.lastSuccess?running.length+"件":"未取得","自動処理の進捗")+metric("販売根拠不足",proposalSync.lastSuccess?research.length+"件":"未取得","承認せず保留")+'</div>'+executiveQuickMatrix()+'</details>'+
    '<div class="home-links"><button type="button" data-tab="portfolio">事業一覧を見る</button><button type="button" data-tab="verification">承認・販売画面へ</button></div>';
}

function expandedDetailPaths(root){
 const all=[...root.querySelectorAll("details")];
 return all.filter(d=>d.open).map(d=>{
  const path=[];let node=d;
  while(node&&node!==root){
   const parent=node.parentElement;
   if(!parent)break;
   path.unshift([...parent.children].indexOf(node));
   node=parent;
  }
  return path;
 });
}
function restoreDetailPaths(root,paths){
 for(const path of paths){let node=root;
  for(const index of path){node=node?.children?.[index];if(!node)break;}
  if(node?.tagName==="DETAILS")node.open=true;
 }
}

// Local-only dashboard update notifications. No external push or personal data transmission.
const orxeliaNoticeKey="orxelia-notification-snapshot-v1";
function checkDashboardUpdates(){
  const items=orxeliaTrialProposals.map(p=>({id:p.id,title:p.title,status:p.status,version:p.prototype_revision_number||1,updated:p.updated_at||""}));
  if(!items.length)return;
  const current=Object.fromEntries(items.map(p=>[p.id,p]));
  let previous=null;
  try{previous=JSON.parse(localStorage.getItem(orxeliaNoticeKey)||"null")}catch{}
  if(previous&&typeof previous==="object"){
    const changes=items.filter(p=>!previous[p.id]||JSON.stringify(previous[p.id])!==JSON.stringify(p));
    if(changes.length){
      const banner=document.getElementById("dashboard-update-notice");
      if(banner){
        banner.hidden=false;
        banner.textContent="🔔 更新 "+changes.length+"件： "+changes.slice(0,2).map(p=>p.title+"（第"+p.version+"版）").join("、")+(changes.length>2?" ほか":"");
      }
    }
  }
  try{localStorage.setItem(orxeliaNoticeKey,JSON.stringify(current))}catch{}
}


const orxeliaPush = (() => {
 const endpoint="https://yzlxcfncdtojajlhihap.supabase.co";
 const sessionKey="orxelia-sync-session";
 function auth(){try{const s=JSON.parse(localStorage.getItem(sessionKey)||"null");return s?.access_token&&s?.user?.id?s:null}catch{return null}}
 function decode(base64){const binary=atob(base64.replace(/-/g,"+").replace(/_/g,"/")+"=".repeat((4-base64.length%4)%4));return Uint8Array.from(binary,c=>c.charCodeAt(0))}
 async function enable(){
  if(!("serviceWorker" in navigator)||!("PushManager" in window))throw Error("このブラウザはWebプッシュ通知に対応していません。iPhoneではSafariからホーム画面に追加してください。");
  if(!window.matchMedia("(display-mode: standalone)").matches)throw Error("Safariの共有メニューからホーム画面に追加し、ホーム画面のORXELIAを開いてください。");
  const s=auth();if(!s)throw Error("設定画面でクラウドにログインしてください。");
  const permission=await Notification.requestPermission();if(permission!=="granted")throw Error("通知が許可されていません。iPhoneの通知設定を確認してください。");
  const registration=await navigator.serviceWorker.register("./push-sw.js");
  const response=await fetch(endpoint+"/functions/v1/orxelia-push?action=public-key",{headers:{apikey:window.ORXELIA_PUBLISHABLE_KEY,Authorization:"Bearer "+s.access_token}});
  if(!response.ok)throw Error("通知サーバーの準備が完了していません（HTTP "+response.status+"）。");
  const {publicKey}=await response.json();if(!publicKey)throw Error("通知配信鍵が未設定です。");
  const sub=await registration.pushManager.subscribe({userVisibleOnly:true,applicationServerKey:decode(publicKey)});
  const payload={owner_id:s.user.id,endpoint:sub.endpoint,p256dh:btoa(String.fromCharCode(...new Uint8Array(sub.getKey("p256dh")))).replace(/\+/g,"-").replace(/\//g,"_").replace(/=+$/,""),auth_secret:btoa(String.fromCharCode(...new Uint8Array(sub.getKey("auth")))).replace(/\+/g,"-").replace(/\//g,"_").replace(/=+$/,"")};
  const saved=await fetch(endpoint+"/rest/v1/orxelia_push_subscriptions",{method:"POST",headers:{apikey:window.ORXELIA_PUBLISHABLE_KEY,Authorization:"Bearer "+s.access_token,"Content-Type":"application/json",Prefer:"return=minimal"},body:JSON.stringify(payload)});
  if(!saved.ok && saved.status!==409)throw Error("端末登録に失敗しました（HTTP "+saved.status+"）。");
  return "iPhoneの通知登録が完了しました。";
 }
 document.addEventListener("click",async e=>{const button=e.target.closest("#orxelia-enable-push");if(!button)return;button.disabled=true;try{alert(await enable())}catch(err){alert(err.message)}finally{button.disabled=false}});
 async function testLocal(){if(!("serviceWorker" in navigator))throw Error("Service Worker非対応");const registration=await navigator.serviceWorker.register("./push-sw.js?v=3");await navigator.serviceWorker.ready;if(Notification.permission!=="granted")throw Error("通知が許可されていません");await registration.showNotification("ORXELIA 通知表示テスト",{body:"iPhone内で直接生成した通知です",tag:"orxelia-direct-"+Date.now()});const notifications=await registration.getNotifications();return "通知表示API成功。登録済み通知数: "+notifications.length+"件。ホーム画面に戻り通知センターを確認してください。";}
 document.addEventListener("click",async e=>{const button=e.target.closest("#orxelia-test-local-push");if(!button)return;button.disabled=true;try{alert(await testLocal())}catch(err){alert(err.message)}finally{button.disabled=false}});
 return {enable,testLocal};
})();

function render() {
  checkDashboardUpdates();
  // iOS Japanese IME: never replace a focused textarea while the user composes text.
  const activeRevision=document.activeElement;
  // Keep the iframe mounted during use: replacing srcdoc resets the entire app and its forms.
  if(document.querySelector("details[data-prototype-preview][open]")) return;
  if(activeRevision?.matches?.('textarea[data-revision-input]')){
    saveOrxeliaDraft(activeRevision.dataset.revisionInput,activeRevision.value);
    return;
  }
  const projects = activeProjects();
  const activities = latestProjectActivities();
  const active = projects.filter(project => !["保留","終了"].includes(project.stage));
  const latest = active.map(project => ({project,activity:activities.get(normalizedName(project.name))}))
    .filter(({activity}) => activity).sort((a,b) => Date.parse(b.activity.updatedAt)-Date.parse(a.activity.updatedAt))[0];
  $("work-now").innerHTML = latest ?
    '<span class="eyebrow">最新の作業報告</span><strong>' + esc(latest.project.name) + '</strong>' +
    badge(latest.project.name === currentResearchProject && latest.activity.state === "判断待ち" ? "販売保留・根拠確認中" : latest.activity.state) + (latest.activity.current ? '<span class="work-note">' + esc(latest.activity.current) + '</span>' : "") :
    '<span class="eyebrow">最新の作業報告</span><span>同期された報告はまだありません。</span>';
  $("metrics").innerHTML = [
    metric("事業総数", projects.length, "登録済み"),
    metric("検証中", active.filter(p => displayedBusinessStage(p, activities) === "検証中").length, "試作テスト・販売前の根拠確認"),
    metric("開発中", active.filter(p => displayedBusinessStage(p, activities) === "開発中").length, "最新の試作報告を反映"),
    metric("収益化済み", projects.filter(p => p.stage === "収益化済み").length, "登録ステータスの集計")
  ].join("");
  document.body.classList.toggle("is-home",tab==="home");
  document.querySelectorAll("[data-tab]").forEach(button => {
    if (button.dataset.tab === tab) button.setAttribute("aria-current","page");
    else button.removeAttribute("aria-current");
  });
  const expandedPaths = expandedDetailPaths($("view"));
  $("view").innerHTML = {
    home, portfolio:() => portfolio(activities) + details("日次候補",daily()),
    verification:() => heading("事業案・販売判断") + orxeliaTrialProposalPanel() + launchDecisions() + details("過去の経営判断",decisions()) + ideaReviewPanel() + existingResearchPanel() + details("検証記録・取り込み",verification()) + details("作業記録・タスク", (window.orxeliaSync?.dailyReportView()||"")+pendingDecisionSummary()+details("実行タスク",tasks())+details("作業進捗",progress())),
    finance:() => finance() + details("営業・販売の記録",sales()) + details("当月の事業別収支",businessRevenueOverview()),
    settings
  }[tab]();
  restoreDetailPaths($("view"),expandedPaths);
  showValidationStatus();
  refreshValidationStatus();
  if ($("offline")) $("offline").textContent = offlineStatus;
}

function input(name,label,type,value,attrs = "") {
  return '<label>' + label + '<input name="' + name + '" type="' + type + '" value="' + esc(value) + '" ' + attrs + '></label>';
}
function select(name,label,values,value) {
  return '<label>' + label + '<select name="' + name + '">' + values.map(v =>
    '<option' + (String(v) === String(value) ? ' selected' : '') + '>' + esc(v) + '</option>').join("") + '</select></label>';
}
function area(name,label,value) {
  return '<label>' + label + '<textarea name="' + name + '" maxlength="4000">' + esc(value) + '</textarea></label>';
}
function editor(title,fields,onSubmit) {
  $("form-title").textContent = title;
  $("fields").innerHTML = fields;
  $("error").textContent = "";
  submit = onSubmit;
  $("editor").showModal();
}
function businessRemovalButton(project,cloud){
 return '<button type="button" class="business-remove" data-business-remove="'+esc(project?.id||'')+'" data-business-cloud="'+esc(cloud?.id||'')+'">この事業を削除</button>';
}
function removedBusinessesPanel(){
 const locals=data.projects.filter(p=>p.deletedAt||orxeliaArchivedProposals.some(c=>c.brief?.legacy_id===p.id||c.title===p.name));
 const rows=locals.map(p=>({local:p,cloud:orxeliaArchivedProposals.find(c=>c.brief?.legacy_id===p.id||c.title===p.name)}));
 rows.push(...orxeliaArchivedProposals.filter(c=>!locals.some(p=>c.brief?.legacy_id===p.id||c.title===p.name)).map(c=>({cloud:c})));
 if(!rows.length)return '';
 return '<details class="removed-businesses"><summary>削除した事業（'+rows.length+'件）</summary><p>一覧から削除した事業です。収支・判断・検証履歴は残っています。復元後のAI処理は保留のままです。</p>'+rows.map(({local,cloud})=>'<article><h3>'+esc(local?.name||cloud.title)+'</h3><button type="button" data-business-restore="'+esc(local?.id||'')+'" data-business-cloud="'+esc(cloud?.id||'')+'">事業一覧に戻す</button></article>').join('')+'</details>';
}
async function changeBusinessRemoval(localId,cloudId,removed){
 const local=data.projects.find(p=>p.id===localId);
 const cloud=[...orxeliaTrialProposals,...orxeliaArchivedProposals].find(p=>p.id===cloudId||local&&(p.brief?.legacy_id===local.id||p.title===local.name));
 if(!local&&!cloud)throw Error('対象の事業が見つかりません。');
 const name=local?.name||cloud.title;
 const message=removed?'「'+name+'」を事業一覧から削除しますか？\n\n収支・判断・タスク・検証履歴は残します。削除した事業から元に戻せます。AI処理は保留にします。公開中のアプリは停止・削除しません。':'「'+name+'」を事業一覧に戻しますか？ AI処理は自動再開しません。';
 if(!confirm(message))return;
 keepSafetyCopy('事業の削除・復元前');
 if(cloud)await sync.archiveProposal(cloud.id,removed);
 if(local){const now=new Date().toISOString();save({...data,projects:data.projects.map(p=>p.id===local.id?(removed?{...p,deletedAt:now,stageBeforeRemoval:p.stage,stage:'終了',rank:0}:{...p,deletedAt:undefined,stageBeforeRemoval:undefined,stage:'保留',rank:0}):p)});}
 render();$('notice').textContent='「'+name+'」を'+(removed?'一覧から削除しました。収支・履歴は保持しています。':'事業一覧に戻しました。AI処理は保留中です。');
}
function deleteSingleProject(id){changeBusinessRemoval(id,'',true).catch(e=>{$('notice').textContent='削除できませんでした：'+e.message;});}
document.addEventListener('click',async event=>{
 const button=event.target.closest('[data-business-remove],[data-business-restore]');if(!button)return;
 const removed=button.hasAttribute('data-business-remove');button.disabled=true;
 try{await changeBusinessRemoval(removed?button.dataset.businessRemove:button.dataset.businessRestore,button.dataset.businessCloud,removed)}catch(e){$('notice').textContent='変更できませんでした：'+e.message}finally{button.disabled=false}
});

function editProject(id, isDaily) {
  const old = data.projects.find(p => p.id === id);
  const p = old || {name:"",type:isDaily ? types[0] : types[2],stage:isDaily ? "未検証" : "未確認",priority:"未設定",date:"",rank:0,price:null,history:[]};
  editor(old ? "事業を編集" : "事業を登録",
    input("name","事業名","text",p.name,'required maxlength="140"') +
    select("type","区分",types,p.type) + select("stage","ステータス",stages,p.stage) +
    select("priority","優先度",priorities,p.priority) +
    '<div id="daily-fields">' + input("date","日次レポートの日付","date",p.date || date) +
    select("rank","重点順位（0 = 対象外）",[0,1,2,3],p.rank) + '</div>' +
    input("customer","想定顧客","text",p.customer,'maxlength="200"') +
    input("price","想定月額（円・価格仮説）","number",p.price,'min="0" max="1000000000000" step="1"') +
    input("reviewBy","次の判断期限","date",p.reviewBy || "") +
    area("passCriteria","判断基準（観測する結果と合格条件）",p.passCriteria) +
    area("note","事業メモ・検証結果",p.note) + area("next","次の行動",p.next) +
    area("history","進捗履歴に追記（日本時間の本日付）",""), values => {
      const isIdea = values.type === types[0];
      const updated = {...p, ...values, id:old?.id || (globalThis.crypto.randomUUID?.() || Date.now() + "-" + Math.random()),
        date:isIdea ? values.date : "", rank:isIdea ? Number(values.rank) : 0,
        price:values.price === "" ? null : Number(values.price),
        source:old?.source || "利用者による手動登録", history:[...p.history]};
      if (!old && data.projects.some(item => normalizedName(item.name) === normalizedName(updated.name))) throw Error("同名または表記が近い事業が登録済みです。既存事業を編集してください。");
      const change = old ? [
        ...(old.stage !== updated.stage ? [old.stage + " → " + updated.stage] : []),
        ...(old.priority !== updated.priority ? ["優先度 " + old.priority + " → " + updated.priority] : []),
        ...(old.type !== updated.type ? [old.type + " → " + updated.type] : [])
      ] : ["事業を手動登録"];
      if (values.history) change.push(values.history);
      if (change.length) updated.history.push({date:today(),note:change.join(" ／ ")});
      save({...data,projects:old ? data.projects.map(item => item.id === id ? updated : item) : [...data.projects,updated]});
      if (isIdea) date = updated.date;
      if (tab === "portfolio" && filter !== "すべて" && filter !== updated.type) filter = updated.type;
    });
  const type = $("form").elements.type;
  const toggle = () => { $("daily-fields").hidden = type.value !== types[0]; };
  type.addEventListener("change",toggle);
  toggle();
}
function editLedger(id) {
  const p = data.projects.find(p => p.id === id);
  const old = data.ledger.find(r => r.project === id && r.month === month);
  const limits = 'required min="0" max="1000000000000" step="1"';
  editor(month + " ｜ " + p.name,
    input("revenue","確定した売上（円）","number",old?.revenue,limits) +
    input("cost","確定した費用（円）","number",old?.cost,limits) +
    input("evidence","確認元（帳簿・領収書など）","text",old?.evidence,'required maxlength="300"'), values => {
      const row = {project:id,month,revenue:Number(values.revenue),cost:Number(values.cost),evidence:values.evidence};
      save({...data,ledger:[...data.ledger.filter(r => r !== old),row]});
    });
}
function editDecision(index) {
  const old = index === "" ? null : data.decisions[Number(index)];
  editor("経営判断を記録",
    input("title","判断項目","text",old?.title,'required maxlength="150"') +
    input("date","日付","date",old?.date || today(),'required') +
    select("status","区分",["提案","決定済み","保留","却下"],old?.status || "提案") +
    area("note","判断・根拠・次の行動",old?.note), values => {
      const row = {...values,source:old?.source || "利用者による手動記録"};
      save({...data,decisions:old ? data.decisions.map(d => d === old ? row : d) : [...data.decisions,row]});
    });
}
function exportData() {
  if (!readable) throw Error("保存データを読み込めないため、書き出しを停止しました。");
  const url = URL.createObjectURL(new Blob([JSON.stringify(data,null,2)], {type:"application/json"}));
  const link = document.createElement("a");
  link.href = url;
  link.download = "ORXELIA-" + today() + ".json";
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url),30000);
}
document.addEventListener("click", event => {
  const button = event.target.closest("button");
  if (!button) return;
  const {tab:nextTab,action:kind,value} = button.dataset;
  if (nextTab) {
    const changed=tab!==nextTab;
    tab = nextTab;
    $("notice").textContent = "";
    render();
    if(changed)window.scrollTo({top:0,behavior:"instant"});
  }
  try {
    if (kind === "salesExport") salesExport();
    if (kind === "salesDelete") {
      const rows=loadSales(); if (rows === null) throw Error("営業データを読み込めません。");
      if (confirm("この営業記録を削除しますか？")) { saveSales(rows.filter(r=>r.id!==value)); render(); }
    }
    if (kind === "recoveryView") {
      // Read-only recovery viewer: malformed records must not hide other intact data.
      const keys={portfolio:key,recovery:recoveryKey,safetyHistory:backupKey,sales:salesKey,tasks:tasksKey,evidence:evidenceKey};
      const payload={format:"orxelia-device-recovery-view-v2",exportedAt:new Date().toISOString()};
      for(const [name,storageKey] of Object.entries(keys)){
        try {
          const raw=localStorage.getItem(storageKey);
          payload[name]=raw===null?null:JSON.parse(raw);
        } catch(error) {
          payload[name]={readError:String(error?.message||error),note:"Stored value was not changed"};
        }
      }
      const previous=document.getElementById("orxelia-recovery-viewer");
      if(previous)previous.remove();
      const box=document.createElement("section");
      box.id="orxelia-recovery-viewer";
      box.style.cssText="padding:16px;margin:14px 0;border:3px solid #1b65a8;border-radius:12px;background:#fff;color:#14243b";
      const heading=document.createElement("h3");
      heading.textContent="端末内の復旧データを表示しました";
      const label=document.createElement("p");
      label.textContent="読み取り専用です。データを変更しません。個人情報を含む場合があります。";
      const area=document.createElement("textarea");
      area.readOnly=true;area.value=JSON.stringify(payload,null,2);area.rows=12;
      area.style.cssText="display:block;width:100%;min-height:230px;font:13px/1.5 monospace;overflow:auto;margin:12px 0";
      const copy=document.createElement("button");
      copy.type="button";copy.textContent="復旧データをすべて選択";
      copy.addEventListener("click",()=>{area.focus();area.select();});
      box.append(heading,label,area,copy);
      button.insertAdjacentElement("afterend",box);
      box.scrollIntoView({block:"center",behavior:"auto"});
    }
    if (kind === "recoveryExport") downloadRecoverySnapshot();
    if (kind === "bundleExport") exportBundle();
    if (kind === "tasksExport") downloadJson("ORXELIA-tasks-"+today()+".json",loadTasks());
    if (kind === "taskDelete") { const rows=loadTasks(); if(rows===null) throw Error("タスクを読み込めません。"); if(confirm("このタスクを削除しますか？")) {saveTasks(rows.filter(t=>t.id!==value));render();} }
    if (kind === "safetyExport") exportSafetyCopy();
    else if (kind === "project" || kind === "dailyProject") editProject(value,kind === "dailyProject");
    if (kind === "projectDelete") deleteSingleProject(value);
    if (kind === "ledger") editLedger(value);
    if (kind === "decision") editDecision(value);
    if (kind === "reviewApprove") decisionReview(Number(value),"決定済み");
    if (kind === "reviewHold") decisionReview(Number(value),"保留");
    if (kind === "reviewReject") decisionReview(Number(value),"却下");
    if (kind === "export") exportData();
    if (kind === "mergeCatalog") mergeCatalog();
    if (kind === "openDecisions") { tab = "verification"; render(); $("launch-decisions").focus(); }
    if (kind === "openTasks") { tab = "verification"; render(); const taskSection=[...$("view").querySelectorAll("details")].find(d=>d.querySelector("summary")?.textContent?.includes("作業記録・タスク")); if(taskSection){taskSection.open=true;taskSection.scrollIntoView({block:"start"});} }
    if (kind === "openEvidence") { tab = "verification"; render(); }
    if (kind === "researchAdopt") reviewIdea(researchReviews[Number(value)],"決定済み");
    if (kind === "researchHold") reviewIdea(researchReviews[Number(value)],"保留");
    if (kind === "researchReject") reviewIdea(researchReviews[Number(value)],"却下");
    if (kind === "ideaAdopt") reviewIdea(dailyIdeas[Number(value)],"決定済み");
    if (kind === "ideaHold") reviewIdea(dailyIdeas[Number(value)],"保留");
    if (kind === "ideaReject") reviewIdea(dailyIdeas[Number(value)],"却下");
    if (kind === "aiFeedRefresh") autoImportAiFeed();
    if (kind === "researchPrompt") researchPrompt();
    if (kind === "portfolioCsv") exportPortfolioCsv();
    if (kind === "evidenceCsv") exportEvidenceCsv();
    if (kind === "tasksCsv") exportTasksCsv();
    if (kind === "tasksIcs") exportTasksCalendar();
    if (kind === "researchTemplate") {
      const project=data.projects[0];
      downloadJson("ORXELIA-research-template.json",{format:"orxelia-research-v1",project:project?.name||"事業一覧の事業名",researchedAt:today(),findings:[{type:"公開市場データ",status:"仮説",summary:"ここに調査結果と未確認事項を記載",source:"原典URLまたは資料名"},{type:"競合実績・価格",status:"仮説",summary:"競合の価格・差別化を記載",source:"競合公式サイトURL"}]});
    }
    if (kind === "researchCancel") {pendingResearch=null; if($("research-preview")) $("research-preview").textContent="取り込みを中止しました。";}
    if (kind === "researchCommit") {
      if(!pendingResearch) throw Error("取り込み対象がありません。");
      const rows=loadEvidence();if(rows===null) throw Error("検証記録が読み込めないため保存できません。");
      const report=pendingResearch;
      const signatures=new Set(rows.map(r=>[r.project,r.type,r.summary,r.source,r.date].join("\u001f")));
      const fresh=report.findings.filter(r=>!signatures.has([r.project,r.type,r.summary,r.source,r.date].join("\u001f")));
      if(rows.length+fresh.length>3000) throw Error("検証記録の上限3000件を超えます。");
      if(!confirm(report.project.name+"の調査項目"+fresh.length+"件を端末内に追加しますか？（既存記録は保持）")) return;
      saveEvidence([...rows,...fresh]);pendingResearch=null;render();$("notice").textContent="調査項目"+fresh.length+"件を追加しました。重複"+(report.findings.length-fresh.length)+"件はスキップ。";
    }
    if (kind === "evidenceExport") { const rows=loadEvidence(); if(rows===null) throw Error("検証記録が読み込めません。"); downloadJson("ORXELIA-evidence-"+today()+".json",rows); }
    if (kind === "evidenceDelete") { if(confirm("この検証記録を削除しますか？")) {saveEvidence(loadEvidence().filter(r=>r.id!==value));render();} }
    if (kind === "brief") exportBrief();
    if (kind === "reportPaste") {
      const link = $("report-link").value.trim();
      const marker = link.indexOf("#report=");
      if (marker < 0) {
        $("notice").textContent = "取り込み用リンクを丸ごと貼り付けてください。通常のダッシュボードURLでは追加できません。";
      } else {
        importDailyLink(link.slice(marker));
      }
    }
    if (kind === "removeLedger" && confirm(month + "の収支入力を削除しますか？")) {
      save({...data,ledger:data.ledger.filter(r => r.project !== value || r.month !== month)});
      render();
      $("notice").textContent = "収支入力を削除しました。";
    }
  } catch (error) {
    $("notice").textContent = error.message;
  }
});

document.addEventListener("submit", event => {
  if(event.target.id!=="evidence-form") return;
  event.preventDefault();
  try {
    const f=Object.fromEntries(new FormData(event.target));
    if(!data.projects.some(p=>p.id===f.project)||!newEvidenceTypes.includes(f.type)||!evidenceStatuses.includes(f.status)||!String(f.summary||"").trim()) throw Error("入力を確認してください。");
    const rows=loadEvidence();
    if(rows===null) throw Error("検証記録を読み込めません。");
    if (f.status === "資料確認済み" && !String(f.source || "").trim()) throw Error("確認した一次資料のURLまたは資料名を入力してください。");
    rows.push({id:crypto.randomUUID(),project:f.project,type:f.type,status:f.status,summary:String(f.summary).trim().slice(0,1000),source:String(f.source||"").trim().slice(0,500),date:today()});
    saveEvidence(rows);render();$("notice").textContent="検証記録を端末内に保存しました。";
  }catch(error){$("notice").textContent=error.message;}
});
document.addEventListener("change", async event => {
  const target = event.target;
  if (target.id === "filter") filter = target.value;
  else if (["day","registered"].includes(target.id) && target.value) date = target.value;
  else if (target.id === "month" && target.value) month = target.value;
  else if (target.id === "research-file") {
    const file=target.files?.[0];target.value="";
    if(!file) return;
    pendingResearch=null;
    try {
      if(file.size>250000) throw Error("ファイルが大きすぎます（250KBまで）。");
      const report=normalizeResearchReport(JSON.parse((await file.text()).replace(/^\uFEFF/,"")));
      showResearchPreview(report);
    } catch(error) { if($("research-preview")) $("research-preview").textContent="読み込みエラー："+error.message; }
    return;
  }
  else if (target.id === "import") {
    const file = target.files[0];
    target.value = "";
    if (!file) return;
    try {
      const next = JSON.parse((await file.text()).replace(/^\uFEFF/,""));
      validate(next);
      if (!confirm("現在のデータを置き換えます。事業 " + next.projects.length + "件を読み込みますか？\n続行前に現在のデータをバックアップとして書き出します。")) return;
      exportData();
      if (!confirm("バックアップJSONのダウンロードを確認しましたか？確認できない場合はキャンセルしてください。")) return;
      preserveRecoverySnapshot("JSON全件置換前");
      save(next);
      date = data.projects.map(p => p.date).filter(Boolean).sort().at(-1) || today();
      tab = "portfolio";
      filter = "すべて";
      $("notice").textContent = "データを読み込みました。";
    } catch (error) {
      $("notice").textContent = "読み込みエラー　" + error.message;
    }
  } else return;
  render();
});
$("cancel").addEventListener("click",() => $("editor").close());
$("form").addEventListener("submit",async event => {
  event.preventDefault();
  const saveButton = event.submitter || event.target.querySelector('button[type="submit"], button.primary');
  if (!saveButton || saveButton.disabled) return;
  saveButton.disabled = true;
  try {
    const message = await submit(Object.fromEntries([...new FormData(event.target)].map(([k,v]) => [k,v.trim()])));
    $("editor").close();
    $("notice").textContent = typeof message === "string" ? message : "この端末に保存しました。";
    render();
  } catch (error) {
    $("error").textContent = error.message;
  } finally {
    saveButton.disabled = false;
  }
});
let offlineStatus = "オフライン準備にはHTTPS（またはPCのlocalhost）が必要です。";
if ("serviceWorker" in navigator && window.isSecureContext) {
  offlineStatus = "オフライン用ファイルを準備中…";
  navigator.serviceWorker.register("./sw.js").then(() => navigator.serviceWorker.ready).then(() => {
    offlineStatus = "オフライン用ファイルを準備済み。";
    if ($("offline")) $("offline").textContent = offlineStatus;
  }).catch(() => {
    offlineStatus = "オフライン準備に失敗しました。";
    if ($("offline")) $("offline").textContent = offlineStatus;
  });
}
render();


async function importDailyLink(hash = location.hash) {
  const prefix = "#report=";
  if (!hash.startsWith(prefix)) return;
  try {
    const encoded = hash.slice(prefix.length);
    if (encoded.length > 100000) throw Error("リンクが長すぎます。");
    const bytes = Uint8Array.from(atob(encoded.replace(/-/g,"+").replace(/_/g,"/")), c => c.charCodeAt(0));
    const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream("gzip"));
    const incoming = JSON.parse(await new Response(stream).text());
    validate(incoming);
    if (incoming.ledger.length || incoming.projects.some(p => p.type !== types[0])) throw Error("日次レポート専用のリンクです。");
    const projects = [...data.projects];
    const decisions = [...data.decisions];
    const existingIds = new Set(projects.map(p => p.id));
    const existingDaily = new Set(projects.filter(p => p.type === types[0]).map(p => p.date + "/" + normalizedName(p.name)));
    const incomingKeys = new Set();
    const allNames = new Set(projects.map(p => normalizedName(p.name)));
    let crossDateDuplicates = 0;
    for (const p of incoming.projects) {
      const dailyKey = p.date + "/" + normalizedName(p.name);
      if (existingIds.has(p.id) || existingDaily.has(dailyKey) || incomingKeys.has(dailyKey)) continue;
      if (allNames.has(normalizedName(p.name))) { crossDateDuplicates++; continue; }
      if (projects.filter(item => item.date === p.date).length >= 10) continue;
      const rank = projects.some(item => item.date === p.date && item.rank === p.rank) ? 0 : p.rank;
      projects.push({...p,rank});
      existingIds.add(p.id);
      incomingKeys.add(dailyKey);
      allNames.add(normalizedName(p.name));
    }
    for (const d of incoming.decisions) {
      if (!decisions.some(item => item.date === d.date && item.title === d.title)) decisions.push(d);
    }
    const added = projects.length - data.projects.length;
    const proposals = decisions.length - data.decisions.length;
    if (!(added || proposals)) {
      $("notice").textContent = "追加対象なし：既存の記録と重複しています。";
      history.replaceState(null,"",location.pathname+location.search);
      return;
    }
    const dates = [...new Set(incoming.projects.map(p => p.date))];
    if (!confirm("日次レポート取り込みプレビュー\n対象日：" + (dates.join("、") || "候補なし") + "\n新規事業：" + added + "件\n経営判断：" + proposals + "件\n重複・上限超過は除外済み。既存データは削除しません。追加しますか？")) {
      $("notice").textContent = "取り込みをキャンセルしました。";
      return;
    }
    const log = {at:new Date().toISOString(),date:dates.join(",") || today(),projects:added,decisions:proposals};
    preserveRecoverySnapshot("日次レポート追加前");
    save({...data,projects,decisions,importLog:[...(data.importLog || []),log].slice(-200)});
    date = incoming.projects[0]?.date || date;
    const hasProgress = incoming.decisions.some(d => d.activity);
    tab = hasProgress ? "home" : added ? "portfolio" : "verification";
    render();
    openSection(hasProgress ? "作業進捗" : added ? "日次候補" : "過去の経営判断");
    $("notice").textContent = added || proposals
      ? "日次候補 " + added + "案・判断 " + proposals + "件を追加しました。"
      : "追加できる新しい記録はありません。日次一覧で対象日の内容を確認してください。";
    history.replaceState(null,"",location.pathname + location.search);
  } catch {
    $("notice").textContent = "リンクを取り込めませんでした。取り込みリンクをコピーし直してください。";
  }
}
window.addEventListener("hashchange",() => importDailyLink());
importDailyLink();



window.ORXELIA_PUBLISHABLE_KEY = 'sb_publishable_T9287hFW7tudpePLIu9c_w_9xsxTujp';
"use strict";

// A cloud write is conditional on the revision read by this device.
const sync = (() => {
  const endpoint = "https://yzlxcfncdtojajlhihap.supabase.co";
  const sessionKey = "orxelia-sync-session";
  const markerKey = "orxelia-sync-baseline";
  const table = "/rest/v1/orxelia_workspace";
  let session, baseline;
  try {
    session = JSON.parse(localStorage.getItem(sessionKey));
    baseline = JSON.parse(localStorage.getItem(markerKey));
  } catch {}
  const recovery = new URLSearchParams(location.hash.slice(1));
  let recoveryToken = recovery.get("type") === "recovery" ? recovery.get("access_token") : null;
  let busy = false;
  let message = "";
  const ordered = value => Array.isArray(value) ? value.map(ordered) :
    value && typeof value === "object" ? Object.fromEntries(Object.keys(value).sort().map(k => [k,ordered(value[k])])) : value;
  const signature = value => JSON.stringify(ordered(value));
  const populated = value => value.projects.length || value.ledger.length || value.decisions.length;

  function status(text) {
    message = text;
    const target = document.getElementById("sync-status");
    if (target) target.textContent = text;
  }
  function setSession(result) {
    if (session?.user.id !== result.user.id) clearProposalSync();
    session = {...result,expires_at:result.expires_at || Date.now()/1000 + result.expires_in};
    localStorage.setItem(sessionKey,JSON.stringify(session));
  }
  async function request(path, options = {}, authenticated = true) {
    if (authenticated && session.expires_at < Date.now()/1000 + 60) {
      const refreshed = await request("/auth/v1/token?grant_type=refresh_token",
        {method:"POST",body:JSON.stringify({refresh_token:session.refresh_token})},false);
      setSession(refreshed);
    }
    const headers = {apikey:window.ORXELIA_PUBLISHABLE_KEY,"Content-Type":"application/json",...options.headers};
    if (authenticated) headers.Authorization = "Bearer " + session.access_token;
    const response = await fetch(endpoint + path,{...options,headers,cache:"no-store"});
    if (!response.ok) throw Error("HTTP " + response.status);
    return response.status === 204 ? null : response.json();
  }
  document.addEventListener("change",async event=>{
    if(event.target.id!=="orxelia-priority-select")return;
    const selectedId=event.target.value;
    if(!selectedId||!session?.user?.id)return;
    const chosen=orxeliaTrialProposals.find(p=>p.id===selectedId);
    if(!chosen)return;
    if(!confirm("「"+chosen.title+"」を最優先にしますか？ 販売・公開は承認しません。")){render();return}
    event.target.disabled=true;
    try{
      for(const p of orxeliaTrialProposals){
        const newRank=p.id===selectedId?1:(Number(p.brief?.priority_rank)===1?2:Number(p.brief?.priority_rank)||99);
        if(Number(p.brief?.priority_rank)===newRank)continue;
        const brief={...p.brief,priority_rank:newRank,priority_mode:"user_selected",priority_updated_at:new Date().toISOString()};
        await request("/rest/v1/orxelia_proposals?id=eq."+encodeURIComponent(p.id)+"&owner_id=eq."+encodeURIComponent(session.user.id),{method:"PATCH",headers:{Prefer:"return=minimal"},body:JSON.stringify({brief})});
        p.brief=brief;
      }
      render();
    }catch(error){alert("優先順位の保存に失敗しました。同期を再読み込みしてください。");console.error(error);render()}
  });
  document.addEventListener("click",async event=>{
    const button = event.target.closest("[data-development-request]");
    if (!button) return;
    const owner = session?.user?.id;
    if (!owner) { $("notice").textContent = "ログインしてから開発を依頼してください。"; return; }
    if ($("editor").open) return;
    const requestId = crypto.randomUUID();
    const fields = input("title","システム名","text","","required maxlength=140")
      +area("purpose","解決したい課題・目的","")
      +area("audience","使う人・使う場面","")
      +area("features","必要な機能","")
      +area("references","参考資料・URL（任意）","");
    editor("作りたいシステムを依頼", fields, async values => {
      if (session?.user?.id !== owner) throw Error("ログインが切り替わりました。");
      if (!values.title || !values.purpose || !values.audience || !values.features)
        throw Error("システム名、目的、使う人、必要な機能を入力してください。");
      if (values.purpose.length > 3000 || values.audience.length > 1000 || values.references.length > 3000)
        throw Error("目的と参考資料は3,000文字以内、使う人は1,000文字以内で入力してください。");
      const proposal = await request("/rest/v1/rpc/orxelia_request_development",{
        method:"POST",body:JSON.stringify({
          p_request_id:requestId,p_title:values.title,p_purpose:values.purpose,
          p_audience:values.audience,p_features:values.features,p_references:values.references
        })
      });
      if (session?.user?.id !== owner) return "開発依頼を保存しました。";
      if (!orxeliaTrialProposals.some(p => p.id === proposal.id)) orxeliaTrialProposals.unshift(proposal);
      tab = "verification";
      return "開発依頼を受け付けました。非公開試作・法務審査の後に開発許可を判断できます。";
    });
  });
  document.addEventListener("click",async event=>{
    const reviewButton = event.target.closest("[data-legal-review]");
    if (!reviewButton) return;
    const owner = session?.user?.id;
    if (!owner) { $("notice").textContent = "ログインしてから法務審査を開いてください。"; return; }
    const proposal = orxeliaTrialProposals.find(p => p.id === reviewButton.dataset.legalReview);
    if (!proposal) return;
    reviewButton.disabled = true;
    try {
      const [previous] = await request("/rest/v1/orxelia_legal_reviews?proposal_id=eq."+encodeURIComponent(proposal.id)+"&order=version.desc&limit=1");
      if (session?.user?.id !== owner || $("editor").open) return;
      const states = {unreviewed:"未審査",in_review:"確認中",expert_review:"専門家確認",blocked:"問題あり",passed:"確認済み"};
      const fields = Object.entries(legalReviewFields).map(([id,label]) => {
        const value = previous?.checks?.[id] || {};
        const options = Object.entries(states).map(([key,text]) =>
          '<option value="'+key+'"'+(value.status===key?' selected':'')+'>'+text+'</option>').join("");
        return '<fieldset><legend>'+label+'</legend><label>状態<select name="'+id+'-status">'+options+'</select></label>'
          +input(id+"-evidence","根拠URL・文書名","text",value.evidence,"maxlength=1000")
          +input(id+"-reviewer","確認者","text",value.reviewer,"maxlength=100")
          +input(id+"-reviewedAt","確認日","date",value.reviewedAt)
          +input(id+"-assignee","担当","text",value.assignee,"maxlength=100")
          +input(id+"-due","期限","date",value.due)
          +input(id+"-next","次の行動","text",value.next,"maxlength=500")+'</fieldset>';
      }).join("");
      const risks = (previous?.risks || []).filter(r => r.status==="open").map(r => r.detail).join("\n");
      const revision = Number(proposal.revision_number) || 1;
      const previousStatus = !previous ? "未審査" : previous.design_revision !== revision
        ? "デザイン変更後の再審査が必要です" : previous.eligible ? "前回の審査項目は確認済み" : "前回は保留";
      editor("法務審査："+proposal.title, '<p>'+esc(previousStatus)+'</p>'+fields
        +area("openRisks","重大な未解決事項（1行に1件）",risks), async values => {
        if (session?.user?.id !== owner) throw Error("ログインが切り替わりました。");
        const checks = Object.fromEntries(Object.keys(legalReviewFields).map(id =>
          [id,Object.fromEntries(["status","evidence","reviewer","reviewedAt","assignee","due","next"].map(field => [field,values[id+"-"+field]]))]));
        const openRisks = (values.openRisks || "").split("\n").map(s=>s.trim()).filter(Boolean)
          .map(detail => ({severity:"high",status:"open",detail}));
        const saved = await request("/rest/v1/rpc/orxelia_save_legal_review",{method:"POST",body:JSON.stringify({
          p_proposal_id:proposal.id,p_previous_version:previous?.version ?? null,
          p_design_revision:revision,p_checks:checks,p_risks:openRisks
        })});
        if (proposal.status === "approved_for_development") proposal.status = "awaiting_first_approval";
        return saved?.eligible
          ? "法務審査を保存しました。非公開試作の確認後、開発許可を判断できます。"
          : "法務審査を保存しました。未確認事項があるため開発許可は保留です。";
      });
    } catch (error) {
      $("notice").textContent = "法務審査を開けませんでした。"+error.message;
    } finally { reviewButton.disabled = false; }
  });
  document.addEventListener("click",async event=>{
    const btn=event.target.closest("[data-proposal-action]");
    if(!btn)return;
    if(!session?.user?.id){alert("ログインして同期してください");return}
    const id=btn.dataset.proposalId,action=btn.dataset.proposalAction;
    const messages={request_revision:"入力した内容をGeminiへ送信し、デザインを修正・再提出させますか？ 第1承認は行いません。",request_prototype_revision:"動作試作品の修正と自動テストを依頼しますか？ 販売承認は行いません。",approve_development:"非公開試作と法務審査を確認し、本格開発を承認しますか？",hold:"この事業を保留しますか？",request_sales_review:"販売審査を申請しますか？販売開始ではありません。",approve_sales:"販売方針を最終承認しますか？公開・決済開始は自動実行しません。"};
    if(!messages[action])return;
    const feedback=["request_revision","request_prototype_revision"].includes(action)?(document.querySelector(`[data-revision-input="${id}"]`)?.value??orxeliaRevisionDrafts[id]??"").trim():null;
    if(["request_revision","request_prototype_revision"].includes(action)&&(feedback.length<3||feedback.length>3000)){alert("修正内容を3〜3000文字で入力してください。");return}
    if(!confirm(messages[action]))return;
    btn.disabled=true;
    try{
      const result=await request("/rest/v1/rpc/orxelia_proposal_transition",{method:"POST",body:JSON.stringify({p_id:id,p_action:action,p_feedback:feedback})});
      const item=orxeliaTrialProposals.find(p=>p.id===id);if(item)item.status=result.status;
      if(["request_revision","request_prototype_revision"].includes(action)){delete orxeliaRevisionDrafts[id];try{localStorage.setItem(orxeliaDraftKey,JSON.stringify(orxeliaRevisionDrafts))}catch{}}
      status("事業IDごとの判断をクラウドに保存しました。");document.querySelectorAll("details[data-prototype-preview][open]").forEach(d=>d.open=false);render();
    }catch(e){alert("処理できませんでした: "+e.message+"。承認条件とログイン状態を確認してください。");btn.disabled=false}
  });
  function remember(revision, snapshot) {
    baseline = {owner:session.user.id,revision,snapshot:signature(snapshot)};
    localStorage.setItem(markerKey,JSON.stringify(baseline));
  }
  function adopt(remote) {
    save(remote.snapshot);
    remember(remote.revision,remote.snapshot);
    if (!data.projects.some(p => p.date === date)) {
      date = data.projects.map(p => p.date).filter(Boolean).sort().at(-1) || today();
    }
    if (!$("editor").open) render();
  }
  let dailyReport = null;
  let approvalRecord = null;
  let dailyApprovalConflict = null;
  let pipelineRecords = [];
  let developmentJob = null;
  function dailyReportView() {
    if (!session || dailyReport?.owner !== session.user.id) return "";
    const {row, failed} = dailyReport;
    if (failed) return panel('<h3>日次事業開発レポート</h3><p>読込に失敗しました。設定・データ管理から同期状態を確認してください。</p>');
    if (!row) return panel('<h3>日次事業開発レポート</h3><p>保存されたレポートはまだありません。</p>');
    const {report_date, report} = row;
    const findings = Array.isArray(report?.findings) ? report.findings : [];
    const evidence = findings.map(f => '<article style="padding:12px 0;border-top:1px solid rgba(180,180,180,.2)">' +
      '<strong>' + esc(f.type || '調査項目') + '</strong> ／ ' + esc(f.status || '未検証') +
      '<p style="white-space:pre-wrap">' + esc(f.summary || '') + '</p>' +
      (typeof f.source === 'string' && /^https:\/\/[^\s<>"]+$/.test(f.source) ?
        '<a href="' + esc(f.source) + '" target="_blank" rel="noopener noreferrer">一次資料を確認</a>' : '') +
      '</article>').join('');
    const pipeline = pipelineRecords.find(p => p.report_date === report_date);
    const phaseLabels = {proposal:'提案・承認待ち',development_requested:'開発依頼受付・実行待ち',development_running:'開発中',development_ready:'開発成果確認待ち',sales_review:'販売審査中',sales_approved:'販売承認済み（公開は別途）',held:'保留'};
    const phase = phaseLabels[pipeline?.phase] || report?.phase || report?.approval_status || '未承認・販売保留';
    const jobStatus = developmentJob?.status === 'queued' ? '<p>開発ジョブ：受付済み（GitHub Actionsの定期実行待ち）</p>' : developmentJob ? '<p>開発ジョブ：' + esc(developmentJob.status) + '</p>' : '';
    const deliverables = Array.isArray(pipeline?.deliverables) ? pipeline.deliverables : [];
    const deliverableView = deliverables.length ? '<details><summary>開発成果物（' + deliverables.length + '件）</summary>' + deliverables.map((d,i) => '<p>' + esc(d.title || '成果物') + '：' + esc(d.status || '未検証') + (d.type === 'prototype' && typeof d.html === 'string' ? ' <button type="button" data-orxelia-download="' + i + '">試作品HTMLを保存</button>' : '') + '</p>').join('') + '</details>' : '<p>開発成果物：未登録</p>';
    const salesAction = pipeline?.phase === 'development_ready' ?
      '<p><button type="button" id="orxelia-request-sales-review">販売審査を申請</button></p>' :
      pipeline?.phase === 'sales_review' ?
      '<p><button type="button" id="orxelia-approve-sales">販売開始を最終承認（公開・決済は実行しない）</button></p>' :
      pipeline?.phase === 'sales_approved' ? '<p>販売承認済み。公開・決済開始は未実行です。</p>' : '';
    const approvalButton = dailyApprovalConflict ? '<p style="color:#f1ba68">この日付には別事業「' + esc(dailyApprovalConflict.project) + '」の承認が保存されています。既存履歴を保護するため、この画面からの重複承認を停止しました。別の候補は「事業案・販売判断」から選択してください。</p>' : !approvalRecord ? '<p><button type="button" id="orxelia-approve-development">この事業の開発を承認</button></p><p style="font-size:.85em">承認記録を保存します。承認後に開発要件とテスト項目を自動生成します。承認後に開発ジョブを登録し、GitHub Actionsが定期的に処理します。公開・販売・支出は行いません。</p>' : '<p>開発承認：記録済み（' + esc(approvalRecord.stage) + '）</p>';
    return panel('<h3>AI選定事業｜' + esc(report_date) + '</h3>' +
      '<p><strong>' + esc(report?.project || '事業名未登録') + '</strong></p>' +
      '<p>進捗：' + esc(phase) + '</p>' + approvalButton + salesAction + jobStatus + deliverableView +
      '<p style="white-space:pre-wrap">' + esc(report?.summary || '') + '</p>' +
      '<details><summary>市場・競合・動作検証の根拠（' + findings.length + '件）</summary>' +
      (evidence || '<p>詳細データはまだ登録されていません。</p>') + '</details>' +
      '<p style="font-size:.85em;opacity:.85">これは非公開の日次提案レポートです。事業台帳への登録、開発着手、販売承認は別工程です。試作品の動作確認と販売判断は記録に基づき確認してください。</p>');
  }
  async function run(credentials) {
    if (recoveryToken) return;
    if (busy) { status("同期処理中です。完了までお待ちください。"); return; }
    if (!window.ORXELIA_PUBLISHABLE_KEY || (!session && !credentials) || !readable || $("editor").open) { status("同期を開始できません。ログイン状態・設定・編集中の画面を確認してください。"); return; }
    status("クラウドに接続しています…");
    let syncStep = "接続準備";
    busy = true;
    try {
      if (credentials) {
        status("ログイン中…");
        setSession(await request("/auth/v1/token?grant_type=password",{method:"POST",body:JSON.stringify(credentials)},false));
        render();
      }
      syncStep = "認証情報の確認";
      const owner = session.user.id;
      try {
        const [row] = await request("/rest/v1/orxelia_daily_reports?select=report_date,report&order=report_date.desc&limit=1");
        dailyReport = {owner,row};
        if (row) {
          const approvals = await request("/rest/v1/orxelia_approvals?select=report_date,project,stage&report_date=eq." + encodeURIComponent(row.report_date) + "&limit=1");
          approvalRecord = approvals.find(a => a.project === row.report?.project) || null;
          dailyApprovalConflict = !approvalRecord && approvals.length ? approvals[0] : null;
        } else { approvalRecord = null; dailyApprovalConflict = null; }
      } catch {
        dailyReport = {owner,failed:true};
      }
      if (session?.user.id !== owner || $("editor").open) return;
      proposalSync.state = "loading";
      render();
      try{
        const [active,archived]=await Promise.all([
          request("/rest/v1/orxelia_proposals?select=id,title,status,brief,created_at,design_status,design_html,design_review,prototype_html,test_report,sales_review,error_message,revision_number,revision_summary,revision_history,prototype_revision_number,prototype_revision_request,prototype_revision_history&brief->>dashboard_deleted_at=is.null&order=created_at.desc&limit=1000"),
          request('/rest/v1/orxelia_proposals?select=id,title,status,brief&brief->>dashboard_deleted_at=not.is.null&order=updated_at.desc&limit=1000')
        ]);
        if (session?.user.id !== owner) return;
        orxeliaTrialProposals=active;
        orxeliaArchivedProposals=archived;
        proposalSync = { state: "ready", lastSuccess: new Date() };
      }catch(e){
        if (session?.user.id !== owner) return;
        console.warn("Additional proposal sync failed:",e.message);
        proposalSync.state = "failed";
      }
      syncStep = "開発レポートの取得";
      const pipelineRows = await request('/rest/v1/orxelia_pipeline?select=report_date,project,phase,deliverables&order=report_date.desc&limit=30');
      pipelineRecords = pipelineRows;
      if (dailyReport?.row) {
        const jobs = await request('/rest/v1/orxelia_development_jobs?select=report_date,project,status&report_date=eq.' + encodeURIComponent(dailyReport.row.report_date) + '&limit=1');
        developmentJob = jobs.find(j => j.project === dailyReport.row.report?.project) || null;
      }
      render();
      syncStep = "事業台帳の取得";
      const [remote] = await request(table + "?select=revision,snapshot&limit=1");
      if (remote) validate(remote.snapshot);
      if ($("editor").open) return;
      const snapshot = data;
      const local = signature(snapshot);
      const sameAccount = baseline?.owner === session.user.id;
      const dirty = sameAccount ? baseline.snapshot !== local : !!populated(snapshot);
      if (!remote) {
        if (sameAccount) {
          status("クラウド側の保存を確認できません。端末データは保持しています。");
          return;
        }
        if (dirty) {
          const [created] = await request(table,{method:"POST",headers:{Prefer:"return=representation"},body:JSON.stringify({snapshot})});
          remember(created.revision,snapshot);
        }
      } else if (signature(remote.snapshot) === local) {
        remember(remote.revision,snapshot);
      } else if (!dirty || (!sameAccount && ["projects","ledger","decisions"].every(group =>
        snapshot[group].every(item => remote.snapshot[group].some(saved => signature(saved) === signature(item)))))) {
        adopt(remote);
      } else if (sameAccount && remote.revision === baseline.revision) {
        const [updated] = await request(table + "?revision=eq." + baseline.revision,
          {method:"PATCH",headers:{Prefer:"return=representation"},
           body:JSON.stringify({revision:baseline.revision+1,snapshot})});
        if (!updated) {
          status("別の端末で更新されました。端末データは保持しています。");
          return;
        }
        remember(updated.revision,snapshot);
      } else {
        status("端末とクラウドの両方に異なる記録があります。上書きを止めました。「JSONを書き出す」で端末の記録を保存できます。");
        return;
      }
      syncStep = "保存結果の再検証";
      const [verified] = await request(table + "?select=revision,snapshot&limit=1");
      if (!verified || signature(verified.snapshot) !== signature(data)) {
        status("同期未完了：クラウドの内容が端末と一致しません。端末データは保持しています。");
        return;
      }
      remember(verified.revision,verified.snapshot);
      status("クラウド保存確認済み（事業 " + verified.snapshot.projects.length + "件／版 " + verified.revision + "） ／ " + new Date().toLocaleTimeString("ja-JP"));
    } catch (error) {
      const detail = String(error?.message || "不明なエラー");
      const code = detail.match(/(?:HTTP|Supabase|status)\s*[: ]\s*(\d{3})/i)?.[1] || detail.match(/\b(400|401|403|404|409|422|429|500|502|503)\b/)?.[1];
      status((credentials ? "ログイン・接続失敗" : "同期失敗") + "［" + syncStep + "］" + (code ? " HTTP " + code : " " + (error instanceof TypeError ? "通信エラー" : "認証・処理エラー")) + "。端末データは保持しています。");
      console.warn("ORXELIA sync failed", code || "unknown");
    } finally {
      busy = false;
    }
  }
  function view() {
    if (!window.ORXELIA_PUBLISHABLE_KEY) return "";
    return '<div class="panel"><h3>iPhone・PCの自動同期</h3><p id="sync-status" role="status">' +
      esc(message || (session ? "接続を確認中…" : "同じアカウントで各端末からログインしてください。")) + '</p>' +
      (recoveryToken ? '<form id="sync-recovery"><label>新しいパスワード<input type="password" name="password" autocomplete="new-password" minlength="12" required></label><button class="primary">新しいパスワードを保存</button></form>' : session ? '<button id="sync-logout" type="button">別のアカウントに切り替える</button> <button id="sync-account-check" type="button">ログインアカウントを確認</button> <button id="sync-now" type="button">今すぐ同期</button> <button id="sync-restore-cloud" type="button">クラウドから事業台帳を復元</button><p id="sync-account-result" role="status"></p>' :
        '<form id="sync-login"><label>メール<input type="email" name="email" autocomplete="username" required></label><label>パスワード<input type="password" name="password" autocomplete="current-password" required></label><button class="primary">ログインして同期</button> <button id="sync-reset" type="button">再設定メールを送る</button></form>') + '</div>';
  }
  document.addEventListener("click",event=>{
    if(event.target.id!=="sync-logout")return;
    if(busy){status("同期処理中です。終了後に切り替えてください。");return;}
    if(!confirm("この端末のログインだけ解除し、別のアカウントに切り替えますか？ 事業データやクラウドの記録は削除しません。"))return;
    session=null;
    baseline=null;
    localStorage.removeItem(sessionKey);
    localStorage.removeItem(markerKey);
    dailyReport=null;
    approvalRecord=null;
    dailyApprovalConflict=null;
    pipelineRecords=[];
    developmentJob=null;
    clearProposalSync();
    message="ログインを解除しました。事業データを保存したアカウントでログインしてください。";
    render();
  });
  // Account diagnostics are read-only and scoped to the current authenticated user.
  document.addEventListener("click",async event=>{
    if(event.target.id!=="sync-account-check")return;
    const btn=event.target;
    const output=document.getElementById("sync-account-result");
    if(!output)return;
    if(!session?.user?.id){output.textContent="ログイン状態を確認できません。";return;}
    btn.disabled=true;
    output.textContent="アカウントを確認しています…";
    try{
      const user=await request("/auth/v1/user");
      const rows=await request(table+"?select=revision,snapshot&limit=1");
      const remote=rows?.[0];
      const email=String(user?.email||session.user.email||"メールアドレス不明");
      if(!user?.id||user.id!==session.user.id)throw Error("ログイン情報が一致しません");
      output.textContent="現在のログイン: "+email+" ／ "+(remote?"事業台帳あり（事業 "+remote.snapshot?.projects?.length+"件・判断 "+remote.snapshot?.decisions?.length+"件・版 "+remote.revision+"）":"このアカウントに事業台帳なし。別アカウントに保存されている可能性があります。");
    }catch(error){output.textContent="確認できませんでした: "+String(error?.message||error);}
    finally{btn.disabled=false;}
  });
  // Explicit recovery is download-only from the cloud; never POST/PATCH the cloud.
  document.addEventListener("click", async event => {
    if(event.target.id!=="sync-restore-cloud")return;
    const btn=event.target;
    if(busy){status("同期処理が終わってからもう一度押してください。");return;}
    if(!session?.user?.id){status("先にログインしてください。");return;}
    if(!readable){status("端末に読み取りエラーがあります。上書きせず停止しました。");return;}
    if(populated(data)){status("端末に既存の事業データがあります。上書き防止のため復元を停止しました。");return;}
    btn.disabled=true;
    try{
      const rows=await request(table+"?select=revision,snapshot&limit=1");
      const remote=rows?.[0];
      if(!remote){status("このログインアカウントにクラウド事業台帳が見つかりません。");return;}
      validate(remote.snapshot);
      if(!populated(remote.snapshot)){status("クラウドの事業台帳も空です。復元を停止しました。");return;}
      const count=remote.snapshot.projects.length,decisions=remote.snapshot.decisions.length;
      if(!confirm("クラウドの事業 "+count+"件・判断履歴 "+decisions+"件（版 "+remote.revision+"）をこの端末へ復元しますか？ クラウドの内容は変更しません。"))return;
      if(populated(data)){status("操作中に端末データが変化したため停止しました。");return;}
      adopt(remote);
      status("クラウドから復元しました（事業 "+count+"件／判断 "+decisions+"件／版 "+remote.revision+"）。");
    }catch(error){status("復元できませんでした。端末・クラウドは変更していません: "+String(error?.message||error));}
    finally{btn.disabled=false;}
  });
  if (recoveryToken) {
    tab = "settings";
    history.replaceState(null,"",location.pathname + location.search);
  }
  document.addEventListener("submit", async event => {
    if (event.target.id === "sync-recovery") {
      event.preventDefault();
      const password = event.target.elements.password.value;
      if (busy) return;
      busy = true;
      try {
        const user = await request("/auth/v1/user",{method:"PUT",headers:{Authorization:"Bearer " + recoveryToken},
          body:JSON.stringify({password})},false);
        const email = user.email;
        recoveryToken = null;
        session = null;
        clearProposalSync();
        localStorage.removeItem(sessionKey);
        status("パスワードを更新しました。同期に接続中…");
        render();
        busy = false;
        await run({email,password});
      } catch {
        status("再設定できませんでした。新しい再設定メールを使うか、別のパスワードを指定してください。");
      } finally { busy = false; }
      return;
    }
    if (event.target.id !== "sync-login") return;
    event.preventDefault();
    const values = Object.fromEntries(new FormData(event.target));
    values.email = values.email.trim();
    event.target.elements.password.value = "";
    run(values);
  });
  document.addEventListener("click", event => {
    const btn = event.target.closest('[data-orxelia-download]');
    if (!btn || !session || !dailyReport?.row) return;
    const pipeline = pipelineRecords.find(p => p.report_date === dailyReport.row.report_date);
    const d = pipeline?.deliverables?.[Number(btn.dataset.orxeliaDownload)];
    if (!d || d.type !== 'prototype' || typeof d.html !== 'string') return;
    const blob = new Blob([d.html],{type:'text/html;charset=utf-8'});
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href=url;a.download='orxelia-prototype-'+dailyReport.row.report_date+'.html';
    document.body.appendChild(a);a.click();a.remove();
    setTimeout(()=>URL.revokeObjectURL(url),3000);
  });
  document.addEventListener("click", async event => {
    const kind = event.target.id;
    if (!['orxelia-request-sales-review','orxelia-approve-sales'].includes(kind)) return;
    if (!session || !dailyReport?.row || busy) return;
    const report_date = dailyReport.row.report_date;
    const isFinal = kind === 'orxelia-approve-sales';
    const msg = isFinal ? '販売開始の最終承認を記録しますか？\\n※公開・決済開始・契約は実行されません。' :
      '販売審査を申請しますか？\\n※開発完了と機能テスト合格が必要です。';
    if (!confirm(msg)) return;
    busy = true;
    try {
      const rpc = isFinal ? 'orxelia_approve_sales' : 'orxelia_request_sales_approval';
      await request('/rest/v1/rpc/' + rpc,{method:'POST',body:JSON.stringify({p_report_date:report_date})});
      pipelineRecords = await request('/rest/v1/orxelia_pipeline?select=report_date,project,phase,deliverables&order=report_date.desc&limit=30');
      status(isFinal ? '販売承認を記録しました。公開・決済は開始していません。' : '販売審査を受け付けました。');
      render();
    } catch(error) {
      alert('処理できませんでした。開発完了・動作検証・ログイン状態を確認してください。');
    } finally {busy=false;}
  });
  document.addEventListener("click", async event => {
    if (event.target.id !== "orxelia-approve-development") return;
    if (!session || !dailyReport?.row || approvalRecord || busy) return;
    const {report_date,report} = dailyReport.row;
    if(dailyApprovalConflict){alert('同日に別事業の承認記録があります。事業案・販売判断から候補を選択してください。');return}
    if (!report?.project || !confirm("「" + report.project + "」の開発を承認しますか？\\n※承認後、開発ジョブが登録され、GitHub Actionsの定期実行対象になります。公開・販売は行われません。")) return;
    busy = true;
    try {
      // Recheck on the server immediately before insert: stale UI state must never cause HTTP 409.
      const existingApprovals = await request("/rest/v1/orxelia_approvals?select=report_date,project,stage&report_date=eq." + encodeURIComponent(report_date));
      const already = existingApprovals.find(a=>a.project===report.project);
      if(already){approvalRecord=already;status("この事業の承認はすでに保存されています。");render();return}
      if(existingApprovals.length){dailyApprovalConflict=existingApprovals[0];status("同日付の別事業の承認が存在するため、登録を停止しました。");render();return}
      const [saved] = await request("/rest/v1/orxelia_approvals",{
        method:"POST",headers:{Prefer:"return=representation"},
        body:JSON.stringify({owner_id:session.user.id,report_date,project:report.project,stage:"development_requested"})
      });
      if (!saved) throw Error("保存結果を確認できません");
      const check = await request("/rest/v1/orxelia_approvals?select=report_date,project,stage&report_date=eq." + encodeURIComponent(report_date));
      approvalRecord = check.find(a => a.project === report.project) || null;
      if (!approvalRecord) throw Error("読み戻し失敗");
      try {
        await request("/rest/v1/rpc/orxelia_prepare_development",{
          method:"POST",body:JSON.stringify({p_report_date:report_date})
        });
        pipelineRecords = await request('/rest/v1/orxelia_pipeline?select=report_date,project,phase,deliverables&order=report_date.desc&limit=30');
        const jobs = await request('/rest/v1/orxelia_development_jobs?select=report_date,project,status&report_date=eq.' + encodeURIComponent(report_date) + '&limit=1');
        developmentJob = jobs.find(j => j.project === report.project) || null;
      } catch (prepareError) {
        status("承認は保存されましたが開発準備の初期化に失敗しました。");
      }
      status(developmentJob ? "開発承認済み。ジョブを登録しました。GitHub Actionsの実行を待っています。" : "開発承認は保存されましたが、ジョブ登録を確認できません。");
      render();
    } catch(error) {
      alert("開発承認を保存できませんでした。詳細: " + String(error?.message || error) + "。ログイン・同期を確認してください。");
    } finally {busy=false;}
  });
  document.addEventListener("click", async event => {
    if (event.target.id === "sync-reset") {
      const email = $("sync-login").elements.email;
      if (!email.reportValidity() || busy) return;
      busy = true;
      try {
        const redirect = "https://tobikyohei8989-tech.github.io/orxelia-dashboard/reset-password.html";
        await request("/auth/v1/recover?redirect_to=" + encodeURIComponent(redirect),
          {method:"POST",body:JSON.stringify({email:email.value.trim()})},false);
        status("再設定メールをリクエストしました。受信箱と迷惑メールを確認してください。");
      } catch {
        status("メールを送れませんでした。時間をおいて再試行してください。");
      } finally { busy = false; }
    }
    if (event.target.id === "sync-now") run();
  });
  document.addEventListener("visibilitychange", () => { if (!document.hidden) run(); });
  window.addEventListener("orxelia-local-change",() => { status("端末の変更を保存しました。クラウド同期を確認中…"); run(); });
  window.addEventListener("online",() => run());
  setInterval(() => { if (!document.hidden) run(); },15000);
  setInterval(() => { if (!document.hidden && tab === "home" && !$("editor").open && !$("view").contains(document.activeElement)) render(); },60000);
  async function archiveProposal(id,removed){
    if(!session?.user?.id)throw Error('設定からログインして同期してください。');
    if(busy)throw Error('同期中です。数秒待ってからもう一度お試しください。');
    busy=true;
    try{
      const result=await request('/rest/v1/rpc/orxelia_archive_proposal',{method:'POST',body:JSON.stringify({p_id:id,p_archived:removed})});
      const existing=[...orxeliaTrialProposals,...orxeliaArchivedProposals].find(p=>p.id===id);
      const updated={...existing,...result};
      orxeliaTrialProposals=orxeliaTrialProposals.filter(p=>p.id!==id);
      orxeliaArchivedProposals=orxeliaArchivedProposals.filter(p=>p.id!==id);
      (removed?orxeliaArchivedProposals:orxeliaTrialProposals).push(updated);
      return result;
    }finally{busy=false;}
  }
  return {run,view,dailyReportView,archiveProposal};
})();
window.orxeliaSync = sync;
render();
sync.run();
autoImportAiFeed();
window.addEventListener("online",autoImportAiFeed);
document.addEventListener("visibilitychange",()=>{if(!document.hidden)autoImportAiFeed();});






// Sales events are delegated because the tab is re-rendered.
document.addEventListener("submit", event => {
  if (event.target.id !== "sales-form") return;
  event.preventDefault();
  try {
    const rows=loadSales(); if (rows===null) throw Error("営業データを読み込めません。");
    const values=Object.fromEntries(new FormData(event.target));
    const name=String(values.name||"").trim(), note=String(values.note||"").trim();
    if (!name || name.length>100 || note.length>500 || !salesStages.includes(values.stage)) throw Error("入力内容を確認してください。");
    saveSales([...rows,{id:crypto.randomUUID(),name,stage:values.stage,note}]);
    render();
  } catch(e) { $("notice").textContent=e.message || "登録できませんでした。"; }
});
document.addEventListener("change",event => {
  const id=event.target.dataset.salesId;
  if (!id) return;
  try {
    const rows=loadSales(); if (rows===null || !salesStages.includes(event.target.value)) throw Error("営業データを読み込めません。");
    saveSales(rows.map(r=>r.id===id?{...r,stage:event.target.value}:r));render();
  } catch(e) { $("notice").textContent=e.message || "変更できませんでした。"; }
});

// v25 delegated task controls
document.addEventListener("submit",event=>{
  if(event.target.id!=="task-form")return;
  event.preventDefault();
  try {const rows=loadTasks();if(rows===null)throw Error("タスクを読み込めません。");
    const v=Object.fromEntries(new FormData(event.target));
    const title=String(v.title||"").trim();if(!title||title.length>160)throw Error("タスク名を確認してください。");
    if(v.project&&!data.projects.some(p=>p.id===v.project))throw Error("対象事業を確認してください。");
    saveTasks([...rows,{id:crypto.randomUUID(),title,project:String(v.project||""),due:String(v.due||""),state:"未着手"}]);render();
  }catch(e){$("notice").textContent=e.message||"保存できませんでした。";}
});
document.addEventListener("change",event=>{
  const id=event.target.dataset?.taskId;if(!id)return;
  try {const rows=loadTasks();if(rows===null||!taskStates.includes(event.target.value))throw Error("タスクを更新できません。");
    saveTasks(rows.map(t=>t.id===id?{...t,state:event.target.value}:t));render();
  }catch(e){$("notice").textContent=e.message||"更新できませんでした。";}
});

setInterval(refreshValidationStatus,75000);
