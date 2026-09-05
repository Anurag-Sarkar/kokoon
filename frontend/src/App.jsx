import React, { useEffect, useState } from 'react';
import { api, getToken, setToken } from './api.js';
import Auth from './pages/Auth.jsx';
import Devices from './pages/Devices.jsx';
import Dashboard from './pages/Dashboard.jsx';

function useHash() {
  const [hash, setHash] = useState(window.location.hash);
  useEffect(() => {
    const onChange = () => setHash(window.location.hash);
    window.addEventListener('hashchange', onChange);
    return () => window.removeEventListener('hashchange', onChange);
  }, []);
  return hash;
}

export default function App() {
  const [student, setStudent] = useState(null);
  const [checking, setChecking] = useState(!!getToken());
  const hash = useHash();

  useEffect(() => {
    if (!getToken()) return;
    api('/auth/me')
      .then(({ student }) => setStudent(student))
      .catch(() => setToken(null))
      .finally(() => setChecking(false));
  }, []);

  const logout = () => {
    setToken(null);
    setStudent(null);
    window.location.hash = '';
  };

  if (checking) return <div className="page-center muted">Loading…</div>;
  if (!student) return <Auth onAuth={setStudent} />;

  const deviceMatch = hash.match(/^#\/device\/([^/]+)/);

  return (
    <div className="app">
      <header className="topbar">
        <a className="logo" href="#/">
          <span className="logo-dot" /> Kokoon
        </a>
        <div className="topbar-right">
          <span className="muted">{student.name}</span>
          <button className="btn btn-ghost" onClick={logout}>Log out</button>
        </div>
      </header>
      {deviceMatch ? <Dashboard deviceId={deviceMatch[1]} /> : <Devices />}
    </div>
  );
}
