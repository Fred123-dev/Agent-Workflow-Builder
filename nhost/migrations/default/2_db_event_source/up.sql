-- Example "watched table" for the Database Event trigger type. In this
-- assignment a db_event trigger's config is {"table": "app_events"} — any
-- row inserted here that matches a workflow's watch config auto-starts a
-- run via the Hasura Event Trigger -> functions/dbEventStart webhook.
-- Swap this for whatever real business table you want to watch.
create table public.app_events (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  event_type text not null,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index idx_app_events_org on public.app_events(org_id);
