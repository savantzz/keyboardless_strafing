// Scrolling per-tick sync bars: oldest on the left, most recent on the
// right, bar height = that tick's speed-gain efficiency vs the theoretical
// max for the speed you were at, color green (efficient) to red
// (inefficient/no gain). This is the standard bhop/surf "sync" HUD, mapped
// directly onto the physics engine's own accel/efficiency numbers.
function lerp(a, b, t) {
  return a + (b - a) * t;
}

function efficiencyColor(pct) {
  const t = Math.max(0, Math.min(1, pct / 100));
  const hue = lerp(0, 140, t); // red -> green
  return `hsl(${hue}, 85%, 52%)`;
}

export function renderSyncBars(ctx, { ticks, maxTicks, speed, syncPct, avgEfficiencyPct }) {
  const { canvas } = ctx;
  const w = canvas.width;
  const h = canvas.height;
  ctx.clearRect(0, 0, w, h);

  const baseline = h - 40;
  const maxBarHeight = baseline - 40;
  const barWidth = w / maxTicks;
  const startIndex = maxTicks - ticks.length;

  // Baseline.
  ctx.strokeStyle = 'rgba(255,255,255,0.15)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(0, baseline);
  ctx.lineTo(w, baseline);
  ctx.stroke();

  ticks.forEach((tick, i) => {
    const x = (startIndex + i) * barWidth;
    const pct = Math.max(0, Math.min(100, tick.efficiencyPct));
    const barH = tick.gained ? Math.max(2, (pct / 100) * maxBarHeight) : 2;
    ctx.fillStyle = tick.gained ? efficiencyColor(pct) : 'rgba(255,70,70,0.7)';
    ctx.fillRect(x, baseline - barH, Math.max(1, barWidth - 1), barH);
  });

  // Big headline sync number, top-left.
  ctx.textBaseline = 'top';
  ctx.fillStyle = efficiencyColor(syncPct);
  ctx.font = '600 32px -apple-system, "Segoe UI", sans-serif';
  ctx.fillText(`${syncPct.toFixed(0)}%`, 16, 14);

  ctx.fillStyle = 'rgba(255,255,255,0.5)';
  ctx.font = '11px -apple-system, "Segoe UI", sans-serif';
  ctx.fillText('SYNC', 16, 52);

  ctx.textBaseline = 'bottom';
  ctx.fillStyle = 'rgba(255,255,255,0.7)';
  ctx.font = '12px "SF Mono", "Cascadia Code", monospace';
  ctx.fillText(`avg efficiency  ${avgEfficiencyPct.toFixed(0)}%`, 16, h - 20);
  ctx.fillText(`speed  ${speed.toFixed(0)} u/s`, 16, h - 4);
}
