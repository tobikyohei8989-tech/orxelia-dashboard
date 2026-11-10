begin;

create function public.orxelia_request_development(
  p_request_id uuid, p_title text, p_purpose text, p_audience text,
  p_features text, p_references text
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  owner uuid := auth.uid();
  proposal public.orxelia_proposals;
  request_brief jsonb;
begin
  if owner is null then raise exception 'ログインが必要です。'; end if;
  if p_request_id is null or coalesce(length(btrim(p_title)),0) not between 1 and 140
    or coalesce(length(btrim(p_purpose)),0) not between 1 and 3000
    or coalesce(length(btrim(p_audience)),0) not between 1 and 1000
    or coalesce(length(btrim(p_features)),0) not between 1 and 4000
    or coalesce(length(btrim(p_references)),0) > 3000 then
    raise exception '開発依頼の必須項目と文字数を確認してください。';
  end if;
  request_brief := jsonb_build_object(
    'source','owner_request', 'problem',btrim(p_purpose), 'target',btrim(p_audience),
    'solution',btrim(p_features), 'references',btrim(coalesce(p_references,''))
  );
  insert into public.orxelia_proposals (id,owner_id,title,status,design_status,brief)
    values (p_request_id,owner,btrim(p_title),'awaiting_selection','pending',request_brief)
    on conflict (id) do nothing;
  select * into proposal from public.orxelia_proposals where id=p_request_id and owner_id=owner;
  if not found or proposal.brief->>'source' is distinct from 'owner_request' then
    raise exception '依頼を保存できませんでした。';
  end if;
  return jsonb_build_object('id',proposal.id,'title',proposal.title,'status',proposal.status,
    'design_status',proposal.design_status,'brief',proposal.brief,'created_at',proposal.created_at);
end $$;
revoke all on function public.orxelia_request_development(uuid,text,text,text,text,text) from public, anon;
grant execute on function public.orxelia_request_development(uuid,text,text,text,text,text) to authenticated;

commit;
