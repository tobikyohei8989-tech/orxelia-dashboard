import {chromium} from 'playwright';
import assert from 'node:assert/strict';
import {mkdir} from 'node:fs/promises';

const browser=await chromium.launch({headless:true,...(process.env.CHROMIUM_PATH?{executablePath:process.env.CHROMIUM_PATH}:{}),args:['--no-sandbox']});
await mkdir('build/dashboard-reliability',{recursive:true});
try{
 for(const width of [390,1280]){
  const context=await browser.newContext({viewport:{width,height:900}});
  await context.addInitScript(()=>localStorage.setItem('orxelia-sync-session',JSON.stringify({access_token:'synthetic',expires_at:Date.now()/1000+3600,user:{id:'synthetic-owner'}})));
  const page=await context.newPage();
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  let mode='success';const calls=[];
  await page.route('https://*.supabase.co/**',async route=>{
   const req=route.request();
   if(req.url().includes('/rpc/orxelia_set_proposal_priority')){
    calls.push({method:req.method(),body:req.postDataJSON()});
    if(mode==='network')return route.abort('failed');
   if(mode==='forbidden')return route.fulfill({status:403,json:{message:'permission denied'}});
   if(mode==='expired')return route.fulfill({status:401,json:{message:'expired token'}});
   if(mode==='missing')return route.fulfill({status:404,json:{code:'PGRST202'}});
    if(mode==='invalid')return route.fulfill({json:[]});
    return route.fulfill({json:[{id:'a',brief:{priority_rank:2}},{id:'b',brief:{priority_rank:1}}]});
   }
   assert.equal(req.method(),'GET','unexpected write outside priority RPC');
   await route.fulfill({json:[]});
  });
  await page.goto('http://127.0.0.1:8765/dashboard/',{waitUntil:'networkidle'});
  const seed=()=>page.evaluate(()=>{
   orxeliaTrialProposals=[{id:'a',title:'見積もり追客',brief:{priority_rank:1},status:'failed',error_message:'Error: Gemini unavailable: gemini HTTP 503'},
    {id:'b',title:'設備点検の期限管理',brief:{priority_rank:2},status:'revision_requested',error_message:'Gemini revision retry scheduled: Error: Gemini unavailable: gemini HTTP 503'}];
   tab='verification';render();
  });
  await seed();
  page.on('dialog',dialog=>dialog.accept());
  await page.selectOption('#orxelia-priority-select','b');
  await page.getByText('「設備点検の期限管理」を最優先に保存しました。',{exact:true}).waitFor();
  assert.deepEqual(calls[0],{method:'POST',body:{p_id:'b'}});
  assert.equal(await page.locator('#orxelia-priority-select').inputValue(),'b');
  for(const [failure,message] of [['forbidden','保存する権限を確認できません'],['expired','ログインの有効期限が切れています'],['missing','保存機能を利用できません'],['network','保存結果を確認できませんでした'],['invalid','保存結果を確認できませんでした']]){
   mode=failure;await seed();
   await page.selectOption('#orxelia-priority-select','b');
   await page.getByText(message,{exact:false}).waitFor();
   assert.equal(await page.locator('#orxelia-priority-select').inputValue(),'a');
   assert.equal(await page.locator('#orxelia-priority-select').isEnabled(),true);
  }
  await page.locator('.proposal-item > summary').first().click();
  await page.locator('.proposal-item > summary').nth(1).click();
  await page.getByText('Geminiの復旧を待って再試行します',{exact:true}).waitFor();
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+2),false);
  assert.deepEqual(errors,[]);
  await page.screenshot({path:`build/dashboard-reliability/${width}.png`,fullPage:true});
  console.log(`PASS ${width}px: atomic RPC success, 401/403/missing RPC/network/invalid response, selection preserved, retry notice, no overflow or uncaught errors`);
  await context.close();
 }
}finally{await browser.close();}
