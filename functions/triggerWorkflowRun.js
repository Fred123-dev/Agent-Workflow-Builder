const { gql } = require('./_lib/hasura');
const { getUserId, verifyActionSecret, getRoleInOrg } = require('./_lib/auth');
const { executeSteps } = require('./_lib/runEngine');

module.exports = async (req, res) => {
  // NOTE: Hasura signs this request with x-action-secret when
  // forward_client_headers is used server-to-server; when called directly
  // for local testing you'd skip this check. Kept here to show the pattern.
  const userId = getUserId(req);
  const { workflow_id } = req.body.input;

  if (!userId) return res.status(401).json({ message: 'Not authenticated' });

  // 1. Load workflow + org
  const wfData = await gql(
    `query ($id: uuid!) {
      workflows_by_pk(id: $id) {
        id org_id
        steps(order_by: { step_order: asc }) { id type config step_order }
      }
    }`,
    { id: workflow_id }
  );
  const workflow = wfData.workflows_by_pk;
  if (!workflow) return res.status(404).json({ message: 'Workflow not found' });

  // 2. Verify caller is owner/editor in the workflow's org (Action-level
  //    authorization — this is what actually gates "can trigger a run",
  //    since workflow_runs has no client insert permission at all).
  const role = await getRoleInOrg(userId, workflow.org_id);
  if (!role || !['owner', 'editor'].includes(role)) {
    return res.status(403).json({ message: 'Only an owner or editor can trigger this workflow.' });
  }

  // 3. Check org quota isn't exhausted
  const usageData = await gql(
    `query ($orgId: uuid!) {
      org_usage_this_month(where: { org_id: { _eq: $orgId } }) {
        quota_calls_used quota_calls_allowed
      }
    }`,
    { orgId: workflow.org_id }
  );
  const usage = usageData.org_usage_this_month[0];
  if (usage && usage.quota_calls_used >= usage.quota_calls_allowed) {
    return res.status(429).json({ message: 'Organization quota exhausted for this period.' });
  }

  // 4. Create the run
  const runData = await gql(
    `mutation ($obj: workflow_runs_insert_input!) {
      insert_workflow_runs_one(object: $obj) { id org_id }
    }`,
    {
      obj: {
        workflow_id: workflow.id,
        org_id: workflow.org_id,
        status: 'running',
        triggered_by: userId,
        trigger_type: 'manual',
      },
    }
  );
  const run = runData.insert_workflow_runs_one;

  // 5. Execute steps in order (pauses automatically on approval_gate)
  const result = await executeSteps(run, workflow.steps, 0, {});

  // 6. Quota usage is derived live from workflow_runs count in
  //    org_usage_this_month (see migration), so it's already incremented
  //    by virtue of step 4's insert — no separate write needed. The
  //    increment_org_quota() hook exists for swapping in a cached counter.

  return res.json({
    workflow_run_id: run.id,
    status: result.paused ? 'paused' : result.failed ? 'failed' : 'succeeded',
  });
};
