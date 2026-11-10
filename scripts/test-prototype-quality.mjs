import assert from 'node:assert/strict';
import {checkPrototypeQuality,validateReview} from './prototype-quality.mjs';
const approved={approved:true,scores:Object.fromEntries(['hierarchy','typography','spacing','contrast','mobile','completeness'].map(k=>[k,4])),issues:[]};
assert.equal(validateReview(approved),true);
assert.equal(validateReview({...approved,scores:{...approved.scores,mobile:3}}),false);
assert.equal(validateReview({...approved,issues:['Unreadable heading']}),false);
assert.equal(validateReview({approved:true}),false);
const fixture=`<!doctype html><html lang="ja"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>記録管理</title><style>body{font:16px sans-serif;margin:24px}button,input{padding:12px;max-width:100%;box-sizing:border-box}</style><h1>作業記録の管理</h1><p>日々の作業名を登録して一覧で確認できます。記録はこの端末に保存され、再読み込み後も確認できます。必要に応じてCSV形式の出力やJSON形式のバックアップができます。削除する場合は確認画面で対象を確かめてください。これは社内検証用の試作品です。</p><form data-testid="record-form"><label>作業名<input required data-testid="record-input"></label><button data-testid="record-submit">保存</button></form><div data-testid="record-list"></div><button data-testid="record-export">CSV出力</button><button data-testid="record-backup">JSON保存</button><script>
let rows=JSON.parse(localStorage.getItem('records')||'[]');const input=document.querySelector('input'),list=document.querySelector('[data-testid=record-list]');
function render(){list.replaceChildren();for(const value of rows){const item=document.createElement('div');item.dataset.testid='record-item';item.textContent=value;const b=document.createElement('button');b.dataset.testid='record-delete';b.textContent='削除';b.onclick=()=>{if(confirm('削除しますか')){rows=rows.filter(x=>x!==value);persist();}};item.append(b);list.append(item)}}
function persist(){localStorage.setItem('records',JSON.stringify(rows));render()}
document.querySelector('form').onsubmit=e=>{e.preventDefault();if(!input.value.trim())return;rows.push(input.value);persist();input.value=''};
for(const [id,extension] of [['record-export','csv'],['record-backup','json']])document.querySelector('[data-testid='+id+']').onclick=()=>{const a=document.createElement('a');a.href=URL.createObjectURL(new Blob([extension==='json'?JSON.stringify(rows):rows.join(',')]));a.download='records.'+extension;a.click()};render();
</script></html>`;
const run=(html,review,name)=>checkPrototypeQuality(html,{review,artifactDir:'build/prototype-quality/regression-'+name});
const ok=await run(fixture,async images=>{assert.equal(images.length,4);assert.ok(images.every(i=>i.length>100));return approved},'working');
assert.equal(ok.passed,true,JSON.stringify(ok.errors));
const broken=await run(fixture.replace("localStorage.setItem('records',JSON.stringify(rows));",''),async()=>approved,'broken-persistence');
assert.equal(broken.passed,false);assert.ok(broken.errors.some(e=>e.includes('Reload persistence')));
const poor=await run(fixture,async()=>({...approved,scores:{...approved.scores,contrast:2},issues:['Contrast too low']}),'poor-design');
assert.equal(poor.passed,false);
const unavailable=await run(fixture,async()=>{throw Error('Review unavailable')},'review-unavailable');
assert.equal(unavailable.passed,false);
console.log('Submission gate: working flow passes; persistence regression, poor design and unavailable review are blocked.');
