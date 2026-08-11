# Write-up

## Schema reasoning

The relationship chain `organizations → org_members → workflows →
workflow_steps/workflow_triggers → workflow_runs → step_runs` is enforced
two ways at once, deliberately redundant:

1. Real foreign keys everywhere (cascading deletes keep the tree consistent).
2. A denormalized `org_id` column on every table below `workflows`, kept in
   sync by `before insert/update` triggers (`set_org_id_from_workflow`,
   `set_org_id_from_run`) rather than trusted from client input.

The denormalization exists purely so every Hasura permission filter is a
single join to `org_members`, not a 2–3 hop traversal through `workflow_id
→ workflow → org_id`. It costs one column and one trivial trigger per table,
and in exchange every permission rule in the metadata directory reads the
same way, which matters a lot when you're auditing them for the "airtight
cross-org isolation" requirement.

`workflow_steps.config` and `workflow_triggers.config` are JSONB because
the six step types and four trigger types have almost nothing in common
schema-wise (an `llm_call`'s config is a prompt + model; a `scheduled`
trigger's is a cron string) — a rigid column set would mean six mostly-null
columns per step type. Validation of `config`'s shape happens in the Action
handler / step executor (`functions/_lib/steps/*.js`), not the database.

`org_usage_this_month` is a plain view rather than a materialized one or a
cached counter column: quota checks and the dashboard's aggregation both
read it live, and at assignment scale a `count(*) + avg()` over
`workflow_runs` is cheap enough that eventual consistency isn't worth the
extra invalidation logic. `increment_org_quota()` is left as a documented
seam for swapping in a cached counter later without changing the Action
handler's call site.

## The two permission layers, and why they're enforced differently

**Layer 1 (org + role scoping)** and the *type-restriction half* of
**Layer 2 (step-level gating)** are both expressed as declarative Hasura
row permissions — see `nhost/metadata/databases/default/tables/
public_workflow_steps.yaml` and `public_workflow_triggers.yaml`. Every
table uses one Hasura role, `user`; the caller's actual role in a given org
is never taken from a JWT claim (a user can be owner in Org A and viewer in
Org B, so a static claim would be wrong for at least one of them) — it's
resolved by joining `org_members` inside the permission filter itself,
every time. Layer 2's *type restriction* — editors can't insert `db_write`,
`notify`, or a `webhook` trigger — is expressed as an `_or` between "caller
is owner" and "caller is editor AND type is not in the restricted set", so
Postgres refuses the insert before any application code runs. This is
strictly stronger than an app-level check: it holds even against a
handcrafted GraphQL request or a compromised frontend.

**Layer 2's other half — approving a paused `approval_gate` — can't be a
row permission**, because it isn't a row visibility or insert-shape
question, it's "should this specific in-flight run be allowed to resume
right now." Hasura permissions are evaluated per-row against the request's
session variables; they have no concept of "this run is currently paused"
or "resume execution from step N." So `approveStep` is a Hasura Action:
its handler (`functions/approveStep.js`) loads the paused `step_run`,
re-resolves the caller's role in that run's org via the same
`getRoleInOrg()` helper the trigger Action uses, rejects with 403 if it's
not owner/editor, and only then calls back into the shared `executeSteps()`
engine starting at `step_order + 1`. `workflow_runs` and `step_runs` have
**no client insert/update permission at all** — every write to them goes
through the Action handlers using the Hasura admin secret — so there's no
path for a client to fake an approval by writing the row directly.

## Approval-gate pause/resume

`executeSteps()` (`functions/_lib/runEngine.js`) is a single shared loop
used by `triggerWorkflowRun`, `approveStep`, `webhookTrigger`, and both
Event Trigger webhooks (`dbEventStart`, `scheduledDispatch`). It walks the
ordered step list from a given index, creating a `step_runs` row per step
and updating its status as it goes — which is what the live subscription
renders. Hitting an `approval_gate` step sets that step_run to
`paused_awaiting_approval`, the parent `workflow_runs.status` to `paused`,
and returns immediately — no polling, no separate "resume worker."
`approveStep` re-enters the exact same function with `fromIndex = gate's
step_order + 1` and the gate's own output (`{approved: true}`) as the seed
input for the next step, so a `conditional_branch` after a gate can react to
the fact that it was approved.

## Why the webhook trigger is its own Action

`triggerWorkflowRun` and `approveStep` both authorize via
`session_variables['x-hasura-user-id']` — they assume a logged-in Hasura
user. An external system hitting a webhook has no such session, so it can't
be checked against `org_members` at all; a *different* kind of credential is
needed. `webhookTrigger(trigger_id, secret)` is registered against Hasura's
built-in unauthenticated `public` role and carries no identity — its
handler (`functions/webhookTrigger.js`) checks the caller-supplied `secret`
against the `secret` stored in that specific `workflow_triggers.config`
(set once, at creation time, by an owner — creating a `webhook` trigger row
is owner-only under Layer 2). A mismatched secret and a nonexistent
`trigger_id` return the identical generic 401, so probing IDs from outside
learns nothing — the same "not even by guessing an ID" bar the org-isolation
check applies internally.
