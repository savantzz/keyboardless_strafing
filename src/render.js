// Scrolling per-tick sync bars: oldest on the left, most recent on the
// right. Bar HEIGHT is that tick's yaw-rate ratio (smoothed -- see
// synctrace.js): actual mouse turn this tick versus the ideal turn amount
// for your current speed/settings (idealYawSpeedFor in physics.mjs) -- see
// main.js's onTick for the full reasoning and what this replaced. A
// horizontal "optimal" reference line marks 100%: bars reaching it turned
// exactly the ideal amount, taller means over-turning past it, shorter
// means under-turning. Unbounded above (confirmed directly from
// momentum-mod/game issue #1629: its own "gain percentage" is explicitly
// not clamped to 100 either).
//
// Bar COLOR is a SEPARATE metric: speedGain/idealGain (also smoothed),
// not the same ratio driving height. Confirmed directly from the actual
// Momentum Mod panorama source (scripts/hud/strafe-trainer.ts,
// drawGraph()/getColorPair()): graphHistory stores { ratio, gain } as two
// independent fields, height from `ratio` (yaw), color from `gain`. Using
// one ratio for both (an earlier version here did) meant sustained
// over-turning pinned every bar to the same flat color past the top
// tier's breakpoint, since nothing distinguished "over-turned a little,
// still gaining well" from "over-turned wildly, barely gaining at all."
// gainTierColor below ports getColorPair's exact threshold/lerp structure
// (its overStrafing=false branch, the only one the reference itself uses
// for these bars), fractions there (1.02, 0.99, ...) multiplied by 100 to
// match this file's percent scale; the SYNC% headline number keeps the
// original tierColor/COLOR_STOPS smooth 7-stop scale below, since that
// stat (unlike bar color) has no reference equivalent to port from --
// strafe-sync.ts, the reference's other stat file, tracks key-press-vs-
// mouse-turn timing, which doesn't apply to keyboardless training at all.
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

// Base RGB for each tier, ported directly from the reference's Colors
// object (its first/"low" value of each [low, high] gradient pair -- this
// file fills bars flat rather than replicating the reference's per-slice
// gradient shading, a rendering embellishment orthogonal to the height/
// color-metric split this function exists for). LOSS is unused: the
// reference's overStrafing=false branch (ported below, the one it uses for
// these bars) never returns it -- that color only appears in its other,
// direction-aware branch this file doesn't use.
const GAIN_TIER = {
  EXTRA: [24, 150, 211],
  PERFECT: [87, 200, 255],
  GOOD: [21, 152, 86],
  SLOW: [248, 222, 74],
  NEUTRAL: [178, 178, 178],
  STOP: [211, 24, 24],
};

// Ported directly from getColorPair(ratio, overStrafing=false) in the
// reference's strafe-trainer.ts -- its own fraction thresholds (1.02,
// 0.99, 0.95, 0.85, 0.75, 0.5, 0, -5) multiplied by 100 to match this
// file's percent scale. pct is speedGain/idealGain, not the yaw ratio.
function gainTierColor(pct) {
  let rgb;
  if (pct > 102) rgb = GAIN_TIER.EXTRA;
  else if (pct > 99) rgb = GAIN_TIER.PERFECT;
  else if (pct > 95) rgb = GAIN_TIER.GOOD;
  else if (pct <= -500) rgb = GAIN_TIER.STOP;
  else if (pct > 85) rgb = lerpRgb(GAIN_TIER.SLOW, GAIN_TIER.GOOD, (pct - 85) / 10);
  else if (pct > 75) rgb = GAIN_TIER.SLOW;
  else if (pct > 50) rgb = lerpRgb(GAIN_TIER.NEUTRAL, GAIN_TIER.SLOW, (pct - 50) / 25);
  else if (pct > 0) rgb = GAIN_TIER.NEUTRAL;
  else rgb = lerpRgb(GAIN_TIER.NEUTRAL, GAIN_TIER.STOP, Math.min(1, Math.abs(pct) / 500));
  return `rgb(${rgb.map(Math.round).join(',')})`;
}

// Colors for the latest-keyswitch readout (keyboard mode only), ported
// from the reference's StrafeOffset.colorFor: late = its LATE orange,
// early = its EARLY blue, perfect = its PERFECT green. Same base RGB as
// GAIN_TIER.GOOD/EXTRA and the old COLOR_STOPS LOSS entry, named
// separately here since they're a different stat with its own meaning.
const KEYSWITCH_COLOR = { PERFECT: 'rgb(21,152,86)', LATE: 'rgb(220,116,13)', EARLY: 'rgb(24,150,211)' };

export function renderSyncBars(
  ctx,
  { ticks, maxTicks, speed, syncPct, syncLabel, avgEfficiencyPct, lastTickYawDeg, latestKeySwitch },
) {
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

  // Zero baseline -- drawn under the bars deliberately: it's meant to read
  // as a floor, and most bars sit above it anyway.
  ctx.strokeStyle = 'rgba(255,255,255,0.15)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(0, zeroY);
  ctx.lineTo(w, zeroY);
  ctx.stroke();

  ticks.forEach((tick, i) => {
    const x = (startIndex + i) * barWidth;
    const y = yFor(tick.smoothedEfficiencyPct);
    const top = Math.min(y, zeroY);
    const barH = Math.max(2, Math.abs(zeroY - y));
    ctx.fillStyle = gainTierColor(tick.smoothedGainRatioPct);
    ctx.fillRect(x, top, Math.max(1, barWidth - 1), barH);
  });

  // Optimal (100%) reference line -- drawn AFTER the bars, on top, so a run
  // of tall bars (over-turning, which is exactly when this line matters
  // most for gauging how far past optimal you are) can't paint over it and
  // hide it. Reported directly: sustained over-strafing turned the whole
  // chart solid blue and the line disappeared underneath.
  ctx.strokeStyle = 'rgba(255,255,255,0.4)';
  ctx.setLineDash([5, 5]);
  ctx.beginPath();
  ctx.moveTo(0, optimalY);
  ctx.lineTo(w, optimalY);
  ctx.stroke();
  ctx.setLineDash([]);

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
  ctx.fillText(syncLabel ?? 'SYNC', w - 16, 52);

  ctx.textBaseline = 'bottom';
  ctx.fillStyle = 'rgba(255,255,255,0.7)';
  ctx.font = '12px "SF Mono", "Cascadia Code", monospace';
  // Latest real keyswitch timing (keyboard mode only) -- ported from the
  // reference's own per-event text readout (StrafeOffset.updateText).
  // Added above the other diagnostics rather than shifting their fixed
  // positions, so the rest of the HUD doesn't jump when toggling modes.
  if (latestKeySwitch) {
    ctx.fillStyle = KEYSWITCH_COLOR[latestKeySwitch.tier] ?? 'rgba(255,255,255,0.7)';
    ctx.fillText(`last keyswitch  ${latestKeySwitch.text}`, w - 16, h - 52);
    ctx.fillStyle = 'rgba(255,255,255,0.7)';
  }
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
