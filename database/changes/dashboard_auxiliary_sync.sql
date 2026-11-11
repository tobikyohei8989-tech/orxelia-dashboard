begin;
create table public.orxelia_auxiliary_workspace (
  owner_id uuid primary key references auth.users(id),
  revision bigint not null default 1,
  snapshot jsonb not null,
  updated_at timestamptz not null default now()
);
alter table public.orxelia_auxiliary_workspace enable row level security;
revoke all on public.orxelia_auxiliary_workspace from public,anon,authenticated;
grant select on public.orxelia_auxiliary_workspace to authenticated;
create policy auxiliary_owner on public.orxelia_auxiliary_workspace
  for select to authenticated using (owner_id=(select auth.uid()));
create function public.orxelia_save_auxiliary_workspace(p_previous bigint,p_snapshot jsonb)
returns bigint language plpgsql security definer set search_path='' as $$
declare saved bigint;
begin
  if auth.uid() is null then raise exception 'ログインが必要です。'; end if;
  if jsonb_typeof(p_snapshot) is distinct from 'object'
    or jsonb_typeof(p_snapshot->'sales') is distinct from 'array'
    or jsonb_typeof(p_snapshot->'tasks') is distinct from 'array'
    or jsonb_typeof(p_snapshot->'evidence') is distinct from 'array'
    or octet_length(p_snapshot::text)>2000000 then
    raise exception '同期データの形式またはサイズが不正です。';
  end if;
  if p_previous is null then
    insert into public.orxelia_auxiliary_workspace(owner_id,snapshot)
      values (auth.uid(),p_snapshot) on conflict do nothing returning revision into saved;
  else
    update public.orxelia_auxiliary_workspace set snapshot=p_snapshot,revision=revision+1,updated_at=now()
      where owner_id=auth.uid() and revision=p_previous returning revision into saved;
  end if;
  if saved is null then raise exception '別の端末で更新されました。取得し直してください。'; end if;
  return saved;
end $$;
revoke all on function public.orxelia_save_auxiliary_workspace(bigint,jsonb) from public,anon;
grant execute on function public.orxelia_save_auxiliary_workspace(bigint,jsonb) to authenticated;
commit;
