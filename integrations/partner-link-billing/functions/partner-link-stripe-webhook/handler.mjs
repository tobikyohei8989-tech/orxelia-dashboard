// Verified snapshot events are durably queued; provisioning is a separate worker.
export const acceptedEvents = new Set([
  'checkout.session.completed', 'checkout.session.async_payment_succeeded',
  'customer.subscription.created', 'customer.subscription.updated',
  'customer.subscription.deleted', 'customer.subscription.trial_will_end',
  'invoice.paid', 'invoice.payment_failed',
  'charge.dispute.created', 'charge.refunded', 'radar.early_fraud_warning.created',
]);
const response = (status, body) => Response.json(body, {status});
export function makeHandler({verify, save, configured, expectedAccount, live = true}) {
  return async request => {
    if (request.method !== 'POST') return response(405, {error: 'POST required'});
    if (!configured()) return response(503, {error: 'Webhook configuration pending'});
    const signature = request.headers.get('stripe-signature');
    if (!signature) return response(400, {error: 'Signature required'});
    if (Number(request.headers.get('content-length') || 0) > 1048576)
      return response(413, {error: 'Payload too large'});
    let event;
    try {
      const raw = await request.text();
      if (new TextEncoder().encode(raw).length > 1048576)
        return response(413, {error: 'Payload too large'});
      event = await verify(raw, signature);
    } catch { return response(400, {error: 'Invalid signature or payload'}); }
    if (event.livemode !== live || (event.account && event.account !== expectedAccount))
      return response(400, {error: 'Unexpected account or environment'});
    if (!acceptedEvents.has(event.type)) return response(200, {received: true, ignored: true});
    if (!/^evt_/.test(event.id || '') || !Number.isInteger(event.created) || !event.data?.object)
      return response(400, {error: 'Invalid event'});
    try {
      await save({event_id: event.id, event_type: event.type, stripe_created: event.created,
        livemode: event.livemode, payload: event});
      return response(200, {received: true, queued: true});
    } catch { return response(500, {error: 'Event storage unavailable'}); }
  };
}
