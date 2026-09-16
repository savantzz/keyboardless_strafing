// Scrolling per-tick sync bars: oldest on the left, most recent on the
// right. Bar height is that tick's quality score (smoothed over a short
// trailing window -- see synctrace.js): actualGain/idealGain when gaining
// speed (0% = no gain, 100% = the best this tick could do), or
// actualGain/accelCap when actively losing speed -- see main.js's onTick
// for the full reasoning and what this replaced. A horizontal "optimal"
// reference line marks 100%: bars reaching it are ideal, taller means
// over-rotating past it, shorter means under-turning, and bars dropping
// below the zero baseline mean actively losing speed that tick. The
// unclamped range and color tiers (rather than floored at 0%, flat
// red-green) are ported from Momentum Mod's own strafe-trainer HUD -- see
// conversation history for the source file.
function lerp(a, b, t) {
  return a + (b - a) * t;
}

function lerpRgb(a, b, t) {
  return [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];
}

// Ratio breakpoints (in %, 100 = optimal) -> base RGB, ported from the
// reference HUD's EXTRA/PERFECT/GOOD/SLOW/NEUTRAL/LOSS/STOP tiers.
const COLOR_STOPS = [
  { r: -100, c: [211, 24, 24] }, // STOP -- fully reversing/stalling
  { r: -20, c: [220, 116, 13] }, // LOSS -- actively losing speed
  { r: 0, c: [178, 178, 178] }, // NEUTRAL -- no gain, no loss
  { r: 50, c: [178, 178, 178] },
  { r: 85, c: [248, 222, 74] }, // SLOW
  { r: 95, c: [21, 152, 86] }, // GOOD
  { r: 100, c: [87, 200, 255] }, // PERFECT
  { r: 105, c: [24, 150, 211] }, // EXTRA -- over-rotating past optimal
];

function tierColor(ratio) {
  if (ratio <= COLOR_STOPS[0].r) return `rgb(${COLOR_STOPS[0].c.map(Math.round).join(',')})`;
  const last = COLOR_STOPS[COLOR_STOPS.length - 1];
  if (ratio >= last.r) return `rgb(${last.c.map(Math.round).join(',')})`;
  for (let i = 0; i < COLOR_STOPS.length - 1; i++) {
    const a = COLOR_STOPS[i];
    const b = COLOR_STOPS[i + 1];
    if (ratio >= a.r && ratio <= b.r) {
      const t = b.r === a.r ? 0 : (ratio - a.r) / (b.r - a.r);
      const [r, g, bl] = lerpRgb(a.c, b.c, t);
      return `rgb(${Math.round(r)},${Math.round(g)},${Math.round(bl)})`;
    }
  }
  return `rgb(${COLOR_STOPS[COLOR_STOPS.length - 1].c.join(',')})`;
}

// Display range clamp -- an extreme single-tick spike shouldn't blow the
// scale out for everything else on screen; color still reflects the true
// unclamped value even when the bar's height is capped.
const DISPLAY_MIN = -60;
const DISPLAY_MAX = 180;

export function renderSyncBars(ctx, { ticks, maxTicks, speed, syncPct, avgEfficiencyPct, lastTickYawDeg }) {
  const { canvas } = ctx;
  const w = canvas.width;
  const h = canvas.height;
  ctx.clearRect(0, 0, w, h);

  const chartTop = 20;
  const chartBottom = h - 60;
  const zeroY = chartBottom; // 0% (no gain) baseline
  const optimalY = chartBottom - 0.62 * (chartBottom - chartTop); // 100% reference line
  const pxPerPct = (zeroY - optimalY) / 100;
  const barWidth = w / maxTicks;
  const startIndex = maxTicks - ticks.length;

  const yFor = (pct) => zeroY - Math.max(DISPLAY_MIN, Math.min(DISPLAY_MAX, pct)) * pxPerPct;

  // Zero baseline.
  ctx.strokeStyle = 'rgba(255,255,255,0.15)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(0, zeroY);
  ctx.lineTo(w, zeroY);
  ctx.stroke();

  // Optimal (100%) reference line.
  ctx.strokeStyle = 'rgba(255,255,255,0.4)';
  ctx.setLineDash([5, 5]);
  ctx.beginPath();
  ctx.moveTo(0, optimalY);
  ctx.lineTo(w, optimalY);
  ctx.stroke();
  ctx.setLineDash([]);

  ticks.forEach((tick, i) => {
    const x = (startIndex + i) * barWidth;
    const pct = tick.smoothedEfficiencyPct;
    const y = yFor(pct);
    const top = Math.min(y, zeroY);
    const barH = Math.max(2, Math.abs(zeroY - y));
    ctx.fillStyle = tierColor(pct);
    ctx.fillRect(x, top, Math.max(1, barWidth - 1), barH);
  });

  // HUD top-right / bottom-right -- settings live top-left now, so the
  // readouts and the live edge (newest bar, far right) share the same side
  // instead of settings competing with where you're actually looking.
  ctx.textAlign = 'right';
  ctx.textBaseline = 'top';
  ctx.fillStyle = tierColor(syncPct);
  ctx.font = '600 32px -apple-system, "Segoe UI", sans-serif';
  ctx.fillText(`${syncPct.toFixed(0)}%`, w - 16, 14);

  ctx.fillStyle = 'rgba(255,255,255,0.5)';
  ctx.font = '11px -apple-system, "Segoe UI", sans-serif';
  ctx.fillText('SYNC', w - 16, 52);

  ctx.textBaseline = 'bottom';
  ctx.fillStyle = 'rgba(255,255,255,0.7)';
  ctx.font = '12px "SF Mono", "Cascadia Code", monospace';
  ctx.fillText(`avg quality  ${avgEfficiencyPct.toFixed(0)}%`, w - 16, h - 36);
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
