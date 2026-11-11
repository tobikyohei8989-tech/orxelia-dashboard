begin;
alter table public.orxelia_billing_contracts add column sync_revision bigint not null default 0;
alter table public.orxelia_billing_contracts add column reconciled_at timestamptz;
alter table public.orxelia_billing_contracts add column reconciliation_attempted_at timestamptz;

create function public.orxelia_save_subscription_snapshot(
  p_contract_id uuid, p_expected_revision bigint, p_snapshot jsonb
) returns void language plpgsql security invoker set search_path='' as $$
declare item jsonb; saved_id uuid;
begin
  if p_snapshot->>'status' not in ('trialing','active','past_due','unpaid','incomplete','incomplete_expired','canceled','paused')
    or jsonb_typeof(p_snapshot->'payments') is distinct from 'array' then
    raise exception 'Invalid subscription snapshot';
  end if;
  update public.orxelia_billing_contracts set
    status=p_snapshot->>'status',
    trial_until=to_timestamp((p_snapshot->>'trial_until')::double precision),
    paid_until=to_timestamp((p_snapshot->>'paid_until')::double precision),
    cancel_at=to_timestamp((p_snapshot->>'cancel_at')::double precision),
    reconciled_at=now(),
    sync_revision=sync_revision+1
    where id=p_contract_id and sync_revision=p_expected_revision returning id into saved_id;
  if saved_id is null then raise exception 'Subscription revision conflict'; end if;
  for item in select * from jsonb_array_elements(p_snapshot->'payments') loop
    insert into public.orxelia_billing_payments(stripe_payment_id,contract_id,paid_jpy,paid_at)
      values (item->>'id',saved_id,(item->>'amount')::integer,to_timestamp((item->>'paid_at')::double precision))
      on conflict (stripe_payment_id) do nothing;
    if exists(select 1 from public.orxelia_billing_payments where stripe_payment_id=item->>'id' and contract_id<>saved_id) then
      raise exception 'Payment ownership conflict';
    end if;
  end loop;
  update public.orxelia_billing_customers set trial_started_at=coalesce(trial_started_at,now())
    where id=(select customer_id from public.orxelia_billing_contracts where id=saved_id)
      and p_snapshot->>'trial_until' is not null;
end $$;
revoke all on function public.orxelia_save_subscription_snapshot(uuid,bigint,jsonb) from public,anon,authenticated;
grant execute on function public.orxelia_save_subscription_snapshot(uuid,bigint,jsonb) to service_role;
commit;
