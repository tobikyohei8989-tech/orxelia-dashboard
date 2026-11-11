export function makeReconcileStore(db) {
  return {
    async listDue() {
      const cutoff=new Date(Date.now()-15*60*1000).toISOString();
      const {data,error}=await db.from('orxelia_billing_contracts').select('id,stripe_subscription_id')
        .not('stripe_subscription_id','is',null).not('status','in','(canceled,incomplete_expired)')
        .or('reconciliation_attempted_at.is.null,reconciliation_attempted_at.lt.'+cutoff)
        .order('reconciliation_attempted_at',{ascending:true,nullsFirst:true}).limit(3);
      if (error) throw error;
      return data;
    },
    async markAttempt(contractId) {
      const {error}=await db.from('orxelia_billing_contracts')
        .update({reconciliation_attempted_at:new Date().toISOString()}).eq('id',contractId);
      if(error)throw error;
    },
    async ensureSubscription(subscription,priceId) {
      const customerId=subscription.metadata?.customer_id;
      const stripeCustomerId=typeof subscription.customer==="string" ? subscription.customer : subscription.customer?.id;
      if (subscription.metadata?.app_id!=="partner-link" || !customerId ||
        subscription.items?.has_more || subscription.items?.data?.length!==1 ||
        subscription.items.data[0].price?.id!==priceId || subscription.items.data[0].quantity!==1)
        throw new Error('Invalid application subscription');
      const {data:customer,error}=await db.from('orxelia_billing_customers')
        .select('id').eq('id',customerId).eq('stripe_customer_id',stripeCustomerId).single();
      if (error || !customer) throw new Error('Customer mapping is missing');
      const {error:insertError}=await db.from('orxelia_billing_contracts').upsert({
        customer_id:customer.id,app_id:'partner-link',stripe_subscription_id:subscription.id,
        monthly_amount_jpy:3980,status:'incomplete'
      },{onConflict:'stripe_subscription_id',ignoreDuplicates:true});
      if (insertError) throw insertError;
      const {data:contract,error:readError}=await db.from('orxelia_billing_contracts')
        .select('id,customer_id,app_id').eq('stripe_subscription_id',subscription.id).single();
      if (readError || contract.customer_id!==customer.id || contract.app_id!=='partner-link')
        throw new Error('Contract mapping does not match');
      return contract;
    },
    async findSubscription(subscriptionId) {
      const {data:contract,error}=await db.from('orxelia_billing_contracts').select('*').eq('stripe_subscription_id',subscriptionId).maybeSingle();
      if (error) throw error;
      if (!contract) return null;
      const {data:customer,error:customerError}=await db.from('orxelia_billing_customers').select('stripe_customer_id').eq('id',contract.customer_id).single();
      if (customerError) throw customerError;
      return {...contract,revision:contract.sync_revision,stripe_customer_id:customer.stripe_customer_id};
    },
    async saveSubscription(previous,snapshot) {
      const {error}=await db.rpc('orxelia_save_subscription_snapshot',{
        p_contract_id:previous.id,p_expected_revision:previous.revision,p_snapshot:snapshot
      });
      if (error) throw error;
    },
    async recordRisk(eventId,contractId,kind,refunds) {
      const {error}=await db.rpc('orxelia_record_billing_risk',{
        p_event_id:eventId,p_contract_id:contractId,p_kind:kind,p_refunds:refunds
      });
      if (error) throw error;
    }
  };
}
