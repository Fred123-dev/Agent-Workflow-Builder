'use client';
import { useState } from 'react';
import { useQuery, useMutation, gql } from '@apollo/client';
import { useRouter } from 'next/navigation';
import { EDIT_WORKFLOW_STEPS, TRIGGER_WORKFLOW_RUN } from '../../../graphql/operations';

const GET_WORKFLOW = gql`
  query GetWorkflow($id: uuid!) {
    workflows_by_pk(id: $id) {
      id
      name
      org_id
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
    }
  }
`;

const STEP_TYPES = ['llm_call', 'http_request', 'db_write', 'notify', 'conditional_branch', 'approval_gate'];
const TRIGGER_TYPES = ['manual', 'webhook', 'scheduled', 'db_event'];

export default function WorkflowBuilder({ params }: { params: { id: string } }) {
  const router = useRouter();
  const { data, loading, refetch } = useQuery(GET_WORKFLOW, { variables: { id: params.id } });
  const [saveSteps, { loading: saving }] = useMutation(EDIT_WORKFLOW_STEPS);
  const [triggerRun] = useMutation(TRIGGER_WORKFLOW_RUN);
  const [steps, setSteps] = useState<any[]>([]);
  const [hydrated, setHydrated] = useState(false);

  if (!loading && !hydrated && data?.workflows_by_pk) {
    setSteps(data.workflows_by_pk.steps.map((s: any) => ({ ...s })));
    setHydrated(true);
  }

  function addStep() {
    setSteps([...steps, { id: `new-${Date.now()}`, type: 'llm_call', name: 'New step', step_order: steps.length, config: {} }]);
  }
  function move(i: number, dir: -1 | 1) {
    const next = [...steps];
    const j = i + dir;
    if (j < 0 || j >= next.length) return;
    [next[i], next[j]] = [next[j], next[i]];
    setSteps(next.map((s, idx) => ({ ...s, step_order: idx })));
  }
  function remove(i: number) {
    setSteps(steps.filter((_, idx) => idx !== i).map((s, idx) => ({ ...s, step_order: idx })));
  }
  function updateField(i: number, field: string, value: any) {
    const next = [...steps];
    next[i] = { ...next[i], [field]: value };
    setSteps(next);
  }

  async function save() {
    await saveSteps({
      variables: {
        workflowId: params.id,
        steps: steps.map((s) => ({
          workflow_id: params.id,
          type: s.type,
          name: s.name,
          step_order: s.step_order,
          config: s.config,
        })),
      },
    });
    refetch();
  }

  async function run() {
    const { data } = await triggerRun({ variables: { workflowId: params.id } });
    const runId = data?.triggerWorkflowRun?.workflow_run_id;
    if (runId) router.push(`/workflows/${params.id}/runs/${runId}`);
  }

  if (loading || !hydrated) return <p style={{ padding: 40 }}>Loading…</p>;

  return (
    <main style={{ maxWidth: 720, margin: '40px auto' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between' }}>
        <h1>{data.workflows_by_pk.name}</h1>
        <div style={{ display: 'flex', gap: 8 }}>
          <button className="secondary" onClick={save} disabled={saving}>
            {saving ? 'Saving…' : 'Save steps'}
          </button>
          <button onClick={run}>Run</button>
        </div>
      </div>

      <h3>Steps</h3>
      {steps.map((s, i) => (
        <div key={s.id} className="card">
          <div style={{ display: 'flex', gap: 8, marginBottom: 6 }}>
            <select value={s.type} onChange={(e) => updateField(i, 'type', e.target.value)}>
              {STEP_TYPES.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
            <input value={s.name} onChange={(e) => updateField(i, 'name', e.target.value)} style={{ flex: 1 }} />
            <button className="secondary" onClick={() => move(i, -1)}>
              ↑
            </button>
            <button className="secondary" onClick={() => move(i, 1)}>
              ↓
            </button>
            <button className="secondary" onClick={() => remove(i)}>
              ✕
            </button>
          </div>
          <textarea
            style={{ width: '100%', fontFamily: 'monospace', fontSize: 12 }}
            rows={3}
            value={JSON.stringify(s.config, null, 2)}
            onChange={(e) => {
              try {
                updateField(i, 'config', JSON.parse(e.target.value));
              } catch {
                /* ignore invalid JSON until it parses again */
              }
            }}
          />
        </div>
      ))}
      <button className="secondary" onClick={addStep}>
        + Add step
      </button>

      <h3 style={{ marginTop: 24 }}>Triggers</h3>
      {data.workflows_by_pk.triggers.map((t: any) => (
        <div key={t.id} className="card">
          {t.type} — {t.is_active ? 'active' : 'inactive'}
          {t.type === 'webhook' && (
            <div style={{ marginTop: 6, fontFamily: 'monospace', fontSize: 12, wordBreak: 'break-all' }}>
              curl -X POST &lt;functions-url&gt;/webhookTrigger -H "content-type: application/json" -d '
              {JSON.stringify({ input: { trigger_id: t.id, secret: t.config?.secret || '<secret from config>' } })}'
            </div>
          )}
        </div>
      ))}
      <TriggerForm workflowId={params.id} onAdded={refetch} />
    </main>
  );
}

const ADD_TRIGGER = gql`
  mutation AddTrigger($workflowId: uuid!, $type: trigger_type!, $config: jsonb!) {
    insert_workflow_triggers_one(object: { workflow_id: $workflowId, type: $type, config: $config }) {
      id
    }
  }
`;

function TriggerForm({ workflowId, onAdded }: { workflowId: string; onAdded: () => void }) {
  const [type, setType] = useState('manual');
  const [config, setConfig] = useState('{}');
  const [addTrigger] = useMutation(ADD_TRIGGER);

  async function submit() {
    try {
      await addTrigger({ variables: { workflowId, type, config: JSON.parse(config) } });
      onAdded();
    } catch (e: any) {
      alert(e.message);
    }
  }

  return (
    <div className="card">
      <select value={type} onChange={(e) => setType(e.target.value)}>
        {TRIGGER_TYPES.map((t) => (
          <option key={t} value={t}>
            {t}
          </option>
        ))}
      </select>
      <input style={{ marginLeft: 8, width: 300 }} value={config} onChange={(e) => setConfig(e.target.value)} />
      <button style={{ marginLeft: 8 }} onClick={submit}>
        Add trigger
      </button>
    </div>
  );
}
