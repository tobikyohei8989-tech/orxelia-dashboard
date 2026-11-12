begin;
create or replace function public.orxelia_proposal_transition(p_id uuid,p_action text,p_feedback text default null)
returns public.orxelia_proposals language plpgsql security definer set search_path='' as $$
declare proposal public.orxelia_proposals;
begin
  if auth.uid() is null then raise exception 'ログインが必要です。'; end if;
  select * into proposal from public.orxelia_proposals where id=p_id and owner_id=auth.uid()
    and brief->>'dashboard_deleted_at' is null for update;
  if not found then raise exception '対象の案件が見つかりません。'; end if;
  if p_action in ('request_revision','request_prototype_revision') and
    length(btrim(coalesce(p_feedback,''))) not between 3 and 3000 then raise exception '修正指示は3〜3000文字で入力してください。'; end if;
  if p_action='request_revision' and proposal.status='awaiting_first_approval' and proposal.design_status='ready' then
    update public.orxelia_proposals set status='revision_requested',revision_request=btrim(p_feedback),updated_at=now() where id=p_id returning * into proposal;
  elsif p_action='approve_development' and proposal.status='awaiting_first_approval' and proposal.design_status='ready' then
    update public.orxelia_proposals set status='approved_for_development',approved_at=now(),updated_at=now() where id=p_id returning * into proposal;
  elsif p_action='request_prototype_revision' and proposal.status in ('development_ready','awaiting_final_approval') and proposal.prototype_html is not null then
    update public.orxelia_proposals set status='prototype_revision_requested',prototype_revision_request=btrim(p_feedback),updated_at=now() where id=p_id returning * into proposal;
  elsif p_action='hold' and proposal.status in ('awaiting_selection','awaiting_first_approval') then
    update public.orxelia_proposals set status='on_hold',updated_at=now() where id=p_id returning * into proposal;
  elsif p_action='request_sales_review' and proposal.status='development_ready'
    and coalesce(proposal.test_report->>'passed','false')='true'
    and coalesce(proposal.brief->>'classification','')<>'internal_validation_not_commercial_proposal' then
    update public.orxelia_proposals set status='sales_review_requested',sales_review=coalesce(sales_review,'{}'::jsonb)-'recommendation'-'last_researched_at'-'research_plan',updated_at=now() where id=p_id returning * into proposal;
  elsif p_action='approve_sales' and proposal.status='awaiting_final_approval'
    and proposal.sales_review->>'recommendation' in ('ready','ready_for_approval')
    and coalesce(proposal.brief->>'classification','')<>'internal_validation_not_commercial_proposal' then
    if not coalesce((select eligible and design_revision=coalesce(proposal.revision_number,1)
      from public.orxelia_legal_reviews where proposal_id=p_id order by version desc limit 1),false) then
      raise exception '現在のデザイン版の法務審査を完了してください。';
    end if;
    update public.orxelia_proposals set status='final_approved',final_approved_at=now(),updated_at=now() where id=p_id returning * into proposal;
  else raise exception '現在の段階ではこの操作を行えません。'; end if;
  return proposal;
end $$;
create or replace function public.orxelia_proposal_transition(p_id uuid,p_action text)
returns public.orxelia_proposals language sql security invoker set search_path='' as $$
  select public.orxelia_proposal_transition(p_id,p_action,null::text)
$$;
revoke all on function public.orxelia_proposal_transition(uuid,text,text) from public,anon;
revoke all on function public.orxelia_proposal_transition(uuid,text) from public,anon;
grant execute on function public.orxelia_proposal_transition(uuid,text,text) to authenticated;
grant execute on function public.orxelia_proposal_transition(uuid,text) to authenticated;

create function public.orxelia_set_proposal_priority(p_id uuid)
returns table(id uuid,brief jsonb) language plpgsql security definer set search_path='' as $$
begin
  if auth.uid() is null then raise exception 'ログインが必要です。'; end if;
  perform p.id from public.orxelia_proposals p where p.owner_id=auth.uid()
    and p.brief->>'dashboard_deleted_at' is null order by p.id for update;
  if not exists(select 1 from public.orxelia_proposals p where p.id=p_id and p.owner_id=auth.uid()
    and p.brief->>'dashboard_deleted_at' is null) then raise exception '対象の案件が見つかりません。'; end if;
  return query update public.orxelia_proposals p set brief=coalesce(p.brief,'{}'::jsonb)||jsonb_build_object(
    'priority_rank',case when p.id=p_id then 1 else 2 end,'priority_mode','user_selected','priority_updated_at',now())
    where p.owner_id=auth.uid() and p.brief->>'dashboard_deleted_at' is null and (p.id=p_id or p.brief->>'priority_rank'='1')
    returning p.id,p.brief;
end $$;
revoke all on function public.orxelia_set_proposal_priority(uuid) from public,anon;
grant execute on function public.orxelia_set_proposal_priority(uuid) to authenticated;
commit;
