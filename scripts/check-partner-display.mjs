import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {compareWorkSchedule,tokyoDate} from '../experiments/tobita-partner-schedule/practical-core.js';
const rows=[
 {id:'late',work_date:'2026-11-12',meeting_time:'08:00'},
 {id:'early-pm',work_date:'2026-11-10',meeting_time:'13:00'},
 {id:'early-am',work_date:'2026-11-10',meeting_time:'07:30'},
 {id:'unknown',work_date:'2026-11-10',meeting_time:null},
];
for(const status of ['pending','confirmed','cancelled','declined'])assert.deepEqual(rows.map(r=>({...r,status})).sort(compareWorkSchedule).map(r=>r.id),['early-am','early-pm','unknown','late']);
assert.deepEqual(rows.map(r=>r.id),['late','early-pm','early-am','unknown']);
const html=fs.readFileSync('experiments/tobita-partner-schedule/app.html','utf8');
const start=html.indexOf('function render(){'),end=html.indexOf(" document.querySelectorAll('[data-date]')",start);
const elements=new Map();const $=id=>{if(!elements.has(id))elements.set(id,{setAttribute(){}});return elements.get(id);};
const current=tokyoDate();const [y,m]=current.split('-').map(Number);
const ctx={$,member:{role:'admin'},selected:new Set([current]),inviteToken:null,brandSettingsOpen:false,updateNotificationControls(){},paintBrand(){},dates:()=>[current],month:new Date(y,m-1,1),jpHolidays:()=>new Map(),requests:[],dayRemaining:()=>1,esc:s=>String(s),tokyoDate:()=>current};
vm.runInNewContext(html.slice(start,end)+'\n}\nrender();',ctx);
const calendar=$('calendar').innerHTML;
assert.ok(calendar.includes('aria-current="date"'));
assert.ok(calendar.includes('aria-pressed="true"'));
assert.ok(calendar.includes('today selected'));
assert.ok(calendar.includes('class="today-label">今日'));
const css=[...html.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/g)].map(x=>x[1]).join('\n');
fs.mkdirSync('build/partner-review',{recursive:true});
fs.writeFileSync('build/partner-review/calendar.html',`<!doctype html><html lang="ja"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Partner Link 日付表示の確認</title><style>${css}</style><main><h1>日付表示の確認</h1><p>架空データ。今日＝金色の枠と「今日」、選択中＝青色。</p><section class="card"><h2>${y}年${m}月</h2><div class="calendar">${calendar}</div></section></main></html>`);
console.log('PASS: chronological ordering in all progress tabs, meeting time ordering, unknown times last, JST today and selection indicators');
