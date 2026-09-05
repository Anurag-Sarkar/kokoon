import React, { useEffect, useRef, useState } from 'react';
import { api } from '../api.js';

const MAX_POINTS = 120;
const W = 320;
const H = 140;
const PAD = 6;

export default function Chart({ deviceId, name, value, ts }) {
  const [points, setPoints] = useState([]);
  const lastTsRef = useRef(0);

  useEffect(() => {
    api(`/devices/${deviceId}/channels/${name}/history?hours=24`)
      .then(({ points }) => {
        const nums = points
          .map((p) => ({ ts: Number(p.ts), v: typeof p.value === 'number' ? p.value : parseFloat(p.value) }))
          .filter((p) => Number.isFinite(p.v));
        setPoints(nums.slice(-MAX_POINTS));
        if (nums.length) lastTsRef.current = nums[nums.length - 1].ts;
      })
      .catch(() => {});
  }, [deviceId, name]);

  // Live appends from the socket.
  useEffect(() => {
    const v = typeof value === 'number' ? value : parseFloat(value);
    if (!Number.isFinite(v) || !ts || ts <= lastTsRef.current) return;
    lastTsRef.current = ts;
    setPoints((prev) => [...prev.slice(-(MAX_POINTS - 1)), { ts, v }]);
  }, [value, ts]);

  if (points.length < 2) {
    return <div className="chart-empty muted">Waiting for data…</div>;
  }

  const vals = points.map((p) => p.v);
  let min = Math.min(...vals);
  let max = Math.max(...vals);
  if (min === max) { min -= 1; max += 1; }
  const span = max - min;
  const x = (i) => PAD + (i / (points.length - 1)) * (W - PAD * 2);
  const y = (v) => H - PAD - ((v - min) / span) * (H - PAD * 2);
  const path = points.map((p, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(p.v).toFixed(1)}`).join(' ');
  const area = `${path} L${x(points.length - 1).toFixed(1)},${H - PAD} L${PAD},${H - PAD} Z`;

  return (
    <div className="chart">
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none">
        <path d={area} fill="var(--accent)" opacity="0.12" />
        <path d={path} fill="none" stroke="var(--accent)" strokeWidth="2.5" strokeLinejoin="round" />
      </svg>
      <div className="chart-scale">
        <span>{Math.round(max * 100) / 100}</span>
        <span>{Math.round(min * 100) / 100}</span>
      </div>
      <div className="chart-now">{Math.round(points[points.length - 1].v * 100) / 100}</div>
    </div>
  );
}
