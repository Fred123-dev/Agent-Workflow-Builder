const { gql } = require('./_lib/hasura');
const { executeSteps } = require('./_lib/runEngine');

// Public inbound endpoint for the "webhook" trigger type. This is the
// Action referenced by the assignment as "a Hasura Action acting as an
// inbound endpoint external systems call to start a run" — unlike
// triggerWorkflowRun/approveStep, it has NO Hasura session (external
// systems don't have a logged-in user), so it can't be authorized via
// getRoleInOrg(). Instead, each webhook trigger row stores its own
// per-trigger secret in config.secret (set by an owner at creation time —
// see public_workflow_triggers.yaml Layer 2 permission, which restricts
// *creating* a webhook trigger to owners). The caller must present that
// exact secret; nothing else identifies or authorizes them.
//
// Registered against the `public` (unauthenticated) role in actions.yaml,
// since Hasura has no session_variables to check here at all.
module.exports = async (req, res) => {
  const { trigger_id, secret } = req.body.input || {};
  if (!trigger_id || !secret) {
    return res.status(400).json({ message: 'trigger_id and secret are required.' });
  }

  const data = await gql(
    `query ($id: uuid!) {
      workflow_triggers_by_pk(id: $id) {
        id type config is_active workflow_id
        workflow {
          org_id
          steps(order_by: { step_order: asc }) { id type config step_order }
        }
      }
    }`,
    { id: trigger_id }
  );
  const trigger = data.workflow_triggers_by_pk;

  // Deliberately vague errors — don't reveal whether a trigger_id exists,
  // is the wrong type, is inactive, or the secret was just wrong. All of
  // that would leak information to an unauthenticated caller probing IDs,
  // which is exactly what the Final Task's cross-org isolation check is
  // guarding against.
  const unauthorized = () => res.status(401).json({ message: 'Invalid trigger_id or secret.' });

  if (!trigger || trigger.type !== 'webhook' || !trigger.is_active) return unauthorized();
  if (!trigger.config || trigger.config.secret !== secret) return unauthorized();

  const runData = await gql(
    `mutation ($obj: workflow_runs_insert_input!) {
      insert_workflow_runs_one(object: $obj) { id org_id }
    }`,
    {
      obj: {
        workflow_id: trigger.workflow_id,
        org_id: trigger.workflow.org_id,
        status: 'running',
        trigger_type: 'webhook',
      },
    }
  );
  const run = runData.insert_workflow_runs_one;

  const result = await executeSteps(run, trigger.workflow.steps, 0, {});

  return res.json({
    workflow_run_id: run.id,
    status: result.paused ? 'paused' : result.failed ? 'failed' : 'succeeded',
  });
};
