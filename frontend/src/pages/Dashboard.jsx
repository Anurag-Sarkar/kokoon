import React, { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../api.js';
import { connectSocket } from '../socket.js';
import AddWidgetModal from '../components/AddWidgetModal.jsx';
import Gauge from '../widgets/Gauge.jsx';
import Chart from '../widgets/Chart.jsx';
import Toggle from '../widgets/Toggle.jsx';
import Slider from '../widgets/Slider.jsx';

const WIDGETS = { gauge: Gauge, chart: Chart, toggle: Toggle, slider: Slider };

export default function Dashboard({ deviceId }) {
  const [device, setDevice] = useState(null);
  const [channels, setChannels] = useState(null);
  const [values, setValues] = useState({});
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState('');
  const knownRef = useRef(new Set());

  const load = useCallback(async () => {
    // One-time HTTPS snapshot on page load; live updates arrive on the socket.
    const { device, channels } = await api(`/devices/${deviceId}/state`);
    setDevice(device);
    setChannels(channels.map(({ name, direction, widget_type }) => ({ name, direction, widget_type })));
    knownRef.current = new Set(channels.map((c) => c.name));
    setValues((prev) => {
      const next = { ...prev };
      for (const c of channels) {
        if (c.value !== null && !(c.name in next)) {
          next[c.name] = { value: c.value, ts: c.updated_at ? new Date(c.updated_at).getTime() : 0 };
        }
      }
      return next;
    });
  }, [deviceId]);

  useEffect(() => {
    load().catch((e) => setError(e.message));
    const socket = connectSocket();
    socket.emit('join', deviceId, (res) => {
      if (res?.error) setError(res.error);
    });
    socket.on('channel:update', (u) => {
      if (u.deviceId !== deviceId) return;
      setValues((prev) => ({ ...prev, [u.name]: { value: u.value, ts: u.ts } }));
      // A channel we don't know yet = auto-registered while this page is open.
      if (!knownRef.current.has(u.name)) load().catch(() => {});
    });
    return () => socket.close();
  }, [deviceId, load]);

  const control = async (name, value) => {
    setValues((prev) => ({ ...prev, [name]: { value, ts: Date.now() } })); // optimistic
    try {
      await api(`/devices/${deviceId}/channels/${name}/value`, { method: 'POST', body: { value } });
    } catch (e) {
      setError(e.message);
      load().catch(() => {});
    }
  };

  const removeWidget = async (name) => {
    if (!window.confirm(`Remove the "${name}" widget? Its history is kept.`)) return;
    try {
      await api(`/devices/${deviceId}/channels/${name}`, { method: 'DELETE' });
      load();
    } catch (e) {
      setError(e.message);
    }
  };

  const addWidget = async (name, widgetType) => {
    await api(`/devices/${deviceId}/channels`, {
      method: 'POST',
      body: { name, widget_type: widgetType },
    });
    setAdding(false);
    load();
  };

  return (
    <main className="content">
      <div className="dash-header">
        <div>
          <a href="#/" className="muted backlink">← Devices</a>
          <h1>{device?.name || deviceId}</h1>
          <div className="muted mono">{deviceId}</div>
        </div>
        <button className="btn btn-primary" onClick={() => setAdding(true)}>+ Add widget</button>
      </div>
      {error && <div className="error" onClick={() => setError('')}>{error}</div>}

      {channels === null ? (
        <p className="muted">Loading…</p>
      ) : channels.length === 0 ? (
        <div className="card empty-card">
          <p>
            No widgets yet. Add one to create a data channel — then use its name in a
            “Send to server” or “Listen from server” block in CodeLab.
          </p>
        </div>
      ) : (
        <div className="widget-grid">
          {channels.map((c) => {
            const Widget = WIDGETS[c.widget_type] || Gauge;
            const v = values[c.name];
            return (
              <div key={c.name} className={`card widget widget-${c.widget_type}`}>
                <div className="widget-head">
                  <span className="widget-name mono">{c.name}</span>
                  <span className={`badge badge-${c.direction}`}>
                    {c.direction === 'publish' ? 'from device' : 'to device'}
                  </span>
                  <button className="widget-close" title="Remove widget" onClick={() => removeWidget(c.name)}>
                    ×
                  </button>
                </div>
                <Widget
                  deviceId={deviceId}
                  name={c.name}
                  value={v?.value}
                  ts={v?.ts}
                  onControl={(value) => control(c.name, value)}
                />
              </div>
            );
          })}
        </div>
      )}

      {adding && <AddWidgetModal onAdd={addWidget} onClose={() => setAdding(false)} />}
    </main>
  );
}
