begin;

create table public.orxelia_billing_admins (
  user_id uuid primary key references auth.users(id)
);
create table public.orxelia_billing_customers (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(btrim(name)) > 0),
  contact_name text,
  contact_email text,
  created_at timestamptz not null default now()
);
create table public.orxelia_billing_members (
  customer_id uuid not null references public.orxelia_billing_customers(id),
  user_id uuid not null references auth.users(id),
  primary key (customer_id,user_id)
);
create table public.orxelia_billing_access_overrides (
  id bigint generated always as identity primary key,
  customer_id uuid not null references public.orxelia_billing_customers(id),
  app_id text not null,
  action text not null check (action in ('allow','stop')),
  reason text not null check (length(btrim(reason)) > 0),
  actor_id uuid not null references auth.users(id),
  starts_at timestamptz not null default now(),
  ends_at timestamptz not null check (ends_at > starts_at)
);
create index orxelia_billing_overrides_customer_app
  on public.orxelia_billing_access_overrides(customer_id,app_id,id desc);
create table public.orxelia_billing_contracts (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references public.orxelia_billing_customers(id),
  app_id text not null,
  stripe_subscription_id text unique,
  monthly_amount_jpy integer not null check (monthly_amount_jpy >= 0),
  status text not null check (status in ('trialing','active','past_due','unpaid','incomplete','incomplete_expired','canceled','paused')),
  trial_until timestamptz,
  paid_until timestamptz,
  grace_until timestamptz,
  cancel_at timestamptz,
  review_required boolean not null default false
);
create index orxelia_billing_contracts_customer_app
  on public.orxelia_billing_contracts(customer_id, app_id);
create table public.orxelia_billing_payments (
  stripe_payment_id text primary key,
  contract_id uuid not null references public.orxelia_billing_contracts(id),
  paid_jpy integer not null check (paid_jpy > 0),
  paid_at timestamptz not null
);
create table public.orxelia_billing_refunds (
  stripe_refund_id text primary key,
  stripe_payment_id text not null references public.orxelia_billing_payments(stripe_payment_id),
  refunded_jpy integer not null check (refunded_jpy > 0),
  refunded_at timestamptz not null
);

alter table public.orxelia_billing_admins enable row level security;
alter table public.orxelia_billing_customers enable row level security;
alter table public.orxelia_billing_members enable row level security;
alter table public.orxelia_billing_access_overrides enable row level security;
alter table public.orxelia_billing_contracts enable row level security;
alter table public.orxelia_billing_payments enable row level security;
alter table public.orxelia_billing_refunds enable row level security;
revoke all on public.orxelia_billing_admins, public.orxelia_billing_customers,
  public.orxelia_billing_members, public.orxelia_billing_access_overrides, public.orxelia_billing_contracts,
  public.orxelia_billing_payments, public.orxelia_billing_refunds from public, anon, authenticated;
grant select, insert, update on public.orxelia_billing_customers, public.orxelia_billing_contracts,
  public.orxelia_billing_payments, public.orxelia_billing_refunds to service_role;
grant select, insert, delete on public.orxelia_billing_members to service_role;
grant select, insert on public.orxelia_billing_access_overrides to service_role;

create function public.orxelia_billing_access(
  p_contract public.orxelia_billing_contracts, p_at timestamptz
) returns text language sql immutable security invoker set search_path = '' as $$
  select case
    when p_contract.status in ('incomplete','incomplete_expired') then 'pending'
    when p_contract.status in ('canceled','unpaid','paused') or p_contract.cancel_at <= p_at then 'stopped'
    when p_contract.status = 'trialing' and p_contract.trial_until > p_at then 'trial'
    when p_contract.status in ('active','past_due') and p_contract.paid_until > p_at then 'active'
    when p_contract.status = 'past_due' and p_contract.paid_until is not null and p_contract.grace_until > p_at then 'grace'
    else 'stopped' end
$$;
revoke all on function public.orxelia_billing_access(public.orxelia_billing_contracts,timestamptz) from public, anon, authenticated;
grant execute on function public.orxelia_billing_access(public.orxelia_billing_contracts,timestamptz) to service_role;

create function public.orxelia_has_app_access(p_customer_id uuid, p_app_id text)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.orxelia_billing_members
    where customer_id=p_customer_id and user_id=(select auth.uid())
  ) and coalesce(
    (select action='allow' from public.orxelia_billing_access_overrides
      where customer_id=p_customer_id and app_id=p_app_id and starts_at<=now() and ends_at>now()
      order by id desc limit 1),
    exists (select 1 from public.orxelia_billing_contracts c
      where c.customer_id=p_customer_id and c.app_id=p_app_id
        and public.orxelia_billing_access(c,now()) in ('active','trial','grace'))
  )
$$;
revoke all on function public.orxelia_has_app_access(uuid,text) from public, anon;
grant execute on function public.orxelia_has_app_access(uuid,text) to authenticated;

create function public.orxelia_billing_overview()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  period_start timestamptz := date_trunc('month', now() at time zone 'Asia/Tokyo') at time zone 'Asia/Tokyo';
  period_end timestamptz := (date_trunc('month', now() at time zone 'Asia/Tokyo') + interval '1 month') at time zone 'Asia/Tokyo';
begin
  if not exists(select 1 from public.orxelia_billing_admins where user_id = auth.uid()) then
    raise exception '顧客管理のアクセス権がありません。' using errcode='42501';
  end if;
  return jsonb_build_object(
    'customers', coalesce((select jsonb_agg(to_jsonb(c) order by c.name,c.id)
      from public.orxelia_billing_customers c), '[]'::jsonb),
    'contracts', coalesce((select jsonb_agg((to_jsonb(c) - 'stripe_subscription_id') ||
      jsonb_build_object('access_state',public.orxelia_billing_access(c,now()),
        'access_override', (select jsonb_build_object('id',o.id,'action',o.action,'ends_at',o.ends_at,'reason',o.reason)
          from public.orxelia_billing_access_overrides o
          where o.customer_id=c.customer_id and o.app_id=c.app_id and o.starts_at<=now() and o.ends_at>now()
          order by o.id desc limit 1)) order by c.id)
      from public.orxelia_billing_contracts c), '[]'::jsonb),
    'payments', jsonb_build_object(
      'paid_jpy', (select coalesce(sum(p.paid_jpy),0) from public.orxelia_billing_payments p
        where p.paid_at >= period_start and p.paid_at < period_end),
      'refunded_jpy', (select coalesce(sum(r.refunded_jpy),0) from public.orxelia_billing_refunds r
        where r.refunded_at >= period_start and r.refunded_at < period_end))
  );
end $$;
revoke all on function public.orxelia_billing_overview() from public, anon;
grant execute on function public.orxelia_billing_overview() to authenticated;

create function public.orxelia_admin_set_access_override(
  p_customer uuid,p_app text,p_previous bigint,p_action text,p_reason text,p_ends_at timestamptz
) returns bigint language plpgsql security definer set search_path='' as $$
declare latest bigint; saved bigint;
begin
  if not exists(select 1 from public.orxelia_billing_admins where user_id=auth.uid()) then
    raise exception '顧客管理のアクセス権がありません。' using errcode='42501';
  end if;
  perform 1 from public.orxelia_billing_customers where id=p_customer for update;
  if not found or not exists(select 1 from public.orxelia_billing_contracts where customer_id=p_customer and app_id=p_app) then
    raise exception '対象の会社とアプリの契約が見つかりません。';
  end if;
  if p_action is null or p_action not in ('allow','stop') or
    coalesce(length(btrim(p_reason)),0) not between 1 and 500 or p_ends_at is null or p_ends_at<=now() then
    raise exception '操作・理由・未来の期限を入力してください。';
  end if;
  select max(id) into latest from public.orxelia_billing_access_overrides
    where customer_id=p_customer and app_id=p_app and starts_at<=now() and ends_at>now();
  if latest is distinct from p_previous then raise exception '利用状態が更新されました。顧客データを取得し直してください。'; end if;
  insert into public.orxelia_billing_access_overrides(customer_id,app_id,action,reason,actor_id,ends_at)
    values(p_customer,p_app,p_action,btrim(p_reason),auth.uid(),p_ends_at) returning id into saved;
  return saved;
end $$;
revoke all on function public.orxelia_admin_set_access_override(uuid,text,bigint,text,text,timestamptz) from public,anon;
grant execute on function public.orxelia_admin_set_access_override(uuid,text,bigint,text,text,timestamptz) to authenticated;

commit;
