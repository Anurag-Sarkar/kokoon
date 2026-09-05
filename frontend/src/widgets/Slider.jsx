import React, { useEffect, useState } from 'react';

export default function Slider({ value, onControl }) {
  const remote = typeof value === 'number' ? value : parseFloat(value) || 0;
  const [local, setLocal] = useState(remote);
  const [dragging, setDragging] = useState(false);

  // Follow remote updates unless the student is mid-drag.
  useEffect(() => {
    if (!dragging) setLocal(remote);
  }, [remote, dragging]);

  const commit = () => {
    setDragging(false);
    onControl(local);
  };

  return (
    <div className="slider-wrap">
      <div className="slider-value">{local}</div>
      <input
        type="range"
        min="0"
        max="100"
        value={local}
        onChange={(e) => {
          setDragging(true);
          setLocal(Number(e.target.value));
        }}
        onPointerUp={commit}
        onKeyUp={(e) => ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(e.key) && commit()}
      />
      <div className="slider-scale"><span>0</span><span>100</span></div>
    </div>
  );
}
