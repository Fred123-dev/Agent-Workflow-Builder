const { gql } = require('./_lib/hasura');
const { getUserId, getRoleInOrg } = require('./_lib/auth');
const { executeSteps, setRunStatus, upsertStepRun } = require('./_lib/runEngine');

module.exports = async (req, res) => {
  const userId = getUserId(req);
  const { step_run_id, approve } = req.body.input;
  if (!userId) return res.status(401).json({ message: 'Not authenticated' });

  // 1. Load the paused step_run, its run, and the full ordered step list
  const data = await gql(
    `query ($id: uuid!) {
      step_runs_by_pk(id: $id) {
        id status org_id workflow_run_id
        workflow_step { step_order }
        workflow_run {
          id org_id workflow_id status
          workflow { steps(order_by: { step_order: asc }) { id type config step_order } }
        }
      }
    }`,
    { id: step_run_id }
  );
  const stepRun = data.step_runs_by_pk;
  if (!stepRun) return res.status(404).json({ message: 'step_run not found' });
  if (stepRun.status !== 'paused_awaiting_approval') {
    return res.status(409).json({ message: 'This step is not awaiting approval.' });
  }

  // 2. This is the mid-execution authorization decision the assignment
  //    calls out explicitly: a database permission alone can't express "the
  //    approver must be owner/editor in THIS run's org, checked at the
  //    moment of resuming" — so it's enforced here, in code, not as a
  //    Hasura row permission.
  const role = await getRoleInOrg(userId, stepRun.org_id);
  if (!role || !['owner', 'editor'].includes(role)) {
    return res.status(403).json({ message: 'Only an owner or editor in this organization can approve this step.' });
  }

  if (!approve) {
    await upsertStepRun(step_run_id, {
      status: 'failed',
      error: `Rejected by ${userId}`,
      finished_at: new Date().toISOString(),
    });
    await setRunStatus(stepRun.workflow_run.id, 'failed', { finished_at: new Date().toISOString() });
    return res.json({ step_run_id, status: 'failed' });
  }

  await upsertStepRun(step_run_id, {
    status: 'succeeded',
    approved_by: userId,
    approved_at: new Date().toISOString(),
    finished_at: new Date().toISOString(),
    output: { approved: true },
  });
  await setRunStatus(stepRun.workflow_run.id, 'running');

  // 3. Resume execution right after the approval_gate step
  const steps = stepRun.workflow_run.workflow.steps;
  const resumeIndex = steps.findIndex((s) => s.step_order === stepRun.workflow_step.step_order) + 1;
  const result = await executeSteps(stepRun.workflow_run, steps, resumeIndex, { approved: true });

  return res.json({
    step_run_id,
    status: result.paused ? 'paused' : result.failed ? 'failed' : 'succeeded',
  });
};
