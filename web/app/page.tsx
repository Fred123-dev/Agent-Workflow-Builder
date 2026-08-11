'use client';
import { useAuthenticationStatus } from '@nhost/react';
import { useQuery } from '@apollo/client';
import { useRouter } from 'next/navigation';
import { useEffect } from 'react';
import { GET_MY_ORGS } from '../graphql/operations';

export default function Home() {
  const { isAuthenticated, isLoading } = useAuthenticationStatus();
  const router = useRouter();

  useEffect(() => {
    if (!isLoading && !isAuthenticated) router.push('/login');
  }, [isLoading, isAuthenticated, router]);

  const { data, loading } = useQuery(GET_MY_ORGS, { skip: !isAuthenticated });

  if (isLoading || loading) return <p style={{ padding: 40 }}>Loading…</p>;
  if (!isAuthenticated) return null;

  return (
    <main style={{ maxWidth: 640, margin: '60px auto' }}>
      <h1>Your organizations</h1>
      {data?.org_members?.map((m: any) => (
        <div key={m.org.id} className="card" style={{ display: 'flex', justifyContent: 'space-between' }}>
          <div>
            <strong>{m.org.name}</strong> <span className="badge pending">{m.role}</span>
          </div>
          <button onClick={() => router.push(`/orgs/${m.org.id}`)}>Open</button>
        </div>
      ))}
      {!data?.org_members?.length && <p>You're not a member of any organization yet.</p>}
    </main>
  );
}
