import React from 'react';

function niceMax(v) {
  if (v <= 100) return 100;
  const pow = 10 ** Math.floor(Math.log10(v));
  return Math.ceil(v / pow) * pow;
}

export default function Gauge({ value }) {
  const num = typeof value === 'number' ? value : parseFloat(value);
  const hasValue = Number.isFinite(num);
  const max = hasValue ? niceMax(Math.abs(num)) : 100;
  const frac = hasValue ? Math.min(Math.max(num / max, 0), 1) : 0;

  return (
    <div className="gauge">
      <svg viewBox="0 0 200 115">
        <path
          d="M 20 105 A 80 80 0 0 1 180 105"
          fill="none"
          stroke="var(--track)"
          strokeWidth="16"
          strokeLinecap="round"
        />
        <path
          d="M 20 105 A 80 80 0 0 1 180 105"
          fill="none"
          stroke="var(--accent)"
          strokeWidth="16"
          strokeLinecap="round"
          pathLength="100"
          strokeDasharray={`${frac * 100} 100`}
          style={{ transition: 'stroke-dasharray 0.4s ease' }}
        />
        <text x="100" y="88" textAnchor="middle" className="gauge-value">
          {hasValue ? Math.round(num * 100) / 100 : '—'}
        </text>
        <text x="20" y="115" textAnchor="middle" className="gauge-scale">0</text>
        <text x="180" y="115" textAnchor="middle" className="gauge-scale">{max}</text>
      </svg>
    </div>
  );
}
