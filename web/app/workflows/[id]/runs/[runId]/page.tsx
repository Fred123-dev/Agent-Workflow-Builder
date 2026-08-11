'use client';
import { useSubscription, useMutation } from '@apollo/client';
import { STEP_RUNS_SUBSCRIPTION, APPROVE_STEP } from '../../../../../graphql/operations';

export default function RunView({ params }: { params: { id: string; runId: string } }) {
  const { data, loading } = useSubscription(STEP_RUNS_SUBSCRIPTION, {
    variables: { workflowRunId: params.runId },
  });
  const [approve, { loading: approving }] = useMutation(APPROVE_STEP);

  if (loading && !data) return <p style={{ padding: 40 }}>Connecting to live run…</p>;

  const run = data?.workflow_runs_by_pk;
  const stepRuns = data?.step_runs ?? [];

  async function respond(stepRunId: string, decision: boolean) {
    await approve({ variables: { stepRunId, approve: decision } });
  }

  return (
    <main style={{ maxWidth: 720, margin: '40px auto' }}>
      <h1>
        Run status: <span className={`badge ${run?.status}`}>{run?.status}</span>
      </h1>
      {stepRuns.map((sr: any) => (
        <div key={sr.id} className="card">
          <div style={{ display: 'flex', justifyContent: 'space-between' }}>
            <strong>
              {sr.workflow_step.step_order + 1}. {sr.workflow_step.name} ({sr.workflow_step.type})
            </strong>
            <span className={`badge ${sr.status}`}>{sr.status.replace(/_/g, ' ')}</span>
          </div>
          {sr.output && (
            <pre style={{ fontSize: 12, background: '#0b0d12', padding: 8, borderRadius: 6, overflowX: 'auto' }}>
              {JSON.stringify(sr.output, null, 2)}
            </pre>
          )}
          {sr.error && <p style={{ color: '#ff9a9a' }}>{sr.error}</p>}

          {sr.status === 'paused_awaiting_approval' && (
            <div style={{ marginTop: 8 }}>
              <button onClick={() => respond(sr.id, true)} disabled={approving}>
                Approve
              </button>
              <button className="secondary" style={{ marginLeft: 8 }} onClick={() => respond(sr.id, false)} disabled={approving}>
                Reject
              </button>
            </div>
          )}
          {sr.approved_by && <p style={{ fontSize: 12, opacity: 0.7 }}>Approved by {sr.approved_by} at {sr.approved_at}</p>}
        </div>
      ))}
    </main>
  );
}
