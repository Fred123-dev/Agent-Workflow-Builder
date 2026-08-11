'use client';
import { useState } from 'react';
import { useSignInEmailPassword, useSignUpEmailPassword } from '@nhost/react';
import { useRouter } from 'next/navigation';

export default function LoginPage() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [mode, setMode] = useState<'in' | 'up'>('in');
  const { signInEmailPassword, isLoading: signingIn, error: signInError } = useSignInEmailPassword();
  const { signUpEmailPassword, isLoading: signingUp, error: signUpError } = useSignUpEmailPassword();
  const router = useRouter();

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const result = mode === 'in' ? await signInEmailPassword(email, password) : await signUpEmailPassword(email, password);
    if (result.isSuccess) router.push('/');
  }

  return (
    <main style={{ maxWidth: 360, margin: '80px auto' }}>
      <h1>Agent Workflow Builder</h1>
      <form onSubmit={submit} className="card">
        <div style={{ marginBottom: 8 }}>
          <input placeholder="email" value={email} onChange={(e) => setEmail(e.target.value)} style={{ width: '100%' }} />
        </div>
        <div style={{ marginBottom: 8 }}>
          <input
            placeholder="password"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            style={{ width: '100%' }}
          />
        </div>
        <button type="submit" disabled={signingIn || signingUp}>
          {mode === 'in' ? 'Sign in' : 'Sign up'}
        </button>
        <button type="button" className="secondary" style={{ marginLeft: 8 }} onClick={() => setMode(mode === 'in' ? 'up' : 'in')}>
          {mode === 'in' ? 'Need an account?' : 'Have an account?'}
        </button>
        {(signInError || signUpError) && <p style={{ color: '#ff9a9a' }}>{signInError?.message || signUpError?.message}</p>}
      </form>
    </main>
  );
}
