import test from 'node:test';
import assert from 'node:assert/strict';
import Stripe from 'stripe';
import {makeHandler} from './functions/partner-link-stripe-webhook/handler.mjs';
const stripe = new Stripe('sk_test_unit_tests_only');
const secret = 'whsec_unit_test_only';
const event = {id:'evt_fixture', type:'invoice.paid', created:1794295800, livemode:true, data:{object:{id:'in_fixture'}}};
const request = (payload=event, options={}) => {
  const raw=JSON.stringify(payload);
  const signature=stripe.webhooks.generateTestHeaderString({payload:raw, secret, ...options});
  return new Request('https://example.invalid/webhook',{method:'POST',headers:{'stripe-signature':signature},body:raw});
};
const make = overrides => makeHandler({configured:()=>true, expectedAccount:'acct_expected',
  verify:(raw,sig)=>stripe.webhooks.constructEventAsync(raw,sig,secret,300),save:async()=>{},...overrides});
test('valid event durably queued once across duplicate deliveries',async()=>{
 const rows=new Map();const handler=make({save:async row=>{if(!rows.has(row.event_id))rows.set(row.event_id,row);}});
 assert.equal((await handler(request())).status,200);
 assert.equal((await handler(request())).status,200);assert.equal(rows.size,1);
});
test('forged signature cannot write',async()=>{
 let writes=0;const handler=make({save:async()=>writes++});
 assert.equal((await handler(request(event,{secret:'whsec_wrong'}))).status,400);assert.equal(writes,0);
});
test('expired signature rejected',async()=>{
 assert.equal((await make()(request(event,{timestamp:1}))).status,400);
});
test('testmode and foreign account rejected',async()=>{
 assert.equal((await make()(request({...event,livemode:false}))).status,400);
 assert.equal((await make()(request({...event,account:'acct_foreign'}))).status,400);
});
test('database failure returns retryable error',async()=>{
 assert.equal((await make({save:async()=>{throw Error('private DB error');}})(request())).status,500);
});
test('missing configuration does not acknowledge events',async()=>{
 assert.equal((await make({configured:()=>false})(request())).status,503);
});
test('unsubscribed event acknowledged without storage',async()=>{
 let writes=0;assert.equal((await make({save:async()=>writes++})(request({...event,type:'unhandled.event'}))).status,200);assert.equal(writes,0);
});
