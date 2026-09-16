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
    // No-gain ticks still get a visible, non-transparent sliver -- at high
    // speed the vast majority of ticks fall in this bucket (the gain window
    // narrows sharply as speed rises), and a near-invisible color there
    // made it look like ticks were missing rather than just ungained.
    const barH = tick.gained ? Math.max(3, (pct / 100) * maxBarHeight) : 3;
    ctx.fillStyle = tick.gained ? efficiencyColor(pct) : '#7a1f1f';
    ctx.fillRect(x, baseline - barH, Math.max(1, barWidth - 1), barH);
  });

  // HUD top-right / bottom-right -- settings live top-left now, so the
  // readouts and the live edge (newest bar, far right) share the same side
  // instead of settings competing with where you're actually looking.
  ctx.textAlign = 'right';
  ctx.textBaseline = 'top';
  ctx.fillStyle = efficiencyColor(syncPct);
  ctx.font = '600 32px -apple-system, "Segoe UI", sans-serif';
  ctx.fillText(`${syncPct.toFixed(0)}%`, w - 16, 14);

  ctx.fillStyle = 'rgba(255,255,255,0.5)';
  ctx.font = '11px -apple-system, "Segoe UI", sans-serif';
  ctx.fillText('SYNC', w - 16, 52);

  ctx.textBaseline = 'bottom';
  ctx.fillStyle = 'rgba(255,255,255,0.7)';
  ctx.font = '12px "SF Mono", "Cascadia Code", monospace';
  ctx.fillText(`avg efficiency  ${avgEfficiencyPct.toFixed(0)}%`, w - 16, h - 20);
  ctx.fillText(`speed  ${speed.toFixed(0)} u/s`, w - 16, h - 4);
  ctx.textAlign = 'left';
}
