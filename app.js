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

function daily() {
  const ideas = data.projects.filter(p => p.type === types[0] && p.date === date);
  const top = ideas.filter(p => p.rank).sort((a,b) => a.rank - b.rank);
  const days = [...new Set(data.projects.map(p => p.date).filter(Boolean))].sort().reverse();
  return heading("日次レポート", action("＋ 日次候補","dailyProject","",true)) +
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
function decisions() {
  return heading("経営判断", action("＋ 判断を記録","decision","",true)) +
    (data.decisions.length ? grid(data.decisions.map((d,i) => ({d,i})).sort((a,b) => b.d.date.localeCompare(a.d.date)).map(({d,i}) =>
      '<article><h3>' + esc(d.title) + '</h3><div class="chips">' + badge(d.date) + badge(d.status) +
      '</div><p>' + esc(d.note) + '</p><p>出典　' + esc(d.source) + '</p>' + action("編集","decision",i) + '</article>')) :
    panel('<p>判断の記録は未登録です。</p>'));
}
function settings() {
  return heading("データ管理") +
    panel('<h3>初期データ・バックアップ</h3><p>初回は同梱の「初期データ.json」を読み込んでください。読み込みは現在の内容を全件置き換えます。</p>' +
      action("JSONを書き出す","export") + '<label>JSONを読み込む<input type="file" id="import" accept=".json,application/json"></label>') +
    '<div class="head"><h3>運用条件</h3></div>' + panel('<p>初期予算上限 ¥3,000 ／ 新規固定費 ¥0。配布構成でのアプリ費用は初期・月額ともに ¥0。</p><p>保存先はこの端末のブラウザーです。外部データ、会計、毎朝7:30のレポートは未連携です。別端末へは書き出したJSONを移してください。</p><p id="offline">オフラインの状態を確認中…</p>');
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
  $("view").innerHTML = {portfolio,daily,finance,decisions,settings}[tab]();
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

