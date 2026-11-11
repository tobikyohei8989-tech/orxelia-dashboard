// All dependencies run server-side. The caller supplies only an action and a retry ID.
export function makeSessionHandler({authenticate,loadCustomer,saveCheckout,stripe,priceId,origin,checkoutEnabled=false}) {
  const accountPage=origin+"/products/partner-link/account.html";
  return async request => {
    if (request.method!=="POST") return new Response(null,{status:405});
    try {
      const user=await authenticate(request);
      if (!user) return Response.json({error:"ログインが必要です。"},{status:401});
      const {action,requestId}=await request.json();
      if (!["checkout","portal"].includes(action) ||
        !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(requestId))
        return Response.json({error:"入力が不正です。"},{status:400});
      if (action==="checkout" && !checkoutEnabled)
        return Response.json({error:"申込受付は準備中です。"},{status:503});
      const customer=await loadCustomer(user.id);
      if (!customer?.stripe_customer_id) return Response.json({error:"会社の登録処理が必要です。"},{status:409});
      const options={idempotencyKey:action+":"+customer.id+":"+requestId};
      if (action==="portal") {
        const session=await stripe.billingPortal.sessions.create({
          customer:customer.stripe_customer_id,return_url:accountPage
        },options);
        return Response.json({url:session.url});
      }
      const subscriptions=await stripe.subscriptions.list({customer:customer.stripe_customer_id,status:"all",limit:100});
      if (subscriptions.data.some(subscription=>!["canceled","incomplete_expired"].includes(subscription.status)))
        return Response.json({error:"既存の契約を確認してください。"},{status:409});
      if (!customer.checkout_attempt_id) return Response.json({error:"申込の準備が必要です。"},{status:409});
      const sessions=await stripe.checkout.sessions.list({customer:customer.stripe_customer_id,status:"open",limit:100});
      const existing=sessions.data.find(session=>session.metadata?.app_id==="partner-link");
      if (existing) return Response.json({url:existing.url});
      const price=await stripe.prices.retrieve(priceId);
      if (price.currency!=="jpy" || price.unit_amount!==3980 || price.recurring?.interval!=="month" ||
        price.recurring?.interval_count!==1 || price.tax_behavior!=="inclusive" || !price.active)
        return Response.json({error:"料金設定の確認が必要です。"},{status:503});
      const metadata={app_id:"partner-link",customer_id:customer.id};
      const subscription_data={metadata};
      // Once a subscription has existed, a new subscription does not restart the trial.
      if (!customer.trial_started_at && !subscriptions.data.length && !subscriptions.has_more)
        subscription_data.trial_period_days=30;
      const session=await stripe.checkout.sessions.create({
        mode:"subscription",customer:customer.stripe_customer_id,
        line_items:[{price:priceId,quantity:1}],payment_method_collection:"always",
        automatic_tax:{enabled:false},metadata,subscription_data,
        locale:"ja",
        custom_text:{submit:{message:(subscription_data.trial_period_days
          ? "無料期間の終了時刻より前に、Partner Linkの「契約・支払情報を管理」から解約を完了すると、初回の月額料金は請求されません。"
          : "")+"有料期間中に解約した場合、支払い済みの期間の終了まで利用できます。"}},
        success_url:accountPage+"?checkout=complete",
        cancel_url:accountPage+"?checkout=cancelled"
      },{idempotencyKey:"checkout:"+customer.id+":"+customer.checkout_attempt_id});
      await saveCheckout(customer.id,customer.checkout_attempt_id,session.id);
      return Response.json({url:session.url});
    } catch {
      return Response.json({error:"決済画面を準備できませんでした。再試行してください。"},{status:503});
    }
  };
}
