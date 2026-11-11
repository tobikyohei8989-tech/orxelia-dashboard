begin;
alter table public.orxelia_billing_customers add column registered_by uuid unique references auth.users(id);
alter table public.orxelia_billing_customers add column stripe_customer_id text unique;
alter table public.orxelia_billing_customers add column trial_started_at timestamptz;
alter table public.orxelia_billing_customers add column checkout_attempt_id uuid not null default gen_random_uuid();
alter table public.orxelia_billing_customers add column checkout_session_id text;

create function public.orxelia_register_billing_customer(p_name text)
returns uuid language plpgsql security definer set search_path='' as $$
declare customer_id uuid;
begin
  if auth.uid() is null or coalesce(length(btrim(p_name)),0) not between 1 and 140 then
    raise exception 'ログインと会社名が必要です。';
  end if;
  insert into public.orxelia_billing_customers(name,registered_by) values (btrim(p_name),auth.uid())
    on conflict (registered_by) do nothing;
  select id into customer_id from public.orxelia_billing_customers where registered_by=auth.uid();
  insert into public.orxelia_billing_members values (customer_id,auth.uid()) on conflict do nothing;
  return customer_id;
end $$;
revoke all on function public.orxelia_register_billing_customer(text) from public,anon;
grant execute on function public.orxelia_register_billing_customer(text) to authenticated;
commit;
