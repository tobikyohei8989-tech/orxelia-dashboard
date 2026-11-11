import test from 'node:test';
import assert from 'node:assert/strict';
import {processQueuedEvent,drainQueue,reconcileDueContracts} from './worker.mjs';

const iterate=async function*(rows){yield*rows};
function setup() {
  let current={id:'sub_fixture',livemode:false,customer:'cus_fixture',status:'active',
    metadata:{app_id:'partner-link',customer_id:'company'},
    items:{data:[{price:{id:'price_fixture'},quantity:1,current_period_end:2000}]}};
  const saved=[],risks=[];
  const invoice={id:'in_fixture',currency:'jpy',amount_paid:3980,status_transitions:{paid_at:1000},
    parent:{type:'subscription_details',subscription_details:{subscription:'sub_fixture'}}};
  const stripe={
    subscriptions:{retrieve:async()=>current},
    checkout:{sessions:{retrieve:async()=>({subscription:'sub_fixture'})}},
    invoices:{retrieve:async()=>invoice,list:()=>iterate([invoice]),listLineItems:()=>iterate([{
      pricing:{price_details:{price:'price_fixture'}},parent:{type:'subscription_item_details',subscription_item_details:{proration:false}},period:{end:2000}
    }])},
    charges:{retrieve:async()=>({id:'ch_fixture',payment_intent:'pi_fixture'})},
    invoicePayments:{list:()=>iterate([{invoice:'in_fixture'}])},
    refunds:{list:()=>iterate([{id:'re_fixture',status:'succeeded',amount:1000,created:1100}])}
  };
  const store={
    ensureSubscription:async()=>({id:'contract'}),
    findSubscription:async()=>({stripe_customer_id:'cus_fixture',customer_id:'company'}),
    saveSubscription:async(previous,snapshot)=>saved.push(snapshot),
    recordRisk:async(...args)=>risks.push(args)
  };
  return {stripe,store,priceId:'price_fixture',live:false,saved,risks,
    change:value=>{current={...current,...value}}};
}
const event=(type='invoice.paid')=>({id:'evt_fixture',livemode:false,type,data:{object:{id:'in_fixture'}}});
test('checkout and subscription lifecycle notifications reconcile canonical state',async()=>{
  const context=setup();
  for (const type of ['checkout.session.completed','customer.subscription.created','invoice.paid','invoice.payment_failed','customer.subscription.deleted']) {
    context.change({status:type==='customer.subscription.deleted'?'canceled':type==='invoice.payment_failed'?'past_due':'trialing'});
    await processQueuedEvent({...context,event:event(type)});
  }
  assert.deepEqual(context.saved.map(snapshot=>snapshot.status),['trialing','trialing','trialing','past_due','canceled']);
});
test('refunds, disputes and fraud warnings retain review evidence',async()=>{
  const context=setup();
  for (const type of ['charge.refunded','charge.dispute.created','radar.early_fraud_warning.created'])
    await processQueuedEvent({...context,event:{...event(type),data:{object:{id:'ch_fixture',charge:'ch_fixture'}}}});
  assert.equal(context.risks.length,3);
  assert.deepEqual(context.risks[0][3],[{id:'re_fixture',invoice_id:'in_fixture',amount:1000,created:1100}]);
  assert.deepEqual(context.risks[1][3],[]);
});
test('mismatched environment fails before writes',async()=>{
  const context=setup();
  await assert.rejects(processQueuedEvent({...context,event:{...event(),livemode:true}}),/environment/);
  assert.equal(context.saved.length,0);
});
test('failed processing is released for retry and other events continue',async()=>{
  const context=setup(),finished=[];
  const rows=[{event_id:'evt_bad',payload:{...event(),livemode:true}},{event_id:'evt_good',payload:event()}];
  const queue={claim:async()=>rows.shift(),finish:async(row,success)=>{finished.push([row.event_id,success]);return true}};
  assert.deepEqual(await drainQueue({...context,queue}),{processed:1,failed:1});
  assert.deepEqual(finished,[['evt_bad',false],['evt_good',true]]);
});
test('unresolved risk invoice is retried rather than completed',async()=>{
  const context=setup();
  context.stripe.invoicePayments.list=()=>iterate([]);
  await assert.rejects(processQueuedEvent({...context,event:event('charge.refunded')}),/mapping/);
  assert.equal(context.risks.length,0);
});
test('periodic reconciliation attempts each selected contract even after a failure',async()=>{
  const context=setup(),attempts=[];
  context.store.listDue=async()=>[{id:'bad',stripe_subscription_id:'sub_bad'},{id:'good',stripe_subscription_id:'sub_fixture'}];
  context.store.markAttempt=async id=>attempts.push(id);
  const retrieve=context.stripe.subscriptions.retrieve;
  context.stripe.subscriptions.retrieve=async id=>id==='sub_bad' ? {...await retrieve(),livemode:true} : retrieve();
  assert.deepEqual(await reconcileDueContracts(context),{reconciled:1,failed:1});
  assert.deepEqual(attempts,['bad','good']);
});
