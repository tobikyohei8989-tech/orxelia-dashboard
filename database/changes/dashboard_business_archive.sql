-- Dashboard removal is reversible. Existing products and business records stay intact.
create or replace function public.orxelia_archive_proposal(p_id uuid, p_archived boolean)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare r public.orxelia_proposals;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  if p_archived is null then raise exception 'Archive choice required'; end if;
  select * into r from public.orxelia_proposals where id=p_id and owner_id=auth.uid() for update;
  if not found then raise exception 'Proposal not found'; end if;
  if p_archived then
    update public.orxelia_proposals set status='on_hold', updated_at=now(),
      brief=coalesce(brief,'{}'::jsonb)||jsonb_build_object('dashboard_deleted_at',coalesce(brief->>'dashboard_deleted_at',now()::text),'dashboard_previous_status',coalesce(brief->>'dashboard_previous_status',status))
      where id=p_id and owner_id=auth.uid() returning * into r;
  else
    update public.orxelia_proposals set status='on_hold',updated_at=now(),
      brief=coalesce(brief,'{}'::jsonb)-'dashboard_deleted_at'-'dashboard_previous_status'
      where id=p_id and owner_id=auth.uid() returning * into r;
  end if;
  return jsonb_build_object('id',r.id,'title',r.title,'status',r.status,'brief',r.brief);
end $$;
revoke all on function public.orxelia_archive_proposal(uuid,boolean) from public, anon;
grant execute on function public.orxelia_archive_proposal(uuid,boolean) to authenticated;
