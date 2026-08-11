# Agent Workflow Builder

A mini n8n for chaining AI agent steps, built on nhost (Postgres + Hasura +
Auth + Storage + Functions) with a Next.js frontend.

## Layout

```
nhost/
  migrations/default/1_init/          # tables, enums, views, denorm triggers
  migrations/default/2_db_event_source/  # example "watched table" for db_event trigger
  metadata/databases/default/tables/  # relationships + two-layer permissions per table
  metadata/actions.yaml               # triggerWorkflowRun, approveStep
  metadata/actions.graphql            # Action SDL
  nhost.toml
functions/                            # Action handlers + Event Trigger webhooks (Node)
web/                                  # Next.js frontend
```

## Setup

### 1. nhost project

```bash
npm install -g nhost
nhost init            # or: nhost login && nhost link (existing project)
cp -r <this repo>/nhost/* .           # merge migrations/metadata into your nhost dir
nhost up               # local dev stack, or `nhost deploy` for cloud
```

Apply migrations + metadata:
```bash
nhost hasura migrate apply --database-name default
nhost hasura metadata apply
```

### 2. Functions (Action handlers + Event Trigger webhooks)

nhost auto-serves everything in `functions/` at
`https://<subdomain>.functions.<region>.nhost.run/v1/<filename>`. Locally,
`nhost up` serves them at `http://localhost:1337/v1/functions/<filename>`.

Set these env vars (nhost project → Settings → Environment Variables, or
`.env.development` for local):

```
HASURA_GRAPHQL_URL=https://<subdomain>.hasura.<region>.nhost.run/v1/graphql
HASURA_ADMIN_SECRET=<from nhost dashboard>
ACTION_SECRET=<any random string — shared with actions.yaml/event triggers>
GROQ_API_KEY=<optional — omit to use the stubbed llm_call fallback>
```

Then in `nhost/metadata/actions.yaml` and the two `event_triggers:` blocks,
replace `{{ACTIONS_BASE_URL}}` with your actual functions base URL (nhost's
metadata doesn't support env interpolation in webhook URLs the way it does
for headers — either hardcode it or use `nhost hasura metadata apply`
with an env-substituted copy).

### 3. Web app

```bash
cd web
cp .env.example .env.local   # fill in NEXT_PUBLIC_NHOST_SUBDOMAIN / _REGION
npm install
npm run dev                  # http://localhost:3000
npm run build && vercel deploy --prod   # to ship it
```

### 4. Seed two orgs for the Final Task demo

Easiest path: sign up two users in the app, then insert rows directly
(Hasura console, admin role) —

```sql
insert into organizations (name) values ('Org A'), ('Org B');
insert into org_members (org_id, user_id, role)
  values ('<org-a-id>', '<user-a-id>', 'owner'),
         ('<org-b-id>', '<user-b-id>', 'owner');
```

### 5. Scheduled trigger

`functions/scheduledDispatch.js` is request-driven, not a daemon — point an
external cron at it once a minute: a Vercel Cron Job, a GitHub Actions
`schedule:` workflow doing `curl`, or nhost's own Run Service cron feature.

## Design notes (see WRITEUP.md for the full page)

- **Single Hasura role (`user`) for everyone.** Per-org role (owner/editor/
  viewer) is resolved by joining `org_members` inside every permission
  filter, never from a static JWT claim — a user's role can differ across
  orgs, so a static claim would be wrong the moment someone belongs to two.
- **Layer 1 (org scoping)** lives in Hasura row permissions on every table,
  always via `workflow → org → members(user_id = X-Hasura-User-Id)`.
- **Layer 2 (step-type gating)** is *also* a declarative Hasura permission
  (see `public_workflow_steps.yaml` / `public_workflow_triggers.yaml`) — an
  `_or` between "caller is owner" and "caller is editor AND type not in
  {db_write, notify}". This is enforced by Postgres itself, not app code.
- **The one thing that can't be a row permission:** approving a paused
  `approval_gate`. That's a *mid-execution* decision (resume a run,
  re-check the approver's org role at the moment of approval), so
  `approveStep` is a Hasura Action whose handler explicitly checks
  `getRoleInOrg()` before resuming — see `functions/approveStep.js`.
- **`workflow_runs` / `step_runs` have no client-facing insert/update
  permission at all.** Every write to them happens server-side via the
  Action handlers using the Hasura admin secret. This is what makes quota
  checks, retries, and the approval pause/resume trustworthy — a client
  can't just insert a `succeeded` step_run row.
- **notify** is implemented as an Event Trigger (`step_runs_notify_dispatch`)
  reacting to `step_runs.status` flipping to `succeeded`, per the spec.
- **db_event** trigger type watches `public.app_events`; inserting a row
  there fires `app_events_db_trigger` → `functions/dbEventStart.js`, which
  starts any workflow whose active `db_event` trigger config matches.
- **webhook** trigger type is the actual inbound endpoint external systems
  call: a public (unauthenticated) Hasura Action, `webhookTrigger(trigger_id,
  secret)`, backed by `functions/webhookTrigger.js`. It has no Hasura
  session to check a caller's org role against, so authorization is instead
  a per-trigger secret stored in `workflow_triggers.config.secret` — set at
  creation time by an owner (creating a `webhook` trigger is owner-only, see
  `public_workflow_triggers.yaml`). A wrong `trigger_id` or `secret` gets
  the same generic 401 either way, so an external caller can't distinguish
  "wrong secret" from "no such trigger" — relevant for the Final Task's
  "not even by guessing an ID" cross-org check. The workflow builder UI
  shows a ready-to-copy `curl` command for each webhook trigger.
- **Retry attempt counts are real.** `llm_call`/`http_request` report back
  how many attempts they actually took (1, or 2 if the built-in retry
  fired); `step_runs.attempt_count` reflects that instead of always being
  hardcoded to `1`, including on the failure path.
