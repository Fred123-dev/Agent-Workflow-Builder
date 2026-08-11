const { gql } = require('./_lib/hasura');

// Fired by the step_runs_notify_dispatch Hasura Event Trigger on every
// UPDATE to step_runs.status. We only act when the row now says 'succeeded'
// AND the parent workflow_step is actually a 'notify' step — cheaper than
// maintaining a second, narrower event trigger per step type.
module.exports = async (req, res) => {
  const event = req.body.event;
  if (!event || event.data.new.status !== 'succeeded') return res.json({ skipped: true });

  const stepRunId = event.data.new.id;
  const data = await gql(
    `query ($id: uuid!) {
      step_runs_by_pk(id: $id) {
        output
        workflow_step { type config }
      }
    }`,
    { id: stepRunId }
  );
  const stepRun = data.step_runs_by_pk;
  if (!stepRun || stepRun.workflow_step.type !== 'notify') return res.json({ skipped: true });

  const { channel, webhook_url, message } = stepRun.workflow_step.config;
  const text = message || 'Workflow step completed.';

  if (channel === 'slack' && webhook_url) {
    await fetch(webhook_url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ text }),
    });
  } else {
    // No webhook configured — log instead of failing the pipeline.
    console.log(`[notify:stub] would send "${text}" via ${channel || 'slack'}`);
  }

  return res.json({ sent: true });
};
