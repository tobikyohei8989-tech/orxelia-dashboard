import Stripe from 'npm:stripe@23.0.0';
import {createClient} from 'npm:@supabase/supabase-js@2.95.0';
import {makeSessionHandler} from '../../sessions.mjs';

const origin=Deno.env.get('PARTNER_LINK_ORIGIN')||'';
const priceId=Deno.env.get('PARTNER_LINK_PRICE_ID')||'';
const key=Deno.env.get('PARTNER_LINK_STRIPE_SECRET_KEY')||'';
const endpoint=Deno.env.get('SUPABASE_URL')||'';
const serviceKey=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')||'';
if (!origin.startsWith('https://') || new URL(origin).origin!==origin || !key || !priceId || !endpoint || !serviceKey)
  throw new Error('Billing configuration is incomplete');
const stripe=new Stripe(key,{httpClient:Stripe.createFetchHttpClient()});
const db=createClient(endpoint,serviceKey,{auth:{persistSession:false,autoRefreshToken:false}});
const handler=makeSessionHandler({
  origin,priceId,stripe,
  authenticate:async(request:Request)=>{
    const token=request.headers.get('authorization')?.replace(/^Bearer /i,'');
    if (!token) return null;
    const {data,error}=await db.auth.getUser(token);
    return error ? null : data.user;
  },
  loadCustomer:async(userId:string)=>{
    const {data:customer,error}=await db.from('orxelia_billing_customers').select('*').eq('registered_by',userId).single();
    if (error || !customer) return null;
    if (!customer.stripe_customer_id) {
      const result=await stripe.customers.create({name:customer.name,metadata:{orxelia_customer_id:customer.id}},
        {idempotencyKey:'orxelia-customer:'+customer.id});
      const {error:saveError}=await db.from('orxelia_billing_customers').update({stripe_customer_id:result.id})
        .eq('id',customer.id).is('stripe_customer_id',null);
      if (saveError) throw saveError;
      customer.stripe_customer_id=result.id;
    }
    if (customer.checkout_session_id) {
      const session=await stripe.checkout.sessions.retrieve(customer.checkout_session_id);
      if (session.status==='expired' || session.status==='complete') {
        const {data,error}=await db.from('orxelia_billing_customers')
          .update({checkout_attempt_id:crypto.randomUUID(),checkout_session_id:null})
          .eq('id',customer.id).eq('checkout_attempt_id',customer.checkout_attempt_id).select('*').maybeSingle();
        if (error) throw error;
        if (data) return data;
        const latest=await db.from('orxelia_billing_customers').select('*').eq('id',customer.id).single();
        if (latest.error) throw latest.error;
        return latest.data;
      }
    }
    return customer;
  },
  saveCheckout:async(customerId:string,attemptId:string,sessionId:string)=>{
    const {data,error}=await db.from('orxelia_billing_customers').update({checkout_session_id:sessionId})
      .eq('id',customerId).eq('checkout_attempt_id',attemptId).select('id').single();
    if (error || !data) throw new Error('Checkout persistence failed');
  }
});
Deno.serve(async request=>{
  const headers={'Access-Control-Allow-Origin':origin,'Access-Control-Allow-Headers':'authorization, apikey, content-type','Access-Control-Allow-Methods':'POST, OPTIONS','Vary':'Origin'};
  if (request.method==='OPTIONS') return new Response(null,{status:204,headers});
  const response=await handler(request);
  for (const [key,value] of Object.entries(headers)) response.headers.set(key,value);
  response.headers.set('Cache-Control','no-store');
  return response;
});
