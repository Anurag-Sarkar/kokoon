import React from 'react';

export default function Toggle({ value, onControl }) {
  const on = value === 1 || value === true || value === '1';
  return (
    <div className="toggle-wrap">
      <button
        type="button"
        className={`toggle ${on ? 'on' : ''}`}
        onClick={() => onControl(on ? 0 : 1)}
        aria-pressed={on}
      >
        <span className="toggle-knob" />
      </button>
      <span className={`toggle-label ${on ? 'on' : ''}`}>{on ? 'ON' : 'OFF'}</span>
    </div>
  );
}
