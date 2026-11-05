"use strict";

const $ = id => document.getElementById(id);
const esc = value => String(value ?? "").replace(/[&<>"']/g, char =>
  ({"&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;", "'":"&#39;"})[char]);
const yen = value => new Intl.NumberFormat("ja-JP", {style:"currency", currency:"JPY"}).format(value);
const today = () => new Intl.DateTimeFormat("sv-SE", {timeZone:"Asia/Tokyo"}).format(new Date());
const key = "orxelia-dashboard-v1";
const types = ["日次候補", "過去の候補", "既存プロジェクト"];
const stages = ["未確認", "未検証", "検証中", "開発中", "販売中", "収益化済み", "保留", "終了"];
const priorities = ["未設定", "高", "中", "低"];
const activityStates = ["準備中", "調査中", "試作中", "検証中", "判断待ち", "完了", "停止"];
const empty = () => ({version:1, projects:[], ledger:[], decisions:[]});
let data = empty();
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

let tab = "portfolio";
let filter = "すべて";
let date = data.projects.map(p => p.date).filter(Boolean).sort().at(-1) || today();
let month = today().slice(0,7);
let submit;

function save(next) {
  if (!readable) throw Error("保存領域を読み込めないため編集できません。");
  validate(next);
  localStorage.setItem(key, JSON.stringify(next));
  data = next;
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
  for (const d of value.decisions) {
    if (!d || !day(d.date) || !str(d.title) || !d.title.trim() || !str(d.note) ||
        !["提案","決定済み"].includes(d.status) || !str(d.source)) throw Error("経営判断の形式を確認してください。");
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
    action("編集・進捗を記録","project",p.id) + '</article>';
}

function portfolio() {
  const selected = data.projects.filter(p => filter === "すべて" || p.type === filter);
  const filters = ["すべて",...types].map(t => '<option' + (t === filter ? ' selected' : '') + '>' + t + '</option>').join("");
  return heading("事業一覧", action("＋ 事業を登録","project","",true)) +
    '<label>区分<select id="filter">' + filters + '</select></label>' +
    (selected.length ? grid(selected.map(card)) : panel('<p>この区分の登録は0件です。既存プロジェクトの名称や状況は確認できたものから登録してください。参照チャットの候補は「管理」で初期データを取り込むと表示されます。</p>'));
}

function activeQueue() {
  const priority = ["高", "中", "低", "未設定"];
  return data.projects.filter(p => ["検証中", "開発中"].includes(p.stage))
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
  const ideas = data.projects.filter(p => p.type === types[0] && p.date === date);
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
function finance() {
  const rows = data.ledger.filter(r => r.month === month);
  const revenue = rows.reduce((total,r) => total + r.revenue,0);
  const cost = rows.reduce((total,r) => total + r.cost,0);
  const records = data.projects.map(p => {
    const r = rows.find(row => row.project === p.id);
    return '<article><h3>' + esc(p.name) + '</h3>' +
      (r ? '<p>売上 ' + yen(r.revenue) + ' ／ 費用 ' + yen(r.cost) + ' ／ 利益 ' + yen(r.revenue-r.cost) +
      '</p><p>確認元　' + esc(r.evidence) + '</p>' + (r.revenue === 0 && r.cost === 0 ? badge("入力済み実績ゼロ") : '') : '<p>未登録 ／ 実績不明</p>') +
      '<div class="actions">' + action(r ? "収支を編集" : "収支を登録","ledger",p.id) +
      (r ? action("入力を削除","removeLedger",p.id) : '') + '</div></article>';
  });
  return heading("月次収支") + '<label>対象月<input id="month" type="month" value="' + esc(month) + '"></label>' +
    '<div class="metrics">' +
    [ ["売上",revenue], ["費用",cost], ["利益",revenue-cost] ].map(([title,value]) =>
      metric(title, rows.length ? yen(value) : "—", rows.length ? "入力済み " + rows.length + " / " + data.projects.length + "件の合計" : "実績未登録")).join("") +
    '</div><p>利益は入力した売上 − 費用。確認済みの月次実績だけを登録してください。</p>' +
    (records.length ? grid(records) : panel('<p>収支を入力する事業を先に登録してください。</p>'));
}

function progress() {
  const groups = new Map();
  for (const d of data.decisions) {
    if (!d.activity) continue;
    const events = groups.get(d.activity.runId) || [];
    events.push(d);
    groups.set(d.activity.runId, events);
  }
  const runs = [...groups.values()].map(events =>
    events.sort((a,b) => Date.parse(b.activity.updatedAt) - Date.parse(a.activity.updatedAt))
  ).sort((a,b) => Date.parse(b[0].activity.updatedAt) - Date.parse(a[0].activity.updatedAt));
  const running = runs.filter(events => ["準備中","調査中","試作中","検証中"].includes(events[0].activity.state)).length;
  return heading("自動作業の進捗", '<button id="sync-now" type="button">最新の報告を取得</button>') +
    panel('<p>作業中 ' + running + '件 ／ 報告された作業 ' + runs.length +
      '件。各工程を報告した時点の状態を表示します。</p><p>工程の完了数は作業の進み具合です。需要や収益の検証結果は記録本文で確認できます。</p>') +
    (runs.length ? grid(runs.map(events => {
      const d = events[0], a = d.activity;
      const stale = ["準備中","調査中","試作中","検証中"].includes(a.state) &&
        Date.now() - Date.parse(a.updatedAt) > 30 * 60 * 1000;
      const time = new Date(a.updatedAt).toLocaleString("ja-JP", {timeZone:"Asia/Tokyo",hour12:false});
      return '<article><h3>' + esc(a.task) + '</h3><div class="chips">' + badge(a.state) +
        badge(a.completed + " / " + a.steps.length + "工程完了") + '</div>' +
        '<progress max="' + a.steps.length + '" value="' + a.completed +
        '" aria-label="' + esc(a.task + "の工程進捗") + '"></progress>' +
        '<ol>' + a.steps.map((step,i) => '<li>' + esc((i < a.completed ? "完了　" : "未完了　") + step) + '</li>').join("") + '</ol>' +
        '<p>現在　' + esc(a.current || "未報告") + '</p><p>次の工程　' + esc(a.next || "なし") +
        '</p>' + (a.blocker ? '<p class="warn">待機・停止理由　' + esc(a.blocker) + '</p>' : '') +
        (stale ? '<p class="warn">30分以上、新しい報告がありません。実行状況の確認が必要です。</p>' : '') +
        '<p>最終報告　' + esc(time) + ' 日本時間</p><details><summary>報告履歴・根拠（' + events.length +
        '件）</summary>' + events.map(event => '<p>' + esc(new Date(event.activity.updatedAt).toLocaleString("ja-JP",{timeZone:"Asia/Tokyo",hour12:false})) +
        ' ／ ' + esc(event.activity.state) + '</p><p>' + esc(event.note) + '</p><p>出典　' + esc(event.source) + '</p>').join("") +
        '</details></article>';
    })) : panel('<p>作業の報告はまだありません。定期作業が進捗を送ると、ここに表示されます。</p>'));
}

function decisions() {
  return heading("経営判断", action("＋ 判断を記録","decision","",true)) +
    (data.decisions.some(d => !d.activity) ? grid(data.decisions.map((d,i) => ({d,i})).filter(({d}) => !d.activity).sort((a,b) => b.d.date.localeCompare(a.d.date)).map(({d,i}) =>
      '<article><h3>' + esc(d.title) + '</h3><div class="chips">' + badge(d.date) + badge(d.status) +
      '</div><p>' + esc(d.note) + '</p><p>出典　' + esc(d.source) + '</p>' + action("編集","decision",i) + '</article>')) :
    panel('<p>判断の記録は未登録です。</p>'));
}
function settings() {
  return heading("データ管理") + (window.orxeliaSync?.view() || "") +
    panel('<h3>初期データ・バックアップ</h3><p>初回は同梱の「初期データ.json」を読み込んでください。読み込みは現在の内容を全件置き換えます。</p>' +
      '<label>日次リンクを貼り付け<textarea id="report-link" rows="2" placeholder="取り込みリンクをここに貼り付け"></textarea></label>' + action("日次レポートを追加","reportPaste","",true) + action("JSONを書き出す","export") + '<label>JSONを読み込む<input type="file" id="import" accept=".json,application/json"></label>') +
    '<div class="head"><h3>運用条件</h3></div>' + panel('<p>初期予算上限 ¥3,000 ／ 新規固定費 ¥0。配布構成でのアプリ費用は初期・月額ともに ¥0。</p><p>ログインすると同じアカウントの端末間で同期します。毎朝7:30の定期作業は、このPCとCodexアプリの起動、ログイン済みブラウザーが必要です。工程ごとの報告は「進捗」で確認できます。会計サービスは未連携です。</p><p id="offline">オフラインの状態を確認中…</p>');
}

function render() {
  const projects = data.projects;
  const ideas = projects.filter(p => p.type === types[0] && p.date === date);
  $("metrics").innerHTML = [
    metric("日次候補", ideas.length, date + " ／ 最大10案"),
    metric("重点検証", ideas.filter(p => p.rank).length, "日次候補の内数"),
    metric("開発中", projects.filter(p => p.stage === "開発中").length, "登録ステータスの集計"),
    metric("収益化済み", projects.filter(p => p.stage === "収益化済み").length, "登録ステータスの集計")
  ].join("");
  document.querySelectorAll("[data-tab]").forEach(button => {
    if (button.dataset.tab === tab) button.setAttribute("aria-current","page");
    else button.removeAttribute("aria-current");
  });
  $("view").innerHTML = {portfolio,daily,progress,finance,decisions,settings}[tab]();
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
      const change = old ? [
        ...(old.stage !== updated.stage ? [old.stage + " → " + updated.stage] : []),
        ...(old.priority !== updated.priority ? ["優先度 " + old.priority + " → " + updated.priority] : []),
        ...(old.type !== updated.type ? [old.type + " → " + updated.type] : [])
      ] : ["事業を手動登録"];
      if (values.history) change.push(values.history);
      if (change.length) updated.history.push({date:today(),note:change.join(" ／ ")});
      save({...data,projects:old ? data.projects.map(item => item.id === id ? updated : item) : [...data.projects,updated]});
      if (isIdea && tab === "daily") date = updated.date;
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
    select("status","区分",["提案","決定済み"],old?.status || "提案") +
    area("note","判断・根拠・次の行動",old?.note), values => {
      const row = {...values,source:"利用者による手動記録"};
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
    tab = nextTab;
    $("notice").textContent = "";
    render();
  }
  try {
    if (kind === "project" || kind === "dailyProject") editProject(value,kind === "dailyProject");
    if (kind === "ledger") editLedger(value);
    if (kind === "decision") editDecision(value);
    if (kind === "export") exportData();
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
document.addEventListener("change", async event => {
  const target = event.target;
  if (target.id === "filter") filter = target.value;
  else if (["day","registered"].includes(target.id) && target.value) date = target.value;
  else if (target.id === "month" && target.value) month = target.value;
  else if (target.id === "import") {
    const file = target.files[0];
    target.value = "";
    if (!file) return;
    try {
      const next = JSON.parse((await file.text()).replace(/^\uFEFF/,""));
      validate(next);
      if (!confirm("現在のデータを置き換えます。事業 " + next.projects.length + "件を読み込みますか？")) return;
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
$("form").addEventListener("submit",event => {
  event.preventDefault();
  try {
    submit(Object.fromEntries([...new FormData(event.target)].map(([k,v]) => [k,v.trim()])));
    $("editor").close();
    $("notice").textContent = "この端末に保存しました。";
    render();
  } catch (error) {
    $("error").textContent = error.message;
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
    for (const p of incoming.projects) {
      if (projects.some(item => item.id === p.id || (item.date === p.date && item.name === p.name))) continue;
      if (projects.filter(item => item.date === p.date).length >= 10) continue;
      const rank = projects.some(item => item.date === p.date && item.rank === p.rank) ? 0 : p.rank;
      projects.push({...p,rank});
    }
    for (const d of incoming.decisions) {
      if (!decisions.some(item => item.date === d.date && item.title === d.title)) decisions.push(d);
    }
    const added = projects.length - data.projects.length;
    const proposals = decisions.length - data.decisions.length;
    save({...data,projects,decisions});
    date = incoming.projects[0]?.date || date;
    tab = incoming.decisions.some(d => d.activity) ? "progress" : "daily";
    render();
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
  async function run(credentials) {
    if (recoveryToken) return;
    if (busy || !window.ORXELIA_PUBLISHABLE_KEY || (!session && !credentials) || !readable || $("editor").open) return;
    busy = true;
    try {
      if (credentials) {
        status("ログイン中…");
        setSession(await request("/auth/v1/token?grant_type=password",{method:"POST",body:JSON.stringify(credentials)},false));
        render();
      }
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
      status("自動同期中 ／ " + new Date().toLocaleTimeString("ja-JP") + " に確認");
    } catch {
      status(credentials ? "ログインまたは接続に失敗しました。入力と通信を確認してください。" :
        "同期できませんでした。端末データは保持し、接続後に再試行します。");
    } finally {
      busy = false;
    }
  }
  function view() {
    if (!window.ORXELIA_PUBLISHABLE_KEY) return "";
    return '<div class="panel"><h3>iPhone・PCの自動同期</h3><p id="sync-status" role="status">' +
      esc(message || (session ? "接続を確認中…" : "同じアカウントで各端末からログインしてください。")) + '</p>' +
      (recoveryToken ? '<form id="sync-recovery"><label>新しいパスワード<input type="password" name="password" autocomplete="new-password" minlength="12" required></label><button class="primary">新しいパスワードを保存</button></form>' : session ? '<button id="sync-now" type="button">今すぐ同期</button>' :
        '<form id="sync-login"><label>メール<input type="email" name="email" autocomplete="username" required></label><label>パスワード<input type="password" name="password" autocomplete="current-password" required></label><button class="primary">ログインして同期</button> <button id="sync-reset" type="button">再設定メールを送る</button></form>') + '</div>';
  }
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
  document.addEventListener("click", async event => {
    if (event.target.id === "sync-reset") {
      const email = $("sync-login").elements.email;
      if (!email.reportValidity() || busy) return;
      busy = true;
      try {
        const redirect = new URL("./",location.href).href;
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
  window.addEventListener("online",() => run());
  setInterval(() => { if (!document.hidden) run(); },15000);
  setInterval(() => { if (!document.hidden && tab === "progress" && !$("editor").open) render(); },60000);
  return {run,view};
})();
window.orxeliaSync = sync;
render();
sync.run();





