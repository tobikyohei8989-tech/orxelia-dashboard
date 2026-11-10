begin;

create function public.orxelia_record_sales_launch(
  p_id uuid, p_previous jsonb, p_stage text, p_url text, p_start date, p_remaining text
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  proposal public.orxelia_proposals;
  launch jsonb;
begin
  select * into proposal from public.orxelia_proposals
    where id = p_id and owner_id = auth.uid() and status = 'final_approved'
      and brief->>'dashboard_deleted_at' is null for update;
  if not found then raise exception '販売方針が承認された案件を選択してください。'; end if;
  if p_stage is null or p_stage not in ('preparing','started')
    or coalesce(length(p_remaining),0) > 3000 or coalesce(length(p_url),0) > 2000
    or (nullif(p_url,'') is not null and p_url !~ '^https://[^/[:space:]?#]+[^[:space:]]*$') then
    raise exception '公開URLと残課題の入力を確認してください。';
  end if;
  if p_stage = 'started' and (nullif(p_url,'') is null or p_start is null
    or p_start > (current_timestamp at time zone 'Asia/Tokyo')::date) then
    raise exception '実際の販売開始日と公開URLが必要です。';
  end if;
  launch := jsonb_build_object('stage',p_stage,'url',nullif(p_url,''),'started_on',
    case when p_stage='started' then p_start else null end,'remaining',coalesce(p_remaining,''));
  if proposal.brief->'sales_launch' = launch then return launch; end if;
  if proposal.brief->'sales_launch' is distinct from p_previous then
    raise exception '別の端末で更新されました。再読み込みしてください。';
  end if;
  update public.orxelia_proposals set brief = coalesce(brief,'{}'::jsonb) || jsonb_build_object('sales_launch',launch),
    updated_at = now() where id = p_id;
  return launch;
end $$;
revoke all on function public.orxelia_record_sales_launch(uuid,jsonb,text,text,date,text) from public, anon;
grant execute on function public.orxelia_record_sales_launch(uuid,jsonb,text,text,date,text) to authenticated;

commit;
