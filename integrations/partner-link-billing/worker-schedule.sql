-- Apply during the approved release after worker deployment and Vault configuration.
begin;
create function public.partner_link_run_billing_worker()
returns bigint language plpgsql security definer set search_path='' as $$
declare endpoint text; token text; request_id bigint;
begin
  select decrypted_secret into endpoint from vault.decrypted_secrets where name='partner_link_billing_worker_url';
  select decrypted_secret into token from vault.decrypted_secrets where name='partner_link_billing_worker_token';
  if endpoint !~ '^https://[a-z0-9]+[.]supabase[.]co/functions/v1/partner-link-billing-worker$'
    or endpoint is null or coalesce(length(token),0)<32 then
    raise exception 'Worker schedule configuration is incomplete';
  end if;
  select net.http_post(url:=endpoint,headers:=jsonb_build_object(
    'Authorization','Bearer '||token,'Content-Type','application/json'),body:='{}'::jsonb,timeout_milliseconds:=30000)
    into request_id;
  return request_id;
end $$;
revoke all on function public.partner_link_run_billing_worker() from public,anon,authenticated,service_role;
do $$
begin
  perform cron.unschedule(jobid) from cron.job where jobname='partner-link-billing-worker';
  perform cron.schedule('partner-link-billing-worker','* * * * *','select public.partner_link_run_billing_worker()');
end $$;
commit;
