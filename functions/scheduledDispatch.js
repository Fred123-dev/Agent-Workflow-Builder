const cronParser = require('cron-parser');
const { gql } = require('./_lib/hasura');
const { executeSteps } = require('./_lib/runEngine');

// Not itself a cron daemon — nhost/Vercel functions are request-driven, so
// this expects to be invoked on a fixed cadence (every minute) by whatever
// scheduler your deploy target offers. It then figures out which
// `scheduled` triggers are actually due right now based on their cron
// expression, and runs those. See README "Scheduled trigger" section.
module.exports = async (req, res) => {
  const now = new Date();
  const data = await gql(
    `query {
      workflow_triggers(where: { type: { _eq: "scheduled" }, is_active: { _eq: true } }) {
        workflow_id config
        workflow { org_id steps(order_by: { step_order: asc }) { id type config step_order } }
      }
    }`
  );

  const started = [];
  for (const trig of data.workflow_triggers) {
    const cron = trig.config?.cron;
    if (!cron) continue;
    try {
      const interval = cronParser.parseExpression(cron, { currentDate: new Date(now.getTime() - 60000) });
      const next = interval.next().toDate();
      // due if the last scheduled fire time falls within the last minute
      if (Math.abs(next.getTime() - now.getTime()) > 60000) continue;
    } catch {
      continue; // invalid cron expression — skip rather than crash the batch
    }

    const runData = await gql(
      `mutation ($obj: workflow_runs_insert_input!) {
        insert_workflow_runs_one(object: $obj) { id org_id }
      }`,
      { obj: { workflow_id: trig.workflow_id, org_id: trig.workflow.org_id, status: 'running', trigger_type: 'scheduled' } }
    );
    await executeSteps(runData.insert_workflow_runs_one, trig.workflow.steps, 0, {});
    started.push(trig.workflow_id);
  }

  return res.json({ started_workflows: started });
};
