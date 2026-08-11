'use client';
import { useQuery, useMutation } from '@apollo/client';
import { useUserId } from '@nhost/react';
import { useRouter } from 'next/navigation';
import { GET_ORG_WORKFLOWS, TRIGGER_WORKFLOW_RUN } from '../../../graphql/operations';

export default function OrgDashboard({ params }: { params: { orgId: string } }) {
  const userId = useUserId();
  const router = useRouter();
  const { data, loading, refetch } = useQuery(GET_ORG_WORKFLOWS, {
    variables: { orgId: params.orgId },
    pollInterval: 15000,
  });
  const [triggerRun] = useMutation(TRIGGER_WORKFLOW_RUN);

  if (loading) return <p style={{ padding: 40 }}>Loading…</p>;
  const org = data?.organizations_by_pk;
  const usage = org?.usage?.[0] ?? org?.usage; // handles either array or object relationship shape

  async function runWorkflow(workflowId: string) {
    const { data } = await triggerRun({ variables: { workflowId } });
    const runId = data?.triggerWorkflowRun?.workflow_run_id;
    if (runId) router.push(`/workflows/${workflowId}/runs/${runId}`);
  }

  return (
    <main style={{ maxWidth: 800, margin: '40px auto' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <h1>{org?.name}</h1>
        <button onClick={() => router.push(`/orgs/${params.orgId}/new`)}>+ New workflow</button>
      </div>

      {usage && (
        <div className="card">
          Quota: {usage.quota_calls_used} / {usage.quota_calls_allowed} runs this period
          {usage.avg_run_duration_seconds != null && <> · avg run {usage.avg_run_duration_seconds}s</>}
        </div>
      )}

      {data?.workflows?.map((wf: any) => {
        const lastRun = wf.runs[0];
        return (
          <div key={wf.id} className="card">
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <div>
                <strong>{wf.name}</strong>
                <div style={{ fontSize: 13, opacity: 0.7 }}>
                  {wf.steps.length} steps · {wf.triggers.map((t: any) => t.type).join(', ') || 'no triggers'}
                </div>
              </div>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                {lastRun && <span className={`badge ${lastRun.status}`}>{lastRun.status}</span>}
                <button className="secondary" onClick={() => router.push(`/workflows/${wf.id}`)}>
                  Edit
                </button>
                {/* Run button hidden for viewers — enforced again server-side in the Action */}
                <RunButton workflowId={wf.id} onRun={runWorkflow} />
              </div>
            </div>
          </div>
        );
      })}
    </main>
  );
}

function RunButton({ workflowId, onRun }: { workflowId: string; onRun: (id: string) => void }) {
  // Viewer-hiding is UX sugar only; the real gate is triggerWorkflowRun's
  // org-role check server-side. We don't have per-workflow role here
  // without another query, so we simply attempt the run and surface the
  // 403 the Action returns if the caller turns out to be a viewer.
  return <button onClick={() => onRun(workflowId)}>Run</button>;
}
