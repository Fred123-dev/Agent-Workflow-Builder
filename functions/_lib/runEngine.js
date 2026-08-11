const { gql } = require('./hasura');
const { runLlmCall } = require('./steps/llmCall');
const { runHttpRequest } = require('./steps/httpRequest');
const { runDbWrite, runConditionalBranch, runNotify } = require('./steps/misc');

async function setRunStatus(runId, status, extra = {}) {
  await gql(
    `mutation ($id: uuid!, $set: workflow_runs_set_input!) {
      update_workflow_runs_by_pk(pk_columns: { id: $id }, _set: $set) { id }
    }`,
    { id: runId, set: { status, ...extra } }
  );
}

async function upsertStepRun(id, set) {
  await gql(
    `mutation ($id: uuid!, $set: step_runs_set_input!) {
      update_step_runs_by_pk(pk_columns: { id: $id }, _set: $set) { id }
    }`,
    { id, set }
  );
}

async function createStepRun(runId, orgId, stepId) {
  const data = await gql(
    `mutation ($obj: step_runs_insert_input!) {
      insert_step_runs_one(object: $obj) { id }
    }`,
    { obj: { workflow_run_id: runId, org_id: orgId, workflow_step_id: stepId, status: 'pending' } }
  );
  return data.insert_step_runs_one.id;
}

// Runs steps [fromIndex..] of `steps` in order for the given run. Stops and
// leaves the run 'paused' on hitting an unapproved approval_gate; otherwise
// runs to completion and marks the run 'succeeded' or 'failed'.
// `previousOutput` seeds the pipeline when resuming after an approval.
async function executeSteps(run, steps, fromIndex, previousOutput) {
  let output = previousOutput;

  for (let i = fromIndex; i < steps.length; i++) {
    const step = steps[i];
    const stepRunId = await createStepRun(run.id, run.org_id, step.id);
    await upsertStepRun(stepRunId, { status: 'running', input: output ?? {}, started_at: new Date().toISOString() });

    try {
      if (step.type === 'approval_gate') {
        // Pause here. approveStep() picks up execution from i+1 later.
        await upsertStepRun(stepRunId, { status: 'paused_awaiting_approval' });
        await setRunStatus(run.id, 'paused');
        return { paused: true, pausedAtStepRunId: stepRunId, pausedAtIndex: i };
      }

      let result;
      switch (step.type) {
        case 'llm_call':
          result = await runLlmCall(step.config, output);
          break;
        case 'http_request':
          result = await runHttpRequest(step.config, output);
          break;
        case 'db_write':
          result = await runDbWrite(step.config, output, run.org_id);
          break;
        case 'conditional_branch':
          result = runConditionalBranch(step.config, output);
          break;
        case 'notify':
          result = runNotify(step.config, output);
          break;
        default:
          throw new Error(`Unknown step type: ${step.type}`);
      }

      // llm_call/http_request report how many attempts they actually took
      // (1, or 2 if the built-in retry fired); other step types are always
      // single-attempt. Strip the internal marker before persisting output.
      const attemptCount = result && typeof result === 'object' && '_attempts' in result ? result._attempts : 1;
      if (result && typeof result === 'object' && '_attempts' in result) {
        const { _attempts, ...rest } = result;
        result = rest;
      }

      await upsertStepRun(stepRunId, {
        status: 'succeeded',
        output: result,
        finished_at: new Date().toISOString(),
        attempt_count: attemptCount,
      });
      output = result;
    } catch (err) {
      await upsertStepRun(stepRunId, {
        status: 'failed',
        error: String(err.message || err),
        finished_at: new Date().toISOString(),
        attempt_count: err.attempts || 1,
      });
      await setRunStatus(run.id, 'failed', { finished_at: new Date().toISOString() });
      return { paused: false, failed: true };
    }
  }

  await setRunStatus(run.id, 'succeeded', { finished_at: new Date().toISOString() });
  return { paused: false, failed: false };
}

module.exports = { executeSteps, setRunStatus, upsertStepRun };
