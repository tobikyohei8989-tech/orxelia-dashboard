export function makeReconcileStore(db) {
  return {
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
    }
  };
}
