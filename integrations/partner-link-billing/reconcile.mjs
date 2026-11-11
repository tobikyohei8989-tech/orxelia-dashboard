// Read current Stripe state for every retry. Event arrival order is never used as subscription order.
export async function reconcileSubscription({stripe,store,subscriptionId,priceId}) {
  const previous=await store.findSubscription(subscriptionId);
  if (!previous) throw new Error('Subscription mapping is missing');
  const subscription=await stripe.subscriptions.retrieve(subscriptionId);
  const customer=typeof subscription.customer==="string" ? subscription.customer : subscription.customer?.id;
  if (customer!==previous.stripe_customer_id || subscription.metadata?.customer_id!==previous.customer_id ||
    subscription.metadata?.app_id!=="partner-link")
    throw new Error('Subscription ownership does not match');
  if (!subscription.items?.data?.length || subscription.items.data.some(item=>
    item.price?.id!==priceId || item.quantity!==1)) throw new Error('Subscription price does not match');
  let paidUntil=null;
  const payments=[];
  // The SDK iterator follows pagination so old paid periods are retained.
  for await (const invoice of stripe.invoices.list({subscription:subscriptionId,status:"paid",limit:100})) {
    if (invoice.currency!=="jpy" || invoice.amount_paid<=0) continue;
    for await (const line of stripe.invoices.listLineItems(invoice.id,{limit:100})) {
      if (line.pricing?.price_details?.price!==priceId || line.parent?.type!=="subscription_item_details" ||
        line.parent.subscription_item_details?.proration) continue;
      if (Number.isFinite(line.period?.end))
        paidUntil=Math.max(paidUntil||0,line.period.end);
    }
    if (!Number.isFinite(invoice.status_transitions?.paid_at)) throw new Error('Payment date is missing');
    payments.push({id:invoice.id,amount:invoice.amount_paid,paid_at:invoice.status_transitions.paid_at});
  }
  const cancelAt=subscription.cancel_at || (subscription.cancel_at_period_end ?
    Math.min(...subscription.items.data.map(item=>item.current_period_end)) : null);
  if (cancelAt!==null && !Number.isFinite(cancelAt)) throw new Error('Cancellation period is missing');
  const snapshot={
    status:subscription.status,trial_until:subscription.trial_end||null,
    paid_until:paidUntil,cancel_at:cancelAt,payments
  };
  // Implementations must save the snapshot and payment IDs atomically, and reject a stale revision.
  await store.saveSubscription(previous,snapshot);
  return snapshot;
}
