const { gql } = require('../hasura');

// config: { table: "app_events", values: {...} } — writes into one of the
// app's own tables. Restricted to owner-authored steps at insert time
// (see public_workflow_steps.yaml Layer 2 permission), so by the time this
// runs we already know an owner put it here.
async function runDbWrite(config, input, orgId) {
  const values = { ...(config.values || input || {}), org_id: orgId };
  const data = await gql(
    `mutation ($objects: [app_events_insert_input!]!) {
      insert_app_events(objects: $objects) { returning { id } }
    }`,
    { objects: [values] }
  );
  return { inserted_id: data.insert_app_events.returning[0].id };
}

// config: { condition_path: "text" (dot path into previous output),
//           operator: "eq"|"contains"|"truthy", value: any,
//           on_true: "next label", on_false: "next label" }
// Returns which branch was taken; the runner logs it in output, it doesn't
// change which steps physically run next since steps are a fixed ordered
// list — the branch's *effect* is visible in step output for the demo's
// "conditional_branch that changes behavior based on the LLM's output".
function runConditionalBranch(config, input) {
  const val = getPath(input, config.condition_path);
  let matched;
  switch (config.operator) {
    case 'contains':
      matched = typeof val === 'string' && val.includes(config.value);
      break;
    case 'truthy':
      matched = Boolean(val);
      break;
    default:
      matched = val === config.value;
  }
  return { matched, branch_taken: matched ? config.on_true : config.on_false, evaluated_value: val };
}

function getPath(obj, path) {
  if (!path) return obj;
  return path.split('.').reduce((o, k) => (o == null ? o : o[k]), obj);
}

// notify: the actual send happens in the step_runs_notify_dispatch Event
// Trigger once this step_run flips to 'succeeded' — this just records intent.
function runNotify(config, input) {
  return { queued: true, channel: config.channel || 'slack', message: config.message };
}

module.exports = { runDbWrite, runConditionalBranch, runNotify };
