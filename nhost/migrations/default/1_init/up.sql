-- Agent Workflow Builder — core schema
-- Convention: every tenant-scoped table carries org_id (directly or via workflow_id -> workflows.org_id)
-- so that Hasura row permissions can always join back to org_members without extra hops.

create extension if not exists pgcrypto;

create type public.member_role as enum ('owner', 'editor', 'viewer');

create type public.step_type as enum (
  'llm_call', 'http_request', 'db_write', 'notify', 'conditional_branch', 'approval_gate'
);

create type public.trigger_type as enum ('manual', 'webhook', 'scheduled', 'db_event');

create type public.run_status as enum ('pending', 'running', 'paused', 'succeeded', 'failed', 'cancelled');

create type public.step_run_status as enum (
  'pending', 'running', 'succeeded', 'failed', 'paused_awaiting_approval', 'skipped'
);

-- ---------------------------------------------------------------------------
-- organizations
-- ---------------------------------------------------------------------------
create table public.organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  quota_calls_allowed integer not null default 1000,
  quota_period_start date not null default date_trunc('month', now())::date,
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- org_members — join table user <-> org with a role
-- ---------------------------------------------------------------------------
create table public.org_members (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role public.member_role not null default 'viewer',
  created_at timestamptz not null default now(),
  unique (org_id, user_id)
);

create index idx_org_members_user on public.org_members(user_id);
create index idx_org_members_org on public.org_members(org_id);

-- ---------------------------------------------------------------------------
-- workflows
-- ---------------------------------------------------------------------------
create table public.workflows (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  name text not null,
  description text,
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index idx_workflows_org on public.workflows(org_id);

-- ---------------------------------------------------------------------------
-- workflow_steps — ordered steps belonging to a workflow
-- ---------------------------------------------------------------------------
create table public.workflow_steps (
  id uuid primary key default gen_random_uuid(),
  workflow_id uuid not null references public.workflows(id) on delete cascade,
  -- denormalized org_id so Hasura permissions can filter this table directly
  -- without a nested relationship traversal (kept in sync by trigger below)
  org_id uuid not null references public.organizations(id) on delete cascade,
  step_order integer not null,
  type public.step_type not null,
  name text not null,
  config jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique (workflow_id, step_order)
);

create index idx_workflow_steps_workflow on public.workflow_steps(workflow_id);
create index idx_workflow_steps_org on public.workflow_steps(org_id);

-- ---------------------------------------------------------------------------
-- workflow_triggers
-- ---------------------------------------------------------------------------
create table public.workflow_triggers (
  id uuid primary key default gen_random_uuid(),
  workflow_id uuid not null references public.workflows(id) on delete cascade,
  org_id uuid not null references public.organizations(id) on delete cascade,
  type public.trigger_type not null,
  -- webhook: {"secret": "..."} | scheduled: {"cron": "*/5 * * * *"} | db_event: {"table": "..."}
  config jsonb not null default '{}'::jsonb,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

create index idx_workflow_triggers_workflow on public.workflow_triggers(workflow_id);
create index idx_workflow_triggers_org on public.workflow_triggers(org_id);

-- ---------------------------------------------------------------------------
-- workflow_runs — one per execution
-- ---------------------------------------------------------------------------
create table public.workflow_runs (
  id uuid primary key default gen_random_uuid(),
  workflow_id uuid not null references public.workflows(id) on delete cascade,
  org_id uuid not null references public.organizations(id) on delete cascade,
  status public.run_status not null default 'pending',
  triggered_by uuid references auth.users(id),
  trigger_type public.trigger_type not null default 'manual',
  started_at timestamptz not null default now(),
  finished_at timestamptz
);

create index idx_workflow_runs_workflow on public.workflow_runs(workflow_id);
create index idx_workflow_runs_org on public.workflow_runs(org_id);

-- ---------------------------------------------------------------------------
-- step_runs — one per step per run
-- ---------------------------------------------------------------------------
create table public.step_runs (
  id uuid primary key default gen_random_uuid(),
  workflow_run_id uuid not null references public.workflow_runs(id) on delete cascade,
  org_id uuid not null references public.organizations(id) on delete cascade,
  workflow_step_id uuid not null references public.workflow_steps(id) on delete cascade,
  status public.step_run_status not null default 'pending',
  input jsonb,
  output jsonb,
  error text,
  attempt_count integer not null default 0,
  approved_by uuid references auth.users(id),
  approved_at timestamptz,
  started_at timestamptz,
  finished_at timestamptz
);

create index idx_step_runs_run on public.step_runs(workflow_run_id);
create index idx_step_runs_org on public.step_runs(org_id);

-- ---------------------------------------------------------------------------
-- Keep denormalized org_id columns in sync automatically (defense in depth —
-- means a permission rule on workflow_steps/triggers/runs never has to trust
-- client-supplied org_id, it's derived server-side)
-- ---------------------------------------------------------------------------
create or replace function public.set_org_id_from_workflow()
returns trigger as $$
begin
  select org_id into new.org_id from public.workflows where id = new.workflow_id;
  return new;
end;
$$ language plpgsql;

create trigger trg_steps_org_id
  before insert or update of workflow_id on public.workflow_steps
  for each row execute function public.set_org_id_from_workflow();

create trigger trg_triggers_org_id
  before insert or update of workflow_id on public.workflow_triggers
  for each row execute function public.set_org_id_from_workflow();

create trigger trg_runs_org_id
  before insert or update of workflow_id on public.workflow_runs
  for each row execute function public.set_org_id_from_workflow();

create or replace function public.set_org_id_from_run()
returns trigger as $$
begin
  select org_id into new.org_id from public.workflow_runs where id = new.workflow_run_id;
  return new;
end;
$$ language plpgsql;

create trigger trg_step_runs_org_id
  before insert or update of workflow_run_id on public.step_runs
  for each row execute function public.set_org_id_from_run();

-- ---------------------------------------------------------------------------
-- Aggregation: org usage this month (computed via view; exposed to Hasura
-- as a table w/ a manual object relationship from organizations)
-- ---------------------------------------------------------------------------
create view public.org_usage_this_month as
select
  o.id as org_id,
  o.quota_calls_allowed,
  count(wr.id) filter (
    where wr.started_at >= date_trunc('month', now())
  ) as quota_calls_used,
  round(avg(extract(epoch from (wr.finished_at - wr.started_at)))
    filter (where wr.finished_at is not null), 2) as avg_run_duration_seconds
from public.organizations o
left join public.workflow_runs wr on wr.org_id = o.id
group by o.id, o.quota_calls_allowed;

-- quota increment helper used by the Action handler after a successful run
create or replace function public.increment_org_quota(p_org_id uuid)
returns void as $$
begin
  -- usage is derived live from workflow_runs count in org_usage_this_month,
  -- so "incrementing" is implicit once the run row exists; this function
  -- exists as an explicit hook point / extension seam (e.g. for a cached
  -- counter column) called by the Action handler after each completed run.
  perform 1;
end;
$$ language plpgsql;
