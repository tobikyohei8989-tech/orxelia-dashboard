-- Existing records remain one person. Availability is total capacity, not remaining capacity.
alter table public.tobita_match_availability add column capacity integer not null default 1 check (capacity between 1 and 99);
alter table public.tobita_match_requests add column headcount integer not null default 1 check (headcount between 1 and 99);

create or replace function public.tobita_match_set_capacity(p_dates date[], p_slot text, p_capacity integer)
returns void language plpgsql security definer set search_path='' as $$
declare v_owner uuid; d date; s text; used integer;
begin
 select owner_id into v_owner from public.tobita_match_members where user_id=auth.uid() and role='worker';
 if auth.uid() is null or v_owner is null then raise exception '職人としての登録が必要です'; end if;
 if p_slot is null or p_slot not in ('am','pm','all') or p_capacity is null or p_capacity not between 0 and 99 or coalesce(cardinality(p_dates),0) not between 1 and 31 or array_position(p_dates,null) is not null then raise exception '日付・時間帯・人数を確認してください'; end if;
 for d in select distinct unnest(p_dates) order by 1 loop
  if d < (now() at time zone 'Asia/Tokyo')::date then raise exception '過去の日付は変更できません'; end if;
  perform pg_advisory_xact_lock(hashtextextended(auth.uid()::text||d::text,0));
  for s in select unnest(case when p_slot='all' then array['am','pm'] else array[p_slot] end) loop
   select coalesce(sum(r.headcount),0) into used from public.tobita_match_requests r where r.worker_id=auth.uid() and r.work_date=d and r.status in ('pending','confirmed') and r.slot in (s,'all');
   if p_capacity < used then raise exception '% は打診中・成立分が % 人あります。これより少なくできません',d,used; end if;
   if p_capacity=0 then
    delete from public.tobita_match_availability where worker_id=auth.uid() and work_date=d and slot=s;
   else
    insert into public.tobita_match_availability(owner_id,worker_id,work_date,slot,capacity) values(v_owner,auth.uid(),d,s,p_capacity)
    on conflict(worker_id,work_date,slot) do update set capacity=excluded.capacity;
   end if;
  end loop;
 end loop;
end $$;
revoke all on function public.tobita_match_set_capacity(date[],text,integer) from public,anon;
grant execute on function public.tobita_match_set_capacity(date[],text,integer) to authenticated;

create or replace function public.tobita_match_send_capacity(p_worker uuid,p_job text,p_dates date[],p_slot text,p_meeting_time text,p_meeting_place text,p_headcount integer)
returns integer language plpgsql security definer set search_path='' as $$
declare d date; s text; total integer; used integer; v_group uuid:=gen_random_uuid(); v_id uuid; v_count integer:=0;
begin
 if auth.uid() is null or not exists(select 1 from public.tobita_match_members where user_id=auth.uid() and owner_id=auth.uid() and role='admin') then raise exception '管理者としての登録が必要です'; end if;
 if not exists(select 1 from public.tobita_match_members where user_id=p_worker and owner_id=auth.uid() and role='worker') then raise exception '自社のパートナーを選択してください'; end if;
 if p_job is null or length(trim(p_job)) not between 1 and 80 or p_slot is null or p_slot not in ('all','am','pm') or coalesce(cardinality(p_dates),0) not between 1 and 31 or array_position(p_dates,null) is not null or p_headcount is null or p_headcount not between 1 and 99 or p_meeting_time is null or p_meeting_time !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' or p_meeting_place is null or length(trim(p_meeting_place)) not between 1 and 200 then raise exception '現場・日付・時間帯・人数・集合情報を確認してください'; end if;
 for d in select distinct unnest(p_dates) order by 1 loop
  if d < (now() at time zone 'Asia/Tokyo')::date then raise exception '過去の日付には打診できません'; end if;
  perform pg_advisory_xact_lock(hashtextextended(p_worker::text||d::text,0));
  for s in select unnest(case when p_slot='all' then array['am','pm'] else array[p_slot] end) loop
   select capacity into total from public.tobita_match_availability where worker_id=p_worker and work_date=d and slot=s;
   select coalesce(sum(r.headcount),0) into used from public.tobita_match_requests r where r.worker_id=p_worker and r.work_date=d and r.status in ('pending','confirmed') and r.slot in (s,'all');
   if coalesce(total,0)-used < p_headcount then raise exception '% の空き人数が不足しています。画面を更新してください',d; end if;
  end loop;
  insert into public.tobita_match_requests(owner_id,worker_id,group_id,job_name,work_date,slot,meeting_time,meeting_place,headcount)
   values(auth.uid(),p_worker,v_group,trim(p_job),d,p_slot,p_meeting_time::time,trim(p_meeting_place),p_headcount) returning id into v_id;
  insert into public.tobita_match_events(owner_id,recipient_id,request_id,event_type,message)
   values(auth.uid(),p_worker,v_id,'request','新しい仕事の打診：'||trim(p_job)||' / '||d::text||' / '||p_headcount||'人 / 集合 '||p_meeting_time||' / '||trim(p_meeting_place));
  v_count:=v_count+1;
 end loop;
 return v_count;
end $$;
revoke all on function public.tobita_match_send_capacity(uuid,text,date[],text,text,text,integer) from public,anon;
grant execute on function public.tobita_match_send_capacity(uuid,text,date[],text,text,text,integer) to authenticated;

-- Existing clients still send one person, using the same capacity checks.
create or replace function public.tobita_match_send_details(p_worker uuid,p_job text,p_dates date[],p_slot text,p_meeting_time text,p_meeting_place text)
returns integer language plpgsql security definer set search_path='' as $$
begin
 return public.tobita_match_send_capacity(p_worker,p_job,p_dates,p_slot,p_meeting_time,p_meeting_place,1);
end $$;

create or replace function public.tobita_match_respond(p_request uuid,p_accept boolean)
returns void language plpgsql security definer set search_path='' as $$
declare r public.tobita_match_requests%rowtype; s text; total integer; used integer;
begin
 select * into r from public.tobita_match_requests where id=p_request for update;
 if not found or auth.uid() is null or r.worker_id<>auth.uid() or r.status<>'pending' or p_accept is null then raise exception '回答できる打診がありません'; end if;
 perform pg_advisory_xact_lock(hashtextextended(r.worker_id::text||r.work_date::text,0));
 if p_accept then
  for s in select unnest(case when r.slot='all' then array['am','pm'] else array[r.slot] end) loop
   select capacity into total from public.tobita_match_availability where worker_id=r.worker_id and work_date=r.work_date and slot=s;
   select coalesce(sum(x.headcount),0) into used from public.tobita_match_requests x where x.worker_id=r.worker_id and x.work_date=r.work_date and x.status in ('pending','confirmed') and x.slot in (s,'all');
   if coalesce(total,0)<used then raise exception '対応可能人数を確認してください'; end if;
  end loop;
 end if;
 update public.tobita_match_requests set status=case when p_accept then 'confirmed' else 'declined' end,updated_at=now() where id=p_request;
 insert into public.tobita_match_events(owner_id,recipient_id,request_id,event_type,message)
 values(r.owner_id,r.owner_id,p_request,case when p_accept then 'matched' else 'declined' end,(case when p_accept then 'マッチング成立：' else '辞退：' end)||r.job_name||' / '||r.work_date::text||' / '||r.headcount||'人');
end $$;
notify pgrst, 'reload schema';
