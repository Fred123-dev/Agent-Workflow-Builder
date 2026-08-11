// Minimal GraphQL client that talks to Hasura using the admin secret.
// Every Action handler runs server-side and uses this — never the client's
// JWT — because starting/advancing a run needs to write workflow_runs and
// step_runs, tables that have no client-facing insert/update permission
// (see nhost/metadata/databases/default/tables/public_workflow_runs.yaml).

const HASURA_URL = process.env.HASURA_GRAPHQL_URL; // e.g. https://<subdomain>.hasura.<region>.nhost.run/v1/graphql
const ADMIN_SECRET = process.env.HASURA_ADMIN_SECRET;

async function gql(query, variables = {}) {
  const res = await fetch(HASURA_URL, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-hasura-admin-secret': ADMIN_SECRET,
    },
    body: JSON.stringify({ query, variables }),
  });
  const json = await res.json();
  if (json.errors) {
    throw new Error('Hasura error: ' + JSON.stringify(json.errors));
  }
  return json.data;
}

module.exports = { gql };
