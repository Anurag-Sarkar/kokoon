import React, { useEffect, useState } from 'react';
import { api } from '../api.js';

function lastSeen(ts) {
  if (!ts) return 'never connected';
  const secs = Math.round((Date.now() - new Date(ts).getTime()) / 1000);
  if (secs < 10) return 'online now';
  if (secs < 60) return `${secs}s ago`;
  if (secs < 3600) return `${Math.round(secs / 60)}m ago`;
  return `${Math.round(secs / 3600)}h ago`;
}

export default function Devices() {
  const [devices, setDevices] = useState(null);
  const [claimId, setClaimId] = useState('');
  const [error, setError] = useState('');

  const load = () => api('/devices').then(({ devices }) => setDevices(devices)).catch((e) => setError(e.message));
  useEffect(() => { load(); }, []);

  const claim = async (e) => {
    e.preventDefault();
    setError('');
    try {
      await api('/devices/claim', { method: 'POST', body: { device_id: claimId.trim() } });
      setClaimId('');
      load();
    } catch (err) {
      setError(err.message);
    }
  };

  return (
    <main className="content">
      <h1>My devices</h1>
      <form className="claim-row" onSubmit={claim}>
        <input
          placeholder="Enter your Brain Board ID (from the QR sticker)"
          value={claimId}
          onChange={(e) => setClaimId(e.target.value)}
          required
        />
        <button className="btn btn-primary">Claim device</button>
      </form>
      {error && <div className="error">{error}</div>}

      {devices === null ? (
        <p className="muted">Loading…</p>
      ) : devices.length === 0 ? (
        <div className="card empty-card">
          <p>No devices yet. Claim your Brain Board with the ID on its QR sticker.</p>
        </div>
      ) : (
        <div className="device-grid">
          {devices.map((d) => (
            <a key={d.device_id} className="card device-card" href={`#/device/${d.device_id}`}>
              <div className="device-name">{d.name || d.device_id}</div>
              <div className="muted mono">{d.device_id}</div>
              <div className={`seen ${lastSeen(d.last_seen_at) === 'online now' ? 'online' : ''}`}>
                {lastSeen(d.last_seen_at)}
              </div>
            </a>
          ))}
        </div>
      )}
    </main>
  );
}
