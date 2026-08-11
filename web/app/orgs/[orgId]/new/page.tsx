'use client';
import { useState } from 'react';
import { useMutation } from '@apollo/client';
import { useUserId } from '@nhost/react';
import { useRouter } from 'next/navigation';
import { UPSERT_WORKFLOW } from '../../../../graphql/operations';

export default function NewWorkflow({ params }: { params: { orgId: string } }) {
  const [name, setName] = useState('');
  const userId = useUserId();
  const [create, { loading }] = useMutation(UPSERT_WORKFLOW);
  const router = useRouter();

  async function submit() {
    const { data } = await create({
      variables: { orgId: params.orgId, name, description: '', createdBy: userId, steps: [], triggers: [] },
    });
    const id = data?.insert_workflows_one?.id;
    if (id) router.push(`/workflows/${id}`);
  }

  return (
    <main style={{ maxWidth: 480, margin: '80px auto' }}>
      <h1>New workflow</h1>
      <div className="card">
        <input placeholder="Workflow name" value={name} onChange={(e) => setName(e.target.value)} style={{ width: '100%', marginBottom: 8 }} />
        <button onClick={submit} disabled={loading || !name}>
          Create
        </button>
      </div>
    </main>
  );
}
