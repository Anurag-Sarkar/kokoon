import React, { useState } from 'react';
import { api, setToken } from '../api.js';

export default function Auth({ onAuth }) {
  const [mode, setMode] = useState('login');
  const [form, setForm] = useState({ name: '', email: '', password: '' });
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const set = (key) => (e) => setForm((f) => ({ ...f, [key]: e.target.value }));

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      const { token, student } = await api(`/auth/${mode}`, { method: 'POST', body: form });
      setToken(token);
      onAuth(student);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="page-center">
      <form className="card auth-card" onSubmit={submit}>
        <div className="logo auth-logo"><span className="logo-dot" /> Kokoon</div>
        <p className="muted">Your Brain Board's dashboard</p>
        {mode === 'register' && (
          <input placeholder="Your name" value={form.name} onChange={set('name')} required />
        )}
        <input type="email" placeholder="Email" value={form.email} onChange={set('email')} required />
        <input
          type="password"
          placeholder="Password"
          value={form.password}
          onChange={set('password')}
          required
          minLength={6}
        />
        {error && <div className="error">{error}</div>}
        <button className="btn btn-primary" disabled={busy}>
          {mode === 'login' ? 'Log in' : 'Create account'}
        </button>
        <button
          type="button"
          className="btn btn-ghost"
          onClick={() => setMode(mode === 'login' ? 'register' : 'login')}
        >
          {mode === 'login' ? 'New here? Create an account' : 'Have an account? Log in'}
        </button>
      </form>
    </div>
  );
}
