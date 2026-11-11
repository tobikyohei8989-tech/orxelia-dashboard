begin;
create table public.orxelia_partner_link_tenants(
  owner_id uuid primary key references auth.users(id),
  customer_id uuid not null unique references public.orxelia_billing_customers(id)
);
alter table public.orxelia_partner_link_tenants enable row level security;
revoke all on public.orxelia_partner_link_tenants from public,anon,authenticated;
grant select,insert on public.orxelia_partner_link_tenants to service_role;
create table public.orxelia_partner_link_branding(
  owner_id uuid primary key references public.orxelia_partner_link_tenants(owner_id),
  company_line1 text not null default '',
  company_line2 text not null,
  logo_data text
);
alter table public.orxelia_partner_link_branding enable row level security;
revoke all on public.orxelia_partner_link_branding from public,anon,authenticated;

create function public.orxelia_register_partner_company(p_name text)
returns uuid language plpgsql security definer set search_path='' as $$
declare customer uuid;
begin
  if auth.uid() is null then raise exception 'ログインが必要です。'; end if;
  if not exists(select 1 from auth.users where id=auth.uid() and email_confirmed_at is not null) then
    raise exception 'メールアドレスの確認を完了してください。';
  end if;
  if exists(select 1 from public.tobita_match_members where user_id=auth.uid())
    and not exists(select 1 from public.orxelia_partner_link_tenants where owner_id=auth.uid()) then
    raise exception '登録済みの社内アカウントは、そのままご利用ください。';
  end if;
  customer=public.orxelia_register_billing_customer(p_name);
  insert into public.orxelia_partner_link_tenants(owner_id,customer_id)
    values(auth.uid(),customer) on conflict do nothing;
  if not exists(select 1 from public.orxelia_partner_link_tenants where owner_id=auth.uid() and customer_id=customer) then
    raise exception '会社の対応情報を確認してください。';
  end if;
  insert into public.tobita_match_members(user_id,owner_id,role,display_name)
    values(auth.uid(),auth.uid(),'admin',btrim(p_name)) on conflict do nothing;
  if not exists(select 1 from public.tobita_match_members where user_id=auth.uid() and owner_id=auth.uid() and role='admin') then
    raise exception '会社の管理者登録を確認してください。';
  end if;
  return customer;
end $$;
revoke all on function public.orxelia_register_partner_company(text) from public,anon;
grant execute on function public.orxelia_register_partner_company(text) to authenticated;

create function public.orxelia_partner_link_allowed(p_owner uuid)
returns boolean language sql stable security definer set search_path='' as $$
  select exists(select 1 from public.tobita_match_members where user_id=(select auth.uid()) and owner_id=p_owner)
  and (
    not exists(select 1 from public.orxelia_partner_link_tenants where owner_id=p_owner)
    or coalesce(
      (select o.action='allow' from public.orxelia_billing_access_overrides o
        join public.orxelia_partner_link_tenants t on t.customer_id=o.customer_id
        where t.owner_id=p_owner and o.app_id='partner-link' and o.starts_at<=now() and o.ends_at>now()
        order by o.id desc limit 1),
      exists(select 1 from public.orxelia_billing_contracts c
        join public.orxelia_partner_link_tenants t on t.customer_id=c.customer_id
        where t.owner_id=p_owner and c.app_id='partner-link'
          and public.orxelia_billing_access(c,now()) in ('active','trial','grace'))
    )
  )
$$;
revoke all on function public.orxelia_partner_link_allowed(uuid) from public,anon;
grant execute on function public.orxelia_partner_link_allowed(uuid) to authenticated;

create function public.orxelia_partner_link_billing_status()
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare member public.tobita_match_members;
begin
  if auth.uid() is null then raise exception 'ログインが必要です。'; end if;
  select * into member from public.tobita_match_members where user_id=auth.uid();
  if not found then return jsonb_build_object('registered',false); end if;
  return jsonb_build_object('registered',true,'managed',
    exists(select 1 from public.orxelia_partner_link_tenants where owner_id=member.owner_id),
    'has_open_contract',exists(select 1 from public.orxelia_billing_contracts c
      join public.orxelia_partner_link_tenants t on t.customer_id=c.customer_id
      where t.owner_id=member.owner_id and c.app_id='partner-link' and c.status not in ('canceled','incomplete_expired')),
    'allowed',public.orxelia_partner_link_allowed(member.owner_id),'admin',member.role='admin');
end $$;
revoke all on function public.orxelia_partner_link_billing_status() from public,anon;
grant execute on function public.orxelia_partner_link_billing_status() to authenticated;

create function public.orxelia_partner_link_brand()
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare owner uuid; result jsonb;
begin
  select owner_id into owner from public.tobita_match_members where user_id=auth.uid();
  if owner is null then return jsonb_build_object('company_line1','','company_line2','Partner Link','logo_data',null); end if;
  if exists(select 1 from public.orxelia_partner_link_tenants where owner_id=owner) then
    select to_jsonb(b)-'owner_id' into result from public.orxelia_partner_link_branding b where b.owner_id=owner;
    if result is null then
      select jsonb_build_object('company_line1','','company_line2',c.name,'logo_data',null) into result
        from public.orxelia_billing_customers c join public.orxelia_partner_link_tenants t on t.customer_id=c.id where t.owner_id=owner;
    end if;
  else
    select to_jsonb(b)-'id'-'updated_at' into result from public.tobita_match_branding b where id=1;
  end if;
  return result;
end $$;
revoke all on function public.orxelia_partner_link_brand() from public;
grant execute on function public.orxelia_partner_link_brand() to anon,authenticated;

create function public.orxelia_save_partner_link_brand(p_line1 text,p_line2 text,p_logo text)
returns jsonb language plpgsql security definer set search_path='' as $$
begin
  if not exists(select 1 from public.tobita_match_members where user_id=auth.uid() and owner_id=auth.uid() and role='admin')
    or public.orxelia_partner_link_allowed(auth.uid()) is distinct from true then raise exception '自社の管理者として利用状態を確認してください。'; end if;
  if coalesce(length(p_line1),0)>100 or coalesce(length(p_line2),0)>100 or
    length(btrim(coalesce(p_line1,'')||coalesce(p_line2,'')))=0 or
    (p_logo is not null and (length(p_logo)>150000 or p_logo !~ '^data:image/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$')) then
    raise exception '会社名とロゴの形式を確認してください。';
  end if;
  if exists(select 1 from public.orxelia_partner_link_tenants where owner_id=auth.uid()) then
    insert into public.orxelia_partner_link_branding values(auth.uid(),coalesce(p_line1,''),coalesce(p_line2,''),p_logo)
      on conflict(owner_id) do update set company_line1=excluded.company_line1,company_line2=excluded.company_line2,logo_data=excluded.logo_data;
  else
    update public.tobita_match_branding set company_line1=coalesce(p_line1,''),company_line2=coalesce(p_line2,''),logo_data=p_logo,updated_at=now() where id=1;
  end if;
  return public.orxelia_partner_link_brand();
end $$;
revoke all on function public.orxelia_save_partner_link_brand(text,text,text) from public,anon;
grant execute on function public.orxelia_save_partner_link_brand(text,text,text) to authenticated;

create function public.orxelia_partner_link_write_guard()
returns trigger language plpgsql security definer set search_path='' as $$
declare value jsonb; owner uuid; old_owner uuid;
begin
  if auth.uid() is null and (current_setting('role',true)='service_role' or session_user in ('postgres','supabase_admin')) then
    if tg_op='DELETE' then return old; else return new; end if;
  end if;
  if tg_op<>'INSERT' then
    value=to_jsonb(old);
    old_owner=(value->>'owner_id')::uuid;
    if old_owner is null then select owner_id into old_owner from public.tobita_match_requests where id=(value->>'request_id')::uuid; end if;
    if public.orxelia_partner_link_allowed(old_owner) is distinct from true then raise exception '契約の利用状態を確認してください。'; end if;
  end if;
  if tg_op<>'DELETE' then
    value=to_jsonb(new);
    owner=(value->>'owner_id')::uuid;
    if owner is null then select owner_id into owner from public.tobita_match_requests where id=(value->>'request_id')::uuid; end if;
    if public.orxelia_partner_link_allowed(owner) is distinct from true then raise exception '契約の利用状態を確認してください。'; end if;
    return new;
  end if;
  return old;
end $$;
revoke all on function public.orxelia_partner_link_write_guard() from public,anon,authenticated;

-- Existing ownership policies still apply alongside these additional contract checks.
create policy partner_contract_access on public.tobita_match_requests as restrictive
  for select to authenticated using(public.orxelia_partner_link_allowed(owner_id));
create policy partner_contract_access on public.tobita_match_availability as restrictive
  for select to authenticated using(public.orxelia_partner_link_allowed(owner_id));
create policy partner_contract_access on public.tobita_match_events as restrictive
  for select to authenticated using(public.orxelia_partner_link_allowed(owner_id));
create policy partner_contract_access on public.tobita_match_invites as restrictive
  for select to authenticated using(public.orxelia_partner_link_allowed(owner_id));
create policy partner_contract_access on public.tobita_match_attendance as restrictive
  for select to authenticated using(exists(select 1 from public.tobita_match_requests r
    where r.id=request_id and public.orxelia_partner_link_allowed(r.owner_id)));
create policy partner_contract_access on public.tobita_match_attendance_history as restrictive
  for select to authenticated using(exists(select 1 from public.tobita_match_requests r
    where r.id=request_id and public.orxelia_partner_link_allowed(r.owner_id)));

create trigger partner_contract_write before insert or update or delete on public.tobita_match_requests
  for each row execute function public.orxelia_partner_link_write_guard();
create trigger partner_contract_write before insert or update or delete on public.tobita_match_availability
  for each row execute function public.orxelia_partner_link_write_guard();
create trigger partner_contract_write before insert or update or delete on public.tobita_match_events
  for each row execute function public.orxelia_partner_link_write_guard();
create trigger partner_contract_write before insert or update or delete on public.tobita_match_invites
  for each row execute function public.orxelia_partner_link_write_guard();
create trigger partner_contract_write before insert or update or delete on public.tobita_match_attendance
  for each row execute function public.orxelia_partner_link_write_guard();
create trigger partner_contract_write before insert or update or delete on public.tobita_match_attendance_history
  for each row execute function public.orxelia_partner_link_write_guard();
commit;
