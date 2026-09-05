import React, { useState } from 'react';

const TYPES = [
  { type: 'gauge', label: 'Gauge', icon: '◔', dir: 'device → dashboard', hint: 'sensor1' },
  { type: 'chart', label: 'Chart', icon: '📈', dir: 'device → dashboard', hint: 'sensor1' },
  { type: 'toggle', label: 'Toggle', icon: '⏻', dir: 'dashboard → device', hint: 'led1' },
  { type: 'slider', label: 'Slider', icon: '🎚', dir: 'dashboard → device', hint: 'speed1' },
];

export default function AddWidgetModal({ onAdd, onClose }) {
  const [type, setType] = useState('gauge');
  const [name, setName] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const selected = TYPES.find((t) => t.type === type);

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      await onAdd(name.trim(), type);
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <form className="card modal" onClick={(e) => e.stopPropagation()} onSubmit={submit}>
        <h2>Add a widget</h2>
        <p className="muted">
          The widget's name becomes a data channel you can pick in CodeLab blocks.
        </p>
        <div className="type-grid">
          {TYPES.map((t) => (
            <button
              type="button"
              key={t.type}
              className={`type-card ${type === t.type ? 'selected' : ''} widget-${t.type}`}
              onClick={() => setType(t.type)}
            >
              <span className="type-icon">{t.icon}</span>
              <span className="type-label">{t.label}</span>
              <span className="type-dir">{t.dir}</span>
            </button>
          ))}
        </div>
        <input
          placeholder={`Channel name, e.g. ${selected.hint}`}
          value={name}
          onChange={(e) => setName(e.target.value)}
          pattern="[a-zA-Z_][a-zA-Z0-9_]{0,31}"
          title="Start with a letter; letters, numbers and _ only"
          required
          autoFocus
        />
        {error && <div className="error">{error}</div>}
        <div className="modal-actions">
          <button type="button" className="btn btn-ghost" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" disabled={busy}>Add widget</button>
        </div>
      </form>
    </div>
  );
}
