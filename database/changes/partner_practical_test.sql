-- Isolated transactional fixtures: no jobs, actuals, history, or notifications are committed.
create or replace function pg_temp.check_partner_practical() returns text language plpgsql as $$
declare w uuid; a uuid; id_work uuid:=gen_random_uuid(); id_future uuid:=gen_random_uuid(); id_pending uuid:=gen_random_uuid(); d date:=(now() at time zone 'Asia/Tokyo')::date; version1 timestamptz; version2 timestamptz; blocked boolean; requests_before bigint; actuals_before bigint; history_before bigint;
begin
 select user_id,owner_id into w,a from public.tobita_match_members where role='worker' limit 1;
 assert w is not null,'A registered worker is needed';
 select count(*) into requests_before from public.tobita_match_requests;
 select count(*) into actuals_before from public.tobita_match_attendance;
 select count(*) into history_before from public.tobita_match_attendance_history;
 begin
  insert into public.tobita_match_requests(id,owner_id,worker_id,job_name,work_date,slot,status,headcount) values
   (id_work,a,w,'実働テスト（保存しない）',d-1,'all','confirmed',2),
   (id_future,a,w,'未来の予定（保存しない）',d+1,'all','confirmed',1),
   (id_pending,a,w,'未成立（保存しない）',d-1,'am','pending',1);
  execute 'set local role authenticated';
  perform set_config('request.jwt.claim.sub',a::text,true);
  perform public.tobita_match_record_attendance(id_work,1,1,'混在する実働',null);
  select updated_at into version1 from public.tobita_match_attendance where request_id=id_work;
  assert (select full_count+half_count*.5=1.5 from public.tobita_match_attendance where request_id=id_work),'Mixed actual-work count';
  perform public.tobita_match_record_attendance(id_work,2,0,'修正後',version1);
  select updated_at into version2 from public.tobita_match_attendance where request_id=id_work;
  assert (select count(*)=2 from public.tobita_match_attendance_history where request_id=id_work),'Audit trail must append';
  assert exists(select 1 from public.tobita_match_attendance_history where request_id=id_work and previous_record->>'note'='混在する実働'),'Previous values must be retained';
  blocked:=false;begin perform public.tobita_match_record_attendance(id_work,1,0,'古い端末',version1);exception when others then blocked:=true;end;assert blocked,'Stale edits must fail';
  blocked:=false;begin perform public.tobita_match_cancel(id_work);exception when others then blocked:=true;end;assert blocked,'Actual work must not disappear through cancellation';
  blocked:=false;begin perform public.tobita_match_record_attendance(id_future,1,0,'未来',null);exception when others then blocked:=true;end;assert blocked,'Future work cannot be recorded';
  blocked:=false;begin perform public.tobita_match_record_attendance(id_pending,1,0,'未成立',null);exception when others then blocked:=true;end;assert blocked,'Pending work cannot be recorded';
  blocked:=false;begin update public.tobita_match_attendance set full_count=99 where request_id=id_work;exception when insufficient_privilege then blocked:=true;end;assert blocked,'Direct writes must be denied';
  perform set_config('request.jwt.claim.sub',w::text,true);
  assert exists(select 1 from public.tobita_match_attendance where request_id=id_work),'Worker must see own actuals';
  blocked:=false;begin perform public.tobita_match_record_attendance(id_work,9,0,'職人の変更',version2);exception when others then blocked:=true;end;assert blocked,'Worker cannot certify actuals';
  perform set_config('request.jwt.claim.sub',gen_random_uuid()::text,true);
  assert not exists(select 1 from public.tobita_match_attendance where request_id=id_work),'Other users cannot read actuals';
  assert not exists(select 1 from public.tobita_match_attendance_history where request_id=id_work),'Other users cannot read history';
  blocked:=false;begin perform public.tobita_match_record_attendance(id_work,1,0,'他社',version2);exception when others then blocked:=true;end;assert blocked,'Other users cannot edit actuals';
  perform set_config('request.jwt.claim.sub',a::text,true);
  perform public.tobita_match_record_attendance(id_work,0,0,'実働なしに訂正',version2);
  perform public.tobita_match_cancel(id_work);
  assert (select status='cancelled' from public.tobita_match_requests where id=id_work),'Zero actuals can be cancelled';
  assert not has_function_privilege('anon','public.tobita_match_record_attendance(uuid,integer,integer,text,timestamptz)','execute'),'Anonymous RPC must be denied';
  raise exception using errcode='ZX001',message='ROLLBACK_SUCCESS';
 exception when sqlstate 'ZX001' then null;
 end;
 assert (select count(*)=requests_before from public.tobita_match_requests),'Request fixtures must roll back';
 assert (select count(*)=actuals_before from public.tobita_match_attendance),'Actual fixtures must roll back';
 assert (select count(*)=history_before from public.tobita_match_attendance_history),'History fixtures must roll back';
 return 'PASS: actual-work save/correction/history, stale-edit guard, future/pending rejection, cancellation guard, RLS owner/worker/other-user visibility, RPC-only writes; all fixtures rolled back';
end $$;
select pg_temp.check_partner_practical();
