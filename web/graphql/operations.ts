import { gql } from '@apollo/client';

// Required: org's workflows with steps, triggers, and most recent run status
export const GET_ORG_WORKFLOWS = gql`
  query GetOrgWorkflows($orgId: uuid!) {
    organizations_by_pk(id: $orgId) {
      id
      name
      usage {
        quota_calls_used
        quota_calls_allowed
        avg_run_duration_seconds
      }
    }
    workflows(where: { org_id: { _eq: $orgId } }, order_by: { created_at: desc }) {
      id
      name
      description
      steps(order_by: { step_order: asc }) {
        id
        type
        name
        step_order
        config
      }
      triggers {
        id
        type
        config
        is_active
      }
      runs(order_by: { started_at: desc }, limit: 1) {
        id
        status
        started_at
      }
    }
  }
`;

// Required: create/edit a workflow, its steps, and its triggers
export const UPSERT_WORKFLOW = gql`
  mutation UpsertWorkflow(
    $orgId: uuid!
    $name: String!
    $description: String
    $createdBy: uuid!
    $steps: [workflow_steps_insert_input!]!
    $triggers: [workflow_triggers_insert_input!]!
  ) {
    insert_workflows_one(
      object: {
        org_id: $orgId
        name: $name
        description: $description
        created_by: $createdBy
        steps: { data: $steps }
        triggers: { data: $triggers }
      }
    ) {
      id
      name
    }
  }
`;

export const EDIT_WORKFLOW_STEPS = gql`
  mutation EditWorkflowSteps($workflowId: uuid!, $steps: [workflow_steps_insert_input!]!) {
    delete_workflow_steps(where: { workflow_id: { _eq: $workflowId } }) {
      affected_rows
    }
    insert_workflow_steps(objects: $steps) {
      affected_rows
    }
  }
`;

// Required: approve a paused approval_gate step (calls the Action)
export const APPROVE_STEP = gql`
  mutation ApproveStep($stepRunId: uuid!, $approve: Boolean!) {
    approveStep(step_run_id: $stepRunId, approve: $approve) {
      step_run_id
      status
    }
  }
`;

export const TRIGGER_WORKFLOW_RUN = gql`
  mutation TriggerWorkflowRun($workflowId: uuid!) {
    triggerWorkflowRun(workflow_id: $workflowId) {
      workflow_run_id
      status
    }
  }
`;

// Required: subscription on step_runs filtered to a workflow_run_id, for
// live step-by-step progress including the "paused, awaiting approval" state
export const STEP_RUNS_SUBSCRIPTION = gql`
  subscription StepRuns($workflowRunId: uuid!) {
    workflow_runs_by_pk(id: $workflowRunId) {
      id
      status
      started_at
      finished_at
    }
    step_runs(where: { workflow_run_id: { _eq: $workflowRunId } }, order_by: { started_at: asc }) {
      id
      status
      output
      error
      attempt_count
      approved_by
      approved_at
      started_at
      finished_at
      workflow_step {
        name
        type
        step_order
      }
    }
  }
`;

export const GET_MY_ORGS = gql`
  query GetMyOrgs {
    org_members {
      role
      org {
        id
        name
      }
    }
  }
`;
