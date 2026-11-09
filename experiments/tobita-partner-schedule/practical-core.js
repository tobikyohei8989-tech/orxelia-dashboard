// Calendar dates are interpreted in Japan; report boundaries are inclusive.
export function tokyoDate(now=new Date()){
 return new Intl.DateTimeFormat('sv-SE',{timeZone:'Asia/Tokyo',year:'numeric',month:'2-digit',day:'2-digit'}).format(now);
}
const pad=n=>String(n).padStart(2,'0');
export function closingMonth(now=new Date()){
 const [y,m,d]=tokyoDate(now).split('-').map(Number);const next=new Date(Date.UTC(y,m-1+(d>20?1:0),1));
 return next.getUTCFullYear()+'-'+pad(next.getUTCMonth()+1);
}
export function reportPeriod(mode,month,year){
 if(mode==='annual'){
  const y=Number(year);return Number.isInteger(y)&&y>=2000&&y<=2100?{from:`${y}-01-01`,to:`${y}-12-31`,label:`${y}年（1/1〜12/31）`}:null;
 }
 if(!/^\d{4}-(0[1-9]|1[0-2])$/.test(month||''))return null;
 const [y,m]=month.split('-').map(Number);if(y<2000||y>2100)return null;
 const previous=new Date(Date.UTC(y,m-2,21));
 return {from:previous.getUTCFullYear()+'-'+pad(previous.getUTCMonth()+1)+'-21',to:month+'-20',label:`${y}年${m}月20日締め`};
}
export function pendingAlert(r,now=new Date()){
 if(r.status!=='pending')return '';
 const today=tokyoDate(now);
 if(r.work_date<today)return '作業日を過ぎた未回答';
 if(r.work_date===today)return '本日の未回答';
 const age=now.getTime()-Date.parse(r.created_at);
 return age>=86400000?'24時間以上未回答（'+Math.floor(age/3600000)+'時間）':'';
}
export function mapUrl(place){return String(place||'').trim()?'https://www.google.com/maps/search/?api=1&query='+encodeURIComponent(String(place).trim()):'';}
export function summarizeWork(requests,attendance,workers,period,today=tokyoDate()){
 if(!period)return {rows:[],details:[],planned:0,actual:0,missing:0};
 const byId=new Map(attendance.map(a=>[a.request_id,a]));const groups=new Map();
 const details=requests.filter(r=>r.status==='confirmed'&&r.work_date>=period.from&&r.work_date<=period.to).sort((a,b)=>a.work_date.localeCompare(b.work_date)||String(a.id).localeCompare(String(b.id))).map(r=>{
  const a=byId.get(r.id);const planned=Number(r.headcount??1)*(r.slot==='all'?1:.5);const actual=a?Number(a.full_count)+Number(a.half_count)*.5:null;
  const missing=!a&&r.work_date<=today;const name=workers.find(w=>w.user_id===r.worker_id)?.display_name||'パートナー';
  const row=groups.get(r.worker_id)||{workerId:r.worker_id,name,planned:0,actual:0,missing:0,count:0};
  row.planned+=planned;row.actual+=actual??0;row.missing+=missing?1:0;row.count++;groups.set(r.worker_id,row);
  return {request:r,attendance:a,name,planned,actual,missing};
 });
 const rows=[...groups.values()].sort((a,b)=>a.name.localeCompare(b.name,'ja'));
 return {rows,details,planned:rows.reduce((n,r)=>n+r.planned,0),actual:rows.reduce((n,r)=>n+r.actual,0),missing:rows.reduce((n,r)=>n+r.missing,0)};
}
export function csvCell(value){const raw=String(value??'');const safe=/^[\s]*[=+\-@]/.test(raw)?"'"+raw:raw;return '"'+safe.replaceAll('"','""')+'"';}
export function makeCsv(rows){return '\ufeff'+rows.map(row=>row.map(csvCell).join(',')).join('\r\n');}
