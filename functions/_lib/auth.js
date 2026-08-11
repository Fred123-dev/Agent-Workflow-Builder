const { gql } = require('./hasura');

// Hasura Action requests carry the caller's identity in session_variables
// (from the verified JWT), not in a role we can trust from the client body.
function getUserId(req) {
  const sv = req.body.session_variables || {};
  return sv['x-hasura-user-id'];
}

function verifyActionSecret(req) {
  return req.headers['x-action-secret'] === process.env.ACTION_SECRET;
}

// Resolves the caller's role WITHIN a specific org — never a global role,
// since the same user can be owner in one org and viewer in another.
async function getRoleInOrg(userId, orgId) {
  const data = await gql(
    `query ($userId: uuid!, $orgId: uuid!) {
      org_members(where: { user_id: { _eq: $userId }, org_id: { _eq: $orgId } }) {
        role
      }
    }`,
    { userId, orgId }
  );
  return data.org_members[0]?.role ?? null;
}

module.exports = { getUserId, verifyActionSecret, getRoleInOrg };
