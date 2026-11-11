import Stripe from 'npm:stripe@23.0.0';
import {createClient} from 'npm:@supabase/supabase-js@2.95.0';
import {makeHandler} from './handler.mjs';

const key = Deno.env.get('PARTNER_LINK_STRIPE_SECRET_KEY') || '';
const signingSecret = Deno.env.get('PARTNER_LINK_STRIPE_WEBHOOK_SECRET') || '';
const dbKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';
const billingMode = Deno.env.get('PARTNER_LINK_BILLING_MODE') || 'live';
const expectedAccount = Deno.env.get('PARTNER_LINK_STRIPE_ACCOUNT') || (billingMode==='live' ? 'acct_1Ua8RjIcxIrtGLMu' : '');
const workerToken = Deno.env.get('PARTNER_LINK_BILLING_WORKER_TOKEN') || '';
const stripe = key ? new Stripe(key, {httpClient: Stripe.createFetchHttpClient()}) : null;
const db = createClient(Deno.env.get('SUPABASE_URL')!, dbKey, {
  auth: {persistSession: false, autoRefreshToken: false},
});
Deno.serve(makeHandler({
  expectedAccount,
  live: billingMode === 'live',
  configured: () => Boolean(stripe && signingSecret && dbKey && expectedAccount && ['live','test'].includes(billingMode)),
  verify: (raw: string, signature: string) => stripe!.webhooks.constructEventAsync(
    raw, signature, signingSecret, 300, Stripe.createSubtleCryptoProvider()),
  save: async (row: Record<string, unknown>) => {
    const {error} = await db.from('partner_link_stripe_events')
      .upsert(row, {onConflict: 'event_id', ignoreDuplicates: true});
    if (error) throw new Error('Event persistence failed');
    if (workerToken) EdgeRuntime.waitUntil(fetch(
      Deno.env.get('SUPABASE_URL')+'/functions/v1/partner-link-billing-worker',
      {method:'POST',headers:{authorization:'Bearer '+workerToken}}
    ).then(response=>{if(!response.ok)console.warn('Billing worker retry required');})
      .catch(()=>console.warn('Billing worker is unavailable')));
  },
}));
