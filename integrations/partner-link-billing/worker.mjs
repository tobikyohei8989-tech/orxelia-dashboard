import {reconcileSubscription} from './reconcile.mjs';
const id=value=>typeof value==="string" ? value : value?.id;
const subscriptionForInvoice=invoice=>invoice.parent?.type==="subscription_details" ? id(invoice.parent.subscription_details?.subscription) : null;
const riskTypes=new Set(['charge.refunded','charge.dispute.created','radar.early_fraud_warning.created']);

async function resolveEvent(stripe,event) {
  const object=event.data.object;
  if (event.type.startsWith('customer.subscription.')) return {subscriptions:[object.id]};
  if (event.type.startsWith('checkout.session.')) {
    const session=await stripe.checkout.sessions.retrieve(object.id);
    return {subscriptions:id(session.subscription) ? [id(session.subscription)] : []};
  }
  if (event.type.startsWith('invoice.')) {
    const invoice=await stripe.invoices.retrieve(object.id);
    return {subscriptions:subscriptionForInvoice(invoice) ? [subscriptionForInvoice(invoice)] : []};
  }
  if (!riskTypes.has(event.type)) throw new Error('Unsupported queued event');
  const charge=await stripe.charges.retrieve(event.type==='charge.refunded' ? object.id : id(object.charge));
  const paymentIntent=id(charge.payment_intent);
  if (!paymentIntent) throw new Error('Risk event requires manual invoice mapping');
  const invoices=new Map();
  for await (const payment of stripe.invoicePayments.list({
    payment:{type:'payment_intent',payment_intent:paymentIntent},status:'paid',limit:100
  })) {
    const invoice=await stripe.invoices.retrieve(id(payment.invoice));
    if (invoice.currency!=='jpy') throw new Error('Unexpected risk event currency');
    const subscription=subscriptionForInvoice(invoice);
    if (subscription) invoices.set(invoice.id,subscription);
  }
  if (!invoices.size) throw new Error('Risk event invoice mapping is missing');
  const refunds=[];
  if (event.type==='charge.refunded' && invoices.size===1) {
    for await (const refund of stripe.refunds.list({charge:charge.id,limit:100})) {
      if (refund.status==='succeeded') refunds.push({
        id:refund.id,invoice_id:invoices.keys().next().value,amount:refund.amount,created:refund.created
      });
    }
  }
  return {subscriptions:[...new Set(invoices.values())],refunds};
}

export async function processQueuedEvent({stripe,store,event,priceId,live}) {
  if (event.livemode!==live) throw new Error('Unexpected event environment');
  const resolved=await resolveEvent(stripe,event);
  for (const subscriptionId of resolved.subscriptions) {
    const subscription=await stripe.subscriptions.retrieve(subscriptionId);
    if (subscription.livemode!==live) throw new Error('Unexpected subscription environment');
    if (subscription.metadata?.app_id!=='partner-link') continue;
    const contract=await store.ensureSubscription(subscription,priceId);
    await reconcileSubscription({stripe,store,subscriptionId,priceId});
    if (riskTypes.has(event.type)) await store.recordRisk(event.id,contract.id,event.type,resolved.refunds||[]);
  }
}

export async function drainQueue({queue,...context}) {
  let processed=0,failed=0;
  for (let count=0;count<10;count++) {
    const row=await queue.claim();
    if (!row) break;
    try {
      await processQueuedEvent({...context,event:row.payload});
      if (!await queue.finish(row,true)) throw new Error('Queue lease changed');
      processed++;
    } catch {
      await queue.finish(row,false);
      failed++;
    }
  }
  return {processed,failed};
}

export async function reconcileDueContracts({stripe,store,priceId,live}) {
  let reconciled=0,failed=0;
  for(const contract of await store.listDue()){
    await store.markAttempt(contract.id);
    try {
      const current=await stripe.subscriptions.retrieve(contract.stripe_subscription_id);
      if(current.livemode!==live)throw Error('Unexpected subscription environment');
      await reconcileSubscription({stripe,store,subscriptionId:contract.stripe_subscription_id,priceId});
      reconciled++;
    }catch{failed++;}
  }
  return {reconciled,failed};
}
