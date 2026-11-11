import {createClient} from 'https://esm.sh/@supabase/supabase-js@2.95.0';
const supabase=createClient('https://yzlxcfncdtojajlhihap.supabase.co','sb_publishable_T9287hFW7tudpePLIu9c_w_9xsxTujp');
const $=id=>document.getElementById(id);
let busy=false;
let authVersion=0;
function notice(text){$('notice').textContent=text;}
async function load(){
  const {data,error}=await supabase.auth.getUser();
  if(error || !data.user){
    $('login').hidden=false;$('account').hidden=true;
    notice('メールアドレスとパスワードでログインしてください。');
    return;
  }
  $('login').hidden=true;$('account').hidden=false;$('identity').textContent=data.user.email||'ログイン済み';
  const version=authVersion;
  const result=await supabase.rpc('orxelia_partner_link_billing_status');
  if(version!==authVersion)return;
  if(result.error)throw Error('利用状態を取得できません。時間をおいて再確認してください。');
  const status=result.data;
  $('companyForm').hidden=status.registered;
  $('contract').hidden=!status.registered || !status.managed || !status.admin;
  $('checkout').hidden=!!status.has_open_contract;
  $('internal').hidden=!status.registered || status.managed;
  $('openApp').hidden=!status.allowed;
  notice(!status.registered ? '会社名を登録してください。' : status.allowed ? '手配ボードをご利用いただけます。' :
    status.admin ? '申込・支払情報をご確認ください。申込後は利用状態を再確認してください。' : '会社の管理者へ契約の利用状態をご確認ください。');
}
async function run(action){
  if(busy)return;
  busy=true;document.querySelectorAll('button').forEach(button=>button.disabled=true);
  try{await action();}catch(error){notice(error.message||'処理できませんでした。再試行してください。');}
  finally{busy=false;document.querySelectorAll('button').forEach(button=>button.disabled=false);}
}
$('loginForm').onsubmit=event=>{event.preventDefault();run(async()=>{
  const {error}=await supabase.auth.signInWithPassword({email:$('email').value.trim(),password:$('password').value});
  if(error)throw Error('メールアドレスとパスワードをご確認ください。');
  $('password').value='';await load();
})};
$('signup').onclick=()=>run(async()=>{
  if(!$('loginForm').reportValidity())return;
  if($('password').value.length<12)throw Error('新規作成のパスワードは12文字以上で設定してください。');
  const {data,error}=await supabase.auth.signUp({email:$('email').value.trim(),password:$('password').value,
    options:{emailRedirectTo:location.origin+location.pathname}});
  if(error)throw Error('アカウントを作成できませんでした。入力内容をご確認ください。');
  $('password').value='';
  if(data.session)await load();else notice('確認メールをご確認ください。認証後にこの画面へ戻り、ログインしてください。');
});
$('companyForm').onsubmit=event=>{event.preventDefault();run(async()=>{
  const {error}=await supabase.rpc('orxelia_register_partner_company',{p_name:$('company').value.trim()});
  if(error)throw Error('会社を登録できませんでした。登録済みの社内アカウントは、手配ボードからご利用ください。');
  await load();
})};
async function openBilling(action){
  const version=authVersion;
  const {data,error}=await supabase.functions.invoke('partner-link-billing-session',{body:{action,requestId:crypto.randomUUID()}});
  if(version!==authVersion)return;
  if(error)throw Error('契約画面を準備できませんでした。申込受付の状況をご確認ください。');
  const url=new URL(data.url);
  if(url.protocol!=='https:' || !['checkout.stripe.com','billing.stripe.com'].includes(url.hostname))
    throw Error('契約画面のURLを確認できませんでした。');
  location.assign(url.href);
}
$('checkout').onclick=()=>run(()=>openBilling('checkout'));
$('portal').onclick=()=>run(()=>openBilling('portal'));
$('refresh').onclick=()=>run(load);
$('logout').onclick=()=>run(async()=>{const {error}=await supabase.auth.signOut();if(error)throw error;await load();});
supabase.auth.onAuthStateChange(event=>{
  authVersion++;
  if(event==='SIGNED_OUT'){
    $('account').hidden=true;$('login').hidden=false;$('identity').textContent='';
    notice('ログアウトしました。');
  }
});
run(load);
