begin;

create table public.orxelia_legal_reviews (
  version bigint generated always as identity primary key,
  proposal_id uuid not null references public.orxelia_proposals(id),
  reviewer_id uuid not null,
  design_revision integer not null,
  checks jsonb not null check (jsonb_typeof(checks) = 'object'),
  risks jsonb not null check (jsonb_typeof(risks) = 'array'),
  eligible boolean not null,
  created_at timestamptz not null default now()
);
create index orxelia_legal_reviews_proposal_version
  on public.orxelia_legal_reviews (proposal_id, version desc);

alter table public.orxelia_legal_reviews enable row level security;
revoke all on public.orxelia_legal_reviews from public, anon, authenticated;
grant select on public.orxelia_legal_reviews to authenticated;
create policy legal_reviews_owner_select on public.orxelia_legal_reviews
  for select to authenticated using (exists (
    select 1 from public.orxelia_proposals p
    where p.id = proposal_id and p.owner_id = (select auth.uid())
  ));

create function public.orxelia_list_legal_review_status()
returns table (proposal_id uuid, version bigint, design_revision integer, eligible boolean)
language sql stable security invoker set search_path = '' as $$
  select distinct on (r.proposal_id) r.proposal_id, r.version, r.design_revision, r.eligible
  from public.orxelia_legal_reviews r
  join public.orxelia_proposals p on p.id = r.proposal_id
  where p.owner_id = (select auth.uid()) and p.brief->>'dashboard_deleted_at' is null
  order by r.proposal_id, r.version desc
$$;
revoke all on function public.orxelia_list_legal_review_status() from public, anon;
grant execute on function public.orxelia_list_legal_review_status() to authenticated;

create function public.orxelia_save_legal_review(
  p_proposal_id uuid, p_previous_version bigint, p_design_revision integer,
  p_checks jsonb, p_risks jsonb
) returns public.orxelia_legal_reviews
language plpgsql security definer set search_path = '' as $$
declare
  proposal public.orxelia_proposals;
  saved public.orxelia_legal_reviews;
  latest_version bigint;
  check_id text;
  item jsonb;
  can_apply boolean := true;
begin
  select * into proposal from public.orxelia_proposals
    where id = p_proposal_id and owner_id = auth.uid() for update;
  if not found then raise exception '案件が見つかりません。'; end if;
  if coalesce(proposal.revision_number, 1) is distinct from p_design_revision then
    raise exception 'デザインが更新されました。再読み込みしてください。';
  end if;
  select max(version) into latest_version from public.orxelia_legal_reviews
    where proposal_id = p_proposal_id;
  if latest_version is distinct from p_previous_version then
    raise exception '別の端末で審査が更新されました。再読み込みしてください。';
  end if;
  if jsonb_typeof(p_checks) is distinct from 'object'
    or jsonb_typeof(p_risks) is distinct from 'array'
    or octet_length(p_checks::text) + octet_length(p_risks::text) > 40000 then
    raise exception '審査の入力形式またはサイズが不正です。';
  end if;
  foreach check_id in array array['regulation','trademark','copyright','terms','privacy','sales','security'] loop
    item := p_checks -> check_id;
    if coalesce(item->>'status','') not in ('unreviewed','in_review','passed','blocked','expert_review') then
      raise exception '審査項目の状態が不正です。';
    end if;
    if item->>'status' <> 'passed'
      or nullif(btrim(item->>'evidence'),'') is null
      or nullif(btrim(item->>'reviewer'),'') is null
      or coalesce(item->>'reviewedAt','') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' then
      can_apply := false;
    end if;
  end loop;
  if exists (select 1 from jsonb_array_elements(p_risks) risk
    where coalesce(risk->>'severity','') not in ('critical','high','medium','low')
      or coalesce(risk->>'status','') not in ('open','resolved')
      or nullif(btrim(risk->>'detail'),'') is null) then
    raise exception 'リスクの入力内容を確認してください。';
  end if;
  if exists (select 1 from jsonb_array_elements(p_risks) risk
    where risk->>'severity' in ('critical','high') and risk->>'status' = 'open') then
    can_apply := false;
  end if;
  insert into public.orxelia_legal_reviews
    (proposal_id, reviewer_id, design_revision, checks, risks, eligible)
  values (p_proposal_id, auth.uid(), p_design_revision, p_checks, p_risks, can_apply)
  returning * into saved;
  if proposal.status = 'approved_for_development' then
    update public.orxelia_proposals set status = 'awaiting_first_approval', updated_at = now()
      where id = p_proposal_id;
  end if;
  return saved;
end $$;

revoke all on function public.orxelia_save_legal_review(uuid,bigint,integer,jsonb,jsonb) from public, anon;
grant execute on function public.orxelia_save_legal_review(uuid,bigint,integer,jsonb,jsonb) to authenticated;

create table public.orxelia_legal_development_approvals (
  approval_id bigint generated always as identity primary key,
  proposal_id uuid not null references public.orxelia_proposals(id),
  review_version bigint not null references public.orxelia_legal_reviews(version),
  approved_by uuid not null,
  approved_at timestamptz not null default now()
);
create index orxelia_legal_development_approvals_latest
  on public.orxelia_legal_development_approvals (proposal_id, approval_id desc);
alter table public.orxelia_legal_development_approvals enable row level security;
revoke all on public.orxelia_legal_development_approvals from public, anon, authenticated;
grant select on public.orxelia_legal_development_approvals to authenticated;
create policy legal_approvals_owner_select on public.orxelia_legal_development_approvals
  for select to authenticated using (exists (
    select 1 from public.orxelia_proposals p
    where p.id = proposal_id and p.owner_id = (select auth.uid())
  ));

create function public.orxelia_check_development_legal_review()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  review public.orxelia_legal_reviews;
  approved_version bigint;
begin
  if tg_op = 'INSERT' then
    if new.status in ('approved_for_development','developing') then
      raise exception '案件を作成してから法務審査と開発承認を行ってください。';
    end if;
    return new;
  end if;
  if new.status is not distinct from old.status then return new; end if;
  if new.status not in ('approved_for_development','developing') then return new; end if;

  select * into review from public.orxelia_legal_reviews
    where proposal_id = new.id order by version desc limit 1;
  if new.status = 'approved_for_development' then
    if old.status <> 'awaiting_first_approval' or auth.uid() is distinct from old.owner_id then
      raise exception '案件所有者による開発承認が必要です。';
    end if;
    if review.eligible is distinct from true
      or review.design_revision is distinct from coalesce(new.revision_number,1) then
      raise exception '現在のデザイン版の法務審査を完了してください。';
    end if;
    if nullif(btrim(new.prototype_html),'') is null
      or new.test_report #> '{preapproval_trial,passed}' is distinct from 'true'::jsonb
      or new.test_report #> '{preapproval_trial,design_revision}' is distinct from to_jsonb(coalesce(new.revision_number,1)) then
      raise exception '現在のデザイン版の非公開試作を作成し、検査を完了してください。';
    end if;
    insert into public.orxelia_legal_development_approvals (proposal_id,review_version,approved_by)
      values (new.id,review.version,auth.uid());
  else
    if old.status <> 'approved_for_development' then
      raise exception '開発承認が必要です。';
    end if;
    select review_version into approved_version from public.orxelia_legal_development_approvals
      where proposal_id = new.id order by approval_id desc limit 1;
    -- Existing approvals from before this migration retain their current workflow.
    if approved_version is not null and (
      approved_version is distinct from review.version or review.eligible is distinct from true
      or review.design_revision is distinct from coalesce(new.revision_number,1)
    ) then
      raise exception '法務審査が更新されました。再承認が必要です。';
    end if;
  end if;
  return new;
end $$;
revoke all on function public.orxelia_check_development_legal_review() from public, anon, authenticated;
create trigger orxelia_proposal_legal_review
  before insert or update of status on public.orxelia_proposals
  for each row execute function public.orxelia_check_development_legal_review();

commit;
