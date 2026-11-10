create table public.partner_link_stripe_events (
 event_id text primary key,
 event_type text not null,
 stripe_created bigint not null,
 livemode boolean not null,
 payload jsonb not null,
 received_at timestamptz not null default now(),
 processed_at timestamptz,
 processing_error text
);
alter table public.partner_link_stripe_events enable row level security;
revoke all on public.partner_link_stripe_events from public, anon, authenticated;
grant select,insert,update on public.partner_link_stripe_events to service_role;
create index partner_link_stripe_events_pending on public.partner_link_stripe_events(received_at) where processed_at is null;
comment on table public.partner_link_stripe_events is 'Verified Stripe events. Service-only inbox; queued does not mean customer provisioning completed.';
