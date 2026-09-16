// Scrolling per-tick sync bars: oldest on the left, most recent on the
// right, bar height = that tick's speed-gain efficiency (smoothed over a
// short trailing window -- see synctrace.js for why) vs the theoretical
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

export function renderSyncBars(ctx, { ticks, maxTicks, speed, syncPct, avgEfficiencyPct, lastTickYawDeg }) {
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
    // Smoothed value drives both height and color -- no hard gained/
    // not-gained branch, so a single tremor-driven blip dents a bar rather
    // than flipping it instantly between full-green and flat-red.
    const pct = Math.max(0, Math.min(100, tick.smoothedEfficiencyPct));
    const barH = Math.max(3, (pct / 100) * maxBarHeight);
    ctx.fillStyle = efficiencyColor(pct);
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
  ctx.fillText(`avg efficiency  ${avgEfficiencyPct.toFixed(0)}%`, w - 16, h - 36);
  ctx.fillText(`speed  ${speed.toFixed(0)} u/s`, w - 16, h - 20);
  // Diagnostic: raw turn the last tick actually registered. Move the mouse
  // slowly and watch this -- if it stays at a flat 0.00 while you can feel
  // yourself moving the mouse, the input isn't reaching the sim at all
  // (most likely Windows' "Enhance pointer precision" dampening slow
  // movement before the browser sees it), as opposed to just being small.
  ctx.fillStyle = Math.abs(lastTickYawDeg ?? 0) > 0.001 ? 'rgba(120,220,140,0.9)' : 'rgba(255,255,255,0.4)';
  ctx.fillText(`last tick turn  ${(lastTickYawDeg ?? 0).toFixed(3)} deg`, w - 16, h - 4);
  ctx.textAlign = 'left';
}
