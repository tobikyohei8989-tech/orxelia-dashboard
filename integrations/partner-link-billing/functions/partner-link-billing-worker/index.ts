import Stripe from 'npm:stripe@23.0.0';
import {createClient} from 'npm:@supabase/supabase-js@2.95.0';
import {makeReconcileStore} from '../../reconcile-store.mjs';
import {drainQueue,reconcileDueContracts} from '../../worker.mjs';

const key=Deno.env.get('PARTNER_LINK_STRIPE_SECRET_KEY')||'';
const priceId=Deno.env.get('PARTNER_LINK_PRICE_ID')||'';
const token=Deno.env.get('PARTNER_LINK_BILLING_WORKER_TOKEN')||'';
const mode=Deno.env.get('PARTNER_LINK_BILLING_MODE')||'';
if (!key || !priceId || token.length<32 || !['live','test'].includes(mode))
  throw new Error('Worker configuration is incomplete');
const live=mode==='live';
if (live!==/^([sr]k)_live_/.test(key)) throw new Error('Stripe environment does not match');
const stripe=new Stripe(key,{httpClient:Stripe.createFetchHttpClient()});
const db=createClient(Deno.env.get('SUPABASE_URL')!,Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,{
  auth:{persistSession:false,autoRefreshToken:false}
});
const store=makeReconcileStore(db);
const queue={
  async claim(){
    const {data,error}=await db.rpc('partner_link_claim_stripe_event',{p_live:live});
    if (error) throw error;
    return data[0]||null;
  },
  async finish(row:{event_id:string,claim_token:string},success:boolean){
    const {data,error}=await db.rpc('partner_link_finish_stripe_event',{
      p_event_id:row.event_id,p_claim:row.claim_token,p_success:success
    });
    if (error) throw error;
    return data;
  }
};
Deno.serve(async request=>{
  if (request.method!=='POST') return new Response(null,{status:405});
  if (request.headers.get('authorization')!=='Bearer '+token) return new Response(null,{status:401});
  try {
    const price=await stripe.prices.retrieve(priceId);
    if (price.livemode!==live || !price.active || price.currency!=='jpy' || price.unit_amount!==3980 ||
      price.tax_behavior!=='inclusive' || price.recurring?.interval!=='month' || price.recurring.interval_count!==1)
      throw new Error('Price configuration does not match');
    const notifications=await drainQueue({queue,stripe,store,priceId,live});
    const reconciliation=await reconcileDueContracts({stripe,store,priceId,live});
    return Response.json({notifications,reconciliation});
  } catch {
    return Response.json({error:'契約通知の処理を開始できませんでした。'},{status:503});
  }
});
