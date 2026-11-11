begin;
alter table public.partner_link_stripe_events
  add column claim_token uuid,
  add column lease_until timestamptz,
  add column retry_after timestamptz not null default now(),
  add column attempts integer not null default 0;

create function public.partner_link_claim_stripe_event(p_live boolean)
returns setof public.partner_link_stripe_events
language sql security invoker set search_path='' as $$
  update public.partner_link_stripe_events
  set claim_token=gen_random_uuid(),lease_until=now()+interval '5 minutes',attempts=attempts+1
  where event_id=(select event_id from public.partner_link_stripe_events
    where livemode=p_live and processed_at is null and retry_after<=now() and (lease_until is null or lease_until<now())
    order by received_at,event_id for update skip locked limit 1)
  returning *
$$;
create function public.partner_link_finish_stripe_event(p_event_id text,p_claim uuid,p_success boolean)
returns boolean language plpgsql security invoker set search_path='' as $$
begin
  update public.partner_link_stripe_events set
    processed_at=case when p_success then now() else null end,
    processing_error=case when p_success then null else '再照合に失敗しました。再試行待ちです。' end,
    retry_after=now()+make_interval(secs=>least(3600,power(2,least(attempts,11))::integer)),
    lease_until=null,claim_token=null
  where event_id=p_event_id and claim_token=p_claim and processed_at is null;
  return found;
end $$;
revoke all on function public.partner_link_claim_stripe_event(boolean) from public,anon,authenticated;
revoke all on function public.partner_link_finish_stripe_event(text,uuid,boolean) from public,anon,authenticated;
grant execute on function public.partner_link_claim_stripe_event(boolean) to service_role;
grant execute on function public.partner_link_finish_stripe_event(text,uuid,boolean) to service_role;

create table public.orxelia_billing_risks(
  event_id text not null,
  contract_id uuid not null references public.orxelia_billing_contracts(id),
  kind text not null,
  created_at timestamptz not null default now(),
  primary key(event_id,contract_id)
);
alter table public.orxelia_billing_risks enable row level security;
revoke all on public.orxelia_billing_risks from public,anon,authenticated;
grant select,insert on public.orxelia_billing_risks to service_role;

create function public.orxelia_record_billing_risk(p_event_id text,p_contract_id uuid,p_kind text,p_refunds jsonb)
returns void language plpgsql security invoker set search_path='' as $$
declare item jsonb;
begin
  perform 1 from public.orxelia_billing_contracts where id=p_contract_id for update;
  if not found then raise exception 'Contract not found'; end if;
  insert into public.orxelia_billing_risks values(p_event_id,p_contract_id,p_kind,now()) on conflict do nothing;
  update public.orxelia_billing_contracts set review_required=true where id=p_contract_id;
  for item in select * from jsonb_array_elements(p_refunds) loop
    if not exists (select 1 from public.orxelia_billing_payments
      where stripe_payment_id=item->>'invoice_id' and contract_id=p_contract_id) then
      raise exception 'Refund payment is not yet reconciled';
    end if;
    insert into public.orxelia_billing_refunds(stripe_refund_id,stripe_payment_id,refunded_jpy,refunded_at)
      values(item->>'id',item->>'invoice_id',(item->>'amount')::integer,to_timestamp((item->>'created')::double precision))
      on conflict(stripe_refund_id) do nothing;
    if exists(select 1 from public.orxelia_billing_refunds where stripe_refund_id=item->>'id'
      and stripe_payment_id<>item->>'invoice_id') then raise exception 'Refund ownership conflict'; end if;
  end loop;
  if exists(select 1 from public.orxelia_billing_payments p
    where p.contract_id=p_contract_id and p.paid_jpy < (
      select coalesce(sum(r.refunded_jpy),0) from public.orxelia_billing_refunds r where r.stripe_payment_id=p.stripe_payment_id
    )) then raise exception 'Refund exceeds payment'; end if;
end $$;
revoke all on function public.orxelia_record_billing_risk(text,uuid,text,jsonb) from public,anon,authenticated;
grant execute on function public.orxelia_record_billing_risk(text,uuid,text,jsonb) to service_role;
commit;
