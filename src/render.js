// Primary visualization: a scrolling strip chart of the player's actual
// angular velocity (deg/s) against the ideal target rate, oldest on the
// left, now on the right. Color encodes how close to target the trace is;
// shaded red bands mark detected "stutter" events (hesitating/pausing
// through a direction change instead of reversing smoothly).
function lerp(a, b, t) {
  return a + (b - a) * t;
}

// Green (on target) -> red (far off), via HSL.
function errorColor(err) {
  const hue = lerp(140, 0, Math.min(1, err));
  return `hsl(${hue}, 85%, 55%)`;
}

export function renderTrace(ctx, { samples, targetDeg, stutterEvents, nowMs, windowMs, stats }) {
  const { canvas } = ctx;
  const w = canvas.width;
  const h = canvas.height;
  ctx.clearRect(0, 0, w, h);

  const maxDeg = Math.max(targetDeg * 1.6, 40);
  const originY = h / 2;
  const scaleY = (h / 2 - 24) / maxDeg;
  const t0 = nowMs - windowMs;
  const mapX = (t) => ((t - t0) / windowMs) * w;
  const mapY = (rate) => originY - rate * scaleY;

  // Stutter bands (drawn first, behind everything).
  ctx.fillStyle = 'rgba(255, 70, 70, 0.14)';
  for (const ev of stutterEvents) {
    const x0 = Math.max(0, mapX(ev.start));
    const x1 = Math.min(w, mapX(ev.end));
    if (x1 > x0) ctx.fillRect(x0, 0, x1 - x0, h);
  }

  // Zero line.
  ctx.strokeStyle = 'rgba(255,255,255,0.12)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(0, originY);
  ctx.lineTo(w, originY);
  ctx.stroke();

  // Target reference lines (+/- target, since direction alternates).
  ctx.strokeStyle = 'rgba(255,255,255,0.35)';
  ctx.setLineDash([5, 5]);
  for (const sign of [1, -1]) {
    const y = mapY(sign * targetDeg);
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(w, y);
    ctx.stroke();
  }
  ctx.setLineDash([]);

  // The trace itself, segment-colored by instantaneous error vs target.
  ctx.lineWidth = 2.5;
  ctx.lineCap = 'round';
  for (let i = 1; i < samples.length; i++) {
    const a = samples[i - 1];
    const b = samples[i];
    const errA = Math.min(1, Math.abs(Math.abs(a.rateDeg) - targetDeg) / Math.max(targetDeg, 1e-6));
    const errB = Math.min(1, Math.abs(Math.abs(b.rateDeg) - targetDeg) / Math.max(targetDeg, 1e-6));
    ctx.strokeStyle = errorColor((errA + errB) / 2);
    ctx.beginPath();
    ctx.moveTo(mapX(a.t), mapY(a.rateDeg));
    ctx.lineTo(mapX(b.t), mapY(b.rateDeg));
    ctx.stroke();
  }

  // Leading dot at the current sample.
  if (samples.length) {
    const last = samples[samples.length - 1];
    const err = Math.min(1, Math.abs(Math.abs(last.rateDeg) - targetDeg) / Math.max(targetDeg, 1e-6));
    ctx.fillStyle = errorColor(err);
    ctx.beginPath();
    ctx.arc(mapX(last.t), mapY(last.rateDeg), 4, 0, Math.PI * 2);
    ctx.fill();
  }

  // Minimal HUD, top-left.
  ctx.fillStyle = 'rgba(255,255,255,0.85)';
  ctx.font = '12px "SF Mono", "Cascadia Code", monospace';
  ctx.textBaseline = 'top';
  const liveRate = samples.length ? Math.abs(samples[samples.length - 1].rateDeg) : 0;
  const lines = [
    `speed  ${stats.speed?.toFixed(0) ?? '-'} u/s`,
    `target ${targetDeg.toFixed(0)} deg/s   actual ${liveRate.toFixed(0)} deg/s`,
    `consistency ${stats.scorePct?.toFixed(0) ?? '0'}%   streak ${(stats.streakMs / 1000).toFixed(1)}s`,
  ];
  lines.forEach((line, i) => ctx.fillText(line, 12, 10 + i * 16));
}
