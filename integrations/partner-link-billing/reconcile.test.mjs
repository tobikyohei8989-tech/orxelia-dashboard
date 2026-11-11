import test from 'node:test';
import assert from 'node:assert/strict';
import {reconcileSubscription} from './reconcile.mjs';
const subscription={customer:'cus_test',status:'active',metadata:{customer_id:'company',app_id:'partner-link'},
  items:{data:[{price:{id:'price_test'},quantity:1,current_period_end:2000}]}};
const line={pricing:{price_details:{price:'price_test'}},parent:{type:'subscription_item_details',subscription_item_details:{proration:false}},period:{end:2000}};
const invoice={id:'in_test',currency:'jpy',amount_paid:3980,status_transitions:{paid_at:1000}};
const iterate=async function*(rows){yield* rows};
function setup(state=subscription) {
  let saved;
  return {
    stripe:{subscriptions:{retrieve:async()=>state},invoices:{list:()=>iterate([invoice]),listLineItems:()=>iterate([line])}},
    store:{findSubscription:async()=>({customer_id:'company',stripe_customer_id:'cus_test',revision:2}),
      saveSubscription:async(previous,value)=>{assert.equal(previous.revision,2);saved=value}},
    subscriptionId:'sub_test',priceId:'price_test',get saved(){return saved}
  };
}
test('reconciliation reads current Stripe state and paid line periods',async()=>{
  const context=setup();
  const result=await reconcileSubscription(context);
  assert.equal(result.paid_until,2000);
  assert.equal(result.status,'active');
  assert.deepEqual(result.payments,[{id:'in_test',amount:3980,paid_at:1000}]);
});
test('late notifications use canceled canonical state',async()=>{
  const context=setup({...subscription,status:'canceled'});
  assert.equal((await reconcileSubscription(context)).status,'canceled');
});
test('foreign customer and unexpected price are rejected before storage',async()=>{
  for (const value of [{...subscription,customer:'cus_foreign'},{...subscription,items:{data:[{price:{id:'price_wrong'},quantity:1}]}}]) {
    const context=setup(value);
    await assert.rejects(reconcileSubscription(context),/does not match/);
    assert.equal(context.saved,undefined);
  }
});
test('write conflicts propagate so queued notification can be retried',async()=>{
  const context=setup();
  context.store.saveSubscription=async()=>{throw Error('revision conflict')};
  await assert.rejects(reconcileSubscription(context),/revision conflict/);
});
