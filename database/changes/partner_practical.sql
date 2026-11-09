-- These records reference the live match requests. The unrelated legacy tobita_attendance table is untouched.
create table public.tobita_match_attendance (
 request_id uuid primary key references public.tobita_match_requests(id),
 full_count integer not null check(full_count between 0 and 99),
 half_count integer not null check(half_count between 0 and 99),
 note text not null default '' check(length(note)<=500),
 updated_by uuid not null,
 updated_at timestamptz not null default now(),
 check(full_count+half_count<=99)
);
create table public.tobita_match_attendance_history (
 id uuid primary key default gen_random_uuid(),
 request_id uuid not null references public.tobita_match_requests(id),
 previous_record jsonb,
 recorded_record jsonb not null,
 actor_id uuid not null,
 created_at timestamptz not null default now()
);
alter table public.tobita_match_attendance enable row level security;
alter table public.tobita_match_attendance_history enable row level security;
create policy attendance_visible on public.tobita_match_attendance for select to authenticated using (exists(select 1 from public.tobita_match_requests r where r.id=request_id and (r.owner_id=(select auth.uid()) or r.worker_id=(select auth.uid()))));
create policy attendance_history_visible on public.tobita_match_attendance_history for select to authenticated using (exists(select 1 from public.tobita_match_requests r where r.id=request_id and (r.owner_id=(select auth.uid()) or r.worker_id=(select auth.uid()))));
revoke all on public.tobita_match_attendance,public.tobita_match_attendance_history from anon,authenticated;
grant select on public.tobita_match_attendance,public.tobita_match_attendance_history to authenticated;
create index tobita_match_attendance_history_request on public.tobita_match_attendance_history(request_id,created_at);

create or replace function public.tobita_match_record_attendance(p_request uuid,p_full_count integer,p_half_count integer,p_note text,p_expected_updated_at timestamptz default null)
returns void language plpgsql security definer set search_path='' as $$
declare r public.tobita_match_requests%rowtype; old_record public.tobita_match_attendance%rowtype; saved public.tobita_match_attendance%rowtype;
begin
 select * into r from public.tobita_match_requests where id=p_request for update;
 if not found or auth.uid() is null or r.owner_id<>auth.uid() or not exists(select 1 from public.tobita_match_members where user_id=auth.uid() and role='admin' and owner_id=auth.uid()) then raise exception '実績は自社の管理者のみ登録できます'; end if;
 if r.status<>'confirmed' then raise exception '成立済みの仕事のみ実績を登録できます'; end if;
 if r.work_date>(now() at time zone 'Asia/Tokyo')::date then raise exception '実績は作業日当日以降に登録してください'; end if;
 if p_full_count is null or p_half_count is null or p_full_count<0 or p_half_count<0 or p_full_count+p_half_count>99 or length(coalesce(p_note,''))>500 then raise exception '人数は0〜99人、合計99人以内で入力してください'; end if;
 select * into old_record from public.tobita_match_attendance where request_id=p_request;
 if old_record.updated_at is distinct from p_expected_updated_at then raise exception '別の端末で実績が更新されました。再読込して確認してください'; end if;
 insert into public.tobita_match_attendance(request_id,full_count,half_count,note,updated_by,updated_at)
 values(p_request,p_full_count,p_half_count,coalesce(p_note,''),auth.uid(),clock_timestamp())
 on conflict(request_id) do update set full_count=excluded.full_count,half_count=excluded.half_count,note=excluded.note,updated_by=excluded.updated_by,updated_at=excluded.updated_at returning * into saved;
 insert into public.tobita_match_attendance_history(request_id,previous_record,recorded_record,actor_id)
 values(p_request,case when old_record.request_id is null then null else to_jsonb(old_record) end,to_jsonb(saved),auth.uid());
end $$;
revoke all on function public.tobita_match_record_attendance(uuid,integer,integer,text,timestamptz) from public,anon;
grant execute on function public.tobita_match_record_attendance(uuid,integer,integer,text,timestamptz) to authenticated;

-- Lock the same request in both RPCs to prevent cancellation racing with actual-work confirmation.
create or replace function public.tobita_match_cancel(p_request uuid)
returns void language plpgsql security definer set search_path='' as $$
declare r public.tobita_match_requests%rowtype;
begin
 select * into r from public.tobita_match_requests where id=p_request for update;
 if not found or auth.uid() is null or r.owner_id<>auth.uid() or r.status not in ('pending','confirmed') then raise exception '取消できる仕事がありません'; end if;
 if exists(select 1 from public.tobita_match_attendance where request_id=p_request and full_count+half_count>0) then raise exception '実績登録済みです。実働がなかった場合は実績を0人に修正してから取り消してください'; end if;
 update public.tobita_match_requests set status='cancelled',updated_at=now() where id=p_request;
 insert into public.tobita_match_events(owner_id,recipient_id,request_id,event_type,message) values(r.owner_id,r.worker_id,p_request,'cancelled','仕事の取消：'||r.job_name||' / '||r.work_date::text);
end $$;
notify pgrst,'reload schema';
