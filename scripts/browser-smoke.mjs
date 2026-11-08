import { chromium, devices } from 'playwright';
import assert from 'node:assert/strict';

const browser = await chromium.launch({headless:true});
const base='http://127.0.0.1:8765/dashboard/';
const failures=[];
for(const [name,contextOptions] of [
 ['desktop',{viewport:{width:1280,height:850}}],
 ['iPhone-like',{...devices['iPhone 13'],defaultBrowserType:undefined}]
]){
 const context=await browser.newContext({...contextOptions});
 const page=await context.newPage();
 const errors=[];
 page.on('pageerror',e=>errors.push(e.message));
 // No production database writes: block any Supabase request.
 await page.route('https://*.supabase.co/**',route=>route.fulfill({status:503,contentType:'application/json',body:'{"message":"isolated test: remote service disabled"}'}));
 await page.goto(base,{waitUntil:'domcontentloaded'});
 await page.locator('#view').waitFor({state:'visible'});
 for(const [tab,label] of [['home','ホーム'],['portfolio','事業一覧'],['verification','承認・販売'],['finance','収支'],['settings','設定']]){
  await page.locator('nav button[data-tab="'+tab+'"]').click();
  await assert.doesNotReject(async()=>{await page.locator('nav button[data-tab="'+tab+'"][aria-current]').waitFor({timeout:3000})},'navigation '+tab+' on '+name);
  assert.ok((await page.locator('#view').innerText()).trim().length>0,'empty screen '+tab);
 }
 await page.locator('nav button[data-tab="home"]').click();
 const overflow=await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+2);
 assert.ok(!overflow,'horizontal page overflow on '+name);
 assert.deepEqual(errors,[],'uncaught browser errors on '+name);
 console.log('PASS '+name+': 5 navigation screens, content, no horizontal overflow, no JS exceptions');
 await context.close();
}
await browser.close();
console.log('NOTE: mobile emulation is not a physical iPhone. Remote Supabase/Gemini requests were blocked.');
