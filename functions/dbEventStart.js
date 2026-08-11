const { gql } = require('./_lib/hasura');
const { executeSteps } = require('./_lib/runEngine');

// Fired by the app_events_db_trigger Hasura Event Trigger on every INSERT
// into public.app_events. Any workflow with an active db_event trigger
// whose config.table === "app_events" and (optional) config.event_type
// matches gets auto-started — no button click, no manual/webhook call.
module.exports = async (req, res) => {
  const event = req.body.event;
  const row = event.data.new;

  const data = await gql(
    `query ($orgId: uuid!) {
      workflow_triggers(where: {
        type: { _eq: "db_event" },
        is_active: { _eq: true },
        workflow: { org_id: { _eq: $orgId } }
      }) {
        workflow_id config
        workflow { org_id steps(order_by: { step_order: asc }) { id type config step_order } }
      }
    }`,
    { orgId: row.org_id }
  );

  const started = [];
  for (const trig of data.workflow_triggers) {
    if (trig.config?.table && trig.config.table !== 'app_events') continue;
    if (trig.config?.event_type && trig.config.event_type !== row.event_type) continue;

    const runData = await gql(
      `mutation ($obj: workflow_runs_insert_input!) {
        insert_workflow_runs_one(object: $obj) { id org_id }
      }`,
      {
        obj: {
          workflow_id: trig.workflow_id,
          org_id: trig.workflow.org_id,
          status: 'running',
          trigger_type: 'db_event',
        },
      }
    );
    await executeSteps(runData.insert_workflow_runs_one, trig.workflow.steps, 0, { source_event: row });
    started.push(trig.workflow_id);
  }

  return res.json({ started_workflows: started });
};
