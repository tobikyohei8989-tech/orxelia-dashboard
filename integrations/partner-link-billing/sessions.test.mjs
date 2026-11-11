import test from 'node:test';
import assert from 'node:assert/strict';
import {makeSessionHandler} from './sessions.mjs';

const request=(action='checkout',extra={})=>new Request('https://example.test/session',{
  method:'POST',body:JSON.stringify({action,requestId:'00000000-0000-0000-0000-000000000001',...extra})
});
function setup({customer={},subscriptions=[],price={},user={id:'owner'}}={}) {
  const calls=[];
  const create=async(params,options)=>{calls.push({params,options});return {url:'https://checkout.stripe.test/fixture'}};
  const stripe={
    subscriptions:{list:async()=>({data:subscriptions,has_more:false})},
    prices:{retrieve:async()=>({active:true,currency:'jpy',unit_amount:3980,tax_behavior:'inclusive',recurring:{interval:'month',interval_count:1},...price})},
    checkout:{sessions:{list:async()=>({data:[]}),create}},
    billingPortal:{sessions:{create}}
  };
  return {calls,handler:makeSessionHandler({
    authenticate:async()=>user,loadCustomer:async id=>{assert.equal(id,'owner');return {id:'company',stripe_customer_id:'cus_fixture',checkout_attempt_id:'server-attempt',...customer}},
    saveCheckout:async()=>{},stripe,priceId:'price_fixture',origin:'https://orxelia.example'
  })};
}
test('checkout uses server customer, inclusive 3980 JPY, 30-day trial and tax off',async()=>{
  const {handler,calls}=setup();
  assert.equal((await handler(request('checkout',{customer:'attacker'}))).status,200);
  assert.equal(calls[0].params.customer,'cus_fixture');
  assert.equal(calls[0].params.subscription_data.trial_period_days,30);
  assert.equal(calls[0].params.payment_method_collection,'always');
  assert.deepEqual(calls[0].params.automatic_tax,{enabled:false});
});
test('different client retry IDs use one server checkout attempt',async()=>{
  const {handler,calls}=setup();
  await handler(request());
  await handler(request('checkout',{requestId:'00000000-0000-0000-0000-000000000002'}));
  assert.equal(calls[0].options.idempotencyKey,calls[1].options.idempotencyKey);
});
test('recontracting does not restart a free trial',async()=>{
  const {handler,calls}=setup({subscriptions:[{status:'canceled'}]});
  await handler(request());
  assert.equal(calls[0].params.subscription_data.trial_period_days,undefined);
});
test('existing unpaid contract, incorrect price and anonymous requests are blocked',async()=>{
  for (const status of ['active','trialing','past_due','unpaid','incomplete','paused']) {
    const {handler,calls}=setup({subscriptions:[{status}]});
    assert.equal((await handler(request())).status,409);
    assert.equal(calls.length,0);
  }
  assert.equal((await setup({price:{unit_amount:4000}}).handler(request())).status,503);
  assert.equal((await setup({user:null}).handler(request())).status,401);
});
test('portal uses authenticated company and fixed return URL',async()=>{
  const {handler,calls}=setup();
  assert.equal((await handler(request('portal',{customer:'attacker',return_url:'https://attacker.test'}))).status,200);
  assert.deepEqual(calls[0].params,{customer:'cus_fixture',return_url:'https://orxelia.example/products/partner-link/'});
});
